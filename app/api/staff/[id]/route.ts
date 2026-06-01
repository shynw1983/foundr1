import { requireOwnerOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { hashPassword, validatePasswordStrength } from "../../../../lib/auth";
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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOwnerOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const { id } = await context.params;
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
  const status = id === session.id ? "active" : normalizeStatus(body.status);
  const visibleStoreIds = Array.isArray(body.visibleStoreIds) ? body.visibleStoreIds.map(String) : Array.isArray(body.storeIds) ? body.storeIds.map(String) : [];
  const workStoreIds = Array.isArray(body.workStoreIds) ? body.workStoreIds.map(String) : [];
  const workStoreSettings = Array.isArray(body.workStoreSettings) ? body.workStoreSettings : [];

  if (!name || !loginId) {
    return Response.json({ error: "氏名とログインIDを入力してください。" }, { status: 400 });
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
          email = ${email || null},
          gender = ${gender},
          name_kana = ${nameKana},
          address = ${address},
          birth_date = ${birthDate},
          employee_number = ${employeeNumber},
          hire_date = ${hireDate},
          resignation_date = ${resignationDate},
          resignation_reason = ${resignationReason},
          business_type = ${businessType},
          is_foreign_national = ${isForeignNational},
          employee_type = ${employeeType},
          lark_open_id = ${larkOpenId || null},
          lark_user_id = ${larkUserId || null},
          role = ${role},
          staff_category = ${staffCategory},
          payroll_subject = ${payrollSubject},
          status = ${status},
          password_hash = ${hashPassword(password)},
          session_version = session_version + 1,
          updated_at = now()
      where id = ${id}
    `;
  } else {
    await sql`
      update employees
      set name = ${name},
          login_id = ${loginId},
          email = ${email || null},
          gender = ${gender},
          name_kana = ${nameKana},
          address = ${address},
          birth_date = ${birthDate},
          employee_number = ${employeeNumber},
          hire_date = ${hireDate},
          resignation_date = ${resignationDate},
          resignation_reason = ${resignationReason},
          business_type = ${businessType},
          is_foreign_national = ${isForeignNational},
          employee_type = ${employeeType},
          lark_open_id = ${larkOpenId || null},
          lark_user_id = ${larkUserId || null},
          role = ${role},
          staff_category = ${staffCategory},
          payroll_subject = ${payrollSubject},
          status = ${status},
          session_version = session_version + 1,
          updated_at = now()
      where id = ${id}
    `;
  }

  await sql`delete from employee_scopes where employee_id = ${id} and scope_type = 'store'`;
  const existingWorkStores = await sql`
    select
      store_id::text as "storeId",
      payroll_enabled as "payrollEnabled",
      employment_type as "employmentType",
      hourly_wage as "hourlyWage",
      monthly_salary as "monthlySalary",
      commute_allowance_per_workday as "commuteAllowancePerWorkday",
      commute_allowance_monthly_cap as "commuteAllowanceMonthlyCap",
      apply_social_insurance as "applySocialInsurance",
      apply_labor_insurance as "applyLaborInsurance",
      apply_income_tax as "applyIncomeTax",
      apply_resident_tax as "applyResidentTax"
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

  for (const storeId of workStoreIds) {
    const storeSetting = workStoreSettings.find((setting) => String(setting.storeId ?? "") === storeId);
    const storeEmploymentType = normalizeEmploymentType(storeSetting?.employmentType ?? employmentType);
    const storeHourlyWage = toNullableNumber(storeSetting?.hourlyWage) ?? hourlyWage;
    const storeMonthlySalary = toNullableNumber(storeSetting?.monthlySalary) ?? monthlySalary;
    const storeCommuteAllowancePerWorkday = toNullableNumber(storeSetting?.commuteAllowancePerWorkday) ?? commuteAllowancePerWorkday;
    const storeCommuteAllowanceMonthlyCap = toNullableNumber(storeSetting?.commuteAllowanceMonthlyCap) ?? commuteAllowanceMonthlyCap;
    const storePayrollEnabled = storeSetting?.payrollEnabled !== false;
    const storeValidFrom = toNullableDate(storeSetting?.validFrom) ?? getJstDateLabel();
    const existingStore = existingWorkStoreById.get(storeId);
    const shouldKeepCurrentUntilFutureDate = Boolean(existingStore && storeValidFrom > getJstDateLabel());
    const currentPayrollEnabled = shouldKeepCurrentUntilFutureDate ? existingStore?.payrollEnabled !== false : storePayrollEnabled;
    const currentEmploymentType = shouldKeepCurrentUntilFutureDate ? normalizeEmploymentType(String(existingStore?.employmentType ?? "")) : storeEmploymentType;
    const currentHourlyWage = shouldKeepCurrentUntilFutureDate ? toNullableNumber(existingStore?.hourlyWage) : storeHourlyWage;
    const currentMonthlySalary = shouldKeepCurrentUntilFutureDate ? toNullableNumber(existingStore?.monthlySalary) : storeMonthlySalary;
    const currentCommuteAllowancePerWorkday = shouldKeepCurrentUntilFutureDate ? toNullableNumber(existingStore?.commuteAllowancePerWorkday) ?? 0 : storeCommuteAllowancePerWorkday;
    const currentCommuteAllowanceMonthlyCap = shouldKeepCurrentUntilFutureDate ? toNullableNumber(existingStore?.commuteAllowanceMonthlyCap) : storeCommuteAllowanceMonthlyCap;
    const currentApplySocialInsurance = shouldKeepCurrentUntilFutureDate ? Boolean(existingStore?.applySocialInsurance) : Boolean(storeSetting?.applySocialInsurance);
    const currentApplyLaborInsurance = shouldKeepCurrentUntilFutureDate ? Boolean(existingStore?.applyLaborInsurance) : Boolean(storeSetting?.applyLaborInsurance);
    const currentApplyIncomeTax = shouldKeepCurrentUntilFutureDate ? Boolean(existingStore?.applyIncomeTax) : Boolean(storeSetting?.applyIncomeTax);
    const currentApplyResidentTax = shouldKeepCurrentUntilFutureDate ? Boolean(existingStore?.applyResidentTax) : Boolean(storeSetting?.applyResidentTax);
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
        ${id},
        ${storeId},
        ${currentPayrollEnabled},
        ${currentEmploymentType},
        ${currentHourlyWage},
        ${currentMonthlySalary},
        ${currentCommuteAllowancePerWorkday},
        ${currentCommuteAllowanceMonthlyCap},
        ${currentApplySocialInsurance},
        ${currentApplyLaborInsurance},
        ${currentApplyIncomeTax},
        ${currentApplyResidentTax}
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
        ${Boolean(storeSetting?.applySocialInsurance)},
        ${Boolean(storeSetting?.applyLaborInsurance)},
        ${Boolean(storeSetting?.applyIncomeTax)},
        ${Boolean(storeSetting?.applyResidentTax)},
        ${storeValidFrom},
        ${session.id},
        now()
      )
      on conflict (employee_id, store_id, valid_from) do update set
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
      ${payrollSubject === "paid"},
      ${session.id},
      now()
    )
  `;

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "staff.updated",
    targetType: "employee",
    targetId: id,
    metadata: { role, staffCategory, payrollSubject, status, employeeType, passwordChanged: Boolean(password), visibleStoreCount: visibleStoreIds.length, workStoreCount: workStoreIds.length },
    request
  });

  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOwnerOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const { id } = await context.params;
  if (id === session.id) {
    return Response.json({ error: "自分自身は削除できません。" }, { status: 409 });
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
