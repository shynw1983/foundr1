import { evaluateExternalServiceUsageAlerts } from "../../../../lib/external-service-usage";
import { issueMonthlyBirthdayCoupons } from "../../../../lib/loyalty";
import { notifyOwnersForDueDeliveryImports } from "../../../../lib/sales-delivery-import-reminders";
import { auditSalesOrders, notifySalesOrderAuditProblems } from "../../../../lib/sales-order-audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function runSalesMaintenance() {
  const report = await auditSalesOrders();
  const notification = await notifySalesOrderAuditProblems(report);
  const deliveryImportReminder = await notifyOwnersForDueDeliveryImports();
  return { ...report, notification, deliveryImportReminder };
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tasks = {
    birthdayCoupons: () => issueMonthlyBirthdayCoupons({ respectSchedule: true }),
    serviceUsage: () => evaluateExternalServiceUsageAlerts(),
    salesAudit: () => runSalesMaintenance()
  };
  const entries = await Promise.all(Object.entries(tasks).map(async ([name, task]) => {
    try {
      return [name, { ok: true, result: await task() }] as const;
    } catch (error) {
      return [name, { ok: false, error: error instanceof Error ? error.message : "Unknown error" }] as const;
    }
  }));
  const results = Object.fromEntries(entries);
  const ok = entries.every(([, result]) => result.ok);
  return Response.json({ ok, results }, {
    status: ok ? 200 : 500,
    headers: { "Cache-Control": "no-store" }
  });
}
