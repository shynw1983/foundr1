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
  employmentType?: string;
  hourlyWage?: number | string | null;
  monthlySalary?: number | string | null;
  commuteAllowancePerWorkday?: number | string | null;
  payrollEnabled?: boolean;
};

const managerRoles = new Set(["owner", "manager", "store_owner"]);

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toMoneyNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

async function getVisibleStores(allStores: boolean, storeIds: string[]) {
  if (allStores) {
    return sql`
      select id::text, name
      from stores
      where status = 'active'
      order by name
    `;
  }

  if (storeIds.length === 0) return [];

  return sql`
    select id::text, name
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
      coalesce(latest_settings.employment_type, 'hourly') as "employmentType",
      latest_settings.hourly_wage as "hourlyWage",
      latest_settings.monthly_salary as "monthlySalary",
      coalesce(latest_settings.commute_allowance_per_workday, 0) as "commuteAllowancePerWorkday",
      coalesce(latest_settings.payroll_enabled, true) as "payrollEnabled"
    from employees
    left join employee_scopes
      on employee_scopes.employee_id = employees.id
      and employee_scopes.scope_type = 'store'
    left join stores on stores.id = employee_scopes.store_id
    left join lateral (
      select
        employment_type,
        hourly_wage,
        monthly_salary,
        commute_allowance_per_workday,
        payroll_enabled
      from timecard_employee_settings
      where timecard_employee_settings.employee_id = employees.id
      order by valid_from desc, created_at desc
      limit 1
    ) latest_settings on true
    where employees.status = 'active'
      and (
        ${allStores}
        or employee_scopes.store_id::text = any(${scopedStoreIds})
      )
    group by employees.id, latest_settings.employment_type, latest_settings.hourly_wage, latest_settings.monthly_salary, latest_settings.commute_allowance_per_workday, latest_settings.payroll_enabled
    order by employees.name
  `;

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    role: String(row.role),
    status: String(row.status),
    storeIds: Array.isArray(row.storeIds) ? row.storeIds.map(String) : [],
    employmentType: row.employmentType === "monthly" ? "monthly" : "hourly",
    hourlyWage: toMoneyNumber(row.hourlyWage),
    monthlySalary: toMoneyNumber(row.monthlySalary),
    commuteAllowancePerWorkday: toMoneyNumber(row.commuteAllowancePerWorkday) ?? 0,
    payrollEnabled: row.payrollEnabled !== false
  })) satisfies TimecardEmployee[];
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month") || getJstMonthLabel();
  const { month, startUtc, endUtc } = getJstMonthRange(monthParam);
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
    where timecard_punches.store_id::text = ${selectedStoreId}
      and timecard_punches.employee_id = ${session.id}
    order by timecard_punches.punched_at desc
    limit 1
  ` : [];
  const latestPunch = latestPunchRows[0];

  return Response.json({
    month,
    currentEmployeeId: session.id,
    currentRole: session.role,
    canManage: managerRoles.has(session.role),
    stores,
    selectedStoreId,
    employees,
    punches: typedPunches,
    latestPunch: latestPunch ? {
      id: String(latestPunch.id),
      punchType: String(latestPunch.punchType),
      punchedAt: new Date(String(latestPunch.punchedAt)).toISOString()
    } : null,
    dailySummaries,
    payrollRows: payroll.rows,
    payrollTotals: payroll.totals
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as TimecardPostBody;

  if (body.action === "employee_settings") {
    if (!managerRoles.has(session.role)) {
      return Response.json({ error: "権限がありません。" }, { status: 403 });
    }

    const employeeId = String(body.employeeId ?? "");
    const rows = await sql`
      select id::text
      from employees
      where id = ${employeeId}
        and status = 'active'
      limit 1
    `;

    if (!rows[0]) {
      return Response.json({ error: "従業員が見つかりません。" }, { status: 404 });
    }

    if (session.role === "store_owner") {
      const scope = await getSessionStoreScope(session);
      const scopedRows = scope.storeIds.length ? await sql`
        select employee_scopes.id::text
        from employee_scopes
        where employee_scopes.employee_id = ${employeeId}
          and employee_scopes.scope_type = 'store'
          and employee_scopes.store_id::text = any(${scope.storeIds})
        limit 1
      ` : [];
      if (!scopedRows[0]) {
        return Response.json({ error: "この従業員の給与設定を編集する権限がありません。" }, { status: 403 });
      }
    }

    const employmentType = body.employmentType === "monthly" ? "monthly" : "hourly";
    const hourlyWage = toNullableNumber(body.hourlyWage);
    const monthlySalary = toNullableNumber(body.monthlySalary);
    const commuteAllowancePerWorkday = toNullableNumber(body.commuteAllowancePerWorkday) ?? 0;
    const payrollEnabled = body.payrollEnabled !== false;

    const inserted = await sql`
      insert into timecard_employee_settings (
        employee_id,
        employment_type,
        hourly_wage,
        monthly_salary,
        commute_allowance_per_workday,
        payroll_enabled,
        updated_by,
        updated_at
      )
      values (
        ${employeeId},
        ${employmentType},
        ${hourlyWage},
        ${monthlySalary},
        ${commuteAllowancePerWorkday},
        ${payrollEnabled},
        ${session.id},
        now()
      )
      returning id::text
    `;

    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.employee_settings.updated",
      targetType: "employee",
      targetId: employeeId,
      metadata: { employmentType, hourlyWage, monthlySalary, commuteAllowancePerWorkday, payrollEnabled },
      request
    });

    return Response.json({ ok: true, id: inserted[0]?.id ?? null });
  }

  const storeId = String(body.storeId ?? "");
  const punchType = String(body.punchType ?? "");
  if (!storeId || !isTimecardPunchType(punchType)) {
    return Response.json({ error: "打刻種別と店舗を確認してください。" }, { status: 400 });
  }

  if (!await canAccessStore(session, storeId)) {
    return Response.json({ error: "この店舗で打刻する権限がありません。" }, { status: 403 });
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
      ${session.id},
      ${storeId},
      ${punchType},
      'store',
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
    metadata: { storeId, punchType },
    request
  });

  return Response.json({ ok: true, id: inserted[0]?.id ?? null });
}
