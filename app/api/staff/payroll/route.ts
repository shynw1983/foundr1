import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

type PayrollRow = {
  employeeId?: string;
  employeeName?: string;
  storeNames?: string[];
  employmentType?: string;
  workDays?: number;
  punchCount?: number;
  workMinutes?: number;
  breakMinutes?: number;
  nightMinutes?: number;
  regularPay?: number;
  overtimePay?: number;
  nightPremiumPay?: number;
  basePay?: number;
  socialInsurance?: number;
  employmentInsurance?: number;
  incomeTax?: number;
  residentTax?: number;
  commuteAllowance?: number;
  totalPay?: number;
  alerts?: string[];
};

function normalizePayrollRow(row: PayrollRow) {
  return {
    employeeId: String(row.employeeId ?? ""),
    employeeName: String(row.employeeName ?? ""),
    storeNames: Array.isArray(row.storeNames) ? row.storeNames.map(String) : [],
    employmentType: String(row.employmentType ?? ""),
    workDays: Number(row.workDays ?? 0),
    punchCount: Number(row.punchCount ?? 0),
    workMinutes: Number(row.workMinutes ?? 0),
    breakMinutes: Number(row.breakMinutes ?? 0),
    nightMinutes: Number(row.nightMinutes ?? 0),
    regularPay: Number(row.regularPay ?? 0),
    overtimePay: Number(row.overtimePay ?? 0),
    nightPremiumPay: Number(row.nightPremiumPay ?? 0),
    basePay: Number(row.basePay ?? 0),
    socialInsurance: Number(row.socialInsurance ?? 0),
    employmentInsurance: Number(row.employmentInsurance ?? 0),
    incomeTax: Number(row.incomeTax ?? 0),
    residentTax: Number(row.residentTax ?? 0),
    commuteAllowance: Number(row.commuteAllowance ?? 0),
    totalPay: Number(row.totalPay ?? 0),
    alerts: Array.isArray(row.alerts) ? row.alerts.map(String) : []
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (session.role === "store_terminal") {
    return Response.json({ error: "スタッフ個人アプリを利用できません。" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(12, Math.round(Number(url.searchParams.get("limit") ?? 6) || 6)));
  const rows = await sql`
    select
      timecard_payroll_confirmations.id::text,
      timecard_payroll_confirmations.store_id::text as "storeId",
      stores.name as "storeName",
      timecard_payroll_confirmations.payroll_month as "payrollMonth",
      to_char(timecard_payroll_confirmations.period_start, 'YYYY-MM-DD') as "periodStart",
      to_char(timecard_payroll_confirmations.period_end, 'YYYY-MM-DD') as "periodEnd",
      timecard_payroll_confirmations.confirmed_at as "confirmedAt",
      payroll_row.value as "payrollRow"
    from timecard_payroll_confirmations
    join stores on stores.id = timecard_payroll_confirmations.store_id
    cross join lateral jsonb_array_elements(timecard_payroll_confirmations.payroll_rows) as payroll_row(value)
    where payroll_row.value->>'employeeId' = ${session.id}
    order by timecard_payroll_confirmations.payroll_month desc, timecard_payroll_confirmations.confirmed_at desc
    limit ${limit}
  `;

  return Response.json({
    payrolls: rows.map((row) => ({
      id: String(row.id),
      storeId: String(row.storeId),
      storeName: String(row.storeName ?? ""),
      payrollMonth: String(row.payrollMonth ?? ""),
      periodStart: String(row.periodStart ?? ""),
      periodEnd: String(row.periodEnd ?? ""),
      confirmedAt: new Date(String(row.confirmedAt)).toISOString(),
      row: normalizePayrollRow(row.payrollRow && typeof row.payrollRow === "object" ? row.payrollRow as PayrollRow : {})
    }))
  });
}
