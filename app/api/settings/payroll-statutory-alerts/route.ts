import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

const payrollSettingsRoles = new Set(["owner", "manager", "buyer", "store_owner"]);
const residentTaxAlertKey = "resident-tax";
const dismissibleAlertKeys = new Set([
  "withholding-tax",
  "social-insurance-rate",
  "employment-insurance-rate",
  "resident-tax",
  "standard-remuneration"
]);

type AlertLevel = "critical" | "warning";

type PayrollStatutoryAlert = {
  key: string;
  level: AlertLevel;
  title: string;
  message: string;
  actionLabel: string;
  dueLabel: string;
  targetYear?: number;
  affectedStoreNames?: string[];
  dismissible?: boolean;
  dismissActionLabel?: string;
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

async function hasSocialInsuranceTable(fiscalYear: number) {
  const rows = await sql`
    select id
    from social_insurance_tables
    where fiscal_year = ${fiscalYear}
      and is_active = true
    limit 1
  `;
  return rows.length > 0;
}

async function hasEmploymentInsuranceRateTable(fiscalYear: number) {
  const rows = await sql`
    select id
    from employment_insurance_rate_tables
    where fiscal_year = ${fiscalYear}
      and is_active = true
    limit 1
  `;
  return rows.length > 0;
}

async function getVisiblePayrollStores(session: Awaited<ReturnType<typeof requireOsSession>>) {
  if (!session) return [];

  const scope = await getSessionStoreScope(session);
  if (scope.allStores) {
    return sql`
      select id::text, name
      from stores
      where status = 'active'
      order by name
    `;
  }

  if (scope.storeIds.length === 0) return [];
  return sql`
    select id::text, name
    from stores
    where status = 'active'
      and id::text = any(${scope.storeIds})
    order by name
  `;
}

type PayrollRequirement = "income_tax" | "social_insurance" | "employment_insurance" | "resident_tax" | "payroll";

async function getStoresWithPayrollRequirement(
  session: Awaited<ReturnType<typeof requireOsSession>>,
  alertKey: string,
  targetYear: number,
  requirement: PayrollRequirement
) {
  const stores = await getVisiblePayrollStores(session);
  const visibleStoreIds = stores.map((store) => String(store.id));
  if (visibleStoreIds.length === 0) return [];

  const payrollStoreRows = await sql`
    select distinct employee_work_stores.store_id::text as "storeId"
    from employee_work_stores
    join employees on employees.id = employee_work_stores.employee_id
    where employee_work_stores.store_id::text = any(${visibleStoreIds})
      and employee_work_stores.payroll_enabled = true
      and employees.status = 'active'
      and employees.payroll_subject = 'paid'
      and (
        ${requirement} = 'payroll'
        or (${requirement} = 'income_tax' and employee_work_stores.apply_income_tax = true)
        or (${requirement} = 'social_insurance' and employee_work_stores.apply_social_insurance = true)
        or (${requirement} = 'employment_insurance' and employee_work_stores.apply_employment_insurance = true)
        or (${requirement} = 'resident_tax' and employee_work_stores.apply_resident_tax = true)
      )
  `;
  const payrollStoreIds = new Set(payrollStoreRows.map((row) => String(row.storeId)));
  if (payrollStoreIds.size === 0) return [];

  const dismissedRows = await sql`
    select store_id::text as "storeId"
    from payroll_statutory_alert_dismissals
    where alert_key = ${alertKey}
      and target_year = ${targetYear}
      and store_id::text = any(${visibleStoreIds})
  `;
  const dismissedStoreIds = new Set(dismissedRows.map((row) => String(row.storeId)));

  return stores
    .filter((store) => payrollStoreIds.has(String(store.id)))
    .filter((store) => !dismissedStoreIds.has(String(store.id)))
    .map((store) => ({ id: String(store.id), name: String(store.name) }));
}

async function getResidentTaxMissingStores(session: Awaited<ReturnType<typeof requireOsSession>>, targetYear: number) {
  const stores = await getStoresWithPayrollRequirement(session, residentTaxAlertKey, targetYear, "resident_tax");
  const visibleStoreIds = stores.map((store) => String(store.id));
  if (visibleStoreIds.length === 0) return [];

  const configuredRows = await sql`
    select distinct employee_work_stores.store_id::text as "storeId"
    from employee_work_stores
    join employees on employees.id = employee_work_stores.employee_id
    where employee_work_stores.store_id::text = any(${visibleStoreIds})
      and employee_work_stores.payroll_enabled = true
      and employee_work_stores.apply_resident_tax = true
      and employee_work_stores.resident_tax_year = ${targetYear}
      and (
        coalesce(employee_work_stores.resident_tax_june_amount, 0) > 0
        or coalesce(employee_work_stores.resident_tax_monthly_amount, 0) > 0
      )
      and employees.status = 'active'
      and employees.payroll_subject = 'paid'
  `;
  const configuredStoreIds = new Set(configuredRows.map((row) => String(row.storeId)));

  return stores
    .filter((store) => !configuredStoreIds.has(String(store.id)))
    .map((store) => ({ id: String(store.id), name: String(store.name) }));
}

async function dismissPayrollStatutoryAlert(session: Awaited<ReturnType<typeof requireOsSession>>, alertKey: string, targetYear: number) {
  if (!session) return 0;
  const stores = await getVisiblePayrollStores(session);
  for (const store of stores) {
    await sql`
      insert into payroll_statutory_alert_dismissals (
        store_id,
        alert_key,
        target_year,
        dismissed_by,
        dismissed_at
      )
      values (
        ${store.id},
        ${alertKey},
        ${targetYear},
        ${session.id},
        now()
      )
      on conflict (store_id, alert_key, target_year)
      do update set
        dismissed_by = excluded.dismissed_by,
        dismissed_at = excluded.dismissed_at
    `;
  }
  return stores.length;
}

function makeStoreScopedMessage(storeNames: string[], message: string) {
  const storeLabel = storeNames.join("、");
  return `対象店舗: ${storeLabel}。${message}対象者がいない店舗、またはこの年度は不要な店舗はこの通知を閉じられます。`;
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
    const affectedStores = await getStoresWithPayrollRequirement(session, "withholding-tax", withholdingTargetYear, "income_tax");
    if (affectedStores.length > 0) {
      alerts.push({
        key: "withholding-tax",
        level: currentMonth === 1 ? "critical" : "warning",
        title: `${withholdingTargetYear}年分の源泉徴収税額表が未更新です`,
        message: makeStoreScopedMessage(
          affectedStores.map((store) => store.name),
          "給与計算で源泉所得税を正しく控除するため、国税庁の最新の月額表を取り込んでください。"
        ),
        actionLabel: "源泉税表をアップロード",
        dueLabel: "毎年1月支給分から適用",
        targetYear: withholdingTargetYear,
        affectedStoreNames: affectedStores.map((store) => store.name),
        dismissible: true,
        dismissActionLabel: "この年度は不要で閉じる"
      });
    }
  }

  if (inMonthWindow(today, 2, 4)) {
    const fiscalYear = fiscalYearForAprilStart(today);
    if (!(await hasSocialInsuranceTable(fiscalYear))) {
      const affectedStores = await getStoresWithPayrollRequirement(session, "social-insurance-rate", fiscalYear, "social_insurance");
      if (affectedStores.length > 0) {
        alerts.push({
          key: "social-insurance-rate",
          level: currentMonth >= 3 ? "critical" : "warning",
          title: `${fiscalYear}年度の健康保険・介護保険料率を確認してください`,
          message: makeStoreScopedMessage(
            affectedStores.map((store) => store.name),
            "協会けんぽの健康保険料率・介護保険料率は例年3月分（4月納付分）から見直されます。公式資料を取り込む準備をしてください。"
          ),
          actionLabel: "社会保険料表を確認",
          dueLabel: "3月分保険料から適用",
          targetYear: fiscalYear,
          affectedStoreNames: affectedStores.map((store) => store.name),
          dismissible: true,
          dismissActionLabel: "この年度は不要で閉じる"
        });
      }
    }
  }

  if (inMonthWindow(today, 3, 4)) {
    const fiscalYear = fiscalYearForAprilStart(today);
    if (!(await hasEmploymentInsuranceRateTable(fiscalYear))) {
      const affectedStores = await getStoresWithPayrollRequirement(session, "employment-insurance-rate", fiscalYear, "employment_insurance");
      if (affectedStores.length > 0) {
        alerts.push({
          key: "employment-insurance-rate",
          level: currentMonth === 4 ? "critical" : "warning",
          title: `${fiscalYear}年度の雇用保険料率を確認してください`,
          message: makeStoreScopedMessage(
            affectedStores.map((store) => store.name),
            "雇用保険料率は年度単位で切り替わります。厚生労働省の料率資料を確認し、給与計算の控除率を更新してください。"
          ),
          actionLabel: "雇用保険料率を確認",
          dueLabel: "毎年4月1日から適用",
          targetYear: fiscalYear,
          affectedStoreNames: affectedStores.map((store) => store.name),
          dismissible: true,
          dismissActionLabel: "この年度は不要で閉じる"
        });
      }
    }
  }

  if (inMonthWindow(today, 5, 6)) {
    const residentTaxYear = currentMonth >= 6 ? currentYear : currentYear - 1;
    const missingStores = await getResidentTaxMissingStores(session, residentTaxYear);
    if (missingStores.length > 0) {
      const storeLabel = missingStores.map((store) => store.name).join("、");
      alerts.push({
        key: residentTaxAlertKey,
        level: currentMonth === 6 ? "critical" : "warning",
        title: `${residentTaxYear}年度の住民税を入力してください`,
        message: `対象店舗: ${storeLabel}。住民税は市区町村の特別徴収税額通知に基づくため、従業員ごとに6月分と7月以降の金額を手入力してください。対象者がいない店舗はこの通知を閉じられます。`,
        actionLabel: "住民税を入力",
        dueLabel: "6月から翌年5月まで控除",
        targetYear: residentTaxYear,
        affectedStoreNames: missingStores.map((store) => store.name),
        dismissible: true,
        dismissActionLabel: "対象者なしで閉じる"
      });
    }
  }

  if (inMonthWindow(today, 7, 9)) {
    const fiscalYear = fiscalYearForAprilStart(today);
    const affectedStores = await getStoresWithPayrollRequirement(session, "standard-remuneration", fiscalYear, "social_insurance");
    if (affectedStores.length > 0) {
      alerts.push({
        key: "standard-remuneration",
        level: currentMonth === 9 ? "critical" : "warning",
        title: "標準報酬月額の定時決定を確認してください",
        message: makeStoreScopedMessage(
          affectedStores.map((store) => store.name),
          "4月から6月の報酬に基づく標準報酬月額は、原則として9月から翌年8月までの社会保険料計算に使われます。"
        ),
        actionLabel: "従業員の標準報酬月額を確認",
        dueLabel: "毎年9月分から適用",
        targetYear: fiscalYear,
        affectedStoreNames: affectedStores.map((store) => store.name),
        dismissible: true,
        dismissActionLabel: "確認済みで閉じる"
      });
    }
  }

  return Response.json({
    alerts,
    canView: true,
    checkedAt: today.toISOString(),
    nextCheckMonth: addMonths(today, 1).toISOString().slice(0, 7)
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  if (!payrollSettingsRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { action?: string; alertKey?: string; targetYear?: number | string };
  if (body.action !== "dismiss_payroll_statutory_alert") {
    return Response.json({ error: "操作が不正です。" }, { status: 400 });
  }
  const alertKey = String(body.alertKey ?? "");
  if (!dismissibleAlertKeys.has(alertKey)) {
    return Response.json({ error: "通知種別が不正です。" }, { status: 400 });
  }

  const targetYear = Math.round(Number(body.targetYear));
  if (!Number.isFinite(targetYear) || targetYear < 2000 || targetYear > 2100) {
    return Response.json({ error: "対象年度が不正です。" }, { status: 400 });
  }

  const dismissedCount = await dismissPayrollStatutoryAlert(session, alertKey, targetYear);
  return Response.json({ ok: true, dismissedCount });
}
