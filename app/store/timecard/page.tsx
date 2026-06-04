"use client";

import { BriefcaseBusiness, Clock3, Coffee, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { getStoredStoreSelection, setStoredStoreSelection } from "../components/store-selection";
import { formatDuration, formatJstTime, getJstMonthLabel } from "../../../lib/timecard";

type StoreOption = {
  id: string;
  name: string;
};

type LatestPunch = {
  employeeId: string;
  punchType: string;
  punchedAt: string;
} | null;

type TimecardEmployee = {
  id: string;
  name: string;
  role: string;
  storeIds: string[];
};

type DailySummary = {
  key: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  storeName: string;
  clockIn: string | null;
  clockOut: string | null;
  breakMinutes: number;
  workMinutes: number;
  isManualCorrection: boolean;
  alerts: string[];
};

type TimecardPayload = {
  month: string;
  currentEmployeeId: string;
  stores: StoreOption[];
  selectedStoreId: string;
  latestPunch: LatestPunch;
  latestPunches: LatestPunch[];
  employees: TimecardEmployee[];
  dailySummaries: DailySummary[];
};

const punchActions = [
  { type: "clock_in", label: "出勤", icon: LogIn },
  { type: "break_start", label: "休憩開始", icon: Coffee },
  { type: "break_end", label: "休憩終了", icon: Coffee },
  { type: "clock_out", label: "退勤", icon: LogOut }
];

function getPunchState(latestPunch: LatestPunch) {
  if (!latestPunch || latestPunch.punchType === "clock_out") return "off";
  if (latestPunch.punchType === "break_start") return "break";
  return "working";
}

function canUsePunch(type: string, state: string) {
  if (type === "clock_in") return state === "off";
  if (type === "break_start") return state === "working";
  if (type === "break_end") return state === "break";
  if (type === "clock_out") return state === "working";
  return false;
}

export default function StoreTimecardPage() {
  const [data, setData] = useState<TimecardPayload | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPunching, setIsPunching] = useState("");
  const [message, setMessage] = useState("");

  async function loadTimecard(nextStoreId = selectedStoreId) {
    setIsLoading(true);
    setMessage("");
    const params = new URLSearchParams({ month: getJstMonthLabel() });
    if (nextStoreId) params.set("storeId", nextStoreId);
    try {
      const response = await fetch(`/api/timecard?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setMessage(body.error ?? "タイムカード情報を読み込めませんでした。");
        return;
      }
      const body = await response.json() as TimecardPayload;
      setData(body);
      setSelectedStoreId(body.selectedStoreId);
      if (body.selectedStoreId) setStoredStoreSelection(body.selectedStoreId);
      const storeEmployees = getEmployeesForStore(body.employees ?? [], body.selectedStoreId);
      setSelectedEmployeeId((current) => storeEmployees.some((employee) => employee.id === current) ? current : storeEmployees[0]?.id ?? "");
    } catch {
      setMessage("タイムカード情報を読み込めませんでした。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadTimecard(getStoredStoreSelection());
  }, []);

  const employeesForStore = useMemo(() => getEmployeesForStore(data?.employees ?? [], selectedStoreId), [data, selectedStoreId]);
  const selectedEmployee = employeesForStore.find((employee) => employee.id === selectedEmployeeId) ?? employeesForStore[0] ?? null;
  const selectedLatestPunch = data?.latestPunches.find((punch) => punch?.employeeId === selectedEmployee?.id) ?? null;

  const selectedEmployeeDays = useMemo(() => {
    if (!data) return [];
    return data.dailySummaries.filter((day) => day.employeeId === selectedEmployee?.id).slice(0, 8);
  }, [data, selectedEmployee]);

  const state = getPunchState(selectedLatestPunch);
  const statusLabel = state === "working" ? "勤務中" : state === "break" ? "休憩中" : "未出勤";
  const selectedStoreName = data?.stores.find((store) => store.id === selectedStoreId)?.name ?? "店舗未選択";

  async function punch(punchType: string) {
    if (!selectedStoreId || !selectedEmployee) return;
    setIsPunching(punchType);
    setMessage("");
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: selectedStoreId, employeeId: selectedEmployee.id, punchType })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "打刻できませんでした。");
    } else {
      setMessage("打刻しました。");
      await loadTimecard(selectedStoreId);
    }
    setIsPunching("");
  }

  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 Store</p>
            <h1>タイムカード</h1>
          </div>
        </a>
        <StoreNavTabs active="timecard" />
      </header>

      <section className="store-timecard-grid">
        <section className="panel store-timecard-punch">
          <div className="panel-title">
            <Clock3 />
            <div>
              <h2>タイムカード</h2>
              <p>{selectedStoreName}・{isLoading ? "読み込み中" : selectedEmployee ? `${selectedEmployee.name} / ${statusLabel}` : "従業員を選択"}</p>
            </div>
          </div>

          <div className="timecard-store-select">
            <label>
              <span>打刻店舗</span>
              <select value={selectedStoreId} onChange={(event) => {
                setSelectedStoreId(event.target.value);
                setStoredStoreSelection(event.target.value);
                void loadTimecard(event.target.value);
              }}>
                {data?.stores.map((store) => (
                  <option value={store.id} key={store.id}>{store.name}</option>
                ))}
              </select>
            </label>
            <button className="secondary-button" type="button" onClick={() => loadTimecard(selectedStoreId)}>
              <RefreshCw size={16} />
              更新
            </button>
          </div>

          <div className="timecard-employee-picker" aria-label="打刻する従業員">
            {employeesForStore.length ? employeesForStore.map((employee) => {
              const latestPunch = data?.latestPunches.find((punch) => punch?.employeeId === employee.id) ?? null;
              const employeeState = getPunchState(latestPunch);
              const employeeStatus = employeeState === "working" ? "勤務中" : employeeState === "break" ? "休憩中" : "未出勤";
              return (
                <button
                  className={`timecard-employee-card${employee.id === selectedEmployee?.id ? " is-selected" : ""}`}
                  type="button"
                  onClick={() => {
                    setSelectedEmployeeId(employee.id);
                    setMessage("");
                  }}
                  key={employee.id}
                >
                  <span className="timecard-employee-avatar">{employee.name.slice(0, 1)}</span>
                  <span>
                    <strong>{employee.name}</strong>
                    <small>{employeeStatus}{latestPunch ? `・${formatJstTime(latestPunch.punchedAt)}` : ""}</small>
                  </span>
                </button>
              );
            }) : (
              <p className="empty-state-text">この店舗で打刻できる従業員がいません。</p>
            )}
          </div>

          <div className={`timecard-status is-${state}`}>
            <span>{selectedEmployee?.name ?? "従業員未選択"} / {statusLabel}</span>
            <strong>{selectedLatestPunch ? `${formatJstTime(selectedLatestPunch.punchedAt)} に最終打刻` : "本日の打刻を開始できます"}</strong>
          </div>

          {message ? <div className="timecard-message">{message}</div> : null}

          <div className="timecard-punch-actions">
            {punchActions.map((action) => {
              const Icon = action.icon;
              const enabled = Boolean(selectedEmployee) && canUsePunch(action.type, state) && !isPunching;
              return (
                <button
                  className="timecard-punch-button"
                  type="button"
                  disabled={!enabled}
                  onClick={() => punch(action.type)}
                  key={action.type}
                >
                  <Icon size={22} />
                  <span>{isPunching === action.type ? "処理中" : action.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel store-timecard-history">
          <div className="panel-title">
            <BriefcaseBusiness />
            <div>
              <h2>今月の実績</h2>
              <p>{selectedEmployee ? `${selectedEmployee.name} の勤務時間` : "従業員を選択してください"}</p>
            </div>
          </div>
          <div className="timecard-day-list">
            {selectedEmployeeDays.length ? selectedEmployeeDays.map((day) => (
              <article className="timecard-day-row" key={day.key}>
                <div>
                  <strong>{day.workDate}</strong>
                  <span>{day.storeName}</span>
                </div>
                <div>
                  <span>{formatJstTime(day.clockIn) ?? "--:--"} - {formatJstTime(day.clockOut) ?? "--:--"}</span>
                  <strong>{formatDuration(day.workMinutes)}</strong>
                </div>
                {day.alerts.length ? <small>{day.alerts.join("、")}</small> : null}
              </article>
            )) : (
              <p className="empty-state-text">選択中の従業員には今月の打刻がまだありません。</p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function getEmployeesForStore(employees: TimecardEmployee[], storeId: string) {
  return employees.filter((employee) => employee.storeIds.length === 0 || employee.storeIds.includes(storeId));
}
