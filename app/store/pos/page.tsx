"use client";

import { Banknote, CreditCard, ExternalLink, Minus, MonitorSmartphone, Plus, ReceiptText, Search, ShoppingCart, Trash2 } from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
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
  category: string;
  imageUrl: string;
  basePrice: number | null;
  priceOverride: number | null;
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

type PosSettings = {
  dineInEnabled: boolean;
  dineInTaxRate: number;
  takeoutTaxRate: number;
  externalPaymentTerminalBrand: string;
  priceTaxMode: string;
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

function formatYen(value: number) {
  return `¥${Math.round(value || 0).toLocaleString("ja-JP")}`;
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
  const [access, setAccess] = useState<PosAccess | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [categories, setCategories] = useState<PosMenuCategory[]>([]);
  const [items, setItems] = useState<PosMenuItem[]>([]);
  const [optionGroups, setOptionGroups] = useState<PosOptionGroup[]>([]);
  const [summary, setSummary] = useState<PosSummary>({ orderCount: 0, total: 0, average: 0, latestOrders: [] });
  const [posSettings, setPosSettings] = useState<PosSettings>({ dineInEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: "PayCAS", priceTaxMode: "tax_included" });
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [configuringItem, setConfiguringItem] = useState<PosMenuItem | null>(null);
  const [optionDraft, setOptionDraft] = useState<Record<string, string[]>>({});
  const [orderType, setOrderType] = useState("eat_in");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashTenderedAmount, setCashTenderedAmount] = useState("");
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
    setAccess(nextAccess);
    setStores(nextAccess.stores ?? []);
    setBrands(nextBrands ?? []);
    setCategories((body.categories ?? []) as PosMenuCategory[]);
    setItems(nextItems ?? []);
    setOptionGroups((body.optionGroups ?? []) as PosOptionGroup[]);
    setSummary((body.todaySummary ?? { orderCount: 0, total: 0, average: 0, latestOrders: [] }) as PosSummary);
    const nextPosSettings = {
      dineInEnabled: body.posSettings?.dineInEnabled !== false,
      dineInTaxRate: Number(body.posSettings?.dineInTaxRate ?? 10),
      takeoutTaxRate: Number(body.posSettings?.takeoutTaxRate ?? 8),
      externalPaymentTerminalBrand: body.posSettings?.externalPaymentTerminalBrand ?? "PayCAS",
      priceTaxMode: body.posSettings?.priceTaxMode ?? "tax_included"
    };
    setPosSettings(nextPosSettings);
    setOrderType((current) => nextPosSettings.dineInEnabled ? current : "takeout");
    const responseStoreId = body.selectedStoreId || nextAccess.stores?.[0]?.id || "";
    setSelectedStoreId(responseStoreId);
    if (responseStoreId) setStoredStoreSelection(responseStoreId);
    await loadReconciliation(responseStoreId);
    setSelectedBrandId((current) => current || nextBrands?.[0]?.id || "");
    setSelectedCategory((current) => current ?? (nextItems?.[0]?.category || "未分類"));
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
    const hasDialog = Boolean(configuringItem) || transactionDialogOpen || Boolean(cashDialog);
    if (!hasDialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [cashDialog, configuringItem, transactionDialogOpen]);

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

  const subtotal = cart.reduce((sum, item) => sum + (getItemPrice(item) + item.optionTotal) * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const canUseRegister = Boolean(reconciliation.activeSession);
  const cashTenderedValue = Number(cashTenderedAmount || 0);
  const cashChangeAmount = paymentMethod === "cash" && cashTenderedAmount.trim() ? cashTenderedValue - subtotal : null;
  const canCheckout = Boolean(
    cart.length > 0 &&
    !saving &&
    canUseRegister &&
    (paymentMethod !== "cash" || (cashTenderedAmount.trim() !== "" && cashTenderedValue >= subtotal))
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

  function getItemOptionGroups(item: PosMenuItem) {
    return optionGroups
      .filter((group) => group.brandId === item.brandId && (!group.menuCatalogItemId || group.menuCatalogItemId === item.id))
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

  function getCartKey(item: PosMenuItem, options: PosSelectedOption[]) {
    const optionKey = options.map((option) => `${option.groupId}:${option.id}`).sort().join("|");
    return `${item.id}::${optionKey}`;
  }

  function addItem(item: PosMenuItem, selectedOptions: PosSelectedOption[] = []) {
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    const optionTotal = selectedOptions.reduce((sum, option) => sum + getOptionPrice(option), 0);
    const cartKey = getCartKey(item, selectedOptions);
    setCart((current) => {
      const existing = current.find((entry) => entry.cartKey === cartKey);
      if (existing) {
        return current.map((entry) => entry.cartKey === cartKey ? { ...entry, quantity: entry.quantity + 1 } : entry);
      }
      return [...current, { ...item, cartKey, quantity: 1, selectedOptions, optionTotal }];
    });
  }

  function beginItemSelection(item: PosMenuItem) {
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    const groups = getItemOptionGroups(item);
    if (!groups.length) {
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
    addItem(configuringItem, selectedOptions);
    setConfiguringItem(null);
    setOptionDraft({});
  }

  function changeQuantity(cartKey: string, amount: number) {
    setCart((current) => current
      .map((item) => item.cartKey === cartKey ? { ...item, quantity: item.quantity + amount } : item)
      .filter((item) => item.quantity > 0));
  }

  async function checkout() {
    if (!selectedStoreId || cart.length === 0 || saving) return;
    if (!canUseRegister) {
      setMessage("POS 会計の前に開店前のレジ金額を確認してください。");
      return;
    }
    if (paymentMethod === "cash" && (cashTenderedAmount.trim() === "" || cashTenderedValue < subtotal)) {
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
          note,
          items: cart.map((item) => ({
            menuCatalogItemId: item.id,
            quantity: item.quantity,
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
      setSummary(body.todaySummary as PosSummary);
      if (transactionDialogOpen) await loadTransactions();
      await loadReconciliation(selectedStoreId);
      const changeLabel = paymentMethod === "cash" ? ` / お釣り ${formatYen(body.cashChangeAmount ?? cashTenderedValue - body.amount)}` : "";
      setMessage(`会計を保存しました。${body.pickupCode} / ${formatYen(body.amount)}${changeLabel}`);
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
          unitPrice: getItemPrice(item) + item.optionTotal,
          amount: (getItemPrice(item) + item.optionTotal) * item.quantity
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
        subtotal,
        cashTenderedAmount: paymentMethod === "cash" && cashTenderedAmount.trim() ? cashTenderedValue : null,
        cashChangeAmount: paymentMethod === "cash" && cashChangeAmount !== null ? cashChangeAmount : null,
        items: cart.map((item) => ({
          name: item.name,
          optionLabel: getOptionLabel(item.selectedOptions),
          quantity: item.quantity,
          unitPrice: getItemPrice(item) + item.optionTotal,
          amount: (getItemPrice(item) + item.optionTotal) * item.quantity
        }))
      });
    }, 180);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, cashTenderedAmount, completedDisplayState, orderType, paymentMethod, posSettings.externalPaymentTerminalBrand, selectedStoreId, subtotal, canUseRegister]);

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
            {reconciliation.businessState
              ? `${reconciliation.businessState.statusLabel} / 営業日 ${reconciliation.businessState.businessDate}`
              : reconciliation.businessDate || "-"}
          </small>
        </div>
        <div>
          <span>システム上の現金</span>
          <strong>{reconciliation.activeSession ? formatYen(reconciliation.activeSession.expectedCashAmount) : "-"}</strong>
          <small>
            {reconciliation.activeSession
              ? `開始 ${formatYen(reconciliation.activeSession.openingAmount)} / 現金売上 ${formatYen(reconciliation.activeSession.cashSales)}`
              : "開店確認後に POS 会計を開始できます。"}
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
                      <em>{formatYen(getItemPrice(item))}</em>
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
              <a className="secondary-button store-pos-display-link" href={`/store/pos/customer-display${selectedStoreId ? `?storeId=${selectedStoreId}` : ""}`} target="_blank" rel="noreferrer">
                <MonitorSmartphone size={16} />
                客席表示
                <ExternalLink size={14} />
              </a>
              <strong>{cartCount} 点</strong>
            </div>
          </div>

          <div className="store-pos-segmented">
            {visibleOrderTypeOptions.map((option) => (
              <button key={option.value} className={orderType === option.value ? "is-active" : ""} type="button" onClick={() => setOrderType(option.value)}>
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
                  {item.selectedOptions.length ? <small>{getOptionLabel(item.selectedOptions)}</small> : null}
                  <span>{formatYen(getItemPrice(item) + item.optionTotal)} x {item.quantity}</span>
                </div>
                <div className="store-pos-quantity">
                  <button type="button" onClick={() => changeQuantity(item.cartKey, -1)} aria-label="数量を減らす"><Minus size={16} /></button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => changeQuantity(item.cartKey, 1)} aria-label="数量を増やす"><Plus size={16} /></button>
                  <button type="button" onClick={() => changeQuantity(item.cartKey, -99)} aria-label="削除"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>

          <label className="store-pos-note">
            <span>メモ</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="任意" />
          </label>

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
            <span>合計</span>
            <strong>{formatYen(subtotal)}</strong>
          </div>
          <button className="primary-button store-pos-checkout" type="button" onClick={checkout} disabled={!canCheckout}>
            {saving ? "保存中..." : "会計を確定"}
          </button>
        </aside>
      </section>

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
                          return (
                            <div key={item.id}>
                              <div>
                                <strong>{item.name}</strong>
                                {modifiers.length ? <small>{modifiers.join(" / ")}</small> : null}
                                <span>{formatYen(Math.round(item.amount / Math.max(1, item.quantity)))} x {item.quantity}</span>
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
                <span>基本価格 {formatYen(getItemPrice(configuringItem))}</span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setConfiguringItem(null)}>閉じる</button>
            </div>

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

            <button className="primary-button store-pos-option-add" type="button" onClick={addConfiguredItem}>
              この内容で追加
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
