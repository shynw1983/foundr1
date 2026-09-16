import { sql } from "../../../../lib/db";
import { getOrderPushConfig, verifyOrderPushTransport, OrderPushTransportError } from "../../../../lib/store-order-push-transport";
import { startBridgeOrderPush } from "../../../../lib/store-order-push-scheduler";
import { bridgeOrderAlertPhase } from "../../../../lib/store-order-push-policy";

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!getOrderPushConfig().fcm) return Response.json({ error: "FCM_NOT_CONFIGURED" }, { status: 503 });
  try {
    await verifyOrderPushTransport();
    return Response.json({ ok: true, validateOnly: true, enabled: getOrderPushConfig().enabled });
  } catch (error) {
    return Response.json({ error: error instanceof OrderPushTransportError ? error.message : "FCM_VERIFICATION_FAILED" }, { status: 502 });
  }
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!getOrderPushConfig().enabled) return Response.json({ skipped: true });
  const rows = await sql`
    select id::text from store_order_alert_events where alert_phase = ${bridgeOrderAlertPhase}
      and status = 'pending' and acknowledged_at is null and due_at > now() - interval '5 minutes'
      and (workflow_run_id = '' or (workflow_run_id = 'starting' and updated_at < now() - interval '1 minute')) limit 40
  `;
  const results = await Promise.allSettled(rows.map((row) => startBridgeOrderPush(String(row.id))));
  return Response.json({ checked: rows.length, failed: results.filter((r) => r.status === "rejected").length });
}
