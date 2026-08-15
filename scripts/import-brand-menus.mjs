import { neon } from "@neondatabase/serverless";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "./db-env.mjs";

const nanachaMenuPath = "/Users/wushengyin/Desktop/nanacha New HP/published/menu.json";
const maamaaMenuPath = "/Users/wushengyin/Desktop/maamaa/src/data/malatang-menu.ts";
const nanachaLocaleDir = "/Users/wushengyin/Desktop/nanacha New HP/public/locales";
const maamaaLocaleDir = "/Users/wushengyin/Desktop/maamaa/public/locales";
const nanachaImageDir = new URL("../public/assets/menu/nanacha/", import.meta.url);
const brandArgumentIndex = process.argv.indexOf("--brand");
const selectedBrand = brandArgumentIndex >= 0 ? String(process.argv[brandArgumentIndex + 1] ?? "").trim().toLowerCase() : "";
const pruneMissing = process.argv.includes("--prune");

if (selectedBrand && !["nanacha", "maamaa"].includes(selectedBrand)) {
  throw new Error(`Unknown --brand value: ${selectedBrand}`);
}

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

function splitPromotionPrefix(value) {
  const name = String(value ?? "").trim();
  const match = name.match(/^((?:【[^】]+】)+)\s*(.+)$/u);
  return match ? { promotionPrefix: match[1], name: match[2] } : { promotionPrefix: "", name };
}

async function loadDictionary(localeDir, language) {
  try {
    return JSON.parse(await readFile(`${localeDir}/${language}.json`, "utf8"));
  } catch {
    return {};
  }
}

async function loadBrandDictionaries(localeDir) {
  const languages = ["en", "zh", "zh-Hant", "ko", "vi", "ne"];
  const dictionaries = await Promise.all(languages.map((language) => loadDictionary(localeDir, language)));
  return Object.fromEntries(languages.map((language, index) => [language, dictionaries[index]]));
}

function translateText(value, dictionary) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (dictionary[text]) return dictionary[text];
  return Object.entries(dictionary)
    .filter(([source, target]) => source.length > 3 && target && text.includes(source))
    .sort((left, right) => right[0].length - left[0].length)
    .reduce((current, [source, target]) => current.split(source).join(target), text);
}

function displayNamesFor(value, dictionaries) {
  const text = String(value ?? "").trim();
  if (!text) return {};
  return Object.fromEntries(
    Object.entries(dictionaries)
      .map(([language, dictionary]) => [language, translateText(text, dictionary)])
      .filter(([, translated]) => translated && translated !== text)
  );
}

function cleanNanachaDescription(value) {
  return String(value ?? "")
    .replace(
      /\s*※?\s*This item does not contain tapioca\.\s*You can choose from the customize menu\.\s*/gi,
      "\n"
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function loadNanachaImageUrls() {
  try {
    const files = await readdir(nanachaImageDir);
    return new Map(
      files
        .filter((file) => /\.(jpe?g|png|webp|avif)$/i.test(file))
        .map((file) => {
          const name = file.replace(/\.[^.]+$/, "").replace(/_\d+$/, "");
          return [name, `/assets/menu/nanacha/${encodeURIComponent(file)}`];
        })
    );
  } catch {
    return new Map();
  }
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

async function upsertCategory({
  brandId,
  externalId,
  name,
  note = "",
  isTapiocaFree = false,
  hasWhipByDefault = false,
  sortOrder = 100
}) {
  const existing = await sql`
    select id::text, coalesce(external_id, '') as "externalId"
    from menu_categories
    where brand_id = ${brandId}
      and store_id is null
      and (
        (${externalId || null}::text is not null and lower(external_id) = lower(${externalId || null}))
        or name = ${name}
      )
    order by case when lower(external_id) = lower(${externalId || ""}) then 0 else 1 end
    limit 1
  `;

  if (existing[0]) {
    const rows = await sql`
      update menu_categories
      set
        external_id = ${existing[0].externalId || externalId},
        name = ${name},
        note = ${note},
        is_tapioca_free = ${isTapiocaFree},
        has_whip_by_default = ${hasWhipByDefault},
        sort_order = ${sortOrder},
        updated_at = now()
      where id = ${existing[0].id}
      returning id::text
    `;
    return rows[0].id;
  }

  const rows = await sql`
    insert into menu_categories (
      brand_id,
      external_id,
      name,
      note,
      is_tapioca_free,
      has_whip_by_default,
      sort_order,
      updated_at
    )
    values (
      ${brandId},
      ${externalId},
      ${name},
      ${note},
      ${isTapiocaFree},
      ${hasWhipByDefault},
      ${sortOrder},
      now()
    )
    returning id::text
  `;
  return rows[0].id;
}

async function upsertItem({
  brandId,
  sourceId,
  externalId,
  itemKind,
  promotionPrefix,
  name,
  category,
  description,
  descriptionDisplayNames = {},
  imageUrl,
  basePrice,
  variableSchema,
  displayNames = {},
  sortOrder = 100,
  isActive = true
}) {
  const existing = await sql`
    select
      id::text,
      coalesce(promotion_prefix, '') as "promotionPrefix",
      coalesce(variable_schema, '{}'::jsonb) as "variableSchema"
    from menu_catalog_items
    where brand_id = ${brandId}
      and store_id is null
      and external_id = ${externalId}
    limit 1
  `;

  const schema = JSON.stringify({
    ...(existing[0]?.variableSchema ?? {}),
    ...(variableSchema ?? {}),
    ...(existing[0]?.variableSchema?.websitePresentation
      ? { websitePresentation: existing[0].variableSchema.websitePresentation }
      : {})
  });
  const resolvedPromotionPrefix = promotionPrefix === undefined
    ? String(existing[0]?.promotionPrefix ?? "")
    : String(promotionPrefix ?? "").trim();
  if (existing[0]) {
    const rows = await sql`
      update menu_catalog_items
      set
        menu_source_id = ${sourceId},
        item_kind = ${itemKind},
        promotion_prefix = ${resolvedPromotionPrefix},
        name = ${name},
        display_names = ${JSON.stringify(displayNames)}::jsonb,
        category = ${category},
        description = ${description},
        description_display_names = ${JSON.stringify(descriptionDisplayNames)}::jsonb,
        image_url = ${imageUrl},
        base_price = ${basePrice},
        variable_schema = ${schema}::jsonb,
        sort_order = ${sortOrder},
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
      promotion_prefix,
      name,
      display_names,
      category,
      description,
      description_display_names,
      image_url,
      base_price,
      variable_schema,
      sort_order,
      is_active,
      updated_at
    )
    values (
      ${brandId},
      ${sourceId},
      ${externalId},
      ${itemKind},
      ${resolvedPromotionPrefix},
      ${name},
      ${JSON.stringify(displayNames)}::jsonb,
      ${category},
      ${description},
      ${JSON.stringify(descriptionDisplayNames)}::jsonb,
      ${imageUrl},
      ${basePrice},
      ${schema}::jsonb,
      ${sortOrder},
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
  displayNames = {},
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
        display_names = ${JSON.stringify(displayNames)}::jsonb,
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
      display_names,
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
      ${JSON.stringify(displayNames)}::jsonb,
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
  displayNames = {},
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
        display_names = ${JSON.stringify(displayNames)}::jsonb,
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
      display_names,
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
      ${JSON.stringify(displayNames)}::jsonb,
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

async function upsertOptions(groupId, choices, { affectsProcedure = true, dictionaries = {} } = {}) {
  const activeOptionKeys = [];
  for (const [index, choice] of choices.entries()) {
    const id = choiceKey(choice, index);
    const name = typeof choice === "string" ? choice : choice.label ?? choice.name;
    const price = typeof choice === "string" ? 0 : choice.price ?? 0;
    activeOptionKeys.push(id);
    await upsertOption({
      groupId,
      externalId: id,
      optionKey: id,
      name,
      priceDelta: price,
      affectsProcedure,
      displayNames: {
        ...displayNamesFor(name, dictionaries),
        ...(typeof choice === "string" ? {} : choice.displayNames ?? {})
      },
      sortOrder: (index + 1) * 10,
      isActive: true
    });
  }
  if (pruneMissing) {
    await sql`
      update menu_options
      set is_active = false, updated_at = now()
      where option_group_id = ${groupId}
        and option_key not in (
          select jsonb_array_elements_text(${JSON.stringify(activeOptionKeys)}::jsonb)
        )
        and is_active = true
    `;
  }
}

async function importNanacha() {
  const menu = JSON.parse(await readFile(nanachaMenuPath, "utf8")).baseMenu;
  const dictionaries = await loadBrandDictionaries(nanachaLocaleDir);
  const imageUrlsByName = await loadNanachaImageUrls();
  const brand = await ensureBrand("nanacha", "ミルクティー");
  const sourceId = await upsertSource({
    brandId: brand.id,
    name: "nanacha 公式メニュー",
    sourceType: "imported_site",
    sourceUrl: nanachaMenuPath
  });

  const categoriesById = new Map(menu.categories.map((category) => [category.id, category]));
  for (const [index, category] of menu.categories.entries()) {
    await upsertCategory({
      brandId: brand.id,
      externalId: category.id,
      name: category.label,
      note: category.note ?? "",
      isTapiocaFree: Boolean(category.isTapiocaFree),
      hasWhipByDefault: Boolean(category.hasWhipByDefault),
      sortOrder: (index + 1) * 10
    });
  }

  const isDecafMenuItem = (drink) => /カフェ|コーヒ|coffee|cafe/i.test(drink.name);
  const getNanachaAllowedOptions = (drink) => {
    const optionIds = drink.allowedOptions ?? menu.options.map((option) => option.id);
    return optionIds.filter((id) => id !== "decaf" || isDecafMenuItem(drink));
  };
  const getNanachaAllowedToppings = (drink, category) => {
    const toppingIds = drink.allowedToppings ?? menu.toppings.map((topping) => topping.id);
    return toppingIds.filter((id) => {
      if (id === "no-tapioca") return !category?.isTapiocaFree;
      if (id === "no-whip") return Boolean(category?.hasWhipByDefault);
      return true;
    });
  };

  for (const drink of menu.drinks) {
    const category = categoriesById.get(drink.category);
    const description = cleanNanachaDescription(drink.description ?? category?.note ?? "");
    await upsertItem({
      brandId: brand.id,
      sourceId,
      externalId: drink.id,
      itemKind: "fixed_product",
      name: drink.name,
      category: category?.label ?? drink.category,
      description,
      descriptionDisplayNames: displayNamesFor(description, dictionaries),
      imageUrl: imageUrlsByName.get(drink.name) ?? drink.imageUrl ?? "",
      basePrice: drink.price ?? null,
      displayNames: displayNamesFor(drink.name, dictionaries),
      variableSchema: {
        source: "nanacha-published-menu",
        categoryId: drink.category,
        temperatures: drink.temperatures ?? ["ICE"],
        allowedSizes: drink.allowedSizes ?? menu.sizes.map((size) => size.id),
        allowedSweetness: drink.allowedSweetness ?? menu.sweetness,
        allowedIce: drink.allowedIce ?? menu.ice,
        allowedOptions: getNanachaAllowedOptions(drink),
        allowedToppings: getNanachaAllowedToppings(drink, category),
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
    { key: "size", name: "サイズ", type: "single", choices: menu.sizes, affectsProcedure: true, ruleJson: { source: "nanacha", sourceField: "allowedSizes", defaultBehavior: "all_when_missing_or_empty", optionValueType: "id", defaultOptionKey: "regular" } },
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
      displayNames: displayNamesFor(group.name, dictionaries),
      sortOrder: (index + 1) * 10
    });
    await upsertOptions(groupId, group.choices, { affectsProcedure: group.affectsProcedure, dictionaries });
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
  const dictionaries = await loadBrandDictionaries(maamaaLocaleDir);
  const brand = await ensureBrand("まぁ麻", "マーラータン");
  const sourceId = await upsertSource({
    brandId: brand.id,
    name: "まぁ麻 公式メニュー",
    sourceType: "imported_site",
    sourceUrl: maamaaMenuPath
  });
  const menuCategories = menu.menuCategories ?? [
    { id: "base-soup", name: "🌶️旨味ベースの特別仕立てスープ", sortOrder: 10 },
    { id: "chef-special", name: "👨‍🍳✨️シェフのスペシャル麻辣湯", sortOrder: 20 },
    { id: "recommended-set", name: "🐉🌟おすすめ麻辣湯セット", sortOrder: 30 }
  ];
  for (const category of menuCategories) {
    await upsertCategory({
      brandId: brand.id,
      externalId: `maamaa-${category.id}`,
      name: category.name,
      sortOrder: category.sortOrder
    });
  }
  const categoryNameById = new Map(menuCategories.map((category) => [category.id, category.name]));

  const baseSoupName = splitPromotionPrefix(menu.baseSoup.name);
  const itemId = await upsertItem({
    brandId: brand.id,
    sourceId,
    externalId: menu.baseSoup.id,
    itemKind: "buildable_product",
    promotionPrefix: baseSoupName.promotionPrefix,
    name: baseSoupName.name,
    category: categoryNameById.get("base-soup") ?? "🌶️旨味ベースの特別仕立てスープ",
    description: menu.baseSoup.note ?? "",
    descriptionDisplayNames: displayNamesFor(menu.baseSoup.note ?? "", dictionaries),
    imageUrl: "",
    basePrice: menu.baseSoup.price ?? null,
    displayNames: {
      ...displayNamesFor(menu.baseSoup.name, dictionaries),
      ...(menu.baseSoup.displayNames ?? {})
    },
    variableSchema: {
      source: "maamaa-malatang-menu",
      buildable: true,
      posWeightPricing: {
        mode: "weight",
        unit: "g",
        unitPrice: menu.baseSoup.posWeightPricing?.unitPrice ?? menu.baseSoup.pricePerGram ?? null
      },
      baseSoup: menu.baseSoup,
      presetSoups: menu.presetSoups ?? [],
      optionGroupKeys: [
        "medicinal-spice",
        "heat",
        "numb",
        "special-flavor",
        "noodle-replacement",
        ...menu.menuSections.map((section) => section.id)
      ]
    },
    sortOrder: 10,
    isActive: true
  });

  for (const [index, preset] of (menu.presetSoups ?? []).entries()) {
    const presetName = splitPromotionPrefix(preset.name);
    await upsertItem({
      brandId: brand.id,
      sourceId,
      externalId: preset.id,
      itemKind: "fixed_product",
      promotionPrefix: presetName.promotionPrefix,
      name: presetName.name,
      category: categoryNameById.get(preset.category) ?? "🐉🌟おすすめ麻辣湯セット",
      description: preset.note ?? "",
      descriptionDisplayNames: displayNamesFor(preset.note ?? "", dictionaries),
      imageUrl: "",
      basePrice: preset.price ?? null,
      displayNames: {
        ...displayNamesFor(preset.name, dictionaries),
        ...(preset.displayNames ?? {})
      },
      variableSchema: {
        source: "maamaa-malatang-menu",
        preset: true,
        parentProductId: menu.baseSoup.id,
        defaultNoodle: preset.defaultNoodle ?? "板春雨"
      },
      sortOrder: 20 + index * 10,
      isActive: true
    });
  }

  const fixedGroups = [
    { key: "medicinal-spice", name: "薬膳スパイス", type: "single", choices: menu.medicinalSpiceOptions, affectsProcedure: true, ruleJson: { source: "maamaa", defaultChoice: menu.medicinalSpiceOptions[0]?.id, minSelections: 1, maxSelections: 1, allowRepeat: false, perOptionMax: 1, optionValueType: "id" } },
    { key: "heat", name: "辛さ", type: "single", choices: menu.heatLevels, affectsProcedure: true, ruleJson: { source: "maamaa", defaultChoice: "normal", minSelections: 1, maxSelections: 1, allowRepeat: false, perOptionMax: 1, optionValueType: "id" } },
    { key: "numb", name: "痺れ", type: "single", choices: menu.numbLevels, affectsProcedure: true, ruleJson: { source: "maamaa", defaultChoice: "tiny", minSelections: 1, maxSelections: 1, allowRepeat: false, perOptionMax: 1, optionValueType: "id" } },
    { key: "special-flavor", name: "味変・追加調味", type: "multiple", choices: menu.specialFlavors, affectsProcedure: true, ruleJson: { source: "maamaa", limit: 6, minSelections: 0, maxSelections: 6, allowRepeat: false, perOptionMax: 1, optionValueType: "id" } },
    { key: "noodle-replacement", name: "麺の種類を変更する", type: "quantity", choices: menu.noodleReplacementOptions, affectsProcedure: true, ruleJson: { source: "maamaa", limit: menu.noodleReplacementRule.limit, minSelections: 0, maxSelections: menu.noodleReplacementRule.limit, allowRepeat: true, perOptionMax: menu.noodleReplacementRule.perOptionMax, optionValueType: "id" } }
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
      displayNames: displayNamesFor(group.name, dictionaries),
      sortOrder: (index + 1) * 10
    });
    await upsertOptions(groupId, group.choices, { affectsProcedure: group.affectsProcedure, dictionaries });
    groupCount += 1;
    console.log(`[maamaa] imported option group ${group.key} (${group.choices.length} options)`);
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
      ruleJson: {
        source: "maamaa",
        limit: section.limit,
        minSelections: 0,
        maxSelections: section.limit,
        allowRepeat: section.perOptionMax > 1,
        perOptionMax: section.perOptionMax,
        optionValueType: "id"
      },
      displayNames: displayNamesFor(section.title, dictionaries),
      sortOrder: 100 + (index + 1) * 10
    });
    await upsertOptions(groupId, section.items, { affectsProcedure: true, dictionaries });
    groupCount += 1;
    optionCount += section.items.length;
    console.log(`[maamaa] imported menu section ${section.id} (${section.items.length} options)`);
  }

  if (pruneMissing) {
    // These reviewed delivery-only groups are owned by the Uber catalog
    // importer. A website-menu refresh must not deactivate them.
    const supplementalGroupKeys = [
      "cold-pack",
      "cold-noodles",
      "featured-quail",
      "extra-beef-tendon",
      "extra-pork-cartilage"
    ];
    const activeGroupKeys = [
      ...fixedGroups.map((group) => group.key),
      ...menu.menuSections.map((section) => section.id),
      ...supplementalGroupKeys
    ];
    await sql`
      update menu_option_groups
      set is_active = false, updated_at = now()
      where brand_id = ${brand.id}
        and group_key not in (
          select jsonb_array_elements_text(${JSON.stringify(activeGroupKeys)}::jsonb)
        )
        and is_active = true
    `;
  }

  return { brand: brand.name, items: 1 + (menu.presetSoups?.length ?? 0), groups: groupCount, options: optionCount };
}

const results = [];
if (!selectedBrand || selectedBrand === "nanacha") results.push(await importNanacha());
if (!selectedBrand || selectedBrand === "maamaa") results.push(await importMaamaa());

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
process.exit(0);
