"use client";

import { Banknote, CreditCard, Minus, Plus, ReceiptText, Search, ShoppingCart, Trash2 } from "lucide-react";
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

type PosAccess = {
  stores: StoreOption[];
  canUseAllStoreView: boolean;
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
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [configuringItem, setConfiguringItem] = useState<PosMenuItem | null>(null);
  const [optionDraft, setOptionDraft] = useState<Record<string, string[]>>({});
  const [orderType, setOrderType] = useState("eat_in");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [reconciliation, setReconciliation] = useState<PosReconciliation>({ businessDate: "", businessState: null, activeSession: null, sessions: [], movements: [], activeCashResponsibleEmployees: [] });
  const [cashOpeningBreakdown, setCashOpeningBreakdown] = useState(() => createCashBreakdownInput());
  const [cashMovementType, setCashMovementType] = useState("cash_out");
  const [cashMovementAmount, setCashMovementAmount] = useState("");
  const [cashMovementReason, setCashMovementReason] = useState("");
  const [cashCountedBreakdown, setCashCountedBreakdown] = useState(() => createCashBreakdownInput());
  const [cashClosingNote, setCashClosingNote] = useState("");
  const [cashClosingResponsibleEmployeeId, setCashClosingResponsibleEmployeeId] = useState("");
  const [cashSaving, setCashSaving] = useState(false);

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

  const subtotal = cart.reduce((sum, item) => sum + (getItemPrice(item) + item.optionTotal) * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const canUseRegister = Boolean(reconciliation.activeSession);
  const openingBreakdownTotal = getCashBreakdownTotal(cashOpeningBreakdown);
  const countedBreakdownTotal = getCashBreakdownTotal(cashCountedBreakdown);
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
    const normalized = value.replace(/[^\d]/g, "").slice(0, 4);
    setter((current) => ({ ...current, [String(denomination)]: normalized }));
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
      setSummary(body.todaySummary as PosSummary);
      await loadReconciliation(selectedStoreId);
      setMessage(`会計を保存しました。${body.pickupCode} / ${formatYen(body.amount)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会計を保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function submitCashAction(action: "open" | "movement" | "close") {
    if (!selectedStoreId || cashSaving) return;
    setCashSaving(true);
    setMessage("");
    try {
      const payload = action === "open"
        ? { action, storeId: selectedStoreId, openingBreakdown: cashOpeningBreakdown }
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
        sessions: body.sessions ?? [],
        movements: body.movements ?? [],
        activeCashResponsibleEmployees: body.activeCashResponsibleEmployees ?? reconciliation.activeCashResponsibleEmployees
      });
      if (action === "open") {
        setCashOpeningBreakdown(createCashBreakdownInput());
        setMessage("日次レジ締めを開始しました。");
      } else if (action === "movement") {
        setCashMovementAmount("");
        setCashMovementReason("");
        setMessage(cashMovementType === "cash_in" ? "入金を記録しました。" : "出金を記録しました。");
      } else {
        setCashCountedBreakdown(createCashBreakdownInput());
        setCashClosingNote("");
        setCashClosingResponsibleEmployeeId("");
        setMessage("日次レジ締めを締めました。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "レジ締めを保存できませんでした。");
    } finally {
      setCashSaving(false);
    }
  }

  return (
    <main className="store-workbench-shell store-pos-page">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Store</p>
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
        <div className="store-pos-summary">
          <span>本日 {summary.orderCount} 件</span>
          <strong>{formatYen(summary.total)}</strong>
          <small>平均 {formatYen(summary.average)}</small>
        </div>
      </section>

      {message ? <div className="action-notice store-pos-notice">{message}</div> : null}

      <section className="store-pos-cash-panel">
        <div className="store-pos-cash-title">
          <div>
            <p className="eyebrow">Daily Cash</p>
            <h3>日次レジ締め</h3>
          </div>
          <span>{reconciliation.businessDate || "-"}</span>
        </div>
        {reconciliation.businessState ? (
          <div className={`store-pos-business-state is-${reconciliation.businessState.tone}`}>
            <div>
              <span>営業日 {reconciliation.businessState.businessDate}</span>
              <strong>{reconciliation.businessState.statusLabel}</strong>
            </div>
            <p>{reconciliation.businessState.openLabel} - {reconciliation.businessState.closeLabel}</p>
            <small>{reconciliation.businessState.detailLabel}</small>
          </div>
        ) : null}

        {reconciliation.activeSession ? (
          <div className="store-pos-cash-active">
            <div className="store-pos-cash-metrics">
              <div>
                <span>開始金額</span>
                <strong>{formatYen(reconciliation.activeSession.openingAmount)}</strong>
              </div>
              <div>
                <span>現金売上</span>
                <strong>{formatYen(reconciliation.activeSession.cashSales)}</strong>
              </div>
              <div>
                <span>入金 / 出金</span>
                <strong>{formatYen(reconciliation.activeSession.cashIn)} / {formatYen(reconciliation.activeSession.cashOut)}</strong>
              </div>
              <div>
                <span>システム上の現金</span>
                <strong>{formatYen(reconciliation.activeSession.expectedCashAmount)}</strong>
              </div>
            </div>

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
                      <input
                        inputMode="numeric"
                        value={cashCountedBreakdown[String(denomination)] ?? ""}
                        onChange={(event) => updateCashBreakdown(setCashCountedBreakdown, denomination, event.target.value)}
                        placeholder="0"
                      />
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
          </div>
        ) : (
          <div className="store-pos-cash-start">
            <ReceiptText size={18} />
            <div>
              <strong>今日のレジ締めはまだ開始されていません。</strong>
              <span>POS 会計を始める前に、開店前のレジ金額を確認してください。</span>
            </div>
            <div className="store-pos-denomination-panel">
              <div className="store-pos-denomination-head">
                <span>開始金額</span>
                <strong>{formatYen(openingBreakdownTotal)}</strong>
              </div>
              <div className="store-pos-denomination-grid">
                {yenDenominations.map((denomination) => (
                  <label key={denomination}>
                    <span>{formatDenominationLabel(denomination)}</span>
                    <input
                      inputMode="numeric"
                      value={cashOpeningBreakdown[String(denomination)] ?? ""}
                      onChange={(event) => updateCashBreakdown(setCashOpeningBreakdown, denomination, event.target.value)}
                      placeholder="0"
                    />
                  </label>
                ))}
              </div>
            </div>
            <button className="primary-button" type="button" onClick={() => submitCashAction("open")} disabled={cashSaving}>
              開始
            </button>
          </div>
        )}
      </section>

      <section className="store-pos-layout">
        <div className="store-pos-menu-panel">
          <aside className="store-pos-filter-panel">
            <label>
              <span>店舗</span>
              <select
                value={selectedStoreId}
                onChange={(event) => {
                  const storeId = event.target.value;
                  setSelectedStoreId(storeId);
                  setStoredStoreSelection(storeId);
                  setCart([]);
                  void load(storeId);
                }}
                disabled={!access?.canUseAllStoreView && stores.length <= 1}
              >
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>

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
            <strong>{cartCount} 点</strong>
          </div>

          <div className="store-pos-segmented">
            {orderTypeOptions.map((option) => (
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
                <button key={option.value} className={paymentMethod === option.value ? "is-active" : ""} type="button" onClick={() => setPaymentMethod(option.value)}>
                  <Icon size={18} />
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="store-pos-total">
            <span>合計</span>
            <strong>{formatYen(subtotal)}</strong>
          </div>
          <button className="primary-button store-pos-checkout" type="button" onClick={checkout} disabled={cart.length === 0 || saving || !canUseRegister}>
            {saving ? "保存中..." : "会計を確定"}
          </button>
        </aside>
      </section>

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
