import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const catalog = JSON.parse(await readFile(new URL("../data/uber/maamaa-catalog.json", import.meta.url), "utf8"));
const priceRule = catalog.source.pricingRule;

const websitePrice = (uberPrice) =>
  Math.round((Number(uberPrice) * Number(priceRule.multiplier)) / Number(priceRule.roundingUnit)) * Number(priceRule.roundingUnit);

const splitLocalizedName = (value) => {
  const [ja = "", zh = "", ko = "", en = ""] = String(value).split("｜").map((part) => part.trim());
  return {
    name: ja,
    displayNames: Object.fromEntries(Object.entries({ zh, ko, en }).filter(([, name]) => name)),
  };
};

const splitPromotionPrefix = (value) => {
  const name = String(value ?? "").trim();
  const match = name.match(/^((?:【[^】]+】)+)\s*(.+)$/u);
  return match ? { promotionPrefix: match[1], name: match[2] } : { promotionPrefix: "", name };
};

const brandRows = await sql`
  insert into brands (name, brand_type, status, updated_at)
  values ('まぁ麻', 'マーラータン', 'active', now())
  on conflict (name) do update set status = 'active', updated_at = now()
  returning id::text
`;
const brandId = brandRows[0].id;

const existingSources = await sql`
  select id::text from menu_sources
  where brand_id = ${brandId} and store_id is null and name = 'まぁ麻 Uber Eats メニュー'
  limit 1
`;
const sourceRows = existingSources[0]
  ? await sql`
      update menu_sources
      set source_type = 'uber_eats', source_url = ${`uber-eats:${catalog.source.storeId}`}, status = 'active', last_synced_at = now(), updated_at = now()
      where id = ${existingSources[0].id}
      returning id::text
    `
  : await sql`
      insert into menu_sources (brand_id, name, source_type, source_url, status, last_synced_at, updated_at)
      values (${brandId}, 'まぁ麻 Uber Eats メニュー', 'uber_eats', ${`uber-eats:${catalog.source.storeId}`}, 'active', now(), now())
      returning id::text
    `;
const sourceId = sourceRows[0].id;

const categoryNameByKey = new Map();
for (const category of catalog.categories) {
  categoryNameByKey.set(category.key, category.name);
  const existing = await sql`
    select id::text from menu_categories
    where brand_id = ${brandId} and store_id is null
      and (external_id = ${category.id} or name = ${category.name})
    order by case when external_id = ${category.id} then 0 else 1 end
    limit 1
  `;
  if (existing[0]) {
    await sql`
      update menu_categories
      set external_id = ${category.id}, name = ${category.name}, sort_order = ${category.sortOrder}, updated_at = now()
      where id = ${existing[0].id}
    `;
  } else {
    await sql`
      insert into menu_categories (brand_id, external_id, name, note, sort_order, updated_at)
      values (${brandId}, ${category.id}, ${category.name}, '', ${category.sortOrder}, now())
    `;
  }
}

const activeWebsiteIds = [];
const itemIdByWebsiteId = new Map();
for (const [index, product] of catalog.products.entries()) {
  const localized = splitLocalizedName(product.name);
  const japanese = splitPromotionPrefix(localized.name);
  const category = categoryNameByKey.get(product.category) ?? product.category;
  const isActive = product.websiteEnabled !== false;
  if (isActive) activeWebsiteIds.push(product.websiteId);
  const oldRows = await sql`
    select id::text, coalesce(description, '') as description, coalesce(image_url, '') as "imageUrl",
      coalesce(variable_schema, '{}'::jsonb) as "variableSchema"
    from menu_catalog_items
    where brand_id = ${brandId} and store_id is null and external_id = ${product.websiteId}
    limit 1
  `;
  const variableSchema = {
    ...(oldRows[0]?.variableSchema ?? {}),
    source: "uber-eats-menu-maker",
    sourceStoreId: catalog.source.storeId,
    sourceProductId: product.uberId,
    sourceCapturedAt: catalog.source.capturedAt,
    categoryKey: product.category,
    customizationGroupKeys: product.groupKeys,
    uberPrice: product.uberPrice,
    websitePrice: websitePrice(product.uberPrice),
    deliveryOnly: product.deliveryOnly === true,
    websiteEnabled: isActive,
    preset: product.kind !== "buildable_product" && product.kind !== "information",
    buildable: product.kind === "buildable_product" || product.groupKeys.length > 0,
    minimumOrderAmount: ["side-menu", "pairing-drink"].includes(product.category) ? 0 : 800,
  };
  const values = {
    itemKind: product.kind ?? (product.groupKeys.length ? "fixed_product" : "fixed_product"),
    basePrice: websitePrice(product.uberPrice),
    sortOrder: (index + 1) * 10,
  };
  let itemId;
  if (oldRows[0]) {
    const rows = await sql`
      update menu_catalog_items set
        menu_source_id = ${sourceId}, item_kind = ${values.itemKind}, promotion_prefix = ${japanese.promotionPrefix},
        name = ${japanese.name}, display_names = ${JSON.stringify(localized.displayNames)}::jsonb,
        category = ${category}, base_price = ${values.basePrice}, variable_schema = ${JSON.stringify(variableSchema)}::jsonb,
        sort_order = ${values.sortOrder}, is_active = ${isActive}, updated_at = now()
      where id = ${oldRows[0].id}
      returning id::text
    `;
    itemId = rows[0].id;
  } else {
    const rows = await sql`
      insert into menu_catalog_items (
        brand_id, menu_source_id, external_id, item_kind, promotion_prefix, name, display_names, category,
        description, image_url, base_price, variable_schema, sort_order, is_active, updated_at
      ) values (
        ${brandId}, ${sourceId}, ${product.websiteId}, ${values.itemKind}, ${japanese.promotionPrefix}, ${japanese.name},
        ${JSON.stringify(localized.displayNames)}::jsonb, ${category}, '', '', ${values.basePrice},
        ${JSON.stringify(variableSchema)}::jsonb, ${values.sortOrder}, ${isActive}, now()
      ) returning id::text
    `;
    itemId = rows[0].id;
  }
  itemIdByWebsiteId.set(product.websiteId, itemId);
}

await sql`
  update menu_catalog_items
  set is_active = false, updated_at = now()
  where brand_id = ${brandId} and store_id is null
    and external_id not in (select jsonb_array_elements_text(${JSON.stringify(activeWebsiteIds)}::jsonb))
    and is_active = true
`;

const coldProductId = itemIdByWebsiteId.get("cold-dry-mala-noodles");
for (const [groupIndex, group] of catalog.extraGroups.entries()) {
  const existing = await sql`
    select id::text from menu_option_groups
    where brand_id = ${brandId} and group_key = ${group.key}
    limit 1
  `;
  const ruleJson = { source: "uber-eats-menu-maker", minSelections: group.key === "cold-noodles" ? 1 : 0, maxSelections: group.limit, limit: group.limit, perOptionMax: 1 };
  let groupId;
  if (existing[0]) {
    const rows = await sql`
      update menu_option_groups set menu_catalog_item_id = ${coldProductId}, external_id = ${group.uberId}, name = ${group.name}, selection_type = ${group.type},
        rule_json = ${JSON.stringify(ruleJson)}::jsonb, sort_order = ${300 + groupIndex * 10}, is_active = true, updated_at = now()
      where id = ${existing[0].id} returning id::text
    `;
    groupId = rows[0].id;
  } else {
    const rows = await sql`
      insert into menu_option_groups (brand_id, menu_catalog_item_id, external_id, group_key, name, selection_type, affects_procedure, rule_json, sort_order, is_active, updated_at)
      values (${brandId}, ${coldProductId}, ${group.uberId}, ${group.key}, ${group.name}, ${group.type}, true, ${JSON.stringify(ruleJson)}::jsonb, ${300 + groupIndex * 10}, true, now())
      returning id::text
    `;
    groupId = rows[0].id;
  }
  for (const [optionIndex, option] of group.options.entries()) {
    const localized = splitLocalizedName(option.name);
    await sql`
      insert into menu_options (option_group_id, external_id, option_key, name, display_names, price_delta, affects_procedure, sort_order, is_active, updated_at)
      values (${groupId}, ${option.id}, ${option.id}, ${localized.name}, ${JSON.stringify(localized.displayNames)}::jsonb,
        ${websitePrice(option.uberPrice)}, true, ${(optionIndex + 1) * 10}, true, now())
      on conflict (option_group_id, option_key) do update set
        external_id = excluded.external_id, name = excluded.name, display_names = excluded.display_names,
        price_delta = excluded.price_delta, sort_order = excluded.sort_order, is_active = true, updated_at = now()
    `;
  }
}

const groups = await sql`
  select id::text, group_key as "groupKey"
  from menu_option_groups where brand_id = ${brandId} and is_active = true
`;
const groupIdByKey = new Map(groups.map((group) => [group.groupKey, group.id]));

for (const product of catalog.products.filter((entry) => entry.websiteEnabled !== false)) {
  const itemId = itemIdByWebsiteId.get(product.websiteId);
  await sql`delete from menu_catalog_item_option_groups where menu_catalog_item_id = ${itemId}`;
  for (const [index, groupKey] of product.groupKeys.entries()) {
    const groupId = groupIdByKey.get(groupKey);
    if (!groupId) throw new Error(`Missing option group: ${groupKey}`);
    await sql`
      insert into menu_catalog_item_option_groups (menu_catalog_item_id, option_group_id, sort_order, is_active, updated_at)
      values (${itemId}, ${groupId}, ${(index + 1) * 10}, true, now())
      on conflict (menu_catalog_item_id, option_group_id) do update set sort_order = excluded.sort_order, is_active = true, updated_at = now()
    `;
  }
}

const totals = await sql`
  select
    (select count(*)::int from menu_categories where brand_id = ${brandId}) as categories,
    (select count(*)::int from menu_catalog_items where brand_id = ${brandId} and is_active = true) as products,
    (select count(*)::int from menu_catalog_item_option_groups links join menu_catalog_items items on items.id = links.menu_catalog_item_id where items.brand_id = ${brandId} and links.is_active = true) as bindings
`;

console.log(JSON.stringify({ source: catalog.source, ...totals[0] }, null, 2));
