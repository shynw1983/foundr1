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
  storeId?: string;
  punchType?: string;
  note?: string;
  employeeId?: string;
};

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
      employees.payroll_subject as "payrollSubject",
      coalesce(
        array_agg(stores.id::text order by stores.name) filter (where stores.id is not null),
        '{}'::text[]
      ) as "storeIds",
      coalesce(latest_settings.employment_type, 'hourly') as "employmentType",
      latest_settings.hourly_wage as "hourlyWage",
      latest_settings.monthly_salary as "monthlySalary",
      coalesce(latest_settings.commute_allowance_per_workday, 0) as "commuteAllowancePerWorkday",
      coalesce(latest_settings.payroll_enabled, employees.payroll_subject = 'paid') as "payrollEnabled"
    from employees
    join employee_work_stores
      on employee_work_stores.employee_id = employees.id
    join stores on stores.id = employee_work_stores.store_id
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
      and employees.staff_category = 'working'
      and (
        ${allStores}
        or employee_work_stores.store_id::text = any(${scopedStoreIds})
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
    payrollEnabled: row.payrollSubject === "paid" && row.payrollEnabled !== false
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
    stores,
    selectedStoreId,
    employees,
    punches: typedPunches,
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

  const storeId = String(body.storeId ?? "");
  const punchType = String(body.punchType ?? "");
  if (!storeId || !isTimecardPunchType(punchType)) {
    return Response.json({ error: "打刻種別と店舗を確認してください。" }, { status: 400 });
  }

  if (!await canAccessStore(session, storeId)) {
    return Response.json({ error: "この店舗で打刻する権限がありません。" }, { status: 403 });
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
