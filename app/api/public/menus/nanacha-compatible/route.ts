import { sql } from "../../../../../lib/db";

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

type MenuGroupRow = {
  id: string;
  groupKey: string;
  name: string;
  ruleJson: Record<string, unknown>;
  sortOrder: number;
};

type MenuOptionRow = {
  optionGroupId: string;
  optionKey: string;
  name: string;
  priceDelta: number | null;
  sortOrder: number;
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

export async function GET() {
  const brands = await sql`
    select id::text
    from brands
    where lower(name) = lower('nanacha')
      and status = 'active'
    limit 1
  `;
  const brand = brands[0];
  if (!brand) return Response.json({ error: "nanacha brand not found" }, { status: 404 });

  const [items, groups, options, stores] = await Promise.all([
    sql`
      select
        id::text,
        coalesce(external_id, '') as "externalId",
        name,
        coalesce(category, '') as category,
        coalesce(description, '') as description,
        coalesce(image_url, '') as "imageUrl",
        base_price::float as "basePrice",
        variable_schema as "variableSchema",
        is_active as "isActive"
      from menu_catalog_items
      where brand_id = ${brand.id}
        and store_id is null
      order by coalesce((variable_schema->>'categoryId'), category), name
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
      select stores.id::text, stores.name
      from stores
      join store_brands on store_brands.store_id = stores.id
      where store_brands.brand_id = ${brand.id}
        and stores.status = 'active'
      order by stores.name
    `
  ]) as [MenuItemRow[], MenuGroupRow[], MenuOptionRow[], Array<{ id: string; name: string }>];

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

  const categoryMap = new Map<string, {
    id: string;
    label: string;
    note: string;
    isTapiocaFree: boolean;
    hasWhipByDefault: boolean;
  }>();

  const drinks = items
    .filter((item) => item.isActive)
    .map((item) => {
      const schema = item.variableSchema ?? {};
      const categoryId = String(schema.categoryId || item.category || "menu");
      if (!categoryMap.has(categoryId)) {
        categoryMap.set(categoryId, {
          id: categoryId,
          label: item.category || categoryId,
          note: "",
          isTapiocaFree: asBoolean(schema.isTapiocaFree),
          hasWhipByDefault: asBoolean(schema.hasWhipByDefault)
        });
      }

      return {
        id: item.externalId || item.id,
        name: item.name,
        category: categoryId,
        price: item.basePrice ?? 0,
        description: item.description,
        imageUrl: item.imageUrl,
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
    })
    .map((drink) => Object.fromEntries(Object.entries(drink).filter(([, value]) => value !== undefined)));

  const categories = Array.from(categoryMap.values());

  return Response.json({
    baseMenu: {
      categories,
      drinks,
      sizes,
      sweetness,
      ice,
      hotIce,
      options: menuOptions,
      toppings,
      tapiocaFreeCategories: categories.filter((category) => category.isTapiocaFree).map((category) => category.id),
      whippedCategories: categories.filter((category) => category.hasWhipByDefault).map((category) => category.id),
      stores: stores.map((store) => ({ id: store.name, label: store.name })),
      selectedStoreId: stores[0]?.name ?? ""
    },
    generatedAt: new Date().toISOString()
  });
}
