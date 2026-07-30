import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { refreshActiveProductionTasksForStore } from "../../../../../lib/order-production";
import { scheduledOrderReminderLeadMinutes } from "../../../../../lib/store-order-alert-timing";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

const deliverySources = ["uber_eats", "demae_can", "rocket_now"];
const webReservationSources = ["maamaa_web", "nanacha_web"];
const pickupSources = [...deliverySources, ...webReservationSources];

function getBrandDisplayIdentity(brandName: string) {
  const normalizedName = brandName.trim().toLowerCase();
  if (normalizedName === "まぁ麻" || normalizedName === "maamaa") {
    return {
      logoUrl: "/brands/maamaa-slogan-landscape.png",
      themeColor: "#c30e23"
    };
  }
  if (normalizedName === "nanacha") {
    return {
      logoUrl: "/brands/nanacha-logo.png",
      themeColor: "#231916"
    };
  }
  return {
    logoUrl: "",
    themeColor: ""
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, params.get("storeId")) ?? access.stores[0]?.id ?? "";
  if (storeFilter === "__forbidden__" || !storeFilter) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  await refreshActiveProductionTasksForStore(storeFilter, 100);

  const [rows, storeBrandRows] = await Promise.all([
    sql`
      select
        store_customer_orders.id::text,
        store_customer_orders.pickup_code as "pickupCode",
        store_customer_orders.order_source as "orderSource",
        coalesce(production.status, 'new') as status,
        coalesce(store_customer_orders.estimated_prep_minutes, 0)::int as "estimatedPrepMinutes",
        coalesce(store_customer_orders.estimated_ready_at::text, '') as "estimatedReadyAt",
        to_char(store_customer_orders.created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime"
      from store_customer_orders
      left join lateral (
        select
          case
            when count(*) = 0 then 'new'
            when bool_and(order_production_tasks.status = 'ready') then 'ready'
            when bool_or(order_production_tasks.status in ('preparing', 'ready')) then 'preparing'
            else 'new'
          end as status
        from order_production_tasks
        where order_production_tasks.order_id = store_customer_orders.id
      ) production on true
      where store_customer_orders.store_id::text = ${storeFilter}
        and store_customer_orders.payment_status = 'paid'
        and store_customer_orders.order_source = any(${pickupSources})
        and store_customer_orders.status not in ('completed', 'cancelled', 'refund_pending')
        and (
          (
            store_customer_orders.order_source = any(${deliverySources})
            and store_customer_orders.created_at > now() - interval '1 day'
          )
          or (
            store_customer_orders.order_source = any(${webReservationSources})
            and store_customer_orders.pickup_date >= (now() at time zone 'Asia/Tokyo')::date - 1
          )
        )
        and (
          not (store_customer_orders.order_source = any(${webReservationSources}))
          or (
            (
              (store_customer_orders.pickup_date::text || ' ' || store_customer_orders.pickup_time)::timestamp
              at time zone 'Asia/Tokyo'
            ) <= now() + (${scheduledOrderReminderLeadMinutes} * interval '1 minute')
          )
          or exists (
            select 1
            from order_production_tasks active_production
            where active_production.order_id = store_customer_orders.id
              and active_production.status in ('preparing', 'ready')
          )
        )
      order by
        case coalesce(production.status, 'new') when 'ready' then 0 when 'preparing' then 1 else 2 end,
        store_customer_orders.created_at asc
      limit 100
    `,
    sql`
      select brands.name
      from store_brands
      join brands on brands.id = store_brands.brand_id
      where store_brands.store_id::text = ${storeFilter}
        and brands.status = 'active'
      order by brands.name
    `
  ]);

  const brandLogos = storeBrandRows
    .map((brand) => {
      const name = String(brand.name || "");
      return {
        name,
        ...getBrandDisplayIdentity(name)
      };
    })
    .filter((brand) => brand.logoUrl);

  return Response.json({
    access,
    selectedStoreId: storeFilter,
    brandLogos,
    serverNow: new Date().toISOString(),
    orders: rows
  }, { headers: { "Cache-Control": "no-store" } });
}
