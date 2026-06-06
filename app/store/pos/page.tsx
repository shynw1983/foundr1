"use client";

import { Banknote, Camera, CreditCard, Gift, Minus, Plus, ReceiptText, ScanLine, Search, ShoppingCart, Trash2, UserRound, X } from "lucide-react";
import jsQR from "jsqr";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { getCashBreakdownTotal, yenDenominations, type CashBreakdown } from "../../../lib/pos-cash-denominations";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { getStoredStoreSelection, setStoredStoreSelection } from "../components/store-selection";

type StoreOption = {
  id: string;
  name: string;
};

type BrandOption = {
  id: string;
  name: string;
};

type PosMenuCategory = {
  id: string;
  brandId: string;
  name: string;
  sortOrder: number;
};

type PosMenuItem = {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  itemKind: string;
  category: string;
  imageUrl: string;
  basePrice: number | null;
  priceOverride: number | null;
  posPricingMode: string;
  posWeightUnit: string;
  posWeightUnitPrice: number | null;
  isAvailable: boolean;
  variableSchema: Record<string, unknown>;
};

type PosMenuOption = {
  id: string;
  optionKey: string;
  name: string;
  priceDelta: number | null;
  sortOrder: number;
};

type PosOptionGroup = {
  id: string;
  brandId: string;
  menuCatalogItemId: string;
  groupKey: string;
  name: string;
  selectionType: string;
  ruleJson: Record<string, unknown>;
  sortOrder: number;
  options: PosMenuOption[];
};

type PosSelectedOption = PosMenuOption & {
  groupId: string;
  groupKey: string;
  groupName: string;
};

type PosCartItem = PosMenuItem & {
  cartKey: string;
  quantity: number;
  measuredQuantity: number | null;
  measuredUnit: string;
  measuredUnitPrice: number | null;
  selectedOptions: PosSelectedOption[];
  optionTotal: number;
};

type PosSummary = {
  orderCount: number;
  total: number;
  average: number;
  latestOrders: Array<{
    id: string;
    pickupCode: string;
    amount: number;
    paymentMethod: string;
    createdTime: string;
  }>;
};

type PosTransactionItem = {
  id: string;
  name: string;
  size: string;
  temperature: string;
  sweetness: string;
  ice: string;
  option: string;
  toppings: string[];
  quantity: number;
  measuredQuantity: number | null;
  measuredUnit: string;
  measuredUnitPrice: number | null;
  amount: number;
};

type PosTransaction = {
  id: string;
  pickupCode: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  amount: number;
  orderType?: string;
  note?: string;
  cashierName: string;
  cashTenderedAmount: number | null;
  cashChangeAmount: number | null;
  refundReason?: string;
  createdLabel: string;
  createdTime?: string;
  refundStatus: string;
  refundedAt: string;
  cashSessionStatus: string;
  items?: PosTransactionItem[];
};

type PosAccess = {
  stores: StoreOption[];
  canUseAllStoreView: boolean;
};

type PosDiscountPreset = {
  key: string;
  name: string;
  discountType: "percent" | "amount";
  discountValue: number;
  targetScope: "all" | "category" | "item_kind" | "brand";
  targetValue: string;
  enabled: boolean;
  stampEligible: boolean;
  allowCouponCombination: boolean;
};

type PosSettings = {
  dineInEnabled: boolean;
  dineInTaxRate: number;
  takeoutTaxRate: number;
  externalPaymentTerminalBrand: string;
  priceTaxMode: string;
  discountPresets: PosDiscountPreset[];
};

type PosCashSession = {
  id: string;
  businessDate: string;
  registerName: string;
  status: string;
  openingAmount: number;
  openingCashBreakdown: CashBreakdown;
  expectedCashAmount: number;
  countedCashAmount: number | null;
  countedCashBreakdown: CashBreakdown;
  differenceAmount: number | null;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  openedByName: string;
  openedAt: string;
  closedAt: string;
};

type PosCashMovement = {
  id: string;
  movementType: string;
  amount: number;
  reason: string;
  createdByName: string;
  createdTime: string;
};

type PosCashResponsibleEmployee = {
  id: string;
  name: string;
  role: string;
  punchedAt: string;
};

type PosMember = {
  id: string;
  memberNumber: string;
  publicToken: string;
  displayName: string;
  phone: string;
  email: string;
  pointBalance: number;
  lifetimeSpendAmount: number;
  lifetimeVisitCount: number;
  currentTierKey: string;
};

type PosCoupon = {
  id: string;
  brandId: string;
  brandName: string;
  couponCode: string;
  name: string;
  discountType: string;
  discountValue: number;
  maxDiscountAmount: number | null;
  expiresAt: string;
  issuedSource: string;
};

type PosPreviousClosedSession = {
  id: string;
  businessDate: string;
  countedCashAmount: number;
  closedByName: string;
  closedAt: string;
};

type PosBusinessState = {
  businessDate: string;
  openLabel: string;
  closeLabel: string;
  status: string;
  statusLabel: string;
  detailLabel: string;
  tone: "active" | "warning" | "off";
};

type PosReconciliation = {
  businessDate: string;
  businessState: PosBusinessState | null;
  activeSession: PosCashSession | null;
  previousClosedSession: PosPreviousClosedSession | null;
  sessions: PosCashSession[];
  movements: PosCashMovement[];
  activeCashResponsibleEmployees: PosCashResponsibleEmployee[];
};

const paymentOptions = [
  { value: "cash", label: "現金", icon: Banknote },
  { value: "card", label: "カード", icon: CreditCard },
  { value: "other", label: "その他", icon: ShoppingCart }
];

function getCouponDiscountAmount(coupon: PosCoupon | undefined, amount: number, exchangeEligibleAmounts: number[] = []) {
  if (!coupon) return 0;
  const subtotal = Math.max(0, Math.round(amount || 0));
  if (isExchangeCoupon(coupon)) {
    const eligibleAmounts = exchangeEligibleAmounts.map((value) => Math.max(0, Math.round(Number(value) || 0))).filter((value) => value > 0);
    return eligibleAmounts.length ? Math.min(subtotal, Math.max(...eligibleAmounts)) : 0;
  }
  const value = Math.max(0, Math.round(Number(coupon.discountValue) || 0));
  const maxAmount = coupon.maxDiscountAmount == null ? null : Math.max(0, Math.round(Number(coupon.maxDiscountAmount) || 0));
  const rawDiscount = coupon.discountType === "percent" ? Math.floor(subtotal * value / 100) : value;
  return Math.min(subtotal, maxAmount == null ? rawDiscount : Math.min(rawDiscount, maxAmount));
}

function getCouponValueLabel(coupon: PosCoupon) {
  if (isExchangeCoupon(coupon)) return "1杯交換";
  return coupon.discountType === "percent" ? `${coupon.discountValue}%` : formatYen(coupon.discountValue);
}

function getCouponScopeLabel(coupon: { brandName?: string }) {
  return coupon.brandName ? `${coupon.brandName} 適用` : "全店舗適用";
}

function isExchangeCoupon(coupon: { issuedSource?: string; name?: string }) {
  return coupon.issuedSource === "stamp_campaign" || Boolean(coupon.name?.includes("無料券"));
}

function getCouponPosStatusLabel(coupon: PosCoupon, discount: number, subtotal: number) {
  if (isExchangeCoupon(coupon) && discount > 0) return "交換適用";
  if (discount > 0) return `-${formatYen(discount)}`;
  if (subtotal <= 0) return "商品追加後に適用";
  return "対象外";
}

function getDiscountEligibleAmount(preset: PosDiscountPreset, cart: PosCartItem[], subtotal: number) {
  if (preset.targetScope === "all") return subtotal;
  return cart.reduce((sum, item) => {
    if (preset.targetScope === "category" && item.category !== preset.targetValue) return sum;
    if (preset.targetScope === "item_kind" && item.itemKind !== preset.targetValue) return sum;
    if (preset.targetScope === "brand" && item.brandId !== preset.targetValue) return sum;
    return sum + getCartItemAmount(item);
  }, 0);
}

function getPosDiscountAmount(preset: PosDiscountPreset | undefined, cart: PosCartItem[], subtotal: number) {
  if (!preset) return 0;
  const eligibleAmount = Math.max(0, Math.round(getDiscountEligibleAmount(preset, cart, subtotal)));
  if (eligibleAmount <= 0) return 0;
  const rawDiscount = preset.discountType === "percent"
    ? Math.floor(eligibleAmount * preset.discountValue / 100)
    : preset.discountValue;
  return Math.min(eligibleAmount, Math.max(0, Math.round(rawDiscount)));
}

function getOrderTaxRate(settings: PosSettings, orderType: string) {
  return orderType === "eat_in" ? Number(settings.dineInTaxRate ?? 10) : Number(settings.takeoutTaxRate ?? 8);
}

function getTaxSummary(params: {
  subtotal: number;
  discountAmount: number;
  couponDiscountAmount: number;
  taxRate: number;
  priceTaxMode: string;
}) {
  const taxableAmount = Math.max(0, Math.round(params.subtotal - params.discountAmount - params.couponDiscountAmount));
  const taxRate = Math.max(0, Number(params.taxRate) || 0);
  if (params.priceTaxMode === "tax_excluded") {
    const taxAmount = Math.floor(taxableAmount * taxRate / 100);
    return { taxableAmount, taxAmount, payableAmount: taxableAmount + taxAmount };
  }
  const taxAmount = taxRate > 0 ? taxableAmount - Math.floor(taxableAmount / (1 + taxRate / 100)) : 0;
  return { taxableAmount, taxAmount, payableAmount: taxableAmount };
}

function getDiscountTargetLabel(preset: PosDiscountPreset) {
  if (preset.targetScope === "all") return "全商品";
  if (preset.targetScope === "category") return `カテゴリ: ${preset.targetValue}`;
  if (preset.targetScope === "item_kind") return `商品種別: ${preset.targetValue}`;
  if (preset.targetScope === "brand") return "ブランド指定";
  return "対象指定";
}

const orderTypeOptions = [
  { value: "eat_in", label: "店内" },
  { value: "takeout", label: "持ち帰り" }
];

const denominationCountOptions = [
  { value: "", label: "0" },
  ...Array.from({ length: 50 }, (_, index) => {
    const value = String(index + 1);
    return { value, label: value };
  })
];

const dineInWeightMalatangOptionGroupKeys = new Set([
  "heat",
  "numb",
  "dine-in-customer-ingredient",
  "dine-in-customer-ingredients",
  "customer-requested-ingredient",
  "customer-requested-ingredients",
  "counter-ingredient",
  "counter-ingredients",
  "counter-requested-ingredient",
  "counter-requested-ingredients"
]);
const dineInWeightMalatangOptionGroupNames = new Set([
  "堂吃客人指定食材",
  "堂食客人指定食材",
  "柜台指定食材",
  "カウンター指定食材",
  "店内客指定食材",
  "店内お客様指定食材"
]);

function isDineInWeightMalatangOptionGroup(group: Pick<PosOptionGroup, "groupKey" | "name">) {
  return dineInWeightMalatangOptionGroupKeys.has(group.groupKey) || dineInWeightMalatangOptionGroupNames.has(group.name);
}

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
}

function formatDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function createCashBreakdownInput() {
  return yenDenominations.reduce((result, denomination) => {
    result[String(denomination)] = "";
    return result;
  }, {} as Record<string, string>);
}

function formatDenominationLabel(value: number) {
  return value >= 1000 ? `¥${value.toLocaleString("ja-JP")}` : `¥${value}`;
}

function getPaymentLabel(value: string) {
  return paymentOptions.find((option) => option.value === value)?.label ?? value;
}

function getOrderTypeLabel(value = "") {
  return orderTypeOptions.find((option) => option.value === value)?.label ?? value;
}

function getTransactionStatusLabel(transaction: Pick<PosTransaction, "status" | "paymentStatus">) {
  if (transaction.status === "cancelled" || transaction.paymentStatus === "refunded") return "返金済み";
  return "会計済み";
}

function getItemPrice(item: Pick<PosMenuItem, "basePrice" | "priceOverride">) {
  return Math.round(Number(item.priceOverride ?? item.basePrice ?? 0));
}

function getCartItemAmount(item: Pick<PosCartItem, "measuredQuantity" | "measuredUnitPrice" | "optionTotal" | "quantity" | "basePrice" | "priceOverride">) {
  const unitAmount = item.measuredQuantity
    ? Math.round(item.measuredQuantity * Number(item.measuredUnitPrice ?? 0)) + item.optionTotal
    : getItemPrice(item) + item.optionTotal;
  return unitAmount * item.quantity;
}

function getAllowedRuleKey(groupKey: string) {
  const ruleKeys: Record<string, string> = {
    size: "allowedSizes",
    temperature: "temperatures",
    sweetness: "allowedSweetness",
    ice: "allowedIce",
    option: "allowedOptions",
    topping: "allowedToppings"
  };
  return ruleKeys[groupKey] ?? `allowed_${groupKey}`;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function getSchemaNumber(schema: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = schema?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function getNestedSchemaNumber(schema: Record<string, unknown> | undefined, parentKey: string, keys: string[]) {
  const parent = schema?.[parentKey];
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) return null;
  return getSchemaNumber(parent as Record<string, unknown>, keys);
}

function getWeightPricingConfig(item: Pick<PosMenuItem, "posPricingMode" | "posWeightUnit" | "posWeightUnitPrice" | "variableSchema">, orderType: string) {
  if (orderType !== "eat_in" || item.posPricingMode !== "weight") return null;
  const schema = item.variableSchema ?? {};
  const nested = typeof schema.posWeightPricing === "object" && schema.posWeightPricing !== null
    ? schema.posWeightPricing as Record<string, unknown>
    : {};
  const unit = item.posWeightUnit || String(schema.weightUnit ?? schema.measuredUnit ?? nested.unit ?? "g").trim() || "g";
  const unitPrice = Number(item.posWeightUnitPrice ?? 0) > 0
    ? Number(item.posWeightUnitPrice)
    : getSchemaNumber(schema, ["pricePerGram", "weightUnitPrice", "measuredUnitPrice"]) ??
    getNestedSchemaNumber(schema, "posWeightPricing", ["pricePerGram", "unitPrice", "weightUnitPrice"]);
  return { unit, unitPrice };
}

function formatWeightPrice(item: Pick<PosMenuItem, "posPricingMode" | "posWeightUnit" | "posWeightUnitPrice" | "variableSchema">, orderType: string) {
  const config = getWeightPricingConfig(item, orderType);
  if (!config) return "";
  return config.unitPrice && config.unitPrice > 0
    ? `${formatYen(config.unitPrice)}/${config.unit}`
    : `重量単価未設定`;
}

function getOptionPrice(option: Pick<PosMenuOption, "priceDelta">) {
  return Math.round(Number(option.priceDelta ?? 0));
}

function getEffectiveSelectionType(group: Pick<PosOptionGroup, "groupKey" | "selectionType">) {
  if (group.selectionType === "quantity") return "quantity";
  if (["size", "temperature", "sweetness", "ice", "option"].includes(group.groupKey)) return "single";
  if (group.groupKey === "topping") return "multiple";
  return group.selectionType || "single";
}

function getOptionGroupLimit(group: Pick<PosOptionGroup, "groupKey" | "selectionType" | "ruleJson">) {
  const limit = Number(group.ruleJson?.limit);
  if (Number.isFinite(limit)) return Math.max(0, Math.floor(limit));
  return getEffectiveSelectionType(group) === "single" ? 1 : 99;
}

function getCategories(items: PosMenuItem[], categories: PosMenuCategory[], brandId: string) {
  const counts = new Map<string, number>();
  const masters = new Map<string, PosMenuCategory>();
  for (const item of items) {
    if (brandId && item.brandId !== brandId) continue;
    counts.set(item.category || "未分類", (counts.get(item.category || "未分類") ?? 0) + 1);
  }
  for (const category of categories) {
    if (brandId && category.brandId !== brandId) continue;
    masters.set(category.name, category);
    if (!counts.has(category.name)) counts.set(category.name, 0);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count, sortOrder: masters.get(name)?.sortOrder ?? 9999 }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
}

export default function StorePosPage() {
  const memberScannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const memberScannerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const memberScannerStreamRef = useRef<MediaStream | null>(null);
  const memberScannerActiveRef = useRef(false);
  const [access, setAccess] = useState<PosAccess | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [categories, setCategories] = useState<PosMenuCategory[]>([]);
  const [items, setItems] = useState<PosMenuItem[]>([]);
  const [optionGroups, setOptionGroups] = useState<PosOptionGroup[]>([]);
  const [summary, setSummary] = useState<PosSummary>({ orderCount: 0, total: 0, average: 0, latestOrders: [] });
  const [posSettings, setPosSettings] = useState<PosSettings>({ dineInEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: "PayCAS", priceTaxMode: "tax_included", discountPresets: [] });
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [configuringItem, setConfiguringItem] = useState<PosMenuItem | null>(null);
  const [optionDraft, setOptionDraft] = useState<Record<string, string[]>>({});
  const [weightDraft, setWeightDraft] = useState("");
  const [orderType, setOrderType] = useState("eat_in");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashTenderedAmount, setCashTenderedAmount] = useState("");
  const [memberLookupInput, setMemberLookupInput] = useState("");
  const [selectedMember, setSelectedMember] = useState<PosMember | null>(null);
  const [memberCoupons, setMemberCoupons] = useState<PosCoupon[]>([]);
  const [selectedCouponId, setSelectedCouponId] = useState("");
  const [customerSelectedCouponId, setCustomerSelectedCouponId] = useState("");
  const [discountPresetKey, setDiscountPresetKey] = useState("");
  const [memberLookupLoading, setMemberLookupLoading] = useState(false);
  const [memberScannerOpen, setMemberScannerOpen] = useState(false);
  const [memberScannerMessage, setMemberScannerMessage] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [reconciliation, setReconciliation] = useState<PosReconciliation>({ businessDate: "", businessState: null, activeSession: null, previousClosedSession: null, sessions: [], movements: [], activeCashResponsibleEmployees: [] });
  const [cashOpeningBreakdown, setCashOpeningBreakdown] = useState(() => createCashBreakdownInput());
  const [cashOpeningNote, setCashOpeningNote] = useState("");
  const [cashMovementType, setCashMovementType] = useState("cash_out");
  const [cashMovementAmount, setCashMovementAmount] = useState("");
  const [cashMovementReason, setCashMovementReason] = useState("");
  const [cashCountedBreakdown, setCashCountedBreakdown] = useState(() => createCashBreakdownInput());
  const [cashClosingNote, setCashClosingNote] = useState("");
  const [cashClosingResponsibleEmployeeId, setCashClosingResponsibleEmployeeId] = useState("");
  const [cashSaving, setCashSaving] = useState(false);
  const [cashDialog, setCashDialog] = useState<"open" | "movement" | "close" | null>(null);
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [transactions, setTransactions] = useState<PosTransaction[]>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<PosTransaction | null>(null);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundSaving, setRefundSaving] = useState(false);
  const [refundingTransactionId, setRefundingTransactionId] = useState("");
  const [completedDisplayState, setCompletedDisplayState] = useState<Record<string, unknown> | null>(null);

  async function loadReconciliation(storeId = selectedStoreId) {
    if (!storeId) return;
    const params = new URLSearchParams({ storeId });
    const response = await fetch(`/api/store/pos/reconciliation?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    setReconciliation({
      businessDate: body.businessDate ?? "",
      businessState: body.businessState ?? null,
      activeSession: body.activeSession ?? null,
      previousClosedSession: body.previousClosedSession ?? null,
      sessions: body.sessions ?? [],
      movements: body.movements ?? [],
      activeCashResponsibleEmployees: body.activeCashResponsibleEmployees ?? []
    });
    setCashClosingResponsibleEmployeeId((current) => {
      const employees = (body.activeCashResponsibleEmployees ?? []) as PosCashResponsibleEmployee[];
      return employees.some((employee) => employee.id === current) ? current : employees[0]?.id ?? "";
    });
  }

  async function load(nextStoreId = selectedStoreId) {
    setLoading(true);
    const params = new URLSearchParams();
    if (nextStoreId) params.set("storeId", nextStoreId);
    const response = await fetch(`/api/store/pos${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
    if (!response.ok) {
      setMessage("POS データを読み込めませんでした。");
      setLoading(false);
      return;
    }
    const body = await response.json();
    const nextAccess = body.access as PosAccess;
    const nextBrands = body.brands as BrandOption[];
    const nextItems = body.items as PosMenuItem[];
    const nextCategories = (body.categories ?? []) as PosMenuCategory[];
    const responseStoreId = body.selectedStoreId || nextAccess.stores?.[0]?.id || "";
    const nextBrandId = nextBrands.some((brand) => brand.id === selectedBrandId)
      ? selectedBrandId
      : nextBrands[0]?.id || "";
    setAccess(nextAccess);
    setStores(nextAccess.stores ?? []);
    setBrands(nextBrands ?? []);
    setCategories(nextCategories);
    setItems(nextItems ?? []);
    setOptionGroups((body.optionGroups ?? []) as PosOptionGroup[]);
    setSummary((body.todaySummary ?? { orderCount: 0, total: 0, average: 0, latestOrders: [] }) as PosSummary);
    const nextPosSettings = {
      dineInEnabled: body.posSettings?.dineInEnabled !== false,
      dineInTaxRate: Number(body.posSettings?.dineInTaxRate ?? 10),
      takeoutTaxRate: Number(body.posSettings?.takeoutTaxRate ?? 8),
      externalPaymentTerminalBrand: body.posSettings?.externalPaymentTerminalBrand ?? "PayCAS",
      priceTaxMode: body.posSettings?.priceTaxMode ?? "tax_included",
      discountPresets: Array.isArray(body.posSettings?.discountPresets) ? body.posSettings.discountPresets : []
    };
    setPosSettings(nextPosSettings);
    setOrderType((current) => nextPosSettings.dineInEnabled ? current : "takeout");
    setSelectedStoreId(responseStoreId);
    if (responseStoreId) setStoredStoreSelection(responseStoreId);
    await loadReconciliation(responseStoreId);
    setSelectedBrandId(nextBrandId);
    setSelectedCategory(null);
    setQuery("");
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    void load(getStoredStoreSelection());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!discountPresetKey) return;
    if (posSettings.discountPresets.some((preset) => preset.enabled && preset.key === discountPresetKey)) return;
    setDiscountPresetKey("");
  }, [discountPresetKey, posSettings.discountPresets]);

  useEffect(() => {
    const hasDialog = Boolean(configuringItem) || transactionDialogOpen || Boolean(cashDialog) || memberScannerOpen;
    if (!hasDialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [cashDialog, configuringItem, memberScannerOpen, transactionDialogOpen]);

  useEffect(() => {
    if (!memberScannerOpen) return;
    let cancelled = false;
    let frameId = 0;

    async function startScanner() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMemberScannerMessage("カメラを利用できません。会員番号または電話番号を入力してください。");
        return;
      }

      try {
        setMemberScannerMessage("会員証の QR をカメラにかざしてください。");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        memberScannerStreamRef.current = stream;
        const video = memberScannerVideoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        memberScannerActiveRef.current = true;
        const scan = () => {
          if (cancelled || !memberScannerActiveRef.current) return;
          try {
            const canvas = memberScannerCanvasRef.current;
            const context = canvas?.getContext("2d", { willReadFrequently: true });
            const width = video.videoWidth;
            const height = video.videoHeight;
            if (!canvas || !context || !width || !height) {
              frameId = window.requestAnimationFrame(scan);
              return;
            }
            canvas.width = width;
            canvas.height = height;
            context.drawImage(video, 0, 0, width, height);
            const imageData = context.getImageData(0, 0, width, height);
            const result = jsQR(imageData.data, width, height);
            const code = result?.data?.trim();
            if (code) {
              memberScannerActiveRef.current = false;
              setMemberScannerMessage("会員 QR を読み取りました。");
              setMemberScannerOpen(false);
              void lookupMember(code);
              return;
            }
          } catch {
            setMemberScannerMessage("QR を読み取れません。角度を変えてもう一度かざしてください。");
          }
          frameId = window.requestAnimationFrame(scan);
        };
        frameId = window.requestAnimationFrame(scan);
      } catch {
        setMemberScannerMessage("カメラを起動できません。権限を確認するか、会員番号または電話番号を入力してください。");
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      memberScannerActiveRef.current = false;
      if (frameId) window.cancelAnimationFrame(frameId);
      memberScannerStreamRef.current?.getTracks().forEach((track) => track.stop());
      memberScannerStreamRef.current = null;
      if (memberScannerVideoRef.current) memberScannerVideoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberScannerOpen]);

  const categorySummaries = useMemo(() => getCategories(items, categories, selectedBrandId), [categories, items, selectedBrandId]);
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (selectedBrandId && item.brandId !== selectedBrandId) return false;
      if (selectedCategory && (item.category || "未分類") !== selectedCategory) return false;
      if (normalizedQuery && !item.name.toLowerCase().includes(normalizedQuery)) return false;
      return true;
    });
  }, [items, query, selectedBrandId, selectedCategory]);
  const visibleOrderTypeOptions = useMemo(
    () => orderTypeOptions.filter((option) => posSettings.dineInEnabled || option.value !== "eat_in"),
    [posSettings.dineInEnabled]
  );

  const subtotal = cart.reduce((sum, item) => sum + getCartItemAmount(item), 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const enabledDiscountPresets = posSettings.discountPresets.filter((preset) => preset.enabled);
  const selectedDiscountPreset = enabledDiscountPresets.find((preset) => preset.key === discountPresetKey);
  const posDiscountAmount = getPosDiscountAmount(selectedDiscountPreset, cart, subtotal);
  const selectedCoupon = memberCoupons.find((coupon) => coupon.id === selectedCouponId);
  const couponBlockedByDiscount = Boolean(selectedDiscountPreset && !selectedDiscountPreset.allowCouponCombination);
  const couponDiscountAmount = couponBlockedByDiscount ? 0 : getCouponDiscountAmount(selectedCoupon, subtotal, getExchangeEligibleBaseAmounts(selectedCoupon));
  const taxRate = getOrderTaxRate(posSettings, orderType);
  const taxSummary = getTaxSummary({
    subtotal,
    discountAmount: posDiscountAmount,
    couponDiscountAmount,
    taxRate,
    priceTaxMode: posSettings.priceTaxMode
  });
  const payableAmount = taxSummary.payableAmount;
  const getMenuDisplayPrice = (item: PosMenuItem) => {
    const price = getItemPrice(item);
    return posSettings.priceTaxMode === "tax_excluded" ? price + Math.floor(price * taxRate / 100) : price;
  };
  const recommendedCoupon = useMemo(() => {
    if (couponBlockedByDiscount || !memberCoupons.length || subtotal <= 0) return undefined;
    return [...memberCoupons].sort((left, right) => getCouponDiscountAmount(right, subtotal, getExchangeEligibleBaseAmounts(right)) - getCouponDiscountAmount(left, subtotal, getExchangeEligibleBaseAmounts(left)))[0];
  }, [cart, couponBlockedByDiscount, memberCoupons, subtotal]);
  const recommendedCouponDiscountAmount = getCouponDiscountAmount(recommendedCoupon, subtotal, getExchangeEligibleBaseAmounts(recommendedCoupon));
  const selectedCouponDiscountAmount = getCouponDiscountAmount(selectedCoupon, subtotal, getExchangeEligibleBaseAmounts(selectedCoupon));
  const canUseRegister = Boolean(reconciliation.activeSession);
  const cashTenderedValue = Number(cashTenderedAmount || 0);
  const cashChangeAmount = paymentMethod === "cash" && cashTenderedAmount.trim() ? cashTenderedValue - payableAmount : null;
  const canCheckout = Boolean(
    cart.length > 0 &&
    !saving &&
    canUseRegister &&
    (paymentMethod !== "cash" || (cashTenderedAmount.trim() !== "" && cashTenderedValue >= payableAmount))
  );
  const canRefundSelectedTransaction = Boolean(
    selectedTransaction &&
    selectedTransaction.status !== "cancelled" &&
    selectedTransaction.paymentStatus !== "refunded" &&
    selectedTransaction.cashSessionStatus === "open"
  );
  const openingBreakdownTotal = getCashBreakdownTotal(cashOpeningBreakdown);
  const countedBreakdownTotal = getCashBreakdownTotal(cashCountedBreakdown);
  const openingHandoverDifference = reconciliation.previousClosedSession
    ? openingBreakdownTotal - Number(reconciliation.previousClosedSession.countedCashAmount ?? 0)
    : null;
  const hasOpeningHandoverDifference = openingHandoverDifference !== null && openingHandoverDifference !== 0;
  const canOpenRegister = !hasOpeningHandoverDifference || Boolean(cashOpeningNote.trim());
  const hasCountedCashInput = Object.values(cashCountedBreakdown).some((value) => value.trim() !== "");
  const closingDifference = !hasCountedCashInput || !reconciliation.activeSession
    ? null
    : countedBreakdownTotal - reconciliation.activeSession.expectedCashAmount;
  const canCloseRegister = Boolean(
    reconciliation.activeSession &&
    hasCountedCashInput &&
    cashClosingResponsibleEmployeeId &&
    (closingDifference === 0 || cashClosingNote.trim())
  );

  function updateCashBreakdown(
    setter: Dispatch<SetStateAction<Record<string, string>>>,
    denomination: number,
    value: string
  ) {
    const normalized = value.replace(/[^\d]/g, "");
    setter((current) => ({ ...current, [String(denomination)]: normalized }));
  }

  function handleStoreChange(storeId: string) {
    setSelectedStoreId(storeId);
    setStoredStoreSelection(storeId);
    setCart([]);
    setCashTenderedAmount("");
    setMemberLookupInput("");
    setSelectedMember(null);
    setMemberCoupons([]);
    setSelectedCouponId("");
    setCustomerSelectedCouponId("");
    setCashOpeningBreakdown(createCashBreakdownInput());
    setCashOpeningNote("");
    setCashCountedBreakdown(createCashBreakdownInput());
    setCashClosingNote("");
    setCashClosingResponsibleEmployeeId("");
    setCashDialog(null);
    setTransactionDialogOpen(false);
    setTransactions([]);
    setSelectedTransaction(null);
    setRefundReason("");
    setRefundingTransactionId("");
    setCompletedDisplayState(null);
    void load(storeId);
  }

  async function lookupMember(scannedCode?: string) {
    const code = (scannedCode ?? memberLookupInput).trim();
    if (!selectedStoreId || !code || memberLookupLoading) return;
    setMemberLookupLoading(true);
    setMessage("");
    setMemberLookupInput(code);
    try {
      const params = new URLSearchParams({ storeId: selectedStoreId, code });
      const response = await fetch(`/api/store/pos/member?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "会員を確認できませんでした。");
      setSelectedMember(body.member as PosMember);
      const coupons = Array.isArray(body.coupons) ? body.coupons as PosCoupon[] : [];
      setMemberCoupons(coupons);
      const scannedCouponId = typeof body.selectedCouponId === "string" ? body.selectedCouponId : "";
      const matchedScannedCouponId = coupons.some((coupon) => coupon.id === scannedCouponId) ? scannedCouponId : "";
      setSelectedCouponId(matchedScannedCouponId);
      setCustomerSelectedCouponId(matchedScannedCouponId);
      setMessage("会員を会計に紐づけました。");
    } catch (error) {
      setSelectedMember(null);
      setMemberCoupons([]);
      setSelectedCouponId("");
      setCustomerSelectedCouponId("");
      setMessage(error instanceof Error ? error.message : "会員を確認できませんでした。");
    } finally {
      setMemberLookupLoading(false);
    }
  }

  function clearSelectedMember() {
    setSelectedMember(null);
    setMemberCoupons([]);
    setSelectedCouponId("");
    setCustomerSelectedCouponId("");
    setMemberLookupInput("");
  }

  function getItemOptionGroups(item: PosMenuItem) {
    const weightPricing = getWeightPricingConfig(item, orderType);
    return optionGroups
      .filter((group) => group.brandId === item.brandId && (!group.menuCatalogItemId || group.menuCatalogItemId === item.id))
      .filter((group) => !weightPricing || isDineInWeightMalatangOptionGroup(group))
      .map((group) => {
        const allowed = asStringArray(item.variableSchema?.[getAllowedRuleKey(group.groupKey)]);
        const options = group.options.filter((option) => !allowed.length || allowed.includes(option.optionKey) || allowed.includes(option.name));
        return { ...group, options };
      })
      .filter((group) => group.options.length);
  }

  function getOptionLabel(options: PosSelectedOption[]) {
    if (!options.length) return "";
    const counts = new Map<string, { option: PosSelectedOption; count: number }>();
    for (const option of options) {
      const key = `${option.groupId}:${option.id}`;
      const current = counts.get(key) ?? { option, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
    return Array.from(counts.values())
      .map(({ option, count }) => `${option.groupName}: ${option.name}${count > 1 ? ` x${count}` : ""}`)
      .join(" / ");
  }

  function getPaymentDisplayLabel(value: string) {
    if (value === "cash") return "現金";
    if (value === "card") return posSettings.externalPaymentTerminalBrand || "外部決済端末";
    if (value === "other") return "その他";
    return value || "-";
  }

  async function publishCustomerDisplayState(state: Record<string, unknown>) {
    if (!selectedStoreId) return;
    await fetch("/api/store/pos/customer-display", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: selectedStoreId, state })
    }).catch(() => undefined);
  }

  function getLineBasePrice(item: PosCartItem) {
    if (item.measuredQuantity && item.measuredUnitPrice) return Math.round(item.measuredQuantity * item.measuredUnitPrice);
    return getItemPrice(item);
  }

  function getLineUnitPrice(item: PosCartItem) {
    return getLineBasePrice(item) + item.optionTotal;
  }

  function getExchangeEligibleBaseAmounts(coupon?: PosCoupon) {
    if (!coupon || !isExchangeCoupon(coupon)) return [];
    return cart.flatMap((item) => {
      if (coupon.brandId && item.brandId !== coupon.brandId) return [];
      const basePrice = item.measuredQuantity ? 0 : getItemPrice(item);
      return Array.from({ length: item.quantity }, () => basePrice).filter((amount) => amount > 0);
    });
  }

  function getWeightLineLabel(item: Pick<PosCartItem, "measuredQuantity" | "measuredUnit" | "measuredUnitPrice">) {
    if (!item.measuredQuantity || !item.measuredUnitPrice) return "";
    return `${item.measuredQuantity.toLocaleString("ja-JP", { maximumFractionDigits: 3 })}${item.measuredUnit || "g"} x ${formatYen(item.measuredUnitPrice)}/${item.measuredUnit || "g"}`;
  }

  function getCartKey(item: PosMenuItem, options: PosSelectedOption[], measuredQuantity: number | null = null, measuredUnitPrice: number | null = null) {
    const optionKey = options.map((option) => `${option.groupId}:${option.id}`).sort().join("|");
    const weightKey = measuredQuantity ? `::${measuredQuantity}:${measuredUnitPrice ?? ""}` : "";
    return `${item.id}::${optionKey}${weightKey}`;
  }

  function addItem(item: PosMenuItem, selectedOptions: PosSelectedOption[] = [], weightInput = "") {
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    const weightPricing = getWeightPricingConfig(item, orderType);
    const measuredQuantity = weightPricing ? Number(weightInput) : 0;
    if (weightPricing) {
      if (!weightPricing.unitPrice || weightPricing.unitPrice <= 0) {
        setMessage(`${item.name} の重量単価が設定されていません。`);
        return;
      }
      if (!Number.isFinite(measuredQuantity) || measuredQuantity <= 0) {
        setMessage(`${item.name} は重量を入力してください。`);
        return;
      }
    }
    const optionTotal = selectedOptions.reduce((sum, option) => sum + getOptionPrice(option), 0);
    const measuredQuantityValue = weightPricing ? Math.round(Number(measuredQuantity) * 1000) / 1000 : null;
    const cartKey = getCartKey(item, selectedOptions, measuredQuantityValue, weightPricing?.unitPrice ?? null);
    setCart((current) => {
      const existing = current.find((entry) => entry.cartKey === cartKey);
      if (existing) {
        return current.map((entry) => entry.cartKey === cartKey ? { ...entry, quantity: entry.quantity + 1 } : entry);
      }
      return [...current, {
        ...item,
        cartKey,
        quantity: 1,
        measuredQuantity: measuredQuantityValue,
        measuredUnit: weightPricing?.unit ?? "",
        measuredUnitPrice: weightPricing?.unitPrice ?? null,
        selectedOptions,
        optionTotal
      }];
    });
  }

  function beginItemSelection(item: PosMenuItem) {
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    const groups = getItemOptionGroups(item);
    if (!groups.length && !getWeightPricingConfig(item, orderType)) {
      addItem(item);
      return;
    }
    const nextDraft: Record<string, string[]> = {};
    for (const group of groups) {
      if (getEffectiveSelectionType(group) === "single" && group.options.length) {
        nextDraft[group.id] = [group.options[0].id];
      } else {
        nextDraft[group.id] = [];
      }
    }
    setConfiguringItem(item);
    setWeightDraft("");
    setOptionDraft(nextDraft);
  }

  function toggleOption(group: PosOptionGroup, optionId: string) {
    setOptionDraft((current) => {
      const selected = current[group.id] ?? [];
      const selectionType = getEffectiveSelectionType(group);
      if (selectionType === "single") {
        return { ...current, [group.id]: [optionId] };
      }
      if (selectionType === "quantity") {
        const limit = getOptionGroupLimit(group);
        if (selected.length >= limit) {
          setMessage(`${group.name} は最大${limit}点までです。`);
          return current;
        }
        return { ...current, [group.id]: [...selected, optionId] };
      }
      return selected.includes(optionId)
        ? { ...current, [group.id]: selected.filter((id) => id !== optionId) }
        : { ...current, [group.id]: [...selected, optionId] };
    });
  }

  function decrementOption(group: PosOptionGroup, optionId: string) {
    setOptionDraft((current) => {
      const selected = current[group.id] ?? [];
      const index = selected.lastIndexOf(optionId);
      if (index < 0) return current;
      return {
        ...current,
        [group.id]: selected.filter((_, selectedIndex) => selectedIndex !== index)
      };
    });
  }

  function addConfiguredItem() {
    if (!configuringItem) return;
    const selectedOptions = getItemOptionGroups(configuringItem).flatMap((group) => {
      const selectedIds = optionDraft[group.id] ?? [];
      const optionsById = new Map(group.options.map((option) => [option.id, option]));
      return selectedIds
        .map((optionId) => optionsById.get(optionId))
        .filter(Boolean)
        .map((option) => ({ ...option, groupId: group.id, groupKey: group.groupKey, groupName: group.name })) as PosSelectedOption[];
    });
    addItem(configuringItem, selectedOptions, weightDraft);
    setConfiguringItem(null);
    setOptionDraft({});
    setWeightDraft("");
  }

  function changeQuantity(cartKey: string, amount: number) {
    setCart((current) => current
      .map((item) => item.cartKey === cartKey ? { ...item, quantity: item.quantity + amount } : item)
      .filter((item) => item.quantity > 0));
  }

  function changeOrderType(nextOrderType: string) {
    if (nextOrderType === orderType) return;
    const needsCartReset = cart.some((item) => (
      Boolean(item.measuredQuantity) ||
      Boolean(getWeightPricingConfig(item, orderType)) ||
      Boolean(getWeightPricingConfig(item, nextOrderType))
    ));
    setOrderType(nextOrderType);
    setConfiguringItem(null);
    setOptionDraft({});
    setWeightDraft("");
    if (needsCartReset) {
      setCart([]);
      setMessage("注文区分を変更したため、重量商品の会計内容をクリアしました。");
    }
  }

  async function checkout() {
    if (!selectedStoreId || cart.length === 0 || saving) return;
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    if (paymentMethod === "cash" && (cashTenderedAmount.trim() === "" || cashTenderedValue < payableAmount)) {
      setMessage("現金会計はお預かり金額を合計以上で入力してください。");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/store/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          orderType,
          paymentMethod,
          cashTenderedAmount: paymentMethod === "cash" ? cashTenderedValue : null,
          memberToken: selectedMember?.publicToken || undefined,
          memberId: selectedMember?.id || undefined,
          memberEmail: selectedMember?.email || undefined,
          memberPhone: selectedMember?.phone || undefined,
          memberName: selectedMember?.displayName || undefined,
          couponId: couponBlockedByDiscount ? undefined : selectedCouponId || undefined,
          discountPresetKey: discountPresetKey || undefined,
          note,
          items: cart.map((item) => ({
            menuCatalogItemId: item.id,
            quantity: item.quantity,
            measuredQuantity: item.measuredQuantity,
            measuredUnit: item.measuredUnit,
            selectedOptions: Object.values(item.selectedOptions.reduce((groups, option) => {
              groups[option.groupId] = groups[option.groupId] ?? { groupId: option.groupId, optionIds: [] };
              groups[option.groupId].optionIds.push(option.id);
              return groups;
            }, {} as Record<string, { groupId: string; optionIds: string[] }>))
          }))
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "checkout failed");
      setCart([]);
      setNote("");
      setCashTenderedAmount("");
      setDiscountPresetKey("");
      clearSelectedMember();
      setSummary(body.todaySummary as PosSummary);
      if (transactionDialogOpen) await loadTransactions();
      await loadReconciliation(selectedStoreId);
      const discountLabel = body.discountAmount ? ` / 学割 -${formatYen(body.discountAmount)}` : "";
      const couponLabel = body.couponDiscountAmount ? ` / クーポン -${formatYen(body.couponDiscountAmount)}` : "";
      const changeLabel = paymentMethod === "cash" ? ` / お釣り ${formatYen(body.cashChangeAmount ?? cashTenderedValue - body.amount)}` : "";
      setMessage(`会計を保存しました。${body.pickupCode} / ${formatYen(body.amount)}${discountLabel}${couponLabel}${changeLabel}`);
      setCompletedDisplayState({
        status: "complete",
        storeName: stores.find((store) => store.id === selectedStoreId)?.name ?? "",
        orderType,
        paymentMethod,
        paymentLabel: getPaymentDisplayLabel(paymentMethod),
        externalPaymentTerminalBrand: posSettings.externalPaymentTerminalBrand,
        pickupCode: body.pickupCode,
        subtotal: body.amount,
        cashTenderedAmount: paymentMethod === "cash" ? cashTenderedValue : null,
        cashChangeAmount: paymentMethod === "cash" ? body.cashChangeAmount ?? cashTenderedValue - body.amount : null,
        items: cart.map((item) => ({
          name: item.name,
          optionLabel: getOptionLabel(item.selectedOptions),
          quantity: item.quantity,
          measuredQuantity: item.measuredQuantity,
          measuredUnit: item.measuredUnit,
          measuredUnitPrice: item.measuredUnitPrice,
          weightLabel: getWeightLineLabel(item),
          unitPrice: getLineUnitPrice(item),
          amount: getLineUnitPrice(item) * item.quantity
        }))
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会計を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!selectedStoreId || !canUseRegister) return;
    if (completedDisplayState) {
      void publishCustomerDisplayState(completedDisplayState);
      const timer = window.setTimeout(() => setCompletedDisplayState(null), 9000);
      return () => window.clearTimeout(timer);
    }
    const status = cart.length === 0
      ? "idle"
      : paymentMethod === "cash"
        ? cashTenderedAmount.trim() && cashChangeAmount !== null && cashChangeAmount >= 0
          ? "cash_change"
          : "editing"
        : "external_wait";
    const timer = window.setTimeout(() => {
      void publishCustomerDisplayState({
        status,
        storeName: stores.find((store) => store.id === selectedStoreId)?.name ?? "",
        orderType,
        paymentMethod,
        paymentLabel: getPaymentDisplayLabel(paymentMethod),
        externalPaymentTerminalBrand: posSettings.externalPaymentTerminalBrand,
        pickupCode: "",
        subtotal: payableAmount,
        cashTenderedAmount: paymentMethod === "cash" && cashTenderedAmount.trim() ? cashTenderedValue : null,
        cashChangeAmount: paymentMethod === "cash" && cashChangeAmount !== null ? cashChangeAmount : null,
        items: cart.map((item) => ({
          name: item.name,
          optionLabel: getOptionLabel(item.selectedOptions),
          quantity: item.quantity,
          measuredQuantity: item.measuredQuantity,
          measuredUnit: item.measuredUnit,
          measuredUnitPrice: item.measuredUnitPrice,
          weightLabel: getWeightLineLabel(item),
          unitPrice: getLineUnitPrice(item),
          amount: getLineUnitPrice(item) * item.quantity
        }))
      });
    }, 180);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, cashTenderedAmount, completedDisplayState, orderType, paymentMethod, posSettings.externalPaymentTerminalBrand, selectedStoreId, payableAmount, canUseRegister]);

  async function submitCashAction(action: "open" | "movement" | "close") {
    if (!selectedStoreId || cashSaving) return;
    setCashSaving(true);
    setMessage("");
    try {
      const payload = action === "open"
        ? { action, storeId: selectedStoreId, openingBreakdown: cashOpeningBreakdown, note: cashOpeningNote }
        : action === "movement"
          ? {
              action,
              storeId: selectedStoreId,
              movementType: cashMovementType,
              amount: Number(cashMovementAmount || 0),
              reason: cashMovementReason
            }
          : {
              action,
              storeId: selectedStoreId,
              countedBreakdown: cashCountedBreakdown,
              note: cashClosingNote,
              closingResponsibleEmployeeId: cashClosingResponsibleEmployeeId
            };
      const response = await fetch("/api/store/pos/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "レジ締めを保存できませんでした。");
      setReconciliation({
        businessDate: body.businessDate ?? reconciliation.businessDate,
        businessState: body.businessState ?? reconciliation.businessState,
        activeSession: body.activeSession ?? null,
        previousClosedSession: body.previousClosedSession ?? reconciliation.previousClosedSession,
        sessions: body.sessions ?? [],
        movements: body.movements ?? [],
        activeCashResponsibleEmployees: body.activeCashResponsibleEmployees ?? reconciliation.activeCashResponsibleEmployees
      });
      if (action === "open") {
        setCashOpeningBreakdown(createCashBreakdownInput());
        setCashOpeningNote("");
        setCashDialog(null);
        setMessage("日次レジ締めを開始しました。");
      } else if (action === "movement") {
        setCashMovementAmount("");
        setCashMovementReason("");
        setCashDialog(null);
        setMessage(cashMovementType === "cash_in" ? "入金を記録しました。" : "出金を記録しました。");
      } else {
        setCashCountedBreakdown(createCashBreakdownInput());
        setCashClosingNote("");
        setCashClosingResponsibleEmployeeId("");
        setCashDialog(null);
        setMessage("日次レジ締めを締めました。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "レジ締めを保存できませんでした。");
    } finally {
      setCashSaving(false);
    }
  }

  async function loadTransactions(orderId = selectedTransaction?.id ?? "") {
    if (!selectedStoreId) return;
    setTransactionLoading(true);
    try {
      const params = new URLSearchParams({ storeId: selectedStoreId });
      if (orderId) params.set("orderId", orderId);
      const response = await fetch(`/api/store/pos/transactions?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "取引履歴を読み込めませんでした。");
      const nextTransactions = (body.transactions ?? []) as PosTransaction[];
      setTransactions(nextTransactions);
      setSelectedTransaction((body.selectedTransaction ?? null) as PosTransaction | null);
      setRefundReason("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取引履歴を読み込めませんでした。");
    } finally {
      setTransactionLoading(false);
    }
  }

  async function openTransactionDialog() {
    setTransactionDialogOpen(true);
    await loadTransactions("");
  }

  async function selectTransaction(orderId: string) {
    await loadTransactions(orderId);
  }

  async function refundTransaction() {
    if (!selectedStoreId || !selectedTransaction || refundSaving) return;
    const refundingId = selectedTransaction.id;
    setRefundSaving(true);
    setRefundingTransactionId(refundingId);
    setMessage("");
    try {
      const response = await fetch("/api/store/pos/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStoreId, orderId: refundingId, reason: refundReason })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "返金を保存できませんでした。");
      setTransactions((body.transactions ?? []) as PosTransaction[]);
      setSelectedTransaction((body.selectedTransaction ?? null) as PosTransaction | null);
      setSummary((current) => ({ ...current, ...(body.todaySummary ?? {}) }));
      setRefundReason("");
      await loadReconciliation(selectedStoreId);
      setMessage(`返金を記録しました。${selectedTransaction.pickupCode} / ${formatYen(selectedTransaction.amount)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "返金を保存できませんでした。");
    } finally {
      setRefundSaving(false);
      setRefundingTransactionId("");
    }
  }

  const configuringWeightPricing = configuringItem ? getWeightPricingConfig(configuringItem, orderType) : null;
  const configuringWeightQuantity = Number(weightDraft);
  const configuringWeightBasePrice = configuringWeightPricing?.unitPrice && Number.isFinite(configuringWeightQuantity) && configuringWeightQuantity > 0
    ? Math.round(configuringWeightQuantity * configuringWeightPricing.unitPrice)
    : 0;
  const selectedOptionPreviewTotal = configuringItem
    ? getItemOptionGroups(configuringItem).reduce((sum, group) => {
        const optionsById = new Map(group.options.map((option) => [option.id, option]));
        return sum + (optionDraft[group.id] ?? []).reduce((groupSum, optionId) => groupSum + getOptionPrice(optionsById.get(optionId) ?? { priceDelta: 0 }), 0);
      }, 0)
    : 0;
  const canAddConfiguredItem = !configuringWeightPricing ||
    Boolean(configuringWeightPricing.unitPrice && configuringWeightPricing.unitPrice > 0 && Number.isFinite(configuringWeightQuantity) && configuringWeightQuantity > 0);

  return (
    <main className="store-workbench-shell store-pos-page">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 STORE</p>
            <h1>POS</h1>
          </div>
        </a>
        <StoreNavTabs active="pos" />
      </header>

      <section className="store-pos-head">
        <div>
          <p className="eyebrow">レジ</p>
          <h2>店頭会計</h2>
        </div>
        <div className="store-pos-head-actions">
          <label className="store-pos-store-select">
            <span>店舗</span>
            <select
              value={selectedStoreId}
              onChange={(event) => handleStoreChange(event.target.value)}
              disabled={!access?.canUseAllStoreView && stores.length <= 1}
            >
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </label>
          <div className="store-pos-summary">
            <span>本日 {summary.orderCount} 件</span>
            <strong>{formatYen(summary.total)}</strong>
            <small>平均 {formatYen(summary.average)}</small>
          </div>
        </div>
      </section>

      {message ? <div className="action-notice store-pos-notice">{message}</div> : null}

      <section className={`store-pos-cash-strip ${reconciliation.activeSession ? "is-open" : "is-locked"}`}>
        <div>
          <span>レジ状態</span>
          <strong>{reconciliation.activeSession ? "開店済み" : "未開店"}</strong>
          <small>
            {reconciliation.activeSession ? (
              <>
                <span>開店 {formatDateTime(reconciliation.activeSession.openedAt) || "-"}</span>
                <span>担当 {reconciliation.activeSession.openedByName || "-"}</span>
              </>
            ) : reconciliation.previousClosedSession ? (
              <>
                <span>前回閉店 {formatDateTime(reconciliation.previousClosedSession.closedAt) || reconciliation.previousClosedSession.businessDate}</span>
                <span>担当 {reconciliation.previousClosedSession.closedByName || "-"}</span>
              </>
            ) : reconciliation.businessState ? (
              `${reconciliation.businessState.statusLabel} / 営業日 ${reconciliation.businessState.businessDate}`
            ) : reconciliation.businessDate || "-"}
          </small>
        </div>
        <div>
          <span>システム上の現金</span>
          <strong>{reconciliation.activeSession ? formatYen(reconciliation.activeSession.expectedCashAmount) : "-"}</strong>
          <small>
            {reconciliation.activeSession ? (
              <>
                <span>開始 {formatYen(reconciliation.activeSession.openingAmount)} / 現金売上 {formatYen(reconciliation.activeSession.cashSales)}</span>
                <span>営業日 {reconciliation.activeSession.businessDate}</span>
              </>
            ) : (
              "開店確認後に POS 会計を開始できます。"
            )}
          </small>
        </div>
        <div className="store-pos-cash-strip-actions">
          {reconciliation.activeSession ? (
            <>
              <button className="secondary-button" type="button" onClick={() => setCashDialog("movement")}>入出金</button>
              <button className="primary-button" type="button" onClick={() => setCashDialog("close")}>レジ締め</button>
            </>
          ) : (
            <button className="primary-button" type="button" onClick={() => setCashDialog("open")}>開店確認</button>
          )}
        </div>
      </section>

      <section className="store-pos-layout">
        <div className="store-pos-menu-panel">
          <aside className="store-pos-filter-panel">
            <div className="store-pos-filter-group">
              <span>ブランド</span>
              <div className="store-pos-filter-list">
                {brands.map((brand) => (
                  <button
                    key={brand.id}
                    className={selectedBrandId === brand.id ? "is-active" : ""}
                    type="button"
                    onClick={() => {
                      setSelectedBrandId(brand.id);
                      setSelectedCategory(null);
                      setQuery("");
                    }}
                  >
                    {brand.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="store-pos-filter-group">
              <span>分類</span>
              <div className="store-pos-filter-list">
                <button className={!selectedCategory ? "is-active" : ""} type="button" onClick={() => setSelectedCategory(null)}>
                  すべて
                  <small>{items.filter((item) => !selectedBrandId || item.brandId === selectedBrandId).length}</small>
                </button>
                {categorySummaries.map((category) => (
                  <button
                    key={category.name}
                    className={selectedCategory === category.name ? "is-active" : ""}
                    type="button"
                    onClick={() => setSelectedCategory(category.name)}
                  >
                    {category.name}
                    <small>{category.count}</small>
                  </button>
                ))}
              </div>
            </div>

            <label className="store-pos-search">
              <span>検索</span>
              <div>
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名" />
              </div>
            </label>
          </aside>

          <section className="store-pos-product-panel">
            <div className="store-pos-product-head">
              <div>
                <p className="eyebrow">Products</p>
                <h3>商品を選択</h3>
              </div>
              <span>{visibleItems.length} 件</span>
            </div>
            {!canUseRegister ? (
              <div className="store-pos-lock-notice">
                開店前のレジ金額を確認すると商品選択を開始できます。
              </div>
            ) : null}

            {loading ? (
              <div className="store-pos-empty">読み込み中...</div>
            ) : visibleItems.length === 0 ? (
              <div className="store-pos-empty">POS で販売できる商品がありません。</div>
            ) : (
              <div className="store-pos-item-grid">
                {visibleItems.map((item) => (
                  <button key={item.id} className="store-pos-item-button" type="button" onClick={() => beginItemSelection(item)} disabled={!canUseRegister}>
                    {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="store-pos-image-empty">F1</span>}
                    <div className="store-pos-item-info">
                      <span>{item.category || item.brandName}</span>
                      <strong>{item.name}</strong>
                      <em>{formatWeightPrice(item, orderType) || `${formatYen(getMenuDisplayPrice(item))}${posSettings.priceTaxMode === "tax_excluded" ? " 税込" : ""}`}</em>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="store-pos-cart-panel">
          <div className="store-pos-cart-head">
            <div>
              <p className="eyebrow">Cart</p>
              <h3>会計内容</h3>
            </div>
            <div className="store-pos-cart-head-actions">
              <button className="secondary-button" type="button" onClick={() => void openTransactionDialog()}>履歴</button>
              <strong>{cartCount} 点</strong>
            </div>
          </div>

          <div className="store-pos-segmented">
            {visibleOrderTypeOptions.map((option) => (
              <button key={option.value} className={orderType === option.value ? "is-active" : ""} type="button" onClick={() => changeOrderType(option.value)}>
                {option.label}
              </button>
            ))}
          </div>

          <div className="store-pos-cart-list">
            {cart.length === 0 ? (
              <div className="store-pos-empty">商品を選択してください。</div>
            ) : cart.map((item) => (
              <div key={item.cartKey} className="store-pos-cart-row">
                <div>
                  <strong>{item.name}</strong>
                  {getWeightLineLabel(item) ? <small>{getWeightLineLabel(item)}</small> : null}
                  {item.selectedOptions.length ? <small>{getOptionLabel(item.selectedOptions)}</small> : null}
                  <span>{formatYen(getLineUnitPrice(item))}{item.measuredQuantity ? "" : ` x ${item.quantity}`}</span>
                </div>
                <div className="store-pos-quantity">
                  {!item.measuredQuantity ? (
                    <>
                      <button type="button" onClick={() => changeQuantity(item.cartKey, -1)} aria-label="数量を減らす"><Minus size={16} /></button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => changeQuantity(item.cartKey, 1)} aria-label="数量を増やす"><Plus size={16} /></button>
                    </>
                  ) : null}
                  <button type="button" onClick={() => changeQuantity(item.cartKey, -99)} aria-label="削除"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>

          <div className={selectedMember ? "store-pos-member-panel is-linked" : "store-pos-member-panel"}>
            <div className="store-pos-member-title">
              <div>
                <UserRound size={16} />
                <span>会員</span>
              </div>
              {selectedMember ? (
                <button type="button" onClick={clearSelectedMember} aria-label="会員を解除">
                  <X size={14} />
                </button>
              ) : null}
            </div>
            {selectedMember ? (
              <>
                <div className="store-pos-member-card">
                  <strong>{selectedMember.displayName || selectedMember.email || selectedMember.memberNumber}</strong>
                  <span>{selectedMember.memberNumber} / {selectedMember.pointBalance.toLocaleString("ja-JP")} pt</span>
                </div>
                {memberCoupons.length ? (
                  <div className="store-pos-coupon-panel">
                    <div className="store-pos-coupon-head">
                      <span><Gift size={14} /> 利用可能クーポン</span>
                      {recommendedCoupon && recommendedCoupon.id !== selectedCouponId && recommendedCouponDiscountAmount > selectedCouponDiscountAmount ? (
                        <button type="button" onClick={() => setSelectedCouponId(recommendedCoupon.id)}>
                          おすすめを適用
                        </button>
                      ) : null}
                    </div>
                    {recommendedCoupon && recommendedCoupon.id !== selectedCouponId && recommendedCouponDiscountAmount > selectedCouponDiscountAmount ? (
                      <p className="store-pos-coupon-recommend">
                        {recommendedCoupon.name} の方が {formatYen(recommendedCouponDiscountAmount - selectedCouponDiscountAmount)} お得です。
                      </p>
                    ) : null}
                    <div className="store-pos-coupon-list">
                      {memberCoupons.map((coupon) => {
                        const discount = getCouponDiscountAmount(coupon, subtotal, getExchangeEligibleBaseAmounts(coupon));
                        const isSelected = selectedCouponId === coupon.id;
                        const isRecommended = recommendedCoupon?.id === coupon.id && discount > 0;
                        const isCustomerSelected = customerSelectedCouponId === coupon.id;
                        const isUnavailable = couponBlockedByDiscount || (subtotal > 0 && discount <= 0);
                        const couponBadges = [
                          couponBlockedByDiscount ? "割引中は併用不可" : "",
                          isCustomerSelected ? "客さま選択済み" : "",
                          isRecommended ? "おすすめ" : ""
                        ].filter(Boolean);
                        return (
                          <button
                            key={coupon.id}
                            className={[
                              "store-pos-coupon-choice",
                              isSelected ? "is-selected" : "",
                              isCustomerSelected ? "is-customer-selected" : "",
                              isRecommended ? "is-recommended" : ""
                            ].filter(Boolean).join(" ")}
                            type="button"
                            disabled={isUnavailable}
                            onClick={() => setSelectedCouponId((current) => current === coupon.id ? "" : coupon.id)}
                          >
                            <span>
                              <strong>{coupon.name}</strong>
                              <small>{getCouponScopeLabel(coupon)} / {coupon.couponCode} / {getCouponValueLabel(coupon)}{couponBadges.length ? ` / ${couponBadges.join(" / ")}` : ""}</small>
                            </span>
                            <b>{getCouponPosStatusLabel(coupon, discount, subtotal)}</b>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <small className="store-pos-member-empty-coupon">利用可能クーポンはありません。</small>
                )}
              </>
            ) : (
              <div className="store-pos-member-lookup-wrap">
                <div className="store-pos-member-lookup">
                  <ScanLine size={16} />
                  <input
                    value={memberLookupInput}
                    onChange={(event) => setMemberLookupInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void lookupMember();
                      }
                    }}
                    placeholder="会員番号 / 電話番号 / メール / QR"
                    inputMode="text"
                  />
                  <button className="secondary-button" type="button" onClick={() => void lookupMember()} disabled={!memberLookupInput.trim() || memberLookupLoading}>
                    {memberLookupLoading ? "確認中" : "確認"}
                  </button>
                  <button className="secondary-button store-pos-member-scan-button" type="button" onClick={() => setMemberScannerOpen(true)}>
                    <Camera size={15} />
                    読取
                  </button>
                </div>
                <small>会員証 QR を読むか、電話番号を入力して確認できます。</small>
              </div>
            )}
          </div>

          <label className="store-pos-note">
            <span>メモ</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="任意" />
          </label>

          <div className="store-pos-discount-panel">
            <span>割引</span>
            {enabledDiscountPresets.length ? enabledDiscountPresets.map((preset) => {
              const discount = getPosDiscountAmount(preset, cart, subtotal);
              const isActive = discountPresetKey === preset.key;
              return (
                <button
                  key={preset.key}
                  className={isActive ? "is-active" : ""}
                  type="button"
                  disabled={subtotal > 0 && discount <= 0}
                  onClick={() => {
                    setDiscountPresetKey((current) => current === preset.key ? "" : preset.key);
                    if (!preset.allowCouponCombination) setSelectedCouponId("");
                  }}
                >
                  {preset.name}
                  {discount > 0 ? ` -${formatYen(discount)}` : ""}
                </button>
              );
            }) : <small>設定済みの割引はありません。</small>}
            {selectedDiscountPreset ? (
              <small>
                {getDiscountTargetLabel(selectedDiscountPreset)}
                {selectedDiscountPreset.allowCouponCombination ? " / クーポン併用可" : " / クーポン併用不可"}
                {selectedDiscountPreset.stampEligible ? " / スタンプ対象" : " / スタンプ対象外"}
              </small>
            ) : null}
          </div>

          <div className="store-pos-payment-grid">
            {paymentOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  className={paymentMethod === option.value ? "is-active" : ""}
                  type="button"
                  onClick={() => setPaymentMethod(option.value)}
                >
                  <Icon size={18} />
                  {option.value === "card" ? getPaymentDisplayLabel(option.value) : option.label}
                </button>
              );
            })}
          </div>

          {paymentMethod !== "cash" ? (
            <div className="store-pos-external-payment">
              <span>{getPaymentDisplayLabel(paymentMethod)}</span>
              <strong>端末の決済完了画面を確認してから会計を確定してください。</strong>
            </div>
          ) : null}

          {paymentMethod === "cash" ? (
            <div className="store-pos-cash-payment">
              <label>
                <span>お預かり</span>
                <input
                  inputMode="numeric"
                  value={cashTenderedAmount}
                  onChange={(event) => setCashTenderedAmount(event.target.value.replace(/[^\d]/g, ""))}
                  placeholder="0"
                />
              </label>
              <div className={cashChangeAmount !== null && cashChangeAmount < 0 ? "is-short" : ""}>
                <span>お釣り</span>
                <strong>{cashChangeAmount === null ? "-" : formatYen(Math.max(0, cashChangeAmount))}</strong>
                {cashChangeAmount !== null && cashChangeAmount < 0 ? <small>不足 {formatYen(Math.abs(cashChangeAmount))}</small> : null}
              </div>
            </div>
          ) : null}

          <div className="store-pos-total">
            <span>{posSettings.priceTaxMode === "tax_excluded" ? "小計" : "合計"}</span>
            <strong>{formatYen(subtotal)}</strong>
            {posDiscountAmount ? (
              <>
                <span>学割</span>
                <strong className="is-discount">-{formatYen(posDiscountAmount)}</strong>
              </>
            ) : null}
            {couponDiscountAmount ? (
              <>
                <span>クーポン</span>
                <strong className="is-discount">-{formatYen(couponDiscountAmount)}</strong>
              </>
            ) : null}
            {subtotal > 0 ? (
              <>
                <span>{posSettings.priceTaxMode === "tax_excluded" ? `消費税 ${taxRate}%` : `内消費税 ${taxRate}%`}</span>
                <strong className="is-tax">{formatYen(taxSummary.taxAmount)}</strong>
              </>
            ) : null}
            {posSettings.priceTaxMode === "tax_excluded" || posDiscountAmount || couponDiscountAmount ? (
              <>
                <span>お会計</span>
                <strong>{formatYen(payableAmount)}</strong>
              </>
            ) : null}
          </div>
          <button className="primary-button store-pos-checkout" type="button" onClick={checkout} disabled={!canCheckout}>
            {saving ? "保存中..." : "会計を確定"}
          </button>
        </aside>
      </section>

      {memberScannerOpen ? (
        <div className="store-pos-scanner-overlay" role="dialog" aria-modal="true" aria-label="会員 QR 読取">
          <div className="store-pos-scanner-dialog">
            <div className="store-pos-scanner-head">
              <div>
                <p className="eyebrow">Member QR</p>
                <h3>会員 QR 読取</h3>
                <span>客さまの会員証 QR をカメラにかざしてください。</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setMemberScannerOpen(false)}>閉じる</button>
            </div>
            <div className="store-pos-scanner-video">
              <video ref={memberScannerVideoRef} playsInline muted />
              <canvas ref={memberScannerCanvasRef} aria-hidden="true" />
              <div className="store-pos-scanner-frame" aria-hidden="true" />
            </div>
            <p className="store-pos-scanner-message">{memberScannerMessage || "カメラを準備しています。"}</p>
            <div className="store-pos-scanner-fallback">
              <ScanLine size={16} />
              <span>読み取れない場合は、会員番号または電話番号を入力してください。</span>
            </div>
          </div>
        </div>
      ) : null}

      {transactionDialogOpen ? (
        <div className="store-pos-transaction-overlay" role="dialog" aria-modal="true" aria-label="取引履歴">
          <div className="store-pos-transaction-dialog">
            <div className="store-pos-transaction-head">
              <div>
                <p className="eyebrow">Transactions</p>
                <h3>取引履歴</h3>
                <span>最近 7 日間の POS 会計を確認します。</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setTransactionDialogOpen(false)}>閉じる</button>
            </div>

            <div className="store-pos-transaction-body">
              <aside className="store-pos-transaction-list">
                {transactionLoading && transactions.length === 0 ? (
                  <div className="store-pos-empty">読み込み中...</div>
                ) : transactions.length === 0 ? (
                  <div className="store-pos-empty">取引履歴がありません。</div>
                ) : transactions.map((transaction) => (
                  <button
                    key={transaction.id}
                    className={[
                      selectedTransaction?.id === transaction.id ? "is-active" : "",
                      transaction.status === "cancelled" || transaction.paymentStatus === "refunded" ? "is-refunded" : "",
                      refundingTransactionId === transaction.id ? "is-processing" : ""
                    ].filter(Boolean).join(" ")}
                    type="button"
                    onClick={() => void selectTransaction(transaction.id)}
                  >
                    <div>
                      <strong>{transaction.pickupCode}</strong>
                      <span>{transaction.createdLabel} / {getPaymentLabel(transaction.paymentMethod)}</span>
                    </div>
                    <div>
                      <b>{formatYen(transaction.amount)}</b>
                      <small>{refundingTransactionId === transaction.id ? "返金処理中..." : getTransactionStatusLabel(transaction)}</small>
                    </div>
                  </button>
                ))}
              </aside>

              <section className="store-pos-transaction-detail">
                {!selectedTransaction ? (
                  <div className="store-pos-empty">会計を選択してください。</div>
                ) : (
                  <>
                    <div className="store-pos-transaction-scroll">
                      <div className="store-pos-transaction-summary">
                        <div>
                          <span>会計番号</span>
                          <strong>{selectedTransaction.pickupCode}</strong>
                        </div>
                        <div>
                          <span>合計</span>
                          <strong>{formatYen(selectedTransaction.amount)}</strong>
                        </div>
                        <div>
                          <span>状態</span>
                          <strong>{getTransactionStatusLabel(selectedTransaction)}</strong>
                        </div>
                      </div>

                      <div className="store-pos-transaction-meta">
                        <span>{selectedTransaction.createdLabel}</span>
                        <span>{getPaymentLabel(selectedTransaction.paymentMethod)}</span>
                        {selectedTransaction.orderType ? <span>{getOrderTypeLabel(selectedTransaction.orderType)}</span> : null}
                        <span>担当 {selectedTransaction.cashierName || "-"}</span>
                      </div>

                      {selectedTransaction.paymentMethod === "cash" ? (
                        <div className="store-pos-transaction-cash">
                          <span>お預かり {selectedTransaction.cashTenderedAmount === null ? "-" : formatYen(selectedTransaction.cashTenderedAmount)}</span>
                          <span>お釣り {selectedTransaction.cashChangeAmount === null ? "-" : formatYen(selectedTransaction.cashChangeAmount)}</span>
                        </div>
                      ) : null}

                      <div className="store-pos-transaction-items">
                        {(selectedTransaction.items ?? []).map((item) => {
                          const modifiers = [
                            item.size,
                            item.temperature,
                            item.sweetness,
                            item.ice,
                            item.option,
                            ...(item.toppings ?? [])
                          ].filter(Boolean);
                          const weightLabel = item.measuredQuantity && item.measuredUnitPrice
                            ? `${item.measuredQuantity.toLocaleString("ja-JP", { maximumFractionDigits: 3 })}${item.measuredUnit || "g"} x ${formatYen(item.measuredUnitPrice)}/${item.measuredUnit || "g"}`
                            : "";
                          return (
                            <div key={item.id}>
                              <div>
                                <strong>{item.name}</strong>
                                {weightLabel ? <small>{weightLabel}</small> : null}
                                {modifiers.length ? <small>{modifiers.join(" / ")}</small> : null}
                                <span>{weightLabel ? formatYen(item.amount) : `${formatYen(Math.round(item.amount / Math.max(1, item.quantity)))} x ${item.quantity}`}</span>
                              </div>
                              <b>{formatYen(item.amount)}</b>
                            </div>
                          );
                        })}
                      </div>

                      {selectedTransaction.note ? (
                        <div className="store-pos-transaction-note">
                          <span>メモ</span>
                          <p>{selectedTransaction.note}</p>
                        </div>
                      ) : null}
                    </div>
                    <div className="store-pos-refund-panel">
                      <div>
                        <strong>返金操作</strong>
                        <span>
                          {refundSaving && refundingTransactionId === selectedTransaction.id
                            ? "返金を処理しています。画面を閉じずにお待ちください。"
                            : canRefundSelectedTransaction
                            ? "返金するとこの会計は売上と現金集計から除外されます。"
                            : selectedTransaction.cashSessionStatus !== "open"
                              ? "締め済みのレジ会計は管理画面で修正してください。"
                              : "この会計はすでに返金済みです。"}
                        </span>
                      </div>
                      {selectedTransaction.refundReason ? <small>返金理由: {selectedTransaction.refundReason}</small> : null}
                      <label>
                        <span>理由</span>
                        <input value={refundReason} onChange={(event) => setRefundReason(event.target.value)} placeholder="任意" disabled={!canRefundSelectedTransaction || refundSaving} />
                      </label>
                      <button className="danger-button" type="button" onClick={() => void refundTransaction()} disabled={!canRefundSelectedTransaction || refundSaving}>
                        {refundSaving && refundingTransactionId === selectedTransaction.id
                          ? "返金処理中..."
                          : canRefundSelectedTransaction
                            ? "返金を記録"
                            : "返金済み"}
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {cashDialog ? (
        <div className="store-pos-cash-overlay" role="dialog" aria-modal="true" aria-label="レジ操作">
          <div className="store-pos-cash-dialog">
            <div className="store-pos-cash-dialog-head">
              <div>
                <p className="eyebrow">Daily Cash</p>
                <h3>{cashDialog === "open" ? "開店確認" : cashDialog === "movement" ? "入出金" : "レジ締め"}</h3>
                <span>{reconciliation.businessState?.detailLabel ?? reconciliation.businessDate}</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setCashDialog(null)}>閉じる</button>
            </div>

            {cashDialog === "open" ? (
              <div className="store-pos-cash-start">
                <ReceiptText size={18} />
                <div>
                  <strong>開店前のレジ金額を確認してください。</strong>
                  <span>面額ごとの枚数を選ぶと開始金額を自動計算します。</span>
                </div>
                {reconciliation.previousClosedSession ? (
                  <div className={`store-pos-handover-summary ${hasOpeningHandoverDifference ? "is-warning" : ""}`}>
                    <span>前回閉店 {reconciliation.previousClosedSession.businessDate}</span>
                    <strong>{formatYen(reconciliation.previousClosedSession.countedCashAmount)}</strong>
                    <small>
                      {hasOpeningHandoverDifference
                        ? `引継ぎ差額 ${formatYen(openingHandoverDifference ?? 0)}`
                        : "前回閉店金額と一致しています。"}
                    </small>
                  </div>
                ) : null}
                <div className="store-pos-denomination-panel">
                  <div className="store-pos-denomination-head">
                    <span>開始金額</span>
                    <strong>{formatYen(openingBreakdownTotal)}</strong>
                  </div>
                  <div className="store-pos-denomination-grid">
                    {yenDenominations.map((denomination) => (
                      <label key={denomination}>
                        <span>{formatDenominationLabel(denomination)}</span>
                        <select
                          value={cashOpeningBreakdown[String(denomination)] ?? ""}
                          onChange={(event) => updateCashBreakdown(setCashOpeningBreakdown, denomination, event.target.value)}
                        >
                          {denominationCountOptions.map((count) => <option key={count.value || "zero"} value={count.value}>{count.label}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
                {hasOpeningHandoverDifference ? (
                  <label className="store-pos-handover-note">
                    <span>引継ぎ差額理由</span>
                    <input value={cashOpeningNote} onChange={(event) => setCashOpeningNote(event.target.value)} placeholder="例: 両替済み、前日回収、確認差額" />
                  </label>
                ) : null}
                <button className="primary-button" type="button" onClick={() => submitCashAction("open")} disabled={cashSaving || !canOpenRegister}>
                  開始
                </button>
              </div>
            ) : null}

            {cashDialog === "movement" ? (
              <div className="store-pos-cash-actions">
                <label>
                  <span>入出金</span>
                  <select value={cashMovementType} onChange={(event) => setCashMovementType(event.target.value)}>
                    <option value="cash_out">出金</option>
                    <option value="cash_in">入金</option>
                  </select>
                </label>
                <label>
                  <span>金額</span>
                  <input inputMode="numeric" value={cashMovementAmount} onChange={(event) => setCashMovementAmount(event.target.value)} placeholder="0" />
                </label>
                <label>
                  <span>理由</span>
                  <input value={cashMovementReason} onChange={(event) => setCashMovementReason(event.target.value)} placeholder="例: 両替、備品購入" />
                </label>
                <button className="secondary-button" type="button" onClick={() => submitCashAction("movement")} disabled={cashSaving}>
                  記録
                </button>
              </div>
            ) : null}

            {cashDialog === "close" && reconciliation.activeSession ? (
              <div className="store-pos-cash-close">
                <div className="store-pos-close-summary">
                  <span>閉店チェック</span>
                  <strong>システム上の現金 {formatYen(reconciliation.activeSession.expectedCashAmount)}</strong>
                  <small>
                    {closingDifference === null
                      ? "実際の現金を入力してください。"
                      : `差額 ${formatYen(closingDifference)}`}
                  </small>
                </div>
                <div className="store-pos-denomination-panel">
                  <div className="store-pos-denomination-head">
                    <span>実際の現金</span>
                    <strong>{formatYen(countedBreakdownTotal)}</strong>
                  </div>
                  <div className="store-pos-denomination-grid">
                    {yenDenominations.map((denomination) => (
                      <label key={denomination}>
                        <span>{formatDenominationLabel(denomination)}</span>
                        <select
                          value={cashCountedBreakdown[String(denomination)] ?? ""}
                          onChange={(event) => updateCashBreakdown(setCashCountedBreakdown, denomination, event.target.value)}
                        >
                          {denominationCountOptions.map((count) => <option key={count.value || "zero"} value={count.value}>{count.label}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
                <label>
                  <span>締め責任者</span>
                  <select value={cashClosingResponsibleEmployeeId} onChange={(event) => setCashClosingResponsibleEmployeeId(event.target.value)}>
                    {reconciliation.activeCashResponsibleEmployees.length === 0 ? (
                      <option value="">出勤中の従業員がいません</option>
                    ) : (
                      reconciliation.activeCashResponsibleEmployees.map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.name}</option>
                      ))
                    )}
                  </select>
                </label>
                <label>
                  <span>差額理由</span>
                  <input value={cashClosingNote} onChange={(event) => setCashClosingNote(event.target.value)} placeholder={closingDifference ? "差額がある場合は必須" : "任意"} />
                </label>
                <button className="primary-button" type="button" onClick={() => submitCashAction("close")} disabled={cashSaving || !canCloseRegister}>
                  レジ締め
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {configuringItem ? (
        <div className="store-pos-option-overlay" role="dialog" aria-modal="true" aria-label="商品オプション">
          <div className="store-pos-option-panel">
            <div className="store-pos-option-head">
              <div>
                <p className="eyebrow">Options</p>
                <h3>{configuringItem.name}</h3>
                <span>{configuringWeightPricing ? `重量単価 ${formatWeightPrice(configuringItem, orderType)}` : `基本価格 ${formatYen(getItemPrice(configuringItem))}`}</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setConfiguringItem(null)}>閉じる</button>
            </div>

            {configuringWeightPricing ? (
              <section className="store-pos-weight-entry">
                <div>
                  <strong>自選食材の重量</strong>
                  <span>{configuringWeightPricing.unitPrice ? `${formatYen(configuringWeightPricing.unitPrice)}/${configuringWeightPricing.unit}` : "重量単価未設定"}</span>
                </div>
                <label>
                  <input
                    inputMode="decimal"
                    value={weightDraft}
                    onChange={(event) => setWeightDraft(event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
                    placeholder="0"
                  />
                  <span>{configuringWeightPricing.unit}</span>
                </label>
                <div>
                  <span>計算</span>
                  <strong>{formatYen(configuringWeightBasePrice + selectedOptionPreviewTotal)}</strong>
                  {selectedOptionPreviewTotal ? <small>追加 {formatYen(selectedOptionPreviewTotal)} を含む</small> : null}
                </div>
              </section>
            ) : null}

            <div className="store-pos-option-groups">
              {getItemOptionGroups(configuringItem).map((group) => {
                const selectionType = getEffectiveSelectionType(group);
                return (
                  <section className="store-pos-option-group" key={group.id}>
                    <div>
                      <strong>{group.name}</strong>
                      <span>
                        {selectionType === "single"
                          ? "1つ選択"
                          : selectionType === "quantity"
                            ? `数量で選択 / 最大${getOptionGroupLimit(group)}点`
                            : `複数選択可 / 最大${getOptionGroupLimit(group)}点`}
                      </span>
                    </div>
                    <div className="store-pos-option-choice-grid">
                      {group.options.map((option) => {
                        const selectedIds = optionDraft[group.id] ?? [];
                        const count = selectedIds.filter((id) => id === option.id).length;
                        const selected = count > 0;
                        return (
                          <div className={selected ? "store-pos-option-choice is-active" : "store-pos-option-choice"} key={option.id}>
                            <button
                              type="button"
                              onClick={() => toggleOption(group, option.id)}
                            >
                              <span>{option.name}</span>
                              {getOptionPrice(option) ? <small>{formatYen(getOptionPrice(option))}</small> : <small>+¥0</small>}
                            </button>
                            {selectionType === "quantity" ? (
                              <div className="store-pos-option-stepper">
                                <button type="button" onClick={() => decrementOption(group, option.id)} aria-label="数量を減らす"><Minus size={14} /></button>
                                <span>{count}</span>
                                <button type="button" onClick={() => toggleOption(group, option.id)} aria-label="数量を増やす"><Plus size={14} /></button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            <button className="primary-button store-pos-option-add" type="button" onClick={addConfiguredItem} disabled={!canAddConfiguredItem}>
              この内容で追加
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
