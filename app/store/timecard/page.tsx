"use client";

import { Clock3, Coffee, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { getStoredStoreSelection, setStoredStoreSelection } from "../components/store-selection";
import { useVisibleRefresh } from "../components/useVisibleRefresh";
import { formatJstDateTime, getJstMonthLabel } from "../../../lib/timecard";

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

type TimecardPayload = {
  month: string;
  currentEmployeeId: string;
  currentEmployeeRole: string;
  stores: StoreOption[];
  selectedStoreId: string;
  latestPunch: LatestPunch;
  latestPunches: LatestPunch[];
  employees: TimecardEmployee[];
};

const punchActions = [
  { type: "clock_in", label: "出勤", icon: LogIn },
  { type: "break_start", label: "休憩開始", icon: Coffee },
  { type: "break_end", label: "休憩終了", icon: Coffee },
  { type: "clock_out", label: "退勤", icon: LogOut }
];

const storeTimecardRoles = new Set(["owner", "manager", "store_terminal"]);

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
    params.set("ts", String(Date.now()));
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
      setSelectedEmployeeId((current) => {
        return storeEmployees.some((employee) => employee.id === current) ? current : storeEmployees[0]?.id ?? "";
      });
    } catch {
      setMessage("タイムカード情報を読み込めませんでした。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadTimecard(getStoredStoreSelection());
  }, []);

  useEffect(() => {
    if (!data?.currentEmployeeRole || storeTimecardRoles.has(data.currentEmployeeRole)) return;
    if (data.currentEmployeeRole === "staff") {
      window.location.replace("/staff/timecard");
    } else {
      window.location.replace("/os/timecard");
    }
  }, [data?.currentEmployeeRole]);

  useVisibleRefresh(() => {
    void loadTimecard(selectedStoreId);
  }, { minIntervalMs: 30000 });

  const employeesForStore = useMemo(() => getEmployeesForStore(data?.employees ?? [], selectedStoreId), [data, selectedStoreId]);
  const isStoreTerminal = data?.currentEmployeeRole === "store_terminal";
  const isStoreTimecardRole = data?.currentEmployeeRole ? storeTimecardRoles.has(data.currentEmployeeRole) : false;
  const selectedEmployee = employeesForStore.find((employee) => employee.id === selectedEmployeeId) ?? employeesForStore[0] ?? null;
  const selectedLatestPunch = data?.latestPunches.find((punch) => punch?.employeeId === selectedEmployee?.id) ?? null;

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
      body: JSON.stringify({
        storeId: selectedStoreId,
        employeeId: selectedEmployee.id,
        punchType,
        source: "store_tablet"
      })
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
            <p className="eyebrow">Foundr1 STORE</p>
            <h1>タイムカード</h1>
          </div>
        </a>
        <StoreNavTabs active="timecard" />
      </header>

      <section className={`store-timecard-grid${isStoreTerminal ? " is-terminal-only" : ""}`}>
        <section className="panel store-timecard-punch">
          <div className="panel-title">
            <Clock3 />
            <div>
              <h2>店舗端末打刻</h2>
              <p>{selectedStoreName}・{isLoading ? "読み込み中" : selectedEmployee ? `${selectedEmployee.name} / ${statusLabel}` : "従業員を選択"}</p>
            </div>
          </div>

          <div className="timecard-store-select">
            {isStoreTerminal ? (
              <label className="store-context-selector is-store is-locked">
                <span>打刻店舗</span>
                <strong className="timecard-store-name">{selectedStoreName}</strong>
                <small>この Pad の固定店舗</small>
              </label>
            ) : (
              <label className="store-context-selector is-store">
                <span>打刻店舗</span>
                <strong className="timecard-store-name">{selectedStoreName}</strong>
                <select value={selectedStoreId} onChange={(event) => {
                  setSelectedStoreId(event.target.value);
                  setStoredStoreSelection(event.target.value);
                  void loadTimecard(event.target.value);
                }}>
                  {data?.stores.map((store) => (
                    <option value={store.id} key={store.id}>{store.name}</option>
                  ))}
                </select>
                <small>高権限ユーザーの代理打刻用</small>
              </label>
            )}
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
                    <small className={`timecard-employee-status is-${employeeState}`}>
                      {employeeStatus}{!isStoreTerminal && latestPunch ? `・${formatJstDateTime(latestPunch.punchedAt)}` : ""}
                    </small>
                  </span>
                </button>
              );
            }) : (
              <p className="empty-state-text">この店舗で打刻できる従業員がいません。</p>
            )}
          </div>

          <div className={`timecard-status is-${state}`}>
            <span>{selectedEmployee?.name ?? "従業員未選択"} / {statusLabel}</span>
            <strong>{isStoreTimecardRole ? "店舗端末で打刻操作を選択してください" : selectedLatestPunch ? `${formatJstDateTime(selectedLatestPunch.punchedAt)} に最終打刻` : "本日の打刻を開始できます"}</strong>
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
      </section>
    </main>
  );
}

function getEmployeesForStore(employees: TimecardEmployee[], storeId: string) {
  return employees.filter((employee) => employee.storeIds.length === 0 || employee.storeIds.includes(storeId));
}
