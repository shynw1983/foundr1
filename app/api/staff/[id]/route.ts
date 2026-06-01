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
    await sql`
      insert into employee_work_stores (
        employee_id,
        store_id,
        payroll_enabled,
        employment_type,
        hourly_wage,
        monthly_salary,
        commute_allowance_per_workday
      )
      values (
        ${id},
        ${storeId},
        ${storeSetting?.payrollEnabled !== false},
        ${normalizeEmploymentType(storeSetting?.employmentType ?? employmentType)},
        ${toNullableNumber(storeSetting?.hourlyWage) ?? hourlyWage},
        ${toNullableNumber(storeSetting?.monthlySalary) ?? monthlySalary},
        ${toNullableNumber(storeSetting?.commuteAllowancePerWorkday) ?? commuteAllowancePerWorkday}
      )
      on conflict do nothing
    `;
  }

  await sql`
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
      ${id},
      ${employmentType},
      ${hourlyWage},
      ${monthlySalary},
      ${commuteAllowancePerWorkday},
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
