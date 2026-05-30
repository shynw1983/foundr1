import { sql } from "../../../../lib/db";

type MenuOption = {
  id: string;
  optionGroupId: string;
  externalId: string;
  optionKey: string;
  name: string;
  priceDelta: number | null;
  affectsProcedure: boolean;
  sortOrder: number;
};

type MenuOptionGroup = {
  id: string;
  menuCatalogItemId: string;
  externalId: string;
  groupKey: string;
  name: string;
  selectionType: string;
  affectsProcedure: boolean;
  ruleJson: Record<string, unknown>;
  sortOrder: number;
  options: MenuOption[];
};

function normalizeSearchValue(value: string | null) {
  return String(value ?? "").trim();
}

function publicUrl(value: unknown, requestUrl: string) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url.startsWith("/") ? url : `/${url}`, requestUrl).toString();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brandQuery = normalizeSearchValue(searchParams.get("brand"));
  const storeQuery = normalizeSearchValue(searchParams.get("store"));

  if (!brandQuery) {
    return Response.json({ error: "brand is required" }, { status: 400 });
  }

  const brands = await sql`
    select id::text, name
    from brands
    where status = 'active'
      and (id::text = ${brandQuery} or lower(name) = lower(${brandQuery}))
    limit 1
  `;

  const brand = brands[0];
  if (!brand) {
    return Response.json({ error: "brand not found" }, { status: 404 });
  }

  const stores = storeQuery
    ? await sql`
        select stores.id::text, stores.name
        from stores
        join store_brands on store_brands.store_id = stores.id
        where stores.status = 'active'
          and store_brands.brand_id = ${brand.id}
          and (stores.id::text = ${storeQuery} or lower(stores.name) = lower(${storeQuery}))
        limit 1
      `
    : [];
  const store = stores[0] ?? null;

  if (storeQuery && !store) {
    return Response.json({ error: "store not found for brand" }, { status: 404 });
  }

  const items = await sql`
    select
      menu_catalog_items.id::text,
      coalesce(menu_catalog_items.store_id::text, '') as "storeId",
      coalesce(menu_catalog_items.external_id, '') as "externalId",
      menu_catalog_items.item_kind as "itemKind",
      menu_catalog_items.name,
      coalesce(menu_catalog_items.category, '') as category,
      coalesce(menu_catalog_items.description, '') as description,
      coalesce(menu_catalog_items.image_url, '') as "imageUrl",
      menu_catalog_items.base_price::float as "basePrice",
      menu_catalog_items.variable_schema as "variableSchema",
      menu_catalog_items.updated_at as "updatedAt"
    from menu_catalog_items
    where menu_catalog_items.brand_id = ${brand.id}
      and menu_catalog_items.is_active = true
      and (
        menu_catalog_items.store_id is null
        or (${store?.id ?? null}::uuid is not null and menu_catalog_items.store_id = ${store?.id ?? null})
      )
    order by coalesce(menu_catalog_items.category, ''), menu_catalog_items.name
  `;

  const itemIds = new Set(items.map((item) => item.id));
  const groups = (await sql`
    select
      id::text,
      coalesce(menu_catalog_item_id::text, '') as "menuCatalogItemId",
      coalesce(external_id, '') as "externalId",
      group_key as "groupKey",
      name,
      selection_type as "selectionType",
      affects_procedure as "affectsProcedure",
      rule_json as "ruleJson",
      sort_order as "sortOrder"
    from menu_option_groups
    where brand_id = ${brand.id}
      and is_active = true
    order by sort_order, name
  `).filter((group) => !group.menuCatalogItemId || itemIds.has(String(group.menuCatalogItemId)));

  const options = await sql`
    select
      menu_options.id::text,
      menu_options.option_group_id::text as "optionGroupId",
      coalesce(menu_options.external_id, '') as "externalId",
      menu_options.option_key as "optionKey",
      menu_options.name,
      menu_options.price_delta::float as "priceDelta",
      menu_options.affects_procedure as "affectsProcedure",
      menu_options.sort_order as "sortOrder"
    from menu_options
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    where menu_options.is_active = true
      and menu_option_groups.is_active = true
      and menu_option_groups.brand_id = ${brand.id}
    order by menu_options.sort_order, menu_options.name
  `;

  const optionsByGroup = new Map<string, MenuOption[]>();
  for (const option of options as MenuOption[]) {
    const groupOptions = optionsByGroup.get(option.optionGroupId) ?? [];
    groupOptions.push(option);
    optionsByGroup.set(option.optionGroupId, groupOptions);
  }

  const globalGroups: MenuOptionGroup[] = [];
  const groupsByItem = new Map<string, MenuOptionGroup[]>();
  for (const group of groups as MenuOptionGroup[]) {
    const hydratedGroup = {
      ...group,
      options: optionsByGroup.get(group.id) ?? []
    };

    if (!group.menuCatalogItemId) {
      globalGroups.push(hydratedGroup);
    } else {
      const itemGroups = groupsByItem.get(group.menuCatalogItemId) ?? [];
      itemGroups.push(hydratedGroup);
      groupsByItem.set(group.menuCatalogItemId, itemGroups);
    }
  }

  return Response.json({
    brand,
    store,
    items: items.map((item) => ({
      ...item,
      imageUrl: publicUrl(item.imageUrl, request.url),
      optionGroups: [...globalGroups, ...(groupsByItem.get(item.id) ?? [])]
    })),
    generatedAt: new Date().toISOString()
  });
}
