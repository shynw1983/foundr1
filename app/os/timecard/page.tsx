"use client";

import { BriefcaseBusiness, CalendarDays, ClipboardList, Clock3, FileText, Lightbulb, LogOut, MessageSquareWarning, PackageCheck, Search, Settings, Store, Truck, UserCog, WalletCards } from "lucide-react";
import type { FormEvent } from "react";
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

type TimecardEmployee = {
  id: string;
  name: string;
  role: string;
  storeIds: string[];
  employmentType: "hourly" | "monthly";
  hourlyWage: number | null;
  monthlySalary: number | null;
  commuteAllowancePerWorkday: number;
  payrollEnabled: boolean;
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
  employmentType: "hourly" | "monthly";
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
  currentRole: string;
  canManage: boolean;
  stores: StoreOption[];
  selectedStoreId: string;
  employees: TimecardEmployee[];
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

export default function TimecardPage() {
  const [data, setData] = useState<TimecardPayload | null>(null);
  const [month, setMonth] = useState(getJstMonthLabel());
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

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
      setSelectedEmployeeId((current) => current || body.employees[0]?.id || "");
    }
    setIsLoading(false);
  }

  useEffect(() => {
    void loadTimecard(month, "");
  }, []);

  const selectedEmployee = useMemo(
    () => data?.employees.find((employee) => employee.id === selectedEmployeeId) ?? data?.employees[0] ?? null,
    [data, selectedEmployeeId]
  );

  useEffect(() => {
    if (selectedEmployee && selectedEmployee.id !== selectedEmployeeId) {
      setSelectedEmployeeId(selectedEmployee.id);
    }
  }, [selectedEmployee, selectedEmployeeId]);

  async function saveEmployeeSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployee) return;
    const formData = new FormData(event.currentTarget);
    setIsSaving(true);
    setNotice("");
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "employee_settings",
        employeeId: selectedEmployee.id,
        employmentType: String(formData.get("employmentType") ?? "hourly"),
        hourlyWage: String(formData.get("hourlyWage") ?? ""),
        monthlySalary: String(formData.get("monthlySalary") ?? ""),
        commuteAllowancePerWorkday: String(formData.get("commuteAllowancePerWorkday") ?? "0"),
        payrollEnabled: formData.get("payrollEnabled") === "on"
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setNotice(body.error ?? "給与設定を保存できませんでした。");
    } else {
      setNotice("給与設定を保存しました。");
      await loadTimecard(month, selectedStoreId);
    }
    setIsSaving(false);
  }

  const totals = data?.payrollTotals ?? {
    workDays: 0,
    punchCount: 0,
    workMinutes: 0,
    nightMinutes: 0,
    laborCost: 0,
    commuteAllowance: 0,
    totalPay: 0
  };

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

        <section className="management-grid timecard-management-grid">
          <section className="panel">
            <div className="panel-title">
              <WalletCards />
              <div>
                <h3>月別 給与</h3>
                <p>打刻実績と給与設定から概算支給額を計算します。</p>
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

          <section className="panel">
            <div className="panel-title">
              <BriefcaseBusiness />
              <div>
                <h3>給与設定</h3>
                <p>時給、月給、勤務日ごとの交通費を設定します。</p>
              </div>
            </div>
            {data?.canManage ? (
              <form className="management-form timecard-settings-form" onSubmit={saveEmployeeSettings}>
                <label>
                  <span>従業員</span>
                  <select value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
                    {data.employees.map((employee) => (
                      <option value={employee.id} key={employee.id}>{employee.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>給与形態</span>
                  <select name="employmentType" defaultValue={selectedEmployee?.employmentType ?? "hourly"} key={`${selectedEmployee?.id}-type`}>
                    <option value="hourly">時給</option>
                    <option value="monthly">月給</option>
                  </select>
                </label>
                <label>
                  <span>時給</span>
                  <input name="hourlyWage" type="number" min="0" step="1" defaultValue={selectedEmployee?.hourlyWage ?? ""} key={`${selectedEmployee?.id}-hourly`} placeholder="例: 1200" />
                </label>
                <label>
                  <span>月給</span>
                  <input name="monthlySalary" type="number" min="0" step="1" defaultValue={selectedEmployee?.monthlySalary ?? ""} key={`${selectedEmployee?.id}-monthly`} placeholder="月給社員のみ" />
                </label>
                <label>
                  <span>交通費 / 勤務日</span>
                  <input name="commuteAllowancePerWorkday" type="number" min="0" step="1" defaultValue={selectedEmployee?.commuteAllowancePerWorkday ?? 0} key={`${selectedEmployee?.id}-commute`} />
                </label>
                <label className="timecard-checkbox">
                  <input name="payrollEnabled" type="checkbox" defaultChecked={selectedEmployee?.payrollEnabled ?? true} key={`${selectedEmployee?.id}-enabled`} />
                  <span>給与計算に含める</span>
                </label>
                {notice ? <div className="timecard-message">{notice}</div> : null}
                <button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "保存中" : "設定を保存"}</button>
              </form>
            ) : (
              <p className="empty-state-text">給与設定の編集権限がありません。</p>
            )}
          </section>
        </section>

        <section className="panel">
          <div className="panel-title">
            <CalendarDays />
            <div>
              <h3>日別 実績</h3>
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
      </section>
    </main>
  );
}
