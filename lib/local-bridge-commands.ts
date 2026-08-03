import { sql } from "./db";
import { publishBridgeCommandAvailable } from "./local-bridge-realtime";

export async function reconcileUberReadyCommand(orderId: string) {
  const rows = await sql`
    select
      store_id::text as "storeId",
      order_source as "orderSource",
      pickup_code as "orderCode",
      status
    from store_customer_orders
    where id::text = ${orderId}
    limit 1
  `;
  const order = rows[0] as {
    storeId: string;
    orderSource: string;
    orderCode: string;
    status: string;
  } | undefined;
  if (!order || order.orderSource !== "uber_eats") return;

  const idempotencyKey = `uber_eats:mark_order_ready:${orderId}`;
  if (order.status !== "ready") {
    await sql`
      update local_bridge_commands
      set status = 'cancelled', updated_at = now()
      where idempotency_key = ${idempotencyKey}
        and status = 'pending'
    `;
    return;
  }

  await sql`
    insert into local_bridge_commands (
      store_id,
      platform,
      command_type,
      idempotency_key,
      payload
    )
    values (
      ${order.storeId},
      'uber_eats',
      'mark_order_ready',
      ${idempotencyKey},
      ${JSON.stringify({ orderId, orderCode: order.orderCode })}::jsonb
    )
    on conflict (idempotency_key) do update set
      status = case
        when local_bridge_commands.status = 'cancelled' then 'pending'
        else local_bridge_commands.status
      end,
      available_at = case
        when local_bridge_commands.status = 'cancelled' then now()
        else local_bridge_commands.available_at
      end,
      updated_at = now()
  `;
  await publishBridgeCommandAvailable(order.storeId).catch(() => undefined);
}
