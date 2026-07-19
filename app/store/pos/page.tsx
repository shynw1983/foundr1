"use client";

import { Banknote, Camera, CreditCard, Gift, Minus, Plus, ReceiptText, ScanLine, Search, ShoppingCart, Trash2, UserRound, X } from "lucide-react";
import jsQR from "jsqr";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { normalizeDecimalInput, normalizeIntegerInput } from "../../../lib/number-input";
import { addOfflinePosOrder, getOfflinePosSnapshot, listOfflinePosOrders, removeOfflinePosOrder, saveOfflinePosSnapshot, updateOfflinePosOrderError, type OfflinePosOrder } from "../../../lib/offline-pos";
import { getCashBreakdownTotal, yenDenominations, type CashBreakdown } from "../../../lib/pos-cash-denominations";
import { createAutoStarBluetoothPrinter, createPhysicalCustomerDisplayPayload, defaultPosPrinterSettings, displayWithAndroidBridge, getKitchenPrinterForBrand, getReceiptPrinter, hasPosPrinterDestination, normalizePosPrinterSettings, printWithAndroidBridge, resolvePosReceiptTemplate, type PosPrinterConnection, type PosPrinterSettings, type PosPrintPayload } from "../../../lib/pos-printer";
import { ModalHistoryScope } from "../../os/components/useModalHistory";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { getStoredStoreSelection, setStoredStoreSelection } from "../components/store-selection";
import { useVisibleRefresh } from "../components/useVisibleRefresh";

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
  displayNames?: Record<string, string>;
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
  applicableCategories: string[];
  name: string;
  displayNames?: Record<string, string>;
  priceDelta: number | null;
  sortOrder: number;
};

type PosOptionGroup = {
  id: string;
  brandId: string;
  menuCatalogItemId: string;
  applicableCategories: string[];
  groupKey: string;
  name: string;
  displayNames?: Record<string, string>;
  selectionType: string;
  ruleJson: Record<string, unknown>;
  sortOrder: number;
  options: PosMenuOption[];
};

type PosSelectedOption = PosMenuOption & {
  groupId: string;
  groupKey: string;
  groupName: string;
  groupDisplayNames?: Record<string, string>;
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

type PosTableCheckoutRequest = {
  id: string;
  tableSessionKey: string;
  tableLabel: string;
  checkoutRequestType: string;
  checkoutRequestedAt: string;
  totalAmount: number;
  orderCount: number;
  pickupCodes: string[];
  itemSummary: string[];
  orders: Array<{
    id: string;
    pickupCode: string;
    amount: number;
    status: string;
    items: Array<{
      id: string;
      name: string;
      quantity: number;
      amount: number;
      optionLabel: string;
      toppings: string[];
    }>;
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
  grossAmount: number;
  discountAmount: number;
  couponDiscountAmount: number;
  paidAmount: number;
  couponId: string;
  refundStatus: string;
  refundedQuantity: number;
  refundedAmount: number;
  refundReason: string;
  externalRefundConfirmedAt: string;
  refundedAt: string;
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
  displayNames?: Record<string, string>;
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
  takeoutEnabled: boolean;
  dineInTaxRate: number;
  takeoutTaxRate: number;
  externalPaymentTerminalBrand: string;
  priceTaxMode: string;
  discountPresets: PosDiscountPreset[];
  printerSettings: PosPrinterSettings;
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
  attendanceStatus: "working" | "on_break" | "scheduled" | "clocked_out" | "manager";
  scheduledStart: string;
  scheduledEnd: string;
};

function getCashResponsibleEmployeeLabel(employee: PosCashResponsibleEmployee) {
  const schedule = employee.scheduledStart && employee.scheduledEnd
    ? ` ${employee.scheduledStart}-${employee.scheduledEnd}`
    : "";
  if (employee.attendanceStatus === "working") return `${employee.name}（出勤中${schedule}）`;
  if (employee.attendanceStatus === "on_break") return `${employee.name}（休憩中${schedule}）`;
  if (employee.attendanceStatus === "clocked_out") return `${employee.name}（本日シフト・退勤済み${schedule}）`;
  if (employee.attendanceStatus === "manager") return `${employee.name}（責任者）`;
  return `${employee.name}（本日シフト${schedule}）`;
}

type PosMember = {
  id: string;
  memberNumber: string;
  publicToken: string;
  displayName: string;
  lastName: string;
  firstName: string;
  fullName: string;
  phone: string;
  email: string;
  preferredLanguage: string;
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
  displayNames?: Record<string, string>;
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

function getCouponDaysUntilExpiry(coupon: Pick<PosCoupon, "expiresAt">) {
  if (!coupon.expiresAt) return null;
  const expiresAt = new Date(coupon.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return null;
  const now = new Date();
  return Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000);
}

function isCouponExpiringSoon(coupon: Pick<PosCoupon, "expiresAt">) {
  const days = getCouponDaysUntilExpiry(coupon);
  return days !== null && days >= 0 && days < 14;
}

function getCouponExpiryLabel(coupon: Pick<PosCoupon, "expiresAt">) {
  const days = getCouponDaysUntilExpiry(coupon);
  if (days === null) return "";
  if (days <= 0) return "本日まで";
  if (days === 1) return "明日まで";
  return `あと${days}日`;
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

function isPrintablePrinter(printer: PosPrinterConnection) {
  return hasPosPrinterDestination(printer);
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

function formatTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
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

function getTransactionStatusLabel(transaction: Pick<PosTransaction, "status" | "paymentStatus" | "refundStatus">) {
  if (transaction.status === "cancelled" || transaction.paymentStatus === "refunded") return "返金済み";
  if (transaction.paymentStatus === "partial_refunded" || transaction.refundStatus === "partial") return "一部返金";
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

function getDefaultOptionId(group: PosOptionGroup, categoryName: string) {
  const categoryDefaults = group.ruleJson?.defaultOptionKeysByCategory;
  const categoryDefaultOptionKey = categoryDefaults && typeof categoryDefaults === "object" && !Array.isArray(categoryDefaults)
    ? String((categoryDefaults as Record<string, unknown>)[categoryName] ?? "").trim()
    : "";
  const defaultOptionKey = categoryDefaultOptionKey || String(group.ruleJson?.defaultOptionKey ?? "").trim();
  const configuredOption = defaultOptionKey
    ? group.options.find((option) => option.optionKey === defaultOptionKey || option.name === defaultOptionKey || option.id === defaultOptionKey)
    : null;
  if (configuredOption) return configuredOption.id;
  if (group.groupKey === "size") {
    const regularOption = group.options.find((option) => option.optionKey.toLowerCase() === "regular");
    if (regularOption) return regularOption.id;
  }
  return group.options[0]?.id ?? "";
}

function getCustomerDisplayLanguage(member: PosMember | null) {
  const language = String(member?.preferredLanguage || "").trim();
  return member && ["zh", "zh-Hant", "en", "ko", "vi", "ne"].includes(language) ? language : "ja";
}

function getLocalizedDisplayName(name: string, displayNames: Record<string, string> | undefined, language: string) {
  if (language === "ja") return name;
  return String(displayNames?.[language] || displayNames?.en || name || "").trim();
}

function getPhysicalCustomerDisplayLines(state: Record<string, unknown>, settings: PosPrinterSettings["customerDisplay"]) {
  const status = String(state.status ?? "idle");
  const subtotal = Math.max(0, Math.round(Number(state.subtotal ?? 0)));
  const tendered = Math.max(0, Math.round(Number(state.cashTenderedAmount ?? 0)));
  const change = Math.max(0, Math.round(Number(state.cashChangeAmount ?? 0)));
  const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
  const items = Array.isArray(state.items) ? state.items as Array<Record<string, unknown>> : [];
  const latestItem = items.at(-1);
  const itemName = String(latestItem?.name ?? "").trim();
  const itemQuantity = Math.max(1, Math.round(Number(latestItem?.quantity ?? 1)));

  if (status === "advertising" || status === "idle") {
    return {
      line1: settings.standbyLine1 || String(state.storeName || "いらっしゃいませ"),
      line2: settings.standbyLine2
    };
  }
  if (status === "complete") {
    return {
      line1: settings.thankYouLine,
      line2: String(state.paymentMethod) === "cash" ? `${settings.changeLabel} ${yen(change)}` : `${settings.totalLabel} ${yen(subtotal)}`
    };
  }
  if (status === "cash_change") {
    return { line1: `${settings.tenderedLabel} ${yen(tendered)}`, line2: `${settings.changeLabel} ${yen(change)}` };
  }
  if (status === "external_wait") {
    return { line1: `${String(state.paymentLabel || "決済")} お支払い`, line2: `${settings.totalLabel} ${yen(subtotal)}` };
  }
  return {
    line1: settings.showItemName && itemName ? `${itemName}${itemQuantity > 1 ? ` x${itemQuantity}` : ""}` : settings.orderPrompt,
    line2: `${settings.totalLabel} ${yen(subtotal)}`
  };
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
  const memberLookupLoadingRef = useRef(false);
  const customerDisplayMemberScanIdRef = useRef("");
  const selectedStoreIdRef = useRef("");
  const checkoutSectionRef = useRef<HTMLDivElement | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [categories, setCategories] = useState<PosMenuCategory[]>([]);
  const [items, setItems] = useState<PosMenuItem[]>([]);
  const [optionGroups, setOptionGroups] = useState<PosOptionGroup[]>([]);
  const [summary, setSummary] = useState<PosSummary>({ orderCount: 0, total: 0, average: 0, latestOrders: [] });
  const [tableCheckoutRequests, setTableCheckoutRequests] = useState<PosTableCheckoutRequest[]>([]);
  const [selectedTableCheckoutKey, setSelectedTableCheckoutKey] = useState("");
  const [tableCheckoutAdjustingKey, setTableCheckoutAdjustingKey] = useState("");
  const [bowlNumber, setBowlNumber] = useState("");
  const [posSettings, setPosSettings] = useState<PosSettings>({ dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: "PayCAS", priceTaxMode: "tax_included", discountPresets: [], printerSettings: defaultPosPrinterSettings });
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
  const [customerDisplayScannerLoading, setCustomerDisplayScannerLoading] = useState(false);
  const [customerDisplayScanPending, setCustomerDisplayScanPending] = useState(false);
  const [note, setNote] = useState("");
  const [receiptRequested, setReceiptRequested] = useState(false);
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
  const [selectedRefundItemIds, setSelectedRefundItemIds] = useState<string[]>([]);
  const [externalRefundConfirmed, setExternalRefundConfirmed] = useState(false);
  const [completedDisplayState, setCompletedDisplayState] = useState<Record<string, unknown> | null>(null);
  const [customerDisplayMode, setCustomerDisplayMode] = useState<"business" | "advertising">("business");
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlinePendingCount, setOfflinePendingCount] = useState(0);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [offlineSyncError, setOfflineSyncError] = useState("");

  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  async function loadReconciliation(storeId = selectedStoreId) {
    if (!storeId) return;
    try {
      const params = new URLSearchParams({ storeId });
      params.set("ts", String(Date.now()));
      const response = await fetch(`/api/store/pos/reconciliation?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json();
      const nextReconciliation = {
      businessDate: body.businessDate ?? "",
      businessState: body.businessState ?? null,
      activeSession: body.activeSession ?? null,
      previousClosedSession: body.previousClosedSession ?? null,
      sessions: body.sessions ?? [],
      movements: body.movements ?? [],
      activeCashResponsibleEmployees: body.activeCashResponsibleEmployees ?? []
      };
      setReconciliation(nextReconciliation);
      setCashClosingResponsibleEmployeeId((current) => {
        const employees = (body.activeCashResponsibleEmployees ?? []) as PosCashResponsibleEmployee[];
        return employees.some((employee) => employee.id === current) ? current : employees[0]?.id ?? "";
      });
      const snapshot = await getOfflinePosSnapshot(storeId).catch(() => undefined);
      if (snapshot) {
        await saveOfflinePosSnapshot({ ...snapshot, savedAt: new Date().toISOString(), reconciliation: nextReconciliation }).catch(() => undefined);
      }
    } catch {
      // The cached reconciliation state remains available during offline checkout.
    }
  }

  async function load(nextStoreId = selectedStoreId) {
    setLoading(true);
    const fetchPosData = (storeId: string) => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      params.set("ts", String(Date.now()));
      return fetch(`/api/store/pos?${params.toString()}`, { cache: "no-store" });
    };
    let body: Record<string, any>;
    let loadedOnline = true;
    try {
      let response = await fetchPosData(nextStoreId);
      if (response.status === 403 && nextStoreId) response = await fetchPosData("");
      if (!response.ok) throw new Error("POS データを読み込めませんでした。");
      body = await response.json();
    } catch {
      const snapshot = await getOfflinePosSnapshot(nextStoreId || getStoredStoreSelection()).catch(() => undefined);
      const snapshotAge = snapshot ? Date.now() - new Date(snapshot.savedAt).getTime() : Number.POSITIVE_INFINITY;
      if (!snapshot || !Number.isFinite(snapshotAge) || snapshotAge > 24 * 60 * 60 * 1000) {
        setMessage("オフライン用のメニューがありません。オンラインで一度 POS を開いてください。");
        setLoading(false);
        return;
      }
      body = snapshot.data;
      loadedOnline = false;
      setOfflineMode(true);
      if (snapshot.reconciliation) setReconciliation(snapshot.reconciliation as unknown as PosReconciliation);
    }
    const nextAccess = body.access as PosAccess;
    const nextBrands = body.brands as BrandOption[];
    const nextItems = body.items as PosMenuItem[];
    const nextCategories = (body.categories ?? []) as PosMenuCategory[];
    const responseStoreId = body.selectedStoreId || nextAccess.stores?.[0]?.id || "";
    const nextBrandId = nextBrands.some((brand) => brand.id === selectedBrandId)
      ? selectedBrandId
      : nextBrands[0]?.id || "";
    setStores(nextAccess.stores ?? []);
    setBrands(nextBrands ?? []);
    setCategories(nextCategories);
    setItems(nextItems ?? []);
    setOptionGroups((body.optionGroups ?? []) as PosOptionGroup[]);
    const nextTableCheckoutRequests = (body.tableCheckoutRequests ?? []) as PosTableCheckoutRequest[];
    setTableCheckoutRequests(nextTableCheckoutRequests);
    setSelectedTableCheckoutKey((current) => nextTableCheckoutRequests.some((request) => request.tableSessionKey === current) ? current : "");
    setSummary((body.todaySummary ?? { orderCount: 0, total: 0, average: 0, latestOrders: [] }) as PosSummary);
    const nextPosSettings = {
      dineInEnabled: body.posSettings?.dineInEnabled !== false,
      takeoutEnabled: body.posSettings?.takeoutEnabled !== false,
      dineInTaxRate: Number(body.posSettings?.dineInTaxRate ?? 10),
      takeoutTaxRate: Number(body.posSettings?.takeoutTaxRate ?? 8),
      externalPaymentTerminalBrand: body.posSettings?.externalPaymentTerminalBrand ?? "PayCAS",
      priceTaxMode: body.posSettings?.priceTaxMode ?? "tax_included",
      discountPresets: Array.isArray(body.posSettings?.discountPresets) ? body.posSettings.discountPresets : [],
      printerSettings: normalizePosPrinterSettings(body.posSettings?.printerSettings ?? defaultPosPrinterSettings)
    };
    setPosSettings(nextPosSettings);
    setOrderType((current) => {
      if (current === "eat_in" && !nextPosSettings.dineInEnabled) return "takeout";
      if (current === "takeout" && !nextPosSettings.takeoutEnabled) return "eat_in";
      return current;
    });
    setSelectedStoreId(responseStoreId);
    if (responseStoreId) setStoredStoreSelection(responseStoreId);
    if (loadedOnline) {
      const previousSnapshot = await getOfflinePosSnapshot(responseStoreId).catch(() => undefined);
      await saveOfflinePosSnapshot({
        storeId: responseStoreId,
        savedAt: new Date().toISOString(),
        data: body,
        reconciliation: previousSnapshot?.reconciliation ?? null
      }).catch(() => undefined);
      await loadReconciliation(responseStoreId);
      setOfflineMode(false);
    }
    setSelectedBrandId(nextBrandId);
    setSelectedCategory(null);
    setQuery("");
    setMessage("");
    setLoading(false);
  }

  async function refreshOfflinePendingCount() {
    const pending = await listOfflinePosOrders().catch(() => []);
    setOfflinePendingCount(pending.length);
    return pending;
  }

  async function syncOfflineOrders() {
    if (!navigator.onLine) return;
    setOfflineSyncError("");
    const pending = await refreshOfflinePendingCount();
    const hadPendingOrders = pending.length > 0;
    for (const order of pending) {
      try {
        const response = await fetch("/api/store/pos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(order.request)
        });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(body.error || "同期できませんでした。");
        await removeOfflinePosOrder(order.clientOrderId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "同期できませんでした。";
        setOfflineSyncError(errorMessage);
        await updateOfflinePosOrderError(order, errorMessage).catch(() => undefined);
        break;
      }
    }
    const remaining = await refreshOfflinePendingCount();
    if (remaining.length === 0) {
      setOfflineMode(false);
      if (hadPendingOrders) void load(selectedStoreIdRef.current);
    }
  }

  useVisibleRefresh(() => {
    void loadReconciliation(selectedStoreIdRef.current);
  }, { minIntervalMs: 10000 });

  useEffect(() => {
    void load(getStoredStoreSelection());
    void refreshOfflinePendingCount().then(() => syncOfflineOrders());
    setBrowserOnline(navigator.onLine);
    const handleOnline = () => {
      setBrowserOnline(true);
      void syncOfflineOrders();
    };
    const handleOffline = () => {
      setBrowserOnline(false);
      setOfflineMode(true);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    memberLookupLoadingRef.current = memberLookupLoading;
  }, [memberLookupLoading]);

  useEffect(() => {
    if (!offlineMode) return;
    setPaymentMethod("cash");
    setDiscountPresetKey("");
    setSelectedCouponId("");
    setCustomerSelectedCouponId("");
    setSelectedTableCheckoutKey("");
    setMemberScannerOpen(false);
    setCustomerDisplayScanPending(false);
    setTransactionDialogOpen(false);
    setCashDialog(null);
    clearSelectedMember();
  }, [offlineMode]);

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
    () => orderTypeOptions.filter((option) => (
      (option.value !== "eat_in" || posSettings.dineInEnabled) &&
      (option.value !== "takeout" || posSettings.takeoutEnabled)
    )),
    [posSettings.dineInEnabled, posSettings.takeoutEnabled]
  );

  const subtotal = cart.reduce((sum, item) => sum + getCartItemAmount(item), 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const selectedTableCheckout = tableCheckoutRequests.find((request) => request.tableSessionKey === selectedTableCheckoutKey) ?? null;
  const tableCheckoutAmount = Number(selectedTableCheckout?.totalAmount ?? 0);
  const enabledDiscountPresets = posSettings.discountPresets.filter((preset) => preset.enabled);
  const selectedDiscountPreset = enabledDiscountPresets.find((preset) => preset.key === discountPresetKey);
  const posDiscountAmount = getPosDiscountAmount(selectedDiscountPreset, cart, subtotal);
  const selectedCoupon = memberCoupons.find((coupon) => coupon.id === selectedCouponId);
  const couponBlockedByDiscount = Boolean(selectedDiscountPreset && !selectedDiscountPreset.allowCouponCombination);
  const couponDiscountAmount = couponBlockedByDiscount ? 0 : getCouponDiscountAmount(selectedCoupon, subtotal, getExchangeEligibleBodyAmounts(selectedCoupon));
  const taxRate = getOrderTaxRate(posSettings, orderType);
  const taxSummary = getTaxSummary({
    subtotal,
    discountAmount: posDiscountAmount,
    couponDiscountAmount,
    taxRate,
    priceTaxMode: posSettings.priceTaxMode
  });
  const payableAmount = taxSummary.payableAmount;
  const activeCheckoutAmount = selectedTableCheckout ? tableCheckoutAmount : payableAmount;
  const getMenuDisplayPrice = (item: PosMenuItem) => {
    const price = getItemPrice(item);
    return posSettings.priceTaxMode === "tax_excluded" ? price + Math.floor(price * taxRate / 100) : price;
  };
  const recommendedCoupon = useMemo(() => {
    if (couponBlockedByDiscount || !memberCoupons.length || subtotal <= 0) return undefined;
    const usableCoupons = memberCoupons
      .map((coupon) => ({
        coupon,
        discount: getCouponDiscountAmount(coupon, subtotal, getExchangeEligibleBodyAmounts(coupon)),
        daysUntilExpiry: getCouponDaysUntilExpiry(coupon),
        expiringSoon: isCouponExpiringSoon(coupon)
      }))
      .filter((entry) => entry.discount > 0);
    if (!usableCoupons.length) return undefined;
    return usableCoupons.sort((left, right) => {
      if (left.expiringSoon !== right.expiringSoon) return left.expiringSoon ? -1 : 1;
      if (left.expiringSoon && right.expiringSoon) return (left.daysUntilExpiry ?? 9999) - (right.daysUntilExpiry ?? 9999);
      return right.discount - left.discount;
    })[0]?.coupon;
  }, [cart, couponBlockedByDiscount, memberCoupons, subtotal]);
  const recommendedCouponDiscountAmount = getCouponDiscountAmount(recommendedCoupon, subtotal, getExchangeEligibleBodyAmounts(recommendedCoupon));
  const selectedCouponDiscountAmount = getCouponDiscountAmount(selectedCoupon, subtotal, getExchangeEligibleBodyAmounts(selectedCoupon));
  const recommendedCouponExpiryLabel = recommendedCoupon ? getCouponExpiryLabel(recommendedCoupon) : "";
  const recommendedCouponExpiringSoon = recommendedCoupon ? isCouponExpiringSoon(recommendedCoupon) : false;
  const shouldShowRecommendedCoupon = Boolean(
    recommendedCoupon &&
    recommendedCoupon.id !== selectedCouponId &&
    (recommendedCouponExpiringSoon || recommendedCouponDiscountAmount > selectedCouponDiscountAmount)
  );
  const canUseRegister = Boolean(reconciliation.activeSession);
  const offlineCheckoutOnly = offlineMode || !browserOnline;
  const cashTenderedValue = Number(cashTenderedAmount || 0);
  const cashChangeAmount = paymentMethod === "cash" && cashTenderedAmount.trim() ? cashTenderedValue - activeCheckoutAmount : null;
  const canCheckout = Boolean(
    (cart.length > 0 || selectedTableCheckout) &&
    !saving &&
    canUseRegister &&
    (!offlineCheckoutOnly || (!selectedTableCheckout && !selectedMember && !selectedCouponId && !discountPresetKey && paymentMethod === "cash")) &&
    (paymentMethod !== "cash" || (cashTenderedAmount.trim() !== "" && cashTenderedValue >= activeCheckoutAmount))
  );
  const hasCurrentTransaction = Boolean(
    cart.length > 0 ||
    selectedTableCheckout ||
    selectedMember ||
    memberLookupInput.trim() ||
    cashTenderedAmount.trim() ||
    note.trim() ||
    discountPresetKey ||
    selectedCouponId
  );
  const canRefundSelectedTransaction = Boolean(
    selectedTransaction &&
    selectedTransaction.status !== "cancelled" &&
    selectedTransaction.paymentStatus !== "refunded" &&
    selectedTransaction.cashSessionStatus === "open"
  );
  const getRefundItemState = (item: PosTransactionItem) => {
    const hasCouponBenefit = Boolean(item.couponId) || Number(item.couponDiscountAmount) > 0;
    const storedPaidAmount = Number(item.paidAmount ?? 0);
    const paidAmount = storedPaidAmount > 0 ? storedPaidAmount : hasCouponBenefit ? 0 : Number(item.amount ?? 0);
    const isRefunded = item.refundStatus === "refunded";
    const canRefund = !isRefunded && (paidAmount > 0 || hasCouponBenefit);
    return { canRefund, hasCouponBenefit, isRefunded, paidAmount };
  };
  const refundableRefundItems = (selectedTransaction?.items ?? []).filter((item) => getRefundItemState(item).canRefund);
  const selectedRefundItems = refundableRefundItems.filter((item) => selectedRefundItemIds.includes(item.id));
  const selectedRefundPaidAmount = selectedRefundItems.reduce((sum, item) => sum + getRefundItemState(item).paidAmount, 0);
  const selectedRefundCouponCount = selectedRefundItems.filter((item) => getRefundItemState(item).hasCouponBenefit).length;
  const canRefundSelectedItem = Boolean(canRefundSelectedTransaction && selectedRefundItems.length);
  const selectedItemRefundNeedsExternalConfirmation = Boolean(
    selectedTransaction &&
    selectedTransaction.paymentMethod !== "cash" &&
    selectedRefundPaidAmount > 0
  );

  useEffect(() => {
    setSelectedRefundItemIds(refundableRefundItems.map((item) => item.id));
  }, [selectedTransaction]);

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
    const normalized = normalizeIntegerInput(value);
    setter((current) => ({ ...current, [String(denomination)]: normalized }));
  }

  async function lookupMember(scannedCode?: string) {
    if (offlineCheckoutOnly) {
      setMessage("オフライン中は会員証・クーポンを利用できません。");
      return;
    }
    const code = (scannedCode ?? memberLookupInput).trim();
    if (!selectedStoreId || !code || memberLookupLoading) return;
    setMemberLookupLoading(true);
    setMessage("");
    setMemberLookupInput(code);
    setCustomerDisplayMode("business");
    try {
      const params = new URLSearchParams({ storeId: selectedStoreId, code });
      const response = await fetch(`/api/store/pos/member?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "会員を確認できませんでした。");
      const scannedLanguage = String(body.selectedLanguage || "").trim();
      const member = body.member as PosMember;
      setSelectedMember(scannedLanguage ? { ...member, preferredLanguage: scannedLanguage } : member);
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

  async function openCustomerDisplayMemberScanner() {
    if (offlineCheckoutOnly) {
      setMessage("オフライン中は客席表示の会員 QR 読取を利用できません。");
      return;
    }
    if (!selectedStoreId || customerDisplayScannerLoading) return;
    setCustomerDisplayScannerLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/store/pos/customer-display/member-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStoreId, action: "open_scanner" })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "客席表示に会員 QR 読取を開始できませんでした。");
      setCustomerDisplayScanPending(true);
      setMessage("客席表示で会員 QR 読取を開始しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "客席表示に会員 QR 読取を開始できませんでした。");
    } finally {
      setCustomerDisplayScannerLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedStoreId || offlineCheckoutOnly) return;
    let active = true;
    let pusher: any;
    let channels: any[] = [];
    let pollingTimer = 0;

    const handleScanRequest = (scanRequest?: { id?: string; code?: string } | null) => {
      const requestId = String(scanRequest?.id ?? "").trim();
      const code = String(scanRequest?.code ?? "").trim();
      if (!requestId || !code || requestId === customerDisplayMemberScanIdRef.current) return;
      customerDisplayMemberScanIdRef.current = requestId;
      setCustomerDisplayScanPending(false);
      void lookupMember(code);
    };

    async function checkCustomerDisplayMemberScan() {
      if (!selectedStoreIdRef.current || memberLookupLoadingRef.current) return;
      const params = new URLSearchParams({ storeId: selectedStoreIdRef.current });
      if (customerDisplayMemberScanIdRef.current) params.set("since", customerDisplayMemberScanIdRef.current);
      const response = await fetch(`/api/store/pos/customer-display/member-scan?${params.toString()}`, { cache: "no-store" }).catch(() => null);
      if (!active || !response?.ok) return;
      const body = await response.json().catch(() => ({})) as { scanRequest?: { id?: string; code?: string } | null };
      handleScanRequest(body.scanRequest);
    }

    const stopPolling = () => {
      if (!pollingTimer) return;
      window.clearInterval(pollingTimer);
      pollingTimer = 0;
    };
    const startPolling = () => {
      if (pollingTimer) return;
      void checkCustomerDisplayMemberScan();
      pollingTimer = window.setInterval(
        checkCustomerDisplayMemberScan,
        customerDisplayScanPending ? 3000 : 60000
      );
    };

    startPolling();
    fetch(`/api/store/realtime-config?storeId=${encodeURIComponent(selectedStoreId)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (config) => {
        if (!active || !config?.key || !config?.cluster || !config?.channels?.length) {
          startPolling();
          return;
        }
        const { acquireSharedPusher } = await import("../../../lib/shared-pusher-client");
        if (!active) return;
        pusher = acquireSharedPusher({ key: config.key, cluster: config.cluster });
        pusher.connection.bind("unavailable", startPolling);
        pusher.connection.bind("failed", startPolling);
        pusher.connection.bind("disconnected", startPolling);
        const refreshReconciliation = () => void loadReconciliation(selectedStoreIdRef.current);
        channels = config.channels.map((channelName: string) => {
          const channel = pusher.subscribe(channelName);
          channel.bind("pusher:subscription_succeeded", stopPolling);
          channel.bind("pusher:subscription_error", startPolling);
          channel.bind("pos.customer-display.updated", (payload: { state?: { memberScanRequest?: { id?: string; code?: string } | null } }) => {
            handleScanRequest(payload?.state?.memberScanRequest);
          });
          channel.bind("pos.reconciliation.updated", refreshReconciliation);
          channel.bind("order.created", refreshReconciliation);
          channel.bind("order.updated", refreshReconciliation);
          return channel;
        });
      })
      .catch(startPolling);

    return () => {
      active = false;
      stopPolling();
      channels.forEach((channel) => {
        channel.unbind("pos.customer-display.updated");
        channel.unbind("pos.reconciliation.updated");
        channel.unbind("order.created");
        channel.unbind("order.updated");
        pusher?.unsubscribe(channel.name);
      });
      pusher?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerDisplayScanPending, offlineCheckoutOnly, selectedStoreId]);

  useEffect(() => {
    if (!customerDisplayScanPending) return;
    const timer = window.setTimeout(() => setCustomerDisplayScanPending(false), 2 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [customerDisplayScanPending]);

  function clearSelectedMember() {
    setSelectedMember(null);
    setMemberCoupons([]);
    setSelectedCouponId("");
    setCustomerSelectedCouponId("");
    setMemberLookupInput("");
    setCustomerDisplayMode("business");
  }

  function getItemOptionGroups(item: PosMenuItem) {
    const weightPricing = getWeightPricingConfig(item, orderType);
    return optionGroups
      .filter((group) => (
        group.brandId === item.brandId
        && (!group.menuCatalogItemId || group.menuCatalogItemId === item.id)
        && (group.menuCatalogItemId || !group.applicableCategories.length || group.applicableCategories.includes(item.category || "未分類"))
      ))
      .filter((group) => !weightPricing || isDineInWeightMalatangOptionGroup(group))
      .map((group) => {
        const allowed = asStringArray(item.variableSchema?.[getAllowedRuleKey(group.groupKey)]);
        const options = group.options
          .filter((option) => !option.applicableCategories.length || option.applicableCategories.includes(item.category || "未分類"))
          .filter((option) => !allowed.length || allowed.includes(option.optionKey) || allowed.includes(option.name));
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

  function getCustomerDisplayOptionLabel(options: PosSelectedOption[], language: string) {
    if (!options.length) return "";
    const counts = new Map<string, { option: PosSelectedOption; count: number }>();
    for (const option of options) {
      const key = `${option.groupId}:${option.id}`;
      const current = counts.get(key) ?? { option, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
    return Array.from(counts.values())
      .map(({ option, count }) => {
        const groupName = getLocalizedDisplayName(option.groupName, option.groupDisplayNames, language);
        const optionName = getLocalizedDisplayName(option.name, option.displayNames, language);
        return `${groupName}: ${optionName}${count > 1 ? ` x${count}` : ""}`;
      })
      .join(" / ");
  }

  function getPaymentDisplayLabel(value: string) {
    if (value === "cash") return "現金";
    if (value === "card") return posSettings.externalPaymentTerminalBrand || "外部決済端末";
    if (value === "other") return "その他";
    return value || "-";
  }

  function getMemberDisplayName(member: PosMember | null, language = getCustomerDisplayLanguage(member)) {
    if (!member) return "";
    const directLastName = String(member.lastName || "").trim();
    if (directLastName) return language === "ja" ? `${directLastName}様` : directLastName;
    const fullName = String(member.fullName || member.displayName || "").trim();
    const spacedLastName = fullName.split(/\s+/).filter(Boolean)[0] ?? "";
    if (spacedLastName) return language === "ja" ? `${spacedLastName}様` : spacedLastName;
    const fallback = String(member.email || member.memberNumber || "").trim();
    return fallback ? language === "ja" ? `${fallback}様` : fallback : "";
  }

  function getDisplayCouponState(coupon: PosCoupon | undefined, discountAmount: number, fallbackName = "", language = "ja") {
    const amount = Math.max(0, Math.round(Number(discountAmount) || 0));
    const rawCouponName = coupon?.name || coupon?.couponCode || fallbackName.trim();
    const couponName = coupon ? getLocalizedDisplayName(rawCouponName, coupon.displayNames, language) : rawCouponName;
    if (!couponName || amount <= 0) return { couponName: "", couponDiscountAmount: 0 };
    return {
      couponName,
      couponDiscountAmount: amount
    };
  }

  function getCustomerDisplayItems(language: string) {
    return cart.map((item) => ({
      name: getLocalizedDisplayName(item.name, item.displayNames, language),
      optionLabel: getCustomerDisplayOptionLabel(item.selectedOptions, language),
      quantity: item.quantity,
      measuredQuantity: item.measuredQuantity,
      measuredUnit: item.measuredUnit,
      measuredUnitPrice: item.measuredUnitPrice,
      weightLabel: getWeightLineLabel(item),
      unitPrice: getLineUnitPrice(item),
      amount: getLineUnitPrice(item) * item.quantity
    }));
  }

  function getDisplayDiscountState(discountPreset: typeof selectedDiscountPreset, discountAmount: number, fallbackName = "", language = "ja") {
    const amount = Math.max(0, Math.round(Number(discountAmount) || 0));
    const rawDiscountName = discountPreset?.name || fallbackName.trim();
    const discountName = discountPreset ? getLocalizedDisplayName(rawDiscountName, discountPreset.displayNames, language) : rawDiscountName;
    if (!discountName || amount <= 0) return { discountName: "", discountAmount: 0 };
    return {
      discountName,
      discountAmount: amount
    };
  }

  function getDisplayTaxState(taxAmount: number, rate: number, priceTaxMode = posSettings.priceTaxMode) {
    const amount = Math.max(0, Math.round(Number(taxAmount) || 0));
    const normalizedRate = Math.max(0, Number(rate) || 0);
    const prefix = priceTaxMode === "tax_excluded" ? "消費税" : "内消費税";
    return {
      taxLabel: normalizedRate ? `${prefix} ${normalizedRate}%` : prefix,
      taxAmount: amount
    };
  }

  function absolutizeReceiptTemplateMedia(template: PosPrinterSettings["receiptTemplate"]) {
    const toAbsolute = (value: string) => {
      const url = String(value || "").trim();
      if (!url || /^https?:\/\//i.test(url)) return url;
      return new URL(url, window.location.origin).toString();
    };
    return {
      ...template,
      logoUrl: toAbsolute(template.logoUrl),
      promotionImageUrl: toAbsolute(template.promotionImageUrl)
    };
  }

  function getStoreReceiptPrinter() {
    const printer = getReceiptPrinter(posSettings.printerSettings);
    return isPrintablePrinter(printer) ? printer : createAutoStarBluetoothPrinter(printer);
  }

  function createReceiptPrintPayload(body: Record<string, unknown>, cartSnapshot: PosCartItem[], printer = getStoreReceiptPrinter()): PosPrintPayload {
    const isInvoice = Boolean(body.receiptRequested ?? receiptRequested);
    const brandIds = Array.from(new Set(cartSnapshot.map((item) => item.brandId).filter(Boolean)));
    const receiptTemplate = resolvePosReceiptTemplate(posSettings.printerSettings, brandIds.length === 1 ? brandIds[0] : null, isInvoice ? "invoice" : "receipt");
    return {
      version: 1,
      jobType: "receipt",
      printer,
      storeName: stores.find((store) => store.id === selectedStoreId)?.name ?? "Foundr1 OS",
      printedAt: new Date().toISOString(),
      receiptTemplate: absolutizeReceiptTemplateMedia(receiptTemplate),
      order: {
        pickupCode: String(body.pickupCode || ""),
        orderType,
        paymentMethod,
        paymentLabel: getPaymentDisplayLabel(paymentMethod),
        note: body.offline ? `[オフライン未同期] ${note}`.trim() : note,
        receiptRequested: isInvoice,
        receiptTitle: isInvoice ? receiptTemplate.invoiceTitle : receiptTemplate.receiptTitle,
        receiptRecipientName: isInvoice ? receiptTemplate.invoiceRecipientName : "",
        receiptPurposeText: isInvoice ? receiptTemplate.invoicePurposeText : "",
        subtotalAmount: subtotal,
        discountAmount: Number(body.discountAmount ?? posDiscountAmount) || 0,
        couponDiscountAmount: Number(body.couponDiscountAmount ?? couponDiscountAmount) || 0,
        taxAmount: Number(body.taxAmount ?? taxSummary.taxAmount) || 0,
        taxRate: Number(body.taxRate ?? taxRate) || 0,
        totalAmount: Number(body.amount ?? payableAmount) || 0,
        cashTenderedAmount: paymentMethod === "cash" ? cashTenderedValue : null,
        cashChangeAmount: paymentMethod === "cash" ? Number(body.cashChangeAmount ?? cashTenderedValue - payableAmount) : null,
        items: cartSnapshot.map((item) => ({
          name: getLocalizedDisplayName(item.name, item.displayNames, "ja"),
          quantity: item.quantity,
          unitPrice: getLineUnitPrice(item),
          amount: getLineUnitPrice(item) * item.quantity,
          options: getCustomerDisplayOptionLabel(item.selectedOptions, "ja").split(" / ").filter(Boolean)
        }))
      }
    };
  }

  function createKitchenPrintPayload(body: Record<string, unknown>, cartItems: PosCartItem[], printer: PosPrinterConnection, brandName: string): PosPrintPayload {
    const kitchenTotal = cartItems.reduce((sum, item) => sum + getLineUnitPrice(item) * item.quantity, 0);
    return {
      version: 1,
      jobType: "kitchen",
      printer,
      storeName: `${stores.find((store) => store.id === selectedStoreId)?.name ?? "Foundr1 OS"} / ${brandName}`,
      printedAt: new Date().toISOString(),
      receiptTemplate: absolutizeReceiptTemplateMedia(posSettings.printerSettings.receiptTemplate),
      kitchenTicketTemplate: posSettings.printerSettings.kitchenTicketTemplate,
      order: {
        pickupCode: String(body.pickupCode || ""),
        orderType,
        paymentMethod: "kitchen",
        paymentLabel: "厨房",
        note: body.offline ? `[オフライン未同期] ${note}`.trim() : note,
        subtotalAmount: kitchenTotal,
        discountAmount: 0,
        couponDiscountAmount: 0,
        taxAmount: 0,
        taxRate: 0,
        totalAmount: kitchenTotal,
        items: cartItems.map((item) => ({
          name: getLocalizedDisplayName(item.name, item.displayNames, "ja"),
          quantity: item.quantity,
          unitPrice: getLineUnitPrice(item),
          amount: getLineUnitPrice(item) * item.quantity,
          options: getCustomerDisplayOptionLabel(item.selectedOptions, "ja").split(" / ").filter(Boolean)
        }))
      }
    };
  }

  async function printReceiptAfterCheckout(body: Record<string, unknown>, cartSnapshot: PosCartItem[]) {
    const printerSettings = posSettings.printerSettings;
    const printer = getStoreReceiptPrinter();
    if (!printerSettings.enabled || !printerSettings.receiptEnabled || !isPrintablePrinter(printer)) return "";
    const result = await printWithAndroidBridge(createReceiptPrintPayload(body, cartSnapshot, printer));
    return result.ok ? " / レシート印刷送信済み" : ` / レシート印刷未送信: ${result.error}`;
  }

  async function printKitchenAfterCheckout(body: Record<string, unknown>, cartSnapshot: PosCartItem[]) {
    const printerSettings = posSettings.printerSettings;
    if (!printerSettings.enabled || !printerSettings.kitchenEnabled) return "";
    const brandGroups = cartSnapshot.reduce((groups, item) => {
      const key = item.brandId || "default";
      groups[key] = groups[key] ?? { brandName: item.brandName || "厨房", items: [] };
      groups[key].items.push(item);
      return groups;
    }, {} as Record<string, { brandName: string; items: PosCartItem[] }>);
    let sentCount = 0;
    const errors: string[] = [];
    for (const [brandId, group] of Object.entries(brandGroups)) {
      const printer = getKitchenPrinterForBrand(printerSettings, brandId === "default" ? null : brandId);
      if (!isPrintablePrinter(printer)) continue;
      const payload = createKitchenPrintPayload(body, group.items, printer, group.brandName);
      for (let copy = 1; copy <= printerSettings.kitchenCopies; copy += 1) {
        const result = await printWithAndroidBridge(payload);
        if (result.ok) {
          sentCount += 1;
        } else {
          errors.push(`${group.brandName} ${copy}/${printerSettings.kitchenCopies}枚目: ${result.error || "送信失敗"}`);
          break;
        }
      }
    }
    if (errors.length) return ` / 厨房印刷未送信: ${errors.join(", ")}`;
    return sentCount ? ` / 厨房印刷 ${sentCount}枚送信済み` : "";
  }

  async function publishCustomerDisplayState(state: Record<string, unknown>) {
    if (!selectedStoreId) return;
    const physicalDisplay = posSettings.printerSettings.customerDisplay;
    const receiptPrinter = getReceiptPrinter(posSettings.printerSettings);
    if (physicalDisplay.enabled && receiptPrinter.deviceType === "star_printer") {
      const lines = getPhysicalCustomerDisplayLines(state, physicalDisplay);
      await displayWithAndroidBridge(createPhysicalCustomerDisplayPayload(
        posSettings.printerSettings,
        lines.line1,
        lines.line2
      ));
    }
    if (offlineCheckoutOnly) return;
    await fetch("/api/store/pos/customer-display", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: selectedStoreId, state })
    }).catch(() => undefined);
  }

  function getAdvertisingDisplayState() {
    return {
      status: "advertising",
      storeName: stores.find((store) => store.id === selectedStoreId)?.name ?? "",
      orderType: "",
      paymentMethod: "cash",
      paymentLabel: "現金",
      externalPaymentTerminalBrand: posSettings.externalPaymentTerminalBrand,
      pickupCode: "",
      preferredLanguage: "",
      memberDisplayName: "",
      memberMessage: "",
      discountName: "",
      discountAmount: 0,
      couponName: "",
      couponDiscountAmount: 0,
      subtotal: 0,
      taxLabel: "",
      taxAmount: 0,
      cashTenderedAmount: null,
      cashChangeAmount: null,
      items: []
    };
  }

  function cancelCurrentTransaction() {
    if (!hasCurrentTransaction || saving) return;
    setCart([]);
    setSelectedTableCheckoutKey("");
    setCashTenderedAmount("");
    setMemberLookupInput("");
    setSelectedMember(null);
    setMemberCoupons([]);
    setSelectedCouponId("");
    setCustomerSelectedCouponId("");
    setDiscountPresetKey("");
    setPaymentMethod("cash");
    setNote("");
    setConfiguringItem(null);
    setOptionDraft({});
    setWeightDraft("");
    setCompletedDisplayState(null);
    setCustomerDisplayMode("advertising");
    setMessage("現在の会計を中止しました。");
    void publishCustomerDisplayState(getAdvertisingDisplayState());
  }

  function selectTableCheckout(request: PosTableCheckoutRequest) {
    if (offlineCheckoutOnly) {
      setMessage("オフライン中はテーブル会計を処理できません。");
      return;
    }
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    setSelectedTableCheckoutKey((current) => current === request.tableSessionKey ? "" : request.tableSessionKey);
    setCart([]);
    setConfiguringItem(null);
    setOptionDraft({});
    setWeightDraft("");
    setSelectedMember(null);
    setMemberCoupons([]);
    setSelectedCouponId("");
    setCustomerSelectedCouponId("");
    setDiscountPresetKey("");
    setNote("");
    setReceiptRequested(false);
    setCashTenderedAmount("");
    setCustomerDisplayMode("business");
  }

  async function adjustTableCheckout(input: {
    action: "cancel_order" | "cancel_item" | "set_item_quantity";
    orderId: string;
    itemId?: string;
    quantity?: number;
  }) {
    if (offlineCheckoutOnly) {
      setMessage("オフライン中はテーブル注文を修正できません。");
      return;
    }
    if (!selectedStoreId || !selectedTableCheckout || tableCheckoutAdjustingKey) return;
    const key = `${input.action}:${input.orderId}:${input.itemId ?? ""}`;
    setTableCheckoutAdjustingKey(key);
    setMessage("");
    try {
      const response = await fetch("/api/store/pos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          tableSessionKey: selectedTableCheckout.tableSessionKey,
          action: input.action,
          orderId: input.orderId,
          itemId: input.itemId,
          quantity: input.quantity
        })
      });
      const body = await response.json().catch(() => ({})) as { tableCheckoutRequests?: PosTableCheckoutRequest[]; todaySummary?: PosSummary; error?: string };
      if (!response.ok) throw new Error(body.error || "テーブル注文を修正できませんでした。");
      const nextRequests = body.tableCheckoutRequests ?? [];
      setTableCheckoutRequests(nextRequests);
      setSelectedTableCheckoutKey((current) => nextRequests.some((request) => request.tableSessionKey === current) ? current : "");
      if (body.todaySummary) setSummary(body.todaySummary);
      setCashTenderedAmount("");
      setMessage("テーブル注文を修正しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "テーブル注文を修正できませんでした。");
    } finally {
      setTableCheckoutAdjustingKey("");
    }
  }

  function getLineBasePrice(item: PosCartItem) {
    if (item.measuredQuantity && item.measuredUnitPrice) return Math.round(item.measuredQuantity * item.measuredUnitPrice);
    return getItemPrice(item);
  }

  function getLineUnitPrice(item: PosCartItem) {
    return getLineBasePrice(item) + item.optionTotal;
  }

  function getExchangeEligibleBodyAmount(item: PosCartItem) {
    if (item.measuredQuantity) return 0;
    const sizeReduction = item.selectedOptions
      .filter((option) => option.groupKey === "size")
      .reduce((sum, option) => sum + Math.min(0, getOptionPrice(option)), 0);
    return Math.max(0, getItemPrice(item) + sizeReduction);
  }

  function getExchangeEligibleBodyAmounts(coupon?: PosCoupon) {
    if (!coupon || !isExchangeCoupon(coupon)) return [];
    return cart.flatMap((item) => {
      if (coupon.brandId && item.brandId !== coupon.brandId) return [];
      const bodyAmount = getExchangeEligibleBodyAmount(item);
      return Array.from({ length: item.quantity }, () => bodyAmount).filter((amount) => amount > 0);
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
    setSelectedTableCheckoutKey("");
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
    setCustomerDisplayMode("business");
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
    setCustomerDisplayMode("business");
    const groups = getItemOptionGroups(item);
    if (!groups.length && !getWeightPricingConfig(item, orderType)) {
      addItem(item);
      return;
    }
    const nextDraft: Record<string, string[]> = {};
    for (const group of groups) {
      if (getEffectiveSelectionType(group) === "single" && group.options.length) {
        nextDraft[group.id] = [getDefaultOptionId(group, item.category || "未分類")];
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
        .map((option) => ({ ...option, groupId: group.id, groupKey: group.groupKey, groupName: group.name, groupDisplayNames: group.displayNames })) as PosSelectedOption[];
    });
    addItem(configuringItem, selectedOptions, weightDraft);
    setConfiguringItem(null);
    setOptionDraft({});
    setWeightDraft("");
  }

  function changeQuantity(cartKey: string, amount: number) {
    setCustomerDisplayMode("business");
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
    setCustomerDisplayMode("business");
    setConfiguringItem(null);
    setOptionDraft({});
    setWeightDraft("");
    if (needsCartReset) {
      setCart([]);
      setMessage("注文区分を変更したため、重量商品の会計内容をクリアしました。");
    }
  }

  async function checkout() {
    if (!selectedStoreId || (!cart.length && !selectedTableCheckout) || saving) return;
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    if (offlineCheckoutOnly && (paymentMethod !== "cash" || selectedMember || selectedCouponId || discountPresetKey || selectedTableCheckout)) {
      setMessage("オフライン会計は、会員・クーポン・割引・テーブル会計を使わない現金注文のみ対応しています。");
      return;
    }
    if (cart.some((item) => /maamaa|まぁ麻|麻辣/i.test(item.brandName)) && !/^(?:0?[1-9]|[12]\d|30)$/.test(bowlNumber)) {
      setMessage("マーラータンのボウル番号（1〜30）を入力してください。");
      return;
    }
    if (paymentMethod === "cash" && (cashTenderedAmount.trim() === "" || cashTenderedValue < activeCheckoutAmount)) {
      setMessage("現金会計はお預かり金額を合計以上で入力してください。");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const cartSnapshot = cart;
      const offlineClientOrderId = window.crypto.randomUUID();
      const offlineCreatedAt = new Date().toISOString();
      const offlinePickupCode = cart.some((item) => /maamaa|まぁ麻|麻辣/i.test(item.brandName))
        ? String(Number(bowlNumber)).padStart(2, "0")
        : `${navigator.onLine ? "D" : "O"}${offlineClientOrderId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
      const checkoutRequest = {
          offlineClientOrderId,
          offlineCreatedAt,
          offlinePickupCode,
          offlineExpectedAmount: activeCheckoutAmount,
          storeId: selectedStoreId,
          orderType,
          paymentMethod,
          cashTenderedAmount: paymentMethod === "cash" ? cashTenderedValue : null,
          tableSessionKey: selectedTableCheckout?.tableSessionKey || undefined,
          bowlNumber: selectedTableCheckout ? undefined : bowlNumber,
          memberToken: selectedMember?.publicToken || undefined,
          memberId: selectedMember?.id || undefined,
          memberEmail: selectedMember?.email || undefined,
          memberPhone: selectedMember?.phone || undefined,
          memberName: selectedMember?.displayName || undefined,
          memberLanguage: selectedMember?.preferredLanguage || undefined,
          couponId: couponBlockedByDiscount ? undefined : selectedCouponId || undefined,
          discountPresetKey: discountPresetKey || undefined,
          receiptRequested,
          note,
          items: selectedTableCheckout ? [] : cart.map((item) => ({
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
      };
      let body: Record<string, any>;
      let fallbackEligible = true;
      try {
        if (!navigator.onLine) throw new Error("offline");
        const response = await fetch("/api/store/pos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(checkoutRequest)
        });
        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) {
          fallbackEligible = response.status >= 500;
          throw new Error(responseBody.error || "checkout failed");
        }
        body = responseBody;
      } catch (error) {
        if (!fallbackEligible && navigator.onLine) throw error;
        setOfflineMode(true);
        if (paymentMethod !== "cash" || selectedMember || selectedCouponId || discountPresetKey || selectedTableCheckout) {
          throw new Error("オフライン会計は、会員・クーポン・割引・テーブル会計を使わない現金注文のみ対応しています。");
        }
        if (!reconciliation.activeSession) {
          throw new Error("オフライン会計を始める前に、オンラインでレジを開店してください。");
        }
        const offlineRequest = { ...checkoutRequest, offlineQueued: true };
        body = {
          ok: true,
          offline: true,
          orderId: offlineClientOrderId,
          pickupCode: offlinePickupCode,
          amount: activeCheckoutAmount,
          subtotalAmount: activeCheckoutAmount,
          taxableAmount: activeCheckoutAmount,
          taxAmount: taxSummary.taxAmount,
          taxRate,
          priceTaxMode: posSettings.priceTaxMode,
          discountAmount: 0,
          couponDiscountAmount: 0,
          cashTenderedAmount: cashTenderedValue,
          cashChangeAmount: cashTenderedValue - activeCheckoutAmount,
          receiptRequested,
          todaySummary: {
            ...summary,
            orderCount: summary.orderCount + 1,
            total: summary.total + activeCheckoutAmount,
            average: Math.round((summary.total + activeCheckoutAmount) / (summary.orderCount + 1))
          }
        };
        const offlineOrder: OfflinePosOrder = {
          clientOrderId: offlineClientOrderId,
          storeId: selectedStoreId,
          createdAt: offlineCreatedAt,
          request: offlineRequest,
          localResponse: body,
          lastError: ""
        };
        await addOfflinePosOrder(offlineOrder);
        setOfflineMode(true);
        await refreshOfflinePendingCount();
      }
      const receiptPrintMessage = selectedTableCheckout ? "" : await printReceiptAfterCheckout(body, cartSnapshot);
      const kitchenPrintMessage = selectedTableCheckout ? "" : await printKitchenAfterCheckout(body, cartSnapshot);
      setCart([]);
      setSelectedTableCheckoutKey("");
      setBowlNumber("");
      setTableCheckoutRequests((current) => current.filter((request) => request.tableSessionKey !== selectedTableCheckout?.tableSessionKey));
      setNote("");
      setReceiptRequested(false);
      setCashTenderedAmount("");
      setDiscountPresetKey("");
      clearSelectedMember();
      setSummary(body.todaySummary as PosSummary);
      if (!body.offline && transactionDialogOpen) await loadTransactions();
      if (!body.offline) {
        await loadReconciliation(selectedStoreId);
        void load(selectedStoreId);
      }
      const discountLabel = body.discountAmount ? ` / 学割 -${formatYen(body.discountAmount)}` : "";
      const couponLabel = body.couponDiscountAmount ? ` / クーポン -${formatYen(body.couponDiscountAmount)}` : "";
      const changeLabel = paymentMethod === "cash" ? ` / お釣り ${formatYen(body.cashChangeAmount ?? cashTenderedValue - body.amount)}` : "";
      const receiptRequestLabel = receiptRequested ? " / 領収書" : "";
      const customerDisplayLanguage = getCustomerDisplayLanguage(selectedMember);
      setMessage(`${body.offline ? "オフライン会計を端末に保存しました" : "会計を保存しました"}。${body.pickupCode} / ${formatYen(body.amount)}${discountLabel}${couponLabel}${changeLabel}${receiptRequestLabel}${receiptPrintMessage}${kitchenPrintMessage}`);
      setCompletedDisplayState({
        status: "complete",
        storeName: stores.find((store) => store.id === selectedStoreId)?.name ?? "",
        orderType,
        paymentMethod,
        paymentLabel: getPaymentDisplayLabel(paymentMethod),
        externalPaymentTerminalBrand: posSettings.externalPaymentTerminalBrand,
        pickupCode: body.pickupCode,
        preferredLanguage: selectedMember ? customerDisplayLanguage : "",
        memberDisplayName: getMemberDisplayName(selectedMember, customerDisplayLanguage),
        memberMessage: selectedMember ? "いつもご利用いただきありがとうございます。" : "",
        ...getDisplayDiscountState(selectedDiscountPreset, body.discountAmount, body.discountName || "割引", customerDisplayLanguage),
        ...getDisplayCouponState(selectedCoupon, body.couponDiscountAmount, body.couponName || body.couponCode || "クーポン", customerDisplayLanguage),
        subtotal: body.amount,
        ...getDisplayTaxState(body.taxAmount, body.taxRate, body.priceTaxMode),
        cashTenderedAmount: paymentMethod === "cash" ? cashTenderedValue : null,
        cashChangeAmount: paymentMethod === "cash" ? body.cashChangeAmount ?? cashTenderedValue - body.amount : null,
        items: selectedTableCheckout ? [{
          name: `${selectedTableCheckout.tableLabel} QR追加会計`,
          optionLabel: selectedTableCheckout.itemSummary.slice(0, 3).join(" / "),
          quantity: 1,
          measuredQuantity: null,
          measuredUnit: "",
          measuredUnitPrice: null,
          weightLabel: "",
          unitPrice: Number(body.amount ?? selectedTableCheckout.totalAmount),
          amount: Number(body.amount ?? selectedTableCheckout.totalAmount)
        }] : getCustomerDisplayItems(customerDisplayLanguage)
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
      const nextTransactionStarted = cart.length > 0 || Boolean(selectedMember) || memberLookupInput.trim();
      if (nextTransactionStarted) {
        setCompletedDisplayState(null);
        setCustomerDisplayMode("business");
      } else {
        void publishCustomerDisplayState(completedDisplayState);
        const timer = window.setTimeout(() => {
          setCompletedDisplayState(null);
          setCustomerDisplayMode("advertising");
          void publishCustomerDisplayState(getAdvertisingDisplayState());
        }, 10000);
        return () => window.clearTimeout(timer);
      }
    }
    if (customerDisplayMode === "advertising" && cart.length === 0 && !selectedMember && !memberLookupInput.trim()) return;
    const status = cart.length === 0 && !selectedTableCheckout
      ? "idle"
      : paymentMethod === "cash"
        ? cashTenderedAmount.trim() && cashChangeAmount !== null && cashChangeAmount >= 0
          ? "cash_change"
          : "editing"
        : "external_wait";
    const timer = window.setTimeout(() => {
      const customerDisplayLanguage = getCustomerDisplayLanguage(selectedMember);
      void publishCustomerDisplayState({
        status,
        storeName: stores.find((store) => store.id === selectedStoreId)?.name ?? "",
        orderType,
        paymentMethod,
        paymentLabel: getPaymentDisplayLabel(paymentMethod),
        externalPaymentTerminalBrand: posSettings.externalPaymentTerminalBrand,
        pickupCode: "",
        preferredLanguage: selectedMember ? customerDisplayLanguage : "",
        memberDisplayName: getMemberDisplayName(selectedMember, customerDisplayLanguage),
        memberMessage: selectedMember ? "いつもご利用いただきありがとうございます。" : "",
        ...getDisplayDiscountState(selectedDiscountPreset, posDiscountAmount, "", customerDisplayLanguage),
        ...getDisplayCouponState(selectedCoupon, couponDiscountAmount, "", customerDisplayLanguage),
        subtotal: activeCheckoutAmount,
        ...getDisplayTaxState(taxSummary.taxAmount, taxRate),
        cashTenderedAmount: paymentMethod === "cash" && cashTenderedAmount.trim() ? cashTenderedValue : null,
        cashChangeAmount: paymentMethod === "cash" && cashChangeAmount !== null ? cashChangeAmount : null,
        items: selectedTableCheckout ? [{
          name: `${selectedTableCheckout.tableLabel} QR追加会計`,
          optionLabel: selectedTableCheckout.itemSummary.slice(0, 3).join(" / "),
          quantity: 1,
          measuredQuantity: null,
          measuredUnit: "",
          measuredUnitPrice: null,
          weightLabel: "",
          unitPrice: tableCheckoutAmount,
          amount: tableCheckoutAmount
        }] : getCustomerDisplayItems(customerDisplayLanguage)
      });
    }, 180);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, cashTenderedAmount, completedDisplayState, customerDisplayMode, memberLookupInput, orderType, paymentMethod, posSettings.externalPaymentTerminalBrand, posSettings.priceTaxMode, posSettings.printerSettings.customerDisplay.enabled, posSettings.printerSettings.receiptPrinter.connectionType, posSettings.printerSettings.receiptPrinter.deviceType, posSettings.printerSettings.receiptPrinter.identifier, selectedCoupon?.id, selectedCoupon?.name, selectedCoupon?.couponCode, selectedDiscountPreset?.key, selectedDiscountPreset?.name, selectedMember, selectedStoreId, payableAmount, posDiscountAmount, couponDiscountAmount, taxRate, taxSummary.taxAmount, canUseRegister, activeCheckoutAmount, selectedTableCheckout, tableCheckoutAmount]);

  useEffect(() => {
    if (!selectedStoreId || !canUseRegister) return;
    if (customerDisplayMode !== "business" || completedDisplayState || hasCurrentTransaction) return;
    const timer = window.setTimeout(() => {
      setCustomerDisplayMode("advertising");
      void publishCustomerDisplayState(getAdvertisingDisplayState());
    }, 10000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseRegister, completedDisplayState, customerDisplayMode, hasCurrentTransaction, orderType, paymentMethod, posSettings.printerSettings.customerDisplay.enabled, posSettings.printerSettings.receiptPrinter.connectionType, posSettings.printerSettings.receiptPrinter.deviceType, posSettings.printerSettings.receiptPrinter.identifier, selectedStoreId]);

  async function submitCashAction(action: "open" | "movement" | "close") {
    if (offlineCheckoutOnly) {
      setMessage("オフライン中は開店確認・入出金・レジ締めを変更できません。");
      return;
    }
    if (!selectedStoreId || cashSaving) return;
    if (action === "close" && offlinePendingCount > 0) {
      setMessage(`未同期のオフライン注文が ${offlinePendingCount} 件あります。同期完了後にレジ締めしてください。`);
      return;
    }
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

  function revealCheckoutSection() {
    checkoutSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      checkoutSectionRef.current?.querySelector<HTMLButtonElement>("button.is-active")?.focus({ preventScroll: true });
    }, 450);
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
      setSelectedRefundItemIds([]);
      setExternalRefundConfirmed(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取引履歴を読み込めませんでした。");
    } finally {
      setTransactionLoading(false);
    }
  }

  async function openTransactionDialog() {
    if (offlineCheckoutOnly) {
      setMessage("オフライン中は取引履歴・返金を利用できません。");
      return;
    }
    setTransactionDialogOpen(true);
    await loadTransactions("");
  }

  async function selectTransaction(orderId: string) {
    if (offlineCheckoutOnly) return;
    await loadTransactions(orderId);
  }

  async function refundTransaction(itemIds: string[] = []) {
    if (offlineCheckoutOnly) {
      setMessage("オフライン中は返金を利用できません。");
      return;
    }
    if (!selectedStoreId || !selectedTransaction || refundSaving) return;
    if (!itemIds.length) return;
    const refundingId = selectedTransaction.id;
    setRefundSaving(true);
    setRefundingTransactionId(refundingId);
    setMessage("");
    try {
      const response = await fetch("/api/store/pos/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          orderId: refundingId,
          itemIds,
          reason: refundReason,
          externalRefundConfirmed
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "返金を保存できませんでした。");
      setTransactions((body.transactions ?? []) as PosTransaction[]);
      setSelectedTransaction((body.selectedTransaction ?? null) as PosTransaction | null);
      setSummary((current) => ({ ...current, ...(body.todaySummary ?? {}) }));
      setRefundReason("");
      setSelectedRefundItemIds([]);
      setExternalRefundConfirmed(false);
      await loadReconciliation(selectedStoreId);
      setMessage(`返品を記録しました。${selectedTransaction.pickupCode} / ${formatYen(body.refundAmount ?? 0)}`);
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
          <div className="store-pos-summary">
            <span>本日 {summary.orderCount} 件</span>
            <strong>{formatYen(summary.total)}</strong>
            <small>平均 {formatYen(summary.average)}</small>
          </div>
        </div>
      </section>

      {message ? <div className="action-notice store-pos-notice">{message}</div> : null}
      {offlineCheckoutOnly || offlinePendingCount > 0 ? (
        <div className="action-notice store-pos-offline-notice" role="status">
          <strong>{offlineCheckoutOnly ? "オフライン応急モード（現金のみ）" : "オフライン注文を同期中"}</strong>
          <span> 未同期 {offlinePendingCount} 件</span>
          {offlineCheckoutOnly ? <small>会員・クーポン・割引・外部決済・テーブル会計・レジ操作はオンライン復帰後に利用できます。</small> : null}
          {browserOnline && offlinePendingCount > 0 ? <button type="button" onClick={() => void syncOfflineOrders()}>今すぐ同期</button> : null}
          {offlineSyncError ? <small>{offlineSyncError}</small> : null}
        </div>
      ) : null}

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
              <button className="secondary-button" type="button" onClick={() => setCashDialog("movement")} disabled={offlineCheckoutOnly}>入出金</button>
              <button className="primary-button" type="button" onClick={() => setCashDialog("close")} disabled={offlineCheckoutOnly}>レジ締め</button>
            </>
          ) : (
            <button className="primary-button" type="button" onClick={() => setCashDialog("open")} disabled={offlineCheckoutOnly}>開店確認</button>
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
              <button className="secondary-button" type="button" onClick={() => void openTransactionDialog()} disabled={offlineCheckoutOnly}>履歴</button>
              <strong>{cartCount} 点</strong>
            </div>
          </div>

          {tableCheckoutRequests.length ? (
            <section className="store-pos-table-checkout-panel" aria-label="テーブル会計待ち">
              <div className="store-pos-table-checkout-head">
                <span>テーブル会計待ち</span>
                <strong>{tableCheckoutRequests.length}件</strong>
              </div>
              {offlineCheckoutOnly ? <small>オフライン中はテーブル会計を処理できません。</small> : null}
              <div className="store-pos-table-checkout-list">
                {tableCheckoutRequests.map((request) => (
                  <button
                    key={request.tableSessionKey}
                    className={selectedTableCheckoutKey === request.tableSessionKey ? "is-active" : ""}
                    type="button"
                    onClick={() => selectTableCheckout(request)}
                    disabled={!canUseRegister || saving || offlineCheckoutOnly}
                  >
                    <span>
                      <strong>{request.tableLabel}</strong>
                      <small>
                        {request.checkoutRequestType === "staff_to_table" ? "テーブル会計依頼" : "レジ会計待ち"}
                        {formatTime(request.checkoutRequestedAt) ? ` / ${formatTime(request.checkoutRequestedAt)}` : ""}
                        {request.orderCount > 1 ? ` / ${request.orderCount}件` : ""}
                      </small>
                      <small>{request.itemSummary.slice(0, 3).join(" / ")}</small>
                    </span>
                    <b>{formatYen(request.totalAmount)}</b>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="store-pos-segmented">
            {visibleOrderTypeOptions.map((option) => (
              <button key={option.value} className={orderType === option.value ? "is-active" : ""} type="button" onClick={() => changeOrderType(option.value)}>
                {option.label}
              </button>
            ))}
          </div>

          {!selectedTableCheckout && cart.some((item) => /maamaa|まぁ麻|麻辣/i.test(item.brandName)) ? (
            <label className="store-pos-bowl-number">
              <span><ScanLine size={18} /> ボウル番号 <b>必須</b></span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={2}
                placeholder="01〜30"
                value={bowlNumber}
                onChange={(event) => setBowlNumber(normalizeIntegerInput(event.target.value).slice(0, 2))}
                disabled={saving}
              />
              <small>盆のコードをスキャン、または番号を入力</small>
            </label>
          ) : null}

          <div className="store-pos-cart-list">
            {selectedTableCheckout ? (
              <div className="store-pos-table-checkout-selected">
                <span>QR追加会計</span>
                <strong>{selectedTableCheckout.tableLabel}</strong>
                <p>{selectedTableCheckout.itemSummary.slice(0, 5).join(" / ") || "追加注文"}</p>
                <small>{selectedTableCheckout.orderCount}件 / {selectedTableCheckout.pickupCodes.join(", ")}</small>
                <div className="store-pos-table-adjust-list">
                  {selectedTableCheckout.orders.map((order) => (
                    <section className="store-pos-table-adjust-order" key={order.id}>
                      <div className="store-pos-table-adjust-order-head">
                        <span>{order.pickupCode}</span>
                        <strong>{formatYen(order.amount)}</strong>
                        <button
                          className="danger-text-button"
                          type="button"
                          disabled={Boolean(tableCheckoutAdjustingKey) || saving}
                          onClick={() => void adjustTableCheckout({ action: "cancel_order", orderId: order.id })}
                        >
                          注文取消
                        </button>
                      </div>
                      {order.items.map((item) => (
                        <div className="store-pos-table-adjust-item" key={item.id}>
                          <div>
                            <strong>{item.name}</strong>
                            {item.optionLabel ? <small>{item.optionLabel}</small> : null}
                            {item.toppings.length ? <small>{item.toppings.join(" / ")}</small> : null}
                            <span>{formatYen(item.amount)}</span>
                          </div>
                          <div className="store-pos-quantity">
                            <button
                              type="button"
                              disabled={Boolean(tableCheckoutAdjustingKey) || saving}
                              onClick={() => void adjustTableCheckout({
                                action: item.quantity <= 1 ? "cancel_item" : "set_item_quantity",
                                orderId: order.id,
                                itemId: item.id,
                                quantity: item.quantity - 1
                              })}
                              aria-label="数量を減らす"
                            >
                              <Minus size={16} />
                            </button>
                            <span>{item.quantity}</span>
                            <button
                              type="button"
                              disabled={Boolean(tableCheckoutAdjustingKey) || saving}
                              onClick={() => void adjustTableCheckout({
                                action: "set_item_quantity",
                                orderId: order.id,
                                itemId: item.id,
                                quantity: item.quantity + 1
                              })}
                              aria-label="数量を増やす"
                            >
                              <Plus size={16} />
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(tableCheckoutAdjustingKey) || saving}
                              onClick={() => void adjustTableCheckout({ action: "cancel_item", orderId: order.id, itemId: item.id })}
                              aria-label="削除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </div>
            ) : cart.length === 0 ? (
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
            {offlineCheckoutOnly ? (
              <small className="store-pos-member-empty-coupon">オフライン中は会員証・クーポンを利用できません。</small>
            ) : selectedMember ? (
              <>
                <div className="store-pos-member-card">
                  <strong>{selectedMember.displayName || selectedMember.email || selectedMember.memberNumber}</strong>
                  <span>{selectedMember.memberNumber} / {selectedMember.pointBalance.toLocaleString("ja-JP")} pt</span>
                </div>
                {memberCoupons.length ? (
                  <div className="store-pos-coupon-panel">
                    <div className="store-pos-coupon-head">
                      <span><Gift size={14} /> 利用可能クーポン</span>
                      {shouldShowRecommendedCoupon && recommendedCoupon ? (
                        <button type="button" onClick={() => setSelectedCouponId(recommendedCoupon.id)}>
                          おすすめを適用
                        </button>
                      ) : null}
                    </div>
                    {shouldShowRecommendedCoupon && recommendedCoupon ? (
                      <p className="store-pos-coupon-recommend">
                        {recommendedCouponExpiringSoon && recommendedCouponExpiryLabel
                          ? `${recommendedCoupon.name} は ${recommendedCouponExpiryLabel} です。有効期限が近いため優先利用を案内してください。`
                          : `${recommendedCoupon.name} の方が ${formatYen(Math.max(0, recommendedCouponDiscountAmount - selectedCouponDiscountAmount))} お得です。`}
                      </p>
                    ) : null}
                    <div className="store-pos-coupon-list">
                      {memberCoupons.map((coupon) => {
                        const discount = getCouponDiscountAmount(coupon, subtotal, getExchangeEligibleBodyAmounts(coupon));
                        const isSelected = selectedCouponId === coupon.id;
                        const isRecommended = recommendedCoupon?.id === coupon.id && discount > 0;
                        const isCustomerSelected = customerSelectedCouponId === coupon.id;
                        const isUnavailable = couponBlockedByDiscount || (subtotal > 0 && discount <= 0);
                        const expiryLabel = getCouponExpiryLabel(coupon);
                        const expiringSoon = isCouponExpiringSoon(coupon);
                        const couponBadges = [
                          couponBlockedByDiscount ? "割引中は併用不可" : "",
                          isCustomerSelected ? "客さま選択済み" : "",
                          expiringSoon && expiryLabel ? `期限優先 ${expiryLabel}` : expiryLabel ? `期限 ${expiryLabel}` : "",
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
                    POS背面
                  </button>
                  <button className="secondary-button store-pos-member-scan-button" type="button" onClick={() => void openCustomerDisplayMemberScanner()} disabled={!selectedStoreId || customerDisplayScannerLoading}>
                    <ScanLine size={15} />
                    客席表示前面
                  </button>
                </div>
                <small>POS 本体または客席表示の前面カメラで会員 QR を読み取れます。</small>
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
                  disabled={offlineCheckoutOnly || (subtotal > 0 && discount <= 0)}
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
            {offlineCheckoutOnly ? (
              <small>オフライン中は割引を利用できません。</small>
            ) : selectedDiscountPreset ? (
              <small>
                {getDiscountTargetLabel(selectedDiscountPreset)}
                {selectedDiscountPreset.allowCouponCombination ? " / クーポン併用可" : " / クーポン併用不可"}
                {selectedDiscountPreset.stampEligible ? " / スタンプ対象" : " / スタンプ対象外"}
              </small>
            ) : null}
          </div>

          <div className="store-pos-payment-grid" id="store-pos-payment-section" ref={checkoutSectionRef}>
            {paymentOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  className={paymentMethod === option.value ? "is-active" : ""}
                  type="button"
                  disabled={offlineCheckoutOnly && option.value !== "cash"}
                  onClick={() => setPaymentMethod(option.value)}
                  title={offlineCheckoutOnly && option.value !== "cash" ? "オフライン中は現金のみ利用できます" : undefined}
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
                  onChange={(event) => setCashTenderedAmount(normalizeIntegerInput(event.target.value))}
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
            {selectedTableCheckout ? (
              <>
                <span>QR追加会計</span>
                <strong>{formatYen(tableCheckoutAmount)}</strong>
                <span>対象</span>
                <strong className="is-tax">{selectedTableCheckout.tableLabel}</strong>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
          <div className="store-pos-checkout-actions">
            <button className="danger-button store-pos-cancel-transaction" type="button" onClick={cancelCurrentTransaction} disabled={!hasCurrentTransaction || saving}>
              会計を中止
            </button>
            <button
              className={receiptRequested ? "secondary-button store-pos-receipt-request is-active" : "secondary-button store-pos-receipt-request"}
              type="button"
              onClick={() => setReceiptRequested((current) => !current)}
              disabled={saving}
              aria-pressed={receiptRequested}
            >
              <ReceiptText size={16} />
              領収書
            </button>
            <button className="primary-button store-pos-checkout" type="button" onClick={checkout} disabled={!canCheckout}>
              {saving ? "保存中..." : "会計を確定"}
            </button>
          </div>
        </aside>
      </section>

      {hasCurrentTransaction ? (
        <aside className="store-pos-floating-checkout" aria-label="会計ショートカット">
          <div>
            <span>{selectedTableCheckout ? `${selectedTableCheckout.orderCount}件のテーブル会計` : `${cartCount}点を選択中`}</span>
            <strong>{formatYen(activeCheckoutAmount)}</strong>
          </div>
          <button
            className="primary-button"
            type="button"
            aria-controls="store-pos-payment-section"
            onClick={revealCheckoutSection}
            disabled={saving}
          >
            <ShoppingCart size={18} />
            会計へ
          </button>
        </aside>
      ) : null}

      {memberScannerOpen && !offlineCheckoutOnly ? (
        <ModalHistoryScope historyKey="store-pos-member-scanner" onClose={() => setMemberScannerOpen(false)}>
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
        </ModalHistoryScope>
      ) : null}

      {transactionDialogOpen && !offlineCheckoutOnly ? (
        <ModalHistoryScope historyKey="store-pos-transactions" onClose={() => setTransactionDialogOpen(false)}>
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
                          const { canRefund: canRecordItemReturn, hasCouponBenefit, isRefunded: isItemRefunded, paidAmount } = getRefundItemState(item);
                          const isSelectedForRefund = selectedRefundItemIds.includes(item.id);
                          const selectionDisabled = !canRefundSelectedTransaction || refundSaving || isItemRefunded || !canRecordItemReturn;
                          return (
                            <button
                              key={item.id}
                              className={[
                                "store-pos-transaction-item-choice",
                                isItemRefunded ? "is-refunded" : "",
                                isSelectedForRefund ? "is-selected" : "",
                                !canRecordItemReturn ? "is-static" : ""
                              ].filter(Boolean).join(" ")}
                              type="button"
                              onClick={() => setSelectedRefundItemIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                              disabled={selectionDisabled}
                            >
                              <div>
                                <strong>{item.name}</strong>
                                {weightLabel ? <small>{weightLabel}</small> : null}
                                {modifiers.length ? <small>{modifiers.join(" / ")}</small> : null}
                                <span>{weightLabel ? formatYen(item.amount) : `${formatYen(Math.round(item.amount / Math.max(1, item.quantity)))} x ${item.quantity}`}</span>
                                {item.discountAmount || item.couponDiscountAmount ? (
                                  <small>
                                    {item.discountAmount ? `割引 -${formatYen(item.discountAmount)}` : ""}
                                    {item.discountAmount && item.couponDiscountAmount ? " / " : ""}
                                    {item.couponDiscountAmount ? `クーポン -${formatYen(item.couponDiscountAmount)}` : ""}
                                  </small>
                                ) : null}
                                {hasCouponBenefit && !isItemRefunded ? <small>返品記録時にクーポンを自動復元</small> : null}
                                {isItemRefunded ? <small>返金済み {formatYen(item.refundedAmount)}{item.refundReason ? ` / ${item.refundReason}` : ""}</small> : null}
                              </div>
                              <div className="store-pos-transaction-item-actions">
                                <b>{formatYen(paidAmount)}</b>
                                <small>{isSelectedForRefund ? "返品する" : canRecordItemReturn ? "保留" : "返金対象外"}</small>
                              </div>
                            </button>
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
                            ? selectedTransaction.paymentMethod === "cash"
                              ? "返品しない商品は上の商品明細で外してください。"
                              : "外部決済は端末側の返金完了を確認してから記録してください。"
                            : selectedTransaction.cashSessionStatus !== "open"
                              ? "締め済みのレジ会計は管理画面で修正してください。"
                              : "この会計はすでに返金済みです。"}
                        </span>
                      </div>
                      {selectedTransaction.paymentMethod !== "cash" ? (
                        <label className="store-pos-external-refund-check">
                          <input
                            type="checkbox"
                            checked={externalRefundConfirmed}
                            onChange={(event) => setExternalRefundConfirmed(event.target.checked)}
                            disabled={!canRefundSelectedTransaction || refundSaving}
                          />
                          <span>外部決済端末で返金操作を完了しました</span>
                        </label>
                      ) : null}
                      {selectedTransaction.refundReason ? <small>返金理由: {selectedTransaction.refundReason}</small> : null}
                      <div className={selectedRefundItems.length ? "store-pos-selected-refund-item is-selected" : "store-pos-selected-refund-item"}>
                        <span>返品対象</span>
                        <strong>{selectedRefundItems.length ? `${selectedRefundItems.length} 件を返品` : "返品する商品がありません"}</strong>
                        <small>
                          {selectedRefundItems.length
                            ? `${selectedRefundPaidAmount > 0 ? `返金 ${formatYen(selectedRefundPaidAmount)}` : "返金なし"}${selectedRefundCouponCount ? ` / クーポン ${selectedRefundCouponCount}件を自動復元` : ""}`
                            : "返品しない商品だけを残し、返品する商品を選択状態にしてください。"}
                        </small>
                      </div>
                      <label>
                        <span>理由</span>
                        <input value={refundReason} onChange={(event) => setRefundReason(event.target.value)} placeholder="任意" disabled={!canRefundSelectedTransaction || refundSaving} />
                      </label>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => void refundTransaction(selectedRefundItems.map((item) => item.id))}
                        disabled={!canRefundSelectedItem || refundSaving || (selectedItemRefundNeedsExternalConfirmation && !externalRefundConfirmed)}
                      >
                        {refundSaving && refundingTransactionId === selectedTransaction.id
                          ? "返品処理中..."
                          : selectedRefundItems.length
                            ? selectedRefundPaidAmount > 0
                              ? "選択した商品を返金"
                              : "返品を記録"
                            : "返品する商品がありません"}
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
            </div>
          </div>
        </ModalHistoryScope>
      ) : null}

      {cashDialog && !offlineCheckoutOnly ? (
        <ModalHistoryScope historyKey="store-pos-cash" onClose={() => setCashDialog(null)}>
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
                  <input inputMode="numeric" value={cashMovementAmount} onChange={(event) => setCashMovementAmount(normalizeIntegerInput(event.target.value))} placeholder="0" />
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
                      <option value="">締め責任者の候補がいません</option>
                    ) : (
                      reconciliation.activeCashResponsibleEmployees.map((employee) => (
                        <option key={employee.id} value={employee.id}>{getCashResponsibleEmployeeLabel(employee)}</option>
                      ))
                    )}
                  </select>
                </label>
                <label>
                  <span>差額理由</span>
                  <input value={cashClosingNote} onChange={(event) => setCashClosingNote(event.target.value)} placeholder={closingDifference ? "差額がある場合は必須" : "任意"} />
                </label>
                <button className="primary-button" type="button" onClick={() => submitCashAction("close")} disabled={cashSaving || !canCloseRegister || offlinePendingCount > 0}>
                  レジ締め
                </button>
              </div>
            ) : null}
            </div>
          </div>
        </ModalHistoryScope>
      ) : null}

      {configuringItem ? (
        <ModalHistoryScope historyKey="store-pos-item-options" onClose={() => setConfiguringItem(null)}>
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
                    onChange={(event) => setWeightDraft(normalizeDecimalInput(event.target.value))}
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
                          <div
                            className={selected ? "store-pos-option-choice is-active" : "store-pos-option-choice"}
                            key={option.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleOption(group, option.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                toggleOption(group, option.id);
                              }
                            }}
                          >
                            <button
                              type="button"
                              tabIndex={-1}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleOption(group, option.id);
                              }}
                            >
                              <span>{option.name}</span>
                              {getOptionPrice(option) ? <small>{formatYen(getOptionPrice(option))}</small> : <small>+¥0</small>}
                            </button>
                            {selectionType === "quantity" ? (
                              <div className="store-pos-option-stepper">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    decrementOption(group, option.id);
                                  }}
                                  aria-label="数量を減らす"
                                >
                                  <Minus size={14} />
                                </button>
                                <span>{count}</span>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleOption(group, option.id);
                                  }}
                                  aria-label="数量を増やす"
                                >
                                  <Plus size={14} />
                                </button>
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
        </ModalHistoryScope>
      ) : null}
    </main>
  );
}
