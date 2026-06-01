import { requireOwnerOsSession } from "../../../../../../lib/api-auth";
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
      commute_allowance_per_workday as "commuteAllowancePerWorkday",
      commute_allowance_monthly_cap as "commuteAllowanceMonthlyCap",
      apply_social_insurance as "applySocialInsurance",
      apply_employment_insurance as "applyEmploymentInsurance",
      apply_labor_insurance as "applyLaborInsurance",
      apply_income_tax as "applyIncomeTax",
      apply_resident_tax as "applyResidentTax"
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
      apply_social_insurance as "applySocialInsurance",
      apply_employment_insurance as "applyEmploymentInsurance",
      apply_labor_insurance as "applyLaborInsurance",
      apply_income_tax as "applyIncomeTax",
      apply_resident_tax as "applyResidentTax"
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

  await sql`
    update employee_work_stores
    set payroll_enabled = ${wage.payrollEnabled !== false},
        employment_type = ${normalizeEmploymentType(String(wage.employmentType ?? current.employmentType ?? ""))},
        hourly_wage = ${toNullableNumber(wage.hourlyWage ?? current.hourlyWage)},
        monthly_salary = ${toNullableNumber(wage.monthlySalary ?? current.monthlySalary)},
        commute_allowance_per_workday = ${toNullableNumber(commute.commuteAllowancePerWorkday ?? current.commuteAllowancePerWorkday) ?? 0},
        commute_allowance_monthly_cap = ${toNullableNumber(commute.commuteAllowanceMonthlyCap ?? current.commuteAllowanceMonthlyCap)},
        apply_social_insurance = ${Boolean(wage.applySocialInsurance ?? current.applySocialInsurance)},
        apply_employment_insurance = ${Boolean(wage.applyEmploymentInsurance ?? current.applyEmploymentInsurance)},
        apply_labor_insurance = ${Boolean(wage.applyLaborInsurance ?? current.applyLaborInsurance)},
        apply_income_tax = ${Boolean(wage.applyIncomeTax ?? current.applyIncomeTax)},
        apply_resident_tax = ${Boolean(wage.applyResidentTax ?? current.applyResidentTax)}
    where employee_id = ${employeeId}
      and store_id = ${storeId}
  `;
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string; historyId: string }> }) {
  const session = await requireOwnerOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const { id, historyId } = await context.params;
  const targetRows = await sql`
    select store_id::text as "storeId"
    from employee_work_store_payroll_history
    where id = ${historyId}
      and employee_id = ${id}
    limit 1
  `;
  const target = targetRows[0];
  if (!target) {
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
