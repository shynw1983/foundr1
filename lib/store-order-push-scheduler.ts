import { start } from "workflow/api";
import { sql } from "./db";
import { ensureBridgeOrderPushEvent } from "./store-order-push";
import { bridgeOrderAlertPhase } from "./store-order-push-policy";
import { storeBridgeOrderAlertWorkflow } from "../workflows/store-bridge-order-alert";

export async function startBridgeOrderPush(eventId: string) {
  const rows = await sql`
    update store_order_alert_events set workflow_run_id = 'starting', updated_at = now()
    where id::text = ${eventId} and alert_phase = ${bridgeOrderAlertPhase} and status = 'pending' and acknowledged_at is null
      and due_at > now() - interval '5 minutes'
      and (workflow_run_id = '' or (workflow_run_id = 'starting' and updated_at < now() - interval '1 minute'))
    returning due_at::text as "dueAt"
  `;
  if (!rows[0]) return;
  try {
    const run = await start(storeBridgeOrderAlertWorkflow, [eventId, String(rows[0].dueAt)]);
    await sql`update store_order_alert_events set workflow_run_id = ${run.runId}, updated_at = now() where id::text = ${eventId} and workflow_run_id = 'starting'`;
  } catch (error) {
    await sql`update store_order_alert_events set workflow_run_id = '', last_error = 'WORKFLOW_START_FAILED', updated_at = now() where id::text = ${eventId} and workflow_run_id = 'starting'`;
    throw error;
  }
}

export async function scheduleBridgeOrderPush(orderId: string, capturedAt: Date) {
  const eventId = await ensureBridgeOrderPushEvent(orderId, capturedAt);
  if (eventId) await startBridgeOrderPush(eventId);
}
