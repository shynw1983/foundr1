"use client";

import {
  Boxes,
  ChartColumn,
  LineChart,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AnalyticsShell } from "./components/AnalyticsShell";

type StoreOption = { id: string; name: string };
type SalesSummary = {
  month: string;
  startDate: string;
  endDate: string;
  stores: StoreOption[];
  selectedStoreId: string;
  totals: {
    orderCount: number;
    sales: number;
    estimatedFee: number;
    estimatedDeposit: number;
    deliveryShare: number;
    averageOrderValue: number;
    activeDayCount: number;
  };
};
type PayrollTotals = {
  laborCost: number;
  commuteAllowance: number;
  workMinutes: number;
};
type TimecardSummary = {
  month: string;
  canViewPayroll: boolean;
  stores: StoreOption[];
  selectedStoreId: string;
  payrollTotals: PayrollTotals;
};
type AnalyticsState = {
  sales: SalesSummary | null;
  timecard: TimecardSummary | null;
  error: string;
};

const analyticsCards = [
  {
    title: "売上分析",
    description: "売上、入金見込み、チャネル、忙しさ、天気、取込状況を確認します。",
    href: "/os/analytics/sales",
    icon: ChartColumn,
    status: "利用可能"
  },
  {
    title: "人件費分析",
    description: "勤怠と給与設定から、人件費率や売上/人件費のバランスを確認します。",
    href: "/os/analytics/labor",
    icon: WalletCards,
    status: "準備中"
  },
  {
    title: "原価分析",
    description: "発注・購入・レシートから、食材原価や包材・消耗品コストを集計します。",
    href: "/os/analytics/cost",
    icon: Boxes,
    status: "準備中"
  },
  {
    title: "月次損益",
    description: "売上、人件費、原価、手数料を統合し、月ごとの利益を確認します。",
    href: "/os/analytics/profit",
    icon: LineChart,
    status: "準備中"
  }
];

function getCurrentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function getMonthRange(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const endDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { startDate: `${month}-01`, endDate: `${month}-${String(endDay).padStart(2, "0")}` };
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(amount);
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}時間${String(mins).padStart(2, "0")}分`;
}

function chartWidth(value: number, maxValue: number) {
  if (maxValue <= 0) return "0%";
  return `${Math.min(100, Math.max(4, (value / maxValue) * 100))}%`;
}

export default function AnalyticsPage() {
  const [month, setMonth] = useState(getCurrentMonth);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [state, setState] = useState<AnalyticsState>({ sales: null, timecard: null, error: "" });
  const [isLoading, setIsLoading] = useState(true);

  async function loadAnalytics(nextMonth = month, nextStoreId = selectedStoreId) {
    setIsLoading(true);
    setState((current) => ({ ...current, error: "" }));
    const range = getMonthRange(nextMonth);
    const salesParams = new URLSearchParams({
      month: nextMonth,
      startDate: range.startDate,
      endDate: range.endDate
    });
    if (nextStoreId) salesParams.set("storeId", nextStoreId);

    try {
      const salesResponse = await fetch(`/api/sales/summary?${salesParams.toString()}`, { cache: "no-store" });
      if (!salesResponse.ok) {
        const body = await salesResponse.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "売上データを読み込めませんでした。");
      }
      const sales = await salesResponse.json() as SalesSummary;
      const resolvedStoreId = sales.selectedStoreId || nextStoreId;
      const timecardParams = new URLSearchParams({ month: nextMonth });
      if (resolvedStoreId) timecardParams.set("storeId", resolvedStoreId);
      const timecardResponse = await fetch(`/api/timecard?${timecardParams.toString()}`, { cache: "no-store" });
      const timecard = timecardResponse.ok ? await timecardResponse.json() as TimecardSummary : null;

      setStores(sales.stores.length ? sales.stores : timecard?.stores ?? []);
      setSelectedStoreId(resolvedStoreId || timecard?.selectedStoreId || "");
      setState({ sales, timecard, error: timecardResponse.ok ? "" : "人件費データを読み込めませんでした。" });
    } catch (error) {
      setState({ sales: null, timecard: null, error: error instanceof Error ? error.message : "経営分析データを読み込めませんでした。" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAnalytics(getCurrentMonth(), "");
  }, []);

  const salesTotals = state.sales?.totals;
  const payrollTotals = state.timecard?.payrollTotals;
  const salesAmount = salesTotals?.sales ?? 0;
  const estimatedDeposit = salesTotals?.estimatedDeposit ?? 0;
  const laborCost = payrollTotals?.laborCost ?? 0;
  const laborRate = salesAmount > 0 ? (laborCost / salesAmount) * 100 : 0;
  const afterLabor = estimatedDeposit - laborCost;
  const maxChartValue = Math.max(salesAmount, estimatedDeposit, laborCost, afterLabor, 1);
  const selectedStoreName = stores.find((store) => store.id === selectedStoreId)?.name ?? "店舗";
  const chartRows = useMemo(() => [
    { label: "売上", value: salesAmount, note: "売上分析から取得", className: "is-sales" },
    { label: "入金見込み", value: estimatedDeposit, note: "デリバリー手数料差引後", className: "is-deposit" },
    { label: "人件費", value: laborCost, note: state.timecard?.canViewPayroll ? "タイムカード給与から取得" : "給与権限が必要", className: "is-labor" },
    { label: "原価", value: 0, note: "発注・購入から接続予定", className: "is-placeholder" },
    { label: "人件費差引", value: afterLabor, note: "原価接続前の暫定値", className: "is-profit" }
  ], [afterLabor, estimatedDeposit, laborCost, salesAmount, state.timecard?.canViewPayroll]);

  return (
    <AnalyticsShell eyebrow="Management Analytics" title="経営分析" sourceLabel={isLoading ? "読み込み中" : `${selectedStoreName} / ${month}`} workspaceClassName="analytics-workspace">
        <section className="panel analytics-overview-panel">
          <div className="panel-title">
            <LineChart size={18} />
            <div>
              <h3>月次経営サマリー</h3>
              <p>月と店舗を選択して、売上、入金見込み、人件費、未接続コストの位置をまとめて確認します。</p>
            </div>
          </div>
          <div className="analytics-control-row">
            <label>
              <span>対象月</span>
              <input
                type="month"
                value={month}
                onChange={(event) => {
                  const nextMonth = event.target.value || getCurrentMonth();
                  setMonth(nextMonth);
                  void loadAnalytics(nextMonth, selectedStoreId);
                }}
              />
            </label>
            <label>
              <span>店舗</span>
              <select
                value={selectedStoreId}
                onChange={(event) => {
                  setSelectedStoreId(event.target.value);
                  void loadAnalytics(month, event.target.value);
                }}
              >
                {stores.map((store) => (
                  <option value={store.id} key={store.id}>{store.name}</option>
                ))}
              </select>
            </label>
            <a className="secondary-button" href="/os/analytics/sales">売上分析を開く</a>
          </div>
          {state.error ? <p className="empty-state-text">{state.error}</p> : null}
        </section>

        <section className="metric-grid analytics-metric-grid">
          <article className="metric-card">
            <span>当月売上</span>
            <strong>{formatMoney(salesAmount)}</strong>
            <p>{salesTotals ? `${salesTotals.orderCount}件 / 稼働${salesTotals.activeDayCount}日` : "売上分析から取得"}</p>
          </article>
          <article className="metric-card">
            <span>入金見込み</span>
            <strong>{formatMoney(estimatedDeposit)}</strong>
            <p>手数料見込み {formatMoney(salesTotals?.estimatedFee ?? 0)}</p>
          </article>
          <article className="metric-card">
            <span>人件費</span>
            <strong>{formatMoney(laborCost)}</strong>
            <p>{payrollTotals ? `勤務 ${formatDuration(payrollTotals.workMinutes)} / 交通費 ${formatMoney(payrollTotals.commuteAllowance)}` : "タイムカード給与から取得"}</p>
          </article>
          <article className="metric-card">
            <span>人件費率</span>
            <strong>{formatPercent(laborRate)}</strong>
            <p>売上に対する人件費</p>
          </article>
        </section>

        <section className="analytics-chart-grid">
          <article className="panel">
            <div className="panel-title">
              <ChartColumn size={18} />
              <div>
                <h3>月次損益の接続状況</h3>
                <p>原価とその他費用は今後、発注・購入データから接続します。</p>
              </div>
            </div>
            <div className="analytics-bar-list">
              {chartRows.map((row) => (
                <div className="analytics-bar-row" key={row.label}>
                  <div className="analytics-bar-heading">
                    <strong>{row.label}</strong>
                    <span>{row.note}</span>
                    <b>{formatMoney(row.value)}</b>
                  </div>
                  <div className="analytics-bar-track">
                    <i className={row.className} style={{ width: chartWidth(Math.max(0, row.value), maxChartValue) }} />
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-title">
              <Boxes size={18} />
              <div>
                <h3>未接続コスト</h3>
                <p>発注・購入、レシート、その他費用を接続すると月次利益まで表示します。</p>
              </div>
            </div>
            <div className="analytics-placeholder-list">
              <div>
                <span>原価</span>
                <strong>接続予定</strong>
                <p>発注・購入 / レシート</p>
              </div>
              <div>
                <span>その他費用</span>
                <strong>接続予定</strong>
                <p>家賃、光熱費、決済手数料など</p>
              </div>
              <div>
                <span>月次利益</span>
                <strong>設計中</strong>
                <p>売上 - 人件費 - 原価 - その他費用</p>
              </div>
            </div>
          </article>
        </section>

        <section className="os-module-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Analytics</p>
              <h2>分析メニュー</h2>
            </div>
          </div>
          <div className="os-module-grid">
            {analyticsCards.map((card) => {
              const Icon = card.icon;
              return (
                <a className="os-module-card" href={card.href} key={card.title}>
                  <div className="os-module-icon">
                    <Icon size={24} />
                  </div>
                  <div>
                    <div className="os-module-heading">
                      <h3>{card.title}</h3>
                      <span className={card.status === "利用可能" ? "status-pill is-active" : "status-pill"}>{card.status}</span>
                    </div>
                    <p>{card.description}</p>
                  </div>
                </a>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <LineChart size={18} />
            <div>
              <h3>月次損益への接続</h3>
              <p>売上分析を起点に、人件費、発注・購入原価、手数料を順に接続して月次損益を作ります。</p>
            </div>
          </div>
        </section>
    </AnalyticsShell>
  );
}
