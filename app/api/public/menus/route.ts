import { sql } from "../../../../lib/db";
import { resolveCustomerStoreDisplayName } from "../../../../lib/customer-display-names";
import { mergeDuplicateToppingGroups } from "../../../../lib/menu-customization-groups";
import { publicMenuCacheHeaders } from "../../../../lib/public-cache";
import { applyStaffPresenceGateToPublicOperation, type StoreOperationForPublicMenu } from "../../../../lib/store-staff-presence";
import { getStoreReservationWindowsForCurrentBusinessDay, getStoreReservationWindowsForDate } from "../../../../lib/store-reservation-windows";

type MenuOption = {
  id: string;
  optionGroupId: string;
  applicableCategories: string[];
  externalId: string;
  optionKey: string;
  name: string;
  displayNames?: Record<string, string>;
  imageUrl: string;
  priceDelta: number | null;
  affectsProcedure: boolean;
  sortOrder: number;
};

type MenuOptionGroup = {
  id: string;
  menuCatalogItemId: string;
  applicableCategories: string[];
  externalId: string;
  groupKey: string;
  name: string;
  displayNames?: Record<string, string>;
  selectionType: string;
  affectsProcedure: boolean;
  ruleJson: Record<string, unknown>;
  sortOrder: number;
  options: MenuOption[];
};

type MenuItemOptionGroup = {
  menuCatalogItemId: string;
  optionGroupId: string;
  sortOrder: number;
};

function normalizeSearchValue(value: string | null) {
  return String(value ?? "").trim();
}

function brandAliases(value: string) {
  const normalized = value.toLowerCase();
  return Array.from(new Set([
    value,
    normalized === "maamaa" ? "まぁ麻" : "",
    normalized === "maaamaa" ? "まぁ麻" : "",
    normalized === "maama" ? "まぁ麻" : "",
    normalized === "nanacha" ? "nanacha" : "",
    normalized === "nanacha" ? "奈奈茶" : "",
  ].map((entry) => entry.trim()).filter(Boolean)));
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

  const aliases = brandAliases(brandQuery);
  const lowerAliases = aliases.map((alias) => alias.toLowerCase());
  const brands = await sql`
    select id::text, name
    from brands
    where status = 'active'
      and (id::text = ${brandQuery} or lower(name) = any(${lowerAliases}))
    order by
      case
        when id::text = ${brandQuery} then 0
        when lower(name) = lower(${brandQuery}) then 1
        else 2
      end
    limit 1
  `;

  const brand = brands[0];
  if (!brand) {
    return Response.json({ error: "brand not found" }, { status: 404 });
  }

  const stores = storeQuery
    ? await sql`
        select
          stores.id::text,
          stores.name,
          coalesce(stores.external_id, '') as "externalId",
          coalesce(stores.customer_display_names, '{}'::jsonb) as "customerDisplayNames"
        from stores
        join store_brands on store_brands.store_id = stores.id
        where stores.status = 'active'
          and store_brands.brand_id = ${brand.id}
          and (
            stores.id::text = ${storeQuery}
            or lower(stores.name) = lower(${storeQuery})
            or lower(coalesce(stores.external_id, '')) = lower(${storeQuery})
          )
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
      coalesce(menu_catalog_items.promotion_prefix, '') as "promotionPrefix",
      coalesce(menu_catalog_items.promotion_prefix_display_names, '{}'::jsonb) as "promotionPrefixDisplayNames",
      menu_catalog_items.name,
      coalesce(menu_catalog_items.display_names, '{}'::jsonb) as "displayNames",
      coalesce(menu_catalog_items.category, '') as category,
      coalesce(menu_catalog_items.description, '') as description,
      coalesce(menu_catalog_items.description_display_names, '{}'::jsonb) as "descriptionDisplayNames",
      coalesce(menu_catalog_items.image_url, '') as "imageUrl",
      menu_catalog_items.base_price::float as "basePrice",
      menu_catalog_items.variable_schema as "variableSchema",
      menu_catalog_items.sort_order as "sortOrder",
      menu_catalog_items.updated_at as "updatedAt"
    from menu_catalog_items
    left join menu_categories
      on menu_categories.brand_id = menu_catalog_items.brand_id
      and coalesce(menu_categories.store_id::text, '') = coalesce(menu_catalog_items.store_id::text, '')
      and menu_categories.name = coalesce(nullif(menu_catalog_items.category, ''), '未分類')
    where menu_catalog_items.brand_id = ${brand.id}
      and menu_catalog_items.is_active = true
      and (
        menu_catalog_items.store_id is null
        or (${store?.id ?? null}::uuid is not null and menu_catalog_items.store_id = ${store?.id ?? null})
      )
    order by coalesce(menu_categories.sort_order, 9999), menu_catalog_items.sort_order, menu_catalog_items.name
  `;

  const categories = await sql`
    select
      id::text,
      coalesce(external_id, '') as "externalId",
      name,
      coalesce(note, '') as note,
      is_tapioca_free as "isTapiocaFree",
      has_whip_by_default as "hasWhipByDefault",
      sort_order as "sortOrder"
    from menu_categories
    where brand_id = ${brand.id}
      and (
        store_id is null
        or (${store?.id ?? null}::uuid is not null and store_id = ${store?.id ?? null})
      )
    order by sort_order, name
  `;

  const itemIds = new Set(items.map((item) => item.id));
  const storeSettings = store
    ? await sql`
        select
          menu_catalog_item_id::text as "menuCatalogItemId",
          website_enabled as "websiteEnabled",
          pos_enabled as "posEnabled",
          coalesce(table_order_enabled, true) as "tableOrderEnabled",
          delivery_enabled as "deliveryEnabled",
          is_available as "isAvailable",
          price_override::float as "priceOverride",
          status_note as "statusNote"
        from menu_store_settings
        where brand_id = ${brand.id}
          and store_id = ${store.id}
      `
    : [];
  const settingsByItemId = new Map(storeSettings.map((setting) => [String(setting.menuCatalogItemId), setting]));
  const itemOptionGroups = await sql`
    select
      menu_catalog_item_id::text as "menuCatalogItemId",
      option_group_id::text as "optionGroupId",
      sort_order as "sortOrder"
    from menu_catalog_item_option_groups
    where is_active = true
      and menu_catalog_item_id = any(${Array.from(itemIds)}::uuid[])
    order by menu_catalog_item_id, sort_order, option_group_id
  `;
  const itemOptionGroupsByItemId = new Map<string, MenuItemOptionGroup[]>();
  for (const link of itemOptionGroups as MenuItemOptionGroup[]) {
    const links = itemOptionGroupsByItemId.get(link.menuCatalogItemId) ?? [];
    links.push(link);
    itemOptionGroupsByItemId.set(link.menuCatalogItemId, links);
  }
  const groups = (await sql`
    select
      id::text,
      coalesce(menu_catalog_item_id::text, '') as "menuCatalogItemId",
      coalesce(applicable_categories, '{}') as "applicableCategories",
      coalesce(external_id, '') as "externalId",
      group_key as "groupKey",
      name,
      coalesce(display_names, '{}'::jsonb) as "displayNames",
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
      coalesce(menu_options.applicable_categories, '{}') as "applicableCategories",
      coalesce(menu_options.external_id, '') as "externalId",
      menu_options.option_key as "optionKey",
      menu_options.name,
      coalesce(menu_options.display_names, '{}'::jsonb) as "displayNames",
      coalesce(menu_options.image_url, '') as "imageUrl",
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
  const optionSettings = store
    ? await sql`
        select
          menu_option_id::text as "menuOptionId",
          is_available as "isAvailable",
          status_note as "statusNote"
        from menu_option_store_settings
        where brand_id = ${brand.id}
          and store_id = ${store.id}
      `
    : [];
  const unavailableOptionIds = new Set(
    optionSettings
      .filter((setting) => setting.isAvailable === false)
      .map((setting) => String(setting.menuOptionId))
  );
  const operationRows = store
    ? await sql`
        select
          stores.business_hours as "businessHours",
          coalesce(stores.reservation_note, '') as "reservationNote",
          case
            when store_operations.minimum_pickup_reset_at is not null and store_operations.minimum_pickup_reset_at <= now() then null
            else store_operations.minimum_pickup_minutes
          end as "minimumPickupMinutes",
          case
            when store_operations.temporary_status_until is not null and store_operations.temporary_status_until <= now() then true
            when store_operations.reservation_acceptance_mode = 'force_open' then true
            when store_operations.reservation_acceptance_mode = 'force_closed' then false
            else coalesce(store_operations.reservations_enabled, true)
          end as "reservationsEnabled",
          case
            when store_operations.temporary_status_until is not null and store_operations.temporary_status_until <= now() then ''
            else coalesce(store_operations.status_note, '')
          end as "statusNote",
          store_operations.temporary_status_until as "temporaryStatusUntil",
          case
            when store_operations.temporary_status_until is not null and store_operations.temporary_status_until <= now() then 'auto'
            else coalesce(store_operations.reservation_acceptance_mode, 'auto')
          end as "acceptanceMode",
          store_operations.acceptance_mode_changed_at as "acceptanceModeChangedAt"
        from stores
        left join store_operations on store_operations.store_id = stores.id
        where stores.id = ${store.id}
        limit 1
      `
    : [];

  const optionsByGroup = new Map<string, MenuOption[]>();
  for (const option of (options as MenuOption[]).filter((entry) => !unavailableOptionIds.has(entry.id))) {
    const groupOptions = optionsByGroup.get(option.optionGroupId) ?? [];
    groupOptions.push({
      ...option,
      imageUrl: publicUrl(option.imageUrl, request.url)
    });
    optionsByGroup.set(option.optionGroupId, groupOptions);
  }

  const allGroups: MenuOptionGroup[] = [];
  for (const group of groups as MenuOptionGroup[]) {
    const hydratedGroup = {
      ...group,
      options: optionsByGroup.get(group.id) ?? []
    };
    allGroups.push(hydratedGroup);
  }

  const storeOperation = await applyStaffPresenceGateToPublicOperation(
    store?.id,
    (operationRows[0] as StoreOperationForPublicMenu | undefined) ?? {
      reservationsEnabled: true,
      statusNote: "",
      businessHours: {},
      reservationNote: "",
      minimumPickupMinutes: null
    }
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const isMaamaa = /maamaa|まぁ麻/i.test(String(brand.name ?? ""));
  const reservationWindows = store?.id
    ? isMaamaa
      ? await getStoreReservationWindowsForCurrentBusinessDay({
          storeId: store.id,
          businessHours: storeOperation.businessHours,
          ignoreStaffSchedule: storeOperation.acceptanceMode === "force_open"
        })
      : await getStoreReservationWindowsForDate({ storeId: store.id, pickupDate: today })
    : [];
  const publicStores = store
    ? [{
        id: store.externalId || store.name,
        label: resolveCustomerStoreDisplayName({
          settings: store.customerDisplayNames,
          internalStoreName: store.name,
          brandName: brand.name,
          platform: "web_reservation"
        }),
        name: store.name,
        osStoreId: store.id
      }]
    : [];

  return Response.json({
    brand,
    store,
    stores: publicStores,
    selectedStoreId: publicStores[0]?.id ?? "",
    storeOperation: {
      ...storeOperation,
      reservationWindows
    },
    categories,
    optionGroups: allGroups,
    items: items.map((item) => {
      const setting = settingsByItemId.get(item.id);
      const explicitLinks = itemOptionGroupsByItemId.get(String(item.id)) ?? [];
      const explicitOrder = new Map(explicitLinks.map((link) => [link.optionGroupId, link.sortOrder]));
      const customizationGroups = (explicitLinks.length
        ? allGroups.filter((group) => explicitOrder.has(group.id))
        : allGroups.filter((group) => (
            (!group.menuCatalogItemId || group.menuCatalogItemId === item.id)
            && (group.menuCatalogItemId || !group.applicableCategories.length || group.applicableCategories.includes(String(item.category || "未分類")))
          )))
        .sort((left, right) => (
          (explicitOrder.get(left.id) ?? left.sortOrder) - (explicitOrder.get(right.id) ?? right.sortOrder)
          || left.sortOrder - right.sortOrder
          || left.name.localeCompare(right.name, "ja")
        ))
        .map((group) => ({
          ...group,
          options: group.options.filter((option) => (
            !option.applicableCategories.length || option.applicableCategories.includes(String(item.category || "未分類"))
          ))
        }));
      const customerCustomizationGroups = mergeDuplicateToppingGroups(customizationGroups);
      const legacyOptionGroups = allGroups.filter((group) => (
        group.ruleJson?.source !== "uber_eats"
        && (!group.menuCatalogItemId || group.menuCatalogItemId === item.id)
        && (group.menuCatalogItemId || !group.applicableCategories.length || group.applicableCategories.includes(String(item.category || "未分類")))
      ));
      return {
        ...item,
        basePrice: setting?.priceOverride ?? item.basePrice,
        imageUrl: publicUrl(item.imageUrl, request.url),
        storeSetting: setting ? {
          websiteEnabled: setting.websiteEnabled,
          posEnabled: setting.posEnabled,
          tableOrderEnabled: setting.tableOrderEnabled,
          deliveryEnabled: setting.deliveryEnabled,
          isAvailable: setting.isAvailable,
          statusNote: setting.statusNote
        } : {
          websiteEnabled: true,
          posEnabled: true,
          tableOrderEnabled: true,
          deliveryEnabled: false,
          isAvailable: true,
          statusNote: ""
        },
        usesStructuredCustomizations: explicitLinks.length > 0,
        customizationGroups: customerCustomizationGroups,
        // Temporary compatibility for the current nanacha reservation UI.
        // New customer UIs must render customizationGroups.
        optionGroups: (explicitLinks.length ? legacyOptionGroups : customizationGroups)
          .map((group) => ({
            ...group,
            options: group.options.filter((option) => (
              !option.applicableCategories.length || option.applicableCategories.includes(String(item.category || "未分類"))
            ))
          }))
      };
    }),
    generatedAt: new Date().toISOString()
  }, {
    headers: publicMenuCacheHeaders(Boolean(store))
  });
}
