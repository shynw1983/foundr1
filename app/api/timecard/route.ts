import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../lib/api-auth";
import { writeAuditLog } from "../../../lib/audit-log";
import { sql } from "../../../lib/db";
import {
  getJstMonthLabel,
  getJstMonthRange,
  isTimecardPunchType,
  summarizePayroll,
  summarizeTimecardDays,
  type TimecardEmployee,
  type TimecardPunch
} from "../../../lib/timecard";

type TimecardPostBody = {
  action?: string;
  storeId?: string;
  punchType?: string;
  note?: string;
  employeeId?: string;
  workDate?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  clockIn?: string;
  clockOut?: string;
  breakMinutes?: number | string;
};

const timecardActualEditRoles = new Set(["owner", "manager", "store_owner"]);

function toMoneyNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

async function getVisibleStores(allStores: boolean, storeIds: string[]) {
  if (allStores) {
    return sql`
      select id::text, name, business_hours as "businessHours"
      from stores
      where status = 'active'
      order by name
    `;
  }

  if (storeIds.length === 0) return [];

  return sql`
    select id::text, name, business_hours as "businessHours"
    from stores
    where status = 'active'
      and id::text = any(${storeIds})
    order by name
  `;
}

async function getVisibleEmployees(allStores: boolean, storeIds: string[]) {
  const scopedStoreIds = allStores ? ["__all__"] : storeIds;
  if (!allStores && scopedStoreIds.length === 0) return [];

  const rows = await sql`
    select
      employees.id::text,
      employees.name,
      employees.role,
      employees.status,
      coalesce(
        array_agg(stores.id::text order by stores.name) filter (where stores.id is not null),
        '{}'::text[]
      ) as "storeIds",
      coalesce(
        json_agg(
          json_build_object(
            'storeId', employee_work_stores.store_id::text,
            'payrollEnabled', employee_work_stores.payroll_enabled,
            'employmentType', employee_work_stores.employment_type,
            'hourlyWage', employee_work_stores.hourly_wage,
            'monthlySalary', employee_work_stores.monthly_salary,
            'commuteAllowancePerWorkday', employee_work_stores.commute_allowance_per_workday
          )
          order by stores.name
        ) filter (where stores.id is not null),
        '[]'::json
      ) as "storePayrollSettings"
    from employees
    join employee_work_stores
      on employee_work_stores.employee_id = employees.id
    join stores on stores.id = employee_work_stores.store_id
    where employees.status = 'active'
      and employees.staff_category = 'working'
      and (
        ${allStores}
        or employee_work_stores.store_id::text = any(${scopedStoreIds})
      )
    group by employees.id
    order by employees.name
  `;

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    role: String(row.role),
    status: String(row.status),
    storeIds: Array.isArray(row.storeIds) ? row.storeIds.map(String) : [],
    storePayrollSettings: (Array.isArray(row.storePayrollSettings) ? row.storePayrollSettings : []).map((setting) => ({
      storeId: String(setting.storeId),
      payrollEnabled: setting.payrollEnabled !== false,
      employmentType: setting.employmentType === "monthly" ? "monthly" : "hourly",
      hourlyWage: toMoneyNumber(setting.hourlyWage),
      monthlySalary: toMoneyNumber(setting.monthlySalary),
      commuteAllowancePerWorkday: toMoneyNumber(setting.commuteAllowancePerWorkday) ?? 0
    }))
  })) satisfies TimecardEmployee[];
}

async function canPunchForEmployee(storeId: string, employeeId: string) {
  const rows = await sql`
    select
      employees.id::text
    from employees
    join employee_work_stores
      on employee_work_stores.employee_id = employees.id
    where employees.id = ${employeeId}
      and employees.status = 'active'
      and employees.staff_category = 'working'
      and employee_work_stores.store_id::text = ${storeId}
    limit 1
  `;
  return Boolean(rows[0]);
}

function getMonthDateRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const fallback = /^(\d{4})-(\d{2})$/.exec(getJstMonthLabel())!;
  const [, yearText, monthText] = match ?? fallback;
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const startDate = `${yearText}-${monthText}-01`;
  const endDateValue = new Date(Date.UTC(year, monthIndex + 1, 1));
  const endDate = `${endDateValue.getUTCFullYear()}-${String(endDateValue.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return { startDate, endDate };
}

function isValidWorkDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeTimeValue(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return /^\d{2}:\d{2}$/.test(text) ? text : null;
}

function getJstWorkDateRange(workDate: string) {
  const start = new Date(`${workDate}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const overnightEnd = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  return { start, end, overnightEnd };
}

function toPunchDateTime(workDate: string, time: string, baseTime?: string | null) {
  const date = new Date(`${workDate}T${time}:00+09:00`);
  if (baseTime && time <= baseTime) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString();
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month") || getJstMonthLabel();
  const { month, startUtc, endUtc } = getJstMonthRange(monthParam);
  const { startDate, endDate } = getMonthDateRange(month);
  const scope = await getSessionStoreScope(session);
  const stores = await getVisibleStores(scope.allStores, scope.storeIds);
  const visibleStoreIds = stores.map((store) => String(store.id));
  const requestedStoreId = url.searchParams.get("storeId");
  const selectedStoreId = requestedStoreId && visibleStoreIds.includes(requestedStoreId)
    ? requestedStoreId
    : visibleStoreIds[0] ?? "";
  const employees = await getVisibleEmployees(scope.allStores, scope.storeIds);

  const punches = selectedStoreId ? await sql`
    select
      timecard_punches.id::text,
      timecard_punches.employee_id::text as "employeeId",
      employees.name as "employeeName",
      timecard_punches.store_id::text as "storeId",
      stores.name as "storeName",
      timecard_punches.punch_type as "punchType",
      timecard_punches.punched_at as "punchedAt",
      timecard_punches.note
    from timecard_punches
    join employees on employees.id = timecard_punches.employee_id
    join stores on stores.id = timecard_punches.store_id
    where timecard_punches.store_id::text = ${selectedStoreId}
      and timecard_punches.punched_at >= ${startUtc.toISOString()}
      and timecard_punches.punched_at < ${endUtc.toISOString()}
    order by timecard_punches.punched_at desc
  ` : [];

  const typedPunches = punches.map((row) => {
    const punchType = String(row.punchType);
    return {
      id: String(row.id),
      employeeId: String(row.employeeId),
      employeeName: String(row.employeeName),
      storeId: String(row.storeId),
      storeName: String(row.storeName),
      punchType: isTimecardPunchType(punchType) ? punchType : "clock_in",
      punchedAt: new Date(String(row.punchedAt)).toISOString(),
      note: row.note ? String(row.note) : null
    };
  }) satisfies TimecardPunch[];

  const dailySummaries = summarizeTimecardDays(typedPunches);
  const payroll = summarizePayroll(employees, dailySummaries);

  const shifts = selectedStoreId ? await sql`
    select
      timecard_shifts.id::text,
      timecard_shifts.employee_id::text as "employeeId",
      employees.name as "employeeName",
      timecard_shifts.store_id::text as "storeId",
      stores.name as "storeName",
      to_char(timecard_shifts.work_date, 'YYYY-MM-DD') as "workDate",
      to_char(timecard_shifts.scheduled_start, 'HH24:MI') as "scheduledStart",
      to_char(timecard_shifts.scheduled_end, 'HH24:MI') as "scheduledEnd",
      timecard_shifts.break_minutes as "breakMinutes",
      timecard_shifts.note
    from timecard_shifts
    join employees on employees.id = timecard_shifts.employee_id
    join stores on stores.id = timecard_shifts.store_id
    where timecard_shifts.store_id::text = ${selectedStoreId}
      and timecard_shifts.work_date >= ${startDate}::date
      and timecard_shifts.work_date < ${endDate}::date
    order by timecard_shifts.work_date asc, employees.name asc
  ` : [];

  const latestPunchRows = selectedStoreId ? await sql`
    select
      timecard_punches.id::text,
      timecard_punches.employee_id::text as "employeeId",
      employees.name as "employeeName",
      timecard_punches.store_id::text as "storeId",
      stores.name as "storeName",
      timecard_punches.punch_type as "punchType",
      timecard_punches.punched_at as "punchedAt",
      timecard_punches.note
    from timecard_punches
    join employees on employees.id = timecard_punches.employee_id
    join stores on stores.id = timecard_punches.store_id
    join (
      select
        employee_id,
        max(punched_at) as latest_punched_at
      from timecard_punches
      where store_id::text = ${selectedStoreId}
      group by employee_id
    ) latest
      on latest.employee_id = timecard_punches.employee_id
      and latest.latest_punched_at = timecard_punches.punched_at
    where timecard_punches.store_id::text = ${selectedStoreId}
    order by timecard_punches.punched_at desc
  ` : [];
  const latestPunches = latestPunchRows.map((row) => ({
    id: String(row.id),
    employeeId: String(row.employeeId),
    employeeName: String(row.employeeName),
    storeId: String(row.storeId),
    storeName: String(row.storeName),
    punchType: String(row.punchType),
    punchedAt: new Date(String(row.punchedAt)).toISOString()
  }));
  const latestPunch = latestPunches.find((punch) => punch.employeeId === session.id) ?? null;

  return Response.json({
    month,
    currentEmployeeId: session.id,
    canEditActualTime: timecardActualEditRoles.has(session.role),
    stores,
    selectedStoreId,
    employees,
    punches: typedPunches,
    shifts: shifts.map((row) => ({
      id: String(row.id),
      employeeId: String(row.employeeId),
      employeeName: String(row.employeeName),
      storeId: String(row.storeId),
      storeName: String(row.storeName),
      workDate: String(row.workDate),
      scheduledStart: row.scheduledStart ? String(row.scheduledStart) : null,
      scheduledEnd: row.scheduledEnd ? String(row.scheduledEnd) : null,
      breakMinutes: Number(row.breakMinutes ?? 0),
      note: row.note ? String(row.note) : null
    })),
    latestPunch,
    latestPunches,
    dailySummaries,
    payrollRows: payroll.rows,
    payrollTotals: payroll.totals
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as TimecardPostBody;
  const action = String(body.action ?? "punch");

  const storeId = String(body.storeId ?? "");
  if (!storeId) {
    return Response.json({ error: "店舗を選択してください。" }, { status: 400 });
  }

  if (!await canAccessStore(session, storeId)) {
    return Response.json({ error: "この店舗を操作する権限がありません。" }, { status: 403 });
  }

  if (action === "save_shift" || action === "delete_shift") {
    const employeeId = String(body.employeeId ?? "");
    const workDate = String(body.workDate ?? "");
    if (!employeeId || !isValidWorkDate(workDate)) {
      return Response.json({ error: "従業員と日付を確認してください。" }, { status: 400 });
    }

    if (!await canPunchForEmployee(storeId, employeeId)) {
      return Response.json({ error: "この従業員は選択した店舗のシフト対象ではありません。" }, { status: 403 });
    }

    if (action === "delete_shift") {
      await sql`
        delete from timecard_shifts
        where employee_id = ${employeeId}
          and store_id = ${storeId}
          and work_date = ${workDate}::date
      `;

      await writeAuditLog({
        actorEmployeeId: session.id,
        action: "timecard.shift.deleted",
        targetType: "timecard_shift",
        targetId: `${employeeId}:${storeId}:${workDate}`,
        metadata: { storeId, employeeId, workDate },
        request
      });

      return Response.json({ ok: true });
    }

    const scheduledStart = normalizeTimeValue(body.scheduledStart);
    const scheduledEnd = normalizeTimeValue(body.scheduledEnd);
    const breakMinutes = Math.max(0, Math.min(720, Math.round(Number(body.breakMinutes ?? 0) || 0)));
    if (!scheduledStart || !scheduledEnd) {
      return Response.json({ error: "開始時刻と終了時刻を入力してください。" }, { status: 400 });
    }

    const upserted = await sql`
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
        ${employeeId},
        ${storeId},
        ${workDate}::date,
        ${scheduledStart}::time,
        ${scheduledEnd}::time,
        ${breakMinutes},
        ${String(body.note ?? "").trim() || null},
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
      returning id::text
    `;

    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.shift.saved",
      targetType: "timecard_shift",
      targetId: String(upserted[0]?.id ?? ""),
      metadata: { storeId, employeeId, workDate, scheduledStart, scheduledEnd, breakMinutes },
      request
    });

    return Response.json({ ok: true, id: upserted[0]?.id ?? null });
  }

  if (action === "save_actual_time" || action === "delete_actual_time") {
    if (!timecardActualEditRoles.has(session.role)) {
      return Response.json({ error: "実勤務時間を修正する権限がありません。" }, { status: 403 });
    }

    const employeeId = String(body.employeeId ?? "");
    const workDate = String(body.workDate ?? "");
    if (!employeeId || !isValidWorkDate(workDate)) {
      return Response.json({ error: "従業員と日付を確認してください。" }, { status: 400 });
    }

    if (!await canPunchForEmployee(storeId, employeeId)) {
      return Response.json({ error: "この従業員は選択した店舗の実勤務対象ではありません。" }, { status: 403 });
    }

    const { start, end, overnightEnd } = getJstWorkDateRange(workDate);
    await sql`
      delete from timecard_punches
      where employee_id = ${employeeId}
        and store_id = ${storeId}
        and (
          (
            punch_type = 'clock_in'
            and punched_at >= ${start.toISOString()}
            and punched_at < ${end.toISOString()}
          )
          or (
            punch_type = 'clock_out'
            and punched_at >= ${start.toISOString()}
            and punched_at < ${overnightEnd.toISOString()}
          )
        )
    `;

    if (action === "delete_actual_time") {
      await writeAuditLog({
        actorEmployeeId: session.id,
        action: "timecard.actual_time.deleted",
        targetType: "timecard_punch",
        targetId: `${employeeId}:${storeId}:${workDate}`,
        metadata: { storeId, employeeId, workDate },
        request
      });

      return Response.json({ ok: true });
    }

    const clockIn = normalizeTimeValue(body.clockIn);
    const clockOut = normalizeTimeValue(body.clockOut);
    if (!clockIn && !clockOut) {
      return Response.json({ error: "出勤または退勤時刻を入力してください。" }, { status: 400 });
    }

    const insertedIds: string[] = [];
    if (clockIn) {
      const rows = await sql`
        insert into timecard_punches (
          employee_id,
          store_id,
          punch_type,
          punched_at,
          source,
          note,
          created_by
        )
        values (
          ${employeeId},
          ${storeId},
          'clock_in',
          ${toPunchDateTime(workDate, clockIn)},
          'manager_correction',
          ${String(body.note ?? "").trim() || null},
          ${session.id}
        )
        returning id::text
      `;
      insertedIds.push(String(rows[0]?.id ?? ""));
    }

    if (clockOut) {
      const rows = await sql`
        insert into timecard_punches (
          employee_id,
          store_id,
          punch_type,
          punched_at,
          source,
          note,
          created_by
        )
        values (
          ${employeeId},
          ${storeId},
          'clock_out',
          ${toPunchDateTime(workDate, clockOut, clockIn)},
          'manager_correction',
          ${String(body.note ?? "").trim() || null},
          ${session.id}
        )
        returning id::text
      `;
      insertedIds.push(String(rows[0]?.id ?? ""));
    }

    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.actual_time.saved",
      targetType: "timecard_punch",
      targetId: insertedIds.filter(Boolean).join(","),
      metadata: { storeId, employeeId, workDate, clockIn, clockOut },
      request
    });

    return Response.json({ ok: true, ids: insertedIds.filter(Boolean) });
  }

  const punchType = String(body.punchType ?? "");
  if (!isTimecardPunchType(punchType)) {
    return Response.json({ error: "打刻種別と店舗を確認してください。" }, { status: 400 });
  }

  const employeeId = String(body.employeeId ?? "");
  if (!employeeId) {
    return Response.json({ error: "打刻する従業員を選択してください。" }, { status: 400 });
  }

  if (!await canPunchForEmployee(storeId, employeeId)) {
    return Response.json({ error: "この従業員は選択した店舗で打刻できません。" }, { status: 403 });
  }

  const inserted = await sql`
    insert into timecard_punches (
      employee_id,
      store_id,
      punch_type,
      source,
      note,
      created_by
    )
    values (
      ${employeeId},
      ${storeId},
      ${punchType},
      'store_tablet',
      ${String(body.note ?? "").trim() || null},
      ${session.id}
    )
    returning id::text
  `;

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "timecard.punched",
    targetType: "timecard_punch",
    targetId: String(inserted[0]?.id ?? ""),
    metadata: { storeId, punchType, employeeId, createdBy: session.id },
    request
  });

  return Response.json({ ok: true, id: inserted[0]?.id ?? null });
}
