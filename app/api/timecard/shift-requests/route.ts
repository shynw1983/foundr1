import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";
import { getJstMonthLabel } from "../../../../lib/timecard";
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
      select id::text, name
      from stores
      where status = 'active'
      order by name
    `;
  }
  if (!scope.storeIds.length) return [];
  return sql`
    select id::text, name
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
  await Promise.all(managers.map((manager) => sql`
    insert into os_notifications (recipient_employee_id, notification_type, title, message, href)
    values (${String(manager.id)}, 'timecard_shift_request', ${title}, ${message}, ${href})
  `));
}

async function notifyEmployee(employeeId: string, title: string, message: string, href: string) {
  await sql`
    insert into os_notifications (recipient_employee_id, notification_type, title, message, href)
    values (${employeeId}, 'timecard_shift_request', ${title}, ${message}, ${href})
  `;
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
        timecard_shift_requests.work_date is null
        or (
          timecard_shift_requests.work_date >= ${startDate}::date
          and timecard_shift_requests.work_date < ${endDate}::date
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
      and timecard_shifts.work_date >= ${startDate}::date
      and timecard_shifts.work_date < ${endDate}::date
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

    await notifyStoreManagers(storeId, "シフト申請が届きました", `${session.name} から ${workDate} の申請があります。`, "/os/timecard/requests");
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

    await sql`
      update timecard_shift_requests
      set status = ${nextStatus},
          reviewed_by = ${session.id},
          reviewed_at = now(),
          review_note = ${reviewNote || null},
          updated_at = now()
      where id::text = ${requestId}
    `;
    await notifyEmployee(String(shiftRequest.employeeId), nextStatus === "approved" ? "シフト申請が承認されました" : "シフト申請が却下されました", `${String(shiftRequest.workDate ?? "")} の申請結果を確認してください。`, "/store/timecard");
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
