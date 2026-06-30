import { sql } from "../../../../../lib/db";
import { publicMenuCacheHeaders } from "../../../../../lib/public-cache";

export const dynamic = "force-dynamic";

function normalizeToken(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: Request) {
  const token = normalizeToken(new URL(request.url).searchParams.get("token"));
  if (!token) return Response.json({ error: "token is required" }, { status: 400 });

  const rows = await sql`
    select
      store_tables.id::text as "tableId",
      store_tables.label as "tableLabel",
      coalesce(nullif(store_tables.display_name, ''), store_tables.label) as "tableDisplayName",
      store_tables.area_name as "areaName",
      store_tables.table_ordering_enabled as "tableOrderingEnabled",
      store_tables.checkout_exit_policy as "checkoutExitPolicy",
      stores.id::text as "storeId",
      stores.name as "storeName",
      coalesce(brands.id::text, '') as "brandId",
      coalesce(brands.name, '') as "brandName",
      coalesce(pos_store_settings.dine_in_enabled, true) as "dineInEnabled"
    from store_tables
    join stores on stores.id = store_tables.store_id
    left join brands on brands.id = store_tables.brand_id
    left join pos_store_settings on pos_store_settings.store_id = stores.id
    where store_tables.qr_token = ${token}
      and store_tables.status = 'active'
      and stores.status = 'active'
      and (brands.id is null or brands.status = 'active')
    limit 1
  `;

  const table = rows[0];
  if (!table) return Response.json({ error: "table not found" }, { status: 404, headers: publicMenuCacheHeaders(true) });

  return Response.json({
    table,
    orderingEnabled: table.tableOrderingEnabled === true && table.dineInEnabled === true
  }, {
    headers: publicMenuCacheHeaders(true)
  });
}
