import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

export const dynamic = "force-dynamic";

function clampDays(value: string | null) {
  const days = Number(value);
  if (!Number.isFinite(days)) return 1;
  return Math.min(Math.max(Math.floor(days), 1), 31);
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const days = clampDays(params.get("days"));
  const scope = await getSessionStoreScope(session);

  const [summaryRows, statusRows, productRows, storeRows] = await Promise.all([
    sql`
      select
        count(*) filter (where payment_status = 'paid')::int as "paidOrders",
        count(*) filter (where status = 'completed')::int as "completedOrders",
        count(*) filter (where status = 'cancelled')::int as "cancelledOrders",
        count(*) filter (where status in ('new', 'preparing', 'ready'))::int as "activeOrders",
        coalesce(sum(amount) filter (where payment_status = 'paid'), 0)::int as "grossSales",
        coalesce(round(avg(extract(epoch from (completed_at - paid_at)) / 60) filter (where completed_at is not null and paid_at is not null))::int, 0) as "averageCompletionMinutes"
      from store_customer_orders
      where (${scope.allStores} or store_id::text = any(${scope.storeIds}))
        and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date >= ((now() at time zone 'Asia/Tokyo')::date - (${days}::int - 1))
    `,
    sql`
      select status, count(*)::int as count
      from store_customer_orders
      where (${scope.allStores} or store_id::text = any(${scope.storeIds}))
        and (coalesce(paid_at, created_at) at time zone 'Asia/Tokyo')::date >= ((now() at time zone 'Asia/Tokyo')::date - (${days}::int - 1))
      group by status
      order by count desc
    `,
    sql`
      select
        store_customer_order_items.item_name as name,
        count(*)::int as count,
        coalesce(sum(store_customer_order_items.amount), 0)::int as sales
      from store_customer_order_items
      join store_customer_orders on store_customer_orders.id = store_customer_order_items.order_id
      where (${scope.allStores} or store_customer_orders.store_id::text = any(${scope.storeIds}))
        and store_customer_orders.payment_status = 'paid'
        and (coalesce(store_customer_orders.paid_at, store_customer_orders.created_at) at time zone 'Asia/Tokyo')::date >= ((now() at time zone 'Asia/Tokyo')::date - (${days}::int - 1))
      group by store_customer_order_items.item_name
      order by count desc, sales desc, name
      limit 8
    `,
    sql`
      select
        coalesce(stores.name, '店舗未設定') as name,
        count(*) filter (where store_customer_orders.payment_status = 'paid')::int as "paidOrders",
        coalesce(sum(store_customer_orders.amount) filter (where store_customer_orders.payment_status = 'paid'), 0)::int as sales
      from store_customer_orders
      left join stores on stores.id = store_customer_orders.store_id
      where (${scope.allStores} or store_customer_orders.store_id::text = any(${scope.storeIds}))
        and (coalesce(store_customer_orders.paid_at, store_customer_orders.created_at) at time zone 'Asia/Tokyo')::date >= ((now() at time zone 'Asia/Tokyo')::date - (${days}::int - 1))
      group by stores.name
      order by sales desc, "paidOrders" desc, name
    `
  ]);

  return Response.json({
    days,
    summary: summaryRows[0] ?? {
      paidOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      activeOrders: 0,
      grossSales: 0,
      averageCompletionMinutes: 0
    },
    statusBreakdown: statusRows,
    productRanking: productRows,
    storeBreakdown: storeRows
  }, { headers: { "Cache-Control": "no-store" } });
}
