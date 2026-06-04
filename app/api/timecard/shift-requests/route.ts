import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";
import { getJstMonthLabel } from "../../../../lib/timecard";
import { createOsNotification } from "../../../../lib/web-push";
import type { EmployeeSession } from "../../../../lib/auth";

type ShiftRequestBody = {
  action?: string;
  storeId?: string;
  month?: string;
  requestId?: string;
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

const managerRoles = new Set(["owner", "manager", "store_owner"]);
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
      periodType: "second_half",
      startDate: `${monthLabel}-15`,
      endDate: formatDateKey(new Date(nextMonthStart.getTime() - 24 * 60 * 60 * 1000)),
      label: `${monthLabel} 後半`
    };
  }

  const nextMonthStart = new Date(Date.UTC(targetYear, targetMonth + 1, 1));
  const nextMonthLabel = `${nextMonthStart.getUTCFullYear()}-${String(nextMonthStart.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    periodType: "first_half",
    startDate: `${nextMonthLabel}-01`,
    endDate: `${nextMonthLabel}-14`,
    label: `${nextMonthLabel} 前半`
  };
}

function enumerateDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00+09:00`);
  const end = new Date(`${endDate}T00:00:00+09:00`);
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
      and (employees.staff_category = 'working' or employees.payroll_subject = 'paid')
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
          employees.role = 'store_owner'
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

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  const { month, startDate, endDate } = getMonthRange(url.searchParams.get("month") || getJstMonthLabel());
  const stores = await getVisibleStores(session);
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
      and (employees.staff_category = 'working' or employees.payroll_subject = 'paid')
    order by employees.name
  ` : [];

  const shiftSettingsRows = selectedStoreId ? await sql`
    select
      coalesce(shift_first_half_submission_deadline_day, 25)::int as "firstHalfDeadlineDay",
      coalesce(shift_second_half_submission_deadline_day, 10)::int as "secondHalfDeadlineDay",
      to_char(coalesce(shift_submission_deadline_time, '23:59'::time), 'HH24:MI') as "deadlineTime"
    from stores
    where id::text = ${selectedStoreId}
    limit 1
  ` : [];
  const submissionPeriod = getShiftSubmissionPeriod(shiftSettingsRows[0] ?? null);
  const submissionDates = enumerateDates(submissionPeriod.startDate, submissionPeriod.endDate);
  const schedulingPeriod = getCurrentSchedulingPeriod();
  const schedulingDates = enumerateDates(schedulingPeriod.startDate, schedulingPeriod.endDate);
  const queryStartDate = startDate < schedulingPeriod.startDate ? startDate : schedulingPeriod.startDate;
  const schedulingEndExclusive = new Date(`${schedulingPeriod.endDate}T00:00:00+09:00`);
  schedulingEndExclusive.setUTCDate(schedulingEndExclusive.getUTCDate() + 1);
  const queryEndDate = endDate > schedulingPeriod.endDate ? endDate : formatDateKey(schedulingEndExclusive);

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
      timecard_shift_requests.reviewed_at as "reviewedAt",
      employees.id::text as "employeeId",
      employees.name as "employeeName",
      reviewer.name as "reviewedByName",
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
        ${managerRoles.has(session.role)}
        or timecard_shift_requests.employee_id::text = ${session.id}
        or timecard_shift_request_candidates.employee_id::text = ${session.id}
        or (timecard_shift_requests.request_type = 'swap' and timecard_shift_requests.status = 'open')
      )
    group by timecard_shift_requests.id, employees.id, reviewer.name
    order by timecard_shift_requests.created_at desc
  ` : [];

  const myShifts = selectedStoreId ? await sql`
    select
      timecard_shifts.id::text,
      to_char(timecard_shifts.work_date, 'YYYY-MM-DD') as "workDate",
      to_char(timecard_shifts.scheduled_start, 'HH24:MI') as "scheduledStart",
      to_char(timecard_shifts.scheduled_end, 'HH24:MI') as "scheduledEnd",
      employees.name as "employeeName"
    from timecard_shifts
    join employees on employees.id = timecard_shifts.employee_id
    where timecard_shifts.store_id::text = ${selectedStoreId}
      and timecard_shifts.work_date >= ${queryStartDate}::date
      and timecard_shifts.work_date < ${queryEndDate}::date
      and (${managerRoles.has(session.role)} or timecard_shifts.employee_id::text = ${session.id})
    order by timecard_shifts.work_date asc, timecard_shifts.scheduled_start asc
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
    canManageRequests: managerRoles.has(session.role),
    employees,
    submissionPeriod,
    submissionDates,
    schedulingPeriod,
    schedulingDates,
    requests,
    myShifts,
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
    const targetShiftId = String(body.targetShiftId ?? "");

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
        ${String(body.title ?? "").trim() || (requestType === "availability" ? "希望シフト" : requestType === "day_off" ? "休み希望" : "交代募集")},
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
    const allowedDates = new Set(enumerateDates(submissionPeriod.startDate, submissionPeriod.endDate));
    const entries = (Array.isArray(body.entries) ? body.entries : [])
      .map((entry) => ({
        workDate: String(entry.workDate ?? ""),
        preference: String(entry.preference ?? ""),
        availableStart: normalizeTimeValue(entry.availableStart),
        availableEnd: normalizeTimeValue(entry.availableEnd),
        note: String(entry.note ?? "").trim()
      }))
      .filter((entry) => allowedDates.has(entry.workDate) && entry.preference === "available");

    for (const entry of entries) {
      if (!entry.availableStart || !entry.availableEnd) {
        return Response.json({ error: `${entry.workDate} の希望時間を入力してください。` }, { status: 400 });
      }
    }

    if (!entries.length) {
      const dateList = Array.from(allowedDates);
      await sql`
        delete from timecard_shift_requests
        where store_id::text = ${storeId}
          and employee_id::text = ${employeeId}
          and request_type in ('availability', 'day_off')
          and (
            to_char(work_date, 'YYYY-MM-DD') = any(${dateList})
            or exists (
              select 1
              from timecard_shift_request_windows period_windows
              where period_windows.request_id = timecard_shift_requests.id
                and to_char(period_windows.work_date, 'YYYY-MM-DD') = any(${dateList})
            )
          )
      `;
      await sql`
        delete from timecard_shifts
        where store_id::text = ${storeId}
          and employee_id::text = ${employeeId}
          and to_char(work_date, 'YYYY-MM-DD') = any(${dateList})
          and (
            coalesce(note, '') = '希望シフト承認'
            or coalesce(note, '') like '希望 % から調整'
          )
      `;
      await notifyStoreManagers(storeId, "希望シフトが送信されました", `${session.name} が ${submissionPeriod.label} の希望シフトを未選択で送信しました。`, "/os/timecard/requests");
      await writeAuditLog({
        actorEmployeeId: session.id,
        action: "timecard.shift_request.period_cleared",
        targetType: "timecard_shift_request",
        targetId: storeId,
        metadata: { storeId, employeeId, period: submissionPeriod, count: 0 },
        request
      });
      return Response.json({ ok: true, count: 0, ids: [] });
    }

    const dateList = Array.from(allowedDates);
    const existingRows = await sql`
      select distinct on (coalesce(to_char(timecard_shift_requests.work_date, 'YYYY-MM-DD'), to_char(timecard_shift_request_windows.work_date, 'YYYY-MM-DD')))
        timecard_shift_requests.id::text,
        timecard_shift_requests.status,
        timecard_shift_requests.note,
        coalesce(to_char(timecard_shift_requests.work_date, 'YYYY-MM-DD'), to_char(timecard_shift_request_windows.work_date, 'YYYY-MM-DD')) as "workDate",
        to_char(timecard_shift_request_windows.available_start, 'HH24:MI') as "availableStart",
        to_char(timecard_shift_request_windows.available_end, 'HH24:MI') as "availableEnd",
        timecard_shift_request_windows.note as "windowNote"
      from timecard_shift_requests
      left join timecard_shift_request_windows on timecard_shift_request_windows.request_id = timecard_shift_requests.id
      where timecard_shift_requests.store_id::text = ${storeId}
        and timecard_shift_requests.employee_id::text = ${employeeId}
        and timecard_shift_requests.request_type in ('availability', 'day_off')
        and (
          to_char(timecard_shift_requests.work_date, 'YYYY-MM-DD') = any(${dateList})
          or to_char(timecard_shift_request_windows.work_date, 'YYYY-MM-DD') = any(${dateList})
        )
      order by coalesce(to_char(timecard_shift_requests.work_date, 'YYYY-MM-DD'), to_char(timecard_shift_request_windows.work_date, 'YYYY-MM-DD')), timecard_shift_requests.created_at desc
    `;
    const existingByDate = new Map(existingRows.map((row) => [String(row.workDate), {
      id: String(row.id),
      status: String(row.status ?? ""),
      availableStart: row.availableStart ? String(row.availableStart) : "",
      availableEnd: row.availableEnd ? String(row.availableEnd) : "",
      note: String(row.note ?? row.windowNote ?? "")
    }]));
    const retainedRequestIds = entries
      .map((entry) => existingByDate.get(entry.workDate)?.id)
      .filter((id): id is string => Boolean(id));
    const removedRows = await sql`
      delete from timecard_shift_requests
      where store_id::text = ${storeId}
        and employee_id::text = ${employeeId}
        and request_type in ('availability', 'day_off')
        and (
          to_char(work_date, 'YYYY-MM-DD') = any(${dateList})
          or exists (
            select 1
            from timecard_shift_request_windows period_windows
            where period_windows.request_id = timecard_shift_requests.id
              and to_char(period_windows.work_date, 'YYYY-MM-DD') = any(${dateList})
          )
        )
        and (
          coalesce(array_length(${retainedRequestIds}::text[], 1), 0) = 0
          or id::text <> all(${retainedRequestIds}::text[])
        )
      returning id::text, to_char(work_date, 'YYYY-MM-DD') as "workDate", status
    `;
    const removedDates = removedRows.map((row) => String(row.workDate ?? "")).filter(Boolean);
    if (removedDates.length) {
      await sql`
        delete from timecard_shifts
        where store_id::text = ${storeId}
          and employee_id::text = ${employeeId}
          and to_char(work_date, 'YYYY-MM-DD') = any(${removedDates})
          and (
            coalesce(note, '') = '希望シフト承認'
            or coalesce(note, '') like '希望 % から調整'
          )
      `;
    }

    const insertedIds: string[] = [];
    for (const entry of entries) {
      const existingRequest = existingByDate.get(entry.workDate);
      if (existingRequest) {
        const existingRequestId = existingRequest.id;
        const changed = existingRequest.availableStart !== entry.availableStart
          || existingRequest.availableEnd !== entry.availableEnd
          || existingRequest.note !== entry.note;
        const shouldReopen = existingRequest.status === "rejected" || (existingRequest.status === "approved" && changed);
        if (!changed && !shouldReopen) {
          insertedIds.push(existingRequestId);
          continue;
        }
        await sql`
          update timecard_shift_requests
          set
            request_type = 'availability',
            status = ${shouldReopen ? "open" : existingRequest.status},
            work_date = ${entry.workDate}::date,
            title = '希望シフト',
            note = ${entry.note || null},
            reviewed_by = case when ${shouldReopen} then null else reviewed_by end,
            reviewed_at = case when ${shouldReopen} then null else reviewed_at end,
            review_note = case when ${shouldReopen} then null else review_note end,
            updated_at = now()
          where id::text = ${existingRequestId}
            and store_id::text = ${storeId}
            and employee_id::text = ${employeeId}
        `;
        await sql`
          delete from timecard_shift_request_windows
          where request_id::text = ${existingRequestId}
        `;
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
            ${existingRequestId},
            ${entry.workDate}::date,
            ${entry.availableStart ? `${entry.availableStart}:00` : null}::time,
            ${entry.availableEnd ? `${entry.availableEnd}:00` : null}::time,
            'available',
            ${entry.note || null}
          )
        `;
        if (existingRequest.status === "approved" && changed) {
          await sql`
            delete from timecard_shifts
            where store_id::text = ${storeId}
              and employee_id::text = ${employeeId}
              and work_date = ${entry.workDate}::date
              and (
                coalesce(note, '') = '希望シフト承認'
                or coalesce(note, '') like '希望 % から調整'
              )
          `;
        }
        insertedIds.push(existingRequestId);
        continue;
      }

      const inserted = await sql`
        insert into timecard_shift_requests (
          store_id,
          employee_id,
          request_type,
          work_date,
          title,
          note,
          created_by,
          updated_at
        )
        values (
          ${storeId},
          ${employeeId},
          'availability',
          ${entry.workDate}::date,
          '希望シフト',
          ${entry.note || null},
          ${session.id},
          now()
        )
        returning id::text
      `;
      const requestId = String(inserted[0]?.id ?? "");
      insertedIds.push(requestId);
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
          ${entry.workDate}::date,
          ${entry.availableStart ? `${entry.availableStart}:00` : null}::time,
          ${entry.availableEnd ? `${entry.availableEnd}:00` : null}::time,
          'available',
          ${entry.note || null}
        )
      `;
    }

    const firstRequestId = insertedIds.find(Boolean) ?? "";
    const firstWorkDate = entries[0]?.workDate ?? "";
    const managerHref = firstRequestId
      ? `/os/timecard/requests?storeId=${encodeURIComponent(storeId)}&requestId=${encodeURIComponent(firstRequestId)}&date=${encodeURIComponent(firstWorkDate)}`
      : `/os/timecard/requests?storeId=${encodeURIComponent(storeId)}`;
    const removedMessage = removedDates.length ? ` ${removedDates.length}日分は取り下げられました。` : "";
    await notifyStoreManagers(storeId, "希望シフトが送信されました", `${session.name} が ${submissionPeriod.label} の希望シフトを送信しました。${removedMessage}`, managerHref);
    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.shift_request.period_created",
      targetType: "timecard_shift_request",
      targetId: storeId,
      metadata: { storeId, employeeId, period: submissionPeriod, count: insertedIds.length, removedCount: removedDates.length },
      request
    });
    return Response.json({ ok: true, count: insertedIds.length, ids: insertedIds.filter(Boolean) });
  }

  if (action === "publish_schedule") {
    if (!managerRoles.has(session.role)) {
      return Response.json({ error: "シフトを公開する権限がありません。" }, { status: 403 });
    }
    const { month } = getMonthRange(String(body.month ?? getJstMonthLabel()));
    const inserted = await sql`
      insert into timecard_shift_publications (store_id, schedule_month, note, published_by)
      values (${storeId}, ${month}, ${String(body.note ?? "").trim() || null}, ${session.id})
      returning id::text
    `;
    const staff = await sql`
      select employees.id::text
      from employees
      join employee_work_stores on employee_work_stores.employee_id = employees.id
      where employee_work_stores.store_id::text = ${storeId}
        and employees.status = 'active'
    `;
    await Promise.all(staff.map((employee) => notifyEmployee(String(employee.id), "シフトが公開されました", `${month} のシフトを確認してください。`, "/store/timecard")));
    return Response.json({ ok: true, id: inserted[0]?.id ?? null });
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
    if (!managerRoles.has(session.role)) {
      return Response.json({ error: "シフト申請を承認する権限がありません。" }, { status: 403 });
    }
    const nextStatus = String(body.reviewNote ?? "").startsWith("reject:") ? "rejected" : "approved";
    const reviewNote = nextStatus === "rejected" ? String(body.reviewNote ?? "").replace(/^reject:/, "").trim() : String(body.reviewNote ?? "").trim();
    const candidateId = String(body.candidateId ?? "");
    let notificationTitle = nextStatus === "approved" ? "シフト申請が承認されました" : "シフト申請が却下されました";
    let notificationMessage = `${String(shiftRequest.workDate ?? "")} の申請結果を確認してください。`;
    let sendReviewPush = true;

    if (nextStatus === "approved" && String(shiftRequest.requestType) === "swap") {
      if (!candidateId) return Response.json({ error: "承認する交代候補を選択してください。" }, { status: 400 });
      const candidates = await sql`
        select id::text, employee_id::text as "employeeId"
        from timecard_shift_request_candidates
        where id::text = ${candidateId}
          and request_id::text = ${requestId}
        limit 1
      `;
      const candidate = candidates[0];
      if (!candidate) return Response.json({ error: "交代候補が見つかりません。" }, { status: 404 });
      const targetShiftId = String(shiftRequest.targetShiftId ?? "");
      if (!targetShiftId) return Response.json({ error: "対象シフトが見つかりません。" }, { status: 409 });
      await sql.transaction([
        sql`
          update timecard_shifts
          set employee_id = ${String(candidate.employeeId)}, updated_at = now()
          where id::text = ${targetShiftId}
            and store_id::text = ${storeId}
        `,
        sql`
          update timecard_shift_request_candidates
          set status = case when id::text = ${candidateId} then 'approved' else 'closed' end,
              approved_by = case when id::text = ${candidateId} then ${session.id} else approved_by end,
              approved_at = case when id::text = ${candidateId} then now() else approved_at end
          where request_id::text = ${requestId}
        `
      ]);
      await notifyEmployee(String(candidate.employeeId), "交代が承認されました", "申請した交代シフトが承認されました。", "/store/timecard");
    }

    if (nextStatus === "approved" && String(shiftRequest.requestType) === "availability") {
      const approvedStart = normalizeTimeValue(body.approvedStart);
      const approvedEnd = normalizeTimeValue(body.approvedEnd);
      if (!approvedStart || !approvedEnd) {
        return Response.json({ error: "承認する開始・終了時刻を入力してください。" }, { status: 400 });
      }
      const windowRows = await sql`
        select
          to_char(available_start, 'HH24:MI') as "availableStart",
          to_char(available_end, 'HH24:MI') as "availableEnd"
        from timecard_shift_request_windows
        where request_id::text = ${requestId}
        order by created_at asc
        limit 1
      `;
      const requestedStart = windowRows[0]?.availableStart ? String(windowRows[0].availableStart) : approvedStart;
      const requestedEnd = windowRows[0]?.availableEnd ? String(windowRows[0].availableEnd) : approvedEnd;
      const adjusted = requestedStart !== approvedStart || requestedEnd !== approvedEnd;
      const workDate = String(shiftRequest.workDate ?? "");
      if (!isValidWorkDate(workDate)) {
        return Response.json({ error: "対象日付が見つかりません。" }, { status: 409 });
      }

      await sql`
        insert into timecard_shifts (
          employee_id,
          store_id,
          work_date,
          scheduled_start,
          scheduled_end,
          break_minutes,
          note,
          created_by,
          updated_at
        )
        values (
          ${String(shiftRequest.employeeId)},
          ${storeId},
          ${workDate}::date,
          ${approvedStart}::time,
          ${approvedEnd}::time,
          0,
          ${adjusted ? `希望 ${requestedStart}-${requestedEnd} から調整` : "希望シフト承認"},
          ${session.id},
          now()
        )
        on conflict (employee_id, store_id, work_date)
        do update set
          scheduled_start = excluded.scheduled_start,
          scheduled_end = excluded.scheduled_end,
          break_minutes = excluded.break_minutes,
          note = excluded.note,
          updated_at = now()
      `;
      notificationTitle = adjusted ? "希望シフトが調整されました" : "希望シフトが承認されました";
      notificationMessage = adjusted
        ? `${workDate} の希望 ${requestedStart}-${requestedEnd} は ${approvedStart}-${approvedEnd} に調整されました。`
        : `${workDate} ${approvedStart}-${approvedEnd} のシフトが承認されました。`;
      sendReviewPush = adjusted;
    }

    await sql`
      update timecard_shift_requests
      set status = ${nextStatus},
          reviewed_by = ${session.id},
          reviewed_at = now(),
          review_note = ${reviewNote || null},
          updated_at = now()
      where id::text = ${requestId}
    `;
    await notifyEmployee(String(shiftRequest.employeeId), notificationTitle, notificationMessage, "/store/timecard", sendReviewPush);
    await writeAuditLog({
      actorEmployeeId: session.id,
      action: `timecard.shift_request.${nextStatus}`,
      targetType: "timecard_shift_request",
      targetId: requestId,
      metadata: { storeId, requestId, candidateId: candidateId || null },
      request
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "未対応の操作です。" }, { status: 400 });
}
