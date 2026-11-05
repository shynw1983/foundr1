import { dispatchGoogleHours } from '../../../../lib/google-business-hours-dispatch';
import { requireGoogleBusinessAccess } from "../../../../lib/google-business-access";
import { confirmSchedulePeriod, reconcileScheduleMutation } from "../../../../lib/shift-confirmation";
import { schedulePeriod } from "../../../../lib/shift-confirmation-policy";
import { getShiftRequestDefaultTimes } from "../../../../lib/store-business-hours";
import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";
import { getJstDateLabel, getJstMonthLabel } from "../../../../lib/timecard";
import { createOsNotification } from "../../../../lib/web-push";
import type { EmployeeSession } from "../../../../lib/auth";

type ShiftRequestBody = {
  action?: string;
  storeId?: string;
  shiftId?: string;
  month?: string;
  period?: string;
  requestId?: string;
  requestVersion?: string;
  submissionStart?: string;
  requestType?: string;
  employeeId?: string;
  workDate?: string;
  availableStart?: string;
  availableEnd?: string;
  title?: string;
  note?: string;
  targetShiftId?: string;
  candidateId?: string;
  message?: string;
  reviewNote?: string;
  approvedStart?: string;
  approvedEnd?: string;
  entries?: Array<{
    workDate?: string;
    preference?: string;
    availableStart?: string;
    availableEnd?: string;
    note?: string;
  }>;
};

const managerRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const requestTypes = new Set(["availability", "day_off", "swap"]);

function isValidWorkDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeTimeValue(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return /^\d{2}:\d{2}$/.test(text) ? text : null;
}

function getMonthRange(month: string) {
  const normalized = /^\d{4}-\d{2}$/.test(month) ? month : getJstMonthLabel();
  const [year, monthText] = normalized.split("-").map(Number);
  const endDate = new Date(Date.UTC(year, monthText, 1));
  return {
    month: normalized,
    startDate: `${normalized}-01`,
    endDate: `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, "0")}-01`
  };
}

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getJstNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute"))
  };
}

function clampDeadlineDay(value: unknown, fallback: number) {
  const day = Math.round(Number(value));
  return Number.isFinite(day) ? Math.max(1, Math.min(28, day)) : fallback;
}

function normalizeDeadlineTime(value: unknown) {
  const text = String(value ?? "23:59").slice(0, 5);
  return /^\d{2}:\d{2}$/.test(text) ? text : "23:59";
}

function getShiftSubmissionPeriod(store: { firstHalfDeadlineDay?: unknown; secondHalfDeadlineDay?: unknown; deadlineTime?: unknown } | null) {
  const now = getJstNowParts();
  const firstHalfDeadlineDay = clampDeadlineDay(store?.firstHalfDeadlineDay, 25);
  const secondHalfDeadlineDay = clampDeadlineDay(store?.secondHalfDeadlineDay, 10);
  const deadlineTime = normalizeDeadlineTime(store?.deadlineTime);
  const [deadlineHour, deadlineMinute] = deadlineTime.split(":").map(Number);
  const nowComparable = Date.UTC(now.year, now.month - 1, now.day, now.hour, now.minute);
  const candidates: Array<{
    periodType: "first_half" | "second_half";
    startDate: string;
    endDate: string;
    deadlineDate: string;
    deadlineAt: string;
    comparable: number;
    label: string;
  }> = [];

  for (let offset = 0; offset < 4; offset += 1) {
    const targetMonthStart = new Date(Date.UTC(now.year, now.month - 1 + offset, 1));
    const targetYear = targetMonthStart.getUTCFullYear();
    const targetMonth = targetMonthStart.getUTCMonth();
    const monthLabel = `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`;
    const firstDeadlineDate = new Date(Date.UTC(targetYear, targetMonth - 1, firstHalfDeadlineDay, deadlineHour, deadlineMinute));
    const secondDeadlineDate = new Date(Date.UTC(targetYear, targetMonth, secondHalfDeadlineDay, deadlineHour, deadlineMinute));
    const nextMonthStart = new Date(Date.UTC(targetYear, targetMonth + 1, 1));

    candidates.push({
      periodType: "first_half",
      startDate: `${monthLabel}-01`,
      endDate: `${monthLabel}-15`,
      deadlineDate: formatDateKey(firstDeadlineDate),
      deadlineAt: `${formatDateKey(firstDeadlineDate)} ${deadlineTime}`,
      comparable: firstDeadlineDate.getTime(),
      label: `${monthLabel} 前半`
    });
    candidates.push({
      periodType: "second_half",
      startDate: `${monthLabel}-16`,
      endDate: formatDateKey(new Date(nextMonthStart.getTime() - 24 * 60 * 60 * 1000)),
      deadlineDate: formatDateKey(secondDeadlineDate),
      deadlineAt: `${formatDateKey(secondDeadlineDate)} ${deadlineTime}`,
      comparable: secondDeadlineDate.getTime(),
      label: `${monthLabel} 後半`
    });
  }

  return candidates
    .filter((candidate) => candidate.comparable >= nowComparable)
    .sort((left, right) => left.comparable - right.comparable)[0] ?? candidates[candidates.length - 1];
}

function getCurrentSchedulingPeriod() {
  const now = getJstNowParts();
  const targetYear = now.year;
  const targetMonth = now.month - 1;
  if (now.day < 15) {
    const monthLabel = `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`;
    const nextMonthStart = new Date(Date.UTC(targetYear, targetMonth + 1, 1));
    return {
      key: `${monthLabel}-second_half`,
      periodType: "second_half",
      startDate: `${monthLabel}-16`,
      endDate: formatDateKey(new Date(nextMonthStart.getTime() - 24 * 60 * 60 * 1000)),
      label: `${monthLabel} 後半`
    };
  }

  const nextMonthStart = new Date(Date.UTC(targetYear, targetMonth + 1, 1));
  const nextMonthLabel = `${nextMonthStart.getUTCFullYear()}-${String(nextMonthStart.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    key: `${nextMonthLabel}-first_half`,
    periodType: "first_half",
    startDate: `${nextMonthLabel}-01`,
    endDate: `${nextMonthLabel}-15`,
    label: `${nextMonthLabel} 前半`
  };
}

function getSchedulingPeriod(value: string | null) {
  const match = /^(\d{4})-(\d{2})-(first_half|second_half)$/.exec(value ?? "");
  if (!match) return getCurrentSchedulingPeriod();

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return getCurrentSchedulingPeriod();

  const monthLabel = `${match[1]}-${match[2]}`;
  const periodType = match[3] as "first_half" | "second_half";
  if (periodType === "first_half") {
    return {
      key: `${monthLabel}-first_half`,
      periodType,
      startDate: `${monthLabel}-01`,
      endDate: `${monthLabel}-15`,
      label: `${monthLabel} 前半`
    };
  }

  const nextMonthStart = new Date(Date.UTC(year, month, 1));
  return {
    key: `${monthLabel}-second_half`,
    periodType,
    startDate: `${monthLabel}-16`,
    endDate: formatDateKey(new Date(nextMonthStart.getTime() - 24 * 60 * 60 * 1000)),
    label: `${monthLabel} 後半`
  };
}

function enumerateDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current.getTime() <= end.getTime()) {
    dates.push(formatDateKey(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

async function getEmployeeWorkStoreIds(employeeId: string) {
  const rows = await sql`
    select employee_work_stores.store_id::text as "storeId"
    from employee_work_stores
    join stores on stores.id = employee_work_stores.store_id
    where employee_work_stores.employee_id = ${employeeId}
      and stores.status = 'active'
    order by stores.name
  `;
  return rows.map((row) => String(row.storeId));
}

async function getShiftRequestStoreScope(session: EmployeeSession) {
  if (session.role === "staff") {
    return { allStores: false, storeIds: await getEmployeeWorkStoreIds(session.id) };
  }
  return getSessionStoreScope(session);
}

async function getVisibleStores(session: EmployeeSession) {
  const scope = await getShiftRequestStoreScope(session);
  if (scope.allStores) {
    return sql`
      select id::text, name, business_hours as "businessHours"
      from stores
      where status = 'active'
      order by name
    `;
  }
  if (!scope.storeIds.length) return [];
  return sql`
    select id::text, name, business_hours as "businessHours"
    from stores
    where status = 'active'
      and id::text = any(${scope.storeIds})
    order by name
  `;
}

async function getEmployeeVisibleStores(employeeId: string) {
  const storeIds = await getEmployeeWorkStoreIds(employeeId);
  if (!storeIds.length) return [];
  return sql`
    select id::text, name, business_hours as "businessHours"
    from stores
    where status = 'active'
      and id::text = any(${storeIds})
    order by name
  `;
}

async function canUseStore(session: EmployeeSession, storeId: string) {
  if (session.role === "staff") {
    const storeIds = await getEmployeeWorkStoreIds(session.id);
    return storeIds.includes(storeId);
  }
  return canAccessStore(session, storeId);
}

async function canWorkAtStore(employeeId: string, storeId: string) {
  const rows = await sql`
    select employees.id::text
    from employees
    join employee_work_stores on employee_work_stores.employee_id = employees.id
    where employees.id::text = ${employeeId}
      and employee_work_stores.store_id::text = ${storeId}
      and employees.status = 'active'
      and employees.staff_category <> 'device'
    limit 1
  `;
  return Boolean(rows[0]);
}

async function notifyStoreManagers(storeId: string, title: string, message: string, href: string) {
  const managers = await sql`
    select distinct employees.id::text
    from employees
    left join employee_scopes on employee_scopes.employee_id = employees.id
    where employees.status = 'active'
      and (
        employees.role in ('owner', 'manager')
        or (
          employees.role in ('store_owner', 'store_manager')
          and employee_scopes.scope_type = 'store'
          and employee_scopes.store_id::text = ${storeId}
        )
      )
  `;
  await Promise.all(managers.map((manager) => createOsNotification({
    employeeId: String(manager.id),
    type: "timecard_shift_request",
    title,
    message,
    href
  })));
}

async function notifyEmployee(employeeId: string, title: string, message: string, href: string, sendPush = true) {
  await createOsNotification({
    employeeId,
    type: "timecard_shift_request",
    title,
    message,
    href,
    sendPush
  });
}

export const maxDuration = 120;

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  const selfOnly = url.searchParams.get("selfOnly") === "1";
  const canManageRequestScope = managerRoles.has(session.role) && !selfOnly;
  const stores = selfOnly ? await getEmployeeVisibleStores(session.id) : await getVisibleStores(session);
  const visibleStoreIds = stores.map((store) => String(store.id));
  const requestedStoreId = url.searchParams.get("storeId");
  const selectedStoreId = requestedStoreId && visibleStoreIds.includes(requestedStoreId)
    ? requestedStoreId
    : visibleStoreIds[0] ?? "";

  const employees = selectedStoreId ? await sql`
    select employees.id::text, employees.name, employees.role
    from employees
    join employee_work_stores on employee_work_stores.employee_id = employees.id
    where employee_work_stores.store_id::text = ${selectedStoreId}
      and employees.status = 'active'
      and employees.staff_category <> 'device'
    order by employees.name
  ` : [];

  const shiftSettingsRows = selectedStoreId ? await sql`
    select
      business_hours as "businessHours",
      shift_request_start_offset_minutes as "startOffset",
      shift_request_end_offset_minutes as "endOffset",
      coalesce(shift_first_half_submission_deadline_day, 25)::int as "firstHalfDeadlineDay",
      coalesce(shift_second_half_submission_deadline_day, 10)::int as "secondHalfDeadlineDay",
      to_char(coalesce(shift_submission_deadline_time, '23:59'::time), 'HH24:MI') as "deadlineTime"
    from stores
    where id::text = ${selectedStoreId}
    limit 1
  ` : [];
  const submissionPeriod = getShiftSubmissionPeriod(shiftSettingsRows[0] ?? null);
  const submissionDates = enumerateDates(submissionPeriod.startDate, submissionPeriod.endDate);
  const schedulingPeriod = getSchedulingPeriod(url.searchParams.get("period"));
  const month = schedulingPeriod.startDate.slice(0, 7);
  const monthRange = getMonthRange(month);
  const requestedShiftMonthValue = url.searchParams.get("month") ?? "";
  const requestedShiftMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedShiftMonthValue)
    ? requestedShiftMonthValue
    : getJstMonthLabel();
  const usesMonthlyShiftRange = selfOnly && url.searchParams.get("shiftRange") === "month";
  const requestedShiftMonthRange = getMonthRange(requestedShiftMonth);
  const requestedShiftMonthEnd = new Date(`${requestedShiftMonthRange.endDate}T00:00:00Z`);
  requestedShiftMonthEnd.setUTCDate(requestedShiftMonthEnd.getUTCDate() - 1);
  const myShiftsPeriod = usesMonthlyShiftRange ? {
    label: `${requestedShiftMonth} 月`,
    startDate: requestedShiftMonthRange.startDate,
    endDate: formatDateKey(requestedShiftMonthEnd)
  } : schedulingPeriod;
  const schedulingDates = enumerateDates(schedulingPeriod.startDate, schedulingPeriod.endDate);
  const queryStartDate = schedulingPeriod.startDate;
  // These are SQL calendar dates; UTC arithmetic must not shift the final date into the previous day.
  const schedulingEndExclusive = new Date(`${schedulingPeriod.endDate}T00:00:00Z`);
  schedulingEndExclusive.setUTCDate(schedulingEndExclusive.getUTCDate() + 1);
  const queryEndDate = formatDateKey(schedulingEndExclusive);

  const requests = selectedStoreId ? await sql`
    select
      timecard_shift_requests.id::text,
      timecard_shift_requests.request_type as "requestType",
      timecard_shift_requests.status,
      timecard_shift_requests.target_shift_id::text as "targetShiftId",
      to_char(timecard_shift_requests.work_date, 'YYYY-MM-DD') as "workDate",
      timecard_shift_requests.title,
      timecard_shift_requests.note,
      timecard_shift_requests.review_note as "reviewNote",
      timecard_shift_requests.created_at as "createdAt",
      timecard_shift_requests.updated_at::text as "requestVersion",
      timecard_shift_requests.reviewed_at as "reviewedAt",
      employees.id::text as "employeeId",
      employees.name as "employeeName",
      reviewer.name as "reviewedByName",
      (
        select to_char(approved_shift.scheduled_start, 'HH24:MI')
        from timecard_shifts approved_shift
        where approved_shift.store_id = timecard_shift_requests.store_id
          and approved_shift.employee_id = timecard_shift_requests.employee_id
          and approved_shift.work_date = timecard_shift_requests.work_date
          and (
            coalesce(approved_shift.note, '') = '希望シフト承認'
            or coalesce(approved_shift.note, '') like '希望 % から調整'
          )
        order by approved_shift.updated_at desc
        limit 1
      ) as "approvedStart",
      (
        select to_char(approved_shift.scheduled_end, 'HH24:MI')
        from timecard_shifts approved_shift
        where approved_shift.store_id = timecard_shift_requests.store_id
          and approved_shift.employee_id = timecard_shift_requests.employee_id
          and approved_shift.work_date = timecard_shift_requests.work_date
          and (
            coalesce(approved_shift.note, '') = '希望シフト承認'
            or coalesce(approved_shift.note, '') like '希望 % から調整'
          )
        order by approved_shift.updated_at desc
        limit 1
      ) as "approvedEnd",
      coalesce(
        json_agg(distinct jsonb_build_object(
          'id', timecard_shift_request_windows.id::text,
          'workDate', to_char(timecard_shift_request_windows.work_date, 'YYYY-MM-DD'),
          'availableStart', to_char(timecard_shift_request_windows.available_start, 'HH24:MI'),
          'availableEnd', to_char(timecard_shift_request_windows.available_end, 'HH24:MI'),
          'preference', timecard_shift_request_windows.preference,
          'note', timecard_shift_request_windows.note
        )) filter (where timecard_shift_request_windows.id is not null),
        '[]'::json
      ) as windows,
      coalesce(
        json_agg(distinct jsonb_build_object(
          'id', timecard_shift_request_candidates.id::text,
          'employeeId', timecard_shift_request_candidates.employee_id::text,
          'employeeName', candidate_employees.name,
          'status', timecard_shift_request_candidates.status,
          'note', timecard_shift_request_candidates.note,
          'createdAt', timecard_shift_request_candidates.created_at
        )) filter (where timecard_shift_request_candidates.id is not null),
        '[]'::json
      ) as candidates,
      coalesce(
        json_agg(distinct jsonb_build_object(
          'id', timecard_shift_request_messages.id::text,
          'employeeId', timecard_shift_request_messages.employee_id::text,
          'employeeName', message_employees.name,
          'message', timecard_shift_request_messages.message,
          'createdAt', timecard_shift_request_messages.created_at
        )) filter (where timecard_shift_request_messages.id is not null),
        '[]'::json
      ) as messages
    from timecard_shift_requests
    join employees on employees.id = timecard_shift_requests.employee_id
    left join employees reviewer on reviewer.id = timecard_shift_requests.reviewed_by
    left join timecard_shift_request_windows on timecard_shift_request_windows.request_id = timecard_shift_requests.id
    left join timecard_shift_request_candidates on timecard_shift_request_candidates.request_id = timecard_shift_requests.id
    left join employees candidate_employees on candidate_employees.id = timecard_shift_request_candidates.employee_id
    left join timecard_shift_request_messages on timecard_shift_request_messages.request_id = timecard_shift_requests.id
    left join employees message_employees on message_employees.id = timecard_shift_request_messages.employee_id
    where timecard_shift_requests.store_id::text = ${selectedStoreId}
      and (
        (
          timecard_shift_requests.work_date >= ${queryStartDate}::date
          and timecard_shift_requests.work_date < ${queryEndDate}::date
        )
        or exists (
          select 1
          from timecard_shift_request_windows period_windows
          where period_windows.request_id = timecard_shift_requests.id
            and period_windows.work_date >= ${queryStartDate}::date
            and period_windows.work_date < ${queryEndDate}::date
        )
      )
      and (
        ${canManageRequestScope}
        or timecard_shift_requests.employee_id::text = ${session.id}
        or (
          ${!selfOnly}
          and (
            timecard_shift_request_candidates.employee_id::text = ${session.id}
            or (timecard_shift_requests.request_type = 'swap' and timecard_shift_requests.status = 'open')
          )
        )
      )
    group by timecard_shift_requests.id, employees.id, reviewer.name
    order by timecard_shift_requests.created_at desc
  ` : [];

  const monthlyShiftStats = selectedStoreId ? await sql`
    select distinct
      employee_work_stores.employee_id::text as "employeeId",
      (
        select count(distinct confirmed_shifts.work_date)::int
        from timecard_shifts confirmed_shifts
        where confirmed_shifts.store_id::text = ${selectedStoreId}
          and confirmed_shifts.employee_id = employee_work_stores.employee_id
          and confirmed_shifts.work_date >= ${monthRange.startDate}::date
          and confirmed_shifts.work_date < ${monthRange.endDate}::date
      ) as "confirmedDays",
      (
        select count(distinct rejected_requests.work_date)::int
        from timecard_shift_requests rejected_requests
        where rejected_requests.store_id::text = ${selectedStoreId}
          and rejected_requests.employee_id = employee_work_stores.employee_id
          and rejected_requests.request_type = 'availability'
          and rejected_requests.status = 'rejected'
          and rejected_requests.work_date >= ${monthRange.startDate}::date
          and rejected_requests.work_date < ${monthRange.endDate}::date
      ) as "rejectedDays"
    from employee_work_stores
    where employee_work_stores.store_id::text = ${selectedStoreId}
      and (${canManageRequestScope} or employee_work_stores.employee_id::text = ${session.id})
  ` : [];

  const myShifts = selectedStoreId ? await sql`
    select
      timecard_shifts.id::text,
      timecard_shifts.employee_id::text as "employeeId",
      to_char(timecard_shifts.work_date, 'YYYY-MM-DD') as "workDate",
      to_char(timecard_shifts.scheduled_start, 'HH24:MI') as "scheduledStart",
      to_char(timecard_shifts.scheduled_end, 'HH24:MI') as "scheduledEnd",
      employees.name as "employeeName"
    from timecard_shifts
    join employees on employees.id = timecard_shifts.employee_id
    where timecard_shifts.store_id::text = ${selectedStoreId}
      and timecard_shifts.work_date >= ${usesMonthlyShiftRange ? requestedShiftMonthRange.startDate : queryStartDate}::date
      and timecard_shifts.work_date < ${usesMonthlyShiftRange ? requestedShiftMonthRange.endDate : queryEndDate}::date
      and (${canManageRequestScope} or timecard_shifts.employee_id::text = ${session.id})
    order by timecard_shifts.work_date asc, timecard_shifts.scheduled_start asc
  ` : [];

  const nextShift = selectedStoreId && selfOnly ? await sql`
    select
      timecard_shifts.id::text,
      to_char(timecard_shifts.work_date, 'YYYY-MM-DD') as "workDate",
      to_char(timecard_shifts.scheduled_start, 'HH24:MI') as "scheduledStart",
      to_char(timecard_shifts.scheduled_end, 'HH24:MI') as "scheduledEnd",
      employees.name as "employeeName"
    from timecard_shifts
    join employees on employees.id = timecard_shifts.employee_id
    where timecard_shifts.store_id::text = ${selectedStoreId}
      and timecard_shifts.employee_id::text = ${session.id}
      and timecard_shifts.work_date >= (${getJstDateLabel(new Date())}::date - interval '1 day')
      and timecard_shifts.scheduled_start is not null
      and (
        case
          when timecard_shifts.scheduled_end is null then
            timecard_shifts.work_date
            + timecard_shifts.scheduled_start
            + case when timecard_shifts.scheduled_start < '06:00'::time then interval '1 day' else interval '0 day' end
          else
            timecard_shifts.work_date
            + timecard_shifts.scheduled_end
            + case when timecard_shifts.scheduled_start < '06:00'::time then interval '1 day' else interval '0 day' end
            + case when timecard_shifts.scheduled_end <= timecard_shifts.scheduled_start then interval '1 day' else interval '0 day' end
        end
      ) >= (now() at time zone 'Asia/Tokyo')
    order by (
      timecard_shifts.work_date
      + timecard_shifts.scheduled_start
      + case when timecard_shifts.scheduled_start < '06:00'::time then interval '1 day' else interval '0 day' end
    ) asc
    limit 1
  ` : [];

  const publications = selectedStoreId ? await sql`
    select
      timecard_shift_publications.id::text,
      timecard_shift_publications.schedule_month as "scheduleMonth",
      timecard_shift_publications.note,
      timecard_shift_publications.published_at as "publishedAt",
      employees.name as "publishedByName"
    from timecard_shift_publications
    left join employees on employees.id = timecard_shift_publications.published_by
    where timecard_shift_publications.store_id::text = ${selectedStoreId}
      and timecard_shift_publications.schedule_month = ${month}
    order by timecard_shift_publications.published_at desc
  ` : [];

  return Response.json({
    month,
    stores,
    selectedStoreId,
    currentEmployeeId: session.id,
    currentEmployeeRole: session.role,
    canManageRequests: canManageRequestScope,
    employees: selfOnly ? employees.filter((employee) => String(employee.id) === session.id) : employees,
    submissionPeriod,
    submissionDates,
    submissionDefaults: submissionDates.map((workDate) => ({
      workDate,
      ...getShiftRequestDefaultTimes(shiftSettingsRows[0]?.businessHours, workDate, shiftSettingsRows[0]?.startOffset, shiftSettingsRows[0]?.endOffset)
    })),
    schedulingPeriod,
    myShiftsPeriod,
    schedulingDates,
    requests,
    monthlyShiftStats,
    myShifts,
    nextShift: nextShift[0] ?? null,
    publications
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as ShiftRequestBody;
  const action = String(body.action ?? "create_shift_request");
  const storeId = String(body.storeId ?? "");
  if (!storeId || !await canUseStore(session, storeId)) {
    return Response.json({ error: "この店舗を操作する権限がありません。" }, { status: 403 });
  }

  if (action === "update_confirmed_shift") {
    const changeAccess = await requireGoogleBusinessAccess(storeId);
    if (changeAccess.error) return changeAccess.error;
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "このリクエストは許可されていません。" }, { status: 403 });
    if (!managerRoles.has(session.role)) {
      return Response.json({ error: "確定シフトを変更する権限がありません。" }, { status: 403 });
    }
    const shiftId = String(body.shiftId ?? "");
    const scheduledStart = normalizeTimeValue(body.approvedStart);
    const scheduledEnd = normalizeTimeValue(body.approvedEnd);
    if (!shiftId || !scheduledStart || !scheduledEnd) {
      return Response.json({ error: "変更する開始・終了時刻を入力してください。" }, { status: 400 });
    }
    const shiftRows = await sql`
      select
        timecard_shifts.id::text,
        timecard_shifts.employee_id::text as "employeeId",
        to_char(timecard_shifts.work_date, 'YYYY-MM-DD') as "workDate",
        to_char(timecard_shifts.scheduled_start, 'HH24:MI') as "scheduledStart",
        to_char(timecard_shifts.scheduled_end, 'HH24:MI') as "scheduledEnd"
      from timecard_shifts
      where timecard_shifts.id::text = ${shiftId}
        and timecard_shifts.store_id::text = ${storeId}
      limit 1
    `;
    const shift = shiftRows[0];
    if (!shift) return Response.json({ error: "確定シフトが見つかりません。" }, { status: 404 });

    await sql`
      update timecard_shifts
      set scheduled_start = ${scheduledStart}::time,
          scheduled_end = ${scheduledEnd}::time,
          updated_at = now()
      where id::text = ${shiftId}
        and store_id::text = ${storeId}
    `;
    const scheduleSync = await reconcileScheduleMutation(storeId, [String(shift.workDate)], session.id);
    dispatchGoogleHours(storeId, scheduleSync.queued);
    await notifyEmployee(
      String(shift.employeeId),
      "確定シフトが変更されました",
      `${String(shift.workDate)} の確定シフトが ${scheduledStart}-${scheduledEnd} に変更されました。`,
      "/store/timecard"
    );
    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.shift.updated",
      targetType: "timecard_shift",
      targetId: shiftId,
      metadata: {
        storeId,
        workDate: String(shift.workDate),
        previousStart: String(shift.scheduledStart ?? ""),
        previousEnd: String(shift.scheduledEnd ?? ""),
        scheduledStart,
        scheduledEnd
      },
      request
    });
    return Response.json({ ok: true, scheduleSync });
  }

  if (action === "create_shift_request") {
    const requestType = String(body.requestType ?? "");
    if (!requestTypes.has(requestType)) {
      return Response.json({ error: "申請種別を選択してください。" }, { status: 400 });
    }
    const employeeId = managerRoles.has(session.role) && body.employeeId ? String(body.employeeId) : session.id;
    if (!await canWorkAtStore(employeeId, storeId)) {
      return Response.json({ error: "この従業員は選択した店舗のシフト対象ではありません。" }, { status: 403 });
    }
    const workDate = String(body.workDate ?? "");
    if (!isValidWorkDate(workDate)) {
      return Response.json({ error: "日付を選択してください。" }, { status: 400 });
    }
    const availableStart = normalizeTimeValue(body.availableStart);
    const availableEnd = normalizeTimeValue(body.availableEnd);
    if (requestType === "availability" && (!availableStart || !availableEnd)) {
      return Response.json({ error: "希望シフトの開始・終了時刻を入力してください。" }, { status: 400 });
    }
    const targetShiftId = requestType === "swap" ? String(body.targetShiftId ?? "") : "";

    const inserted = await sql`
      insert into timecard_shift_requests (
        store_id,
        employee_id,
        request_type,
        target_shift_id,
        work_date,
        title,
        note,
        created_by,
        updated_at
      )
      values (
        ${storeId},
        ${employeeId},
        ${requestType},
        ${targetShiftId || null},
        ${workDate}::date,
        ${requestType === "day_off" ? "休み希望" : String(body.title ?? "").trim() || (requestType === "availability" ? "希望シフト" : "交代募集")},
        ${String(body.note ?? "").trim() || null},
        ${session.id},
        now()
      )
      returning id::text
    `;
    const requestId = String(inserted[0]?.id ?? "");
    await sql`
      insert into timecard_shift_request_windows (
        request_id,
        work_date,
        available_start,
        available_end,
        preference,
        note
      )
      values (
        ${requestId},
        ${workDate}::date,
        ${availableStart ? `${availableStart}:00` : null}::time,
        ${availableEnd ? `${availableEnd}:00` : null}::time,
        ${requestType === "day_off" ? "unavailable" : "available"},
        ${String(body.note ?? "").trim() || null}
      )
    `;

    await notifyStoreManagers(storeId, "希望シフトが届きました", `${session.name} から ${workDate} の希望シフトがあります。`, "/os/timecard/requests");
    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.shift_request.created",
      targetType: "timecard_shift_request",
      targetId: requestId,
      metadata: { storeId, employeeId, requestType, workDate },
      request
    });
    return Response.json({ ok: true, id: requestId });
  }

  if (action === "create_availability_period") {
    const employeeId = session.id;
    if (!await canWorkAtStore(employeeId, storeId)) {
      return Response.json({ error: "この店舗のシフト対象ではありません。" }, { status: 403 });
    }
    const settingsRows = await sql`
      select
        coalesce(shift_first_half_submission_deadline_day, 25)::int as "firstHalfDeadlineDay",
        coalesce(shift_second_half_submission_deadline_day, 10)::int as "secondHalfDeadlineDay",
        to_char(coalesce(shift_submission_deadline_time, '23:59'::time), 'HH24:MI') as "deadlineTime"
      from stores
      where id::text = ${storeId}
      limit 1
    `;
    const submissionPeriod = getShiftSubmissionPeriod(settingsRows[0] ?? null);
    if (body.submissionStart !== submissionPeriod.startDate) {
      return Response.json({ error: "提出期間が変わりました。画面を再読み込みしてください。" }, { status: 409 });
    }
    const dateList = enumerateDates(submissionPeriod.startDate, submissionPeriod.endDate);
    const allowedDates = new Set(dateList);
    if (!Array.isArray(body.entries)) return Response.json({ error: "希望シフトを確認してください。" }, { status: 400 });
    const entries = body.entries.map(entry => ({
      date: String(entry.workDate ?? ""),
      preference: entry.preference,
      start_time: normalizeTimeValue(entry.availableStart),
      end_time: normalizeTimeValue(entry.availableEnd),
      note: String(entry.note ?? "").trim() || null,
    }));
    if (new Set(entries.map(entry => entry.date)).size !== entries.length ||
        entries.some(entry => !allowedDates.has(entry.date) || entry.preference !== "available" ||
          !entry.start_time || !entry.end_time || entry.start_time === entry.end_time)) {
      return Response.json({ error: "提出日と希望時間を確認してください。" }, { status: 400 });
    }

    // The request and its window move together. Staff submissions never write the roster.
    const [, saved] = await sql.transaction([
      sql`select pg_advisory_xact_lock(hashtextextended(${storeId + ":" + employeeId}, 0))`,
      sql`
        with submitted as (
          select * from jsonb_to_recordset(${JSON.stringify(entries)}::jsonb)
            as entry(date date,start_time time,end_time time,note text)
        ), existing as (
          select distinct on (coalesce(r.work_date,w.work_date))
            r.id,r.status,r.request_type,coalesce(r.work_date,w.work_date) as date,
            r.note,w.available_start,w.available_end
          from timecard_shift_requests r
          left join timecard_shift_request_windows w on w.request_id=r.id
          where r.store_id::text=${storeId} and r.employee_id::text=${employeeId}
            and r.request_type in ('availability','day_off')
            and coalesce(r.work_date,w.work_date)=any(${dateList}::date[])
          order by coalesce(r.work_date,w.work_date),(r.status='approved') desc,r.updated_at desc,r.id
        ), cancellation_requests as (
          update timecard_shift_requests r set request_type='day_off',status='open',
            work_date=e.date,title='承認済みシフトの取り下げ希望',
            target_shift_id=(select s.id from timecard_shifts s where s.store_id=r.store_id
              and s.employee_id=r.employee_id and s.work_date=e.date
              and (s.note='希望シフト承認' or s.note like '希望 % から調整')
              order by s.updated_at desc,s.id limit 1),reviewed_by=null,reviewed_at=null,review_note=null,updated_at=now()
          from existing e
          where r.id=e.id and e.request_type='availability'
            and not exists(select 1 from submitted i where i.date=e.date)
            and (e.status='approved' or exists(
              select 1 from timecard_shifts s where s.store_id=r.store_id and s.employee_id=r.employee_id and s.work_date=e.date
                and (s.note='希望シフト承認' or s.note like '希望 % から調整')
            ))
          returning e.id,e.date
        ), withdrawn as (
          delete from timecard_shift_requests r using existing e
          where r.id=e.id and r.status='open' and e.request_type='availability'
            and not exists(select 1 from cancellation_requests c where c.id=e.id)
            and not exists(select 1 from submitted i where i.date=e.date)
          returning e.date
        ), changed as (
          update timecard_shift_requests r set request_type='availability',status='open',
            work_date=i.date,title='希望シフト',target_shift_id=null,note=i.note,reviewed_by=null,reviewed_at=null,review_note=null,updated_at=now()
          from existing e join submitted i on i.date=e.date
          where r.id=e.id and (e.status='rejected' or e.request_type<>'availability'
            or (e.note,e.available_start,e.available_end) is distinct from (i.note,i.start_time,i.end_time))
          returning r.id,r.work_date
        ), created as (
          insert into timecard_shift_requests(store_id,employee_id,request_type,work_date,title,note,created_by)
          select ${storeId}::uuid,${employeeId}::uuid,'availability',i.date,'希望シフト',i.note,${session.id}::uuid
          from submitted i where not exists(select 1 from existing e where e.date=i.date)
          returning id,work_date
        ), written as (
          select * from changed union all select * from created
        ), replaced_windows as (
          delete from timecard_shift_request_windows w using changed c where w.request_id=c.id returning w.id
        ), new_windows as (
          insert into timecard_shift_request_windows(request_id,work_date,available_start,available_end,preference,note)
          select w.id,i.date,i.start_time,i.end_time,'available',i.note
          from written w join submitted i on i.date=w.work_date
          cross join (select count(*) from replaced_windows) barrier
          returning id
        )
        select coalesce((select array_agg(id::text order by work_date) from written),'{}') ids,
          coalesce((select array_agg(date::text) from withdrawn),'{}') removed,
          coalesce((select array_agg(date::text) from cancellation_requests),'{}') cancellations
      `,
    ]);
    const insertedIds = (saved[0]?.ids ?? []) as string[];
    const removedDates = (saved[0]?.removed ?? []) as string[];
    const firstRequestId = insertedIds.find(Boolean) ?? "";
    const firstWorkDate = entries[0]?.date ?? "";
    const managerHref = firstRequestId
      ? `/os/timecard/requests?storeId=${encodeURIComponent(storeId)}&requestId=${encodeURIComponent(firstRequestId)}&date=${encodeURIComponent(firstWorkDate)}`
      : `/os/timecard/requests?storeId=${encodeURIComponent(storeId)}`;
    const removedMessage = removedDates.length ? ` ${removedDates.length}日分は取り下げられました。` : "";
    const cancellationCount = (saved[0]?.cancellations ?? []).length;
    await notifyStoreManagers(storeId, "希望シフトが送信されました", `${session.name} が ${submissionPeriod.label} の希望シフトを送信しました。${removedMessage}${cancellationCount ? ` ${cancellationCount}日分は取り下げ承認待ちです。` : ""}`, managerHref);
    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.shift_request.period_created",
      targetType: "timecard_shift_request",
      targetId: storeId,
      metadata: { storeId, employeeId, period: submissionPeriod, count: insertedIds.length, removedCount: removedDates.length },
      request
    });
    return Response.json({ ok: true, count: insertedIds.length, cancellationCount, ids: insertedIds.filter(Boolean) });
  }

  if (action === "publish_schedule") {
    const publishAccess = await requireGoogleBusinessAccess(storeId);
    if (publishAccess.error) return publishAccess.error;
    if (!managerRoles.has(session.role)) {
      return Response.json({ error: "シフトを公開する権限がありません。" }, { status: 403 });
    }
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "このリクエストは許可されていません。" }, { status: 403 });
    let period;
    try { period = schedulePeriod(String(body.period ?? "")); }
    catch { return Response.json({ error: "対象の半月を選択し、画面を再読み込みしてください。" }, { status: 409 }); }
    const result = await confirmSchedulePeriod(storeId, period.key, session.id, "manual", undefined, String(body.note ?? "").trim().slice(0, 1000) || undefined);
    dispatchGoogleHours(storeId, result.queued);
    return Response.json({ ok: true, ...result, googleBusinessQueued: result.queued > 0 });
  }

  const requestId = String(body.requestId ?? "");
  if (!requestId) return Response.json({ error: "申請を選択してください。" }, { status: 400 });
  const requestRows = await sql`
    select
      timecard_shift_requests.id::text,
      timecard_shift_requests.store_id::text as "storeId",
      timecard_shift_requests.employee_id::text as "employeeId",
      timecard_shift_requests.request_type as "requestType",
      timecard_shift_requests.status,
      timecard_shift_requests.title,
      timecard_shift_requests.target_shift_id::text as "targetShiftId",
      to_char(timecard_shift_requests.work_date, 'YYYY-MM-DD') as "workDate"
    from timecard_shift_requests
    where id::text = ${requestId}
      and store_id::text = ${storeId}
    limit 1
  `;
  const shiftRequest = requestRows[0];
  if (!shiftRequest) return Response.json({ error: "申請が見つかりません。" }, { status: 404 });

  if (action === "add_candidate") {
    if (String(shiftRequest.status) !== "open") {
      return Response.json({ error: "受付中の交代募集ではありません。" }, { status: 409 });
    }
    if (String(shiftRequest.requestType) !== "swap") {
      return Response.json({ error: "交代募集にのみ応募できます。" }, { status: 400 });
    }
    if (String(shiftRequest.employeeId) === session.id) {
      return Response.json({ error: "自分の交代募集には応募できません。" }, { status: 400 });
    }
    if (!await canWorkAtStore(session.id, storeId)) {
      return Response.json({ error: "この店舗のシフト対象ではありません。" }, { status: 403 });
    }
    const inserted = await sql`
      insert into timecard_shift_request_candidates (request_id, employee_id, note)
      values (${requestId}, ${session.id}, ${String(body.note ?? "").trim() || null})
      on conflict (request_id, employee_id)
      do update set note = excluded.note, status = 'applied'
      returning id::text
    `;
    await notifyStoreManagers(storeId, "交代応募が届きました", `${session.name} が交代募集に応募しました。`, "/os/timecard/requests");
    return Response.json({ ok: true, id: inserted[0]?.id ?? null });
  }

  if (action === "add_message") {
    const canComment = managerRoles.has(session.role) || String(shiftRequest.employeeId) === session.id;
    if (!canComment) return Response.json({ error: "この申請にコメントできません。" }, { status: 403 });
    const message = String(body.message ?? "").trim();
    if (!message) return Response.json({ error: "コメントを入力してください。" }, { status: 400 });
    const inserted = await sql`
      insert into timecard_shift_request_messages (request_id, employee_id, message)
      values (${requestId}, ${session.id}, ${message})
      returning id::text
    `;
    return Response.json({ ok: true, id: inserted[0]?.id ?? null });
  }

  if (action === "review_request") {
    const changeAccess = await requireGoogleBusinessAccess(storeId);
    if (changeAccess.error) return changeAccess.error;
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "このリクエストは許可されていません。" }, { status: 403 });
    if (!managerRoles.has(session.role)) {
      return Response.json({ error: "シフト申請を承認する権限がありません。" }, { status: 403 });
    }
    const nextStatus = String(body.reviewNote ?? "").startsWith("reject:") ? "rejected" : "approved";
    const reviewNote = nextStatus === "rejected" ? String(body.reviewNote ?? "").replace(/^reject:/, "").trim() : String(body.reviewNote ?? "").trim();
    const candidateId = String(body.candidateId ?? "");
    let notificationTitle = nextStatus === "approved" ? "シフト申請が承認されました" : "シフト申請が却下されました";
    let notificationMessage = `${String(shiftRequest.workDate ?? "")} の申請結果を確認してください。`;
    let sendReviewPush = true;

    const requestType = String(shiftRequest.requestType);
    const workDate = String(shiftRequest.workDate ?? "");
    const employeeId = String(shiftRequest.employeeId);
    const approveAvailability = nextStatus === "approved" && requestType === "availability";
    const approveCancellation = nextStatus === "approved" && requestType === "day_off"
      && String(shiftRequest.title) === "承認済みシフトの取り下げ希望" && !!shiftRequest.targetShiftId;
    const approveSwap = nextStatus === "approved" && requestType === "swap";
    const approvedStart = normalizeTimeValue(body.approvedStart);
    const approvedEnd = normalizeTimeValue(body.approvedEnd);
    if (typeof body.requestVersion !== "string" || String(shiftRequest.status) !== "open") {
      return Response.json({ error: "申請を再読み込みして確認してください。" }, { status: 409 });
    }
    if (approveAvailability && (!approvedStart || !approvedEnd || approvedStart === approvedEnd || !isValidWorkDate(workDate))) {
      return Response.json({ error: "承認する日付と開始・終了時刻を確認してください。" }, { status: 400 });
    }
    if (approveSwap && !candidateId) return Response.json({ error: "承認する交代候補を選択してください。" }, { status: 400 });

    // Claim the exact revision the manager saw and commit the roster edit in the same transaction.
    const [, reviewed] = await sql.transaction([
      sql`select pg_advisory_xact_lock(hashtextextended(${storeId + ":" + employeeId}, 0))`,
      sql`
        with candidate as (
          select c.id,c.employee_id
          from timecard_shift_request_candidates c
          join employee_work_stores w on w.employee_id=c.employee_id and w.store_id::text=${storeId}
          join employees e on e.id=c.employee_id and e.status='active'
          where c.id::text=${candidateId} and c.request_id::text=${requestId} and c.status='applied'
        ), swap_target as (
          select s.id from timecard_shifts s join timecard_shift_requests r on r.target_shift_id=s.id
          where ${approveSwap} and r.id::text=${requestId} and s.store_id=r.store_id and s.employee_id=r.employee_id
          for update of s
        ), claimed as (
          update timecard_shift_requests r set status=${nextStatus},reviewed_by=${session.id}::uuid,
            reviewed_at=now(),review_note=${reviewNote||null},updated_at=now()
          where r.id::text=${requestId} and r.store_id::text=${storeId}
            and r.status='open' and r.updated_at::text=${body.requestVersion}
            and (not ${approveSwap} or (exists(select 1 from candidate) and exists(select 1 from swap_target)))
          returning r.*
        ), requested as (
          select w.available_start,w.available_end from timecard_shift_request_windows w
          join claimed r on r.id=w.request_id and r.work_date=w.work_date
          order by w.created_at limit 1
        ), removed_shifts as (
          delete from timecard_shifts s using claimed r
          where (${approveAvailability} or (${approveCancellation} and s.id=r.target_shift_id)) and s.store_id=r.store_id and s.employee_id=r.employee_id and s.work_date=r.work_date
            and (s.note='希望シフト承認' or s.note like '希望 % から調整')
          returning s.id
        ), assigned as (
          insert into timecard_shifts(employee_id,store_id,work_date,scheduled_start,scheduled_end,break_minutes,note,created_by,updated_at)
          select r.employee_id,r.store_id,r.work_date,${approvedStart}::time,${approvedEnd}::time,0,
            case when (w.available_start,w.available_end) is distinct from (${approvedStart}::time,${approvedEnd}::time)
              and w.available_start is not null and w.available_end is not null
              then '希望 '||to_char(w.available_start,'HH24:MI')||'-'||to_char(w.available_end,'HH24:MI')||' から調整'
              else '希望シフト承認' end,${session.id}::uuid,now()
          from claimed r left join requested w on true cross join (select count(*) from removed_shifts) barrier
          where ${approveAvailability}
          returning id
        ), swapped as (
          update timecard_shifts s set employee_id=c.employee_id,updated_at=now()
          from claimed r,candidate c,swap_target t where ${approveSwap} and s.id=t.id
          returning c.employee_id
        ), candidates_updated as (
          update timecard_shift_request_candidates c
          set status=case when c.id::text=${candidateId} then 'approved' else 'closed' end,
            approved_by=case when c.id::text=${candidateId} then ${session.id}::uuid else c.approved_by end,
            approved_at=case when c.id::text=${candidateId} then now() else c.approved_at end
          from claimed r where ${approveSwap} and c.request_id=r.id
          returning c.id
        )
        select r.id,to_char(w.available_start,'HH24:MI') as "requestedStart",
          to_char(w.available_end,'HH24:MI') as "requestedEnd",
          (select employee_id::text from swapped) as "swappedEmployee"
        from claimed r left join requested w on true
      `,
    ]);
    const saved = reviewed[0];
    if (!saved) return Response.json({ error: "申請または対象シフトが変更されました。再読み込みしてください。" }, { status: 409 });
    if (saved.swappedEmployee) {
      await notifyEmployee(String(saved.swappedEmployee), "交代が承認されました", "申請した交代シフトが承認されました。", "/store/timecard");
    }
    if (approveAvailability) {
      const requestedStart = saved.requestedStart ?? approvedStart;
      const requestedEnd = saved.requestedEnd ?? approvedEnd;
      const adjusted = requestedStart !== approvedStart || requestedEnd !== approvedEnd;
      notificationTitle = adjusted ? "希望シフトが調整されました" : "希望シフトが承認されました";
      notificationMessage = adjusted
        ? `${workDate} の希望 ${requestedStart}-${requestedEnd} は ${approvedStart}-${approvedEnd} に調整されました。`
        : `${workDate} ${approvedStart}-${approvedEnd} のシフトが承認されました。`;
      sendReviewPush = adjusted;
    }

    const scheduleSync = nextStatus === "approved" && shiftRequest.workDate
      ? await reconcileScheduleMutation(storeId, [String(shiftRequest.workDate)], session.id) : null;
    dispatchGoogleHours(storeId, scheduleSync?.queued ?? 0);
    await notifyEmployee(String(shiftRequest.employeeId), notificationTitle, notificationMessage, "/store/timecard", sendReviewPush);
    await writeAuditLog({
      actorEmployeeId: session.id,
      action: `timecard.shift_request.${nextStatus}`,
      targetType: "timecard_shift_request",
      targetId: requestId,
      metadata: { storeId, requestId, candidateId: candidateId || null },
      request
    });
    return Response.json({ ok: true, scheduleSync });
  }

  return Response.json({ error: "未対応の操作です。" }, { status: 400 });
}
