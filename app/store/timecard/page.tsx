"use client";

import { BriefcaseBusiness, CalendarDays, Clock3, Coffee, LogIn, LogOut, RefreshCw, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";
import { getStoredStoreSelection, setStoredStoreSelection } from "../components/store-selection";
import { formatDuration, formatJstDateTime, formatJstTime, getJstMonthLabel } from "../../../lib/timecard";

type StoreOption = {
  id: string;
  name: string;
  attendanceLocationEnabled?: boolean;
  attendanceRadiusMeters?: number;
  attendanceAccuracyThresholdMeters?: number;
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

type ShiftEntry = {
  id: string;
  workDate: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  employeeName: string;
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
  shifts?: ShiftEntry[];
  dailySummaries: DailySummary[];
};

type ShiftRequestItem = {
  id: string;
  requestType: "availability" | "day_off" | "swap";
  status: "open" | "approved" | "rejected";
  workDate: string | null;
  title: string;
  note: string | null;
  employeeId?: string;
  windows?: Array<{ workDate: string; availableStart: string | null; availableEnd: string | null; preference: string; note: string | null }>;
};

type ShiftRequestPayload = {
  currentEmployeeId?: string;
  requests?: ShiftRequestItem[];
  myShifts?: ShiftEntry[];
  schedulingPeriod?: {
    label: string;
    startDate: string;
    endDate: string;
  };
  submissionPeriod?: {
    label: string;
    startDate: string;
    endDate: string;
    deadlineAt: string;
  };
  submissionDates?: string[];
};

type ShiftRequestDraft = {
  targetShiftId: string;
  note: string;
};

type MobileTimecardPanel = "history" | "next_shift" | "availability" | "swap";

type AvailabilityDayDraft = {
  workDate: string;
  wantsWork: boolean;
  availableStart: string;
  availableEnd: string;
  note: string;
};

type MobileLocationState = {
  status: "idle" | "locating" | "ready" | "error";
  message: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
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
  const [shiftRequests, setShiftRequests] = useState<ShiftRequestItem[]>([]);
  const [myShifts, setMyShifts] = useState<ShiftEntry[]>([]);
  const [schedulingPeriod, setSchedulingPeriod] = useState<ShiftRequestPayload["schedulingPeriod"] | null>(null);
  const [submissionPeriod, setSubmissionPeriod] = useState<ShiftRequestPayload["submissionPeriod"] | null>(null);
  const [availabilityDrafts, setAvailabilityDrafts] = useState<AvailabilityDayDraft[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState(() => getStoredStoreSelection());
  const [selectedShiftStoreId, setSelectedShiftStoreId] = useState(() => getStoredStoreSelection());
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [shiftRequestDraft, setShiftRequestDraft] = useState<ShiftRequestDraft>({
    targetShiftId: "",
    note: ""
  });
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileLocation, setMobileLocation] = useState<MobileLocationState>({
    status: "idle",
    message: "位置情報を取得してから打刻します。",
    latitude: null,
    longitude: null,
    accuracyMeters: null
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isPunching, setIsPunching] = useState("");
  const [message, setMessage] = useState("");
  const [shiftRequestMessage, setShiftRequestMessage] = useState("");
  const [activeMobilePanel, setActiveMobilePanel] = useState<MobileTimecardPanel | "">("");

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
      setSelectedShiftStoreId((current) => {
        const next = body.stores.some((store) => store.id === current) ? current : body.selectedStoreId;
        void loadShiftRequests(next);
        return next;
      });
      const storeEmployees = getEmployeesForStore(body.employees ?? [], body.selectedStoreId);
      setSelectedEmployeeId((current) => {
        if (body.currentEmployeeRole === "staff") return body.currentEmployeeId;
        return storeEmployees.some((employee) => employee.id === current) ? current : storeEmployees[0]?.id ?? "";
      });
    } catch {
      setMessage("タイムカード情報を読み込めませんでした。");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadShiftRequests(nextStoreId = selectedStoreId) {
    if (!nextStoreId) return;
    try {
      const response = await fetch(`/api/timecard/shift-requests?storeId=${encodeURIComponent(nextStoreId)}&month=${encodeURIComponent(getJstMonthLabel())}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as ShiftRequestPayload;
      setShiftRequests(body.requests ?? []);
      setMyShifts(body.myShifts ?? []);
      setSchedulingPeriod(body.schedulingPeriod ?? null);
      setSubmissionPeriod(body.submissionPeriod ?? null);
      setAvailabilityDrafts(createAvailabilityDrafts(body.submissionDates ?? [], body.requests ?? []));
      setShiftRequestDraft((current) => {
        const firstShift = body.myShifts?.[0];
        return {
          ...current,
          targetShiftId: current.targetShiftId || firstShift?.id || ""
        };
      });
    } catch {
      setShiftRequestMessage("シフト連絡を読み込めませんでした。");
    }
  }

  useEffect(() => {
    void loadTimecard(getStoredStoreSelection());
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => setIsMobileViewport(query.matches);
    updateViewport();
    query.addEventListener("change", updateViewport);
    return () => query.removeEventListener("change", updateViewport);
  }, []);

  const employeesForStore = useMemo(() => getEmployeesForStore(data?.employees ?? [], selectedStoreId), [data, selectedStoreId]);
  const isMobileStaffPunch = isMobileViewport && data?.currentEmployeeRole === "staff";
  const selectedEmployee = isMobileStaffPunch
    ? employeesForStore.find((employee) => employee.id === data?.currentEmployeeId) ?? null
    : employeesForStore.find((employee) => employee.id === selectedEmployeeId) ?? employeesForStore[0] ?? null;
  const selectedLatestPunch = data?.latestPunches.find((punch) => punch?.employeeId === selectedEmployee?.id) ?? null;

  const selectedEmployeeDays = useMemo(() => {
    if (!data) return [];
    return data.dailySummaries.filter((day) => day.employeeId === selectedEmployee?.id).slice(0, 8);
  }, [data, selectedEmployee]);

  const state = getPunchState(selectedLatestPunch);
  const statusLabel = state === "working" ? "勤務中" : state === "break" ? "休憩中" : "未出勤";
  const selectedStore = data?.stores.find((store) => store.id === selectedStoreId) ?? null;
  const selectedStoreName = selectedStore?.name ?? "店舗未選択";
  const selectedShiftStore = data?.stores.find((store) => store.id === selectedShiftStoreId) ?? null;
  const selectedShiftStoreName = selectedShiftStore?.name ?? "店舗未選択";
  const mobilePanelItems: Array<{ key: MobileTimecardPanel; label: string; detail: string; icon: typeof CalendarDays }> = [
    { key: "next_shift", label: "次回シフト", detail: `${myShifts.length} 件`, icon: CalendarDays },
    { key: "history", label: "今月の実績", detail: `${selectedEmployeeDays.length} 日`, icon: BriefcaseBusiness },
    { key: "availability", label: "希望シフト", detail: submissionPeriod?.label ?? "提出期間", icon: Send },
    { key: "swap", label: "交代募集", detail: myShifts.length ? "募集作成" : "確定待ち", icon: RefreshCw }
  ];
  const activeMobilePanelItem = mobilePanelItems.find((item) => item.key === activeMobilePanel);
  const ShiftPanelIcon = activeMobilePanelItem?.icon ?? CalendarDays;
  const shiftPanelHeading = (() => {
    if (!isMobileStaffPunch) {
      return {
        title: "シフト連絡",
        description: submissionPeriod ? `${submissionPeriod.label} / 締切 ${submissionPeriod.deadlineAt} / 再送信するとこの期間を上書きします` : "提出できる期間を確認しています。"
      };
    }
    if (activeMobilePanel === "next_shift") {
      return {
        title: "次回シフト",
        description: schedulingPeriod ? `${schedulingPeriod.label} / ${selectedShiftStoreName}` : "確定済みシフトを確認しています。"
      };
    }
    if (activeMobilePanel === "availability") {
      return {
        title: "希望シフト",
        description: submissionPeriod ? `${submissionPeriod.label} / 締切 ${submissionPeriod.deadlineAt} / 再送信するとこの期間を上書きします` : "提出できる期間を確認しています。"
      };
    }
    if (activeMobilePanel === "swap") {
      return {
        title: "交代募集",
        description: myShifts.length ? "自分の確定シフトから交代募集を作成します。" : "確定シフトがあると交代募集を作成できます。"
      };
    }
    return {
      title: "シフト連絡",
      description: "確認する機能を選択してください。"
    };
  })();

  function requestMobileLocation() {
    if (!navigator.geolocation) {
      setMobileLocation({
        status: "error",
        message: "この端末では位置情報を取得できません。",
        latitude: null,
        longitude: null,
        accuracyMeters: null
      });
      return Promise.resolve<MobileLocationState | null>(null);
    }

    setMobileLocation((current) => ({ ...current, status: "locating", message: "位置情報を取得しています。" }));
    return new Promise<MobileLocationState | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const next = {
            status: "ready" as const,
            message: `位置情報取得済み（精度 約${Math.round(position.coords.accuracy)}m）`,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy
          };
          setMobileLocation(next);
          resolve(next);
        },
        () => {
          const next = {
            status: "error" as const,
            message: "位置情報の許可が必要です。ブラウザの位置情報設定を確認してください。",
            latitude: null,
            longitude: null,
            accuracyMeters: null
          };
          setMobileLocation(next);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
      );
    });
  }

  async function punch(punchType: string) {
    if (!selectedStoreId || !selectedEmployee) return;
    setIsPunching(punchType);
    setMessage("");
    const requiresMobileLocation = punchType === "clock_in" || punchType === "clock_out";
    const location = isMobileStaffPunch ? await requestMobileLocation() : null;
    if (isMobileStaffPunch && requiresMobileLocation && !location) {
      setIsPunching("");
      return;
    }
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: selectedStoreId,
        employeeId: selectedEmployee.id,
        punchType,
        source: isMobileStaffPunch ? "mobile" : "store_tablet",
        mobileLatitude: location?.latitude ?? null,
        mobileLongitude: location?.longitude ?? null,
        mobileAccuracyMeters: location?.accuracyMeters ?? null
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

  function updateAvailabilityDraft(workDate: string, patch: Partial<AvailabilityDayDraft>) {
    setAvailabilityDrafts((items) => items.map((item) => item.workDate === workDate ? { ...item, ...patch } : item));
  }

  async function submitAvailabilityPeriod() {
    if (!selectedShiftStoreId) return;
    setShiftRequestMessage("");
    const response = await fetch("/api/timecard/shift-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_availability_period",
        storeId: selectedShiftStoreId,
        entries: availabilityDrafts
          .filter((draft) => draft.wantsWork)
          .map((draft) => ({
            workDate: draft.workDate,
            preference: "available",
            availableStart: draft.availableStart,
            availableEnd: draft.availableEnd,
            note: draft.note
          }))
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setShiftRequestMessage(body.error ?? "希望シフトを送信できませんでした。");
      return;
    }
    setShiftRequestMessage("希望シフトを送信しました。");
    await loadShiftRequests(selectedShiftStoreId);
  }

  async function submitSwapRequest() {
    if (!selectedShiftStoreId) return;
    setShiftRequestMessage("");
    const selectedShift = myShifts.find((shift) => shift.id === shiftRequestDraft.targetShiftId) ?? null;
    if (!selectedShift) {
      setShiftRequestMessage("交代募集するシフトを選択してください。");
      return;
    }
    const response = await fetch("/api/timecard/shift-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_shift_request",
        storeId: selectedShiftStoreId,
        requestType: "swap",
        workDate: selectedShift.workDate,
        targetShiftId: shiftRequestDraft.targetShiftId,
        note: shiftRequestDraft.note
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setShiftRequestMessage(body.error ?? "交代募集を送信できませんでした。");
      return;
    }
    setShiftRequestMessage("交代募集を送信しました。");
    setShiftRequestDraft((current) => ({ ...current, note: "" }));
    await loadShiftRequests(selectedShiftStoreId);
  }

  async function applyForSwap(requestId: string) {
    if (!selectedShiftStoreId) return;
    const response = await fetch("/api/timecard/shift-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_candidate", storeId: selectedShiftStoreId, requestId })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setShiftRequestMessage(response.ok ? "交代募集に応募しました。" : body.error ?? "応募できませんでした。");
    if (response.ok) await loadShiftRequests(selectedShiftStoreId);
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

          {isMobileStaffPunch ? (
            <div className={`mobile-timecard-location is-${mobileLocation.status}`}>
              <div>
                <strong>{selectedStore?.attendanceLocationEnabled ? "位置確認あり" : "位置記録"}</strong>
                <span>{mobileLocation.message}</span>
                {selectedStore?.attendanceLocationEnabled ? <small>許可範囲 {selectedStore.attendanceRadiusMeters ?? 100}m / 精度上限 {selectedStore.attendanceAccuracyThresholdMeters ?? 100}m</small> : null}
              </div>
              <button className="secondary-button" type="button" disabled={mobileLocation.status === "locating"} onClick={() => void requestMobileLocation()}>
                {mobileLocation.status === "locating" ? "取得中" : "位置取得"}
              </button>
            </div>
          ) : null}

          <div className={`timecard-employee-picker${isMobileStaffPunch ? " is-mobile-staff-hidden" : ""}`} aria-label="打刻する従業員">
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
                    <small>{employeeStatus}{latestPunch ? `・${formatJstDateTime(latestPunch.punchedAt)}` : ""}</small>
                  </span>
                </button>
              );
            }) : (
              <p className="empty-state-text">この店舗で打刻できる従業員がいません。</p>
            )}
          </div>

          <div className={`timecard-status is-${state}`}>
            <span>{selectedEmployee?.name ?? "従業員未選択"} / {statusLabel}</span>
            <strong>{selectedLatestPunch ? `${formatJstDateTime(selectedLatestPunch.punchedAt)} に最終打刻` : "本日の打刻を開始できます"}</strong>
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

        {isMobileStaffPunch ? (
          <section className="store-timecard-mobile-actions" aria-label="タイムカード機能">
            {mobilePanelItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeMobilePanel === item.key;
              return (
                <button
                  className={isActive ? "is-active" : ""}
                  type="button"
                  aria-expanded={isActive}
                  onClick={() => setActiveMobilePanel((current) => current === item.key ? "" : item.key)}
                  key={item.key}
                >
                  <span className="store-mobile-action-icon"><Icon size={18} /></span>
                  <span className="store-mobile-action-copy">
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </span>
                </button>
              );
            })}
          </section>
        ) : null}

        <section className={`panel store-timecard-history${isMobileStaffPunch && activeMobilePanel !== "history" ? " is-mobile-collapsed" : ""}`}>
          <div className="panel-title store-mobile-panel-title">
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

        <section className={`panel store-shift-request-panel${isMobileStaffPunch && (activeMobilePanel === "" || activeMobilePanel === "history") ? " is-mobile-collapsed" : ""} is-mobile-panel-${activeMobilePanel}`}>
          <div className="panel-title store-mobile-panel-title">
            <ShiftPanelIcon />
            <div>
              <h2>{shiftPanelHeading.title}</h2>
              <p>{shiftPanelHeading.description}</p>
            </div>
          </div>

          <div className="store-shift-target-select">
            <label>
              <span>対象店舗</span>
              <select value={selectedShiftStoreId} onChange={(event) => {
                setSelectedShiftStoreId(event.target.value);
                setShiftRequestMessage("");
                void loadShiftRequests(event.target.value);
              }}>
                {data?.stores.map((store) => (
                  <option value={store.id} key={store.id}>{store.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="store-next-shift-block store-mobile-section-next-shift">
            <div className="store-next-shift-heading">
              <div>
                <strong>{isMobileStaffPunch && activeMobilePanel === "next_shift" ? "確定済みシフト" : "次回シフト"}</strong>
                <span>
                  {schedulingPeriod
                    ? `${schedulingPeriod.label} / ${schedulingPeriod.startDate} - ${schedulingPeriod.endDate}`
                    : "確定済みシフトを確認しています。"}
                </span>
              </div>
              <span>{selectedShiftStoreName}</span>
              {myShifts.some((shift) => shift.scheduledStart && shift.scheduledEnd) ? (
                <a
                  className="store-next-shift-calendar-button is-period"
                  href={createShiftCalendarHref(myShifts, selectedShiftStoreName)}
                  download={`foundr1-shifts-${schedulingPeriod?.label ?? "period"}.ics`}
                >
                  まとめて追加
                </a>
              ) : null}
            </div>
            <div className="store-next-shift-list">
              {myShifts.length ? myShifts.map((shift) => (
                <article className="store-next-shift-row" key={shift.id}>
                  <strong>{formatShiftDate(shift.workDate)}</strong>
                  <span>{shift.scheduledStart ?? "--:--"} - {shift.scheduledEnd ?? "--:--"}</span>
                  {shift.scheduledStart && shift.scheduledEnd ? (
                    <a
                      className="store-next-shift-calendar-button"
                      href={createShiftCalendarHref([shift], selectedShiftStoreName)}
                      download={`foundr1-shift-${shift.workDate}.ics`}
                    >
                      カレンダーに追加
                    </a>
                  ) : null}
                </article>
              )) : (
                <p className="empty-state-text">この期間の確定シフトはまだありません。</p>
              )}
            </div>
          </div>

          <div className="store-shift-period-list store-mobile-section-availability">
            {availabilityDrafts.map((draft) => (
              <article className="store-shift-period-row" key={draft.workDate}>
                <strong>{formatShiftDate(draft.workDate)}</strong>
                <label className={`store-shift-wants-work${draft.wantsWork ? " is-selected" : ""}`}>
                  <input type="checkbox" checked={draft.wantsWork} onChange={(event) => updateAvailabilityDraft(draft.workDate, { wantsWork: event.target.checked })} />
                  出勤希望
                </label>
                <div className="store-shift-request-times">
                  <input type="time" value={draft.availableStart} disabled={!draft.wantsWork} onChange={(event) => updateAvailabilityDraft(draft.workDate, { availableStart: event.target.value })} />
                  <input type="time" value={draft.availableEnd} disabled={!draft.wantsWork} onChange={(event) => updateAvailabilityDraft(draft.workDate, { availableEnd: event.target.value })} />
                </div>
                <input value={draft.note} placeholder="メモ" onChange={(event) => updateAvailabilityDraft(draft.workDate, { note: event.target.value })} />
              </article>
            ))}
            {availabilityDrafts.length === 0 ? <p className="empty-state-text">提出できる希望シフト期間がありません。</p> : null}
          </div>

          <div className="store-shift-request-form is-swap store-mobile-section-swap">
            <label>
              <span>交代募集するシフト</span>
              <select value={shiftRequestDraft.targetShiftId} onChange={(event) => setShiftRequestDraft({ ...shiftRequestDraft, targetShiftId: event.target.value })}>
                {myShifts.map((shift) => (
                  <option value={shift.id} key={shift.id}>{shift.workDate} {shift.scheduledStart ?? "--:--"}-{shift.scheduledEnd ?? "--:--"}</option>
                ))}
              </select>
            </label>
            <label>
              <span>交代メモ</span>
              <input value={shiftRequestDraft.note} placeholder="任意" onChange={(event) => setShiftRequestDraft({ ...shiftRequestDraft, note: event.target.value })} />
            </label>
            <button className="secondary-button" type="button" onClick={submitSwapRequest}>交代募集</button>
          </div>
          {shiftRequestMessage ? <div className="timecard-message store-mobile-section-shift-messages">{shiftRequestMessage}</div> : null}
          <button className="primary-button store-shift-submit-button store-mobile-section-availability" type="button" onClick={submitAvailabilityPeriod}>
            <Send size={16} />
            希望シフトを送信
          </button>

          <div className="store-shift-request-list store-mobile-section-shift-messages">
            <h3>最近のシフト連絡</h3>
            {shiftRequests.length ? shiftRequests.slice(0, 5).map((request) => (
              <article className="store-shift-request-row" key={request.id}>
                <div>
                  <strong>{request.title}</strong>
                  <span>{formatShiftRequestSummary(request)}</span>
                  {request.note ? <small>{request.note}</small> : null}
                </div>
                {request.requestType === "swap" && request.status === "open" && request.employeeId !== data?.currentEmployeeId ? (
                  <button className="secondary-button" type="button" onClick={() => applyForSwap(request.id)}>応募</button>
                ) : null}
              </article>
            )) : (
              <p className="empty-state-text">シフト連絡はまだありません。</p>
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

function requestStatusLabel(status: ShiftRequestItem["status"]) {
  if (status === "approved") return "承認済み";
  if (status === "rejected") return "却下";
  return "未確認";
}

function formatShiftRequestSummary(request: ShiftRequestItem) {
  const status = requestStatusLabel(request.status);
  const windows = request.windows ?? [];
  if (request.requestType === "availability" && windows.length) {
    return windows
      .map((window) => `${formatShiftDate(window.workDate)} ${window.availableStart ?? "--:--"}-${window.availableEnd ?? "--:--"}`)
      .join("、") + `・${status}`;
  }
  return `${request.workDate ? formatShiftDate(request.workDate) : "日付未設定"}・${status}`;
}

function createAvailabilityDrafts(dates: string[], requests: ShiftRequestItem[]) {
  const requestByDate = new Map<string, ShiftRequestItem>();
  for (const request of requests) {
    if ((request.requestType === "availability" || request.requestType === "day_off") && request.workDate) {
      requestByDate.set(request.workDate, request);
    }
  }
  return dates.map((workDate) => {
    const request = requestByDate.get(workDate);
    const window = request?.windows?.find((item) => item.workDate === workDate);
    return {
      workDate,
      wantsWork: request?.requestType === "availability",
      availableStart: window?.availableStart ?? "17:00",
      availableEnd: window?.availableEnd ?? "22:00",
      note: request?.note ?? window?.note ?? ""
    } satisfies AvailabilityDayDraft;
  });
}

function formatShiftDate(value: string) {
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(date);
}

function createShiftCalendarHref(shifts: ShiftEntry[], storeName: string) {
  const events = shifts
    .filter((shift) => shift.scheduledStart && shift.scheduledEnd)
    .map((shift) => createShiftCalendarEvent(shift, storeName))
    .join("\r\n");
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Foundr1//Store Shift//JA",
    "CALSCALE:GREGORIAN",
    events,
    "END:VCALENDAR"
  ].filter(Boolean).join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

function createShiftCalendarEvent(shift: ShiftEntry, storeName: string) {
  const start = formatCalendarDateTime(shift.workDate, shift.scheduledStart);
  const endDate = shouldUseNextCalendarDate(shift.scheduledStart, shift.scheduledEnd)
    ? addDateDays(shift.workDate, 1)
    : shift.workDate;
  const end = formatCalendarDateTime(endDate, shift.scheduledEnd);
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const summary = escapeCalendarText(`Foundr1 シフト ${storeName}`);
  const description = escapeCalendarText(`${formatShiftDate(shift.workDate)} ${shift.scheduledStart ?? "--:--"}-${shift.scheduledEnd ?? "--:--"}`);
  return [
    "BEGIN:VEVENT",
    `UID:foundr1-shift-${shift.id}@foundr1.jp`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=Asia/Tokyo:${start}`,
    `DTEND;TZID=Asia/Tokyo:${end}`,
    `SUMMARY:${summary}`,
    `LOCATION:${escapeCalendarText(storeName)}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT"
  ].join("\r\n");
}

function formatCalendarDateTime(workDate: string, time: string | null) {
  return `${workDate.replaceAll("-", "")}T${String(time ?? "00:00").replace(":", "")}00`;
}

function shouldUseNextCalendarDate(start: string | null, end: string | null) {
  return Boolean(start && end && end <= start);
}

function addDateDays(workDate: string, days: number) {
  const date = new Date(`${workDate}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function escapeCalendarText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
