import { requireStaffAdminSession, canAssignStaffRole, canManageTargetRole, filterStoreIdsForStaffAdmin, hasValidScopedStoreSelection } from "../../../../lib/staff-admin-access";
import { writeAuditLog } from "../../../../lib/audit-log";
import { hashPassword, shouldRequirePasswordChangeForRole, validatePasswordStrength } from "../../../../lib/auth";
import { sql } from "../../../../lib/db";

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
  passwordMustChange?: boolean;
  privacyConsentResetRequired?: boolean;
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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireStaffAdminSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const session = access.session;

  const { id } = await context.params;
  const targetRows = await sql`
    select role, coalesce(password_must_change, false) as "passwordMustChange"
    from employees
    where id = ${id}
      and (
        ${access.allStores}
        or exists (
          select 1
          from employee_scopes
          where employee_scopes.employee_id = employees.id
            and employee_scopes.scope_type = 'store'
            and employee_scopes.store_id::text = any(${access.storeIds})
        )
        or exists (
          select 1
          from employee_work_stores
          where employee_work_stores.employee_id = employees.id
            and employee_work_stores.store_id::text = any(${access.storeIds})
        )
      )
    limit 1
  `;
  const targetRole = String(targetRows[0]?.role ?? "");
  const currentPasswordMustChange = targetRows[0]?.passwordMustChange === true;
  if (!targetRole || !canManageTargetRole(access, targetRole)) {
    return Response.json({ error: "このスタッフを編集する権限がありません。" }, { status: 403 });
  }

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
  const status = id === session.id ? "active" : normalizeStatus(body.status);
  const requestedVisibleStoreIds = Array.isArray(body.visibleStoreIds) ? body.visibleStoreIds.map(String) : Array.isArray(body.storeIds) ? body.storeIds.map(String) : [];
  const requestedWorkStoreIds = Array.isArray(body.workStoreIds) ? body.workStoreIds.map(String) : [];
  const workStoreIds = role === "store_terminal" ? [] : filterStoreIdsForStaffAdmin(access, requestedWorkStoreIds);
  const visibleStoreIds = filterStoreIdsForStaffAdmin(access, role === "staff" ? requestedWorkStoreIds : requestedVisibleStoreIds);
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
  const passwordMustChange = shouldRequirePasswordChangeForRole(role) && (
    typeof body.passwordMustChange === "boolean"
      ? body.passwordMustChange
      : password
        ? true
        : currentPasswordMustChange
  );
  const privacyConsentResetRequired = role !== "store_terminal" && body.privacyConsentResetRequired === true;

  if (!name || !loginId) {
    return Response.json({ error: "氏名とログインIDを入力してください。" }, { status: 400 });
  }
  if (!canAssignStaffRole(access, role)) {
    return Response.json({ error: "この権限に変更できません。" }, { status: 403 });
  }
  if (!hasValidScopedStoreSelection(access, requestedVisibleStoreIds, requestedWorkStoreIds)) {
    return Response.json({ error: "管理できる店舗の範囲内で店舗を選択してください。" }, { status: 403 });
  }
  if (role === "store_terminal" && visibleStoreIds.length === 0) {
    return Response.json({ error: "店舗Pad は閲覧可能店舗を1つ以上選択してください。" }, { status: 400 });
  }
  if (password) {
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return Response.json({ error: passwordError }, { status: 400 });
    }
  }

  if (password) {
    await sql`
      update employees
      set name = ${name},
          login_id = ${loginId},
          email = ${effectiveEmail || null},
          gender = ${effectiveGender},
          name_kana = ${effectiveNameKana},
          address = ${effectiveAddress},
          birth_date = ${effectiveBirthDate},
          is_foreign_national = ${effectiveIsForeignNational},
          lark_open_id = ${effectiveLarkOpenId || null},
          lark_user_id = ${effectiveLarkUserId || null},
          role = ${role},
          staff_category = ${effectiveStaffCategory},
          payroll_subject = ${effectivePayrollSubject},
          status = ${status},
          password_hash = ${hashPassword(password)},
          password_must_change = ${passwordMustChange},
          privacy_consent_reset_required = ${privacyConsentResetRequired},
          password_changed_at = case when ${passwordMustChange} then null else password_changed_at end,
          session_version = session_version + 1,
          updated_at = now()
      where id = ${id}
    `;
  } else {
    await sql`
      update employees
      set name = ${name},
          login_id = ${loginId},
          email = ${effectiveEmail || null},
          gender = ${effectiveGender},
          name_kana = ${effectiveNameKana},
          address = ${effectiveAddress},
          birth_date = ${effectiveBirthDate},
          is_foreign_national = ${effectiveIsForeignNational},
          lark_open_id = ${effectiveLarkOpenId || null},
          lark_user_id = ${effectiveLarkUserId || null},
          role = ${role},
          staff_category = ${effectiveStaffCategory},
          payroll_subject = ${effectivePayrollSubject},
          status = ${status},
          password_must_change = ${passwordMustChange},
          privacy_consent_reset_required = ${privacyConsentResetRequired},
          password_changed_at = case when ${passwordMustChange} then null else password_changed_at end,
          session_version = session_version + 1,
          updated_at = now()
      where id = ${id}
    `;
  }

  await sql`delete from employee_scopes where employee_id = ${id} and scope_type = 'store'`;
  const existingWorkStores = await sql`
    select
      store_id::text as "storeId",
      employee_number as "employeeNumber",
      hire_date as "hireDate",
      resignation_date as "resignationDate",
      resignation_reason as "resignationReason",
      business_type as "businessType",
      employee_type as "employeeType",
      payroll_enabled as "payrollEnabled",
      employment_type as "employmentType",
      hourly_wage as "hourlyWage",
      monthly_salary as "monthlySalary",
      commute_allowance_per_workday as "commuteAllowancePerWorkday",
      commute_allowance_monthly_cap as "commuteAllowanceMonthlyCap",
      apply_social_insurance as "applySocialInsurance",
      social_insurance_standard_monthly_amount as "socialInsuranceStandardMonthlyAmount",
      social_insurance_deduction_from as "socialInsuranceDeductionFrom",
      apply_employment_insurance as "applyEmploymentInsurance",
      employment_insurance_deduction_from as "employmentInsuranceDeductionFrom",
      apply_labor_insurance as "applyLaborInsurance",
      apply_income_tax as "applyIncomeTax",
      income_tax_category as "incomeTaxCategory",
      dependent_count as "dependentCount",
      apply_resident_tax as "applyResidentTax",
      resident_tax_year as "residentTaxYear",
      resident_tax_june_amount as "residentTaxJuneAmount",
      resident_tax_monthly_amount as "residentTaxMonthlyAmount"
    from employee_work_stores
    where employee_id = ${id}
  `;
  const existingWorkStoreById = new Map(existingWorkStores.map((store) => [String(store.storeId), store]));
  await sql`delete from employee_work_stores where employee_id = ${id}`;

  for (const storeId of visibleStoreIds) {
    await sql`
      insert into employee_scopes (employee_id, scope_type, store_id)
      values (${id}, 'store', ${storeId})
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
    const existingStore = existingWorkStoreById.get(storeId);
    const shouldKeepCurrentWageUntilFutureDate = Boolean(existingStore && storeWageValidFrom > getJstDateLabel());
    const shouldKeepCurrentCommuteUntilFutureDate = Boolean(existingStore && storeCommuteValidFrom > getJstDateLabel());
    const currentPayrollEnabled = shouldKeepCurrentWageUntilFutureDate ? existingStore?.payrollEnabled !== false : storePayrollEnabled;
    const currentEmploymentType = shouldKeepCurrentWageUntilFutureDate ? normalizeEmploymentType(String(existingStore?.employmentType ?? "")) : storeEmploymentType;
    const currentHourlyWage = currentEmploymentType === "hourly"
      ? shouldKeepCurrentWageUntilFutureDate ? toNullableNumber(existingStore?.hourlyWage) : storeHourlyWage
      : null;
    const currentMonthlySalary = currentEmploymentType === "monthly"
      ? shouldKeepCurrentWageUntilFutureDate ? toNullableNumber(existingStore?.monthlySalary) : storeMonthlySalary
      : null;
    const currentCommuteAllowancePerWorkday = shouldKeepCurrentCommuteUntilFutureDate ? toNullableNumber(existingStore?.commuteAllowancePerWorkday) ?? 0 : storeCommuteAllowancePerWorkday;
    const currentCommuteAllowanceMonthlyCap = shouldKeepCurrentCommuteUntilFutureDate ? toNullableNumber(existingStore?.commuteAllowanceMonthlyCap) : storeCommuteAllowanceMonthlyCap;
    const currentApplySocialInsurance = shouldKeepCurrentWageUntilFutureDate ? Boolean(existingStore?.applySocialInsurance) : Boolean(storeSetting?.applySocialInsurance);
    const currentSocialInsuranceStandardMonthlyAmount = shouldKeepCurrentWageUntilFutureDate ? toNullableNumber(existingStore?.socialInsuranceStandardMonthlyAmount as number | string | null | undefined) : storeSocialInsuranceStandardMonthlyAmount;
    const currentSocialInsuranceDeductionFrom = shouldKeepCurrentWageUntilFutureDate ? toNullableDate(String(existingStore?.socialInsuranceDeductionFrom ?? "").slice(0, 10)) : (storeApplySocialInsurance ? storeSocialInsuranceDeductionFrom : null);
    const currentApplyEmploymentInsurance = shouldKeepCurrentWageUntilFutureDate ? Boolean(existingStore?.applyEmploymentInsurance) : storeApplyEmploymentInsurance;
    const currentEmploymentInsuranceDeductionFrom = shouldKeepCurrentWageUntilFutureDate ? toNullableDate(String(existingStore?.employmentInsuranceDeductionFrom ?? "").slice(0, 10)) : (storeApplyEmploymentInsurance ? storeEmploymentInsuranceDeductionFrom : null);
    const currentApplyLaborInsurance = shouldKeepCurrentWageUntilFutureDate ? Boolean(existingStore?.applyLaborInsurance) : Boolean(storeSetting?.applyLaborInsurance);
    const currentApplyIncomeTax = shouldKeepCurrentWageUntilFutureDate ? Boolean(existingStore?.applyIncomeTax) : storeApplyIncomeTax;
    const currentIncomeTaxCategory = shouldKeepCurrentWageUntilFutureDate ? normalizeIncomeTaxCategory(String(existingStore?.incomeTaxCategory ?? "")) : storeIncomeTaxCategory;
    const currentDependentCount = shouldKeepCurrentWageUntilFutureDate ? normalizeDependentCount(existingStore?.dependentCount as number | string | null | undefined) : storeDependentCount;
    const currentApplyResidentTax = shouldKeepCurrentWageUntilFutureDate ? Boolean(existingStore?.applyResidentTax) : storeApplyResidentTax;
    const currentResidentTaxYear = shouldKeepCurrentWageUntilFutureDate ? normalizeResidentTaxYear(existingStore?.residentTaxYear as number | string | null | undefined) : storeResidentTaxYear;
    const currentResidentTaxJuneAmount = shouldKeepCurrentWageUntilFutureDate ? toNullableNumber(existingStore?.residentTaxJuneAmount as number | string | null | undefined) ?? 0 : storeResidentTaxJuneAmount;
    const currentResidentTaxMonthlyAmount = shouldKeepCurrentWageUntilFutureDate ? toNullableNumber(existingStore?.residentTaxMonthlyAmount as number | string | null | undefined) ?? 0 : storeResidentTaxMonthlyAmount;
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
        ${id},
        ${storeId},
        ${storeEmployeeNumber},
        ${storeHireDate},
        ${storeResignationDate},
        ${storeResignationReason},
        ${storeBusinessType},
        ${storeEmployeeType},
        ${currentPayrollEnabled},
        ${currentEmploymentType},
        ${currentHourlyWage},
        ${currentMonthlySalary},
        ${currentCommuteAllowancePerWorkday},
        ${currentCommuteAllowanceMonthlyCap},
        ${currentApplySocialInsurance},
        ${currentSocialInsuranceStandardMonthlyAmount},
        ${currentSocialInsuranceDeductionFrom},
        ${currentApplyEmploymentInsurance},
        ${currentEmploymentInsuranceDeductionFrom},
        ${currentApplyLaborInsurance},
        ${currentApplyIncomeTax},
        ${currentIncomeTaxCategory},
        ${currentDependentCount},
        ${currentApplyResidentTax},
        ${currentApplyResidentTax ? currentResidentTaxYear : null},
        ${currentApplyResidentTax ? currentResidentTaxJuneAmount : null},
        ${currentApplyResidentTax ? currentResidentTaxMonthlyAmount : null}
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
        ${id},
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
      ${id},
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

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "staff.updated",
    targetType: "employee",
    targetId: id,
    metadata: { role, staffCategory: effectiveStaffCategory, payrollSubject: effectivePayrollSubject, status, passwordChanged: Boolean(password), privacyConsentResetRequired, scopeSource: role === "staff" ? "work_stores" : "visible_stores", visibleStoreCount: visibleStoreIds.length, workStoreCount: workStoreIds.length },
    request
  });

  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireStaffAdminSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const session = access.session;

  const { id } = await context.params;
  if (id === session.id) {
    return Response.json({ error: "自分自身は削除できません。" }, { status: 409 });
  }
  const targetRows = await sql`
    select role
    from employees
    where id = ${id}
      and (
        ${access.allStores}
        or exists (
          select 1
          from employee_scopes
          where employee_scopes.employee_id = employees.id
            and employee_scopes.scope_type = 'store'
            and employee_scopes.store_id::text = any(${access.storeIds})
        )
        or exists (
          select 1
          from employee_work_stores
          where employee_work_stores.employee_id = employees.id
            and employee_work_stores.store_id::text = any(${access.storeIds})
        )
      )
    limit 1
  `;
  const targetRole = String(targetRows[0]?.role ?? "");
  if (!targetRole || !canManageTargetRole(access, targetRole)) {
    return Response.json({ error: "このスタッフを削除する権限がありません。" }, { status: 403 });
  }

  await sql`delete from employees where id = ${id}`;
  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "staff.deleted",
    targetType: "employee",
    targetId: id,
    request
  });
  return Response.json({ ok: true });
}
