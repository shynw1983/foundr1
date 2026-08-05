import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

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
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      store_customer_orders.order_source as "orderSource",
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.drink,
      store_customer_orders.pickup_date::text as "pickupDate",
      store_customer_orders.pickup_time as "pickupTime",
      coalesce(store_customer_orders.customer_summary ->> 'pickupTiming', '') as "pickupTiming",
      coalesce(store_customer_orders.paid_at::text, '') as "paidAt",
      case
        when store_customer_orders.order_source <> 'maamaa_web'
          or coalesce(store_customer_orders.customer_summary ->> 'pickupTiming', '') <> 'scheduled' then 'immediate'
        when store_customer_orders.paid_at > now() - interval '2 minutes' then 'scheduled_initial'
        when ((store_customer_orders.pickup_date::text || ' ' || store_customer_orders.pickup_time)::timestamp at time zone 'Asia/Tokyo') <= now() + interval '20 minutes' then 'scheduled_reminder'
        else 'scheduled_waiting'
      end as "alertPhase",
      coalesce(store_customer_orders.customer_summary ->> 'initialAlertAcknowledgedAt', '') as "initialAlertAcknowledgedAt",
      coalesce(store_customer_orders.customer_summary ->> 'reminderAlertAcknowledgedAt', '') as "reminderAlertAcknowledgedAt"
    from store_customer_orders
    where (${access.allStores} or store_customer_orders.store_id::text = any(${access.storeIds}))
      and (${storeFilter ?? null}::text is null or store_customer_orders.store_id::text = ${storeFilter ?? null})
      and store_customer_orders.payment_status = 'paid'
      and store_customer_orders.status = 'new'
      and store_customer_orders.order_source <> 'store_pos'
      and (
        store_customer_orders.created_at > now() - interval '2 days'
        or store_customer_orders.pickup_date >= (now() at time zone 'Asia/Tokyo')::date - 1
      )
    order by store_customer_orders.created_at desc
    limit 100
  `;

  return Response.json({
    orders,
    stores: access.stores.map((store) => ({ id: store.id, businessHours: store.businessHours }))
  }, { headers: { "Cache-Control": "private, no-store" } });
}
