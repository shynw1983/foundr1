import { requireStaffAdminSession, canManageTargetRole } from "../../../../../../lib/staff-admin-access";
import { writeAuditLog } from "../../../../../../lib/audit-log";
import { sql } from "../../../../../../lib/db";

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeEmploymentType(type?: string | null) {
  return type === "monthly" ? "monthly" : "hourly";
}

function getJstDateLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function refreshCurrentWorkStore(employeeId: string, storeId: string) {
  const currentRows = await sql`
    select
      payroll_enabled as "payrollEnabled",
      employment_type as "employmentType",
      hourly_wage as "hourlyWage",
      monthly_salary as "monthlySalary",
      prescribed_monthly_work_minutes as "prescribedMonthlyWorkMinutes",
      commute_allowance_per_workday as "commuteAllowancePerWorkday",
      commute_allowance_monthly_cap as "commuteAllowanceMonthlyCap",
      apply_social_insurance as "applySocialInsurance",
      apply_employment_insurance as "applyEmploymentInsurance",
      apply_labor_insurance as "applyLaborInsurance",
      apply_income_tax as "applyIncomeTax",
      apply_resident_tax as "applyResidentTax",
      resident_tax_year as "residentTaxYear",
      resident_tax_june_amount as "residentTaxJuneAmount",
      resident_tax_monthly_amount as "residentTaxMonthlyAmount"
    from employee_work_stores
    where employee_id = ${employeeId}
      and store_id = ${storeId}
    limit 1
  `;
  const current = currentRows[0];
  if (!current) return;

  const today = getJstDateLabel();
  const wageRows = await sql`
    select
      payroll_enabled as "payrollEnabled",
      employment_type as "employmentType",
      hourly_wage as "hourlyWage",
      monthly_salary as "monthlySalary",
      prescribed_monthly_work_minutes as "prescribedMonthlyWorkMinutes",
      apply_social_insurance as "applySocialInsurance",
      apply_employment_insurance as "applyEmploymentInsurance",
      apply_labor_insurance as "applyLaborInsurance",
      apply_income_tax as "applyIncomeTax",
      apply_resident_tax as "applyResidentTax",
      resident_tax_year as "residentTaxYear",
      resident_tax_june_amount as "residentTaxJuneAmount",
      resident_tax_monthly_amount as "residentTaxMonthlyAmount"
    from employee_work_store_payroll_history
    where employee_id = ${employeeId}
      and store_id = ${storeId}
      and wage_valid_from <= ${today}
    order by wage_valid_from desc, updated_at desc, created_at desc
    limit 1
  `;
  const commuteRows = await sql`
    select
      commute_allowance_per_workday as "commuteAllowancePerWorkday",
      commute_allowance_monthly_cap as "commuteAllowanceMonthlyCap"
    from employee_work_store_payroll_history
    where employee_id = ${employeeId}
      and store_id = ${storeId}
      and commute_valid_from <= ${today}
    order by commute_valid_from desc, updated_at desc, created_at desc
    limit 1
  `;
  const wage = wageRows[0] ?? current;
  const commute = commuteRows[0] ?? current;
  const employmentType = normalizeEmploymentType(String(wage.employmentType ?? current.employmentType ?? ""));
  const hourlyWage = employmentType === "hourly" ? toNullableNumber(wage.hourlyWage ?? current.hourlyWage) : null;
  const monthlySalary = employmentType === "monthly" ? toNullableNumber(wage.monthlySalary ?? current.monthlySalary) : null;
  const prescribedMonthlyWorkMinutes = toNullableNumber(wage.prescribedMonthlyWorkMinutes ?? current.prescribedMonthlyWorkMinutes);

  await sql`
    update employee_work_stores
    set payroll_enabled = ${wage.payrollEnabled !== false},
        employment_type = ${employmentType},
        hourly_wage = ${hourlyWage},
        monthly_salary = ${monthlySalary},
        prescribed_monthly_work_minutes = ${prescribedMonthlyWorkMinutes},
        commute_allowance_per_workday = ${toNullableNumber(commute.commuteAllowancePerWorkday ?? current.commuteAllowancePerWorkday) ?? 0},
        commute_allowance_monthly_cap = ${toNullableNumber(commute.commuteAllowanceMonthlyCap ?? current.commuteAllowanceMonthlyCap)},
        apply_social_insurance = ${Boolean(wage.applySocialInsurance ?? current.applySocialInsurance)},
        apply_employment_insurance = ${Boolean(wage.applyEmploymentInsurance ?? current.applyEmploymentInsurance)},
        apply_labor_insurance = ${Boolean(wage.applyLaborInsurance ?? current.applyLaborInsurance)},
        apply_income_tax = ${Boolean(wage.applyIncomeTax ?? current.applyIncomeTax)},
        apply_resident_tax = ${Boolean(wage.applyResidentTax ?? current.applyResidentTax)},
        resident_tax_year = ${wage.residentTaxYear ?? current.residentTaxYear ?? null},
        resident_tax_june_amount = ${toNullableNumber(wage.residentTaxJuneAmount ?? current.residentTaxJuneAmount)},
        resident_tax_monthly_amount = ${toNullableNumber(wage.residentTaxMonthlyAmount ?? current.residentTaxMonthlyAmount)}
    where employee_id = ${employeeId}
      and store_id = ${storeId}
  `;
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; historyId: string }> }) {
  const access = await requireStaffAdminSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const session = access.session;

  const { id, historyId } = await context.params;
  const targetRows = await sql`
    select
      employee_work_store_payroll_history.store_id::text as "storeId",
      employees.role
    from employee_work_store_payroll_history
    join employees on employees.id = employee_work_store_payroll_history.employee_id
    where employee_work_store_payroll_history.id = ${historyId}
      and employee_work_store_payroll_history.employee_id = ${id}
      and (
        ${access.allStores}
        or employee_work_store_payroll_history.store_id::text = any(${access.storeIds})
      )
    limit 1
  `;
  const target = targetRows[0];
  if (!target || !canManageTargetRole(access, String(target.role ?? ""))) {
    return Response.json({ error: "給与変更履歴が見つかりません。" }, { status: 404 });
  }

  await sql`
    delete from employee_work_store_payroll_history
    where id = ${historyId}
      and employee_id = ${id}
  `;
  await refreshCurrentWorkStore(id, String(target.storeId));
  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "staff.payroll_history.deleted",
    targetType: "employee",
    targetId: id,
    metadata: { historyId, storeId: target.storeId },
    request
  });

  return Response.json({ ok: true });
}
