import { canAccessStore, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { findCustomerOrderById } from "../../../../lib/customer-orders";
import { ensureProductionTasksForOrder } from "../../../../lib/order-production";
import { publishCustomerOrderEvent } from "../../../../lib/order-realtime";
import { syncWebReservationToSalesOrder } from "../../../../lib/sales-orders";
import { canChangeOrderStatus, getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const access = await getStoreOrderAccess(session);
  const isWatchRequest = params.get("watch") === "1";
  const storeFilter = isWatchRequest
    ? getScopedStoreFilter(access, params.get("storeId"))
    : getScopedStoreFilter(access, params.get("storeId")) ?? access.stores[0]?.id ?? null;
  if (storeFilter === "__forbidden__") return Response.json({ error: "権限がありません。" }, { status: 403 });

  const orders = await sql`
    select
      store_customer_orders.id::text,
      coalesce(store_customer_orders.store_id::text, '') as "storeId",
      coalesce(stores.name, '') as "storeName",
      store_customer_orders.order_source as "orderSource",
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
      coalesce(
        store_customer_orders.customer_summary #>> '{customer,name}',
        store_customer_orders.customer_summary ->> 'name',
        ''
      ) as "customerName",
      coalesce(
        store_customer_orders.customer_summary #>> '{customer,phone}',
        store_customer_orders.customer_summary ->> 'phone',
        ''
      ) as "customerPhone",
      coalesce(
        store_customer_orders.customer_summary #>> '{customer,note}',
        store_customer_orders.customer_summary ->> 'note',
        ''
      ) as "customerNote",
      coalesce(store_customer_orders.customer_summary ->> 'orderType', '') as "orderType",
      coalesce(production_tasks.tasks, '[]'::json) as "productionTasks",
      store_customer_orders.created_at as "createdAt",
      coalesce(store_customer_orders.payment_receipt_url, store_customer_orders.square_receipt_url, '') as "squareReceiptUrl"
    from store_customer_orders
    left join stores on stores.id = store_customer_orders.store_id
    left join lateral (
      select json_agg(
        json_build_object(
          'id', order_production_tasks.id::text,
          'productionArea', order_production_tasks.production_area,
          'productionAreaLabel', order_production_tasks.production_area_label,
          'status', order_production_tasks.status,
          'printStatus', order_production_tasks.print_status,
          'itemSummary', order_production_tasks.item_summary
        )
        order by order_production_tasks.production_area_label
      ) as tasks
      from order_production_tasks
      where order_production_tasks.order_id = store_customer_orders.id
    ) production_tasks on true
    where (${access.allStores} or store_customer_orders.store_id::text = any(${access.storeIds}))
      and (${storeFilter}::text is null or store_customer_orders.store_id::text = ${storeFilter})
      and store_customer_orders.created_at > now() - interval '14 days'
    order by store_customer_orders.pickup_date desc, store_customer_orders.pickup_time desc, store_customer_orders.created_at desc
  `;

  const ordersNeedingTasks = (orders as Array<{ id: string; status: string; paymentStatus: string; productionTasks?: unknown[] }>)
    .filter((order) => order.paymentStatus === "paid" && ["new", "preparing", "ready"].includes(order.status) && !(Array.isArray(order.productionTasks) && order.productionTasks.length))
    .slice(0, 30);
  for (const order of ordersNeedingTasks) {
    await ensureProductionTasksForOrder(order.id);
  }
  const responseOrders = ordersNeedingTasks.length ? await sql`
    select
      store_customer_orders.id::text,
      coalesce(store_customer_orders.store_id::text, '') as "storeId",
      coalesce(stores.name, '') as "storeName",
      store_customer_orders.order_source as "orderSource",
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
      coalesce(store_customer_orders.customer_summary #>> '{customer,name}', store_customer_orders.customer_summary ->> 'name', '') as "customerName",
      coalesce(store_customer_orders.customer_summary #>> '{customer,phone}', store_customer_orders.customer_summary ->> 'phone', '') as "customerPhone",
      coalesce(store_customer_orders.customer_summary #>> '{customer,note}', store_customer_orders.customer_summary ->> 'note', '') as "customerNote",
      coalesce(store_customer_orders.customer_summary ->> 'orderType', '') as "orderType",
      coalesce(production_tasks.tasks, '[]'::json) as "productionTasks",
      store_customer_orders.created_at as "createdAt",
      coalesce(store_customer_orders.payment_receipt_url, store_customer_orders.square_receipt_url, '') as "squareReceiptUrl"
    from store_customer_orders
    left join stores on stores.id = store_customer_orders.store_id
    left join lateral (
      select json_agg(json_build_object(
        'id', order_production_tasks.id::text,
        'productionArea', order_production_tasks.production_area,
        'productionAreaLabel', order_production_tasks.production_area_label,
        'status', order_production_tasks.status,
        'printStatus', order_production_tasks.print_status,
        'itemSummary', order_production_tasks.item_summary
      ) order by order_production_tasks.production_area_label) as tasks
      from order_production_tasks
      where order_production_tasks.order_id = store_customer_orders.id
    ) production_tasks on true
    where (${access.allStores} or store_customer_orders.store_id::text = any(${access.storeIds}))
      and (${storeFilter}::text is null or store_customer_orders.store_id::text = ${storeFilter})
      and store_customer_orders.created_at > now() - interval '14 days'
    order by store_customer_orders.pickup_date desc, store_customer_orders.pickup_time desc, store_customer_orders.created_at desc
  ` : orders;

  return Response.json({
    orders: responseOrders,
    access: { ...access, canUseAllStoreView: false },
    selectedStoreId: storeFilter
  }, { headers: { "Cache-Control": "no-store" } });
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
    if (["preparing", "ready"].includes(status)) {
      await ensureProductionTasksForOrder(rows[0].id as string);
      await sql`
        update order_production_tasks
        set
          status = ${status},
          started_at = case when ${status} in ('preparing', 'ready') and started_at is null then now() else started_at end,
          ready_at = case when ${status} = 'ready' and ready_at is null then now() else ready_at end,
          completed_by = case when ${status} = 'ready' then ${session.id} else completed_by end,
          updated_at = now()
        where order_id::text = ${rows[0].id as string}
          and status <> 'ready'
      `;
    }
    await syncWebReservationToSalesOrder(rows[0].id as string);
    await publishCustomerOrderEvent("order.updated", await findCustomerOrderById(rows[0].id as string));
  }

  return Response.json({ ok: Boolean(rows[0]?.id) });
}
