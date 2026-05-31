"use client";

import { BriefcaseBusiness, CalendarDays, ClipboardList, Clock3, FileText, Lightbulb, LogOut, MessageSquareWarning, PackageCheck, Search, Settings, Store, Truck, UserCog, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";
import { formatDuration, formatJstTime, getJstMonthLabel } from "../../../lib/timecard";

type StoreOption = {
  id: string;
  name: string;
};

type DailySummary = {
  key: string;
  employeeId: string;
  employeeName: string;
  storeName: string;
  workDate: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  workMinutes: number;
  nightMinutes: number;
  alerts: string[];
};

type PayrollRow = {
  employeeId: string;
  employeeName: string;
  storeNames: string[];
  employmentType: "hourly" | "monthly" | "mixed";
  hourlyWage: number | null;
  monthlySalary: number | null;
  workDays: number;
  punchCount: number;
  workMinutes: number;
  breakMinutes: number;
  nightMinutes: number;
  basePay: number;
  commuteAllowance: number;
  totalPay: number;
  alerts: string[];
};

type PayrollTotals = {
  workDays: number;
  punchCount: number;
  workMinutes: number;
  nightMinutes: number;
  laborCost: number;
  commuteAllowance: number;
  totalPay: number;
};

type TimecardPayload = {
  month: string;
  stores: StoreOption[];
  selectedStoreId: string;
  dailySummaries: DailySummary[];
  payrollRows: PayrollRow[];
  payrollTotals: PayrollTotals;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "発注管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "タイムカード", href: "/os/timecard", icon: Clock3 },
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

function formatMoney(amount: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(amount);
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="metric-card timecard-metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </article>
  );
}

type TimecardMainView = "schedule" | "payroll";
type TimecardScheduleView = "planned" | "actual";
type TimecardPayrollView = "summary" | "employee";

export default function TimecardPage() {
  const [data, setData] = useState<TimecardPayload | null>(null);
  const [month, setMonth] = useState(getJstMonthLabel());
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [mainView, setMainView] = useState<TimecardMainView>("schedule");
  const [scheduleView, setScheduleView] = useState<TimecardScheduleView>("actual");
  const [payrollView, setPayrollView] = useState<TimecardPayrollView>("summary");
  const [selectedPayrollEmployeeId, setSelectedPayrollEmployeeId] = useState("");

  async function loadTimecard(nextMonth = month, nextStoreId = selectedStoreId) {
    setIsLoading(true);
    const params = new URLSearchParams({ month: nextMonth });
    if (nextStoreId) params.set("storeId", nextStoreId);
    const response = await fetch(`/api/timecard?${params.toString()}`, { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as TimecardPayload;
      setData(body);
      setMonth(body.month);
      setSelectedStoreId(body.selectedStoreId);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    void loadTimecard(month, "");
  }, []);

  const totals = data?.payrollTotals ?? {
    workDays: 0,
    punchCount: 0,
    workMinutes: 0,
    nightMinutes: 0,
    laborCost: 0,
    commuteAllowance: 0,
    totalPay: 0
  };
  const selectedPayrollRow = useMemo(
    () => data?.payrollRows.find((row) => row.employeeId === selectedPayrollEmployeeId) ?? data?.payrollRows[0] ?? null,
    [data, selectedPayrollEmployeeId]
  );
  const selectedPayrollDays = useMemo(
    () => data?.dailySummaries.filter((day) => day.employeeId === selectedPayrollRow?.employeeId) ?? [],
    [data, selectedPayrollRow]
  );

  useEffect(() => {
    if (selectedPayrollRow && selectedPayrollRow.employeeId !== selectedPayrollEmployeeId) {
      setSelectedPayrollEmployeeId(selectedPayrollRow.employeeId);
    }
  }, [selectedPayrollEmployeeId, selectedPayrollRow]);

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

      <section className="workspace timecard-workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">出退勤、実績、給与計算</p>
            <h2>タイムカード</h2>
            <span className="source-indicator">{isLoading ? "読み込み中" : "月度集計済み"}</span>
          </div>
          <div className="timecard-toolbar">
            <input type="month" value={month} onChange={(event) => {
              setMonth(event.target.value);
              void loadTimecard(event.target.value, selectedStoreId);
            }} />
            <select value={selectedStoreId} onChange={(event) => {
              setSelectedStoreId(event.target.value);
              void loadTimecard(month, event.target.value);
            }}>
              {data?.stores.map((store) => (
                <option value={store.id} key={store.id}>{store.name}</option>
              ))}
            </select>
          </div>
        </header>

        <section className="metric-grid">
          <MetricCard label="勤務日数" value={`${totals.workDays}日`} note={`${totals.punchCount}件の実績`} />
          <MetricCard label="勤務時間" value={formatDuration(totals.workMinutes)} note={`深夜 ${formatDuration(totals.nightMinutes)}`} />
          <MetricCard label="人件費" value={formatMoney(totals.laborCost)} note={`交通費 ${formatMoney(totals.commuteAllowance)}`} />
          <MetricCard label="差引支給額" value={formatMoney(totals.totalPay)} note="控除は次フェーズで追加" />
        </section>

        <section className="timecard-view-tabs" aria-label="タイムカードメニュー">
          <button className={mainView === "schedule" ? "is-active" : ""} type="button" onClick={() => setMainView("schedule")}>
            <CalendarDays size={18} />
            排班
          </button>
          <button className={mainView === "payroll" ? "is-active" : ""} type="button" onClick={() => setMainView("payroll")}>
            <WalletCards size={18} />
            給与
          </button>
        </section>

        {mainView === "schedule" ? (
          <>
            <section className="timecard-subtabs" aria-label="排班メニュー">
              <button className={scheduleView === "planned" ? "is-active" : ""} type="button" onClick={() => setScheduleView("planned")}>
                計画排班
              </button>
              <button className={scheduleView === "actual" ? "is-active" : ""} type="button" onClick={() => setScheduleView("actual")}>
                実勤務時間
              </button>
            </section>

            {scheduleView === "planned" ? (
              <section className="panel">
                <div className="panel-title">
                  <CalendarDays />
                  <div>
                    <h3>計画排班</h3>
                    <p>月別の予定シフト、CSV取り込み、シフト作成はこの領域に追加します。</p>
                  </div>
                </div>
                <div className="timecard-feature-grid">
                  <article>
                    <strong>月間シフト表</strong>
                    <p>店舗ごとの予定シフトを日付 x 従業員で編集できるようにします。</p>
                  </article>
                  <article>
                    <strong>CSV一括登録</strong>
                    <p>既存シフト表からまとめて登録、更新できる導線を用意します。</p>
                  </article>
                  <article>
                    <strong>勤務パターン</strong>
                    <p>朝勤務、昼勤務、夜勤務など、店舗別の勤務パターンを選択できるようにします。</p>
                  </article>
                </div>
              </section>
            ) : (
              <section className="panel">
                <div className="panel-title">
                  <CalendarDays />
                  <div>
                    <h3>実勤務時間</h3>
                    <p>打刻の不足がある日は確認欄に表示されます。</p>
                  </div>
                </div>
                <div className="timecard-table-wrap">
                  <table className="timecard-table">
                    <thead>
                      <tr>
                        <th>日付</th>
                        <th>従業員</th>
                        <th>出勤</th>
                        <th>退勤</th>
                        <th>休憩</th>
                        <th>勤務時間</th>
                        <th>深夜</th>
                        <th>確認</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.dailySummaries.length ? data.dailySummaries.map((day) => (
                        <tr key={day.key}>
                          <td>{day.workDate}</td>
                          <td><strong>{day.employeeName}</strong><span>{day.storeName}</span></td>
                          <td>{formatJstTime(day.clockIn) ?? "--:--"}</td>
                          <td>{formatJstTime(day.clockOut) ?? "--:--"}</td>
                          <td>{formatDuration(day.breakMinutes)}</td>
                          <td>{formatDuration(day.workMinutes)}</td>
                          <td>{formatDuration(day.nightMinutes)}</td>
                          <td>{day.alerts.length ? <span className="status-pill is-warning">{day.alerts.join("、")}</span> : <span className="status-pill is-active">OK</span>}</td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={8}>この月の打刻実績はまだありません。</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        ) : (
          <>
            <section className="timecard-subtabs" aria-label="給与メニュー">
              <button className={payrollView === "summary" ? "is-active" : ""} type="button" onClick={() => setPayrollView("summary")}>
                月別給与
              </button>
              <button className={payrollView === "employee" ? "is-active" : ""} type="button" onClick={() => setPayrollView("employee")}>
                従業員別明細
              </button>
            </section>

            {payrollView === "summary" ? (
              <section className="panel">
            <div className="panel-title">
              <WalletCards />
              <div>
                <h3>月別 給与</h3>
                <p>スタッフ管理の人事情報と打刻実績から概算支給額を計算します。</p>
              </div>
            </div>
            <div className="timecard-table-wrap">
              <table className="timecard-table">
                <thead>
                  <tr>
                    <th>従業員</th>
                    <th>勤務</th>
                    <th>勤務時間</th>
                    <th>基本給</th>
                    <th>交通費</th>
                    <th>差引支給額</th>
                    <th>確認</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.payrollRows.length ? data.payrollRows.map((row) => (
                    <tr key={row.employeeId}>
                      <td>
                        <strong>{row.employeeName}</strong>
                        <span>{row.storeNames.join("、") || "店舗未設定"}</span>
                      </td>
                      <td>{row.workDays}日 / {row.punchCount}回</td>
                      <td>{formatDuration(row.workMinutes)}</td>
                      <td>{formatMoney(row.basePay)}</td>
                      <td>{formatMoney(row.commuteAllowance)}</td>
                      <td><strong>{formatMoney(row.totalPay)}</strong></td>
                      <td>{row.alerts.length ? <span className="status-pill is-warning">{row.alerts.join("、")}</span> : <span className="status-pill is-active">OK</span>}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7}>この月の打刻実績はまだありません。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
              </section>
            ) : (
              <section className="panel">
                <div className="panel-title">
                  <WalletCards />
                  <div>
                    <h3>従業員別 給与明細</h3>
                    <p>給与明細 PDF に近い内訳を従業員ごとに確認します。</p>
                  </div>
                </div>
                <div className="timecard-toolbar is-left">
                  <select value={selectedPayrollRow?.employeeId ?? ""} onChange={(event) => setSelectedPayrollEmployeeId(event.target.value)}>
                    {data?.payrollRows.map((row) => (
                      <option value={row.employeeId} key={row.employeeId}>{row.employeeName}</option>
                    ))}
                  </select>
                </div>
                {selectedPayrollRow ? (
                  <>
                    <div className="timecard-detail-grid">
                      <MetricCard label="勤務日数" value={`${selectedPayrollRow.workDays}日`} note={`${selectedPayrollRow.punchCount}回`} />
                      <MetricCard label="勤務時間" value={formatDuration(selectedPayrollRow.workMinutes)} note={`深夜 ${formatDuration(selectedPayrollRow.nightMinutes)}`} />
                      <MetricCard label="基本給" value={formatMoney(selectedPayrollRow.basePay)} note={selectedPayrollRow.employmentType === "mixed" ? "店舗別設定" : selectedPayrollRow.employmentType === "monthly" ? "月給" : `時給 ${formatMoney(selectedPayrollRow.hourlyWage ?? 0)}`} />
                      <MetricCard label="差引支給額" value={formatMoney(selectedPayrollRow.totalPay)} note={`交通費 ${formatMoney(selectedPayrollRow.commuteAllowance)}`} />
                    </div>
                    <div className="timecard-table-wrap">
                      <table className="timecard-table">
                        <thead>
                          <tr>
                            <th>日付</th>
                            <th>店舗</th>
                            <th>勤務時間</th>
                            <th>休憩</th>
                            <th>深夜</th>
                            <th>確認</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedPayrollDays.length ? selectedPayrollDays.map((day) => (
                            <tr key={day.key}>
                              <td>{day.workDate}</td>
                              <td>{day.storeName}</td>
                              <td>{formatJstTime(day.clockIn) ?? "--:--"} - {formatJstTime(day.clockOut) ?? "--:--"}<span>{formatDuration(day.workMinutes)}</span></td>
                              <td>{formatDuration(day.breakMinutes)}</td>
                              <td>{formatDuration(day.nightMinutes)}</td>
                              <td>{day.alerts.length ? <span className="status-pill is-warning">{day.alerts.join("、")}</span> : <span className="status-pill is-active">OK</span>}</td>
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={6}>この従業員の打刻実績はまだありません。</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="empty-state-text">給与明細を表示できる従業員がいません。</p>
                )}
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
