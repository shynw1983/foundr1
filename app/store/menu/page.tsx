"use client";

import { CheckCircle2, RotateCcw, Search, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";

type StoreOption = {
  id: string;
  name: string;
};

type StoreMenuAccess = {
  canUseAllStoreView: boolean;
  stores: StoreOption[];
};

type BrandOption = {
  id: string;
  name: string;
};

type StoreMenuCategory = {
  id: string;
  brandId: string;
  name: string;
  sortOrder: number;
};

type StoreMenuItem = {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  category: string;
  imageUrl: string;
  basePrice: number | null;
  websiteEnabled: boolean;
  posEnabled: boolean;
  deliveryEnabled: boolean;
  isAvailable: boolean;
  priceOverride: number | null;
  statusNote: string;
};

type StoreMenuOption = {
  id: string;
  brandId: string;
  brandName: string;
  groupId: string;
  groupName: string;
  groupKey: string;
  name: string;
  priceDelta: number | null;
  isAvailable: boolean;
  statusNote: string;
};

type StoreMenuCategorySummary = {
  name: string;
  sortOrder: number;
  count: number;
};

function getCategories(items: StoreMenuItem[], categories: StoreMenuCategory[], brandId: string): StoreMenuCategorySummary[] {
  const counts = new Map<string, number>();
  const masters = new Map<string, StoreMenuCategory>();

  for (const item of items) {
    const name = item.category || "未分類";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  for (const category of categories) {
    if (brandId && category.brandId !== brandId) continue;
    masters.set(category.name, category);
    if (!counts.has(category.name)) counts.set(category.name, 0);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({
      name,
      count,
      sortOrder: masters.get(name)?.sortOrder ?? 9999
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
}

export default function StoreMenuPage() {
  const [access, setAccess] = useState<StoreMenuAccess | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [categories, setCategories] = useState<StoreMenuCategory[]>([]);
  const [items, setItems] = useState<StoreMenuItem[]>([]);
  const [options, setOptions] = useState<StoreMenuOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");

  async function load(nextStoreId = selectedStoreId, resetFilters = false) {
    setLoading(true);
    const params = new URLSearchParams();
    if (nextStoreId) params.set("storeId", nextStoreId);
    const response = await fetch(`/api/store/menu-settings${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
    if (!response.ok) {
      setMessage("販売状態を読み込めませんでした。");
      setLoading(false);
      return;
    }

    const body = await response.json();
    const nextAccess = body.access as StoreMenuAccess;
    const nextBrands = body.brands as BrandOption[];
    const nextCategories = body.categories as StoreMenuCategory[];
    const nextItems = body.items as StoreMenuItem[];
    const nextOptions = body.options as StoreMenuOption[];
    setAccess(nextAccess);
    setStores(nextAccess.stores ?? []);
    setBrands(nextBrands ?? []);
    setCategories(nextCategories ?? []);
    setItems(nextItems ?? []);
    setOptions(nextOptions ?? []);
    setSelectedStoreId(body.selectedStoreId || nextAccess.stores?.[0]?.id || "");
    setSelectedBrandId((current) => resetFilters ? (nextBrands?.[0]?.id || "") : (current || nextBrands?.[0]?.id || ""));
    setSelectedCategory((current) => resetFilters ? (nextItems?.[0]?.category || "未分類") : (current ?? (nextItems?.[0]?.category || "未分類")));
    setMessage("");
    setLoading(false);
  }

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (selectedBrandId && item.brandId !== selectedBrandId) return false;
      if (selectedCategory !== null && (item.category || "未分類") !== selectedCategory) return false;
      if (normalizedQuery && !item.name.toLowerCase().includes(normalizedQuery)) return false;
      return true;
    });
  }, [items, query, selectedBrandId, selectedCategory]);

  const categoryItems = useMemo(() => items.filter((item) => !selectedBrandId || item.brandId === selectedBrandId), [items, selectedBrandId]);
  const categorySummaries = useMemo(() => getCategories(categoryItems, categories, selectedBrandId), [categories, categoryItems, selectedBrandId]);
  const visibleOptions = useMemo(() => options.filter((option) => !selectedBrandId || option.brandId === selectedBrandId), [options, selectedBrandId]);

  async function saveItem(item: StoreMenuItem, patch: Partial<StoreMenuItem>) {
    const nextItem = { ...item, ...patch };
    setItems((current) => current.map((entry) => entry.id === item.id ? nextItem : entry));
    setSavingId(item.id);
    setMessage("");
    try {
      const response = await fetch("/api/store/menu-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStoreId,
          menuCatalogItemId: item.id,
          isAvailable: nextItem.isAvailable,
          statusNote: nextItem.statusNote
        })
      });
      if (!response.ok) throw new Error("save failed");
      setMessage("更新しました。");
    } catch {
      setItems((current) => current.map((entry) => entry.id === item.id ? item : entry));
      setMessage("保存できませんでした。");
    } finally {
      setSavingId("");
    }
  }

  async function saveOption(option: StoreMenuOption, patch: Partial<StoreMenuOption>) {
    const nextOption = { ...option, ...patch };
    setOptions((current) => current.map((entry) => entry.id === option.id ? nextOption : entry));
    setSavingId(option.id);
    setMessage("");
    try {
      const response = await fetch("/api/store/menu-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "option",
          storeId: selectedStoreId,
          menuOptionId: option.id,
          isAvailable: nextOption.isAvailable,
          statusNote: nextOption.statusNote
        })
      });
      if (!response.ok) throw new Error("save failed");
      setMessage("更新しました。");
    } catch {
      setOptions((current) => current.map((entry) => entry.id === option.id ? option : entry));
      setMessage("保存できませんでした。");
    } finally {
      setSavingId("");
    }
  }

  function selectStore(storeId: string) {
    setSelectedStoreId(storeId);
    void load(storeId, true);
  }

  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Store</p>
            <h1>販売状態</h1>
          </div>
        </a>
        <StoreNavTabs active="menu" />
      </header>

      <section className="store-menu-page">
        <div className="store-menu-head panel">
          <div>
            <p className="eyebrow">Daily Availability</p>
            <h2>本日の販売状態</h2>
            <p>売切や販売再開を店舗現場で更新します。メニュー名、価格、選択肢は OS のメニュー管理で編集します。</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => void load(selectedStoreId)}>
            <RotateCcw size={16} />
            更新
          </button>
        </div>

        <div className="store-menu-controls panel">
          <label>
            <span>店舗</span>
            <select value={selectedStoreId} onChange={(event) => selectStore(event.target.value)} disabled={!access?.canUseAllStoreView && stores.length <= 1}>
              {stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
            </select>
          </label>
          <label>
            <span>ブランド</span>
            <select value={selectedBrandId} onChange={(event) => {
              setSelectedBrandId(event.target.value);
              setSelectedCategory(null);
            }}>
              <option value="">すべて</option>
              {brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}
            </select>
          </label>
          <label className="store-menu-search">
            <span>検索</span>
            <div>
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名" />
            </div>
          </label>
        </div>

        {message ? <div className="inline-alert">{message}</div> : null}

        <div className="store-menu-layout">
          <aside className="panel store-menu-category-panel">
            <button
              className={selectedCategory === null ? "menu-category-button is-active" : "menu-category-button"}
              type="button"
              onClick={() => setSelectedCategory(null)}
            >
              <span>すべて</span>
              <strong>{categoryItems.length}</strong>
            </button>
            {categorySummaries.map((category) => {
              return (
                <button
                  className={selectedCategory === category.name ? "menu-category-button is-active" : "menu-category-button"}
                  type="button"
                  onClick={() => setSelectedCategory(category.name)}
                  key={category.name}
                >
                  <span>{category.name}</span>
                  <strong>{category.count}</strong>
                </button>
              );
            })}
          </aside>

          <section className="panel store-menu-items-panel">
            <div className="store-menu-list-head">
              <h2>{selectedCategory ?? "すべて"}</h2>
              <span className="status-pill">{visibleItems.length}件</span>
            </div>
            {visibleOptions.length ? (
              <section className="store-menu-option-section">
                <div className="store-menu-list-head">
                  <h3>オプション・トッピング</h3>
                  <span className="status-pill">{visibleOptions.length}件</span>
                </div>
                <div className="store-menu-item-list">
                  {visibleOptions.map((option) => (
                    <article className="store-menu-item-row store-menu-option-row" key={option.id}>
                      <div className="store-menu-item-main">
                        <div className="store-menu-image-empty">OP</div>
                        <div>
                          <strong>{option.name}</strong>
                          <span>{option.brandName} / {option.groupName}</span>
                          <small>{option.priceDelta ? `${option.priceDelta > 0 ? "+" : ""}${option.priceDelta}円` : "追加料金なし"}</small>
                        </div>
                      </div>
                      <div className="store-menu-status-actions">
                        <button
                          className={option.isAvailable ? "store-status-button is-on" : "store-status-button"}
                          type="button"
                          disabled={savingId === option.id}
                          onClick={() => void saveOption(option, { isAvailable: true })}
                        >
                          <CheckCircle2 size={17} />
                          販売中
                        </button>
                        <button
                          className={!option.isAvailable ? "store-status-button is-off" : "store-status-button"}
                          type="button"
                          disabled={savingId === option.id}
                          onClick={() => void saveOption(option, { isAvailable: false })}
                        >
                          <XCircle size={17} />
                          売切
                        </button>
                      </div>
                      <div className="store-menu-note">
                        <input
                          value={option.statusNote}
                          onChange={(event) => setOptions((current) => current.map((entry) => (
                            entry.id === option.id ? { ...entry, statusNote: event.target.value } : entry
                          )))}
                          placeholder="例: 豆乳在庫切れ"
                        />
                        <button className="secondary-button" type="button" disabled={savingId === option.id} onClick={() => void saveOption(option, {})}>
                          メモ保存
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
            <div className="store-menu-item-list">
              {visibleItems.map((item) => (
                <article className="store-menu-item-row" key={item.id}>
                  <div className="store-menu-item-main">
                    {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <div className="store-menu-image-empty">No image</div>}
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.brandName} / {item.category || "未分類"}</span>
                      <small>
                        {item.priceOverride == null ? `${item.basePrice ?? 0}円` : `${item.priceOverride}円 店舗価格`}
                        {" / "}
                        Web {item.websiteEnabled ? "可" : "停止"} / POS {item.posEnabled ? "可" : "停止"}
                      </small>
                    </div>
                  </div>
                  <div className="store-menu-status-actions">
                    <button
                      className={item.isAvailable ? "store-status-button is-on" : "store-status-button"}
                      type="button"
                      disabled={savingId === item.id}
                      onClick={() => void saveItem(item, { isAvailable: true })}
                    >
                      <CheckCircle2 size={17} />
                      販売中
                    </button>
                    <button
                      className={!item.isAvailable ? "store-status-button is-off" : "store-status-button"}
                      type="button"
                      disabled={savingId === item.id}
                      onClick={() => void saveItem(item, { isAvailable: false })}
                    >
                      <XCircle size={17} />
                      売切
                    </button>
                  </div>
                  <div className="store-menu-note">
                    <input
                      value={item.statusNote}
                      onChange={(event) => setItems((current) => current.map((entry) => (
                        entry.id === item.id ? { ...entry, statusNote: event.target.value } : entry
                      )))}
                      placeholder="例: 15分後に再開予定"
                    />
                    <button className="secondary-button" type="button" disabled={savingId === item.id} onClick={() => void saveItem(item, {})}>
                      メモ保存
                    </button>
                  </div>
                </article>
              ))}
              {!visibleItems.length ? <p className="empty-state">{loading ? "読み込み中..." : "商品がありません。"}</p> : null}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
