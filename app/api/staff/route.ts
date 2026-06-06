import { requireStaffAdminSession, canAssignStaffRole, canManageTargetRole, filterStoreIdsForStaffAdmin, hasValidScopedStoreSelection } from "../../../lib/staff-admin-access";
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
  employeeNumber?: string;
  hireDate?: string;
  resignationDate?: string;
  resignationReason?: string;
  businessType?: string;
  employeeType?: string;
  payrollEnabled?: boolean;
  employmentType?: string;
  hourlyWage?: number | string | null;
  monthlySalary?: number | string | null;
  commuteAllowancePerWorkday?: number | string | null;
  commuteAllowanceMonthlyCap?: number | string | null;
  applySocialInsurance?: boolean;
  socialInsuranceStandardMonthlyAmount?: number | string | null;
  socialInsuranceDeductionFromMonth?: string;
  applyEmploymentInsurance?: boolean;
  employmentInsuranceDeductionFromMonth?: string;
  applyLaborInsurance?: boolean;
  applyIncomeTax?: boolean;
  incomeTaxCategory?: string;
  dependentCount?: number | string | null;
  applyResidentTax?: boolean;
  residentTaxYear?: number | string | null;
  residentTaxJuneAmount?: number | string | null;
  residentTaxMonthlyAmount?: number | string | null;
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
  return ["owner", "manager", "store_owner", "store_manager", "store_terminal", "staff"].includes(role ?? "") ? role as string : "staff";
}

function normalizeStatus(status?: string) {
  return status === "inactive" ? "inactive" : "active";
}

function normalizeStaffCategory(category?: string) {
  return ["executive", "management", "working", "device"].includes(category ?? "") ? category as string : "working";
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

function normalizeIncomeTaxCategory(category?: string) {
  return category === "kou" || category === "otsu" ? category : "none";
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

function normalizeDependentCount(value: number | string | null | undefined) {
  return Math.max(0, Math.min(7, Math.round(Number(value ?? 0) || 0)));
}

function normalizeResidentTaxYear(value: number | string | null | undefined) {
  const number = Math.round(Number(value ?? 0) || 0);
  if (number >= 1900 && number <= 2999) return number;
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 6 ? now.getFullYear() : now.getFullYear() - 1;
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
  const access = await requireStaffAdminSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const session = access.session;

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
      employees.is_foreign_national as "isForeignNational",
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
      select json_agg(json_build_object(
        'id', stores.id,
        'name', stores.name,
        'companyName', companies.name
      ) order by stores.name) as stores
      from employee_scopes
      join stores on stores.id = employee_scopes.store_id
      left join companies on companies.id = stores.company_id
      where employee_scopes.employee_id = employees.id
        and employee_scopes.scope_type = 'store'
    ) visible_stores on true
    left join lateral (
      select json_agg(
        json_build_object(
          'id', stores.id,
          'name', stores.name,
          'companyName', companies.name,
          'employeeNumber', employee_work_stores.employee_number,
          'hireDate', employee_work_stores.hire_date,
          'resignationDate', employee_work_stores.resignation_date,
          'resignationReason', employee_work_stores.resignation_reason,
          'businessType', employee_work_stores.business_type,
          'employeeType', employee_work_stores.employee_type,
          'payrollEnabled', employee_work_stores.payroll_enabled,
          'employmentType', employee_work_stores.employment_type,
          'hourlyWage', employee_work_stores.hourly_wage,
          'monthlySalary', employee_work_stores.monthly_salary,
          'commuteAllowancePerWorkday', employee_work_stores.commute_allowance_per_workday,
          'commuteAllowanceMonthlyCap', employee_work_stores.commute_allowance_monthly_cap,
          'applySocialInsurance', employee_work_stores.apply_social_insurance,
          'socialInsuranceStandardMonthlyAmount', employee_work_stores.social_insurance_standard_monthly_amount,
          'socialInsuranceDeductionFrom', employee_work_stores.social_insurance_deduction_from,
          'applyEmploymentInsurance', employee_work_stores.apply_employment_insurance,
          'employmentInsuranceDeductionFrom', employee_work_stores.employment_insurance_deduction_from,
          'applyLaborInsurance', employee_work_stores.apply_labor_insurance,
          'applyIncomeTax', employee_work_stores.apply_income_tax,
          'incomeTaxCategory', employee_work_stores.income_tax_category,
          'dependentCount', employee_work_stores.dependent_count,
          'applyResidentTax', employee_work_stores.apply_resident_tax,
          'residentTaxYear', employee_work_stores.resident_tax_year,
          'residentTaxJuneAmount', employee_work_stores.resident_tax_june_amount,
          'residentTaxMonthlyAmount', employee_work_stores.resident_tax_monthly_amount,
          'payrollHistory', coalesce(payroll_history.records, '[]'::json)
        )
        order by stores.name
      ) as stores
      from employee_work_stores
      join stores on stores.id = employee_work_stores.store_id
      left join companies on companies.id = stores.company_id
      left join lateral (
        select json_agg(
          json_build_object(
            'id', employee_work_store_payroll_history.id::text,
            'validFrom', employee_work_store_payroll_history.valid_from,
            'payrollEnabled', employee_work_store_payroll_history.payroll_enabled,
            'employmentType', employee_work_store_payroll_history.employment_type,
            'hourlyWage', employee_work_store_payroll_history.hourly_wage,
            'monthlySalary', employee_work_store_payroll_history.monthly_salary,
            'commuteAllowancePerWorkday', employee_work_store_payroll_history.commute_allowance_per_workday,
            'commuteAllowanceMonthlyCap', employee_work_store_payroll_history.commute_allowance_monthly_cap,
            'applySocialInsurance', employee_work_store_payroll_history.apply_social_insurance,
            'socialInsuranceStandardMonthlyAmount', employee_work_store_payroll_history.social_insurance_standard_monthly_amount,
            'socialInsuranceDeductionFrom', employee_work_store_payroll_history.social_insurance_deduction_from,
            'applyEmploymentInsurance', employee_work_store_payroll_history.apply_employment_insurance,
            'employmentInsuranceDeductionFrom', employee_work_store_payroll_history.employment_insurance_deduction_from,
            'applyLaborInsurance', employee_work_store_payroll_history.apply_labor_insurance,
            'applyIncomeTax', employee_work_store_payroll_history.apply_income_tax,
            'incomeTaxCategory', employee_work_store_payroll_history.income_tax_category,
            'dependentCount', employee_work_store_payroll_history.dependent_count,
            'applyResidentTax', employee_work_store_payroll_history.apply_resident_tax,
            'residentTaxYear', employee_work_store_payroll_history.resident_tax_year,
            'residentTaxJuneAmount', employee_work_store_payroll_history.resident_tax_june_amount,
            'residentTaxMonthlyAmount', employee_work_store_payroll_history.resident_tax_monthly_amount,
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
    where (
      ${access.allStores}
      or exists (
        select 1
        from employee_scopes scoped_employee_stores
        where scoped_employee_stores.employee_id = employees.id
          and scoped_employee_stores.scope_type = 'store'
          and scoped_employee_stores.store_id::text = any(${access.storeIds})
      )
      or exists (
        select 1
        from employee_work_stores scoped_employee_work_stores
        where scoped_employee_work_stores.employee_id = employees.id
          and scoped_employee_work_stores.store_id::text = any(${access.storeIds})
      )
    )
    order by employees.created_at desc
  `;

  const stores = access.allStores ? await sql`
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
  ` : await sql`
    select
      stores.id,
      stores.name,
      companies.name as "companyName",
      coalesce(stores.payroll_cycle_type, 'month_end') as "payrollCycleType",
      coalesce(stores.payroll_closing_day, 31)::int as "payrollClosingDay"
    from stores
    left join companies on companies.id = stores.company_id
    where stores.status = 'active'
      and stores.id::text = any(${access.storeIds})
    order by companies.name nulls last, stores.name
  `;

  return Response.json({
    employees: employees.map((employee) => ({
      ...employee,
      stores: employee.visibleStores,
      canManage: canManageTargetRole(access, String(employee.role ?? ""))
    })),
    stores,
    currentUserId: session.id,
    currentUserRole: session.role
  });
}

export async function POST(request: Request) {
  const access = await requireStaffAdminSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const session = access.session;

  const body = await request.json().catch(() => ({})) as StaffPayload;
  const name = String(body.name ?? "").trim();
  const loginId = String(body.loginId ?? "").trim();
  const email = String(body.email ?? "").trim();
  const gender = normalizeGender(body.gender);
  const nameKana = toNullableText(body.nameKana);
  const address = toNullableText(body.address);
  const birthDate = toNullableDate(body.birthDate);
  const isForeignNational = Boolean(body.isForeignNational);
  const larkOpenId = String(body.larkOpenId ?? "").trim();
  const larkUserId = String(body.larkUserId ?? "").trim();
  const password = String(body.password ?? "");
  const role = normalizeRole(body.role);
  const staffCategory = normalizeStaffCategory(body.staffCategory);
  const payrollSubject = normalizePayrollSubject(body.payrollSubject);
  const employmentType = normalizeEmploymentType(body.employmentType);
  const hourlyWage = employmentType === "hourly" ? toNullableNumber(body.hourlyWage) : null;
  const monthlySalary = employmentType === "monthly" ? toNullableNumber(body.monthlySalary) : null;
  const commuteAllowancePerWorkday = toNullableNumber(body.commuteAllowancePerWorkday) ?? 0;
  const commuteAllowanceMonthlyCap = toNullableNumber(body.commuteAllowanceMonthlyCap);
  const status = normalizeStatus(body.status);
  const requestedVisibleStoreIds = Array.isArray(body.visibleStoreIds) ? body.visibleStoreIds.map(String) : Array.isArray(body.storeIds) ? body.storeIds.map(String) : [];
  const requestedWorkStoreIds = Array.isArray(body.workStoreIds) ? body.workStoreIds.map(String) : [];
  const visibleStoreIds = filterStoreIdsForStaffAdmin(access, requestedVisibleStoreIds);
  const workStoreIds = role === "store_terminal" ? [] : filterStoreIdsForStaffAdmin(access, requestedWorkStoreIds);
  const workStoreSettings = Array.isArray(body.workStoreSettings) ? body.workStoreSettings : [];
  const effectiveEmail = role === "store_terminal" ? "" : email;
  const effectiveNameKana = role === "store_terminal" ? null : nameKana;
  const effectiveAddress = role === "store_terminal" ? null : address;
  const effectiveBirthDate = role === "store_terminal" ? null : birthDate;
  const effectiveGender = role === "store_terminal" ? "unspecified" : gender;
  const effectiveIsForeignNational = role === "store_terminal" ? false : isForeignNational;
  const effectiveLarkOpenId = role === "store_terminal" ? "" : larkOpenId;
  const effectiveLarkUserId = role === "store_terminal" ? "" : larkUserId;
  const effectiveStaffCategory = role === "store_terminal" ? "device" : staffCategory;
  const effectivePayrollSubject = role === "store_terminal" ? "none" : payrollSubject;

  if (!name || !loginId || !password) {
    return Response.json({ error: "氏名、ログインID、初期パスワードを入力してください。" }, { status: 400 });
  }
  if (!canAssignStaffRole(access, role)) {
    return Response.json({ error: "この権限のスタッフを作成できません。" }, { status: 403 });
  }
  if (!hasValidScopedStoreSelection(access, requestedVisibleStoreIds, requestedWorkStoreIds)) {
    return Response.json({ error: "管理できる店舗の範囲内で店舗を選択してください。" }, { status: 403 });
  }
  if (role === "store_terminal" && visibleStoreIds.length === 0) {
    return Response.json({ error: "店舗Pad は閲覧可能店舗を1つ以上選択してください。" }, { status: 400 });
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
      is_foreign_national,
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
      ${effectiveEmail || null},
      ${effectiveGender},
      ${effectiveNameKana},
      ${effectiveAddress},
      ${effectiveBirthDate},
      ${effectiveIsForeignNational},
      ${effectiveLarkOpenId || null},
      ${effectiveLarkUserId || null},
      ${role},
      ${effectiveStaffCategory},
      ${effectivePayrollSubject},
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
      ${effectivePayrollSubject === "paid"},
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
    const storeEmployeeNumber = toNullableText(storeSetting?.employeeNumber);
    const storeHireDate = toNullableDate(storeSetting?.hireDate);
    const storeResignationDate = toNullableDate(storeSetting?.resignationDate);
    const storeResignationReason = toNullableText(storeSetting?.resignationReason);
    const storeBusinessType = toNullableText(storeSetting?.businessType);
    const storeEmployeeType = normalizeEmployeeType(storeSetting?.employeeType);
    const storeEmploymentType = normalizeEmploymentType(storeSetting?.employmentType ?? employmentType);
    const storeHourlyWage = storeEmploymentType === "hourly" ? toNullableNumber(storeSetting?.hourlyWage) ?? hourlyWage : null;
    const storeMonthlySalary = storeEmploymentType === "monthly" ? toNullableNumber(storeSetting?.monthlySalary) ?? monthlySalary : null;
    const storeCommuteAllowancePerWorkday = toNullableNumber(storeSetting?.commuteAllowancePerWorkday) ?? commuteAllowancePerWorkday;
    const storeCommuteAllowanceMonthlyCap = toNullableNumber(storeSetting?.commuteAllowanceMonthlyCap) ?? commuteAllowanceMonthlyCap;
    const storePayrollEnabled = storeSetting?.payrollEnabled !== false;
    const storeApplySocialInsurance = Boolean(storeSetting?.applySocialInsurance);
    const storeSocialInsuranceStandardMonthlyAmount = toNullableNumber(storeSetting?.socialInsuranceStandardMonthlyAmount);
    const storeSocialInsuranceDeductionFrom = getPayrollMonthStartDate(normalizePayrollMonth(storeSetting?.socialInsuranceDeductionFromMonth ?? storeSetting?.wageValidFromMonth ?? storeSetting?.validFromMonth ?? storeSetting?.validFrom?.slice(0, 7)), payrollStore);
    const storeApplyEmploymentInsurance = Boolean(storeSetting?.applyEmploymentInsurance);
    const storeEmploymentInsuranceDeductionFrom = getPayrollMonthStartDate(normalizePayrollMonth(storeSetting?.employmentInsuranceDeductionFromMonth ?? storeSetting?.wageValidFromMonth ?? storeSetting?.validFromMonth ?? storeSetting?.validFrom?.slice(0, 7)), payrollStore);
    const storeApplyIncomeTax = Boolean(storeSetting?.applyIncomeTax);
    const storeIncomeTaxCategory = storeApplyIncomeTax ? normalizeIncomeTaxCategory(storeSetting?.incomeTaxCategory) : "none";
    const storeDependentCount = normalizeDependentCount(storeSetting?.dependentCount);
    const storeApplyResidentTax = Boolean(storeSetting?.applyResidentTax);
    const storeResidentTaxYear = normalizeResidentTaxYear(storeSetting?.residentTaxYear);
    const storeResidentTaxJuneAmount = toNullableNumber(storeSetting?.residentTaxJuneAmount) ?? 0;
    const storeResidentTaxMonthlyAmount = toNullableNumber(storeSetting?.residentTaxMonthlyAmount) ?? 0;
    const storeWageValidFrom = getPayrollMonthStartDate(normalizePayrollMonth(storeSetting?.wageValidFromMonth ?? storeSetting?.validFromMonth ?? storeSetting?.validFrom?.slice(0, 7)), payrollStore);
    const storeCommuteValidFrom = getPayrollMonthStartDate(normalizePayrollMonth(storeSetting?.commuteValidFromMonth ?? storeSetting?.validFromMonth ?? storeSetting?.validFrom?.slice(0, 7)), payrollStore);
    const storeValidFrom = storeWageValidFrom < storeCommuteValidFrom ? storeWageValidFrom : storeCommuteValidFrom;
    await sql`
      insert into employee_work_stores (
        employee_id,
        store_id,
        employee_number,
        hire_date,
        resignation_date,
        resignation_reason,
        business_type,
        employee_type,
        payroll_enabled,
        employment_type,
        hourly_wage,
        monthly_salary,
        commute_allowance_per_workday,
        commute_allowance_monthly_cap,
        apply_social_insurance,
        social_insurance_standard_monthly_amount,
        social_insurance_deduction_from,
        apply_employment_insurance,
        employment_insurance_deduction_from,
        apply_labor_insurance,
        apply_income_tax,
        income_tax_category,
        dependent_count,
        apply_resident_tax,
        resident_tax_year,
        resident_tax_june_amount,
        resident_tax_monthly_amount
      )
      values (
        ${employeeId},
        ${storeId},
        ${storeEmployeeNumber},
        ${storeHireDate},
        ${storeResignationDate},
        ${storeResignationReason},
        ${storeBusinessType},
        ${storeEmployeeType},
        ${storePayrollEnabled},
        ${storeEmploymentType},
        ${storeHourlyWage},
        ${storeMonthlySalary},
        ${storeCommuteAllowancePerWorkday},
        ${storeCommuteAllowanceMonthlyCap},
        ${storeApplySocialInsurance},
        ${storeSocialInsuranceStandardMonthlyAmount},
        ${storeApplySocialInsurance ? storeSocialInsuranceDeductionFrom : null},
        ${storeApplyEmploymentInsurance},
        ${storeApplyEmploymentInsurance ? storeEmploymentInsuranceDeductionFrom : null},
        ${Boolean(storeSetting?.applyLaborInsurance)},
        ${storeApplyIncomeTax},
        ${storeIncomeTaxCategory},
        ${storeDependentCount},
        ${storeApplyResidentTax},
        ${storeApplyResidentTax ? storeResidentTaxYear : null},
        ${storeApplyResidentTax ? storeResidentTaxJuneAmount : null},
        ${storeApplyResidentTax ? storeResidentTaxMonthlyAmount : null}
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
        social_insurance_standard_monthly_amount,
        social_insurance_deduction_from,
        apply_employment_insurance,
        employment_insurance_deduction_from,
        apply_labor_insurance,
        apply_income_tax,
        income_tax_category,
        dependent_count,
        apply_resident_tax,
        resident_tax_year,
        resident_tax_june_amount,
        resident_tax_monthly_amount,
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
        ${storeApplySocialInsurance},
        ${storeSocialInsuranceStandardMonthlyAmount},
        ${storeApplySocialInsurance ? storeSocialInsuranceDeductionFrom : null},
        ${storeApplyEmploymentInsurance},
        ${storeApplyEmploymentInsurance ? storeEmploymentInsuranceDeductionFrom : null},
        ${Boolean(storeSetting?.applyLaborInsurance)},
        ${storeApplyIncomeTax},
        ${storeIncomeTaxCategory},
        ${storeDependentCount},
        ${storeApplyResidentTax},
        ${storeApplyResidentTax ? storeResidentTaxYear : null},
        ${storeApplyResidentTax ? storeResidentTaxJuneAmount : null},
        ${storeApplyResidentTax ? storeResidentTaxMonthlyAmount : null},
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
        social_insurance_standard_monthly_amount = excluded.social_insurance_standard_monthly_amount,
        social_insurance_deduction_from = excluded.social_insurance_deduction_from,
        apply_employment_insurance = excluded.apply_employment_insurance,
        employment_insurance_deduction_from = excluded.employment_insurance_deduction_from,
        apply_labor_insurance = excluded.apply_labor_insurance,
        apply_income_tax = excluded.apply_income_tax,
        income_tax_category = excluded.income_tax_category,
        dependent_count = excluded.dependent_count,
        apply_resident_tax = excluded.apply_resident_tax,
        resident_tax_year = excluded.resident_tax_year,
        resident_tax_june_amount = excluded.resident_tax_june_amount,
        resident_tax_monthly_amount = excluded.resident_tax_monthly_amount,
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
    metadata: { role, staffCategory: effectiveStaffCategory, payrollSubject: effectivePayrollSubject, status, visibleStoreCount: visibleStoreIds.length, workStoreCount: workStoreIds.length },
    request
  });

  return Response.json({ ok: true });
}
