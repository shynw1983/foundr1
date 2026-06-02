import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

const payrollSettingsRoles = new Set(["owner", "manager", "buyer"]);

type AlertLevel = "critical" | "warning";

type PayrollStatutoryAlert = {
  key: string;
  level: AlertLevel;
  title: string;
  message: string;
  actionLabel: string;
  dueLabel: string;
};

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function inMonthWindow(today: Date, startMonth: number, endMonth: number) {
  const month = today.getUTCMonth() + 1;
  return month >= startMonth && month <= endMonth;
}

function fiscalYearForAprilStart(today: Date) {
  const year = today.getUTCFullYear();
  return today.getUTCMonth() + 1 >= 4 ? year : year - 1;
}

function nextCalendarYear(today: Date) {
  return today.getUTCFullYear() + 1;
}

async function hasWithholdingTaxTable(taxYear: number) {
  const rows = await sql`
    select id
    from withholding_tax_tables
    where tax_year = ${taxYear}
      and table_type = 'monthly'
      and is_active = true
    limit 1
  `;
  return rows.length > 0;
}

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  if (!payrollSettingsRoles.has(session.role)) {
    return Response.json({ alerts: [], canView: false });
  }

  const today = new Date();
  const alerts: PayrollStatutoryAlert[] = [];

  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth() + 1;
  const withholdingTargetYear = currentMonth >= 10 ? nextCalendarYear(today) : currentYear;
  const shouldCheckWithholding =
    inMonthWindow(today, 10, 12) ||
    inMonthWindow(today, 1, 1);
  if (shouldCheckWithholding && !(await hasWithholdingTaxTable(withholdingTargetYear))) {
    alerts.push({
      key: "withholding-tax",
      level: currentMonth === 1 ? "critical" : "warning",
      title: `${withholdingTargetYear}年分の源泉徴収税額表が未更新です`,
      message: "給与計算で源泉所得税を正しく控除するため、国税庁の最新の月額表を取り込んでください。",
      actionLabel: "源泉税表をアップロード",
      dueLabel: "毎年1月支給分から適用"
    });
  }

  if (inMonthWindow(today, 2, 4)) {
    const fiscalYear = fiscalYearForAprilStart(today);
    alerts.push({
      key: "social-insurance-rate",
      level: currentMonth >= 3 ? "critical" : "warning",
      title: `${fiscalYear}年度の健康保険・介護保険料率を確認してください`,
      message: "協会けんぽの健康保険料率・介護保険料率は例年3月分（4月納付分）から見直されます。公式資料を取り込む準備をしてください。",
      actionLabel: "社会保険料表を確認",
      dueLabel: "3月分保険料から適用"
    });
  }

  if (inMonthWindow(today, 3, 4)) {
    const fiscalYear = fiscalYearForAprilStart(today);
    alerts.push({
      key: "employment-insurance-rate",
      level: currentMonth === 4 ? "critical" : "warning",
      title: `${fiscalYear}年度の雇用保険料率を確認してください`,
      message: "雇用保険料率は年度単位で切り替わります。厚生労働省の料率資料を確認し、給与計算の控除率を更新してください。",
      actionLabel: "雇用保険料率を確認",
      dueLabel: "毎年4月1日から適用"
    });
  }

  if (inMonthWindow(today, 5, 6)) {
    const residentTaxYear = currentMonth >= 6 ? currentYear : currentYear - 1;
    alerts.push({
      key: "resident-tax",
      level: currentMonth === 6 ? "critical" : "warning",
      title: `${residentTaxYear}年度の住民税を入力してください`,
      message: "住民税は市区町村の特別徴収税額通知に基づくため、従業員ごとに6月分と7月以降の金額を手入力してください。",
      actionLabel: "住民税を入力",
      dueLabel: "6月から翌年5月まで控除"
    });
  }

  if (inMonthWindow(today, 7, 9)) {
    alerts.push({
      key: "standard-remuneration",
      level: currentMonth === 9 ? "critical" : "warning",
      title: "標準報酬月額の定時決定を確認してください",
      message: "4月から6月の報酬に基づく標準報酬月額は、原則として9月から翌年8月までの社会保険料計算に使われます。",
      actionLabel: "従業員の標準報酬月額を確認",
      dueLabel: "毎年9月分から適用"
    });
  }

  return Response.json({
    alerts,
    canView: true,
    checkedAt: today.toISOString(),
    nextCheckMonth: addMonths(today, 1).toISOString().slice(0, 7)
  });
}
