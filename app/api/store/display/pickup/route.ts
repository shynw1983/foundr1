import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
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
    select
      pickup_code as "pickupCode",
      status,
      coalesce(customer_summary ->> 'orderType', '') as "orderType",
      to_char(created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime"
    from store_customer_orders
    where store_id::text = ${storeFilter}
      and payment_status = 'paid'
      and status in ('new', 'preparing', 'ready')
      and created_at > now() - interval '1 day'
    order by
      case status when 'ready' then 0 when 'preparing' then 1 else 2 end,
      created_at asc
    limit 80
  `;

  return Response.json({
    access,
    selectedStoreId: storeFilter,
    preparing: rows.filter((row) => row.status !== "ready"),
    ready: rows.filter((row) => row.status === "ready")
  }, { headers: { "Cache-Control": "no-store" } });
}
