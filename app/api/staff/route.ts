import { requireOwnerOsSession } from "../../../lib/api-auth";
import { writeAuditLog } from "../../../lib/audit-log";
import { hashPassword, validatePasswordStrength } from "../../../lib/auth";
import { sql } from "../../../lib/db";

type StaffPayload = {
  name?: string;
  loginId?: string;
  email?: string;
  gender?: string;
  nameKana?: string;
  address?: string;
  birthDate?: string;
  employeeNumber?: string;
  hireDate?: string;
  resignationDate?: string;
  resignationReason?: string;
  businessType?: string;
  isForeignNational?: boolean;
  employeeType?: string;
  larkOpenId?: string;
  larkUserId?: string;
  password?: string;
  role?: string;
  staffCategory?: string;
  payrollSubject?: string;
  employmentType?: string;
  hourlyWage?: number | string | null;
  monthlySalary?: number | string | null;
  commuteAllowancePerWorkday?: number | string | null;
  commuteAllowanceMonthlyCap?: number | string | null;
  status?: string;
  storeIds?: string[];
  visibleStoreIds?: string[];
  workStoreIds?: string[];
  workStoreSettings?: WorkStoreSettingPayload[];
};

type WorkStoreSettingPayload = {
  storeId?: string;
  payrollEnabled?: boolean;
  employmentType?: string;
  hourlyWage?: number | string | null;
  monthlySalary?: number | string | null;
  commuteAllowancePerWorkday?: number | string | null;
  commuteAllowanceMonthlyCap?: number | string | null;
  applySocialInsurance?: boolean;
  applyLaborInsurance?: boolean;
  applyIncomeTax?: boolean;
  applyResidentTax?: boolean;
  validFrom?: string;
  validFromMonth?: string;
  wageValidFromMonth?: string;
  commuteValidFromMonth?: string;
};

type StorePayrollConfig = {
  payrollCycleType?: unknown;
  payrollClosingDay?: unknown;
};

function normalizeRole(role?: string) {
  return ["owner", "manager", "buyer", "store_owner", "staff"].includes(role ?? "") ? role as string : "staff";
}

function normalizeStatus(status?: string) {
  return status === "inactive" ? "inactive" : "active";
}

function normalizeStaffCategory(category?: string) {
  return ["executive", "management", "working"].includes(category ?? "") ? category as string : "working";
}

function normalizePayrollSubject(subject?: string) {
  return ["paid", "unpaid", "none"].includes(subject ?? "") ? subject as string : "none";
}

function normalizeGender(gender?: string) {
  return ["male", "female", "other", "unspecified"].includes(gender ?? "") ? gender as string : "unspecified";
}

function normalizeEmployeeType(type?: string) {
  return type === "full_time" ? "full_time" : "part_time";
}

function normalizeEmploymentType(type?: string) {
  return type === "monthly" ? "monthly" : "hourly";
}

function toNullableText(value: string | undefined) {
  const text = String(value ?? "").trim();
  return text || null;
}

function toNullableDate(value: string | undefined) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizePayrollMonth(value: string | undefined) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : getJstMonthLabel();
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getJstDateLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getJstMonthLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(date);
}

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getPayrollMonthStartDate(month: string, store?: StorePayrollConfig) {
  const match = /^(\d{4})-(\d{2})$/.exec(month) ?? /^(\d{4})-(\d{2})$/.exec(getJstMonthLabel())!;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const cycleType = store?.payrollCycleType === "specified_day" ? "specified_day" : "month_end";
  const closingDay = Math.max(1, Math.min(30, Math.round(Number(store?.payrollClosingDay ?? 31) || 31)));
  if (cycleType === "specified_day") {
    return formatDateKey(new Date(Date.UTC(year, monthIndex - 1, closingDay + 1)));
  }
  return `${match[1]}-${match[2]}-01`;
}

export async function GET() {
  const session = await requireOwnerOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const employees = await sql`
    select
      employees.id,
      employees.name,
      employees.login_id as "loginId",
      employees.email,
      employees.gender,
      employees.name_kana as "nameKana",
      employees.address,
      employees.birth_date as "birthDate",
      employees.employee_number as "employeeNumber",
      employees.hire_date as "hireDate",
      employees.resignation_date as "resignationDate",
      employees.resignation_reason as "resignationReason",
      employees.business_type as "businessType",
      employees.is_foreign_national as "isForeignNational",
      employees.employee_type as "employeeType",
      employees.lark_open_id as "larkOpenId",
      employees.lark_user_id as "larkUserId",
      employees.role,
      employees.staff_category as "staffCategory",
      employees.payroll_subject as "payrollSubject",
      employees.status,
      employees.last_seen_at as "lastSeenAt",
      latest_settings.employment_type as "employmentType",
      latest_settings.hourly_wage as "hourlyWage",
      latest_settings.monthly_salary as "monthlySalary",
      latest_settings.commute_allowance_per_workday as "commuteAllowancePerWorkday",
      latest_settings.commute_allowance_monthly_cap as "commuteAllowanceMonthlyCap",
      latest_settings.payroll_enabled as "payrollEnabled",
      coalesce(visible_stores.stores, '[]'::json) as "visibleStores",
      coalesce(work_stores.stores, '[]'::json) as "workStores"
    from employees
    left join lateral (
      select
        employment_type,
        hourly_wage,
        monthly_salary,
        commute_allowance_per_workday,
        commute_allowance_monthly_cap,
        payroll_enabled
      from timecard_employee_settings
      where timecard_employee_settings.employee_id = employees.id
      order by valid_from desc, created_at desc
      limit 1
    ) latest_settings on true
    left join lateral (
      select json_agg(json_build_object('id', stores.id, 'name', stores.name) order by stores.name) as stores
      from employee_scopes
      join stores on stores.id = employee_scopes.store_id
      where employee_scopes.employee_id = employees.id
        and employee_scopes.scope_type = 'store'
    ) visible_stores on true
    left join lateral (
      select json_agg(
        json_build_object(
          'id', stores.id,
          'name', stores.name,
          'payrollEnabled', employee_work_stores.payroll_enabled,
          'employmentType', employee_work_stores.employment_type,
          'hourlyWage', employee_work_stores.hourly_wage,
          'monthlySalary', employee_work_stores.monthly_salary,
          'commuteAllowancePerWorkday', employee_work_stores.commute_allowance_per_workday,
          'commuteAllowanceMonthlyCap', employee_work_stores.commute_allowance_monthly_cap,
          'applySocialInsurance', employee_work_stores.apply_social_insurance,
          'applyLaborInsurance', employee_work_stores.apply_labor_insurance,
          'applyIncomeTax', employee_work_stores.apply_income_tax,
          'applyResidentTax', employee_work_stores.apply_resident_tax,
          'payrollHistory', coalesce(payroll_history.records, '[]'::json)
        )
        order by stores.name
      ) as stores
      from employee_work_stores
      join stores on stores.id = employee_work_stores.store_id
      left join lateral (
        select json_agg(
          json_build_object(
            'validFrom', employee_work_store_payroll_history.valid_from,
            'payrollEnabled', employee_work_store_payroll_history.payroll_enabled,
            'employmentType', employee_work_store_payroll_history.employment_type,
            'hourlyWage', employee_work_store_payroll_history.hourly_wage,
            'monthlySalary', employee_work_store_payroll_history.monthly_salary,
            'commuteAllowancePerWorkday', employee_work_store_payroll_history.commute_allowance_per_workday,
            'commuteAllowanceMonthlyCap', employee_work_store_payroll_history.commute_allowance_monthly_cap,
            'applySocialInsurance', employee_work_store_payroll_history.apply_social_insurance,
          'applyLaborInsurance', employee_work_store_payroll_history.apply_labor_insurance,
          'applyIncomeTax', employee_work_store_payroll_history.apply_income_tax,
            'applyResidentTax', employee_work_store_payroll_history.apply_resident_tax,
            'wageValidFrom', employee_work_store_payroll_history.wage_valid_from,
            'commuteValidFrom', employee_work_store_payroll_history.commute_valid_from
          )
          order by employee_work_store_payroll_history.valid_from desc, employee_work_store_payroll_history.created_at desc
        ) as records
        from employee_work_store_payroll_history
        where employee_work_store_payroll_history.employee_id = employee_work_stores.employee_id
          and employee_work_store_payroll_history.store_id = employee_work_stores.store_id
      ) payroll_history on true
      where employee_work_stores.employee_id = employees.id
    ) work_stores on true
    order by employees.created_at desc
  `;

  const stores = await sql`
    select
      stores.id,
      stores.name,
      companies.name as "companyName",
      coalesce(stores.payroll_cycle_type, 'month_end') as "payrollCycleType",
      coalesce(stores.payroll_closing_day, 31)::int as "payrollClosingDay"
    from stores
    left join companies on companies.id = stores.company_id
    where stores.status = 'active'
    order by companies.name nulls last, stores.name
  `;

  return Response.json({
    employees: employees.map((employee) => ({
      ...employee,
      stores: employee.visibleStores
    })),
    stores,
    currentUserId: session.id
  });
}

export async function POST(request: Request) {
  const session = await requireOwnerOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as StaffPayload;
  const name = String(body.name ?? "").trim();
  const loginId = String(body.loginId ?? "").trim();
  const email = String(body.email ?? "").trim();
  const gender = normalizeGender(body.gender);
  const nameKana = toNullableText(body.nameKana);
  const address = toNullableText(body.address);
  const birthDate = toNullableDate(body.birthDate);
  const employeeNumber = toNullableText(body.employeeNumber);
  const hireDate = toNullableDate(body.hireDate);
  const resignationDate = toNullableDate(body.resignationDate);
  const resignationReason = toNullableText(body.resignationReason);
  const businessType = toNullableText(body.businessType);
  const isForeignNational = Boolean(body.isForeignNational);
  const employeeType = normalizeEmployeeType(body.employeeType);
  const larkOpenId = String(body.larkOpenId ?? "").trim();
  const larkUserId = String(body.larkUserId ?? "").trim();
  const password = String(body.password ?? "");
  const role = normalizeRole(body.role);
  const staffCategory = normalizeStaffCategory(body.staffCategory);
  const payrollSubject = normalizePayrollSubject(body.payrollSubject);
  const employmentType = normalizeEmploymentType(body.employmentType);
  const hourlyWage = toNullableNumber(body.hourlyWage);
  const monthlySalary = toNullableNumber(body.monthlySalary);
  const commuteAllowancePerWorkday = toNullableNumber(body.commuteAllowancePerWorkday) ?? 0;
  const commuteAllowanceMonthlyCap = toNullableNumber(body.commuteAllowanceMonthlyCap);
  const status = normalizeStatus(body.status);
  const visibleStoreIds = Array.isArray(body.visibleStoreIds) ? body.visibleStoreIds.map(String) : Array.isArray(body.storeIds) ? body.storeIds.map(String) : [];
  const workStoreIds = Array.isArray(body.workStoreIds) ? body.workStoreIds.map(String) : [];
  const workStoreSettings = Array.isArray(body.workStoreSettings) ? body.workStoreSettings : [];

  if (!name || !loginId || !password) {
    return Response.json({ error: "氏名、ログインID、初期パスワードを入力してください。" }, { status: 400 });
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return Response.json({ error: passwordError }, { status: 400 });
  }

  const rows = await sql`
    insert into employees (
      name,
      login_id,
      email,
      gender,
      name_kana,
      address,
      birth_date,
      employee_number,
      hire_date,
      resignation_date,
      resignation_reason,
      business_type,
      is_foreign_national,
      employee_type,
      lark_open_id,
      lark_user_id,
      role,
      staff_category,
      payroll_subject,
      status,
      password_hash,
      updated_at
    )
    values (
      ${name},
      ${loginId},
      ${email || null},
      ${gender},
      ${nameKana},
      ${address},
      ${birthDate},
      ${employeeNumber},
      ${hireDate},
      ${resignationDate},
      ${resignationReason},
      ${businessType},
      ${isForeignNational},
      ${employeeType},
      ${larkOpenId || null},
      ${larkUserId || null},
      ${role},
      ${staffCategory},
      ${payrollSubject},
      ${status},
      ${hashPassword(password)},
      now()
    )
    returning id
  `;
  const employeeId = rows[0]?.id;

  await sql`
    insert into timecard_employee_settings (
      employee_id,
      employment_type,
      hourly_wage,
      monthly_salary,
      commute_allowance_per_workday,
      commute_allowance_monthly_cap,
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
      ${commuteAllowanceMonthlyCap},
      ${payrollSubject === "paid"},
      ${session.id},
      now()
    )
  `;

  for (const storeId of visibleStoreIds) {
    await sql`
      insert into employee_scopes (employee_id, scope_type, store_id)
      values (${employeeId}, 'store', ${storeId})
      on conflict do nothing
    `;
  }

  const payrollStoreRows = await sql`
    select
      id::text,
      coalesce(payroll_cycle_type, 'month_end') as "payrollCycleType",
      coalesce(payroll_closing_day, 31)::int as "payrollClosingDay"
    from stores
    where id::text = any(${workStoreIds.length ? workStoreIds : ["__none__"]})
  `;
  const payrollStoreById = new Map(payrollStoreRows.map((store) => [String(store.id), store]));

  for (const storeId of workStoreIds) {
    const storeSetting = workStoreSettings.find((setting) => String(setting.storeId ?? "") === storeId);
    const payrollStore = payrollStoreById.get(storeId);
    const storeEmploymentType = normalizeEmploymentType(storeSetting?.employmentType ?? employmentType);
    const storeHourlyWage = toNullableNumber(storeSetting?.hourlyWage) ?? hourlyWage;
    const storeMonthlySalary = toNullableNumber(storeSetting?.monthlySalary) ?? monthlySalary;
    const storeCommuteAllowancePerWorkday = toNullableNumber(storeSetting?.commuteAllowancePerWorkday) ?? commuteAllowancePerWorkday;
    const storeCommuteAllowanceMonthlyCap = toNullableNumber(storeSetting?.commuteAllowanceMonthlyCap) ?? commuteAllowanceMonthlyCap;
    const storePayrollEnabled = storeSetting?.payrollEnabled !== false;
    const storeWageValidFrom = getPayrollMonthStartDate(normalizePayrollMonth(storeSetting?.wageValidFromMonth ?? storeSetting?.validFromMonth ?? storeSetting?.validFrom?.slice(0, 7)), payrollStore);
    const storeCommuteValidFrom = getPayrollMonthStartDate(normalizePayrollMonth(storeSetting?.commuteValidFromMonth ?? storeSetting?.validFromMonth ?? storeSetting?.validFrom?.slice(0, 7)), payrollStore);
    const storeValidFrom = storeWageValidFrom < storeCommuteValidFrom ? storeWageValidFrom : storeCommuteValidFrom;
    await sql`
      insert into employee_work_stores (
        employee_id,
        store_id,
        payroll_enabled,
        employment_type,
        hourly_wage,
        monthly_salary,
        commute_allowance_per_workday,
        commute_allowance_monthly_cap,
        apply_social_insurance,
        apply_labor_insurance,
        apply_income_tax,
        apply_resident_tax
      )
      values (
        ${employeeId},
        ${storeId},
        ${storePayrollEnabled},
        ${storeEmploymentType},
        ${storeHourlyWage},
        ${storeMonthlySalary},
        ${storeCommuteAllowancePerWorkday},
        ${storeCommuteAllowanceMonthlyCap},
        ${Boolean(storeSetting?.applySocialInsurance)},
        ${Boolean(storeSetting?.applyLaborInsurance)},
        ${Boolean(storeSetting?.applyIncomeTax)},
        ${Boolean(storeSetting?.applyResidentTax)}
      )
      on conflict do nothing
    `;
    await sql`
      insert into employee_work_store_payroll_history (
        employee_id,
        store_id,
        payroll_enabled,
        employment_type,
        hourly_wage,
        monthly_salary,
        commute_allowance_per_workday,
        commute_allowance_monthly_cap,
        apply_social_insurance,
        apply_labor_insurance,
        apply_income_tax,
        apply_resident_tax,
        wage_valid_from,
        commute_valid_from,
        valid_from,
        updated_by,
        updated_at
      )
      values (
        ${employeeId},
        ${storeId},
        ${storePayrollEnabled},
        ${storeEmploymentType},
        ${storeHourlyWage},
        ${storeMonthlySalary},
        ${storeCommuteAllowancePerWorkday},
        ${storeCommuteAllowanceMonthlyCap},
        ${Boolean(storeSetting?.applySocialInsurance)},
        ${Boolean(storeSetting?.applyLaborInsurance)},
        ${Boolean(storeSetting?.applyIncomeTax)},
        ${Boolean(storeSetting?.applyResidentTax)},
        ${storeWageValidFrom},
        ${storeCommuteValidFrom},
        ${storeValidFrom},
        ${session.id},
        now()
      )
      on conflict (employee_id, store_id, wage_valid_from, commute_valid_from) do update set
        payroll_enabled = excluded.payroll_enabled,
        employment_type = excluded.employment_type,
        hourly_wage = excluded.hourly_wage,
        monthly_salary = excluded.monthly_salary,
        commute_allowance_per_workday = excluded.commute_allowance_per_workday,
        commute_allowance_monthly_cap = excluded.commute_allowance_monthly_cap,
        apply_social_insurance = excluded.apply_social_insurance,
        apply_labor_insurance = excluded.apply_labor_insurance,
        apply_income_tax = excluded.apply_income_tax,
        apply_resident_tax = excluded.apply_resident_tax,
        valid_from = excluded.valid_from,
        updated_by = excluded.updated_by,
        updated_at = now()
    `;
  }

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "staff.created",
    targetType: "employee",
    targetId: String(employeeId ?? ""),
    metadata: { role, staffCategory, payrollSubject, status, employeeType, visibleStoreCount: visibleStoreIds.length, workStoreCount: workStoreIds.length },
    request
  });

  return Response.json({ ok: true });
}
