import { sql } from "./db";
import { findCustomerOrderById, type CustomerOrderRow } from "./customer-orders";
import { publishCustomerOrderEvent } from "./order-realtime";
import { createOsNotification } from "./web-push";
import { getScheduledOrderReminderAt } from "./store-order-alert-timing";

export const preparationDueAlertPhase = "preparation_due";

type StoreOrderAlertEvent = {
  id: string;
  orderId: string;
  storeId: string;
  alertPhase: string;
  dueAt: string;
  status: string;
  workflowRunId: string;
};

export function getPreparationDueAt(order: Pick<CustomerOrderRow, "pickupDate" | "pickupTime">) {
  return getScheduledOrderReminderAt(order);
}

export function shouldSchedulePreparationDueAlert(order: CustomerOrderRow) {
  return order.orderSource === "maamaa_web"
    && order.pickupTiming === "scheduled"
    && order.paymentStatus === "paid"
    && order.status === "new"
    && Boolean(order.storeId)
    && Boolean(getPreparationDueAt(order));
}

export async function ensurePreparationDueAlertEvent(order: CustomerOrderRow) {
  if (!shouldSchedulePreparationDueAlert(order)) return null;
  const dueAt = getPreparationDueAt(order);
  if (!dueAt) return null;

  const rows = await sql`
    insert into store_order_alert_events (order_id, store_id, alert_phase, due_at)
    values (${order.id}, ${order.storeId}, ${preparationDueAlertPhase}, ${dueAt.toISOString()}::timestamptz)
    on conflict (order_id, alert_phase)
    do update set
      due_at = excluded.due_at,
      updated_at = now()
    returning
      id::text,
      order_id::text as "orderId",
      store_id::text as "storeId",
      alert_phase as "alertPhase",
      due_at::text as "dueAt",
      status,
      workflow_run_id as "workflowRunId"
  `;
  return (rows[0] as StoreOrderAlertEvent | undefined) ?? null;
}

export async function recordAlertWorkflowRun(eventId: string, runId: string) {
  await sql`
    update store_order_alert_events
    set workflow_run_id = ${runId}, updated_at = now()
    where id::text = ${eventId}
      and workflow_run_id = ''
  `;
}

async function getStoreTerminalRecipients(storeId: string) {
  const rows = await sql`
    select distinct employees.id::text
    from employees
    join employee_scopes
      on employee_scopes.employee_id = employees.id
      and employee_scopes.scope_type = 'store'
      and employee_scopes.store_id::text = ${storeId}
    where employees.status = 'active'
      and employees.role = 'store_terminal'
  `;
  return rows.map((row) => String(row.id));
}

export async function dispatchPreparationDueAlert(eventId: string) {
  const eventRows = await sql`
    update store_order_alert_events
    set
      status = 'dispatching',
      attempt_count = attempt_count + 1,
      last_error = '',
      updated_at = now()
    where id::text = ${eventId}
      and alert_phase = ${preparationDueAlertPhase}
      and status in ('pending', 'dispatching')
    returning order_id::text as "orderId", store_id::text as "storeId"
  `;
  const event = eventRows[0] as { orderId: string; storeId: string } | undefined;
  if (!event) return { status: "ignored" as const };

  const order = await findCustomerOrderById(event.orderId);
  if (!order || order.paymentStatus !== "paid" || order.status !== "new" || order.orderSource !== "maamaa_web") {
    await sql`
      update store_order_alert_events
      set status = 'cancelled', updated_at = now()
      where id::text = ${eventId}
    `;
    return { status: "cancelled" as const };
  }

  const triggeredAt = new Date().toISOString();
  await sql`
    update store_customer_orders
    set
      customer_summary = customer_summary || ${JSON.stringify({ preparationAlertTriggeredAt: triggeredAt })}::jsonb,
      updated_at = now()
    where id::text = ${order.id}
  `;
  const refreshedOrder = await findCustomerOrderById(order.id);
  const recipients = await getStoreTerminalRecipients(event.storeId);
  const pickupLabel = `${order.pickupDate} ${order.pickupTime}`;
  const results = await Promise.allSettled([
    publishCustomerOrderEvent("order.updated", refreshedOrder),
    ...recipients.map((employeeId) => createOsNotification({
      employeeId,
      type: "store_order_preparation_due",
      title: "予約時間が近づいています",
      message: `受付番号 ${order.pickupCode} / 受取予定 ${pickupLabel}`,
      href: `/store/orders?storeId=${encodeURIComponent(event.storeId)}&orderId=${encodeURIComponent(order.id)}`,
      sourceKey: `store_order_alert:${eventId}`
    }))
  ]);
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  if (errors.length) {
    await sql`
      update store_order_alert_events
      set last_error = ${errors.join(" | ")}, updated_at = now()
      where id::text = ${eventId}
    `;
    throw new Error(errors.join(" | "));
  }
  await sql`
    update store_order_alert_events
    set
      status = 'sent',
      first_sent_at = coalesce(first_sent_at, now()),
      last_sent_at = now(),
      last_error = '',
      updated_at = now()
    where id::text = ${eventId}
  `;
  return { status: "sent" as const, recipientCount: recipients.length, errors };
}

export async function acknowledgePreparationDueAlert(orderId: string, employeeId: string) {
  await sql`
    update store_order_alert_events
    set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = ${employeeId}, updated_at = now()
    where order_id::text = ${orderId}
      and alert_phase = ${preparationDueAlertPhase}
  `;
}

export async function cancelPendingStoreOrderAlerts(orderId: string) {
  await sql`
    update store_order_alert_events
    set status = 'cancelled', updated_at = now()
    where order_id::text = ${orderId}
      and status in ('pending', 'dispatching')
  `;
}
