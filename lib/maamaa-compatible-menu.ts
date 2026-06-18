import { sql } from "./db";
import { resolveCustomerStoreDisplayName } from "./customer-display-names";
import { applyStaffPresenceGateToPublicOperation, type StoreOperationForPublicMenu } from "./store-staff-presence";
import { getStoreReservationWindowsForDate, type ReservationWindow } from "./store-reservation-windows";

export type MaamaaPricedOption = {
  id: string;
  name: string;
  displayNames?: Record<string, string>;
  price: number;
};

export type MaamaaMenuSection = {
  id: string;
  title: string;
  displayNames?: Record<string, string>;
  limit: number;
  items: MaamaaPricedOption[];
};

export type MaamaaCompatibleMenu = {
  baseSoup: {
    id: string;
    menuCatalogItemId: string;
    name: string;
    displayNames?: Record<string, string>;
    price: number;
    note: string;
    noteDisplayNames?: Record<string, string>;
    isAvailable: boolean;
    websiteEnabled: boolean;
  };
  medicinalSpiceOptions: MaamaaPricedOption[];
  heatLevels: MaamaaPricedOption[];
  numbLevels: MaamaaPricedOption[];
  specialFlavors: MaamaaPricedOption[];
  menuSections: MaamaaMenuSection[];
  stores: Array<{ id: string; label: string; osStoreId: string }>;
  selectedStoreId: string;
  storeOperation: {
    reservationsEnabled: boolean;
    statusNote: string;
    businessHours: unknown;
    reservationNote: string;
    minimumPickupMinutes?: number | null;
    reservationWindows?: ReservationWindow[];
  };
};

type MenuItemRow = {
  id: string;
  externalId: string;
  name: string;
  displayNames?: Record<string, string>;
  description: string;
  descriptionDisplayNames?: Record<string, string>;
  basePrice: number | null;
  variableSchema: Record<string, unknown>;
};

type MenuGroupRow = {
  id: string;
  groupKey: string;
  name: string;
  displayNames?: Record<string, string>;
  ruleJson: Record<string, unknown>;
  sortOrder: number;
};

type MenuOptionRow = {
  optionGroupId: string;
  optionKey: string;
  name: string;
  displayNames?: Record<string, string>;
  priceDelta: number | null;
  sortOrder: number;
};

type StoreSettingRow = {
  menuCatalogItemId: string;
  websiteEnabled: boolean;
  isAvailable: boolean;
  priceOverride: number | null;
};

function choice(option: MenuOptionRow): MaamaaPricedOption {
  return {
    id: option.optionKey,
    name: option.name,
    displayNames: option.displayNames,
    price: option.priceDelta ?? 0
  };
}

function normalizeStoreQuery(value = "") {
  return String(value).trim().toLowerCase();
}

export async function getMaamaaBrand() {
  const brands = await sql`
    select id::text
    from brands
    where (name = 'まぁ麻' or lower(name) = lower('maamaa'))
      and status = 'active'
    limit 1
  `;
  return brands[0] as { id: string } | undefined;
}

export async function getMaamaaCompatibleMenu(storeQuery = ""): Promise<{ brandId: string; baseMenu: MaamaaCompatibleMenu }> {
  const brand = await getMaamaaBrand();
  if (!brand) throw new Error("まぁ麻 brand not found");

  const [items, groups, options, stores] = await Promise.all([
    sql`
      select
        id::text,
        coalesce(external_id, '') as "externalId",
        name,
        coalesce(display_names, '{}'::jsonb) as "displayNames",
        coalesce(description, '') as description,
        coalesce(description_display_names, '{}'::jsonb) as "descriptionDisplayNames",
        base_price::float as "basePrice",
        variable_schema as "variableSchema"
      from menu_catalog_items
      where brand_id = ${brand.id}
        and item_kind = 'buildable_product'
        and is_active = true
      order by updated_at desc
      limit 1
    `,
    sql`
      select
        id::text,
        group_key as "groupKey",
        name,
        coalesce(display_names, '{}'::jsonb) as "displayNames",
        rule_json as "ruleJson",
        sort_order as "sortOrder"
      from menu_option_groups
      where brand_id = ${brand.id}
        and is_active = true
      order by sort_order, name
    `,
    sql`
      select
        option_group_id::text as "optionGroupId",
        option_key as "optionKey",
        name,
        coalesce(display_names, '{}'::jsonb) as "displayNames",
        price_delta::float as "priceDelta",
        sort_order as "sortOrder"
      from menu_options
      where is_active = true
        and option_group_id in (
          select id
          from menu_option_groups
          where brand_id = ${brand.id}
        )
      order by sort_order, name
    `,
    sql`
      select stores.id::text, stores.name, coalesce(stores.external_id, '') as "externalId", coalesce(stores.customer_display_names, '{}'::jsonb) as "customerDisplayNames"
      from stores
      join store_brands on store_brands.store_id = stores.id
      where store_brands.brand_id = ${brand.id}
        and stores.status = 'active'
      order by stores.name
    `
  ]) as [MenuItemRow[], MenuGroupRow[], MenuOptionRow[], Array<{ id: string; name: string; externalId: string; customerDisplayNames?: unknown }>];

  const base = items[0];
  if (!base) throw new Error("base menu item not found");

  const publicStores = stores.map((store) => ({
    id: store.externalId || store.name,
    label: resolveCustomerStoreDisplayName({
      settings: store.customerDisplayNames,
      internalStoreName: store.name,
      brandName: "まぁ麻",
      platform: "web_reservation"
    }),
    osStoreId: store.id
  }));
  const normalizedStoreQuery = normalizeStoreQuery(storeQuery);
  const selectedStore = normalizedStoreQuery
    ? publicStores.find((store) => (
        normalizeStoreQuery(store.id) === normalizedStoreQuery ||
        normalizeStoreQuery(store.label) === normalizedStoreQuery ||
        normalizeStoreQuery(store.osStoreId) === normalizedStoreQuery
      ))
    : publicStores[0];

  const optionsByGroup = new Map<string, MenuOptionRow[]>();
  for (const option of options) {
    const list = optionsByGroup.get(option.optionGroupId) ?? [];
    list.push(option);
    optionsByGroup.set(option.optionGroupId, list);
  }

  const optionStoreSettings = selectedStore
    ? await sql`
        select menu_options.option_key as "optionKey"
        from menu_option_store_settings
        join menu_options on menu_options.id = menu_option_store_settings.menu_option_id
        where menu_option_store_settings.brand_id = ${brand.id}
          and menu_option_store_settings.store_id = ${selectedStore.osStoreId}
          and menu_option_store_settings.is_available = false
      `
    : [];
  const unavailableOptionKeys = new Set(optionStoreSettings.map((setting) => String(setting.optionKey)));

  const storeSettings = selectedStore
    ? (await sql`
        select
          menu_catalog_item_id::text as "menuCatalogItemId",
          website_enabled as "websiteEnabled",
          is_available as "isAvailable",
          price_override::float as "priceOverride"
        from menu_store_settings
        where brand_id = ${brand.id}
          and store_id = ${selectedStore.osStoreId}
          and menu_catalog_item_id = ${base.id}
        limit 1
      `) as StoreSettingRow[]
    : [];
  const baseSetting = storeSettings[0];

  const groupByKey = new Map(groups.map((group) => [group.groupKey, group]));
  const choices = (key: string) => (optionsByGroup.get(groupByKey.get(key)?.id ?? "") ?? [])
    .filter((option) => !unavailableOptionKeys.has(option.optionKey))
    .map(choice);
  const fixedGroupKeys = new Set(["medicinal-spice", "heat", "numb", "special-flavor"]);

  const menuSections = groups
    .filter((group) => !fixedGroupKeys.has(group.groupKey))
    .map((group) => ({
      id: group.groupKey,
      title: group.name,
      displayNames: group.displayNames,
      limit: Number(group.ruleJson?.limit ?? 99),
      items: (optionsByGroup.get(group.id) ?? [])
        .filter((option) => !unavailableOptionKeys.has(option.optionKey))
        .map(choice)
    }));

  const operationRows = selectedStore
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
            else coalesce(store_operations.reservations_enabled, true)
          end as "reservationsEnabled",
          case
            when store_operations.temporary_status_until is not null and store_operations.temporary_status_until <= now() then ''
            else coalesce(store_operations.status_note, '')
          end as "statusNote",
          store_operations.temporary_status_until as "temporaryStatusUntil"
        from stores
        left join store_operations on store_operations.store_id = stores.id
        where stores.id = ${selectedStore.osStoreId}
        limit 1
      `
    : [];
  const storeOperation = await applyStaffPresenceGateToPublicOperation(
    selectedStore?.osStoreId,
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
  const reservationWindows = selectedStore?.osStoreId
    ? await getStoreReservationWindowsForDate({ storeId: selectedStore.osStoreId, pickupDate: today })
    : [];

  return {
    brandId: brand.id,
    baseMenu: {
      baseSoup: {
        id: base.externalId || "mala-soup",
        menuCatalogItemId: base.id,
        name: base.name,
        displayNames: base.displayNames,
        price: baseSetting?.priceOverride ?? base.basePrice ?? 0,
        note: base.description,
        noteDisplayNames: base.descriptionDisplayNames,
        isAvailable: baseSetting?.isAvailable ?? true,
        websiteEnabled: baseSetting?.websiteEnabled ?? true
      },
      medicinalSpiceOptions: choices("medicinal-spice"),
      heatLevels: choices("heat"),
      numbLevels: choices("numb"),
      specialFlavors: choices("special-flavor"),
      menuSections,
      stores: publicStores,
      selectedStoreId: selectedStore?.id ?? publicStores[0]?.id ?? "",
      storeOperation: {
        ...storeOperation,
        reservationWindows
      }
    }
  };
}
