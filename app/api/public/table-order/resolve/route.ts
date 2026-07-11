import { sql } from "../../../../../lib/db";
import { publicMenuCacheHeaders } from "../../../../../lib/public-cache";
import { resolveCustomerStoreDisplayName } from "../../../../../lib/customer-display-names";

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
      store_tables.qr_token as "tableToken",
      store_tables.label as "tableLabel",
      coalesce(nullif(store_tables.display_name, ''), store_tables.label) as "tableDisplayName",
      store_tables.area_name as "areaName",
      store_tables.table_ordering_enabled as "tableOrderingEnabled",
      store_tables.checkout_exit_policy as "checkoutExitPolicy",
      stores.id::text as "storeId",
      stores.name as "storeName",
      coalesce(stores.customer_display_names, '{}'::jsonb) as "customerDisplayNames",
      coalesce(active_brands.brands, '[]'::jsonb) as brands,
      coalesce(brands.id::text, fallback_brands.id::text, '') as "brandId",
      coalesce(brands.name, fallback_brands.name, '') as "brandName",
      coalesce(pos_store_settings.dine_in_enabled, true) as "dineInEnabled"
      ,coalesce(active_dining_session.id::text, '') as "diningSessionId"
      ,coalesce(active_dining_session.table_group_label, '') as "diningSeatLabel"
      ,coalesce(active_dining_session.dine_in_entitled, false) as "dineInEntitled"
    from store_tables
    join stores on stores.id = store_tables.store_id
    left join brands on brands.id = store_tables.brand_id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object('id', active_brand_rows.id::text, 'name', active_brand_rows.name)
        order by active_brand_rows.name
      ) as brands
      from store_brands
      join brands active_brand_rows on active_brand_rows.id = store_brands.brand_id
      where store_brands.store_id = stores.id
        and active_brand_rows.status = 'active'
    ) active_brands on true
    left join lateral (
      select brand_candidates.id, brand_candidates.name
      from (
        select brands.id, brands.name, count(*) over() as brand_count
        from store_brands
        join brands on brands.id = store_brands.brand_id
        where store_brands.store_id = stores.id
          and brands.status = 'active'
      ) brand_candidates
      where brand_candidates.brand_count = 1
      limit 1
    ) fallback_brands on true
    left join pos_store_settings on pos_store_settings.store_id = stores.id
    left join lateral (
      select store_dining_sessions.id, store_dining_sessions.table_group_label, store_dining_sessions.dine_in_entitled
      from store_dining_session_tables
      join store_dining_sessions on store_dining_sessions.id = store_dining_session_tables.session_id
      where store_dining_session_tables.table_id = store_tables.id
        and store_dining_session_tables.released_at is null
        and store_dining_sessions.status in ('seated', 'dining')
      order by store_dining_sessions.assigned_at desc
      limit 1
    ) active_dining_session on true
    where store_tables.qr_token = ${token}
      and store_tables.status = 'active'
      and stores.status = 'active'
      and (brands.id is null or brands.status = 'active')
    limit 1
  `;

  const table = rows[0];
  if (!table) return Response.json({ error: "table not found" }, { status: 404, headers: publicMenuCacheHeaders(true) });
  const customerStoreName = resolveCustomerStoreDisplayName({
    settings: table.customerDisplayNames,
    internalStoreName: String(table.storeName || ""),
    brandName: String(table.brandName || ""),
    platform: "table_order"
  });

  return Response.json({
    table: {
      ...table,
      customerStoreName,
      customerDisplayName: customerStoreName,
      customerDisplayNames: undefined
    },
    orderingEnabled: table.tableOrderingEnabled === true && table.dineInEnabled === true && Boolean(table.diningSessionId),
    unavailableReason: table.diningSessionId ? "" : "現在この席では注文できません。スタッフにお声がけください。"
  }, {
    headers: publicMenuCacheHeaders(true)
  });
}
