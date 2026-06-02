"use client";

import {
  BriefcaseBusiness,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Clock3,
  FileText,
  Lightbulb,
  LogOut,
  MessageSquareWarning,
  PackageCheck,
  Search,
  Settings,
  Store,
  Truck,
  UserCog,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { MobileNavMenu } from "../../components/MobileNavMenu";
import { OsNavList } from "../../components/OsNavList";
import { UserBadge } from "../../components/UserBadge";

type StoreOption = { id: string; name: string };
type WorkloadEmployee = {
  employeeId: string;
  employeeName: string;
  workMinutes: number;
  workDays: number;
  orderCount: number;
  sales: number;
  peakHourOrderCount: number;
  peakHourSales: number;
  peakHourLoadScore: number;
  onePersonHighLoadMinutes: number;
  idleBlockCount: number;
  idleMinutes: number;
  ordersPerHour: number;
  salesPerHour: number;
};
type WorkloadShift = {
  employeeId: string;
  employeeName: string;
  workDate: string;
  clockIn: string;
  clockOut: string;
  workMinutes: number;
  orderCount: number;
  sales: number;
  ordersPerHour: number;
  peakHourOrderCount: number;
  peakHourSales: number;
  peakHourLoadScore: number;
  isOnePerson: boolean;
  idleMinutes: number;
};
type WorkloadSummary = {
  month: string;
  stores: StoreOption[];
  selectedStoreId: string;
  canEditSettings: boolean;
  settings: {
    includeManagement: boolean;
  };
  excludedManagementShiftCount: number;
  totals: {
    workMinutes: number;
    orderCount: number;
    sales: number;
  };
  employees: WorkloadEmployee[];
  busiestEmployees: WorkloadEmployee[];
  lightestEmployees: WorkloadEmployee[];
  busiestShifts: WorkloadShift[];
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "タイムカード", href: "/os/timecard", icon: Clock3 },
  { label: "シフト", href: "/os/timecard/schedule", icon: CalendarDays },
  { label: "負荷分析", href: "/os/timecard/workload", icon: ChartColumn },
  { label: "給与", href: "/os/timecard/payroll", icon: WalletCards },
  { label: "商品マスタ", href: "/os/products", icon: BriefcaseBusiness },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "システム設定", href: "/os/settings", icon: Settings },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

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

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}時間${String(mins).padStart(2, "0")}分`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function rate(value: number) {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value);
}

function score(value: number) {
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value)}pt`;
}

function percent(value: number) {
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value)}%`;
}

function idleRate(employee: WorkloadEmployee) {
  return employee.workMinutes > 0 ? (employee.idleMinutes / employee.workMinutes) * 100 : 0;
}

function chartWidth(value: number, maxValue: number) {
  if (!Number.isFinite(value) || value <= 0 || maxValue <= 0) return "0%";
  return `${Math.max(4, Math.min(100, (value / maxValue) * 100))}%`;
}

const timecardMonthStorageKey = "foundr1:timecard:selected-month";
const timecardStoreStorageKey = "foundr1:timecard:selected-store-id";

function getStoredTimecardMonth() {
  if (typeof window === "undefined") return getCurrentMonth();
  const stored = window.localStorage.getItem(timecardMonthStorageKey);
  return stored && /^\d{4}-\d{2}$/.test(stored) ? stored : getCurrentMonth();
}

function getStoredTimecardStoreId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(timecardStoreStorageKey) ?? "";
}

function storeTimecardSelection(nextMonth: string, nextStoreId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(timecardMonthStorageKey, nextMonth);
  if (nextStoreId) window.localStorage.setItem(timecardStoreStorageKey, nextStoreId);
}

export default function TimecardWorkloadPage() {
  const [month, setMonth] = useState(getStoredTimecardMonth);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [data, setData] = useState<WorkloadSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  async function loadWorkload(nextMonth = month, nextStoreId = selectedStoreId) {
    setIsLoading(true);
    const params = new URLSearchParams({ month: nextMonth });
    if (nextStoreId) params.set("storeId", nextStoreId);
    const response = await fetch(`/api/timecard/workload?${params.toString()}`, { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as WorkloadSummary;
      setData(body);
      setSelectedStoreId(body.selectedStoreId);
      storeTimecardSelection(body.month, body.selectedStoreId);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    void loadWorkload(getStoredTimecardMonth(), getStoredTimecardStoreId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busiest = data?.busiestEmployees[0] ?? null;
  const lightest = data?.lightestEmployees[0] ?? null;
  const totalContributionSales = data?.employees.reduce((sum, employee) => sum + employee.sales, 0) ?? 0;
  const salesContributionEmployees = [...(data?.employees ?? [])].sort((a, b) => (
    b.sales - a.sales
    || b.salesPerHour - a.salesPerHour
  ));
  const workloadChartEmployees = [...(data?.employees ?? [])].sort((a, b) => (
    b.peakHourLoadScore - a.peakHourLoadScore
    || b.ordersPerHour - a.ordersPerHour
  ));
  const maxPeakLoadScore = Math.max(0, ...workloadChartEmployees.map((employee) => employee.peakHourLoadScore));
  const maxOrdersPerHour = Math.max(0, ...workloadChartEmployees.map((employee) => employee.ordersPerHour));
  const maxSales = Math.max(0, ...salesContributionEmployees.map((employee) => employee.sales));
  const maxSalesPerHour = Math.max(0, ...salesContributionEmployees.map((employee) => employee.salesPerHour));

  async function saveIncludeManagement(includeManagement: boolean) {
    if (!selectedStoreId) return;
    setIsSavingSettings(true);
    const response = await fetch("/api/timecard/workload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: selectedStoreId, includeManagement })
    });
    if (response.ok) {
      await loadWorkload(month, selectedStoreId);
    }
    setIsSavingSettings(false);
  }

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

      <section className="workspace workload-workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">売上データと勤怠の重ね合わせ</p>
            <h2>負荷分析</h2>
            <span className="source-indicator">{isLoading ? "読み込み中" : `${month} 集計済み`}</span>
          </div>
          <div className="timecard-toolbar">
            <input type="month" value={month} onChange={(event) => {
              setMonth(event.target.value);
              storeTimecardSelection(event.target.value, selectedStoreId);
              void loadWorkload(event.target.value, selectedStoreId);
            }} />
            <select value={selectedStoreId} onChange={(event) => {
              setSelectedStoreId(event.target.value);
              storeTimecardSelection(month, event.target.value);
              void loadWorkload(month, event.target.value);
            }}>
              {data?.stores.map((store) => (
                <option value={store.id} key={store.id}>{store.name}</option>
              ))}
            </select>
          </div>
        </header>

        <section className="metric-grid">
          <article className="metric-card">
            <span>勤務時間</span>
            <strong>{formatDuration(data?.totals.workMinutes ?? 0)}</strong>
            <small>対象月の実績</small>
          </article>
          <article className="metric-card">
            <span>担当注文</span>
            <strong>{data?.totals.orderCount ?? 0}件</strong>
            <small>{formatMoney(data?.totals.sales ?? 0)}</small>
          </article>
          <article className="metric-card">
            <span>負荷最大</span>
            <strong>{busiest?.employeeName ?? "-"}</strong>
            <small>{busiest ? `ワンオペ高負荷 ${formatDuration(busiest.onePersonHighLoadMinutes)}` : "データなし"}</small>
          </article>
          <article className="metric-card">
            <span>負荷最少</span>
            <strong>{lightest?.employeeName ?? "-"}</strong>
            <small>{lightest ? `${rate(lightest.ordersPerHour)} 件/時` : "データなし"}</small>
          </article>
        </section>

        <section className="panel workload-settings-panel">
          <label className="settings-toggle-row workload-toggle-row">
            <input
              type="checkbox"
              checked={data?.settings.includeManagement ?? true}
              disabled={!data?.canEditSettings || isSavingSettings}
              onChange={(event) => void saveIncludeManagement(event.target.checked)}
            />
            <div>
              <strong>管理職を負荷計算に含める</strong>
              <span>
                {data?.settings.includeManagement
                  ? "店長・管理者の勤務もスタッフ負荷に含めています。"
                  : `店長・管理者の勤務を除外しています${data?.excludedManagementShiftCount ? `（除外 ${data.excludedManagementShiftCount} 勤務）` : ""}。`}
              </span>
            </div>
          </label>
        </section>

        <details className="panel workload-guide-panel">
          <summary>計算ロジック</summary>
          <div className="workload-guide-grid">
            <article>
              <h3>集計対象</h3>
              <p>選択した店舗・月度の売上注文と、タイムカードの実勤務時間を重ね合わせます。管理職の勤務は「管理職を負荷計算に含める」の設定に従って含める、または除外します。</p>
            </article>
            <article>
              <h3>ワンオペ</h3>
              <p>勤務全体ではなく15分単位で在勤人数を判定します。管理職を除外している場合、管理職は在勤人数にも含めません。</p>
            </article>
            <article>
              <h3>負荷ピーク</h3>
              <p>連続1時間の中で、注文数・売上・負荷点数が最も高い時間帯を見ます。負荷点数は「注文金額 ÷ 当月平均客単価」で計算し、低金額の注文も最低1ptとして扱います。</p>
            </article>
            <article>
              <h3>ワンオペ高負荷</h3>
              <p>ワンオペの時間帯で、1時間あたり注文8件以上、または負荷点数8pt以上になった時間を集計します。実際にワンオペだった分数だけを加算します。</p>
            </article>
            <article>
              <h3>売上貢献度</h3>
              <p>スタッフが勤務中にカバーした売上を集計します。現在はカバー口径のため、複数名勤務では同じ注文が複数スタッフに含まれます。賞与連動では、後続で分担売上の口径も追加できます。</p>
            </article>
            <article>
              <h3>売上/時間</h3>
              <p>カバー売上を実勤務時間で割った単位時間あたりの売上貢献です。長時間勤務による総額の差を補正して比較するための指標です。</p>
            </article>
          </div>
        </details>

        <section className="workload-chart-grid">
          <article className="panel workload-chart-panel">
            <div className="panel-title">
              <ChartColumn size={18} />
              <div>
                <h3>負荷チャート</h3>
                <p>ピーク負荷点数と平均注文密度をスタッフ別に比較します。</p>
              </div>
            </div>
            <div className="workload-chart-list">
              {workloadChartEmployees.map((employee) => (
                <div className="workload-chart-row" key={employee.employeeId}>
                  <div className="workload-chart-heading">
                    <strong>{employee.employeeName}</strong>
                    <span>{score(employee.peakHourLoadScore)}/時</span>
                  </div>
                  <div className="workload-chart-bar" aria-label={`${employee.employeeName} 負荷ピーク ${score(employee.peakHourLoadScore)}`}>
                    <i className="is-load" style={{ width: chartWidth(employee.peakHourLoadScore, maxPeakLoadScore) }} />
                  </div>
                  <div className="workload-chart-subbar">
                    <span>平均注文 {rate(employee.ordersPerHour)}件/時</span>
                    <div><i style={{ width: chartWidth(employee.ordersPerHour, maxOrdersPerHour) }} /></div>
                  </div>
                </div>
              ))}
              {data && workloadChartEmployees.length === 0 ? <div className="empty-state">負荷データはありません</div> : null}
            </div>
          </article>

          <article className="panel workload-chart-panel">
            <div className="panel-title">
              <ChartColumn size={18} />
              <div>
                <h3>売上貢献チャート</h3>
                <p>カバー売上と1時間あたりの売上貢献を比較します。</p>
              </div>
            </div>
            <div className="workload-chart-list">
              {salesContributionEmployees.map((employee) => (
                <div className="workload-chart-row" key={employee.employeeId}>
                  <div className="workload-chart-heading">
                    <strong>{employee.employeeName}</strong>
                    <span>{formatMoney(employee.sales)}</span>
                  </div>
                  <div className="workload-chart-bar" aria-label={`${employee.employeeName} 売上貢献 ${formatMoney(employee.sales)}`}>
                    <i className="is-sales" style={{ width: chartWidth(employee.sales, maxSales) }} />
                  </div>
                  <div className="workload-chart-subbar">
                    <span>売上/時間 {formatMoney(employee.salesPerHour)}</span>
                    <div><i style={{ width: chartWidth(employee.salesPerHour, maxSalesPerHour) }} /></div>
                  </div>
                </div>
              ))}
              {data && salesContributionEmployees.length === 0 ? <div className="empty-state">売上貢献データはありません</div> : null}
            </div>
          </article>
        </section>

        <section className="panel workload-table-panel">
          <div className="panel-title">
            <ChartColumn size={18} />
            <div>
              <h3>スタッフ別負荷</h3>
              <p>実勤務時間内に入った注文とピーク負荷をスタッフ別に集計します。</p>
            </div>
          </div>
          <div className="timecard-table-wrap">
            <table className="timecard-table workload-table">
              <thead>
                <tr>
                  <th>スタッフ</th>
                  <th>勤務</th>
                  <th>注文</th>
                  <th>注文/時</th>
                  <th>売上/時間</th>
                  <th>負荷ピーク</th>
                  <th>ワンオペ高負荷</th>
                  <th>空き時間</th>
                </tr>
              </thead>
              <tbody>
                {(data?.employees ?? []).map((employee) => (
                  <tr key={employee.employeeId}>
                    <td><strong>{employee.employeeName}</strong></td>
                    <td>{employee.workDays}日 / {formatDuration(employee.workMinutes)}</td>
                    <td>{employee.orderCount}件</td>
                    <td>{rate(employee.ordersPerHour)}</td>
                    <td>{formatMoney(employee.salesPerHour)}</td>
                    <td>
                      <strong>{score(employee.peakHourLoadScore)}/時</strong>
                      <small>注文 {employee.peakHourOrderCount}件 / {formatMoney(employee.peakHourSales)}</small>
                    </td>
                    <td>{formatDuration(employee.onePersonHighLoadMinutes)}</td>
                    <td>{formatDuration(employee.idleMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.employees.length === 0 ? <div className="empty-state">勤怠または売上データがまだありません</div> : null}
        </section>

        <section className="panel workload-table-panel">
          <div className="panel-title">
            <ChartColumn size={18} />
            <div>
              <h3>売上貢献度</h3>
              <p>勤務中にカバーした売上と、1時間あたりの売上貢献を集計します。</p>
            </div>
          </div>
          <div className="timecard-table-wrap">
            <table className="timecard-table workload-table">
              <thead>
                <tr>
                  <th>スタッフ</th>
                  <th>勤務</th>
                  <th>カバー売上</th>
                  <th>貢献率</th>
                  <th>売上/時間</th>
                  <th>カバー注文</th>
                  <th>注文/時</th>
                </tr>
              </thead>
              <tbody>
                {salesContributionEmployees.map((employee) => (
                  <tr key={employee.employeeId}>
                    <td><strong>{employee.employeeName}</strong></td>
                    <td>{employee.workDays}日 / {formatDuration(employee.workMinutes)}</td>
                    <td>{formatMoney(employee.sales)}</td>
                    <td>{percent(totalContributionSales > 0 ? (employee.sales / totalContributionSales) * 100 : 0)}</td>
                    <td>{formatMoney(employee.salesPerHour)}</td>
                    <td>{employee.orderCount}件</td>
                    <td>{rate(employee.ordersPerHour)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && salesContributionEmployees.length === 0 ? <div className="empty-state">売上貢献データはありません</div> : null}
        </section>

        <section className="sales-grid">
          <article className="panel">
            <h3>高負荷だった勤務（シフト別）</h3>
            <div className="sales-rank-list">
              {(data?.busiestShifts ?? []).map((shift) => (
                <div className="sales-rank-row" key={`${shift.employeeId}-${shift.workDate}-${shift.clockIn}`}>
                  <span>{formatDate(shift.workDate)} {shift.employeeName}</span>
                  <strong>{score(shift.peakHourLoadScore)}/時</strong>
                  <small>{formatTime(shift.clockIn)}-{formatTime(shift.clockOut)} / 注文ピーク {shift.peakHourOrderCount}件 / {shift.isOnePerson ? "ワンオペ" : "複数名"}</small>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <h3>スタッフ総合負荷ランキング</h3>
            <div className="sales-rank-list">
              {(data?.busiestEmployees ?? []).map((employee) => (
                <div className="sales-rank-row" key={employee.employeeId}>
                  <span>{employee.employeeName}</span>
                  <strong>{formatDuration(employee.onePersonHighLoadMinutes)}</strong>
                  <small>{rate(employee.ordersPerHour)}件/時 / 負荷ピーク {score(employee.peakHourLoadScore)}/時 / 注文ピーク {employee.peakHourOrderCount}件</small>
                </div>
              ))}
            </div>
          </article>
          <article className="panel">
            <h3>負荷最少ランキング</h3>
            <div className="sales-rank-list">
              {(data?.lightestEmployees ?? []).map((employee) => (
                <div className="sales-rank-row" key={employee.employeeId}>
                  <span>{employee.employeeName}</span>
                  <strong>{percent(idleRate(employee))}</strong>
                  <small>空き {formatDuration(employee.idleMinutes)} / 勤務 {formatDuration(employee.workMinutes)} / {rate(employee.ordersPerHour)}件/時</small>
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
