import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../lib/api-auth";
import { writeAuditLog } from "../../../lib/audit-log";
import { sql } from "../../../lib/db";
import {
  getJstDateLabel,
  getJstMonthLabel,
  isTimecardPunchType,
  summarizePayroll,
  summarizeTimecardDays,
  type TimecardEmployee,
  type TimecardPunch
} from "../../../lib/timecard";

type TimecardPostBody = {
  action?: string;
  storeId?: string;
  month?: string;
  punchType?: string;
  note?: string;
  employeeId?: string;
  workDate?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  clockIn?: string;
  clockOut?: string;
  breakMinutes?: number | string;
  shifts?: Array<{
    employeeId?: string;
    workDate?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    breakMinutes?: number | string;
    note?: string;
  }>;
};

type PayrollConfirmationRow = {
  id: string;
  storeId: string;
  payrollMonth: string;
  periodStart: string;
  periodEnd: string;
  confirmedAt: string;
  confirmedByName: string | null;
  payrollRows: unknown;
  payrollTotals: unknown;
};

const timecardActualEditRoles = new Set(["owner", "manager", "store_owner"]);
const timecardPayrollViewRoles = new Set(["owner", "manager", "store_owner"]);

const emptyPayrollTotals = {
  workDays: 0,
  punchCount: 0,
  workMinutes: 0,
  nightMinutes: 0,
  laborCost: 0,
  commuteAllowance: 0,
  totalPay: 0
};

function toMoneyNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

async function getVisibleStores(allStores: boolean, storeIds: string[]) {
  if (allStores) {
    return sql`
      select
        id::text,
        name,
        business_hours as "businessHours",
        coalesce(payroll_cycle_type, 'month_end') as "payrollCycleType",
        coalesce(payroll_closing_day, 31)::int as "payrollClosingDay",
        coalesce(social_insurance_prefecture, '福岡県') as "socialInsurancePrefecture"
      from stores
      where status = 'active'
      order by name
    `;
  }

  if (storeIds.length === 0) return [];

  return sql`
    select
      id::text,
      name,
      business_hours as "businessHours",
      coalesce(payroll_cycle_type, 'month_end') as "payrollCycleType",
      coalesce(payroll_closing_day, 31)::int as "payrollClosingDay",
      coalesce(social_insurance_prefecture, '福岡県') as "socialInsurancePrefecture"
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
            'storeId', payroll_settings.store_id::text,
            'payrollEnabled', payroll_settings.payroll_enabled,
            'employmentType', payroll_settings.employment_type,
            'hourlyWage', payroll_settings.hourly_wage,
            'monthlySalary', payroll_settings.monthly_salary,
            'commuteAllowancePerWorkday', payroll_settings.commute_allowance_per_workday,
            'commuteAllowanceMonthlyCap', payroll_settings.commute_allowance_monthly_cap,
            'validFrom', payroll_settings.valid_from,
            'wageValidFrom', payroll_settings.wage_valid_from,
            'commuteValidFrom', payroll_settings.commute_valid_from
          )
          order by stores.name, payroll_settings.valid_from desc
        ) filter (where stores.id is not null and payroll_settings.store_id is not null),
        '[]'::json
      ) as "storePayrollSettings"
    from employees
    join employee_work_stores
      on employee_work_stores.employee_id = employees.id
    join stores on stores.id = employee_work_stores.store_id
    left join lateral (
      select
        employee_work_stores.store_id,
        employee_work_stores.payroll_enabled,
        employee_work_stores.employment_type,
        employee_work_stores.hourly_wage,
        employee_work_stores.monthly_salary,
        employee_work_stores.commute_allowance_per_workday,
        employee_work_stores.commute_allowance_monthly_cap,
        '1970-01-01'::date as valid_from,
        '1970-01-01'::date as wage_valid_from,
        '1970-01-01'::date as commute_valid_from
      union all
      select
        employee_work_store_payroll_history.store_id,
        employee_work_store_payroll_history.payroll_enabled,
        employee_work_store_payroll_history.employment_type,
        employee_work_store_payroll_history.hourly_wage,
        employee_work_store_payroll_history.monthly_salary,
        employee_work_store_payroll_history.commute_allowance_per_workday,
        employee_work_store_payroll_history.commute_allowance_monthly_cap,
        employee_work_store_payroll_history.valid_from,
        employee_work_store_payroll_history.wage_valid_from,
        employee_work_store_payroll_history.commute_valid_from
      from employee_work_store_payroll_history
      where employee_work_store_payroll_history.employee_id = employee_work_stores.employee_id
        and employee_work_store_payroll_history.store_id = employee_work_stores.store_id
    ) payroll_settings on true
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
      commuteAllowancePerWorkday: toMoneyNumber(setting.commuteAllowancePerWorkday) ?? 0,
      commuteAllowanceMonthlyCap: toMoneyNumber(setting.commuteAllowanceMonthlyCap),
      validFrom: String(setting.validFrom ?? "1970-01-01").slice(0, 10),
      wageValidFrom: String(setting.wageValidFrom ?? setting.validFrom ?? "1970-01-01").slice(0, 10),
      commuteValidFrom: String(setting.commuteValidFrom ?? setting.validFrom ?? "1970-01-01").slice(0, 10)
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

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getPayrollDateRange(month: string, store?: { payrollCycleType?: unknown; payrollClosingDay?: unknown } | null) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const fallback = /^(\d{4})-(\d{2})$/.exec(getJstMonthLabel())!;
  const [, yearText, monthText] = match ?? fallback;
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const cycleType = store?.payrollCycleType === "specified_day" ? "specified_day" : "month_end";
  const closingDay = Math.max(1, Math.min(30, Math.round(Number(store?.payrollClosingDay ?? 31) || 31)));

  if (cycleType === "specified_day") {
    const startValue = new Date(Date.UTC(year, monthIndex - 1, closingDay + 1));
    const endValue = new Date(Date.UTC(year, monthIndex, closingDay + 1));
    const startDate = formatDateKey(startValue);
    const endDate = formatDateKey(endValue);
    return {
      startDate,
      endDate,
      startUtc: new Date(`${startDate}T00:00:00+09:00`),
      endUtc: new Date(`${endDate}T00:00:00+09:00`)
    };
  }

  const startDate = `${yearText}-${monthText}-01`;
  const endValue = new Date(Date.UTC(year, monthIndex + 1, 1));
  const endDate = formatDateKey(endValue);
  return {
    startDate,
    endDate,
    startUtc: new Date(`${startDate}T00:00:00+09:00`),
    endUtc: new Date(`${endDate}T00:00:00+09:00`)
  };
}

async function getPayrollConfirmation(storeId: string, month: string) {
  const rows = await sql`
    select
      timecard_payroll_confirmations.id::text,
      timecard_payroll_confirmations.store_id::text as "storeId",
      timecard_payroll_confirmations.payroll_month as "payrollMonth",
      to_char(timecard_payroll_confirmations.period_start, 'YYYY-MM-DD') as "periodStart",
      to_char(timecard_payroll_confirmations.period_end, 'YYYY-MM-DD') as "periodEnd",
      timecard_payroll_confirmations.confirmed_at as "confirmedAt",
      employees.name as "confirmedByName",
      timecard_payroll_confirmations.payroll_rows as "payrollRows",
      timecard_payroll_confirmations.payroll_totals as "payrollTotals"
    from timecard_payroll_confirmations
    left join employees on employees.id = timecard_payroll_confirmations.confirmed_by
    where timecard_payroll_confirmations.store_id::text = ${storeId}
      and timecard_payroll_confirmations.payroll_month = ${month}
    limit 1
  `;
  const row = rows[0] as PayrollConfirmationRow | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    storeId: String(row.storeId),
    payrollMonth: String(row.payrollMonth),
    periodStart: String(row.periodStart),
    periodEnd: String(row.periodEnd),
    confirmedAt: new Date(String(row.confirmedAt)).toISOString(),
    confirmedByName: row.confirmedByName ? String(row.confirmedByName) : null,
    payrollRows: Array.isArray(row.payrollRows) ? row.payrollRows : [],
    payrollTotals: row.payrollTotals && typeof row.payrollTotals === "object" ? row.payrollTotals : emptyPayrollTotals
  };
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
  const month = /^(\d{4})-(\d{2})$/.test(monthParam) ? monthParam : getJstMonthLabel();
  const scope = await getSessionStoreScope(session);
  const stores = await getVisibleStores(scope.allStores, scope.storeIds);
  const visibleStoreIds = stores.map((store) => String(store.id));
  const requestedStoreId = url.searchParams.get("storeId");
  const selectedStoreId = requestedStoreId && visibleStoreIds.includes(requestedStoreId)
    ? requestedStoreId
    : visibleStoreIds[0] ?? "";
  const selectedStore = stores.find((store) => String(store.id) === selectedStoreId) ?? null;
  const { startDate, endDate, startUtc, endUtc } = getPayrollDateRange(month, selectedStore);
  const punchWindowStartUtc = new Date(startUtc.getTime() - 36 * 60 * 60 * 1000);
  const punchWindowEndUtc = new Date(endUtc.getTime() + 36 * 60 * 60 * 1000);
  const canViewPayroll = timecardPayrollViewRoles.has(session.role);
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
      timecard_punches.source,
      timecard_punches.note
    from timecard_punches
    join employees on employees.id = timecard_punches.employee_id
    join stores on stores.id = timecard_punches.store_id
    where timecard_punches.store_id::text = ${selectedStoreId}
      and timecard_punches.punched_at >= ${punchWindowStartUtc.toISOString()}
      and timecard_punches.punched_at < ${punchWindowEndUtc.toISOString()}
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
      source: row.source ? String(row.source) : null,
      note: row.note ? String(row.note) : null
    };
  }) satisfies TimecardPunch[];

  const dailySummaries = summarizeTimecardDays(typedPunches, {
    workDateStart: startDate,
    workDateEndExclusive: endDate
  });
  const payroll = canViewPayroll ? summarizePayroll(employees, dailySummaries) : { rows: [], totals: emptyPayrollTotals };
  const payrollConfirmation = canViewPayroll && selectedStoreId
    ? await getPayrollConfirmation(selectedStoreId, month)
    : null;
  const responseEmployees = canViewPayroll
    ? employees
    : employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      role: employee.role,
      status: employee.status,
      storeIds: employee.storeIds,
      storePayrollSettings: []
    }));

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
    canViewPayroll,
    stores,
    selectedStoreId,
    payrollPeriod: { startDate, endDate },
    employees: responseEmployees,
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
    payrollConfirmation,
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

  if (action === "confirm_payroll") {
    if (!timecardPayrollViewRoles.has(session.role)) {
      return Response.json({ error: "給与を確定する権限がありません。" }, { status: 403 });
    }

    const monthParam = String(body.month ?? getJstMonthLabel());
    const month = /^(\d{4})-(\d{2})$/.test(monthParam) ? monthParam : getJstMonthLabel();
    const storeRows = await sql`
      select
        id::text,
        coalesce(payroll_cycle_type, 'month_end') as "payrollCycleType",
        coalesce(payroll_closing_day, 31)::int as "payrollClosingDay"
      from stores
      where id::text = ${storeId}
      limit 1
    `;
    const store = storeRows[0] ?? null;
    if (!store) {
      return Response.json({ error: "店舗が見つかりません。" }, { status: 404 });
    }

    const { startDate, endDate, startUtc, endUtc } = getPayrollDateRange(month, store);
    if (getJstDateLabel(new Date()) < endDate) {
      return Response.json({ error: "この月度はまだ締め日前のため、給与を確定できません。" }, { status: 409 });
    }
    const punchWindowStartUtc = new Date(startUtc.getTime() - 36 * 60 * 60 * 1000);
    const punchWindowEndUtc = new Date(endUtc.getTime() + 36 * 60 * 60 * 1000);
    const scope = await getSessionStoreScope(session);
    const employees = await getVisibleEmployees(scope.allStores, scope.storeIds);
    const punches = await sql`
      select
        timecard_punches.id::text,
        timecard_punches.employee_id::text as "employeeId",
        employees.name as "employeeName",
        timecard_punches.store_id::text as "storeId",
        stores.name as "storeName",
        timecard_punches.punch_type as "punchType",
        timecard_punches.punched_at as "punchedAt",
        timecard_punches.source,
        timecard_punches.note
      from timecard_punches
      join employees on employees.id = timecard_punches.employee_id
      join stores on stores.id = timecard_punches.store_id
      where timecard_punches.store_id::text = ${storeId}
        and timecard_punches.punched_at >= ${punchWindowStartUtc.toISOString()}
        and timecard_punches.punched_at < ${punchWindowEndUtc.toISOString()}
      order by timecard_punches.punched_at desc
    `;
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
        source: row.source ? String(row.source) : null,
        note: row.note ? String(row.note) : null
      };
    }) satisfies TimecardPunch[];
    const dailySummaries = summarizeTimecardDays(typedPunches, {
      workDateStart: startDate,
      workDateEndExclusive: endDate
    });
    const payroll = summarizePayroll(employees, dailySummaries);

    const upserted = await sql`
      insert into timecard_payroll_confirmations (
        store_id,
        payroll_month,
        period_start,
        period_end,
        payroll_rows,
        payroll_totals,
        confirmed_by,
        confirmed_at,
        updated_at
      )
      values (
        ${storeId},
        ${month},
        ${startDate}::date,
        ${endDate}::date,
        ${JSON.stringify(payroll.rows)}::jsonb,
        ${JSON.stringify(payroll.totals)}::jsonb,
        ${session.id},
        now(),
        now()
      )
      on conflict (store_id, payroll_month)
      do update set
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        payroll_rows = excluded.payroll_rows,
        payroll_totals = excluded.payroll_totals,
        confirmed_by = excluded.confirmed_by,
        confirmed_at = now(),
        updated_at = now()
      returning id::text
    `;

    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "timecard.payroll.confirmed",
      targetType: "timecard_payroll_confirmation",
      targetId: String(upserted[0]?.id ?? ""),
      metadata: { storeId, month, rowCount: payroll.rows.length, totals: payroll.totals },
      request
    });

    return Response.json({ ok: true, id: upserted[0]?.id ?? null });
  }

  if (action === "save_shift" || action === "delete_shift" || action === "save_shifts_bulk" || action === "delete_shifts_bulk") {
    if (action === "save_shifts_bulk" || action === "delete_shifts_bulk") {
      const shifts = Array.isArray(body.shifts) ? body.shifts : [];
      if (!shifts.length) {
        return Response.json({ error: "対象のシフトを選択してください。" }, { status: 400 });
      }
      if (shifts.length > 120) {
        return Response.json({ error: "一度に編集できるシフトは120件までです。" }, { status: 400 });
      }

      const normalizedShifts = [];
      for (const shift of shifts) {
        const employeeId = String(shift.employeeId ?? "");
        const workDate = String(shift.workDate ?? "");
        if (!employeeId || !isValidWorkDate(workDate)) {
          return Response.json({ error: "従業員と日付を確認してください。" }, { status: 400 });
        }
        if (!await canPunchForEmployee(storeId, employeeId)) {
          return Response.json({ error: "この従業員は選択した店舗のシフト対象ではありません。" }, { status: 403 });
        }
        normalizedShifts.push({ ...shift, employeeId, workDate });
      }

      if (action === "delete_shifts_bulk") {
        for (const shift of normalizedShifts) {
          await sql`
            delete from timecard_shifts
            where employee_id = ${shift.employeeId}
              and store_id = ${storeId}
              and work_date = ${shift.workDate}::date
          `;
        }

        await writeAuditLog({
          actorEmployeeId: session.id,
          action: "timecard.shift.bulk_deleted",
          targetType: "timecard_shift",
          targetId: storeId,
          metadata: { storeId, count: normalizedShifts.length, shifts: normalizedShifts.map((shift) => ({ employeeId: shift.employeeId, workDate: shift.workDate })) },
          request
        });

        return Response.json({ ok: true, count: normalizedShifts.length });
      }

      const upsertedIds: string[] = [];
      for (const shift of normalizedShifts) {
        const scheduledStart = normalizeTimeValue(shift.scheduledStart);
        const scheduledEnd = normalizeTimeValue(shift.scheduledEnd);
        const breakMinutes = Math.max(0, Math.min(720, Math.round(Number(shift.breakMinutes ?? 0) || 0)));
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
            ${shift.employeeId},
            ${storeId},
            ${shift.workDate}::date,
            ${scheduledStart}::time,
            ${scheduledEnd}::time,
            ${breakMinutes},
            ${String(shift.note ?? "").trim() || null},
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
        upsertedIds.push(String(upserted[0]?.id ?? ""));
      }

      await writeAuditLog({
        actorEmployeeId: session.id,
        action: "timecard.shift.bulk_saved",
        targetType: "timecard_shift",
        targetId: storeId,
        metadata: { storeId, count: normalizedShifts.length, ids: upsertedIds.filter(Boolean) },
        request
      });

      return Response.json({ ok: true, count: normalizedShifts.length, ids: upsertedIds.filter(Boolean) });
    }

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
