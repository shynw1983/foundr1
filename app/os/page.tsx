"use client";

import Link from "next/link";
import { AlertTriangle, ChevronDown, Plus, Store, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NotificationMenu } from "./components/NotificationMenu";
import { OsEditorialChart, type EditorialSeriesPoint } from "./components/OsEditorialChart";
import { OsEditorialSidebar } from "./components/OsEditorialSidebar";
import { canonicalNavItems, usePermittedNavModules } from "./components/OsNavList";
import { OsLanguagePicker } from "./components/OsTranslationProvider";
import { QuickOperationsDashboard } from "./components/QuickOperationsDashboard";
import { getCachedCurrentEmployee, loadCurrentEmployee } from "./components/currentEmployeeStore";

type PeriodKey = "today" | "yesterday" | "this_week" | "last_week" | "last_month";

const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string; currentLabel: string; previousLabel: string }> = [
  { key: "today", label: "今日", currentLabel: "本日", previousLabel: "先週同日" },
  { key: "yesterday", label: "昨日", currentLabel: "昨日", previousLabel: "前週同日" },
  { key: "this_week", label: "今週", currentLabel: "今週", previousLabel: "先週同期間" },
  { key: "last_week", label: "先週", currentLabel: "先週", previousLabel: "前々週" },
  { key: "last_month", label: "先月", currentLabel: "先月", previousLabel: "前々月" }
];

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
  period: PeriodKey;
  granularity: "hourly" | "daily";
  rangeLabel: string;
  compareRangeLabel: string;
  generatedAt: string;
  summary: {
    todaySales: number;
    todayOrders: number;
    activeOrders: number;
    avgOrderValue: number;
    lastWeekSales: number;
    previousOrders: number;
    deltaPct: number | null;
    deltaOrdersPct: number | null;
    channelBreakdown: {
      pos: number;
      web: number;
      delivery: number;
    };
  };
  series: EditorialSeriesPoint[];
  stores: StoreCondition[];
};

type ActionStreamItem = {
  key: string;
  tone: "red" | "amber" | "blue" | "green";
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

function formatUpdatedTime(iso?: string) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo"
  }).format(new Date(iso));
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="os-f1-delta is-flat">前期データなし</span>;
  }
  const up = pct >= 0;
  return (
    <span className={`os-f1-delta os-ed-tabular ${up ? "is-up" : "is-down"}`} data-i18n-ignore>
      {up ? <TrendingUp size={12} aria-hidden="true" /> : <TrendingDown size={12} aria-hidden="true" />}
      {up ? "+" : ""}{pct}%
    </span>
  );
}

export default function Foundr1OsHome() {
  const cachedEmployee = getCachedCurrentEmployee();
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const permittedNavModules = usePermittedNavModules(canonicalNavItems);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [overview, setOverview] = useState<HomeOverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [payrollAlerts, setPayrollAlerts] = useState<PayrollStatutoryAlert[]>([]);
  const [dismissingAlertKey, setDismissingAlertKey] = useState("");

  useEffect(() => {
    let isMounted = true;
    void loadCurrentEmployee().then((employee) => {
      if (isMounted) setRole(employee?.role ?? "");
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const loadOverview = useCallback(async (storeId: string, nextPeriod: PeriodKey) => {
    setOverviewLoading(true);
    const params = new URLSearchParams();
    params.set("period", nextPeriod);
    if (storeId) params.set("storeId", storeId);
    const response = await fetch(`/api/os/home-overview?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    if (response?.ok) {
      const body = (await response.json()) as HomeOverviewData;
      setOverview(body);
      if (!storeId && body.selectedStoreId) {
        setSelectedStoreId(body.selectedStoreId);
      }
    }
    setOverviewLoading(false);
  }, []);

  useEffect(() => {
    void loadOverview(selectedStoreId, period);
  }, [loadOverview, selectedStoreId, period]);

  const handleStoreChange = useCallback((nextStoreId: string) => {
    setSelectedStoreId(nextStoreId);
    if (nextStoreId && nextStoreId !== "all" && (role === "owner" || role === "manager")) {
      void fetch("/api/os/store-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: nextStoreId })
      }).catch(() => null);
    }
  }, [role]);

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
        const body = (await nextResponse.json()) as { alerts?: PayrollStatutoryAlert[]; canView?: boolean };
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
        tone: "red",
        title: `レシート未アップロード（${formatNumber(missingReceipts.length)}件）`,
        detail: "購入済みの発注先証憑を確認してアップロードしてください。",
        href: "/os/history",
        cta: "確認する"
      });
    }
    if (pendingPurchaseItems.length > 0) {
      items.push({
        key: "pending-purchase",
        tone: "amber",
        title: `購入待ちの商品があります（${formatNumber(pendingPurchaseItems.length)}品目）`,
        detail: `進行中の発注 ${formatNumber(activePurchaseOrders.length)}件 の購入・納品処理を進めてください。`,
        href: "/os/procurement",
        cta: "購入へ"
      });
    }
    if ((overview?.summary.activeOrders ?? 0) > 0) {
      items.push({
        key: "active-customer-orders",
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
  const activeStoreName = !selectedStoreId || selectedStoreId === "all"
    ? stores.length > 1 ? `全店舗（${stores.length}）` : (stores[0]?.name ?? "全店舗")
    : stores.find((store) => store.id === selectedStoreId)?.name ?? "対象店舗";

  const sidebarBadges = useMemo(() => ({
    orders: activePurchaseOrders.length
  }), [activePurchaseOrders.length]);

  const activePeriodMeta = PERIOD_OPTIONS.find((item) => item.key === period) ?? PERIOD_OPTIONS[0];
  const canQuickActions = ["owner", "manager", "store_owner", "store_manager"].includes(role);
  const payrollAlertActionHref = ["store_owner", "store_manager"].includes(role) ? "/os/timecard/payroll" : "/os/settings";
  const payrollAlertActionLabel = ["store_owner", "store_manager"].includes(role) ? "給与へ" : "システム設定へ";
  const updatedTime = formatUpdatedTime(overview?.generatedAt);

  return (
    <div className="os-ed-shell">
      <OsEditorialSidebar modules={permittedNavModules} badges={sidebarBadges} />

      <main className="os-ed-main">
        {/* Clean Native-Style Mobile Top Bar: Logo + Centered Store Switcher + Language/Bell */}
        <header className="os-f1-mobile-topbar">
          <Link className="os-f1-mobile-brand" href="/os" aria-label="Foundr1 OS ホーム">
            <span className="os-ed-brand-mark" aria-hidden="true">F1</span>
          </Link>

          <div className="os-f1-mobile-store-wrap">
            {stores.length > 1 ? (
              <label className="os-f1-store-select-pill">
                <Store size={14} aria-hidden="true" />
                <select
                  aria-label="対象店舗"
                  value={selectedStoreId || "all"}
                  onChange={(event) => handleStoreChange(event.target.value)}
                >
                  {overview?.canSelectAllStores !== false ? (
                    <option value="all">全店舗（{stores.length}）</option>
                  ) : null}
                  {stores.map((store) => (
                    <option value={store.id} key={store.id}>{store.name}</option>
                  ))}
                </select>
                <ChevronDown size={13} className="os-f1-store-caret" aria-hidden="true" />
              </label>
            ) : (
              <span className="os-f1-store-static-pill" data-i18n-ignore>
                <Store size={14} aria-hidden="true" />
                <span>{activeStoreName}</span>
              </span>
            )}
          </div>

          <div className="os-f1-mobile-right">
            <div className="os-f1-mobile-lang-icon">
              <OsLanguagePicker />
            </div>
            <NotificationMenu />
          </div>
        </header>

        <div className="os-ed-content">
          {/* Period Pills + Desktop Store Selector & Actions */}
          <div className="os-f1-control-row">
            <div className="os-f1-period-pills" role="tablist" aria-label="集計期間">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  type="button"
                  role="tab"
                  key={option.key}
                  aria-selected={period === option.key}
                  className={`os-f1-period-pill${period === option.key ? " is-active" : ""}`}
                  onClick={() => setPeriod(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="os-f1-desktop-actions">
              {stores.length > 1 ? (
                <label className="os-f1-store-select-pill is-desktop">
                  <Store size={14} aria-hidden="true" />
                  <select
                    aria-label="対象店舗"
                    value={selectedStoreId}
                    onChange={(event) => setSelectedStoreId(event.target.value)}
                  >
                    {overview?.canSelectAllStores !== false ? (
                      <option value="all">全店舗（{stores.length}）</option>
                    ) : null}
                    {stores.map((store) => (
                      <option value={store.id} key={store.id}>{store.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="os-f1-store-caret" aria-hidden="true" />
                </label>
              ) : null}
              {canQuickActions ? <QuickOperationsDashboard /> : null}
              <Link href="/os/orders" className="os-ed-primary-cta">
                <Plus size={14} aria-hidden="true" />
                <span>新規発注</span>
              </Link>
            </div>
          </div>

          {/* Period Comparison Range Header */}
          <div className="os-f1-range-meta">
            <div className="os-f1-range-title" data-i18n-ignore>
              {overview?.rangeLabel ? (
                <>
                  <strong>{overview.rangeLabel}</strong>
                  <span>vs {overview.compareRangeLabel}</span>
                </>
              ) : (
                <strong>{activePeriodMeta.label}</strong>
              )}
            </div>
            <div className="os-f1-range-sub">
              <span data-i18n-ignore>{activeStoreName}</span>
              {updatedTime ? <span data-i18n-ignore>最終更新 {updatedTime}</span> : null}
              {overviewLoading ? <span>更新中…</span> : null}
            </div>
          </div>

          {/* Payroll Statutory Alerts */}
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

          {/* Priority Attention Card (Shown cleanly above metrics when items need action) */}
          {actionStream.length > 0 ? (
            <section className="os-f1-attention-card" aria-label="確認が必要">
              <div className="os-f1-attention-head">
                <AlertTriangle size={15} aria-hidden="true" />
                <span>確認が必要（{actionStream.length}）</span>
              </div>
              <div className="os-f1-attention-list">
                {actionStream.map((item) => (
                  <div className="os-f1-attention-row" key={item.key}>
                    <div className="os-f1-attention-copy">
                      <div className="os-f1-attention-title">
                        <i className={`os-f1-dot is-${item.tone}`} aria-hidden="true" />
                        <strong>{item.title}</strong>
                      </div>
                      <p>{item.detail}</p>
                    </div>
                    <Link className="os-f1-soft-btn" href={item.href}>
                      {item.cta}
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* Foundr1 2-Column Primary Metric Pair + Interactive Sales Curve */}
          {overview?.canViewSalesStats !== false ? (
            <section className="os-f1-performance" aria-label="売上パフォーマンス">
              <div className="os-f1-metric-pair">
                <Link href="/os/analytics/sales" className="os-f1-metric-card">
                  <span className="os-f1-metric-label">総売上</span>
                  <strong className="os-f1-metric-value os-ed-tabular" data-i18n-ignore>
                    {formatYen(overview?.summary.todaySales ?? 0)}
                  </strong>
                  <div className="os-f1-metric-delta-row">
                    <DeltaBadge pct={overview?.summary.deltaPct ?? null} />
                  </div>
                  <div className="os-f1-metric-foot">
                    <span>平均注文単価</span>
                    <b className="os-ed-tabular" data-i18n-ignore>
                      {formatYen(overview?.summary.avgOrderValue ?? 0)}
                    </b>
                  </div>
                </Link>

                <Link href="/os/pos" className="os-f1-metric-card">
                  <span className="os-f1-metric-label">会計件数</span>
                  <strong className="os-f1-metric-value os-ed-tabular" data-i18n-ignore>
                    {formatNumber(overview?.summary.todayOrders ?? 0)}
                    <small>件</small>
                  </strong>
                  <div className="os-f1-metric-delta-row">
                    <DeltaBadge pct={overview?.summary.deltaOrdersPct ?? null} />
                  </div>
                  <div className="os-f1-metric-foot">
                    <span>対応中 / Web予約</span>
                    <b className="os-ed-tabular" data-i18n-ignore>
                      {formatNumber(overview?.summary.activeOrders ?? 0)}件 · {formatNumber(overview?.summary.channelBreakdown.web ?? 0)}件
                    </b>
                  </div>
                </Link>
              </div>

              <div className="os-f1-chart-card">
                <OsEditorialChart
                  series={overview?.series ?? []}
                  granularity={overview?.granularity ?? "hourly"}
                  currentLabel={activePeriodMeta.currentLabel}
                  previousLabel={activePeriodMeta.previousLabel}
                  isLoading={overviewLoading}
                />
              </div>
            </section>
          ) : null}

          {/* Procurement & Loyalty Compact Summary Strip */}
          <section className="os-f1-ops-strip" aria-label="業務サマリー">
            <Link href="/os/orders" className="os-f1-ops-tile">
              <span>処理中の発注</span>
              <strong className={`os-ed-tabular${activePurchaseOrders.length > 0 ? " is-warn" : ""}`}>
                {formatNumber(activePurchaseOrders.length)}件
              </strong>
              <small>購入待ち {formatNumber(pendingPurchaseItems.length)}品目</small>
            </Link>
            <Link href="/os/history" className="os-f1-ops-tile">
              <span>レシート未登録</span>
              <strong className={`os-ed-tabular${missingReceipts.length > 0 ? " is-danger" : ""}`}>
                {formatNumber(missingReceipts.length)}件
              </strong>
              <small>購入済み証憑</small>
            </Link>
            <Link href="/os/loyalty" className="os-f1-ops-tile">
              <span>会員数</span>
              <strong className="os-ed-tabular">
                {formatNumber(Number(loyalty?.summary?.memberCount ?? 0))}名
              </strong>
              <small>
                クーポン {formatNumber(Number(loyalty?.summary?.availableCoupons ?? 0))}件
              </small>
            </Link>
            <Link href="/os/products" className="os-f1-ops-tile">
              <span>商品マスタ</span>
              <strong className="os-ed-tabular">
                {formatNumber(dashboard?.products?.length ?? 0)}品
              </strong>
              <small>発注先 {formatNumber(dashboard?.suppliers?.length ?? 0)}社</small>
            </Link>
          </section>

          {/* Two-Column Hairline Workspace: Active Orders + Store Conditions */}
          <section className="os-ed-split">
            <div>
              <div className="os-ed-section-head">
                <h2>進行中の発注</h2>
                <Link href="/os/orders">すべて見る →</Link>
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
                      <Link className="os-f1-soft-btn" href={`/os/orders#order-${order.id}`}>
                        開く
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="os-ed-empty">処理中の発注はありません。</p>
              )}
            </div>

            <div>
              <div className="os-ed-section-head">
                <h2>店舗コンディション</h2>
                <span>タップで店舗切替</span>
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
                        onClick={() => handleStoreChange(isSelected && overview?.canSelectAllStores ? "all" : store.id)}
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

          {/* Desktop Module Directory (Mobile uses the native 5-Tab + その他 sheet) */}
          <section className="os-ed-modules os-f1-desktop-only-modules" aria-label="業務モジュール">
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
