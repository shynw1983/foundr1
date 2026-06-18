import { notifyOwnersForDueDeliveryImports } from "../../../../lib/sales-delivery-import-reminders";
import { auditSalesOrders, notifySalesOrderAuditProblems } from "../../../../lib/sales-order-audit";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function runSalesAuditCron(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await auditSalesOrders();
  const notification = await notifySalesOrderAuditProblems(report);
  const deliveryImportReminder = await notifyOwnersForDueDeliveryImports();
  return Response.json({ ...report, notification, deliveryImportReminder }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  return runSalesAuditCron(request);
}

export async function POST(request: Request) {
  return runSalesAuditCron(request);
}
