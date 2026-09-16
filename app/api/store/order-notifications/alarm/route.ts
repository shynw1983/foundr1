import { sql } from "../../../../../lib/db";
import { authenticateOrderPushDevice } from "../../../../../lib/store-order-push-device-auth";
import { getOrderPushRules } from "../../../../../lib/store-order-push";
import { bridgeOrderAlertPhase } from "../../../../../lib/store-order-push-policy";
import { getOrderPushConfig } from "../../../../../lib/store-order-push-transport";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request: Request) {
  const device = await authenticateOrderPushDevice(request);
  if (!device) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !["status", "acknowledge"].includes(body.action) || !Array.isArray(body.eventIds)
    || body.eventIds.length > 50 || body.eventIds.some((id: unknown) => typeof id !== "string" || !uuid.test(id))) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const eventIds = [...new Set<string>(body.eventIds)];
  const rules = await getOrderPushRules(device.employeeId);
  const storeIds = rules.map((rule) => rule.storeId);
  // Delivery possession AND current scope are required. A device token cannot enumerate
  // other stores' orders or acknowledge an alert never delivered to this device.
  const owned = eventIds.length ? await sql`
    select a.id::text, a.store_id::text as "storeId"
    from store_order_alert_events a
    where a.id::text = any(${eventIds}) and a.alert_phase = ${bridgeOrderAlertPhase}
      and a.store_id::text = any(${storeIds})
      and exists (select 1 from store_order_push_deliveries d where d.event_id = a.id
        and d.device_id::text = ${device.id} and d.status in ('sending', 'sent'))
  ` as Array<{ id: string; storeId: string }> : [];
  if (body.action === "acknowledge") {
    if (owned.length !== eventIds.length) return Response.json({ error: "forbidden" }, { status: 403 });
    if (eventIds.length) await sql`
      update store_order_alert_events set acknowledged_at = coalesce(acknowledged_at, now()),
        acknowledged_by = coalesce(acknowledged_by, ${device.employeeId}::uuid), updated_at = now()
      where id::text = any(${eventIds}) and alert_phase = ${bridgeOrderAlertPhase}
    `;
    return Response.json({ ok: true, acknowledgedIds: eventIds });
  }
  if (!getOrderPushConfig().enabled || !owned.length) return Response.json({ ok: true, activeIds: [] });
  const ownedIds = owned.map((event) => event.id);
  const active = await sql`
    select a.id::text, a.store_id::text as "storeId", pr.rule_key as "ruleKey"
    from store_order_alert_events a join store_customer_orders o on o.id = a.order_id
    join store_order_push_presence pr on pr.store_id = a.store_id and pr.device_id::text = ${device.id} and pr.state = 'outside'
    where a.id::text = any(${ownedIds}) and a.acknowledged_at is null
      and o.order_source in ('uber_eats', 'rocket_now', 'demae_can')
      and o.status in ('new', 'preparing') and o.payment_status in ('paid', 'partial_refunded')
      and coalesce(o.customer_summary ->> 'initialAlertAcknowledgedAt', '') = ''
      and exists (select 1 from order_production_tasks t where t.order_id = o.id and t.status = 'new')
      and not exists (select 1 from order_production_tasks t where t.order_id = o.id and t.status <> 'new')
  ` as Array<{ id: string; storeId: string; ruleKey: string }>;
  // No five-minute ring timeout: that bound governs new FCM delivery, not an alarm
  // already received and still awaiting human attention.
  return Response.json({ ok: true, activeIds: active.filter((event) => rules.some((rule) => rule.storeId === event.storeId && rule.key === event.ruleKey)).map((event) => event.id) },
    { headers: { "Cache-Control": "no-store" } });
}
