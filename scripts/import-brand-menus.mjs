import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "./db-env.mjs";

const nanachaMenuPath = "/Users/wushengyin/Desktop/nanacha New HP/published/menu.json";
const maamaaMenuPath = "/Users/wushengyin/Desktop/maamaa/src/data/malatang-menu.ts";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);

function slugKey(value, fallback = "option") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || fallback;
}

function choiceKey(choice, index) {
  if (typeof choice === "string") return choice;
  return choice.id || slugKey(choice.label ?? choice.name, `choice-${index + 1}`);
}

async function ensureBrand(name, brandType) {
  const rows = await sql`
    insert into brands (name, brand_type, status, updated_at)
    values (${name}, ${brandType}, 'active', now())
    on conflict (name)
    do update set brand_type = excluded.brand_type, status = 'active', updated_at = now()
    returning id::text, name
  `;
  return rows[0];
}

async function upsertSource({ brandId, name, sourceType, sourceUrl }) {
  const existing = await sql`
    select id::text
    from menu_sources
    where brand_id = ${brandId}
      and store_id is null
      and name = ${name}
    limit 1
  `;

  if (existing[0]) {
    const rows = await sql`
      update menu_sources
      set source_type = ${sourceType}, source_url = ${sourceUrl}, status = 'active', last_synced_at = now(), updated_at = now()
      where id = ${existing[0].id}
      returning id::text
    `;
    return rows[0].id;
  }

  const rows = await sql`
    insert into menu_sources (brand_id, name, source_type, source_url, status, last_synced_at, updated_at)
    values (${brandId}, ${name}, ${sourceType}, ${sourceUrl}, 'active', now(), now())
    returning id::text
  `;
  return rows[0].id;
}

async function upsertItem({
  brandId,
  sourceId,
  externalId,
  itemKind,
  name,
  category,
  description,
  imageUrl,
  basePrice,
  variableSchema,
  isActive = true
}) {
  const existing = await sql`
    select id::text
    from menu_catalog_items
    where brand_id = ${brandId}
      and store_id is null
      and external_id = ${externalId}
    limit 1
  `;

  const schema = JSON.stringify(variableSchema ?? {});
  if (existing[0]) {
    const rows = await sql`
      update menu_catalog_items
      set
        menu_source_id = ${sourceId},
        item_kind = ${itemKind},
        name = ${name},
        category = ${category},
        description = ${description},
        image_url = ${imageUrl},
        base_price = ${basePrice},
        variable_schema = ${schema}::jsonb,
        is_active = ${isActive},
        updated_at = now()
      where id = ${existing[0].id}
      returning id::text
    `;
    return rows[0].id;
  }

  const rows = await sql`
    insert into menu_catalog_items (
      brand_id,
      menu_source_id,
      external_id,
      item_kind,
      name,
      category,
      description,
      image_url,
      base_price,
      variable_schema,
      is_active,
      updated_at
    )
    values (
      ${brandId},
      ${sourceId},
      ${externalId},
      ${itemKind},
      ${name},
      ${category},
      ${description},
      ${imageUrl},
      ${basePrice},
      ${schema}::jsonb,
      ${isActive},
      now()
    )
    returning id::text
  `;
  return rows[0].id;
}

async function upsertGroup({
  brandId,
  itemId = null,
  externalId,
  groupKey,
  name,
  selectionType,
  affectsProcedure = true,
  ruleJson = {},
  sortOrder = 100,
  isActive = true
}) {
  const existing = itemId
    ? await sql`
        select id::text
        from menu_option_groups
        where brand_id = ${brandId}
          and menu_catalog_item_id = ${itemId}
          and group_key = ${groupKey}
        limit 1
      `
    : await sql`
        select id::text
        from menu_option_groups
        where brand_id = ${brandId}
          and menu_catalog_item_id is null
          and group_key = ${groupKey}
        limit 1
      `;

  if (existing[0]) {
    const rows = await sql`
      update menu_option_groups
      set
        external_id = ${externalId},
        name = ${name},
        selection_type = ${selectionType},
        affects_procedure = ${affectsProcedure},
        rule_json = ${JSON.stringify(ruleJson)}::jsonb,
        sort_order = ${sortOrder},
        is_active = ${isActive},
        updated_at = now()
      where id = ${existing[0].id}
      returning id::text
    `;
    return rows[0].id;
  }

  const rows = await sql`
    insert into menu_option_groups (
      brand_id,
      menu_catalog_item_id,
      external_id,
      group_key,
      name,
      selection_type,
      affects_procedure,
      rule_json,
      sort_order,
      is_active,
      updated_at
    )
    values (
      ${brandId},
      ${itemId},
      ${externalId},
      ${groupKey},
      ${name},
      ${selectionType},
      ${affectsProcedure},
      ${JSON.stringify(ruleJson)}::jsonb,
      ${sortOrder},
      ${isActive},
      now()
    )
    returning id::text
  `;
  return rows[0].id;
}

async function upsertOption({
  groupId,
  externalId,
  optionKey,
  name,
  priceDelta = 0,
  affectsProcedure = true,
  sortOrder = 100,
  isActive = true
}) {
  const existing = await sql`
    select id::text
    from menu_options
    where option_group_id = ${groupId}
      and option_key = ${optionKey}
    limit 1
  `;

  if (existing[0]) {
    const rows = await sql`
      update menu_options
      set
        external_id = ${externalId},
        name = ${name},
        price_delta = ${priceDelta},
        affects_procedure = ${affectsProcedure},
        sort_order = ${sortOrder},
        is_active = ${isActive},
        updated_at = now()
      where id = ${existing[0].id}
      returning id::text
    `;
    return rows[0].id;
  }

  const rows = await sql`
    insert into menu_options (
      option_group_id,
      external_id,
      option_key,
      name,
      price_delta,
      affects_procedure,
      sort_order,
      is_active,
      updated_at
    )
    values (
      ${groupId},
      ${externalId},
      ${optionKey},
      ${name},
      ${priceDelta},
      ${affectsProcedure},
      ${sortOrder},
      ${isActive},
      now()
    )
    returning id::text
  `;
  return rows[0].id;
}

async function upsertOptions(groupId, choices, { affectsProcedure = true } = {}) {
  for (const [index, choice] of choices.entries()) {
    const id = choiceKey(choice, index);
    const name = typeof choice === "string" ? choice : choice.label ?? choice.name;
    const price = typeof choice === "string" ? 0 : choice.price ?? 0;
    await upsertOption({
      groupId,
      externalId: id,
      optionKey: id,
      name,
      priceDelta: price,
      affectsProcedure,
      sortOrder: (index + 1) * 10,
      isActive: true
    });
  }
}

async function importNanacha() {
  const menu = JSON.parse(await readFile(nanachaMenuPath, "utf8")).baseMenu;
  const brand = await ensureBrand("nanacha", "ミルクティー");
  const sourceId = await upsertSource({
    brandId: brand.id,
    name: "nanacha 公式メニュー",
    sourceType: "imported_site",
    sourceUrl: nanachaMenuPath
  });

  const categoriesById = new Map(menu.categories.map((category) => [category.id, category]));
  for (const drink of menu.drinks) {
    const category = categoriesById.get(drink.category);
    await upsertItem({
      brandId: brand.id,
      sourceId,
      externalId: drink.id,
      itemKind: "fixed_product",
      name: drink.name,
      category: category?.label ?? drink.category,
      description: drink.description ?? category?.note ?? "",
      imageUrl: drink.imageUrl ?? "",
      basePrice: drink.price ?? null,
      variableSchema: {
        source: "nanacha-published-menu",
        categoryId: drink.category,
        temperatures: drink.temperatures ?? ["ICE"],
        allowedSizes: drink.allowedSizes ?? menu.sizes.map((size) => size.id),
        allowedSweetness: drink.allowedSweetness ?? menu.sweetness,
        allowedIce: drink.allowedIce ?? menu.ice,
        allowedOptions: drink.allowedOptions ?? menu.options.map((option) => option.id),
        isRecommended: Boolean(drink.isRecommended),
        isFeatured: Boolean(drink.isFeatured),
        isTapiocaFree: Boolean(category?.isTapiocaFree),
        hasWhipByDefault: Boolean(category?.hasWhipByDefault)
      },
      isActive: drink.isAvailable !== false && drink.websiteEnabled !== false
    });
  }

  const groups = [
    { key: "temperature", name: "温度", type: "single", choices: [{ id: "ICE", label: "ICE", price: 0 }, { id: "HOT", label: "HOT", price: 0 }], affectsProcedure: true, ruleJson: { source: "nanacha", sourceField: "temperatures", defaultBehavior: "ice_when_missing", optionValueType: "id" } },
    { key: "size", name: "サイズ", type: "single", choices: menu.sizes, affectsProcedure: true, ruleJson: { source: "nanacha", sourceField: "allowedSizes", defaultBehavior: "all_when_missing_or_empty", optionValueType: "id" } },
    { key: "sweetness", name: "甘さ", type: "single", choices: menu.sweetness, affectsProcedure: true, ruleJson: { source: "nanacha", sourceField: "allowedSweetness", defaultBehavior: "all_when_missing_or_empty", optionValueType: "label" } },
    { key: "ice", name: "氷", type: "single", choices: menu.ice, affectsProcedure: true, ruleJson: { source: "nanacha", sourceField: "allowedIce", defaultBehavior: "all_when_missing_or_empty", optionValueType: "label", hotValue: menu.hotIce } },
    { key: "option", name: "オプション", type: "multiple", choices: menu.options, affectsProcedure: true, ruleJson: { source: "nanacha", sourceField: "allowedOptions", defaultBehavior: "all_when_missing_or_empty", optionValueType: "id", alwaysAllowed: ["none"] } },
    { key: "topping", name: "トッピング", type: "multiple", choices: menu.toppings, affectsProcedure: true, ruleJson: { source: "nanacha", sourceField: "allowedToppings", defaultBehavior: "all_when_missing_or_empty", optionValueType: "id", categoryRules: ["tapiocaFreeCategories", "whippedCategories"] } }
  ];

  for (const [index, group] of groups.entries()) {
    const groupId = await upsertGroup({
      brandId: brand.id,
      externalId: group.key,
      groupKey: group.key,
      name: group.name,
      selectionType: group.type,
      affectsProcedure: group.affectsProcedure,
      ruleJson: group.ruleJson,
      sortOrder: (index + 1) * 10
    });
    await upsertOptions(groupId, group.choices, { affectsProcedure: group.affectsProcedure });
  }

  await sql`
    delete from menu_options
    using menu_option_groups
    where menu_options.option_group_id = menu_option_groups.id
      and menu_option_groups.brand_id = ${brand.id}
      and menu_option_groups.group_key in ('sweetness', 'ice')
      and menu_options.option_key like 'choice-%'
  `;

  return { brand: brand.name, items: menu.drinks.length, groups: groups.length };
}

async function importMaamaa() {
  const menu = await import(pathToFileURL(maamaaMenuPath).href);
  const brand = await ensureBrand("まぁ麻", "マーラータン");
  const sourceId = await upsertSource({
    brandId: brand.id,
    name: "まぁ麻 公式メニュー",
    sourceType: "imported_site",
    sourceUrl: maamaaMenuPath
  });

  const itemId = await upsertItem({
    brandId: brand.id,
    sourceId,
    externalId: menu.baseSoup.id,
    itemKind: "buildable_product",
    name: menu.baseSoup.name,
    category: "マーラータン",
    description: menu.baseSoup.note ?? "",
    imageUrl: "",
    basePrice: menu.baseSoup.price ?? null,
    variableSchema: {
      source: "maamaa-malatang-menu",
      buildable: true,
      baseSoup: menu.baseSoup,
      optionGroupKeys: [
        "medicinal-spice",
        "heat",
        "numb",
        "special-flavor",
        ...menu.menuSections.map((section) => section.id)
      ]
    },
    isActive: true
  });

  const fixedGroups = [
    { key: "medicinal-spice", name: "薬膳スパイス", type: "single", choices: menu.medicinalSpiceOptions, affectsProcedure: true, ruleJson: { source: "maamaa", defaultChoice: menu.medicinalSpiceOptions[0]?.id, optionValueType: "id" } },
    { key: "heat", name: "辛さ", type: "single", choices: menu.heatLevels, affectsProcedure: true, ruleJson: { source: "maamaa", defaultChoice: "normal", optionValueType: "id" } },
    { key: "numb", name: "痺れ", type: "single", choices: menu.numbLevels, affectsProcedure: true, ruleJson: { source: "maamaa", defaultChoice: "tiny", optionValueType: "id" } },
    { key: "special-flavor", name: "味変・追加調味", type: "multiple", choices: menu.specialFlavors, affectsProcedure: true, ruleJson: { source: "maamaa", limit: 6, optionValueType: "id" } }
  ];

  let groupCount = 0;
  for (const [index, group] of fixedGroups.entries()) {
    const groupId = await upsertGroup({
      brandId: brand.id,
      itemId,
      externalId: group.key,
      groupKey: group.key,
      name: group.name,
      selectionType: group.type,
      affectsProcedure: group.affectsProcedure,
      ruleJson: group.ruleJson,
      sortOrder: (index + 1) * 10
    });
    await upsertOptions(groupId, group.choices, { affectsProcedure: group.affectsProcedure });
    groupCount += 1;
  }

  let optionCount = fixedGroups.reduce((total, group) => total + group.choices.length, 0);
  for (const [index, section] of menu.menuSections.entries()) {
    const groupId = await upsertGroup({
      brandId: brand.id,
      itemId,
      externalId: section.id,
      groupKey: section.id,
      name: section.title,
      selectionType: "quantity",
      affectsProcedure: true,
      ruleJson: { source: "maamaa", limit: section.limit, optionValueType: "id" },
      sortOrder: 100 + (index + 1) * 10
    });
    await upsertOptions(groupId, section.items, { affectsProcedure: true });
    groupCount += 1;
    optionCount += section.items.length;
  }

  return { brand: brand.name, items: 1, groups: groupCount, options: optionCount };
}

const results = [];
results.push(await importNanacha());
results.push(await importMaamaa());

const counts = await sql`
  select
    brands.name as brand,
    count(distinct menu_catalog_items.id)::int as items,
    count(distinct menu_option_groups.id)::int as groups,
    count(distinct menu_options.id)::int as options
  from brands
  left join menu_catalog_items on menu_catalog_items.brand_id = brands.id
  left join menu_option_groups on menu_option_groups.brand_id = brands.id
  left join menu_options on menu_options.option_group_id = menu_option_groups.id
  where brands.name in ('nanacha', 'まぁ麻')
  group by brands.name
  order by brands.name
`;

console.log(JSON.stringify({ imported: results, totals: counts }, null, 2));
