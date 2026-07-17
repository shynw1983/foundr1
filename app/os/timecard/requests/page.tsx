"use client";

import { BriefcaseBusiness, CalendarCheck2, CalendarDays, ClipboardList, Clock3, FileText, Lightbulb, LogOut, MessageSquare, PackageCheck, RefreshCw, Search, Send, Settings, Store, Truck, UserCog, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { MobileNavMenu } from "../../components/MobileNavMenu";
import { OsNavList } from "../../components/OsNavList";
import { UserBadge } from "../../components/UserBadge";
import { getJstMonthLabel } from "../../../../lib/timecard";
import { normalizeBusinessHours, type StoreBusinessHours, type WeekdayKey } from "../../../../lib/store-business-hours";
import { formatTimelineMinute, getBusinessInterval, getShiftInterval, getTimelineBarStyle, getTimelineInterval } from "../../../../lib/shift-timeline";

type StoreOption = { id: string; name: string; businessHours?: unknown };
type EmployeeOption = { id: string; name: string; role: string };
type ShiftRequestItem = {
  id: string;
  requestType: "availability" | "day_off" | "swap";
  status: "open" | "approved" | "rejected";
  targetShiftId: string | null;
  workDate: string | null;
  title: string;
  note: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  employeeId: string;
  employeeName: string;
  reviewedByName: string | null;
  approvedStart: string | null;
  approvedEnd: string | null;
  windows: Array<{ id: string; workDate: string; availableStart: string | null; availableEnd: string | null; preference: string; note: string | null }>;
  candidates: Array<{ id: string; employeeId: string; employeeName: string; status: string; note: string | null; createdAt: string }>;
  messages: Array<{ id: string; employeeId: string | null; employeeName: string | null; message: string; createdAt: string }>;
};

type ShiftRequestPayload = {
  month: string;
  selectedStoreId: string;
  stores: StoreOption[];
  employees: EmployeeOption[];
  schedulingPeriod?: { key: string; periodType: "first_half" | "second_half"; startDate: string; endDate: string; label: string };
  schedulingDates?: string[];
  requests: ShiftRequestItem[];
  myShifts?: Array<{ id: string; employeeId: string; workDate: string; scheduledStart: string | null; scheduledEnd: string | null; employeeName: string }>;
  monthlyShiftStats?: Array<{ employeeId: string; confirmedDays: number; rejectedDays: number }>;
  publications: Array<{ id: string; scheduleMonth: string; note: string | null; publishedAt: string; publishedByName: string | null }>;
};

type ApprovalDraft = {
  approvedStart: string;
  approvedEnd: string;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "タイムカード", href: "/os/timecard", icon: Clock3 },
  { label: "シフト", href: "/os/timecard/schedule", icon: CalendarDays },
  { label: "シフト連絡", href: "/os/timecard/requests", icon: MessageSquare },
  { label: "給与", href: "/os/timecard/payroll", icon: WalletCards },
  { label: "商品マスタ", href: "/os/products", icon: BriefcaseBusiness },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "システム設定", href: "/os/settings", icon: Settings },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const typeLabels: Record<ShiftRequestItem["requestType"], string> = {
  availability: "希望シフト",
  day_off: "休み希望",
  swap: "交代募集"
};

const statusLabels: Record<ShiftRequestItem["status"], string> = {
  open: "未確認",
  approved: "承認済み",
  rejected: "却下"
};

function formatDateTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getWeekdayKey(workDate: string): WeekdayKey {
  const date = new Date(`${workDate}T12:00:00+09:00`);
  const keys: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as WeekdayKey[];
  return keys[date.getUTCDay()] ?? "mon";
}

function getBusinessDay(hours: StoreBusinessHours, workDate: string) {
  return hours[getWeekdayKey(workDate)];
}

function formatWorkDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(new Date(`${value}T00:00:00+09:00`));
}

type SchedulingPeriodOption = NonNullable<ShiftRequestPayload["schedulingPeriod"]>;

function getSchedulingPeriodOption(month: string, periodType: "first_half" | "second_half"): SchedulingPeriodOption {
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonthStart = new Date(Date.UTC(year, monthNumber, 1));
  const endOfMonth = new Date(nextMonthStart.getTime() - 24 * 60 * 60 * 1000).getUTCDate();
  return {
    key: `${month}-${periodType}`,
    periodType,
    startDate: `${month}-${periodType === "first_half" ? "01" : "16"}`,
    endDate: `${month}-${periodType === "first_half" ? "15" : String(endOfMonth).padStart(2, "0")}`,
    label: `${month} ${periodType === "first_half" ? "前半" : "後半"}`
  };
}

function addSchedulingPeriods(period: SchedulingPeriodOption, offset: number) {
  const month = period.startDate.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const halfIndex = year * 24 + (monthNumber - 1) * 2 + (period.periodType === "second_half" ? 1 : 0) + offset;
  const nextYear = Math.floor(halfIndex / 24);
  const nextMonthIndex = Math.floor((halfIndex % 24) / 2);
  const nextMonth = `${nextYear}-${String(nextMonthIndex + 1).padStart(2, "0")}`;
  return getSchedulingPeriodOption(nextMonth, halfIndex % 2 === 0 ? "first_half" : "second_half");
}

function getSchedulingPeriodKeyForDate(value: string) {
  const match = /^(\d{4}-\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  return `${match[1]}-${Number(match[2]) <= 15 ? "first_half" : "second_half"}`;
}

function formatSchedulingPeriodLabel(period: SchedulingPeriodOption) {
  const [year, month] = period.startDate.slice(0, 7).split("-");
  return `${year}年 ${Number(month)}月${period.periodType === "first_half" ? "前半" : "後半"}`;
}

function formatSchedulingPeriodRange(period: SchedulingPeriodOption) {
  const format = (value: string) => {
    const [, month, day] = value.split("-");
    return `${Number(month)}/${Number(day)}`;
  };
  return `${format(period.startDate)}–${format(period.endDate)}`;
}

function getShiftWindow(request: ShiftRequestItem) {
  return request.windows.find((window) => window.workDate === request.workDate) ?? request.windows[0] ?? null;
}

function getCoverageSummary(
  requests: ShiftRequestItem[],
  shifts: Array<{ scheduledStart: string | null; scheduledEnd: string | null }>,
  day: { open: string; close: string; closed: boolean },
  drafts: Record<string, ApprovalDraft>
) {
  if (day.closed) return "休業日";
  const business = getBusinessInterval(day.open, day.close);
  const requestIntervals = requests
    .filter((request) => request.status !== "rejected")
    .map((request) => {
      const window = getShiftWindow(request);
      const draft = drafts[request.id] ?? { approvedStart: window?.availableStart ?? "", approvedEnd: window?.availableEnd ?? "" };
      const interval = getShiftInterval(draft.approvedStart, draft.approvedEnd, business);
      return {
        start: Math.max(business.start, interval?.start ?? business.start),
        end: Math.min(business.end, interval?.end ?? business.start)
      };
    });
  const shiftIntervals = shifts.map((shift) => {
    const interval = getShiftInterval(shift.scheduledStart, shift.scheduledEnd, business);
    return {
      start: Math.max(business.start, interval?.start ?? business.start),
      end: Math.min(business.end, interval?.end ?? business.start)
    };
  });
  const intervals = [...requestIntervals, ...shiftIntervals]
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);

  let cursor = business.start;
  for (const interval of intervals) {
    if (interval.start > cursor) return "未充足";
    cursor = Math.max(cursor, interval.end);
    if (cursor >= business.end) return "充足";
  }
  return cursor >= business.end ? "充足" : "未充足";
}

function ShiftMonthStats({ stats }: { stats?: { confirmedDays: number; rejectedDays: number } }) {
  const confirmedDays = stats?.confirmedDays ?? 0;
  const rejectedDays = stats?.rejectedDays ?? 0;
  const decidedDays = confirmedDays + rejectedDays;
  const confirmationRate = decidedDays > 0 ? `${Math.round((confirmedDays / decidedDays) * 100)}%` : "—";
  return (
    <span className="shift-coverage-person-stats" aria-label={`今月の確定 ${confirmedDays}日、却下 ${rejectedDays}日、確定率 ${confirmationRate}`}>
      <span className="shift-coverage-person-stat">確定 {confirmedDays}日</span>
      <span className="shift-coverage-person-stat is-rejected">却下 {rejectedDays}日</span>
      <span className="shift-coverage-person-stat is-rate">確定率 {confirmationRate}</span>
    </span>
  );
}

export default function TimecardShiftRequestsPage() {
  const initialQueryRef = useRef<{ storeId: string; requestId: string; date: string; handled: boolean } | null>(null);
  const [data, setData] = useState<ShiftRequestPayload | null>(null);
  const [month, setMonth] = useState(getJstMonthLabel());
  const [selectedPeriodKey, setSelectedPeriodKey] = useState("");
  const [pendingPeriodKey, setPendingPeriodKey] = useState("");
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ShiftRequestItem["status"]>("open");
  const [message, setMessage] = useState("");
  const [publishNote, setPublishNote] = useState("");
  const [approvalDrafts, setApprovalDrafts] = useState<Record<string, ApprovalDraft>>({});
  const [editingApprovedRequestId, setEditingApprovedRequestId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  if (typeof window !== "undefined" && initialQueryRef.current === null) {
    const params = new URLSearchParams(window.location.search);
    initialQueryRef.current = {
      storeId: params.get("storeId") ?? "",
      requestId: params.get("requestId") ?? "",
      date: params.get("date") ?? "",
      handled: false
    };
  }

  async function loadRequests(nextStoreId = selectedStoreId, nextPeriodKey = selectedPeriodKey) {
    setIsLoading(true);
    setPendingPeriodKey(nextPeriodKey);
    setMessage("");
    try {
      const periodMonth = nextPeriodKey.match(/^\d{4}-\d{2}/)?.[0] ?? month;
      const params = new URLSearchParams({ month: periodMonth });
      if (nextPeriodKey) params.set("period", nextPeriodKey);
      if (nextStoreId) params.set("storeId", nextStoreId);
      const response = await fetch(`/api/timecard/shift-requests?${params.toString()}`, { cache: "no-store" });
      if (response.ok) {
        const body = await response.json() as ShiftRequestPayload;
        setData(body);
        setSelectedStoreId(body.selectedStoreId);
        setMonth(body.month);
        setSelectedPeriodKey(body.schedulingPeriod?.key ?? "");
        setApprovalDrafts((current) => {
          const next = { ...current };
          for (const request of body.requests ?? []) {
            if (request.requestType !== "availability" || (request.status === "open" && next[request.id])) continue;
            const window = getShiftWindow(request);
            next[request.id] = {
              approvedStart: request.approvedStart ?? window?.availableStart ?? "",
              approvedEnd: request.approvedEnd ?? window?.availableEnd ?? ""
            };
          }
          return next;
        });
      } else {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setMessage(body.error ?? "シフト連絡を読み込めませんでした。");
      }
    } catch {
      setMessage("シフト連絡を読み込めませんでした。通信状態を確認してください。");
    } finally {
      setIsLoading(false);
      setPendingPeriodKey("");
    }
  }

  useEffect(() => {
    const initialQuery = initialQueryRef.current;
    if (initialQuery?.requestId) setStatusFilter("all");
    void loadRequests(initialQuery?.storeId || selectedStoreId, getSchedulingPeriodKeyForDate(initialQuery?.date ?? ""));
  }, []);

  useEffect(() => {
    const initialQuery = initialQueryRef.current;
    if (!initialQuery || initialQuery.handled || !initialQuery.requestId || isLoading) return;
    const target = document.getElementById(`shift-request-${initialQuery.requestId}`);
    if (!target) return;
    initialQuery.handled = true;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("is-linked-target");
    window.setTimeout(() => target.classList.remove("is-linked-target"), 3200);
  }, [data?.requests, isLoading]);

  const filteredRequests = useMemo(() => {
    return (data?.requests ?? []).filter((request) => statusFilter === "all" || request.status === statusFilter);
  }, [data?.requests, statusFilter]);
  const selectedStore = data?.stores.find((store) => store.id === selectedStoreId) ?? null;
  const businessHours = useMemo(() => normalizeBusinessHours(selectedStore?.businessHours), [selectedStore?.businessHours]);
  const availabilityByDate = useMemo(() => {
    const groups = new Map<string, ShiftRequestItem[]>();
    for (const request of filteredRequests) {
      if (request.requestType !== "availability" || !request.workDate) continue;
      groups.set(request.workDate, [...(groups.get(request.workDate) ?? []), request]);
    }
    return groups;
  }, [filteredRequests]);
  const shiftsByDate = useMemo(() => {
    const groups = new Map<string, NonNullable<ShiftRequestPayload["myShifts"]>>();
    for (const shift of data?.myShifts ?? []) {
      groups.set(shift.workDate, [...(groups.get(shift.workDate) ?? []), shift]);
    }
    return groups;
  }, [data?.myShifts]);
  const monthlyShiftStatsByEmployee = useMemo(() => {
    return new Map((data?.monthlyShiftStats ?? []).map((stats) => [stats.employeeId, stats]));
  }, [data?.monthlyShiftStats]);
  const calendarDates = data?.schedulingDates ?? Array.from(availabilityByDate.keys()).sort((left, right) => left.localeCompare(right));
  const otherRequests = useMemo(() => filteredRequests.filter((request) => request.requestType !== "availability"), [filteredRequests]);

  async function reviewRequest(request: ShiftRequestItem, approved: boolean, candidateId = "", approvalDraft?: ApprovalDraft) {
    const response = await fetch("/api/timecard/shift-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review_request",
        storeId: selectedStoreId,
        requestId: request.id,
        candidateId,
        approvedStart: approvalDraft?.approvedStart,
        approvedEnd: approvalDraft?.approvedEnd,
        reviewNote: approved ? "" : "reject:"
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "申請を更新できませんでした。");
      return;
    }
    setMessage(approved ? "申請を承認しました。" : "申請を却下しました。");
    setEditingApprovedRequestId("");
    await loadRequests(selectedStoreId, selectedPeriodKey);
  }

  async function publishSchedule() {
    const response = await fetch("/api/timecard/shift-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish_schedule", storeId: selectedStoreId, month, note: publishNote })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "シフトを公開できませんでした。");
      return;
    }
    setPublishNote("");
    setMessage("シフトを公開しました。");
    await loadRequests(selectedStoreId, selectedPeriodKey);
  }

  const latestPublication = data?.publications[0] ?? null;
  const openCount = (data?.requests ?? []).filter((request) => request.status === "open").length;
  const periodOptions = data?.schedulingPeriod
    ? [-1, 0, 1].map((offset) => addSchedulingPeriods(data.schedulingPeriod as SchedulingPeriodOption, offset))
    : [];

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
            <p className="eyebrow">希望シフト・休み希望・交代募集</p>
            <h2>シフト連絡</h2>
            <span className="source-indicator">{isLoading ? "読み込み中" : `未確認 ${openCount} 件`}</span>
          </div>
          <div className="timecard-toolbar">
            <select value={selectedStoreId} onChange={(event) => {
              setSelectedStoreId(event.target.value);
              void loadRequests(event.target.value, selectedPeriodKey);
            }}>
              {data?.stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
            </select>
            <button className="secondary-button" type="button" onClick={() => loadRequests(selectedStoreId, selectedPeriodKey)}>
              <RefreshCw size={16} />
              更新
            </button>
          </div>
        </header>

        {message ? <div className="timecard-message">{message}</div> : null}

        <nav className="shift-period-switcher" aria-label="シフト対象期間" aria-busy={isLoading}>
          {periodOptions.map((period) => (
            <button
              className={period.key === (pendingPeriodKey || selectedPeriodKey) ? "is-active" : ""}
              type="button"
              aria-disabled={isLoading}
              aria-current={period.key === (pendingPeriodKey || selectedPeriodKey) ? "page" : undefined}
              onClick={() => {
                if (!isLoading) void loadRequests(selectedStoreId, period.key);
              }}
              key={period.key}
            >
              <strong>{formatSchedulingPeriodLabel(period)}</strong>
              <span>{formatSchedulingPeriodRange(period)}</span>
            </button>
          ))}
        </nav>

        <section className="panel shift-request-publish-panel">
          <div className="panel-title">
            <CalendarCheck2 />
            <div>
              <h3>シフト公開</h3>
              <p>{latestPublication ? `${formatDateTime(latestPublication.publishedAt)} に ${latestPublication.publishedByName ?? "管理者"} が公開` : "まだこの月のシフトは公開されていません。"}</p>
            </div>
          </div>
          <div className="shift-request-publish-actions">
            <input value={publishNote} placeholder="公開メモ（任意）" onChange={(event) => setPublishNote(event.target.value)} />
            <button className="primary-button" type="button" onClick={publishSchedule}>
              <Send size={16} />
              シフト公開
            </button>
          </div>
        </section>

        <section className="timecard-subtabs" aria-label="状態">
          <button className={statusFilter === "open" ? "is-active" : ""} type="button" onClick={() => setStatusFilter("open")}>未確認</button>
          <button className={statusFilter === "approved" ? "is-active" : ""} type="button" onClick={() => setStatusFilter("approved")}>承認済み</button>
          <button className={statusFilter === "rejected" ? "is-active" : ""} type="button" onClick={() => setStatusFilter("rejected")}>却下</button>
          <button className={statusFilter === "all" ? "is-active" : ""} type="button" onClick={() => setStatusFilter("all")}>すべて</button>
        </section>

        <section className="shift-coverage-list">
          {isLoading ? <div className="empty-state">読み込み中</div> : null}
          {!isLoading && calendarDates.length === 0 ? <div className="empty-state">シフト対象期間がありません。</div> : null}
          {data?.schedulingPeriod ? (
            <div className="shift-schedule-period-label">
              <CalendarDays size={16} />
              <strong>{data.schedulingPeriod.label}</strong>
              <span>{data.schedulingPeriod.startDate} - {data.schedulingPeriod.endDate}</span>
            </div>
          ) : null}
          {calendarDates.map((workDate) => {
            const requests = availabilityByDate.get(workDate) ?? [];
            const shifts = shiftsByDate.get(workDate) ?? [];
            const day = getBusinessDay(businessHours, workDate);
            const coverageSummary = getCoverageSummary(requests, shifts, day, approvalDrafts);
            const businessInterval = getBusinessInterval(day.open, day.close);
            const shiftIntervals = shifts.map((shift) => getShiftInterval(shift.scheduledStart, shift.scheduledEnd, businessInterval));
            const requestIntervals = requests.map((request) => {
              const window = getShiftWindow(request);
              const draft = approvalDrafts[request.id] ?? { approvedStart: window?.availableStart ?? "", approvedEnd: window?.availableEnd ?? "" };
              return getShiftInterval(draft.approvedStart, draft.approvedEnd, businessInterval);
            });
            const timelineInterval = getTimelineInterval(businessInterval, [...shiftIntervals, ...requestIntervals]);
            return (
              <article className="panel shift-coverage-card" id={`shift-date-${workDate}`} key={workDate}>
                <div className="shift-coverage-head">
                  <div>
                    <h3>{formatWorkDate(workDate)}</h3>
                    <p>営業時間 {day.closed ? "休業" : `${day.open}-${day.close}`} / 希望 {requests.length} 件 / 確定 {shifts.length} 件</p>
                  </div>
                  <strong>{coverageSummary}</strong>
                </div>
                {!day.closed ? (
                  <div className="shift-coverage-timeline" aria-label={`${workDate} の希望シフト`}>
                    <div className="shift-coverage-axis">
                      <span>{formatTimelineMinute(timelineInterval.start)}</span>
                      <span>{formatTimelineMinute(timelineInterval.end)}</span>
                    </div>
                    {shifts.map((shift, shiftIndex) => (
                      <div className="shift-coverage-row is-approved is-scheduled" key={`shift-${shift.id}`}>
                        <div className="shift-coverage-person">
                          <div className="shift-coverage-person-heading">
                            <strong>{shift.employeeName}</strong>
                            <ShiftMonthStats stats={monthlyShiftStatsByEmployee.get(shift.employeeId)} />
                          </div>
                          <span>確定 {shift.scheduledStart ?? "--:--"}-{shift.scheduledEnd ?? "--:--"}</span>
                        </div>
                        <div className="shift-coverage-bar-track">
                          <span className="shift-coverage-business-line" style={getTimelineBarStyle(businessInterval, timelineInterval)} />
                          <span
                            className="shift-coverage-approved-bar"
                            style={getTimelineBarStyle(shiftIntervals[shiftIndex] ?? null, timelineInterval)}
                          />
                        </div>
                        <div className="shift-coverage-controls">
                          <strong>確定済み</strong>
                        </div>
                      </div>
                    ))}
                    {requests.map((request, requestIndex) => {
                      const window = getShiftWindow(request);
                      const draft = approvalDrafts[request.id] ?? { approvedStart: window?.availableStart ?? "", approvedEnd: window?.availableEnd ?? "" };
                      const adjusted = draft.approvedStart !== (window?.availableStart ?? "") || draft.approvedEnd !== (window?.availableEnd ?? "");
                      const isEditingApproved = request.status === "approved" && editingApprovedRequestId === request.id;
                      const requestedInterval = getShiftInterval(window?.availableStart, window?.availableEnd, businessInterval);
                      return (
                        <div className={`shift-coverage-row is-${request.status}`} id={`shift-request-${request.id}`} key={request.id}>
                          <div className="shift-coverage-person">
                            <div className="shift-coverage-person-heading">
                              <strong>{request.employeeName}</strong>
                              <ShiftMonthStats stats={monthlyShiftStatsByEmployee.get(request.employeeId)} />
                            </div>
                            <span>希望 {window?.availableStart ?? "--:--"}-{window?.availableEnd ?? "--:--"}</span>
                            <small>提出 {formatDateTime(request.createdAt)}</small>
                          </div>
                          <div className="shift-coverage-bar-track">
                            <span className="shift-coverage-business-line" style={getTimelineBarStyle(businessInterval, timelineInterval)} />
                            <span
                              className="shift-coverage-bar"
                              style={getTimelineBarStyle(requestedInterval, timelineInterval)}
                            />
                            <span
                              className={`shift-coverage-approved-bar${adjusted ? " is-adjusted" : ""}`}
                              style={getTimelineBarStyle(requestIntervals[requestIndex] ?? null, timelineInterval)}
                            />
                          </div>
                          <div className="shift-coverage-controls">
                            <input
                              type="time"
                              value={draft.approvedStart}
                              disabled={request.status !== "open" && !isEditingApproved}
                              onChange={(event) => setApprovalDrafts((current) => ({ ...current, [request.id]: { ...draft, approvedStart: event.target.value } }))}
                            />
                            <input
                              type="time"
                              value={draft.approvedEnd}
                              disabled={request.status !== "open" && !isEditingApproved}
                              onChange={(event) => setApprovalDrafts((current) => ({ ...current, [request.id]: { ...draft, approvedEnd: event.target.value } }))}
                            />
                            {request.status === "open" ? (
                              <>
                                <button className="primary-button" type="button" onClick={() => reviewRequest(request, true, "", draft)}>承認</button>
                                <button className="secondary-button" type="button" onClick={() => reviewRequest(request, false)}>却下</button>
                              </>
                            ) : isEditingApproved ? (
                              <>
                                <button className="primary-button" type="button" onClick={() => reviewRequest(request, true, "", draft)}>変更を保存</button>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => {
                                    setApprovalDrafts((current) => ({
                                      ...current,
                                      [request.id]: {
                                        approvedStart: request.approvedStart ?? window?.availableStart ?? "",
                                        approvedEnd: request.approvedEnd ?? window?.availableEnd ?? ""
                                      }
                                    }));
                                    setEditingApprovedRequestId("");
                                  }}
                                >
                                  キャンセル
                                </button>
                              </>
                            ) : request.status === "approved" ? (
                              <>
                                <strong>承認済み</strong>
                                <button className="secondary-button" type="button" onClick={() => setEditingApprovedRequestId(request.id)}>変更</button>
                              </>
                            ) : (
                              <strong>{statusLabels[request.status]}</strong>
                            )}
                          </div>
                          {adjusted && (request.status === "open" || isEditingApproved) ? <small>保存時にスタッフへ調整後の時間を通知します。</small> : null}
                        </div>
                      );
                    })}
                    {!requests.length && !shifts.length ? <p className="empty-state-text">この日の希望シフトはまだありません。</p> : null}
                  </div>
                ) : (
                  <p className="empty-state-text">この日は休業日です。承認前に営業時間または対象日を確認してください。</p>
                )}
              </article>
            );
          })}
        </section>

        <section className="shift-request-list">
          {otherRequests.map((request) => (
            <article className={`panel shift-request-card is-${request.status}`} key={request.id}>
              <div className="shift-request-card-head">
                <div>
                  <span className="shift-request-type">{typeLabels[request.requestType]}</span>
                  <h3>{request.title || typeLabels[request.requestType]}</h3>
                  <p>{request.employeeName}・{request.workDate ?? "日付未設定"}・{formatDateTime(request.createdAt)}</p>
                </div>
                <strong>{statusLabels[request.status]}</strong>
              </div>

              <div className="shift-request-detail-grid">
                <div>
                  <span>希望内容</span>
                  {request.windows.length ? request.windows.map((window) => (
                    <strong key={window.id}>{window.workDate} {window.availableStart ?? "--:--"}-{window.availableEnd ?? "--:--"}</strong>
                  )) : <strong>{request.workDate ?? "-"}</strong>}
                </div>
                <div>
                  <span>メモ</span>
                  <strong>{request.note || "-"}</strong>
                </div>
                <div>
                  <span>確認</span>
                  <strong>{request.reviewedByName ? `${request.reviewedByName}・${formatDateTime(request.reviewedAt)}` : "未確認"}</strong>
                </div>
              </div>

              {request.requestType === "swap" ? (
                <div className="shift-candidate-list">
                  <span>交代候補</span>
                  {request.candidates.length ? request.candidates.map((candidate) => (
                    <div className="shift-candidate-row" key={candidate.id}>
                      <strong>{candidate.employeeName}</strong>
                      <small>{candidate.note || "メモなし"}・{candidate.status}</small>
                      {request.status === "open" ? (
                        <button className="secondary-button" type="button" onClick={() => reviewRequest(request, true, candidate.id)}>この候補で承認</button>
                      ) : null}
                    </div>
                  )) : <p className="empty-state-text">まだ応募はありません。</p>}
                </div>
              ) : null}

              {request.messages.length ? (
                <div className="shift-message-list">
                  {request.messages.map((item) => (
                    <p key={item.id}><strong>{item.employeeName ?? "スタッフ"}</strong> {item.message}</p>
                  ))}
                </div>
              ) : null}

              {request.status === "open" && request.requestType !== "swap" ? (
                <div className="shift-request-actions">
                  <button className="primary-button" type="button" onClick={() => reviewRequest(request, true)}>承認</button>
                  <button className="secondary-button" type="button" onClick={() => reviewRequest(request, false)}>却下</button>
                </div>
              ) : null}
              {request.status === "open" && request.requestType === "swap" && request.candidates.length === 0 ? (
                <div className="shift-request-actions">
                  <button className="secondary-button" type="button" onClick={() => reviewRequest(request, false)}>募集を却下</button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
