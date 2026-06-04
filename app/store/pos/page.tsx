"use client";

import { Banknote, CreditCard, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
    return options.length
      ? options.map((option) => `${option.groupName}: ${option.name}`).join(" / ")
      : "";
  }

  function getCartKey(item: PosMenuItem, options: PosSelectedOption[]) {
    const optionKey = options.map((option) => `${option.groupId}:${option.id}`).sort().join("|");
    return `${item.id}::${optionKey}`;
  }

  function addItem(item: PosMenuItem, selectedOptions: PosSelectedOption[] = []) {
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
    const groups = getItemOptionGroups(item);
    if (!groups.length) {
      addItem(item);
      return;
    }
    const nextDraft: Record<string, string[]> = {};
    for (const group of groups) {
      if (group.selectionType === "single" && group.options.length) {
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
      if (group.selectionType === "single") {
        return { ...current, [group.id]: [optionId] };
      }
      return selected.includes(optionId)
        ? { ...current, [group.id]: selected.filter((id) => id !== optionId) }
        : { ...current, [group.id]: [...selected, optionId] };
    });
  }

  function addConfiguredItem() {
    if (!configuringItem) return;
    const selectedOptions = getItemOptionGroups(configuringItem).flatMap((group) => {
      const selectedIds = optionDraft[group.id] ?? [];
      return group.options
        .filter((option) => selectedIds.includes(option.id))
        .map((option) => ({ ...option, groupId: group.id, groupKey: group.groupKey, groupName: group.name }));
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
      setMessage(`会計を保存しました。${body.pickupCode} / ${formatYen(body.amount)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会計を保存できませんでした。");
    } finally {
      setSaving(false);
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

      {message ? <div className="action-notice">{message}</div> : null}

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

            {loading ? (
              <div className="store-pos-empty">読み込み中...</div>
            ) : visibleItems.length === 0 ? (
              <div className="store-pos-empty">POS で販売できる商品がありません。</div>
            ) : (
              <div className="store-pos-item-grid">
                {visibleItems.map((item) => (
                  <button key={item.id} className="store-pos-item-button" type="button" onClick={() => beginItemSelection(item)}>
                    {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="store-pos-image-empty">F1</span>}
                    <span>{item.category || item.brandName}</span>
                    <strong>{item.name}</strong>
                    <em>{formatYen(getItemPrice(item))}</em>
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
          <button className="primary-button store-pos-checkout" type="button" onClick={checkout} disabled={cart.length === 0 || saving}>
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
              {getItemOptionGroups(configuringItem).map((group) => (
                <section className="store-pos-option-group" key={group.id}>
                  <div>
                    <strong>{group.name}</strong>
                    <span>{group.selectionType === "single" ? "1つ選択" : "複数選択可"}</span>
                  </div>
                  <div className="store-pos-option-choice-grid">
                    {group.options.map((option) => {
                      const selected = (optionDraft[group.id] ?? []).includes(option.id);
                      return (
                        <button
                          key={option.id}
                          className={selected ? "is-active" : ""}
                          type="button"
                          onClick={() => toggleOption(group, option.id)}
                        >
                          <span>{option.name}</span>
                          {getOptionPrice(option) ? <small>{formatYen(getOptionPrice(option))}</small> : <small>+¥0</small>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
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
