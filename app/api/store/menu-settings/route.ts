import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type MenuStoreItem = {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  category: string;
  imageUrl: string;
  basePrice: number | null;
  websiteEnabled: boolean;
  posEnabled: boolean;
  deliveryEnabled: boolean;
  isAvailable: boolean;
  priceOverride: number | null;
  statusNote: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const selectedStoreId = storeFilter ?? access.stores[0]?.id ?? "";
  if (!selectedStoreId) {
    return Response.json({ access, selectedStoreId: "", brands: [], items: [] });
  }

  const [brands, items] = await Promise.all([
    sql`
      select brands.id::text, brands.name
      from brands
      join store_brands on store_brands.brand_id = brands.id
      where store_brands.store_id = ${selectedStoreId}
        and brands.status = 'active'
      order by brands.name
    `,
    sql`
      select
        menu_catalog_items.id::text,
        menu_catalog_items.brand_id::text as "brandId",
        brands.name as "brandName",
        menu_catalog_items.name,
        coalesce(menu_catalog_items.category, '') as category,
        coalesce(menu_catalog_items.image_url, '') as "imageUrl",
        menu_catalog_items.base_price::float as "basePrice",
        coalesce(menu_store_settings.website_enabled, true) as "websiteEnabled",
        coalesce(menu_store_settings.pos_enabled, true) as "posEnabled",
        coalesce(menu_store_settings.delivery_enabled, false) as "deliveryEnabled",
        coalesce(menu_store_settings.is_available, true) as "isAvailable",
        menu_store_settings.price_override::float as "priceOverride",
        coalesce(menu_store_settings.status_note, '') as "statusNote"
      from menu_catalog_items
      join brands on brands.id = menu_catalog_items.brand_id
      join store_brands
        on store_brands.brand_id = menu_catalog_items.brand_id
        and store_brands.store_id = ${selectedStoreId}
      left join menu_store_settings
        on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
        and menu_store_settings.store_id = ${selectedStoreId}
      left join menu_categories
        on menu_categories.brand_id = menu_catalog_items.brand_id
        and menu_categories.store_id is null
        and menu_categories.name = coalesce(nullif(menu_catalog_items.category, ''), '未分類')
      where menu_catalog_items.is_active = true
        and menu_catalog_items.store_id is null
      order by brands.name, coalesce(menu_categories.sort_order, 9999), menu_catalog_items.sort_order, menu_catalog_items.name
    `
  ]);

  return Response.json({
    access,
    selectedStoreId,
    brands,
    items: items as MenuStoreItem[]
  });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const storeId = normalizeText(body.storeId);
  const itemId = normalizeText(body.menuCatalogItemId);
  if (!storeId || !itemId) {
    return Response.json({ error: "店舗と商品を選択してください。" }, { status: 400 });
  }

  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId);
  if (storeFilter === "__forbidden__" || !storeFilter) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const items = await sql`
    select menu_catalog_items.id::text, menu_catalog_items.brand_id::text as "brandId"
    from menu_catalog_items
    join store_brands
      on store_brands.brand_id = menu_catalog_items.brand_id
      and store_brands.store_id = ${storeId}
    where menu_catalog_items.id = ${itemId}
      and menu_catalog_items.is_active = true
    limit 1
  `;
  const item = items[0] as { id: string; brandId: string } | undefined;
  if (!item) return Response.json({ error: "商品が見つかりません。" }, { status: 404 });

  const rows = await sql`
    insert into menu_store_settings (
      brand_id,
      store_id,
      menu_catalog_item_id,
      is_available,
      status_note,
      updated_by,
      updated_at
    )
    values (
      ${item.brandId},
      ${storeId},
      ${itemId},
      ${body.isAvailable !== false},
      ${normalizeText(body.statusNote)},
      ${session.id},
      now()
    )
    on conflict (store_id, menu_catalog_item_id)
    do update set
      is_available = excluded.is_available,
      status_note = excluded.status_note,
      updated_by = excluded.updated_by,
      updated_at = now()
    returning
      id::text,
      menu_catalog_item_id::text as "menuCatalogItemId",
      is_available as "isAvailable",
      status_note as "statusNote"
  `;

  return Response.json({ ok: true, setting: rows[0] });
}
