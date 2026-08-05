"use client";

import {
  AlertTriangle,
  Boxes,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  MenuSquare,
  PackageCheck,
  ReceiptText,
  Truck,
  UserRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { MobileNavMenu } from "./components/MobileNavMenu";
import { UserBadge } from "./components/UserBadge";
import { canonicalNavItems, type OsNavModuleWithChildren, usePermittedNavModules } from "./components/OsNavList";
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

type SalesStats = {
  summary?: {
    paidOrders?: number;
    activeOrders?: number;
    grossSales?: number;
    averageCompletionMinutes?: number;
  };
};

type LoyaltyData = {
  summary?: {
    memberCount?: number;
    availableCoupons?: number;
    pointLiability?: number;
  };
};

type HomeMetric = {
  label: string;
  value: string;
  note: string;
  href: string;
  icon: LucideIcon;
  tone?: "warning" | "danger";
};

const moduleSummaries: Record<string, string> = {
  orders: "発注、購入、納品、証憑、発注先をまとめて扱います。",
  "store-operations": "手順書、現場記録、報告、改善要望を店舗運営の入口に集めます。",
  pos: "POS、メニュー、ブランドサイト、会員ポイントを売上まわりで管理します。",
  timecard: "勤怠、シフト、給与、スタッフ管理を日々の人員運営にまとめます。",
  analytics: "売上、人件費、原価、経費、月次損益を経営分析として確認します。",
  "shared-data": "商品、店舗、外部サービス、システム設定など共通データを管理します。"
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function buildHomeMetrics(dashboard: DashboardData | null, salesStats: SalesStats | null, loyalty: LoyaltyData | null): HomeMetric[] {
  const orders = dashboard?.orders ?? [];
  const items = dashboard?.purchaseOrderItems ?? [];
  const fulfillments = dashboard?.supplierFulfillments ?? [];
  const activeOrders = orders.filter((order) => order.status !== "完了");
  const pendingPurchaseItems = items.filter((item) => !item.purchased && !item.unavailable);
  const missingReceipts = fulfillments.filter((fulfillment) => fulfillment.status !== "not_started" && !fulfillment.receiptPhotoUrl);
  const paidOrders = Number(salesStats?.summary?.paidOrders ?? 0);
  const grossSales = Number(salesStats?.summary?.grossSales ?? 0);
  const activeCustomerOrders = Number(salesStats?.summary?.activeOrders ?? 0);
  const staffCount = dashboard?.staffOptions?.length ?? 0;
  const memberCount = Number(loyalty?.summary?.memberCount ?? 0);

  return [
    {
      label: "本日売上",
      value: `¥${formatNumber(grossSales)}`,
      note: paidOrders ? `会計 ${formatNumber(paidOrders)} 件 / 対応中 ${formatNumber(activeCustomerOrders)} 件` : "本日の会計はまだありません",
      href: "/os/analytics/sales",
      icon: CircleDollarSign
    },
    {
      label: "会員",
      value: formatNumber(memberCount),
      note: loyalty ? `利用可能クーポン ${formatNumber(Number(loyalty.summary?.availableCoupons ?? 0))} 件` : "権限がある場合に会員状況を表示します",
      href: "/os/loyalty",
      icon: UserRound
    },
    {
      label: "処理中の発注",
      value: formatNumber(activeOrders.length),
      note: activeOrders.length ? "購入・納品・店舗確認が残っています" : "未完了の発注はありません",
      href: "/os/orders",
      icon: PackageCheck,
      tone: activeOrders.length ? "warning" : undefined
    },
    {
      label: "購入待ち商品",
      value: formatNumber(pendingPurchaseItems.length),
      note: pendingPurchaseItems.length ? "発注先確認または購入が必要です" : "購入待ちはありません",
      href: "/os/procurement",
      icon: Truck,
      tone: pendingPurchaseItems.length ? "warning" : undefined
    },
    {
      label: "レシート未アップロード",
      value: formatNumber(missingReceipts.length),
      note: missingReceipts.length ? "購入済みの証憑を確認してください" : "未アップロードはありません",
      href: "/os/history",
      icon: ReceiptText,
      tone: missingReceipts.length ? "danger" : undefined
    },
    {
      label: "スタッフ",
      value: formatNumber(staffCount),
      note: "勤怠、シフト、給与の運用状況へ移動します",
      href: "/os/timecard",
      icon: Clock3
    },
    {
      label: "商品・マスタ",
      value: formatNumber(dashboard?.products?.length ?? 0),
      note: `店舗 ${formatNumber(dashboard?.stores?.length ?? 0)} / 発注先 ${formatNumber(dashboard?.suppliers?.length ?? 0)}`,
      href: "/os/products",
      icon: MenuSquare
    }
  ];
}

function OsHomeMetricCard({ metric }: { metric: HomeMetric }) {
  const Icon = metric.icon;

  return (
    <a className={`os-home-metric-card${metric.tone ? ` is-${metric.tone}` : ""}`} href={metric.href}>
      <span className="os-home-metric-label">
        <Icon size={16} />
        {metric.label}
      </span>
      <strong>{metric.value}</strong>
      <span>{metric.note}</span>
    </a>
  );
}

function OsHomeDashboard({
  dashboard,
  salesStats,
  loyalty,
  isLoading
}: {
  dashboard: DashboardData | null;
  salesStats: SalesStats | null;
  loyalty: LoyaltyData | null;
  isLoading: boolean;
}) {
  const metrics = buildHomeMetrics(dashboard, salesStats, loyalty);
  const orders = (dashboard?.orders ?? []).filter((order) => order.status !== "完了").slice(0, 5);
  const missingReceipts = (dashboard?.supplierFulfillments ?? [])
    .filter((fulfillment) => fulfillment.status !== "not_started" && !fulfillment.receiptPhotoUrl)
    .slice(0, 5);
  const operationalAlerts = [
    ...(Number(salesStats?.summary?.activeOrders ?? 0) > 0 ? [{
      title: "Web予約・POS 対応中",
      detail: `${formatNumber(Number(salesStats?.summary?.activeOrders ?? 0))} 件の注文が進行中です。`,
      href: "/os/pos"
    }] : []),
    ...(dashboard?.priceSignals?.length ? [{
      title: "価格変動",
      detail: `${formatNumber(dashboard.priceSignals.length)} 件の価格変動候補があります。`,
      href: "/os/analytics/cost"
    }] : []),
    ...(missingReceipts.length ? [{
      title: "証憑確認",
      detail: `${formatNumber(missingReceipts.length)} 件のレシート未アップロードがあります。`,
      href: "/os/history"
    }] : [])
  ].slice(0, 5);

  return (
    <section className="os-home-dashboard" aria-label="主要指標">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Today Overview</p>
          <h2>主要データ</h2>
        </div>
        {isLoading ? <span className="source-indicator">読み込み中</span> : <span className="source-indicator">最新</span>}
      </div>
      <div className="os-home-metric-grid">
        {metrics.map((metric) => <OsHomeMetricCard metric={metric} key={metric.label} />)}
      </div>
      <div className="os-home-dashboard-grid">
        <section className="os-home-dashboard-panel">
          <div className="os-home-panel-heading">
            <h3>動いている発注</h3>
            <a href="/os/orders">一覧</a>
          </div>
          {orders.length ? (
            <div className="os-home-compact-list">
              {orders.map((order) => (
                <a href={`/os/orders#order-${order.id}`} key={order.id}>
                  <span>
                    <strong>{order.id}</strong>
                    <small>{order.store} / {order.brand}</small>
                  </span>
                  <span>
                    <b>{order.status}</b>
                    <small>{order.deadline || `${order.items} 品目`}</small>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="empty-state">処理中の発注はありません。</p>
          )}
        </section>
        <section className="os-home-dashboard-panel">
          <div className="os-home-panel-heading">
            <h3>全体アラート</h3>
            <a href="/os/analytics">分析</a>
          </div>
          {operationalAlerts.length ? (
            <div className="os-home-compact-list">
              {operationalAlerts.map((alert) => (
                <a href={alert.href} key={alert.title}>
                  <span>
                    <strong>{alert.title}</strong>
                    <small>{alert.detail}</small>
                  </span>
                  <span>
                    <b>確認</b>
                    <AlertTriangle size={14} />
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="empty-state">今すぐ確認が必要な全体アラートはありません。</p>
          )}
        </section>
      </div>
    </section>
  );
}

function OsHomeModuleCard({ module }: { module: OsNavModuleWithChildren }) {
  const Icon = module.icon;
  const mainHref = module.href ?? module.children[0]?.href ?? "/os";
  const directChild = module.href ? module.children.find((child) => child.href === module.href) : null;
  const summary = moduleSummaries[module.id] ?? "関連する業務画面をまとめて開きます。";
  const itemCount = directChild && module.children.length === 1 ? 1 : module.children.length;

  return (
    <a className="os-home-module-card" href={mainHref}>
      <span className="os-home-module-main">
        <span className="os-home-module-icon">
          <Icon size={24} />
        </span>
        <span className="os-home-module-kicker">{itemCount} 入口</span>
      </span>
      <span className="os-home-module-title">
        <span>
          {module.label}
          {directChild?.beta ? <span className="nav-beta-badge">Beta</span> : null}
        </span>
      </span>
      <span className="os-home-module-summary">{summary}</span>
      <span className="os-home-module-action">
        開く
        <ChevronRight size={16} />
      </span>
    </a>
  );
}

function OsHomeDesktop({ modules }: { modules: OsNavModuleWithChildren[] }) {
  if (!modules.length) return <p className="empty-state">利用できる機能がありません。</p>;

  return (
    <div className="os-home-module-grid">
      {modules.map((module) => (
        <OsHomeModuleCard module={module} key={module.id} />
      ))}
    </div>
  );
}

export default function Foundr1OsHome() {
  const cachedEmployee = getCachedCurrentEmployee();
  const [role, setRole] = useState(() => cachedEmployee?.role ?? "");
  const permittedNavModules = usePermittedNavModules(canonicalNavItems);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [salesStats, setSalesStats] = useState<SalesStats | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [payrollAlerts, setPayrollAlerts] = useState<PayrollStatutoryAlert[]>([]);
  const [dismissingAlertKey, setDismissingAlertKey] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadRole() {
      const employee = await loadCurrentEmployee();
      if (isMounted) setRole(employee?.role ?? "");
    }

    void loadRole();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      setDashboardLoading(true);
      const [dashboardResponse, salesResponse, loyaltyResponse] = await Promise.allSettled([
        fetch("/api/dashboard", { cache: "no-store" }),
        fetch("/api/store/order-stats?days=1", { cache: "no-store" }),
        fetch("/api/os/loyalty", { cache: "no-store" })
      ]);
      if (dashboardResponse.status === "fulfilled" && dashboardResponse.value.ok) {
        const body = await dashboardResponse.value.json() as DashboardData;
        if (isMounted) setDashboard(body);
      }
      if (salesResponse.status === "fulfilled" && salesResponse.value.ok) {
        const body = await salesResponse.value.json() as SalesStats;
        if (isMounted) setSalesStats(body);
      }
      if (loyaltyResponse.status === "fulfilled" && loyaltyResponse.value.ok) {
        const body = await loyaltyResponse.value.json() as LoyaltyData;
        if (isMounted) setLoyalty(body);
      }
      if (isMounted) setDashboardLoading(false);
    }

    void loadDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadPayrollAlerts() {
      const response = await fetch("/api/settings/payroll-statutory-alerts", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { alerts?: PayrollStatutoryAlert[]; canView?: boolean };
      if (isMounted && body.canView) setPayrollAlerts(body.alerts ?? []);
    }

    void loadPayrollAlerts();

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
        const body = await nextResponse.json() as { alerts?: PayrollStatutoryAlert[]; canView?: boolean };
        if (body.canView) setPayrollAlerts(body.alerts ?? []);
      }
    }
    setDismissingAlertKey("");
  }

  const payrollAlertActionHref = ["store_owner", "store_manager"].includes(role) ? "/os/timecard/payroll" : "/os/settings";
  const payrollAlertActionLabel = ["store_owner", "store_manager"].includes(role) ? "給与へ" : "システム設定へ";

  return (
    <main className="os-home-shell">
      <header className="os-home-topbar">
        <a className="brand-block" href="/os" aria-label="Foundr1 OS ホーム">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>管理画面</h1>
          </div>
        </a>
        <div className="os-home-user">
          <UserBadge />
          <MobileNavMenu navItems={canonicalNavItems} />
        </div>
      </header>

      <section className="os-home-hero">
        <div>
          <p className="eyebrow">Restaurant Operating System</p>
          <h2>今日の状態を見る</h2>
          <p>発注、購入、納品、レシートの詰まりを先に確認し、必要な業務へすぐ移動します。</p>
        </div>
      </section>

      {payrollAlerts.length ? (
        <section className="statutory-alert-panel" aria-label="給与法定データ更新アラート">
          <div className="statutory-alert-heading">
            <strong>給与計算データの更新が必要です</strong>
            <a className="secondary-button" href={payrollAlertActionHref}>{payrollAlertActionLabel}</a>
          </div>
          <div className="statutory-alert-list">
            {payrollAlerts.map((alert) => (
              <article className={`statutory-alert-card is-${alert.level}`} key={alert.key}>
                <div>
                  <span>{alert.dueLabel}</span>
                  <h3>{alert.title}</h3>
                  <p>{alert.message}</p>
                </div>
                <div className="statutory-alert-card-actions">
                  <strong>{alert.actionLabel}</strong>
                  {alert.dismissible ? (
                    <button
                      className="secondary-button"
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
          </div>
        </section>
      ) : null}

      <OsHomeDashboard dashboard={dashboard} salesStats={salesStats} loyalty={loyalty} isLoading={dashboardLoading} />

      <section className="os-module-section" aria-label="業務入口">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Workspace Desktop</p>
            <h2>業務デスクトップ</h2>
          </div>
        </div>
        <OsHomeDesktop modules={permittedNavModules} />
      </section>
    </main>
  );
}
