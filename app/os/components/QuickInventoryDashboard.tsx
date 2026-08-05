"use client";

import { AlertTriangle, Check, ChevronRight, PackageSearch, PanelRightOpen, Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

type StoreOption = { id: string; name: string };
type LocationOption = { id: string; name: string };
type InventoryItem = {
  id: string;
  productName: string;
  category: string;
  locationId: string;
  locationName: string;
  currentQuantity: number | null;
  countUnit: string;
  exceptionCode: string;
};
type InventoryPayload = {
  stores: StoreOption[];
  selectedStoreId?: string;
  locations: LocationOption[];
  items: InventoryItem[];
};

export function QuickInventoryDashboard() {
  const drawerId = useId();
  const [data, setData] = useState<InventoryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadInventory() {
    setIsLoading(true);
    const response = await fetch("/api/inventory", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      setIsLoading(false);
      return;
    }
    const payload = await response.json() as InventoryPayload;
    setData(payload);
    setSelectedIds(new Set(payload.items.filter((item) => item.exceptionCode === "low").map((item) => item.id)));
    setIsLoading(false);
  }

  useEffect(() => {
    void loadInventory();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, isSaving]);

  const items = data?.items ?? [];
  const lowItems = items.filter((item) => item.exceptionCode === "low");
  const outItems = items.filter((item) => item.exceptionCode === "out");
  const editableItems = items.filter((item) => item.exceptionCode === "" || item.exceptionCode === "low");
  const normalizedQuery = query.trim().toLocaleLowerCase("ja-JP");
  const filteredItems = editableItems.filter((item) => {
    if (locationId !== "all" && item.locationId !== locationId) return false;
    if (!normalizedQuery) return true;
    return `${item.productName} ${item.category} ${item.locationName}`.toLocaleLowerCase("ja-JP").includes(normalizedQuery);
  });
  const originalLowIds = new Set(lowItems.map((item) => item.id));
  const hasChanges = selectedIds.size !== originalLowIds.size
    || Array.from(selectedIds).some((id) => !originalLowIds.has(id));
  const selectedStoreName = data?.stores.find((store) => store.id === data.selectedStoreId)?.name ?? "対象店舗";

  function openDrawer() {
    setSelectedIds(new Set(lowItems.map((item) => item.id)));
    setQuery("");
    setLocationId("all");
    setMessage("");
    setIsOpen(true);
  }

  function toggleItem(itemId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function saveLowStock() {
    if (!data?.selectedStoreId || !hasChanges || isSaving) return;
    setIsSaving(true);
    setMessage("");
    const originalIds = new Set(lowItems.map((item) => item.id));
    const lowItemIds = Array.from(selectedIds).filter((id) => !originalIds.has(id));
    const clearLowItemIds = Array.from(originalIds).filter((id) => !selectedIds.has(id));
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "batch_low_stock",
        storeId: data.selectedStoreId,
        lowItemIds,
        clearLowItemIds
      })
    }).catch(() => null);
    if (!response?.ok) {
      const body = await response?.json().catch(() => ({})) as { error?: string } | undefined;
      setMessage(body?.error ?? "在庫わずかを保存できませんでした。");
      setIsSaving(false);
      return;
    }
    await loadInventory();
    setIsSaving(false);
    setMessage("在庫確認と同期しました。");
  }

  if (!isLoading && !data) return null;

  return (
    <>
      <button
        type="button"
        className="os-quick-drawer-trigger"
        aria-expanded={isOpen}
        aria-controls={drawerId}
        title="クイック操作を開く"
        onClick={openDrawer}
      >
        <PanelRightOpen size={18} aria-hidden="true" />
        <span>クイック操作</span>
        {!isLoading && lowItems.length ? <b>{lowItems.length}</b> : null}
      </button>

      {isOpen ? (
        <div className="os-quick-drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSaving) setIsOpen(false);
        }}>
          <aside id={drawerId} className="os-quick-drawer" role="dialog" aria-modal="true" aria-labelledby={`${drawerId}-title`}>
            <header className="os-quick-stock-dialog-head">
              <div>
                <p className="eyebrow">{selectedStoreName}</p>
                <h2 id={`${drawerId}-title`}>クイック操作</h2>
                <p>よく使う操作を、この画面を離れずに処理できます。</p>
              </div>
              <button type="button" className="os-quick-stock-close" aria-label="閉じる" disabled={isSaving} onClick={() => setIsOpen(false)}>
                <X size={20} />
              </button>
            </header>

            <main className="os-quick-drawer-body">
              <div className="os-quick-drawer-summary">
                <div className="is-low">
                  <AlertTriangle size={17} />
                  <span>在庫わずか</span>
                  <strong>{lowItems.length}</strong>
                </div>
                <a href="/os/inventory">
                  <PackageSearch size={17} />
                  <span>在庫切れ</span>
                  <strong>{outItems.length}</strong>
                </a>
                <a href="/os/inventory">
                  <Check size={17} />
                  <span>在庫確認</span>
                  <ChevronRight size={16} />
                </a>
              </div>

              <section className="os-quick-drawer-picker" aria-labelledby="quick-stock-title">
                <div className="os-quick-drawer-picker-title">
                  <div>
                    <h3 id="quick-stock-title">在庫わずかを記録</h3>
                    <p>もうすぐ切れそうな商品をタップして選択します。</p>
                  </div>
                  <strong>{selectedIds.size} 商品</strong>
                </div>

                <div className="os-quick-stock-tools">
                  <label className="os-quick-stock-search">
                    <Search size={17} aria-hidden="true" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名・保管場所で検索" autoFocus />
                  </label>
                  <div className="os-quick-stock-filters" aria-label="保管場所で絞り込み">
                    <button type="button" className={locationId === "all" ? "is-active" : ""} onClick={() => setLocationId("all")}>すべて</button>
                    {(data?.locations ?? []).map((location) => (
                      <button type="button" className={locationId === location.id ? "is-active" : ""} key={location.id} onClick={() => setLocationId(location.id)}>
                        {location.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="os-quick-stock-list">
                  {filteredItems.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <button
                        type="button"
                        className={`os-quick-stock-item${isSelected ? " is-selected" : ""}`}
                        aria-pressed={isSelected}
                        key={item.id}
                        onClick={() => toggleItem(item.id)}
                      >
                        <span className="os-quick-stock-check" aria-hidden="true">{isSelected ? <Check size={16} /> : null}</span>
                        <span className="os-quick-stock-item-copy">
                          <strong>{item.productName}</strong>
                          <small>{item.category || "カテゴリ未設定"} / {item.locationName}</small>
                        </span>
                        <span className="os-quick-stock-quantity">
                          {item.currentQuantity === null ? "数量未確認" : `${item.currentQuantity} ${item.countUnit}`}
                        </span>
                      </button>
                    );
                  })}
                  {!filteredItems.length ? (
                    <div className="os-quick-stock-empty">
                      <strong>該当する商品がありません</strong>
                      <span>検索条件または保管場所を変更してください。</span>
                    </div>
                  ) : null}
                </div>
              </section>
            </main>

            <footer className="os-quick-stock-footer">
              <div>
                <strong>{hasChanges ? "未保存の変更があります" : "在庫データと同期済み"}</strong>
                <span>保存内容は在庫確認にも反映されます。</span>
                {message ? <em className={message.includes("同期") ? "is-success" : ""} role="status">{message}</em> : null}
              </div>
              <button type="button" className="primary-button" disabled={!hasChanges || isSaving} onClick={() => void saveLowStock()}>
                {isSaving ? "保存中..." : "変更を保存"}
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
