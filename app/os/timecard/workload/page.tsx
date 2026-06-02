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

export default function TimecardWorkloadPage() {
  const [month, setMonth] = useState(getCurrentMonth());
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
    }
    setIsLoading(false);
  }

  useEffect(() => {
    void loadWorkload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busiest = data?.busiestEmployees[0] ?? null;
  const lightest = data?.lightestEmployees[0] ?? null;

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
              void loadWorkload(event.target.value, selectedStoreId);
            }} />
            <select value={selectedStoreId} onChange={(event) => {
              setSelectedStoreId(event.target.value);
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

        <section className="panel workload-table-panel">
          <div className="panel-title">
            <ChartColumn size={18} />
            <div>
              <h3>スタッフ別負荷</h3>
              <p>実勤務時間内に入った注文をスタッフ別に集計します。</p>
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
                  <th>売上/時</th>
                  <th>ピーク</th>
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
                    <td>{employee.peakHourOrderCount}件/時</td>
                    <td>{formatDuration(employee.onePersonHighLoadMinutes)}</td>
                    <td>{formatDuration(employee.idleMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.employees.length === 0 ? <div className="empty-state">勤怠または売上データがまだありません</div> : null}
        </section>

        <section className="sales-grid">
          <article className="panel">
            <h3>高負荷だった勤務（シフト別）</h3>
            <div className="sales-rank-list">
              {(data?.busiestShifts ?? []).map((shift) => (
                <div className="sales-rank-row" key={`${shift.employeeId}-${shift.workDate}-${shift.clockIn}`}>
                  <span>{formatDate(shift.workDate)} {shift.employeeName}</span>
                  <strong>{rate(shift.ordersPerHour)}件/時</strong>
                  <small>{formatTime(shift.clockIn)}-{formatTime(shift.clockOut)} / {shift.isOnePerson ? "ワンオペ" : "複数名"}</small>
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
                  <small>{rate(employee.ordersPerHour)}件/時 / ピーク {employee.peakHourOrderCount}件/時</small>
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
                  <strong>{rate(employee.ordersPerHour)}件/時</strong>
                  <small>空き {formatDuration(employee.idleMinutes)}</small>
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
