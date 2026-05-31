import { canAccessStore, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { findCustomerOrderById } from "../../../../lib/customer-orders";
import { publishCustomerOrderEvent } from "../../../../lib/order-realtime";
import { canChangeOrderStatus, getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, params.get("storeId"));
  if (storeFilter === "__forbidden__") return Response.json({ error: "権限がありません。" }, { status: 403 });

  const orders = await sql`
    select
      store_customer_orders.id::text,
      coalesce(store_customer_orders.store_id::text, '') as "storeId",
      coalesce(stores.name, '') as "storeName",
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      store_customer_orders.pickup_date::text as "pickupDate",
      store_customer_orders.pickup_time as "pickupTime",
      store_customer_orders.amount,
      store_customer_orders.currency,
      store_customer_orders.drink,
      store_customer_orders.size,
      store_customer_orders.temperature,
      store_customer_orders.sweetness,
      store_customer_orders.ice,
      store_customer_orders.option_text as "option",
      store_customer_orders.toppings,
      store_customer_orders.created_at as "createdAt",
      coalesce(store_customer_orders.square_receipt_url, '') as "squareReceiptUrl"
    from store_customer_orders
    left join stores on stores.id = store_customer_orders.store_id
    where (${access.allStores} or store_customer_orders.store_id::text = any(${access.storeIds}))
      and (${storeFilter}::text is null or store_customer_orders.store_id::text = ${storeFilter})
      and store_customer_orders.created_at > now() - interval '14 days'
    order by store_customer_orders.pickup_date desc, store_customer_orders.pickup_time desc, store_customer_orders.created_at desc
  `;

  return Response.json({ orders, access }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { orderId?: string; status?: string };
  const orderId = String(body.orderId ?? "").trim();
  const status = String(body.status ?? "").trim();
  const access = await getStoreOrderAccess(session);
  if (!orderId || !canChangeOrderStatus(access, status)) return Response.json({ error: "更新内容が不正です。" }, { status: 400 });

  const targetRows = await sql`
    select store_id::text as "storeId"
    from store_customer_orders
    where id = ${orderId}
    limit 1
  `;
  const target = targetRows[0] as { storeId: string } | undefined;
  if (!target || !(await canAccessStore(session, target.storeId))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const rows = await sql`
    update store_customer_orders
    set
      status = ${status},
      preparing_at = case when ${status} = 'preparing' and preparing_at is null then now() else preparing_at end,
      ready_at = case when ${status} = 'ready' and ready_at is null then now() else ready_at end,
      completed_at = case when ${status} = 'completed' and completed_at is null then now() else completed_at end,
      cancelled_at = case when ${status} = 'cancelled' and cancelled_at is null then now() else cancelled_at end,
      updated_at = now()
    where id = ${orderId}
    returning id::text
  `;
  if (rows[0]?.id) {
    await publishCustomerOrderEvent("order.updated", await findCustomerOrderById(rows[0].id as string));
  }

  return Response.json({ ok: Boolean(rows[0]?.id) });
}
