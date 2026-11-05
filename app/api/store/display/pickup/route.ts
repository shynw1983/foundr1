import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { posPreparationItemSql } from "../../../../../lib/pos-item-fulfillment";
import { posOrderHasPreparationOrLegacySql, posPreparationTaskSql } from "../../../../../lib/pos-production-task-filter";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, params.get("storeId")) ?? access.stores[0]?.id ?? "";
  if (storeFilter === "__forbidden__" || !storeFilter) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const rows = await sql`
    select * from (
      select items.pickup_code as "pickupCode", tasks.status,
        coalesce((orders.customer_summary->'posFulfillmentTasks'->tasks.id::text->>'callVersion')::bigint,0)::float as "callVersion",
        coalesce(orders.customer_summary ->> 'orderType', '') as "orderType",
        to_char(orders.created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime",
        orders.created_at as "createdAt"
      from order_production_tasks tasks
      join store_customer_orders orders on orders.id = tasks.order_id
      join store_customer_order_items items on items.id = tasks.order_item_id
      where orders.store_id::text = ${storeFilter}
        and orders.payment_status in ('paid', 'partial_refunded')
        and orders.status in ('new', 'preparing', 'ready')
        and tasks.status in ('new', 'preparing', 'ready') and tasks.handed_off_at is null
        and items.refund_status <> 'refunded' and items.pickup_code <> ''
        and ${sql.unsafe(posPreparationItemSql('orders', 'items'))}
        and orders.created_at > now() - interval '1 day'
      union all
      select orders.pickup_code as "pickupCode", coalesce(grouped.status,orders.status) as status,
        coalesce((select sum(coalesce((orders.customer_summary->'posFulfillmentTasks'->all_groups.id::text->>'callVersion')::bigint,0))
          from order_production_tasks all_groups where all_groups.order_id=orders.id and all_groups.order_item_id is null),0)::float as "callVersion",
        coalesce(orders.customer_summary ->> 'orderType', '') as "orderType",
        to_char(orders.created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime",
        orders.created_at as "createdAt"
      from store_customer_orders orders
      left join lateral (
        select case when bool_and(tasks.status='ready') then 'ready'
            when bool_or(tasks.status in ('preparing','ready')) then 'preparing' else 'new' end as status
        from order_production_tasks tasks
        where tasks.order_id=orders.id and tasks.order_item_id is null and tasks.handed_off_at is null
          and ${sql.unsafe(posPreparationTaskSql('orders', 'tasks'))}
        having count(*)>0
      ) grouped on true
      where orders.store_id::text = ${storeFilter}
        and orders.payment_status in ('paid', 'partial_refunded')
        and orders.status in ('new', 'preparing', 'ready')
        and orders.created_at > now() - interval '1 day'
        and ${sql.unsafe(posOrderHasPreparationOrLegacySql('orders'))}
        and (not exists (select 1 from store_customer_order_items items where items.order_id=orders.id and items.pickup_code <> '' and ${sql.unsafe(posPreparationItemSql('orders', 'items'))})
          or grouped.status is not null)
    ) queue
    order by case status when 'ready' then 0 when 'preparing' then 1 else 2 end, "createdAt" asc, "pickupCode" asc
    limit 80
  `;

  return Response.json({
    access,
    selectedStoreId: storeFilter,
    preparing: rows.filter((row) => row.status !== "ready"),
    ready: rows.filter((row) => row.status === "ready")
  }, { headers: { "Cache-Control": "no-store" } });
}
