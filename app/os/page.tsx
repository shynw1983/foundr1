"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileNavMenu } from "./components/MobileNavMenu";
import { OsEditorialChart, type EditorialHourlyPoint } from "./components/OsEditorialChart";
import { OsEditorialSidebar } from "./components/OsEditorialSidebar";
import { canonicalNavItems, usePermittedNavModules } from "./components/OsNavList";
import { QuickOperationsDashboard } from "./components/QuickOperationsDashboard";
import { getCachedCurrentEmployee, loadCurrentEmployee } from "./components/currentEmployeeStore";

type PayrollStatutoryAlert = {
  key: string;
  level: "critical" | "warning";
  title: string;
  message: string;
  actionLabel: string;
  dueLabel: string;
  targetYear?: number;
  dismissible?: boolean;
  dismissActionLabel?: string;
};

type DashboardOrder = {
  id: string;
  store: string;
  brand: string;
  deadline: string;
  items: number;
  status: string;
  priority: string;
};

type DashboardItem = {
  id: string;
  purchased: boolean;
  unavailable: boolean;
  deliveryStatus: string;
  storeFeedbackConfirmed: boolean;
};

type DashboardFulfillment = {
  id: string;
  orderId: string;
  supplier: string;
  status: string;
  receiptPhotoUrl: string;
  expectedArrivalDate: string;
};

type DashboardData = {
  orders?: DashboardOrder[];
  purchaseOrderItems?: DashboardItem[];
  supplierFulfillments?: DashboardFulfillment[];
  products?: unknown[];
  suppliers?: unknown[];
  staffOptions?: unknown[];
  stores?: unknown[];
  priceSignals?: unknown[];
};

type LoyaltyData = {
  summary?: {
    memberCount?: number;
    availableCoupons?: number;
    pointLiability?: number;
  };
};

type StoreCondition = {
  id: string;
  name: string;
  todaySales: number;
  todayOrders: number;
  activeOrders: number;
  workingStaff: number;
  breakStaff: number;
  isAcceptingWeb: boolean;
  minimumPickupMinutes: number | null;
  statusNote: string;
};

type HomeOverviewData = {
  canViewSalesStats: boolean;
  canSelectAllStores: boolean;
  selectedStoreId: string;
  generatedAt: string;
  summary: {
    todaySales: number;
    todayOrders: number;
    activeOrders: number;
    avgOrderValue: number;
    lastWeekSales: number;
    deltaPct: number | null;
    channelBreakdown: {
      pos: number;
      web: number;
      delivery: number;
    };
  };
  hourlySeries: EditorialHourlyPoint[];
  stores: StoreCondition[];
};

type ActionStreamItem = {
  key: string;
  tag: string;
  tone: "red" | "amber" | "blue" | "green" | "neutral";
  title: string;
  detail: string;
  href: string;
  cta: string;
};

const moduleSummaries: Record<string, string> = {
  orders: "発注・購入・納品・レシート・発注先",
  "store-operations": "手順書・在庫確認・現場記録・連絡",
  pos: "POS・レジ締め・メニュー・会員",
  timecard: "勤怠・シフト・給与・スタッフ",
  analytics: "売上・人件費・原価・月次損益",
  "shared-data": "商品・店舗・外部連携・設定"
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function formatYen(value: number) {
  return `¥${formatNumber(Math.round(value))}`;
}

function formatTodayDateJst() {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo"
  }).format(new Date());
}

export default function Foundr1OsHome() {
  const cachedEmployee = getCachedCurrentEmployee();
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const permittedNavModules = usePermittedNavModules(canonicalNavItems);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("all");
  const [overview, setOverview] = useState<HomeOverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [payrollAlerts, setPayrollAlerts] = useState<PayrollStatutoryAlert[]>([]);
  const [dismissingAlertKey, setDismissingAlertKey] = useState("");
  const [todayLabel, setTodayLabel] = useState("");

  useEffect(() => {
    setTodayLabel(formatTodayDateJst());
  }, []);

  useEffect(() => {
    let isMounted = true;
    void loadCurrentEmployee().then((employee) => {
      if (isMounted) setRole(employee?.role ?? "");
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const loadOverview = useCallback(async (storeId: string) => {
    setOverviewLoading(true);
    const query = storeId && storeId !== "all" ? `?storeId=${encodeURIComponent(storeId)}` : "";
    const response = await fetch(`/api/os/home-overview${query}`, { cache: "no-store" }).catch(() => null);
    if (response?.ok) {
      const body = (await response.json()) as HomeOverviewData;
      setOverview(body);
    }
    setOverviewLoading(false);
  }, []);

  useEffect(() => {
    void loadOverview(selectedStoreId);
  }, [loadOverview, selectedStoreId]);

  useEffect(() => {
    let isMounted = true;

    async function loadOperationalData() {
      const [dashboardResponse, loyaltyResponse, alertsResponse] = await Promise.allSettled([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/os/loyalty", { cache: "no-store" }),
        fetch("/api/settings/payroll-statutory-alerts", { cache: "no-store" })
      ]);

      if (dashboardResponse.status === "fulfilled" && dashboardResponse.value.ok) {
        const body = (await dashboardResponse.value.json()) as DashboardData;
        if (isMounted) setDashboard(body);
      }
      if (loyaltyResponse.status === "fulfilled" && loyaltyResponse.value.ok) {
        const body = (await loyaltyResponse.value.json()) as LoyaltyData;
        if (isMounted) setLoyalty(body);
      }
      if (alertsResponse.status === "fulfilled" && alertsResponse.value.ok) {
        const body = (await alertsResponse.value.json()) as { alerts?: PayrollStatutoryAlert[]; canView?: boolean };
        if (isMounted && body.canView) setPayrollAlerts(body.alerts ?? []);
      }
    }

    void loadOperationalData();

    return () => {
      isMounted = false;
    };
  }, []);

  async function dismissPayrollStatutoryAlert(alert: PayrollStatutoryAlert) {
    if (!alert.targetYear) return;
    setDismissingAlertKey(alert.key);
    const response = await fetch("/api/settings/payroll-statutory-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "dismiss_payroll_statutory_alert",
        alertKey: alert.key,
        targetYear: alert.targetYear
      })
    });
    if (response.ok) {
      const nextResponse = await fetch("/api/settings/payroll-statutory-alerts", { cache: "no-store" });
      if (nextResponse.ok) {
        const body = (await nextResponse.value.json()) as { alerts?: PayrollStatutoryAlert[]; canView?: boolean };
        if (body.canView) setPayrollAlerts(body.alerts ?? []);
      }
    }
    setDismissingAlertKey("");
  }

  const orders = dashboard?.orders ?? [];
  const activePurchaseOrders = useMemo(
    () => orders.filter((order) => order.status !== "完了"),
    [orders]
  );
  const pendingPurchaseItems = useMemo(
    () => (dashboard?.purchaseOrderItems ?? []).filter((item) => !item.purchased && !item.unavailable),
    [dashboard?.purchaseOrderItems]
  );
  const missingReceipts = useMemo(
    () => (dashboard?.supplierFulfillments ?? []).filter((f) => f.status !== "not_started" && !f.receiptPhotoUrl),
    [dashboard?.supplierFulfillments]
  );

  const actionStream = useMemo<ActionStreamItem[]>(() => {
    const items: ActionStreamItem[] = [];
    if (missingReceipts.length > 0) {
      items.push({
        key: "missing-receipts",
        tag: "証憑",
        tone: "red",
        title: `レシート未アップロード（${formatNumber(missingReceipts.length)}件）`,
        detail: "購入済みの発注先証憑を確認・添付してください。",
        href: "/os/history",
        cta: "確認する"
      });
    }
    if (pendingPurchaseItems.length > 0) {
      items.push({
        key: "pending-purchase",
        tag: "購入待ち",
        tone: "amber",
        title: `未購入の商品があります（${formatNumber(pendingPurchaseItems.length)}品目）`,
        detail: `進行中の発注 ${formatNumber(activePurchaseOrders.length)}件 の購入・納品処理を進めてください。`,
        href: "/os/procurement",
        cta: "購入画面へ"
      });
    }
    if ((overview?.summary.activeOrders ?? 0) > 0) {
      items.push({
        key: "active-customer-orders",
        tag: "注文対応",
        tone: "blue",
        title: `Web予約・POS 注文が進行中（${formatNumber(overview?.summary.activeOrders ?? 0)}件）`,
        detail: "店舗側で制作・受け渡し対応が進んでいます。",
        href: "/os/pos",
        cta: "状況を見る"
      });
    }
    if ((dashboard?.priceSignals?.length ?? 0) > 0) {
      items.push({
        key: "price-signals",
        tag: "単価変動",
        tone: "amber",
        title: `仕入単価の変動候補（${formatNumber(dashboard?.priceSignals?.length ?? 0)}件）`,
        detail: "基準単価から変動がある商品を確認してください。",
        href: "/os/analytics/cost",
        cta: "原価を見る"
      });
    }
    return items;
  }, [activePurchaseOrders.length, dashboard?.priceSignals?.length, missingReceipts.length, overview?.summary.activeOrders, pendingPurchaseItems.length]);

  const stores = overview?.stores ?? [];
  const maxStoreSales = useMemo(
    () => Math.max(1, ...stores.map((store) => store.todaySales)),
    [stores]
  );
  const activeStoreName = selectedStoreId === "all"
    ? stores.length > 1 ? `全店舗（${stores.length}店舗）` : (stores[0]?.name ?? "全店舗")
    : stores.find((store) => store.id === selectedStoreId)?.name ?? "対象店舗";

  const sidebarBadges = useMemo(() => ({
    orders: activePurchaseOrders.length
  }), [activePurchaseOrders.length]);

  const canQuickActions = ["owner", "manager", "store_owner", "store_manager"].includes(role);
  const payrollAlertActionHref = ["store_owner", "store_manager"].includes(role) ? "/os/timecard/payroll" : "/os/settings";
  const payrollAlertActionLabel = ["store_owner", "store_manager"].includes(role) ? "給与へ" : "システム設定へ";

  const deltaPct = overview?.summary.deltaPct ?? null;
  const deltaClass = deltaPct === null ? "is-flat" : deltaPct >= 0 ? "is-up" : "is-down";
  const deltaText = deltaPct === null
    ? null
    : `${deltaPct >= 0 ? "+" : ""}${deltaPct}% 先週同日比`;

  return (
    <div className="os-ed-shell">
      <OsEditorialSidebar modules={permittedNavModules} badges={sidebarBadges} />

      <main className="os-ed-main">
        {/* Compact Mobile Top Bar */}
        <header className="os-ed-mobile-bar">
          <Link className="os-ed-brand" href="/os" aria-label="Foundr1 OS ホーム">
            <span className="os-ed-brand-mark">F1</span>
            <span className="os-ed-brand-text">
              <strong>Foundr1</strong>
              <small>OS</small>
            </span>
          </Link>
          <div className="os-ed-mobile-actions">
            {canQuickActions ? <QuickOperationsDashboard /> : null}
            <MobileNavMenu navItems={canonicalNavItems} />
          </div>
        </header>

        <div className="os-ed-content">
          {/* Quiet Top Utility Line: Store Selector Pills + Quick Action */}
          <div className="os-ed-utility-row">
            <div className="os-ed-store-pills" role="tablist" aria-label="対象店舗の切り替え">
              {overview?.canSelectAllStores !== false && stores.length > 1 ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedStoreId === "all"}
                  className={`os-ed-pill${selectedStoreId === "all" ? " is-active" : ""}`}
                  onClick={() => setSelectedStoreId("all")}
                >
                  全店舗（{stores.length}）
                </button>
              ) : null}
              {stores.map((store) => (
                <button
                  type="button"
                  role="tab"
                  key={store.id}
                  aria-selected={selectedStoreId === store.id}
                  className={`os-ed-pill${selectedStoreId === store.id ? " is-active" : ""}`}
                  onClick={() => setSelectedStoreId(store.id)}
                  data-i18n-ignore
                >
                  {store.name}
                </button>
              ))}
            </div>

            <div className="os-ed-utility-actions">
              {canQuickActions ? <QuickOperationsDashboard /> : null}
              <Link href="/os/orders" className="os-ed-primary-cta">
                <Plus size={14} aria-hidden="true" />
                <span>新規発注</span>
              </Link>
            </div>
          </div>

          {/* Payroll Statutory Alerts (preserved verbatim in quiet editorial container) */}
          {payrollAlerts.length > 0 ? (
            <section className="os-ed-statutory-strip" aria-label="給与法定データ更新アラート">
              <div className="os-ed-statutory-head">
                <strong>給与計算データの更新が必要です</strong>
                <Link className="os-ed-row-action" href={payrollAlertActionHref}>{payrollAlertActionLabel}</Link>
              </div>
              {payrollAlerts.map((alert) => (
                <article className="os-ed-statutory-item" key={alert.key}>
                  <div>
                    <h3>{alert.title}</h3>
                    <p>{alert.message}</p>
                  </div>
                  <div className="os-ed-statutory-actions">
                    <span className="os-ed-chip is-amber">{alert.dueLabel}</span>
                    {alert.dismissible ? (
                      <button
                        className="os-ed-row-action"
                        type="button"
                        disabled={dismissingAlertKey === alert.key}
                        onClick={() => void dismissPayrollStatutoryAlert(alert)}
                      >
                        {dismissingAlertKey === alert.key ? "保存中" : alert.dismissActionLabel ?? "閉じる"}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {/* Editorial Focal Canvas: Open Revenue Anchor + Interactive Hourly Curve */}
          <section className="os-ed-focal" aria-label="本日の運営状況">
            <div className="os-ed-focal-header">
              <div>
                <div className="os-ed-focal-kicker">
                  <span data-i18n-ignore>{activeStoreName}</span>
                  <span>·</span>
                  <span data-i18n-ignore>{todayLabel || "本日"}</span>
                  {overviewLoading ? <span>· 更新中</span> : null}
                </div>
                {overview?.canViewSalesStats !== false ? (
                  <div className="os-ed-focal-amount-row">
                    <span className="os-ed-focal-amount os-ed-tabular" data-i18n-ignore>
                      {formatYen(overview?.summary.todaySales ?? 0)}
                    </span>
                    {deltaText ? (
                      <span className={`os-ed-delta os-ed-tabular ${deltaClass}`} data-i18n-ignore>
                        {deltaText}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className="os-ed-focal-amount-row">
                    <span className="os-ed-focal-amount">本日の業務</span>
                  </div>
                )}
              </div>

              <div className="os-ed-kpi-strip">
                {overview?.canViewSalesStats !== false ? (
                  <>
                    <Link href="/os/analytics/sales" className="os-ed-kpi-cell">
                      <span>会計件数</span>
                      <strong className="os-ed-tabular">{formatNumber(overview?.summary.todayOrders ?? 0)}件</strong>
                      <small className="os-ed-tabular">
                        客単価 {formatYen(overview?.summary.avgOrderValue ?? 0)}
                      </small>
                    </Link>
                    <Link href="/os/pos" className="os-ed-kpi-cell">
                      <span>対応中の注文</span>
                      <strong className="os-ed-tabular">{formatNumber(overview?.summary.activeOrders ?? 0)}件</strong>
                      <small className="os-ed-tabular">
                        Web予約 {formatNumber(overview?.summary.channelBreakdown.web ?? 0)}件
                      </small>
                    </Link>
                  </>
                ) : null}
                <Link
                  href="/os/orders"
                  className={`os-ed-kpi-cell${activePurchaseOrders.length > 0 ? " is-warn" : ""}`}
                >
                  <span>処理中の発注</span>
                  <strong className="os-ed-tabular">{formatNumber(activePurchaseOrders.length)}件</strong>
                  <small className="os-ed-tabular">購入待ち {formatNumber(pendingPurchaseItems.length)}品目</small>
                </Link>
                <Link
                  href="/os/history"
                  className={`os-ed-kpi-cell${missingReceipts.length > 0 ? " is-danger" : ""}`}
                >
                  <span>レシート未登録</span>
                  <strong className="os-ed-tabular">{formatNumber(missingReceipts.length)}件</strong>
                  <small>
                    {loyalty ? `会員 ${formatNumber(Number(loyalty.summary?.memberCount ?? 0))}名` : "証憑管理を確認"}
                  </small>
                </Link>
              </div>
            </div>

            {overview?.canViewSalesStats !== false ? (
              <OsEditorialChart
                series={overview?.hourlySeries ?? []}
                isLoading={overviewLoading}
              />
            ) : null}
          </section>

          {/* Two-Column Hairline Workspace: Action Stream + Store Conditions */}
          <section className="os-ed-split">
            <div>
              <div className="os-ed-section-head">
                <h2>いま対応が必要なこと</h2>
                <Link href="/os/orders">発注・購入一覧 →</Link>
              </div>
              {actionStream.length > 0 ? (
                <div className="os-ed-stream">
                  {actionStream.map((item) => (
                    <div className="os-ed-stream-row" key={item.key}>
                      <div className="os-ed-stream-main">
                        <div className="os-ed-stream-title-row">
                          <span className={`os-ed-chip is-${item.tone}`}>{item.tag}</span>
                          <strong>{item.title}</strong>
                        </div>
                        <p>{item.detail}</p>
                      </div>
                      <Link className="os-ed-row-action" href={item.href}>
                        {item.cta}
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="os-ed-empty">いま急ぎの対応が必要な項目はありません。</p>
              )}

              {/* Active Purchase Orders List */}
              <div className="os-ed-sub-block">
                <div className="os-ed-section-head">
                  <h2>進行中の発注</h2>
                  <Link href="/os/orders">すべて見る</Link>
                </div>
                {activePurchaseOrders.length > 0 ? (
                  <div className="os-ed-stream">
                    {activePurchaseOrders.slice(0, 5).map((order) => (
                      <div className="os-ed-stream-row" key={order.id}>
                        <div className="os-ed-stream-main">
                          <div className="os-ed-stream-title-row">
                            <strong className="os-ed-tabular" data-i18n-ignore>{order.id}</strong>
                            <span className="os-ed-chip is-neutral">{order.status}</span>
                          </div>
                          <p data-i18n-ignore>
                            {order.store} / {order.brand} · {order.deadline || `${order.items}品目`}
                          </p>
                        </div>
                        <Link className="os-ed-row-action" href={`/os/orders#order-${order.id}`}>
                          開く
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="os-ed-empty">処理中の発注はありません。</p>
                )}
              </div>
            </div>

            {/* Right Column: Live Store Conditions */}
            <div>
              <div className="os-ed-section-head">
                <h2>店舗コンディション</h2>
                <span>クリックで売上推移を切替</span>
              </div>
              {stores.length > 0 ? (
                <div className="os-ed-store-list">
                  {stores.map((store) => {
                    const ratio = store.todaySales > 0 ? Math.max(6, Math.round((store.todaySales / maxStoreSales) * 100)) : 0;
                    const isSelected = selectedStoreId === store.id;
                    return (
                      <button
                        type="button"
                        key={store.id}
                        className={`os-ed-store-item${isSelected ? " is-selected" : ""}`}
                        onClick={() => setSelectedStoreId(isSelected && overview?.canSelectAllStores ? "all" : store.id)}
                      >
                        <div className="os-ed-store-top">
                          <strong data-i18n-ignore>{store.name}</strong>
                          {overview?.canViewSalesStats !== false ? (
                            <span className="os-ed-tabular" data-i18n-ignore>{formatYen(store.todaySales)}</span>
                          ) : (
                            <span className="os-ed-tabular">出勤 {store.workingStaff}名</span>
                          )}
                        </div>
                        {overview?.canViewSalesStats !== false ? (
                          <div className="os-ed-store-bar" aria-hidden="true">
                            <i style={{ width: `${ratio}%` }} />
                          </div>
                        ) : null}
                        <div className="os-ed-store-meta">
                          <span className="os-ed-tabular">
                            出勤 {store.workingStaff}名
                            {store.activeOrders > 0 ? ` · 対応中 ${store.activeOrders}件` : ""}
                          </span>
                          <span>
                            {store.isAcceptingWeb
                              ? `Web予約 受付中${store.minimumPickupMinutes ? ` (${store.minimumPickupMinutes}分)` : ""}`
                              : "Web予約 停止中"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="os-ed-empty">表示できる店舗データがありません。</p>
              )}
            </div>
          </section>

          {/* Compact Permitted Module Directory */}
          <section className="os-ed-modules" aria-label="業務モジュール">
            <div className="os-ed-section-head">
              <h2>業務モジュール</h2>
              <span>権限に応じたメニューを表示</span>
            </div>
            {permittedNavModules.length > 0 ? (
              <div className="os-ed-module-grid">
                {permittedNavModules.map((module) => {
                  const Icon = module.icon;
                  const mainHref = module.href ?? module.children[0]?.href ?? "/os";
                  return (
                    <Link className="os-ed-module-link" href={mainHref} key={module.id}>
                      <span className="os-ed-module-icon" aria-hidden="true">
                        <Icon size={17} />
                      </span>
                      <span className="os-ed-module-body">
                        <span className="os-ed-module-title">
                          <strong>{module.label}</strong>
                          <small className="os-ed-tabular">{module.children.length}入口</small>
                        </span>
                        <p>{moduleSummaries[module.id] ?? "関連画面を開きます"}</p>
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="os-ed-empty">利用できる機能がありません。</p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
