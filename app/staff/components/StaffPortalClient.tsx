"use client";

import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Coffee,
  Download,
  FileText,
  Home,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  Send,
  UserRound,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDuration, formatJstDateTime, formatJstTime, getJstMonthLabel } from "../../../lib/timecard";
import { UserBadge } from "../../os/components/UserBadge";

type StaffView = "home" | "timecard" | "shifts" | "requests" | "payroll" | "documents";

type StoreOption = {
  id: string;
  name: string;
  attendanceLocationEnabled?: boolean;
  attendanceRadiusMeters?: number;
  attendanceAccuracyThresholdMeters?: number;
};

type Employee = {
  id: string;
  name: string;
  role: string;
  storeIds: string[];
};

type LatestPunch = {
  employeeId: string;
  punchType: string;
  punchedAt: string;
} | null;

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
  employees: Employee[];
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
  employeeName?: string;
  windows?: Array<{ workDate: string; availableStart: string | null; availableEnd: string | null; preference: string; note: string | null }>;
  candidates?: Array<{ employeeId: string; employeeName: string; status: string }>;
};

type ShiftRequestPayload = {
  requests?: ShiftRequestItem[];
  myShifts?: ShiftEntry[];
  nextShift?: ShiftEntry | null;
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

type AvailabilityDayDraft = {
  workDate: string;
  wantsWork: boolean;
  availableStart: string;
  availableEnd: string;
  note: string;
};

type PayrollItem = {
  id: string;
  storeName: string;
  payrollMonth: string;
  periodStart: string;
  periodEnd: string;
  confirmedAt: string;
  row: {
    workDays: number;
    workMinutes: number;
    breakMinutes: number;
    nightMinutes: number;
    basePay: number;
    overtimePay: number;
    nightPremiumPay: number;
    commuteAllowance: number;
    socialInsurance: number;
    employmentInsurance: number;
    incomeTax: number;
    residentTax: number;
    totalPay: number;
    alerts: string[];
  };
};

type PrivacyConsentRecord = {
  consentId: string;
  companyLegalName: string;
  version: string;
  title: string;
  body: string;
  effectiveDate: string;
  agreedAt: string;
  storeNames: string[];
};

type LocationState = {
  status: "idle" | "locating" | "ready" | "error";
  message: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
};

const staffStoreSelectionKey = "foundr1-staff:selected-store";

const punchActions = [
  { type: "clock_in", label: "出勤", icon: LogIn },
  { type: "break_start", label: "休憩開始", icon: Coffee },
  { type: "break_end", label: "休憩終了", icon: Coffee },
  { type: "clock_out", label: "退勤", icon: LogOut }
];

const navItems = [
  { view: "home", label: "ホーム", href: "/staff", icon: Home },
  { view: "timecard", label: "打刻", href: "/staff/timecard", icon: Clock3 },
  { view: "shifts", label: "シフト", href: "/staff/shifts", icon: CalendarDays },
  { view: "requests", label: "希望", href: "/staff/shift-requests", icon: Send },
  { view: "payroll", label: "給与", href: "/staff/payroll", icon: WalletCards }
] satisfies Array<{ view: StaffView; label: string; href: string; icon: LucideIcon }>;

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

function formatMoney(amount: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "未記録";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未記録";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function createAvailabilityDrafts(dates: string[], requests: ShiftRequestItem[]) {
  return dates.map((workDate) => {
    const existing = requests.find((request) => (
      request.requestType === "availability"
      && (request.workDate === workDate || request.windows?.some((window) => window.workDate === workDate))
    ));
    const window = existing?.windows?.find((entry) => entry.workDate === workDate);
    return {
      workDate,
      wantsWork: Boolean(existing),
      availableStart: window?.availableStart ?? "10:00",
      availableEnd: window?.availableEnd ?? "16:00",
      note: window?.note ?? existing?.note ?? ""
    };
  });
}

function getRequestTypeLabel(type: string) {
  if (type === "availability") return "希望シフト";
  if (type === "day_off") return "休み希望";
  if (type === "swap") return "交代募集";
  return type;
}

function getStatusLabel(status: string) {
  if (status === "approved") return "承認済み";
  if (status === "rejected") return "差戻し";
  return "確認待ち";
}

function readStoredStoreId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(staffStoreSelectionKey) ?? "";
}

export function StaffPortalClient({ view }: { view: StaffView }) {
  const [timecard, setTimecard] = useState<TimecardPayload | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [shiftPayload, setShiftPayload] = useState<ShiftRequestPayload | null>(null);
  const [availabilityDrafts, setAvailabilityDrafts] = useState<AvailabilityDayDraft[]>([]);
  const [payrolls, setPayrolls] = useState<PayrollItem[]>([]);
  const [documents, setDocuments] = useState<PrivacyConsentRecord[]>([]);
  const [location, setLocation] = useState<LocationState>({
    status: "idle",
    message: "出勤・退勤は位置情報を取得して打刻します。",
    latitude: null,
    longitude: null,
    accuracyMeters: null
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [shiftMessage, setShiftMessage] = useState("");
  const [isPunching, setIsPunching] = useState("");
  const [swapTargetShiftId, setSwapTargetShiftId] = useState("");
  const [swapNote, setSwapNote] = useState("");

  const currentEmployee = useMemo(() => (
    timecard?.employees.find((employee) => employee.id === timecard.currentEmployeeId) ?? null
  ), [timecard]);
  const selectedStore = useMemo(() => (
    timecard?.stores.find((store) => store.id === selectedStoreId) ?? timecard?.stores[0] ?? null
  ), [selectedStoreId, timecard]);
  const latestPunch = useMemo(() => (
    timecard?.latestPunches.find((punch) => punch?.employeeId === timecard.currentEmployeeId) ?? timecard?.latestPunch ?? null
  ), [timecard]);
  const punchState = getPunchState(latestPunch);
  const statusLabel = punchState === "working" ? "勤務中" : punchState === "break" ? "休憩中" : "未出勤";
  const myDays = useMemo(() => (
    (timecard?.dailySummaries ?? []).filter((day) => day.employeeId === timecard?.currentEmployeeId)
  ), [timecard]);
  const myShifts = shiftPayload?.myShifts ?? [];
  const requests = shiftPayload?.requests ?? [];
  const nextShift = shiftPayload?.nextShift ?? myShifts.find((shift) => shift.scheduledStart || shift.scheduledEnd) ?? null;
  const latestPayroll = payrolls[0] ?? null;

  async function loadTimecard(nextStoreId = selectedStoreId || readStoredStoreId()) {
    setLoading(true);
    setMessage("");
    const params = new URLSearchParams({ month: getJstMonthLabel(), selfOnly: "1", ts: String(Date.now()) });
    if (nextStoreId) params.set("storeId", nextStoreId);
    const response = await fetch(`/api/timecard?${params.toString()}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as TimecardPayload & { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "スタッフ情報を読み込めませんでした。");
      setLoading(false);
      return;
    }
    const nextSelectedStoreId = body.selectedStoreId || body.stores[0]?.id || "";
    setTimecard(body);
    setSelectedStoreId(nextSelectedStoreId);
    if (nextSelectedStoreId) window.localStorage.setItem(staffStoreSelectionKey, nextSelectedStoreId);
    setLoading(false);
    if (nextSelectedStoreId) void loadShiftRequests(nextSelectedStoreId);
  }

  async function loadShiftRequests(nextStoreId = selectedStoreId) {
    if (!nextStoreId) return;
    const params = new URLSearchParams({ storeId: nextStoreId, month: getJstMonthLabel(), selfOnly: "1", ts: String(Date.now()) });
    const response = await fetch(`/api/timecard/shift-requests?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json().catch(() => ({})) as ShiftRequestPayload;
    setShiftPayload(body);
    setAvailabilityDrafts(createAvailabilityDrafts(body.submissionDates ?? [], body.requests ?? []));
    setSwapTargetShiftId((current) => current || body.myShifts?.[0]?.id || "");
  }

  async function loadPayrolls() {
    const response = await fetch("/api/staff/payroll?limit=8", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json().catch(() => ({})) as { payrolls?: PayrollItem[] };
    setPayrolls(body.payrolls ?? []);
  }

  async function loadDocuments() {
    const response = await fetch("/api/privacy-consents/history", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json().catch(() => ({})) as { consents?: PrivacyConsentRecord[] };
    setDocuments(body.consents ?? []);
  }

  useEffect(() => {
    void loadTimecard();
    void loadPayrolls();
    if (view === "documents") void loadDocuments();
  }, []);

  useEffect(() => {
    if (view === "documents") void loadDocuments();
  }, [view]);

  async function requestLocation() {
    if (!navigator.geolocation) {
      setLocation({
        status: "error",
        message: "この端末では位置情報を取得できません。",
        latitude: null,
        longitude: null,
        accuracyMeters: null
      });
      return null;
    }
    setLocation((current) => ({ ...current, status: "locating", message: "位置情報を取得中です。" }));
    return new Promise<{ latitude: number; longitude: number; accuracyMeters: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const next = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy
          };
          setLocation({
            status: "ready",
            message: `取得済み / 精度 ${Math.round(next.accuracyMeters)}m`,
            ...next
          });
          resolve(next);
        },
        () => {
          setLocation({
            status: "error",
            message: "位置情報を取得できませんでした。端末の許可設定を確認してください。",
            latitude: null,
            longitude: null,
            accuracyMeters: null
          });
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
      );
    });
  }

  async function punch(punchType: string) {
    if (!selectedStoreId) return;
    setIsPunching(punchType);
    setMessage("");
    const requiresLocation = punchType === "clock_in" || punchType === "clock_out";
    const nextLocation = requiresLocation ? await requestLocation() : null;
    if (requiresLocation && !nextLocation) {
      setIsPunching("");
      return;
    }
    const response = await fetch("/api/timecard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: selectedStoreId,
        punchType,
        source: "mobile",
        mobileLatitude: nextLocation?.latitude ?? null,
        mobileLongitude: nextLocation?.longitude ?? null,
        mobileAccuracyMeters: nextLocation?.accuracyMeters ?? null
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setMessage(response.ok ? "打刻しました。" : body.error ?? "打刻できませんでした。");
    if (response.ok) await loadTimecard(selectedStoreId);
    setIsPunching("");
  }

  function updateAvailabilityDraft(workDate: string, patch: Partial<AvailabilityDayDraft>) {
    setAvailabilityDrafts((items) => items.map((item) => item.workDate === workDate ? { ...item, ...patch } : item));
  }

  async function submitAvailability() {
    if (!selectedStoreId) return;
    setShiftMessage("");
    const response = await fetch("/api/timecard/shift-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_availability_period",
        storeId: selectedStoreId,
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
    setShiftMessage(response.ok ? "希望シフトを送信しました。" : body.error ?? "希望シフトを送信できませんでした。");
    if (response.ok) await loadShiftRequests(selectedStoreId);
  }

  async function submitSwap() {
    if (!selectedStoreId || !swapTargetShiftId) return;
    const shift = myShifts.find((item) => item.id === swapTargetShiftId);
    if (!shift) {
      setShiftMessage("交代募集するシフトを選択してください。");
      return;
    }
    const response = await fetch("/api/timecard/shift-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_shift_request",
        storeId: selectedStoreId,
        requestType: "swap",
        workDate: shift.workDate,
        targetShiftId: shift.id,
        note: swapNote
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setShiftMessage(response.ok ? "交代募集を送信しました。" : body.error ?? "交代募集を送信できませんでした。");
    if (response.ok) {
      setSwapNote("");
      await loadShiftRequests(selectedStoreId);
    }
  }

  async function applyForSwap(requestId: string) {
    if (!selectedStoreId) return;
    const response = await fetch("/api/timecard/shift-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_candidate", storeId: selectedStoreId, requestId })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setShiftMessage(response.ok ? "交代募集に応募しました。" : body.error ?? "応募できませんでした。");
    if (response.ok) await loadShiftRequests(selectedStoreId);
  }

  return (
    <main className="staff-shell">
      <header className="staff-topbar">
        <a className="staff-brand" href="/staff" aria-label="Foundr1 STAFF">
          <span className="brand-mark staff-app-icon" aria-hidden="true" />
          <span>
            <small>Foundr1 STAFF</small>
            <strong>{currentEmployee?.name ?? "スタッフ"}</strong>
          </span>
        </a>
        <div className="staff-user-tools">
          <UserBadge showNotifications={false} showLanguagePicker={false} logoutHref="/staff/logout" />
        </div>
      </header>

      <nav className="staff-nav" aria-label="スタッフメニュー">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <a className={view === item.view ? "is-active" : ""} href={item.href} key={item.href}>
              <Icon size={17} />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>

      <section className={`staff-status-card is-${punchState}`}>
        <div>
          <span className="staff-status-store">{selectedStore?.name ?? "店舗未設定"}</span>
          <h1>{statusLabel}</h1>
          <p>{latestPunch?.punchedAt ? `${formatJstDateTime(latestPunch.punchedAt)} に最終打刻` : loading ? "読み込み中" : "本日の打刻を開始できます"}</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => loadTimecard(selectedStoreId)}>
          <RefreshCw size={16} />
          更新
        </button>
      </section>

      {timecard && timecard.stores.length > 1 ? (
        <section className="staff-store-select" aria-label="勤務店舗">
          <div className="staff-store-select-heading">
            <MapPin aria-hidden="true" />
            <div>
              <span>現在の勤務店舗</span>
              <strong>{selectedStore?.name ?? "店舗未設定"}</strong>
            </div>
          </div>
          <label className="staff-store-select-control">
            <span>店舗を切り替え</span>
            <select value={selectedStoreId} onChange={(event) => {
              const nextStoreId = event.target.value;
              setSelectedStoreId(nextStoreId);
              window.localStorage.setItem(staffStoreSelectionKey, nextStoreId);
              void loadTimecard(nextStoreId);
            }}>
              {timecard.stores.map((store) => (
                <option value={store.id} key={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
        </section>
      ) : null}

      {view === "home" ? (
        <HomeView
          latestPayroll={latestPayroll}
          nextShift={nextShift}
          myDays={myDays}
          requests={requests}
        />
      ) : null}

      {view === "timecard" ? (
        <TimecardView
          location={location}
          selectedStore={selectedStore}
          message={message}
          isPunching={isPunching}
          punchState={punchState}
          myDays={myDays}
          onRequestLocation={requestLocation}
          onPunch={punch}
        />
      ) : null}

      {view === "shifts" ? (
        <ShiftsView myShifts={myShifts} schedulingPeriod={shiftPayload?.schedulingPeriod ?? null} />
      ) : null}

      {view === "requests" ? (
        <RequestsView
          requests={requests}
          myShifts={myShifts}
          submissionPeriod={shiftPayload?.submissionPeriod ?? null}
          availabilityDrafts={availabilityDrafts}
          swapTargetShiftId={swapTargetShiftId}
          swapNote={swapNote}
          shiftMessage={shiftMessage}
          currentEmployeeId={timecard?.currentEmployeeId ?? ""}
          onUpdateAvailability={updateAvailabilityDraft}
          onSubmitAvailability={submitAvailability}
          onChangeSwapTarget={setSwapTargetShiftId}
          onChangeSwapNote={setSwapNote}
          onSubmitSwap={submitSwap}
          onApplyForSwap={applyForSwap}
        />
      ) : null}

      {view === "payroll" ? <PayrollView payrolls={payrolls} /> : null}
      {view === "documents" ? <DocumentsView documents={documents} /> : null}
    </main>
  );
}

function HomeView({ latestPayroll, nextShift, myDays, requests }: { latestPayroll: PayrollItem | null; nextShift: ShiftEntry | null; myDays: DailySummary[]; requests: ShiftRequestItem[] }) {
  const monthWorkMinutes = myDays.reduce((sum, day) => sum + day.workMinutes, 0);
  const openRequests = requests.filter((request) => request.status === "open").length;
  return (
    <section className="staff-home-grid">
      <a className="staff-action-card" href="/staff/timecard">
        <Clock3 />
        <span>
          <strong>打刻する</strong>
          <small>出勤・休憩・退勤</small>
        </span>
        <ChevronRight size={18} />
      </a>
      <a className="staff-action-card" href="/staff/shifts">
        <CalendarDays />
        <span>
          <strong>次回シフト</strong>
          <small>{nextShift ? `${formatDate(nextShift.workDate)} ${nextShift.scheduledStart ?? "--:--"}-${nextShift.scheduledEnd ?? "--:--"}` : "確定シフトなし"}</small>
        </span>
        <ChevronRight size={18} />
      </a>
      <a className="staff-action-card" href="/staff/shift-requests">
        <Send />
        <span>
          <strong>希望シフト</strong>
          <small>{openRequests ? `確認待ち ${openRequests} 件` : "提出・交代募集"}</small>
        </span>
        <ChevronRight size={18} />
      </a>
      <a className="staff-action-card" href="/staff/payroll">
        <WalletCards />
        <span>
          <strong>給与</strong>
          <small>{latestPayroll ? `${latestPayroll.payrollMonth} ${formatMoney(latestPayroll.row.totalPay)}` : "確認済み給与なし"}</small>
        </span>
        <ChevronRight size={18} />
      </a>

      <article className="staff-panel staff-home-summary">
        <div className="staff-panel-title">
          <UserRound />
          <div>
            <h2>今月の勤務</h2>
            <p>{myDays.length} 日 / {formatDuration(monthWorkMinutes)}</p>
          </div>
        </div>
        <div className="staff-mini-list">
          {myDays.slice(0, 4).map((day) => (
            <div className="staff-mini-row" key={day.key}>
              <span>{formatDate(day.workDate)}</span>
              <strong>{formatDuration(day.workMinutes)}</strong>
            </div>
          ))}
          {!myDays.length ? <p className="empty-state-text">今月の打刻はまだありません。</p> : null}
        </div>
      </article>

      <a className="staff-action-card is-secondary" href="/staff/download">
        <Download />
        <span>
          <strong>APKダウンロード</strong>
          <small>Android最新版を保存</small>
        </span>
        <ChevronRight size={18} />
      </a>

      <a className="staff-action-card is-secondary" href="/staff/privacy-documents">
        <FileText />
        <span>
          <strong>個人情報文書</strong>
          <small>同意済み文書を確認</small>
        </span>
        <ChevronRight size={18} />
      </a>
    </section>
  );
}

function TimecardView({ location, selectedStore, message, isPunching, punchState, myDays, onRequestLocation, onPunch }: {
  location: LocationState;
  selectedStore: StoreOption | null;
  message: string;
  isPunching: string;
  punchState: string;
  myDays: DailySummary[];
  onRequestLocation: () => Promise<{ latitude: number; longitude: number; accuracyMeters: number } | null>;
  onPunch: (punchType: string) => void;
}) {
  return (
    <section className="staff-page-stack">
      <article className="staff-panel">
        <div className="staff-panel-title">
          <Clock3 />
          <div>
            <h2>タイムカード</h2>
            <p>{selectedStore?.attendanceLocationEnabled ? `位置確認あり / ${selectedStore.attendanceRadiusMeters ?? 100}m` : "位置記録あり"}</p>
          </div>
        </div>
        <div className={`mobile-timecard-location is-${location.status}`}>
          <div>
            <strong>{location.status === "ready" ? "位置取得済み" : "位置情報"}</strong>
            <span>{location.message}</span>
            {selectedStore?.attendanceLocationEnabled ? <small>精度上限 {selectedStore.attendanceAccuracyThresholdMeters ?? 100}m</small> : null}
          </div>
          <button className="secondary-button" type="button" disabled={location.status === "locating"} onClick={() => void onRequestLocation()}>
            {location.status === "locating" ? "取得中" : "位置取得"}
          </button>
        </div>
        {message ? <div className="timecard-message">{message}</div> : null}
        <div className="timecard-punch-actions">
          {punchActions.map((action) => {
            const Icon = action.icon;
            const enabled = canUsePunch(action.type, punchState) && !isPunching;
            return (
              <button className="timecard-punch-button" type="button" disabled={!enabled} onClick={() => onPunch(action.type)} key={action.type}>
                <Icon size={22} />
                <span>{isPunching === action.type ? "処理中" : action.label}</span>
              </button>
            );
          })}
        </div>
      </article>
      <WorkHistory days={myDays} />
    </section>
  );
}

function WorkHistory({ days }: { days: DailySummary[] }) {
  return (
    <article className="staff-panel">
      <div className="staff-panel-title">
        <CheckCircle2 />
        <div>
          <h2>今月の実績</h2>
          <p>{days.length} 日分</p>
        </div>
      </div>
      <div className="timecard-day-list">
        {days.length ? days.map((day) => (
          <article className="timecard-day-row" key={day.key}>
            <div>
              <strong>{formatDate(day.workDate)}</strong>
              <span>{day.storeName}</span>
            </div>
            <div>
              <span>{formatJstTime(day.clockIn) ?? "--:--"} - {formatJstTime(day.clockOut) ?? "--:--"}</span>
              <strong>{formatDuration(day.workMinutes)}</strong>
            </div>
            {day.alerts.length ? <small>{day.alerts.join("、")}</small> : null}
          </article>
        )) : <p className="empty-state-text">今月の打刻はまだありません。</p>}
      </div>
    </article>
  );
}

function ShiftsView({ myShifts, schedulingPeriod }: { myShifts: ShiftEntry[]; schedulingPeriod: ShiftRequestPayload["schedulingPeriod"] | null }) {
  return (
    <section className="staff-page-stack">
      <article className="staff-panel">
        <div className="staff-panel-title">
          <CalendarDays />
          <div>
            <h2>確定シフト</h2>
            <p>{schedulingPeriod ? `${schedulingPeriod.label} / ${schedulingPeriod.startDate} - ${schedulingPeriod.endDate}` : "公開済みシフト"}</p>
          </div>
        </div>
        <div className="staff-shift-list">
          {myShifts.length ? myShifts.map((shift) => (
            <article className="staff-shift-row" key={shift.id}>
              <div>
                <strong>{formatDate(shift.workDate)}</strong>
                <span>{shift.scheduledStart ?? "--:--"} - {shift.scheduledEnd ?? "--:--"}</span>
              </div>
              <a className="text-button" href={createCalendarHref(shift)} download={`foundr1-shift-${shift.workDate}.ics`}>
                カレンダー
              </a>
            </article>
          )) : <p className="empty-state-text">この期間の確定シフトはまだありません。</p>}
        </div>
      </article>
    </section>
  );
}

function RequestsView({
  requests,
  myShifts,
  submissionPeriod,
  availabilityDrafts,
  swapTargetShiftId,
  swapNote,
  shiftMessage,
  currentEmployeeId,
  onUpdateAvailability,
  onSubmitAvailability,
  onChangeSwapTarget,
  onChangeSwapNote,
  onSubmitSwap,
  onApplyForSwap
}: {
  requests: ShiftRequestItem[];
  myShifts: ShiftEntry[];
  submissionPeriod: ShiftRequestPayload["submissionPeriod"] | null;
  availabilityDrafts: AvailabilityDayDraft[];
  swapTargetShiftId: string;
  swapNote: string;
  shiftMessage: string;
  currentEmployeeId: string;
  onUpdateAvailability: (workDate: string, patch: Partial<AvailabilityDayDraft>) => void;
  onSubmitAvailability: () => void;
  onChangeSwapTarget: (value: string) => void;
  onChangeSwapNote: (value: string) => void;
  onSubmitSwap: () => void;
  onApplyForSwap: (requestId: string) => void;
}) {
  return (
    <section className="staff-page-stack">
      <article className="staff-panel">
        <div className="staff-panel-title">
          <Send />
          <div>
            <h2>希望シフト</h2>
            <p>{submissionPeriod ? `${submissionPeriod.label} / 締切 ${submissionPeriod.deadlineAt}` : "次回提出期間"}</p>
          </div>
        </div>
        <div className="store-shift-period-list">
          {availabilityDrafts.map((draft) => (
            <article className="store-shift-period-row" key={draft.workDate}>
              <strong>{formatDate(draft.workDate)}</strong>
              <label className={`store-shift-wants-work${draft.wantsWork ? " is-selected" : ""}`}>
                <input type="checkbox" checked={draft.wantsWork} onChange={(event) => onUpdateAvailability(draft.workDate, { wantsWork: event.target.checked })} />
                出勤希望
              </label>
              <div className="store-shift-request-times">
                <input type="time" value={draft.availableStart} disabled={!draft.wantsWork} onChange={(event) => onUpdateAvailability(draft.workDate, { availableStart: event.target.value })} />
                <input type="time" value={draft.availableEnd} disabled={!draft.wantsWork} onChange={(event) => onUpdateAvailability(draft.workDate, { availableEnd: event.target.value })} />
              </div>
              <input value={draft.note} placeholder="メモ" disabled={!draft.wantsWork} onChange={(event) => onUpdateAvailability(draft.workDate, { note: event.target.value })} />
            </article>
          ))}
          {!availabilityDrafts.length ? <p className="empty-state-text">提出期間を読み込めませんでした。</p> : null}
        </div>
        <button className="primary-button staff-full-button" type="button" onClick={onSubmitAvailability}>
          <Send size={16} />
          希望シフトを送信
        </button>
      </article>

      <article className="staff-panel">
        <div className="staff-panel-title">
          <RefreshCw />
          <div>
            <h2>交代募集</h2>
            <p>自分の確定シフトから募集できます。</p>
          </div>
        </div>
        <div className="staff-form-row">
          <select value={swapTargetShiftId} onChange={(event) => onChangeSwapTarget(event.target.value)}>
            {myShifts.map((shift) => (
              <option value={shift.id} key={shift.id}>{shift.workDate} {shift.scheduledStart ?? "--:--"}-{shift.scheduledEnd ?? "--:--"}</option>
            ))}
          </select>
          <input value={swapNote} placeholder="メモ" onChange={(event) => onChangeSwapNote(event.target.value)} />
          <button className="secondary-button" type="button" onClick={onSubmitSwap}>募集</button>
        </div>
      </article>

      {shiftMessage ? <div className="timecard-message">{shiftMessage}</div> : null}

      <article className="staff-panel">
        <div className="staff-panel-title">
          <FileText />
          <div>
            <h2>シフト連絡</h2>
            <p>自分の申請と募集中の交代依頼</p>
          </div>
        </div>
        <div className="staff-request-list">
          {requests.length ? requests.slice(0, 12).map((request) => {
            const hasApplied = request.candidates?.some((candidate) => candidate.employeeId === currentEmployeeId);
            const canApply = request.requestType === "swap" && request.status === "open" && request.employeeId !== currentEmployeeId && !hasApplied;
            return (
              <article className="staff-request-row" key={request.id}>
                <div>
                  <strong>{getRequestTypeLabel(request.requestType)} / {getStatusLabel(request.status)}</strong>
                  <span>{request.workDate ?? request.windows?.[0]?.workDate ?? ""} {request.note ?? ""}</span>
                  {request.employeeName ? <small>{request.employeeName}</small> : null}
                </div>
                {canApply ? <button className="text-button" type="button" onClick={() => onApplyForSwap(request.id)}>応募</button> : null}
              </article>
            );
          }) : <p className="empty-state-text">シフト連絡はまだありません。</p>}
        </div>
      </article>
    </section>
  );
}

function PayrollView({ payrolls }: { payrolls: PayrollItem[] }) {
  return (
    <section className="staff-page-stack">
      {payrolls.length ? payrolls.map((payroll) => (
        <article className="staff-panel staff-payroll-card" key={`${payroll.id}:${payroll.payrollMonth}`}>
          <div className="staff-panel-title">
            <WalletCards />
            <div>
              <h2>{payroll.payrollMonth} 給与</h2>
              <p>{payroll.storeName} / 確認日 {formatDateTime(payroll.confirmedAt)}</p>
            </div>
          </div>
          <strong className="staff-payroll-total">{formatMoney(payroll.row.totalPay)}</strong>
          <dl className="staff-payroll-breakdown">
            <div><dt>勤務</dt><dd>{payroll.row.workDays} 日 / {formatDuration(payroll.row.workMinutes)}</dd></div>
            <div><dt>基本給</dt><dd>{formatMoney(payroll.row.basePay)}</dd></div>
            <div><dt>残業・深夜</dt><dd>{formatMoney(payroll.row.overtimePay + payroll.row.nightPremiumPay)}</dd></div>
            <div><dt>交通費</dt><dd>{formatMoney(payroll.row.commuteAllowance)}</dd></div>
            <div><dt>控除</dt><dd>{formatMoney(payroll.row.socialInsurance + payroll.row.employmentInsurance + payroll.row.incomeTax + payroll.row.residentTax)}</dd></div>
          </dl>
          {payroll.row.alerts.length ? <p className="staff-payroll-alert">{payroll.row.alerts.join("、")}</p> : null}
        </article>
      )) : (
        <article className="staff-panel">
          <div className="staff-panel-title">
            <WalletCards />
            <div>
              <h2>給与</h2>
              <p>確認済み給与がまだありません。</p>
            </div>
          </div>
        </article>
      )}
    </section>
  );
}

function DocumentsView({ documents }: { documents: PrivacyConsentRecord[] }) {
  return (
    <section className="staff-page-stack">
      <article className="staff-panel">
        <div className="staff-panel-title">
          <FileText />
          <div>
            <h2>個人情報文書</h2>
            <p>同意済み文書を確認できます。</p>
          </div>
        </div>
        <div className="staff-request-list">
          {documents.length ? documents.map((document) => (
            <article className="staff-request-row" key={document.consentId}>
              <div>
                <strong>{document.companyLegalName || "会社未設定"}</strong>
                <span>{document.title} / {document.version}</span>
                <small>同意日時 {formatDateTime(document.agreedAt)}</small>
              </div>
              <a className="text-button" href={`/api/privacy-consents/history/${document.consentId}/pdf`}>PDF</a>
            </article>
          )) : <p className="empty-state-text">同意済み文書はまだありません。</p>}
        </div>
      </article>
    </section>
  );
}

function createCalendarHref(shift: ShiftEntry) {
  if (!shift.scheduledStart || !shift.scheduledEnd) return "#";
  const start = `${shift.workDate.replaceAll("-", "")}T${shift.scheduledStart.replace(":", "")}00`;
  const end = `${shift.workDate.replaceAll("-", "")}T${shift.scheduledEnd.replace(":", "")}00`;
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Foundr1//Staff Shift//JA",
    "BEGIN:VEVENT",
    `UID:foundr1-staff-shift-${shift.id}@foundr1.jp`,
    `DTSTART;TZID=Asia/Tokyo:${start}`,
    `DTEND;TZID=Asia/Tokyo:${end}`,
    "SUMMARY:Foundr1 シフト",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}
