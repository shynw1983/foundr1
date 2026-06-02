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
  loadLevel: string;
  loadLevelLabel: string;
  loadLevelScore: number;
  peakLoadLevel: string;
  peakLoadLevelLabel: string;
  peakLoadLevelScore: number;
  evaluationScore: number;
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
  salesPerHour: number;
  peakHourOrderCount: number;
  peakHourSales: number;
  peakHourLoadScore: number;
  peakLoadLevel: string;
  peakLoadLevelLabel: string;
  peakLoadLevelScore: number;
  isOnePerson: boolean;
  idleMinutes: number;
};
type WorkloadSettings = {
  includeManagement: boolean;
  minOrderLoadScore: number;
  amountScoreMultiplier: number;
  highLoadOrderThreshold: number;
  highLoadScoreThreshold: number;
  orderVeryIdleMax: number;
  orderNormalMax: number;
  orderBusyMax: number;
  orderHighMax: number;
  salesVeryIdleMax: number;
  salesNormalMax: number;
  salesBusyMax: number;
  salesHighMax: number;
  scoreVeryIdle: number;
  scoreNormal: number;
  scoreBusy: number;
  scoreHigh: number;
  scoreExtreme: number;
  peakWeight: number;
  averageWeight: number;
  onePersonWeight: number;
  onePersonRateScoreCap: number;
};
type NumberWorkloadSettingKey = Exclude<keyof WorkloadSettings, "includeManagement">;
type WorkloadSummary = {
  month: string;
  stores: StoreOption[];
  selectedStoreId: string;
  canEditSettings: boolean;
  settings: WorkloadSettings;
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
const defaultWorkloadSettings: WorkloadSettings = {
  includeManagement: true,
  minOrderLoadScore: 1,
  amountScoreMultiplier: 1,
  highLoadOrderThreshold: 8,
  highLoadScoreThreshold: 8,
  orderVeryIdleMax: 4,
  orderNormalMax: 8,
  orderBusyMax: 12,
  orderHighMax: 15,
  salesVeryIdleMax: 4999,
  salesNormalMax: 9999,
  salesBusyMax: 14999,
  salesHighMax: 19999,
  scoreVeryIdle: 20,
  scoreNormal: 60,
  scoreBusy: 90,
  scoreHigh: 120,
  scoreExtreme: 150,
  peakWeight: 60,
  averageWeight: 30,
  onePersonWeight: 10,
  onePersonRateScoreCap: 30
};

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

const workloadScoreRows: Array<{ label: string; key: NumberWorkloadSettingKey }> = [
  { label: "かなり空き", key: "scoreVeryIdle" },
  { label: "通常", key: "scoreNormal" },
  { label: "忙しい", key: "scoreBusy" },
  { label: "高負荷", key: "scoreHigh" },
  { label: "超負荷", key: "scoreExtreme" }
];

const workloadWeightRows: Array<{ label: string; key: NumberWorkloadSettingKey; note: string }> = [
  { label: "ピーク負荷", key: "peakWeight", note: "その人が一番忙しかった1時間を重く見る比率です。" },
  { label: "平均負荷", key: "averageWeight", note: "月全体の平均的な忙しさを見る比率です。" },
  { label: "ワンオペ高負荷", key: "onePersonWeight", note: "一人勤務で高負荷だった時間を評価に入れる比率です。" }
];

export default function TimecardWorkloadPage() {
  const [month, setMonth] = useState(getStoredTimecardMonth);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [data, setData] = useState<WorkloadSummary | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<WorkloadSettings>(defaultWorkloadSettings);
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
      setSettingsDraft(body.settings);
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
  const currentSettings = settingsDraft ?? data?.settings ?? defaultWorkloadSettings;
  const settingsDisabled = !data?.canEditSettings || isSavingSettings || !selectedStoreId;

  function updateSettingsDraft(key: keyof WorkloadSettings, value: boolean | number) {
    setSettingsDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveWorkloadSettings(patch: Partial<WorkloadSettings> = {}) {
    if (!selectedStoreId) return;
    const nextSettings = { ...currentSettings, ...patch };
    setSettingsDraft(nextSettings);
    setIsSavingSettings(true);
    const response = await fetch("/api/timecard/workload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: selectedStoreId, ...nextSettings })
    });
    if (response.ok) {
      await loadWorkload(month, selectedStoreId);
    }
    setIsSavingSettings(false);
  }

  function renderNumberSetting(
    label: string,
    key: NumberWorkloadSettingKey,
    options: { min: number; max: number; step: number; suffix?: string; note?: string }
  ) {
    return (
      <label>
        <span>{label}</span>
        <div className="workload-setting-input-row">
          <input
            type="number"
            min={options.min}
            max={options.max}
            step={options.step}
            value={String(currentSettings[key])}
            disabled={settingsDisabled}
            onChange={(event) => updateSettingsDraft(key, Number(event.target.value))}
          />
          {options.suffix ? <em>{options.suffix}</em> : null}
        </div>
        {options.note ? <small>{options.note}</small> : null}
      </label>
    );
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
            <small>{lightest ? `${rate(lightest.ordersPerHour)} 件/時間` : "データなし"}</small>
          </article>
        </section>

        <section className="panel workload-settings-panel">
          <div className="panel-title">
            <Settings size={18} />
            <div>
              <h3>負荷点数設定</h3>
              <p>注文の複雑さと高負荷判定の基準を店舗ごとに調整します。</p>
            </div>
          </div>
          <div className="workload-settings-content">
            <label className="settings-toggle-row workload-toggle-row">
              <input
                type="checkbox"
                checked={currentSettings.includeManagement}
                disabled={settingsDisabled}
                onChange={(event) => void saveWorkloadSettings({ includeManagement: event.target.checked })}
              />
              <div>
                <strong>管理職を負荷計算に含める</strong>
                <span>
                  {currentSettings.includeManagement
                    ? "店長・管理者の勤務もスタッフ負荷に含めています。"
                    : `店長・管理者の勤務を除外しています${data?.excludedManagementShiftCount ? `（除外 ${data.excludedManagementShiftCount} 勤務）` : ""}。`}
                </span>
              </div>
            </label>
            <div className="workload-settings-section">
              <h4>負荷レベルの判定</h4>
              <p>注文数と売上/時間をそれぞれ判定し、高い方のレベルを採用します。</p>
              <div className="workload-level-settings-grid">
                {renderNumberSetting("かなり空き 注文", "orderVeryIdleMax", { min: 0, max: 100, step: 1, suffix: "件/時間まで" })}
                {renderNumberSetting("通常 注文", "orderNormalMax", { min: 1, max: 120, step: 1, suffix: "件/時間まで" })}
                {renderNumberSetting("忙しい 注文", "orderBusyMax", { min: 2, max: 150, step: 1, suffix: "件/時間まで" })}
                {renderNumberSetting("高負荷 注文", "orderHighMax", { min: 3, max: 200, step: 1, suffix: "件/時間まで" })}
                {renderNumberSetting("かなり空き 売上", "salesVeryIdleMax", { min: 0, max: 1000000, step: 100, suffix: "円/時間まで" })}
                {renderNumberSetting("通常 売上", "salesNormalMax", { min: 1, max: 1500000, step: 100, suffix: "円/時間まで" })}
                {renderNumberSetting("忙しい 売上", "salesBusyMax", { min: 2, max: 2000000, step: 100, suffix: "円/時間まで" })}
                {renderNumberSetting("高負荷 売上", "salesHighMax", { min: 3, max: 3000000, step: 100, suffix: "円/時間まで" })}
              </div>
              <small>上限を超えた場合は「超負荷」として扱います。保存時に数字の大小関係は自動補正します。</small>
            </div>

            <div className="workload-settings-section">
              <h4>レベル別点数</h4>
              <div className="workload-score-settings-grid">
                {workloadScoreRows.map((row) => renderNumberSetting(row.label, row.key, {
                  min: 0,
                  max: 500,
                  step: 1,
                  suffix: "pt"
                }))}
              </div>
            </div>

            <div className="workload-settings-section">
              <h4>総合評価点の配分</h4>
              <div className="workload-score-settings-grid">
                {workloadWeightRows.map((row) => renderNumberSetting(row.label, row.key, {
                  min: 0,
                  max: 100,
                  step: 1,
                  suffix: "%",
                  note: row.note
                }))}
                {renderNumberSetting("ワンオペ比率の上限", "onePersonRateScoreCap", {
                  min: 0,
                  max: 100,
                  step: 1,
                  suffix: "%",
                  note: "ワンオペ比率だけで評価点が過度に膨らまないようにする上限です。"
                })}
              </div>
            </div>

            <details className="workload-advanced-settings">
              <summary>単価による複雑さの補正</summary>
              <div className="workload-settings-grid">
                {renderNumberSetting("最低負荷点数", "minOrderLoadScore", {
                  min: 0.1,
                  max: 10,
                  step: 0.1,
                  suffix: "pt",
                  note: "低単価の注文でも最低この点数で扱います。"
                })}
                {renderNumberSetting("金額倍率", "amountScoreMultiplier", {
                  min: 0.1,
                  max: 5,
                  step: 0.1,
                  note: "単価による複雑さを強める、または弱めます。"
                })}
                {renderNumberSetting("ワンオペ高負荷 注文数", "highLoadOrderThreshold", {
                  min: 1,
                  max: 50,
                  step: 1,
                  suffix: "件/時間",
                  note: "ワンオペ高負荷時間を数えるための補助基準です。"
                })}
                {renderNumberSetting("ワンオペ高負荷 点数", "highLoadScoreThreshold", {
                  min: 1,
                  max: 100,
                  step: 0.5,
                  suffix: "pt",
                  note: "単価補正後の負荷点数がこの点数以上なら高負荷です。"
                })}
              </div>
            </details>
            <div className="workload-settings-actions">
              <button className="secondary-button" type="button" disabled={settingsDisabled} onClick={() => void saveWorkloadSettings()}>
                {isSavingSettings ? "保存中" : "設定を保存"}
              </button>
            </div>
          </div>
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
              <p>連続1時間の中で、注文数・売上・負荷点数が最も高い時間帯を見ます。負荷点数は「注文金額 ÷ 当月平均客単価 × 金額倍率」で計算し、低金額の注文も最低{score(currentSettings.minOrderLoadScore)}として扱います。</p>
            </article>
            <article>
              <h3>ワンオペ高負荷</h3>
              <p>ワンオペの時間帯で、1時間あたり注文{currentSettings.highLoadOrderThreshold}件以上、または負荷点数{score(currentSettings.highLoadScoreThreshold)}以上になった時間を集計します。実際にワンオペだった分数だけを加算します。</p>
            </article>
            <article>
              <h3>負荷レベル</h3>
              <p>1時間あたり注文数と売上/時間をそれぞれ判定し、高い方のレベルを採用します。注文は{currentSettings.orderVeryIdleMax}件まで=かなり空き、{currentSettings.orderNormalMax}件まで=通常、{currentSettings.orderBusyMax}件まで=忙しい、{currentSettings.orderHighMax}件まで=高負荷、それ以上=超負荷。売上は{formatMoney(currentSettings.salesVeryIdleMax)}まで=かなり空き、{formatMoney(currentSettings.salesNormalMax)}まで=通常、{formatMoney(currentSettings.salesBusyMax)}まで=忙しい、{formatMoney(currentSettings.salesHighMax)}まで=高負荷、それ以上=超負荷です。</p>
            </article>
            <article>
              <h3>評価点</h3>
              <p>ピーク負荷レベルを{currentSettings.peakWeight}%、平均負荷レベルを{currentSettings.averageWeight}%、ワンオペ高負荷の比率を{currentSettings.onePersonWeight}%として点数化します。ワンオペ比率は最大{currentSettings.onePersonRateScoreCap}%まで反映します。</p>
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
                    <span>{score(employee.peakHourLoadScore)}/時間</span>
                  </div>
                  <div className="workload-chart-bar" aria-label={`${employee.employeeName} 負荷ピーク ${score(employee.peakHourLoadScore)}`}>
                    <i className="is-load" style={{ width: chartWidth(employee.peakHourLoadScore, maxPeakLoadScore) }} />
                  </div>
                  <div className="workload-chart-subbar">
                    <span>平均注文 {rate(employee.ordersPerHour)}件/時間</span>
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
                  <th>注文/時間</th>
                  <th>売上/時間</th>
                  <th>負荷レベル</th>
                  <th>負荷ピーク</th>
                  <th>評価点</th>
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
                      <strong>{employee.loadLevelLabel}</strong>
                      <small>平均 {employee.loadLevelScore}pt</small>
                    </td>
                    <td>
                      <strong>{score(employee.peakHourLoadScore)}/時間</strong>
                      <small>{employee.peakLoadLevelLabel} / 注文 {employee.peakHourOrderCount}件 / {formatMoney(employee.peakHourSales)}</small>
                    </td>
                    <td>{score(employee.evaluationScore)}</td>
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
                  <th>注文/時間</th>
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
            <h3>負荷が高かった勤務（シフト別）</h3>
            <div className="sales-rank-list">
              {(data?.busiestShifts ?? []).map((shift) => (
                <div className="sales-rank-row" key={`${shift.employeeId}-${shift.workDate}-${shift.clockIn}`}>
                  <span>{formatDate(shift.workDate)} {shift.employeeName}</span>
                  <strong>{shift.peakLoadLevelLabel}</strong>
                  <small>{formatTime(shift.clockIn)}-{formatTime(shift.clockOut)} / ピーク {score(shift.peakHourLoadScore)}/時間 / 注文 {shift.peakHourOrderCount}件 / 売上 {formatMoney(shift.peakHourSales)} / {shift.isOnePerson ? "ワンオペ" : "複数名"}</small>
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
                  <strong>{score(employee.evaluationScore)}</strong>
                  <small>平均 {employee.loadLevelLabel} / ピーク {employee.peakLoadLevelLabel} / ワンオペ高負荷 {formatDuration(employee.onePersonHighLoadMinutes)}</small>
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
                  <small>空き {formatDuration(employee.idleMinutes)} / 勤務 {formatDuration(employee.workMinutes)} / {rate(employee.ordersPerHour)}件/時間</small>
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
