"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Maximize2,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  UserRoundCheck,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  defaultQuickDashboardPreferences,
  quickDashboardWidgetTypes,
  type QuickDashboardPreferences,
  type QuickDashboardWidget,
  type QuickDashboardWidgetType
} from "../../../lib/quick-dashboard";

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
type PresenceStaff = {
  employeeId: string;
  name: string;
  status: "working" | "break";
  clockInAt: string;
  latestPunchAt: string;
};
type QuickDashboardPayload = {
  stores: StoreOption[];
  selectedStoreId: string;
  canChangeGlobalStore: boolean;
  staff: PresenceStaff[];
  operation: {
    reservationsEnabled: boolean;
    acceptanceMode: "auto" | "force_open" | "force_closed";
    acceptanceModeChangedAt: string | null;
    statusNote: string;
    minimumPickupMinutes: number | null;
    receptionState?: { isAcceptingNow?: boolean; isWithinBusinessHours?: boolean };
  } | null;
  metrics: {
    activeOrders?: number;
    paidOrders?: number;
    grossSales?: number;
    pendingPurchaseItems?: number;
  };
  preferences: QuickDashboardPreferences;
};
type DrawerView = "dashboard" | "shortage" | "catalog";

const widgetCatalog: Record<QuickDashboardWidgetType, {
  label: string;
  description: string;
  icon: LucideIcon;
  defaultSize: "normal" | "wide";
}> = {
  store_presence: { label: "店舗のいま", description: "出勤中のスタッフと受付状況", icon: UserRoundCheck, defaultSize: "wide" },
  quick_shortage: { label: "欠品クイック登録", description: "在庫わずか・在庫切れをすばやく記録", icon: AlertTriangle, defaultSize: "normal" },
  web_reservation: { label: "Web予約受付", description: "受付状態と最短準備時間", icon: Clock3, defaultSize: "normal" },
  today_sales: { label: "今日の売上", description: "今日の会計件数と売上", icon: CircleDollarSign, defaultSize: "normal" },
  active_orders: { label: "対応中の注文", description: "制作・受け渡し待ちの注文", icon: ShoppingCart, defaultSize: "normal" },
  purchase_pending: { label: "購入待ち", description: "まだ購入処理が必要な商品", icon: Boxes, defaultSize: "normal" }
};

function formatTime(value: string) {
  if (!value) return "時刻未確認";
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatYen(value: number) {
  return `¥${new Intl.NumberFormat("ja-JP").format(value)}`;
}

export function QuickOperationsDashboard() {
  const drawerId = useId();
  const [dashboard, setDashboard] = useState<QuickDashboardPayload | null>(null);
  const [inventory, setInventory] = useState<InventoryPayload | null>(null);
  const [preferences, setPreferences] = useState<QuickDashboardPreferences>(defaultQuickDashboardPreferences);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<DrawerView>("dashboard");
  const [isEditing, setIsEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function loadDashboard(requestedStoreId = "") {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (requestedStoreId) params.set("storeId", requestedStoreId);
    const quickResponse = await fetch(`/api/os/quick-dashboard${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" }).catch(() => null);
    if (!quickResponse?.ok) {
      setIsLoading(false);
      return;
    }
    const quickPayload = await quickResponse.json() as QuickDashboardPayload;
    const inventoryResponse = await fetch(`/api/inventory?storeId=${encodeURIComponent(quickPayload.selectedStoreId)}`, { cache: "no-store" }).catch(() => null);
    const inventoryPayload = inventoryResponse?.ok ? await inventoryResponse.json() as InventoryPayload : null;
    setDashboard(quickPayload);
    setPreferences({ ...quickPayload.preferences, selectedStoreId: quickPayload.selectedStoreId });
    setInventory(inventoryPayload);
    setSelectedIds(new Set((inventoryPayload?.items ?? []).filter((item) => item.exceptionCode === "low").map((item) => item.id)));
    setIsLoading(false);
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  useEffect(() => {
    if (!isOpen || view !== "dashboard" || isEditing) return;
    const interval = window.setInterval(() => void loadDashboard(dashboard?.selectedStoreId), 60_000);
    return () => window.clearInterval(interval);
  }, [dashboard?.selectedStoreId, isEditing, isOpen, view]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isSaving) return;
      if (view !== "dashboard") setView("dashboard");
      else setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, isSaving, view]);

  const items = inventory?.items ?? [];
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
  const hasStockChanges = selectedIds.size !== originalLowIds.size
    || Array.from(selectedIds).some((id) => !originalLowIds.has(id));
  const selectedStoreName = dashboard?.stores.find((store) => store.id === dashboard.selectedStoreId)?.name ?? "対象店舗";

  function openDrawer() {
    setSelectedIds(new Set(lowItems.map((item) => item.id)));
    setQuery("");
    setLocationId("all");
    setMessage("");
    setView("dashboard");
    setIsOpen(true);
  }

  function openShortage() {
    setSelectedIds(new Set(lowItems.map((item) => item.id)));
    setQuery("");
    setLocationId("all");
    setMessage("");
    setView("shortage");
  }

  async function changeStore(storeId: string) {
    if (!dashboard || storeId === dashboard.selectedStoreId || isLoading) return;
    setMessage("");
    if (dashboard.canChangeGlobalStore) {
      setIsLoading(true);
      const response = await fetch("/api/os/store-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId })
      }).catch(() => null);
      if (response?.ok) window.location.reload();
      else {
        setMessage("店舗を切り替えられませんでした。");
        setIsLoading(false);
      }
      return;
    }
    const nextPreferences = { ...preferences, selectedStoreId: storeId };
    await savePreferences(nextPreferences, false);
    await loadDashboard(storeId);
  }

  async function savePreferences(nextPreferences: QuickDashboardPreferences, showSavedMessage = true) {
    setPreferences(nextPreferences);
    setIsSaving(true);
    const response = await fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quickDashboard: nextPreferences })
    }).catch(() => null);
    if (!response?.ok) {
      setMessage("Widget設定を保存できませんでした。");
    } else if (showSavedMessage) {
      setMessage("Widget設定を保存しました。");
    }
    setIsSaving(false);
  }

  function moveWidget(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= preferences.widgets.length) return;
    const widgets = [...preferences.widgets];
    [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
    void savePreferences({ ...preferences, widgets });
  }

  function toggleWidgetSize(widget: QuickDashboardWidget) {
    if (widget.type === "store_presence") return;
    const widgets = preferences.widgets.map((candidate) => candidate.id === widget.id
      ? { ...candidate, size: candidate.size === "wide" ? "normal" as const : "wide" as const }
      : candidate);
    void savePreferences({ ...preferences, widgets });
  }

  function removeWidget(widgetId: string) {
    void savePreferences({ ...preferences, widgets: preferences.widgets.filter((widget) => widget.id !== widgetId) });
  }

  function addWidget(type: QuickDashboardWidgetType) {
    const definition = widgetCatalog[type];
    const widget: QuickDashboardWidget = { id: `${type}-${Date.now()}`, type, size: definition.defaultSize };
    void savePreferences({ ...preferences, widgets: [...preferences.widgets, widget] });
    setView("dashboard");
  }

  function toggleStockItem(itemId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function saveLowStock() {
    if (!dashboard?.selectedStoreId || !hasStockChanges || isSaving) return;
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
        storeId: dashboard.selectedStoreId,
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
    await loadDashboard(dashboard.selectedStoreId);
    setIsSaving(false);
    setMessage("在庫確認と同期しました。");
    setView("dashboard");
  }

  function renderWidget(widget: QuickDashboardWidget) {
    const definition = widgetCatalog[widget.type];
    const Icon = definition.icon;
    const editControls = isEditing ? (
      <div className="os-quick-widget-edit-controls">
        <button type="button" aria-label="前へ移動" onClick={() => moveWidget(preferences.widgets.indexOf(widget), -1)}><ArrowLeft size={14} /></button>
        <button type="button" aria-label="次へ移動" onClick={() => moveWidget(preferences.widgets.indexOf(widget), 1)}><ArrowRight size={14} /></button>
        {widget.type !== "store_presence" ? <button type="button" aria-label="サイズを変更" onClick={() => toggleWidgetSize(widget)}><Maximize2 size={14} /></button> : null}
        <button type="button" aria-label="Widgetを削除" onClick={() => removeWidget(widget.id)}><Trash2 size={14} /></button>
      </div>
    ) : null;

    if (widget.type === "store_presence") {
      const staff = dashboard?.staff ?? [];
      return (
        <article className="os-quick-widget is-wide is-presence" key={widget.id}>
          <header>
            <span><Icon size={17} />{definition.label}</span>
            {editControls}
          </header>
          <div className="os-quick-presence-store">
            <label>
              <Store size={15} />
              <select value={dashboard?.selectedStoreId ?? ""} disabled={isLoading || !dashboard?.stores.length} onChange={(event) => void changeStore(event.target.value)}>
                {(dashboard?.stores ?? []).map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
              </select>
            </label>
            <span className={dashboard?.operation?.receptionState?.isWithinBusinessHours ? "is-open" : "is-closed"}>
              {dashboard?.operation?.receptionState?.isWithinBusinessHours ? "営業中" : "営業時間外"}
            </span>
          </div>
          <div className="os-quick-presence-heading">
            <strong>{staff.length}人勤務中</strong>
            <small>{dashboard?.operation?.acceptanceMode === "force_open"
              ? "Web予約 手動受付中"
              : dashboard?.operation?.acceptanceMode === "force_closed"
                ? dashboard.operation.statusNote || "Web予約 手動停止中"
                : dashboard?.operation?.reservationsEnabled === false ? dashboard.operation.statusNote || "Web予約停止中" : "Web予約 自動受付中"}</small>
          </div>
          <div className="os-quick-presence-list">
            {staff.slice(0, 6).map((person) => (
              <div key={person.employeeId}>
                <span className={person.status === "break" ? "is-break" : ""} aria-hidden="true" />
                <strong>{person.name}</strong>
                <small>{person.status === "break" ? "休憩中" : `${formatTime(person.clockInAt)}〜`}</small>
              </div>
            ))}
            {!staff.length ? <p>現在、打刻済みのスタッフはいません。</p> : null}
          </div>
        </article>
      );
    }

    if (widget.type === "quick_shortage") {
      return (
        <article className={`os-quick-widget is-shortage${widget.size === "wide" ? " is-wide" : ""}`} key={widget.id}>
          <header><span><Icon size={17} />{definition.label}</span>{editControls}</header>
          <div className="os-quick-widget-number-row"><strong>{lowItems.length}</strong><span>在庫わずか</span></div>
          <p>在庫切れ {outItems.length} 商品</p>
          {!isEditing ? <button type="button" onClick={openShortage}>すばやく記録 <ChevronRight size={15} /></button> : null}
        </article>
      );
    }

    if (widget.type === "web_reservation") {
      const enabled = dashboard?.operation?.reservationsEnabled !== false;
      const mode = dashboard?.operation?.acceptanceMode ?? "auto";
      return (
        <article className={`os-quick-widget${widget.size === "wide" ? " is-wide" : ""}`} key={widget.id}>
          <header><span><Icon size={17} />{definition.label}</span>{editControls}</header>
          <div className="os-quick-widget-status"><strong>{mode === "force_open" ? "手動受付中" : mode === "force_closed" ? "手動停止中" : enabled ? "自動受付中" : "自動停止中"}</strong><span className={enabled ? "is-on" : "is-off"} /></div>
          <p>{dashboard?.operation?.minimumPickupMinutes ? `最短 ${dashboard.operation.minimumPickupMinutes}分後` : "ブランド初期時間で受付"}</p>
          {!isEditing ? <a href="/store/orders">受付設定を開く <ChevronRight size={15} /></a> : null}
        </article>
      );
    }

    const widgetMetrics = {
      today_sales: { value: formatYen(Number(dashboard?.metrics.grossSales ?? 0)), note: `会計 ${Number(dashboard?.metrics.paidOrders ?? 0)}件`, href: "/os/analytics/sales" },
      active_orders: { value: `${Number(dashboard?.metrics.activeOrders ?? 0)}件`, note: "制作・受け渡し待ち", href: "/os/pos" },
      purchase_pending: { value: `${Number(dashboard?.metrics.pendingPurchaseItems ?? 0)}件`, note: "購入処理が必要", href: "/os/procurement" }
    } as const;
    const metric = widgetMetrics[widget.type as keyof typeof widgetMetrics];
    return (
      <article className={`os-quick-widget${widget.size === "wide" ? " is-wide" : ""}`} key={widget.id}>
        <header><span><Icon size={17} />{definition.label}</span>{editControls}</header>
        <div className="os-quick-widget-number-row"><strong>{metric.value}</strong></div>
        <p>{metric.note}</p>
        {!isEditing ? <a href={metric.href}>開く <ChevronRight size={15} /></a> : null}
      </article>
    );
  }

  if (!isLoading && !dashboard) return null;
  const availableWidgetTypes = quickDashboardWidgetTypes.filter((type) => !preferences.widgets.some((widget) => widget.type === type));

  return (
    <>
      <button type="button" className="os-quick-drawer-trigger" aria-expanded={isOpen} aria-controls={drawerId} title="クイック操作を開く" onClick={openDrawer}>
        <PanelRightOpen size={18} aria-hidden="true" />
        <span>クイック操作</span>
        {!isLoading && (lowItems.length || Number(dashboard?.metrics.activeOrders ?? 0)) ? <b>{lowItems.length + Number(dashboard?.metrics.activeOrders ?? 0)}</b> : null}
      </button>

      {isOpen ? (
        <div className="os-quick-drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSaving) setIsOpen(false);
        }}>
          <aside id={drawerId} className="os-quick-drawer" role="dialog" aria-modal="true" aria-labelledby={`${drawerId}-title`}>
            <header className="os-quick-stock-dialog-head">
              <div className="os-quick-drawer-title-row">
                {view !== "dashboard" ? <button type="button" aria-label="Widget一覧へ戻る" onClick={() => setView("dashboard")}><ChevronLeft size={19} /></button> : null}
                <div>
                  <p className="eyebrow">{selectedStoreName}</p>
                  <h2 id={`${drawerId}-title`}>{view === "shortage" ? "欠品クイック登録" : view === "catalog" ? "Widgetを追加" : "クイック操作"}</h2>
                  <p>{view === "dashboard" ? "店舗のいまを、ひと目で確認。" : view === "shortage" ? "もうすぐ切れそうな商品を選択します。" : "表示したい機能を選んでください。"}</p>
                </div>
              </div>
              <div className="os-quick-drawer-head-actions">
                {view === "dashboard" ? <button type="button" className={isEditing ? "is-active" : ""} onClick={() => setIsEditing((current) => !current)}><Pencil size={16} />{isEditing ? "完了" : "編集"}</button> : null}
                <button type="button" className="os-quick-stock-close" aria-label="閉じる" disabled={isSaving} onClick={() => setIsOpen(false)}><X size={20} /></button>
              </div>
            </header>

            {view === "dashboard" ? (
              <main className="os-quick-widget-desktop">
                <div className={`os-quick-widget-grid${isEditing ? " is-editing" : ""}`}>
                  {preferences.widgets.map(renderWidget)}
                  <button type="button" className="os-quick-add-widget" onClick={() => setView("catalog")}>
                    <Plus size={22} />
                    <strong>Widgetを追加</strong>
                    <span>よく使う機能を配置</span>
                  </button>
                </div>
                {message ? <p className="os-quick-drawer-message" role="status">{message}</p> : null}
              </main>
            ) : null}

            {view === "catalog" ? (
              <main className="os-quick-widget-catalog">
                {availableWidgetTypes.length ? availableWidgetTypes.map((type) => {
                  const definition = widgetCatalog[type];
                  const Icon = definition.icon;
                  return (
                    <button type="button" key={type} disabled={isSaving} onClick={() => addWidget(type)}>
                      <span><Icon size={19} /></span>
                      <span><strong>{definition.label}</strong><small>{definition.description}</small></span>
                      <Plus size={18} />
                    </button>
                  );
                }) : <div className="os-quick-stock-empty"><strong>追加できるWidgetはありません</strong><span>編集画面で不要なWidgetを削除できます。</span></div>}
              </main>
            ) : null}

            {view === "shortage" ? (
              <main className="os-quick-drawer-picker">
                <div className="os-quick-drawer-picker-title">
                  <div><h3>在庫わずかを記録</h3><p>タップして複数の商品を選択できます。</p></div>
                  <strong>{selectedIds.size} 商品</strong>
                </div>
                <div className="os-quick-stock-tools">
                  <label className="os-quick-stock-search"><Search size={17} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="商品名・保管場所で検索" autoFocus /></label>
                  <div className="os-quick-stock-filters" aria-label="保管場所で絞り込み">
                    <button type="button" className={locationId === "all" ? "is-active" : ""} onClick={() => setLocationId("all")}>すべて</button>
                    {(inventory?.locations ?? []).map((location) => <button type="button" className={locationId === location.id ? "is-active" : ""} key={location.id} onClick={() => setLocationId(location.id)}>{location.name}</button>)}
                  </div>
                </div>
                <div className="os-quick-stock-list">
                  {filteredItems.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <button type="button" className={`os-quick-stock-item${isSelected ? " is-selected" : ""}`} aria-pressed={isSelected} key={item.id} onClick={() => toggleStockItem(item.id)}>
                        <span className="os-quick-stock-check" aria-hidden="true">{isSelected ? <Check size={16} /> : null}</span>
                        <span className="os-quick-stock-item-copy"><strong>{item.productName}</strong><small>{item.category || "カテゴリ未設定"} / {item.locationName}</small></span>
                        <span className="os-quick-stock-quantity">{item.currentQuantity === null ? "数量未確認" : `${item.currentQuantity} ${item.countUnit}`}</span>
                      </button>
                    );
                  })}
                  {!filteredItems.length ? <div className="os-quick-stock-empty"><strong>該当する商品がありません</strong><span>検索条件または保管場所を変更してください。</span></div> : null}
                </div>
              </main>
            ) : null}

            {view === "shortage" ? (
              <footer className="os-quick-stock-footer">
                <div><strong>{hasStockChanges ? "未保存の変更があります" : "在庫データと同期済み"}</strong><span>保存内容は在庫確認にも反映されます。</span>{message ? <em role="status">{message}</em> : null}</div>
                <button type="button" className="primary-button" disabled={!hasStockChanges || isSaving} onClick={() => void saveLowStock()}>{isSaving ? "保存中..." : "変更を保存"}</button>
              </footer>
            ) : <span />}
          </aside>
        </div>
      ) : null}
    </>
  );
}
