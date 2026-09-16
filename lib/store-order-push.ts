import { createHash } from "node:crypto";
import { sql } from "./db";
import { bridgeOrderAlertPhase, canSendOrderPush, isRecentBridgeObservation, orderPushAttempts, orderPushText } from "./store-order-push-policy";
import { getOrderPushConfig, OrderPushTransportError, sendOrderPush, type OrderPushDevice } from "./store-order-push-transport";

export const hashPushValue = (value: string) => createHash("sha256").update(value).digest("hex");
export type OrderPushRule = {
  storeId: string; storeName: string; latitude: number | null; longitude: number | null;
  exitRadius: number; enterRadius: number; ruleVersion: string;
};
export function orderPushRuleKey(rule: OrderPushRule) {
  return hashPushValue([rule.storeId, rule.latitude, rule.longitude, rule.exitRadius, rule.enterRadius, rule.ruleVersion].join(":"));
}

export async function getOrderPushRules(employeeId: string) {
  const rows = await sql`
    select p.store_id::text as "storeId", s.name as "storeName",
      s.attendance_latitude::float as latitude, s.attendance_longitude::float as longitude,
      p.exit_radius_m as "exitRadius", p.enter_radius_m as "enterRadius", p.rule_version::text as "ruleVersion"
    from store_order_push_preferences p
    join stores s on s.id = p.store_id and s.status = 'active'
    join employees e on e.id = p.employee_id and e.status = 'active'
    where p.employee_id::text = ${employeeId} and p.enabled
      and e.role in ('owner', 'manager', 'store_terminal')
      and (e.role in ('owner', 'manager') or exists (
        select 1 from employee_scopes sc where sc.employee_id = e.id and sc.scope_type = 'store' and sc.store_id = s.id
      ))
    order by s.name
  ` as OrderPushRule[];
  return rows.filter((row) => row.latitude !== null && row.longitude !== null)
    .map((row) => ({ ...row, key: orderPushRuleKey(row) }));
}

export async function ensureBridgeOrderPushEvent(orderId: string, capturedAt: Date) {
  if (!getOrderPushConfig().enabled || !isRecentBridgeObservation(capturedAt)) return null;
  const rows = await sql`
    insert into store_order_alert_events (order_id, store_id, alert_phase, due_at)
    select o.id, o.store_id, ${bridgeOrderAlertPhase}, now()
    from store_customer_orders o
    where o.id::text = ${orderId} and o.order_source in ('uber_eats', 'rocket_now', 'demae_can')
      and o.status in ('new', 'preparing') and o.payment_status in ('paid', 'partial_refunded')
      and o.created_at between now() - interval '10 minutes' and now() + interval '1 minute'
      and coalesce(o.customer_summary ->> 'initialAlertAcknowledgedAt', '') = ''
      and exists (select 1 from order_production_tasks t where t.order_id = o.id and t.status = 'new')
      and not exists (select 1 from order_production_tasks t where t.order_id = o.id and t.status <> 'new')
      and exists (select 1 from store_order_push_preferences p where p.store_id = o.store_id and p.enabled)
    on conflict (order_id, alert_phase) do nothing
    returning id::text
  `;
  if (rows[0]?.id) return String(rows[0].id);
  const existing = await sql`
    select id::text from store_order_alert_events where order_id::text = ${orderId}
      and alert_phase = ${bridgeOrderAlertPhase} and status = 'pending' and acknowledged_at is null
      and due_at > now() - interval '5 minutes'
  `;
  return existing[0]?.id ? String(existing[0].id) : null;
}

export async function getBridgeOrderPushEvent(eventId: string) {
  const rows = await sql`
    select a.id::text, a.order_id::text as "orderId", a.store_id::text as "storeId", a.due_at as "dueAt",
      a.acknowledged_at as "acknowledgedAt", a.status as "eventStatus",
      o.order_source as source, o.status, o.payment_status as "paymentStatus",
      o.pickup_code as "pickupCode", o.amount::float, s.name as "storeName",
      coalesce(o.customer_summary ->> 'initialAlertAcknowledgedAt', '') as "initialAcknowledgedAt",
      exists (select 1 from order_production_tasks t where t.order_id = o.id and t.status = 'new') as "hasWaitingTask",
      exists (select 1 from order_production_tasks t where t.order_id = o.id and t.status <> 'new') as "hasStartedTask"
    from store_order_alert_events a join store_customer_orders o on o.id = a.order_id join stores s on s.id = a.store_id
    where a.id::text = ${eventId} and a.alert_phase = ${bridgeOrderAlertPhase}
  `;
  return rows[0] as {
    id: string; orderId: string; storeId: string; dueAt: string; acknowledgedAt: string | null; eventStatus: string;
    source: string; status: string; paymentStatus: string; pickupCode: string; amount: number; storeName: string;
    initialAcknowledgedAt: string; hasWaitingTask: boolean; hasStartedTask: boolean;
  } | undefined;
}

async function getOutsideDevices(storeId: string) {
  return await sql`
    select d.id::text, d.employee_id::text as "employeeId", d.session_id::text as "sessionId", d.provider, d.registration, d.language,
      pr.rule_key as "presenceRuleKey", p.store_id::text as "storeId", s.name as "storeName",
      s.attendance_latitude::float as latitude, s.attendance_longitude::float as longitude,
      p.exit_radius_m as "exitRadius", p.enter_radius_m as "enterRadius", p.rule_version::text as "ruleVersion"
    from store_order_push_devices d
    join employees e on e.id = d.employee_id and e.status = 'active'
    join employee_sessions es on es.id = d.session_id and es.employee_id = e.id
      and es.session_version = e.session_version and es.revoked_at is null and es.expires_at > now()
    join store_order_push_preferences p on p.employee_id = e.id and p.store_id::text = ${storeId} and p.enabled
    join stores s on s.id = p.store_id and s.status = 'active'
    join store_order_push_presence pr on pr.device_id = d.id and pr.store_id = p.store_id and pr.state = 'outside'
    where d.revoked_at is null and e.role in ('owner', 'manager', 'store_terminal') and (e.role in ('owner', 'manager') or exists (
      select 1 from employee_scopes sc where sc.employee_id = e.id and sc.scope_type = 'store' and sc.store_id = s.id
    ))
  ` as Array<OrderPushDevice & OrderPushRule & { presenceRuleKey: string }>;
}

export async function dispatchBridgeOrderPush(eventId: string, attempt: number) {
  if (!getOrderPushConfig().enabled || !Number.isInteger(attempt) || attempt < 0 || attempt >= orderPushAttempts) return { stop: true };
  const event = await getBridgeOrderPushEvent(eventId);
  if (!event || event.eventStatus === "cancelled" || !canSendOrderPush(event)) {
    if (event) await sql`update store_order_alert_events set status = 'cancelled', updated_at = now() where id::text = ${eventId}`;
    return { stop: true };
  }
  // A delayed scheduler should not burst all missed reminders at once.
  if (attempt < orderPushAttempts - 1 && Date.now() - new Date(event.dueAt).getTime() >= (attempt + 1) * 30_000) return { stop: false, recipients: 0 };
  const devices = (await getOutsideDevices(event.storeId)).filter((device) => device.presenceRuleKey === orderPushRuleKey(device));
  let failed = false;
  for (const device of devices) {
    // Recheck acknowledgement immediately before each recipient, including on workflow retry.
    const current = await getBridgeOrderPushEvent(eventId);
    if (!current || !canSendOrderPush(current)) return { stop: true };
    const claimed = await sql`
      insert into store_order_push_deliveries (event_id, device_id, attempt, lease_until)
      values (${eventId}, ${device.id}, ${attempt}, now() + interval '30 seconds')
      on conflict (event_id, device_id, attempt) do update set status = 'sending', lease_until = now() + interval '30 seconds', updated_at = now()
      where store_order_push_deliveries.status = 'failed'
        or (store_order_push_deliveries.status = 'sending' and store_order_push_deliveries.lease_until < now())
      returning event_id
    `;
    if (!claimed.length) continue;
    try {
      const text = orderPushText(event, attempt, device.language);
      await sendOrderPush(device, {
        ...text, type: "store_bridge_order", eventId, orderId: event.orderId, storeId: event.storeId,
        ruleKey: device.presenceRuleKey, deliveryKey: `${eventId}:${attempt}`,
        expiresAt: String(Date.now() + 60_000), href: `/store/notifications?eventId=${eventId}`
      });
      await sql`update store_order_push_deliveries set status = 'sent', last_error = '', updated_at = now() where event_id::text = ${eventId} and device_id::text = ${device.id} and attempt = ${attempt}`;
      await sql`update store_order_push_devices set last_success_at = now(), last_error = '' where id::text = ${device.id}`;
    } catch (error) {
      failed = true;
      const message = error instanceof OrderPushTransportError ? error.message : "PUSH_SEND_FAILED";
      await sql`update store_order_push_deliveries set status = 'failed', last_error = ${message}, updated_at = now() where event_id::text = ${eventId} and device_id::text = ${device.id} and attempt = ${attempt}`;
      await sql`update store_order_push_devices set last_error = ${message}, revoked_at = case when ${error instanceof OrderPushTransportError && error.expired} then now() else revoked_at end where id::text = ${device.id}`;
    }
  }
  await sql`
    update store_order_alert_events set attempt_count = greatest(attempt_count, ${attempt + 1}),
      last_error = ${failed ? "PUSH_SEND_FAILED" : ""}, updated_at = now()
    where id::text = ${eventId}
  `;
  return { stop: false, failed, recipients: devices.length };
}
