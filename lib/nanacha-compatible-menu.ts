import { sql } from "./db";

export type NanachaPricedOption = {
  id: string;
  label: string;
  price: number;
};

export type NanachaDrink = {
  id: string;
  menuCatalogItemId: string;
  name: string;
  category: string;
  price: number;
  description: string;
  imageUrl: string;
  temperatures: string[];
  isRecommended: boolean;
  isFeatured: boolean;
  allowedSizes?: string[];
  allowedSweetness?: string[];
  allowedIce?: string[];
  allowedOptions?: string[];
  allowedToppings?: string[];
  isAvailable: boolean;
  websiteEnabled: boolean;
};

export type NanachaCompatibleMenu = {
  categories: Array<{
    id: string;
    label: string;
    note: string;
    isTapiocaFree: boolean;
    hasWhipByDefault: boolean;
  }>;
  drinks: NanachaDrink[];
  sizes: NanachaPricedOption[];
  sweetness: string[];
  ice: string[];
  hotIce: string;
  options: NanachaPricedOption[];
  toppings: NanachaPricedOption[];
  tapiocaFreeCategories: string[];
  whippedCategories: string[];
  stores: Array<{ id: string; label: string; osStoreId: string }>;
  selectedStoreId: string;
  storeOperation: {
    reservationsEnabled: boolean;
    statusNote: string;
    businessHours: unknown;
    reservationNote: string;
  };
};

type MenuItemRow = {
  id: string;
  externalId: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  basePrice: number | null;
  variableSchema: Record<string, unknown>;
  isActive: boolean;
};

type StoreSettingRow = {
  menuCatalogItemId: string;
  websiteEnabled: boolean;
  isAvailable: boolean;
  priceOverride: number | null;
};

type MenuGroupRow = {
  id: string;
  groupKey: string;
  name: string;
  ruleJson: Record<string, unknown>;
};

type MenuCategoryRow = {
  id: string;
  externalId: string;
  name: string;
  note: string;
  isTapiocaFree: boolean;
  hasWhipByDefault: boolean;
  sortOrder: number;
};

type MenuOptionRow = {
  optionGroupId: string;
  optionKey: string;
  name: string;
  priceDelta: number | null;
};

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function asBoolean(value: unknown) {
  return value === true;
}

function maybeLimitedArray(value: unknown, allValues: string[], alwaysAllowed: string[] = []) {
  const alwaysAllowedSet = new Set(alwaysAllowed);
  const values = asStringArray(value).filter((item) => !alwaysAllowedSet.has(item));
  if (!values.length) return undefined;
  if (values.length === allValues.length && values.every((item) => allValues.includes(item))) return undefined;
  return values;
}

function optionObjects(options: MenuOptionRow[]) {
  return options.map((option) => ({
    id: option.optionKey,
    label: option.name,
    price: option.priceDelta ?? 0
  }));
}

function publicUrl(value: unknown, requestUrl: string) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url.startsWith("/") ? url : `/${url}`, requestUrl).toString();
}

export async function getNanachaBrand() {
  const brands = await sql`
    select id::text
    from brands
    where lower(name) = lower('nanacha')
      and status = 'active'
    limit 1
  `;
  return brands[0] as { id: string } | undefined;
}

function normalizeStoreQuery(value = "") {
  return String(value).trim().toLowerCase();
}

export async function getNanachaCompatibleMenu(requestUrl: string, storeQuery = ""): Promise<{ brandId: string; baseMenu: NanachaCompatibleMenu }> {
  const brand = await getNanachaBrand();
  if (!brand) throw new Error("nanacha brand not found");

  const [items, categories, groups, options, stores] = await Promise.all([
    sql`
      select
        menu_catalog_items.id::text,
        coalesce(menu_catalog_items.external_id, '') as "externalId",
        menu_catalog_items.name,
        coalesce(menu_catalog_items.category, '') as category,
        coalesce(menu_catalog_items.description, '') as description,
        coalesce(menu_catalog_items.image_url, '') as "imageUrl",
        menu_catalog_items.base_price::float as "basePrice",
        menu_catalog_items.variable_schema as "variableSchema",
        menu_catalog_items.is_active as "isActive"
      from menu_catalog_items
      left join menu_categories
        on menu_categories.brand_id = menu_catalog_items.brand_id
        and menu_categories.store_id is null
        and menu_categories.name = coalesce(nullif(menu_catalog_items.category, ''), '未分類')
      where menu_catalog_items.brand_id = ${brand.id}
        and menu_catalog_items.store_id is null
      order by coalesce(menu_categories.sort_order, 9999), menu_catalog_items.sort_order, name
    `,
    sql`
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
        and store_id is null
      order by sort_order, name
    `,
    sql`
      select
        id::text,
        group_key as "groupKey",
        name,
        rule_json as "ruleJson",
        sort_order as "sortOrder"
      from menu_option_groups
      where brand_id = ${brand.id}
        and menu_catalog_item_id is null
        and is_active = true
      order by sort_order, name
    `,
    sql`
      select
        option_group_id::text as "optionGroupId",
        option_key as "optionKey",
        name,
        price_delta::float as "priceDelta",
        sort_order as "sortOrder"
      from menu_options
      where is_active = true
        and option_group_id in (
          select id
          from menu_option_groups
          where brand_id = ${brand.id}
            and menu_catalog_item_id is null
        )
      order by sort_order, name
    `,
    sql`
      select stores.id::text, stores.name, coalesce(stores.external_id, '') as "externalId"
      from stores
      join store_brands on store_brands.store_id = stores.id
      where store_brands.brand_id = ${brand.id}
        and stores.status = 'active'
      order by stores.name
    `
  ]) as [MenuItemRow[], MenuCategoryRow[], MenuGroupRow[], MenuOptionRow[], Array<{ id: string; name: string; externalId: string }>];

  const optionsByGroup = new Map<string, MenuOptionRow[]>();
  for (const option of options) {
    const list = optionsByGroup.get(option.optionGroupId) ?? [];
    list.push(option);
    optionsByGroup.set(option.optionGroupId, list);
  }

  const groupByKey = new Map(groups.map((group) => [group.groupKey, group]));
  const groupOptions = (key: string) => optionsByGroup.get(groupByKey.get(key)?.id ?? "") ?? [];

  const sizes = optionObjects(groupOptions("size"));
  const sweetness = groupOptions("sweetness").map((option) => option.name);
  const ice = groupOptions("ice").map((option) => option.name);
  const menuOptions = optionObjects(groupOptions("option"));
  const toppings = optionObjects(groupOptions("topping"));
  const hotIce = String(groupByKey.get("ice")?.ruleJson?.hotValue || "HOTは氷なし");

  const sizeIds = sizes.map((item) => item.id);
  const optionIds = menuOptions.filter((item) => item.id !== "none").map((item) => item.id);
  const toppingIds = toppings.map((item) => item.id);

  const categoryMap = new Map<string, NanachaCompatibleMenu["categories"][number]>();
  const categoriesByName = new Map(categories.map((category) => [category.name, category]));
  const categoriesByExternalId = new Map(categories.filter((category) => category.externalId).map((category) => [category.externalId, category]));
  const drinks = items
    .filter((item) => item.isActive)
    .map((item) => {
      const schema = item.variableSchema ?? {};
      const categoryId = String(schema.categoryId || item.category || "menu");
      const categoryMaster = categoriesByExternalId.get(categoryId) ?? categoriesByName.get(item.category);
      const publicCategoryId = categoryMaster?.externalId || categoryId;
      if (!categoryMap.has(categoryId)) {
        categoryMap.set(categoryId, {
          id: publicCategoryId,
          label: categoryMaster?.name || item.category || categoryId,
          note: categoryMaster?.note || "",
          isTapiocaFree: categoryMaster?.isTapiocaFree ?? asBoolean(schema.isTapiocaFree),
          hasWhipByDefault: categoryMaster?.hasWhipByDefault ?? asBoolean(schema.hasWhipByDefault)
        });
      }

      const drink = {
        id: item.externalId || item.id,
        menuCatalogItemId: item.id,
        name: item.name,
        category: publicCategoryId,
        price: item.basePrice ?? 0,
        description: item.description,
        imageUrl: publicUrl(item.imageUrl, requestUrl),
        temperatures: asStringArray(schema.temperatures).length ? asStringArray(schema.temperatures) : ["ICE"],
        isRecommended: asBoolean(schema.isRecommended),
        isFeatured: asBoolean(schema.isFeatured),
        allowedSizes: maybeLimitedArray(schema.allowedSizes, sizeIds),
        allowedSweetness: maybeLimitedArray(schema.allowedSweetness, sweetness),
        allowedIce: maybeLimitedArray(schema.allowedIce, ice),
        allowedOptions: maybeLimitedArray(schema.allowedOptions, optionIds, ["none"]),
        allowedToppings: maybeLimitedArray(schema.allowedToppings, toppingIds),
        isAvailable: true,
        websiteEnabled: true
      };
      return Object.fromEntries(Object.entries(drink).filter(([, value]) => value !== undefined)) as NanachaDrink;
    });

  const publicCategories = Array.from(categoryMap.values());
  const publicStores = stores.map((store) => ({
    id: store.externalId || store.name,
    label: store.name,
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
      `) as StoreSettingRow[]
    : [];
  const settingsByItemId = new Map(storeSettings.map((setting) => [setting.menuCatalogItemId, setting]));
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
  const operationRows = selectedStore
    ? await sql`
        select
          stores.business_hours as "businessHours",
          coalesce(stores.reservation_note, '') as "reservationNote",
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
  const storeOperation = operationRows[0] as NanachaCompatibleMenu["storeOperation"] | undefined;

  const drinksWithStoreSettings = drinks.map((drink) => {
    const setting = settingsByItemId.get(drink.menuCatalogItemId);
    if (!setting) return drink;
    return {
      ...drink,
      price: setting.priceOverride ?? drink.price,
      isAvailable: setting.isAvailable,
      websiteEnabled: setting.websiteEnabled
    };
  });

  return {
    brandId: brand.id,
    baseMenu: {
      categories: publicCategories,
      drinks: drinksWithStoreSettings,
      sizes,
      sweetness,
      ice,
      hotIce,
      options: menuOptions.filter((option) => !unavailableOptionKeys.has(option.id)),
      toppings: toppings.filter((option) => !unavailableOptionKeys.has(option.id)),
      tapiocaFreeCategories: publicCategories.filter((category) => category.isTapiocaFree).map((category) => category.id),
      whippedCategories: publicCategories.filter((category) => category.hasWhipByDefault).map((category) => category.id),
      stores: publicStores,
      selectedStoreId: selectedStore?.id ?? publicStores[0]?.id ?? "",
      storeOperation: storeOperation ?? {
        reservationsEnabled: true,
        statusNote: "",
        businessHours: {},
        reservationNote: ""
      }
    }
  };
}
