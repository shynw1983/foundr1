import { canAccessStore, requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { ensureProductionTasksForOrder } from "../../../../../lib/order-production";
import { publishCustomerOrderEvent } from "../../../../../lib/order-realtime";
import { findCustomerOrderById } from "../../../../../lib/customer-orders";
import { buildShortageCandidates, handleStoreOrderShortage } from "../../../../../lib/store-order-shortages";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

async function findOrderStore(orderId: string) {
  const rows = await sql`
    select store_id::text as "storeId"
    from store_customer_orders
    where id::text = ${orderId}
    limit 1
  `;
  return clean(rows[0]?.storeId);
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  const orderId = clean(new URL(request.url).searchParams.get("orderId"));
  if (!orderId) return Response.json({ error: "注文を選択してください。" }, { status: 400 });
  const storeId = await findOrderStore(orderId);
  if (!storeId || !(await canAccessStore(session, storeId))) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const orderRows = await sql`
    select
      shortage_preference as "shortagePreference",
      status,
      payment_status as "paymentStatus"
    from store_customer_orders
    where id::text = ${orderId}
    limit 1
  `;
  const items = await sql`
    select
      id::text,
      item_name as "itemName",
      amount::int,
      coalesce(nullif(paid_amount, 0), amount)::int as "paidAmount",
      refunded_amount::int as "refundedAmount",
      coalesce(refund_status, '') as "refundStatus",
      coalesce(customizations, '[]'::jsonb) as customizations
    from store_customer_order_items
    where order_id::text = ${orderId}
    order by sort_order, created_at
  `;
  const actions = await sql`
    select
      id::text,
      order_item_id::text as "orderItemId",
      target_type as "targetType",
      target_key as "targetKey",
      target_name as "targetName",
      action_type as "actionType",
      replacement_name as "replacementName",
      refund_amount::int as "refundAmount",
      payment_refund_status as "paymentRefundStatus",
      payment_refund_error as "paymentRefundError",
      created_at::text as "createdAt"
    from store_order_shortage_actions
    where order_id::text = ${orderId}
    order by created_at desc
  `;
  const handledTargets = new Set((actions as any[])
    .filter((action) => action.paymentRefundStatus !== "failed")
    .map((action) => `${action.orderItemId}:${action.targetKey}`));
  return Response.json({
    ...orderRows[0],
    items: items.map((item: any) => ({
      ...item,
      candidates: buildShortageCandidates(item).filter((candidate) => !handledTargets.has(`${item.id}:${candidate.key}`))
    })),
    actions
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const orderId = clean(body.orderId);
  const orderItemId = clean(body.orderItemId);
  const targetKey = clean(body.targetKey);
  const actionType = clean(body.actionType);
  if (!orderId || !orderItemId || !targetKey || !["replace", "refund"].includes(actionType)) {
    return Response.json({ error: "欠品対応の内容が不正です。" }, { status: 400 });
  }
  const storeId = await findOrderStore(orderId);
  if (!storeId || !(await canAccessStore(session, storeId))) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const result = await handleStoreOrderShortage({
    orderId,
    orderItemId,
    targetKey,
    actionType: actionType as "replace" | "refund",
    replacementName: clean(body.replacementName),
    employeeId: session.id,
    employeeName: session.name
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  if (!result.allItemsRefunded) await ensureProductionTasksForOrder(orderId);
  const order = await findCustomerOrderById(orderId);
  if (order) await publishCustomerOrderEvent("order.updated", order);
  return Response.json(result);
}
