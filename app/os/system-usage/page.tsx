"use client";

import {
  AlertTriangle,
  BellRing,
  ChartColumn,
  ClipboardList,
  Gauge,
  LogOut,
  RefreshCw,
  Settings
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type UsageStatus = "safe" | "watch" | "warning" | "critical" | "unknown";

type ExternalServiceMetric = {
  serviceKey: string;
  serviceName: string;
  metricKey: string;
  metricLabel: string;
  unit: "count" | "bytes" | "jpy";
  periodKind: "month" | "day" | "current";
  limitValue: number | null;
  includedLabel: string;
  paidTrigger: string;
  sourceLabel: string;
  value: number;
  displayValue: string;
  displayLimit: string;
  percent: number | null;
  status: UsageStatus;
  periodLabel: string;
  note: string;
};

type UsageDashboard = {
  month: string;
  generatedAt: string;
  summary: {
    configuredCount: number;
    watchCount: number;
    warningCount: number;
    criticalCount: number;
    estimatedMonthlyCostJpy: number;
  };
  metrics: ExternalServiceMetric[];
  services: Array<{
    serviceKey: string;
    serviceName: string;
    status: UsageStatus;
    metrics: ExternalServiceMetric[];
  }>;
  trend: Array<{
    month: string;
    resendEmails: number;
    pusherMessages: number;
    blobBytes: number;
    squareAmount: number;
    komojuAmount: number;
  }>;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "外部サービス利用量", href: "/os/system-usage", icon: Gauge },
  { label: "システム設定", href: "/os/settings", icon: Settings },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const statusLabels: Record<UsageStatus, string> = {
  safe: "安全",
  watch: "観察",
  warning: "注意",
  critical: "要対応",
  unknown: "従量"
};

const statusClassNames: Record<UsageStatus, string> = {
  safe: "is-safe",
  watch: "is-watch",
  warning: "is-warning",
  critical: "is-critical",
  unknown: "is-unknown"
};

function getCurrentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(amount);
}

function formatGeneratedAt(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getUsageWidth(metric: ExternalServiceMetric) {
  if (metric.percent === null) return "100%";
  return `${Math.min(100, Math.max(3, metric.percent))}%`;
}

function getTrendMax(dashboard: UsageDashboard | null) {
  if (!dashboard) return 1;
  return Math.max(
    1,
    ...dashboard.trend.map((item) => item.resendEmails),
    ...dashboard.trend.map((item) => item.pusherMessages / 1000),
    ...dashboard.trend.map((item) => item.blobBytes / (1024 * 1024)),
    ...dashboard.trend.map((item) => (item.squareAmount + item.komojuAmount) / 10000)
  );
}

export default function SystemUsagePage() {
  const [month, setMonth] = useState(getCurrentMonth);
  const [dashboard, setDashboard] = useState<UsageDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadDashboard(nextMonth = month) {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/os/system-usage?month=${encodeURIComponent(nextMonth)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "外部サービス利用量を読み込めませんでした。");
      setDashboard(body as UsageDashboard);
      setMonth((body as UsageDashboard).month || nextMonth);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "外部サービス利用量を読み込めませんでした。");
    } finally {
      setIsLoading(false);
    }
  }

  async function runAlertCheck() {
    setIsChecking(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/os/system-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "アラート確認に失敗しました。");
      setMessage(Number(body.notificationCount ?? 0) > 0 ? `owner に ${body.notificationCount} 件の通知を作成しました。` : "新しい通知対象はありません。");
      await loadDashboard(month);
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "アラート確認に失敗しました。");
    } finally {
      setIsChecking(false);
    }
  }

  useEffect(() => {
    void loadDashboard(getCurrentMonth());
  }, []);

  const trendMax = useMemo(() => getTrendMax(dashboard), [dashboard]);
  const highestRiskMetrics = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.metrics
      .filter((metric) => metric.status === "warning" || metric.status === "critical" || metric.status === "watch")
      .slice(0, 4);
  }, [dashboard]);

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace system-usage-workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">System usage</p>
            <h2>外部サービス利用量</h2>
            <span className="source-indicator">低頻度集計・閾値アラート</span>
          </div>
          <div className="system-usage-actions">
            <label>
              <span>対象月</span>
              <input type="month" value={month} onChange={(event) => {
                const nextMonth = event.target.value || getCurrentMonth();
                setMonth(nextMonth);
                void loadDashboard(nextMonth);
              }} />
            </label>
            <button className="secondary-button" type="button" onClick={() => void loadDashboard(month)} disabled={isLoading}>
              <RefreshCw size={16} />
              更新
            </button>
            <button className="primary-button" type="button" onClick={() => void runAlertCheck()} disabled={isChecking || isLoading}>
              <BellRing size={16} />
              閾値確認
            </button>
          </div>
        </header>

        {error ? <div className="action-notice is-danger">{error}</div> : null}
        {message ? <div className="action-notice is-success">{message}</div> : null}

        <section className="system-usage-summary-grid">
          <article className="metric-card">
            <span>接続サービス</span>
            <strong>{dashboard?.summary.configuredCount ?? "-"}</strong>
            <p>コード上で管理対象にしている外部サービス</p>
          </article>
          <article className="metric-card">
            <span>注意以上</span>
            <strong>{dashboard ? dashboard.summary.warningCount + dashboard.summary.criticalCount : "-"}</strong>
            <p>無料枠や運用確認が近い項目</p>
          </article>
          <article className="metric-card">
            <span>決済手数料目安</span>
            <strong>{dashboard ? formatMoney(dashboard.summary.estimatedMonthlyCostJpy) : "-"}</strong>
            <p>Square / KOMOJU を 3.2% 仮置きで概算</p>
          </article>
          <article className="metric-card">
            <span>最終集計</span>
            <strong>{dashboard ? formatGeneratedAt(dashboard.generatedAt) : "-"}</strong>
            <p>表示時に DB から軽量集計</p>
          </article>
        </section>

        <section className="system-usage-chart-grid">
          <article className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Thresholds</p>
                <h3>付费阈值の近さ</h3>
              </div>
              <AlertTriangle size={18} />
            </div>
            <div className="system-usage-meter-list">
              {isLoading ? <p className="empty-state">利用量を読み込んでいます。</p> : null}
              {!isLoading && dashboard?.metrics.map((metric) => (
                <div className="system-usage-meter-row" key={`${metric.serviceKey}:${metric.metricKey}`}>
                  <div className="system-usage-meter-heading">
                    <div>
                      <strong>{metric.serviceName}</strong>
                      <span>{metric.metricLabel} · {metric.periodLabel}</span>
                    </div>
                    <b className={`status-pill ${statusClassNames[metric.status]}`}>{statusLabels[metric.status]}</b>
                  </div>
                  <div className="system-usage-meter-track" aria-label={`${metric.metricLabel} ${metric.displayValue}`}>
                    <i className={statusClassNames[metric.status]} style={{ width: getUsageWidth(metric) }} />
                  </div>
                  <div className="system-usage-meter-foot">
                    <span>{metric.displayValue} / {metric.displayLimit}</span>
                    <span>{metric.includedLabel}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Trend</p>
                <h3>6か月の利用傾向</h3>
              </div>
              <ChartColumn size={18} />
            </div>
            <div className="system-usage-trend-list">
              {dashboard?.trend.map((item) => {
                const emailWidth = Math.max(3, (item.resendEmails / trendMax) * 100);
                const pusherWidth = Math.max(3, ((item.pusherMessages / 1000) / trendMax) * 100);
                const blobWidth = Math.max(3, ((item.blobBytes / (1024 * 1024)) / trendMax) * 100);
                const paymentWidth = Math.max(3, (((item.squareAmount + item.komojuAmount) / 10000) / trendMax) * 100);
                return (
                  <div className="system-usage-trend-row" key={item.month}>
                    <span>{item.month}</span>
                    <div>
                      <i className="is-email" style={{ width: `${emailWidth}%` }} />
                      <i className="is-pusher" style={{ width: `${pusherWidth}%` }} />
                      <i className="is-blob" style={{ width: `${blobWidth}%` }} />
                      <i className="is-payment" style={{ width: `${paymentWidth}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="system-usage-legend">
              <span><i className="is-email" />メール</span>
              <span><i className="is-pusher" />リアルタイム</span>
              <span><i className="is-blob" />Blob</span>
              <span><i className="is-payment" />決済額</span>
            </div>
          </article>
        </section>

        <section className="system-usage-service-list">
          {highestRiskMetrics.length > 0 ? (
            <article className="panel system-usage-risk-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Attention</p>
                  <h3>確認優先度が高い項目</h3>
                </div>
              </div>
              <div className="system-usage-risk-grid">
                {highestRiskMetrics.map((metric) => (
                  <div key={`${metric.serviceKey}:${metric.metricKey}`}>
                    <b>{metric.serviceName}</b>
                    <strong>{metric.displayValue}</strong>
                    <span>{metric.paidTrigger}</span>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          {dashboard?.services.map((service) => (
            <article className="panel system-usage-service-card" key={service.serviceKey}>
              <div className="system-usage-service-head">
                <div>
                  <p className="eyebrow">{service.serviceKey}</p>
                  <h3>{service.serviceName}</h3>
                </div>
                <b className={`status-pill ${statusClassNames[service.status]}`}>{statusLabels[service.status]}</b>
              </div>
              <div className="system-usage-service-metrics">
                {service.metrics.map((metric) => (
                  <div key={metric.metricKey}>
                    <span>{metric.metricLabel}</span>
                    <strong>{metric.displayValue}</strong>
                    <small>{metric.includedLabel}</small>
                    <p>{metric.paidTrigger}</p>
                    {metric.note ? <em>{metric.note}</em> : null}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
