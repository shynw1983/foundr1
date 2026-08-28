import { neon } from "@neondatabase/serverless";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

const args = process.argv.slice(2);
const snapshotIndex = args.indexOf("--snapshot");
const snapshotPath = resolve(snapshotIndex >= 0 ? String(args[snapshotIndex + 1] || "") : "");
const apply = args.includes("--apply");
const expectedStoreId = "ed6c3b1f-e68a-4cbd-92e2-06a800eb7183";
const expectedUberMenuId = "d6205da2-b809-531c-a7b2-d9cf505cf1c0";
const preferredGroupKeys = new Map([
  ["薬膳の有無を選ぶ", "medicinal-spice"],
  ["【桁違いの風味の良さ🌶️】🔥辛さレベルをお選びください（希少で高価なジョロキア唐辛子使用🔥）", "heat"],
  ["【高級花椒】⚡️痺れレベルをお選びください", "numb"],
  ["🌶️スペシャルな味変をお楽しみください👑", "special-flavor"],
  ["🍜麺の種類を変更する", "noodle-replacement"],
  ["🍜麺の種類を選ぶ", "noodles"],
  ["🟢ベーシックトッピング", "base"],
  ["⚪️スタンダードトッピング", "standard"],
  ["💎プレミアムトッピング", "premium"],
  ["👑VIPトッピング", "vip"],
  ["🏆️ロイヤルVIPトッピング", "royal-vip"],
  ["【リクエスト制👑】お客様の推しトッピング😍", "request"],
  ["【王道で最強💪悪魔的ペアリング😈🥤💞汗だくからの大復活✨️】冷え冷えコーラ", "drink"],
  ["⏳限定トッピング", "limited"],
  ["🧊 極冷を保つために", "cold-pack"],
  ["🍜冷やし麺の種類を選ぶ", "cold-noodles"],
  ["みんなが選ぶ！人気具材の山盛り", "featured-quail"],
  ["とろとろ牛すじを追加する", "extra-beef-tendon"],
  ["とろとろ豚軟骨を追加する", "extra-pork-cartilage"],
  ["🌶️唐辛子をかける", "chili-sprinkle"],
  ["気になる一品（無料）", "free-curiosity"],
  ["最低注文金額について", "minimum-order-info"],
  ["辛さレベル", "heat-level"],
  ["フルーツフレーバー🫐🍊🥭", "fruit-flavor"],
  ["ねぎを追加する", "extra-green-onion"],
  ["スープを選ぶ", "soup-selection"]
]);

if (!snapshotPath) throw new Error("Usage: node scripts/sync-maamaa-uber-authoritative.mjs --snapshot <getMenuData.json> [--apply]");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const raw = JSON.parse(await readFile(snapshotPath, "utf8"));
const deliveryMapping = raw?.data?.menuMapping?.find((entry) => entry?.menuType === "MENU_TYPE_FULFILLMENT_DELIVERY");
const menuId = String(deliveryMapping?.menuUUID ?? "");
const menu = raw?.data?.menus?.[menuId];
if (!menu || menuId !== expectedUberMenuId) throw new Error(`Unexpected Uber delivery menu: ${menuId || "missing"}`);

const money = (value) => {
  const low = Number(value?.low ?? 0);
  const high = Number(value?.high ?? 0);
  return (high * 4294967296 + low) / 100;
};
const websitePrice = (uberPrice) => Math.round((Number(uberPrice) * 0.8) / 10) * 10;
const textValue = (value) => String(value?.defaultValue ?? "").trim();
const splitLocalizedName = (value) => {
  const [ja = "", zh = "", ko = "", en = ""] = String(value ?? "").split("｜").map((part) => part.trim());
  return { ja, localized: Object.fromEntries(Object.entries({ zh, ko, en }).filter(([, text]) => text)) };
};
const splitPromotionPrefix = (value) => {
  const match = String(value ?? "").trim().match(/^((?:【[^】]+】)+)\s*(.+)$/u);
  return match ? { prefix: match[1], name: match[2] } : { prefix: "", name: String(value ?? "").trim() };
};
const normalize = (value) => String(value ?? "")
  .split(/[|｜]/u)[0]
  .normalize("NFKC")
  .replace(/【[^】]*】|\[[^\]]*\]/gu, "")
  .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu, "")
  .replace(/[^\p{L}\p{N}]+/gu, "")
  .toLocaleLowerCase();
const keyify = (value, prefix) => {
  const ascii = String(value ?? "").normalize("NFKD").toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return ascii || `${prefix}-${randomUUID().slice(0, 8)}`;
};
const availability = (item) => {
  const until = String(item?.suspensionInfo?.defaultValue?.suspendUntilMilliseconds ?? "");
  const unavailable = Boolean(until && Number.isFinite(Date.parse(until)) && Date.parse(until) > Date.now());
  return { isAvailable: !unavailable, suspendUntil: unavailable ? until : null };
};
const imageUrl = (item) => String(item?.itemInfo?.image?.imageURL ?? item?.itemInfo?.image?.rawImageURL ?? "").trim();
const priceFor = (item) => money(item?.paymentInfo?.priceInfo?.defaultValue?.price);

const subsectionOrder = [];
for (const section of menu.sections ?? []) {
  for (const subsectionId of section.subsectionUUIDs ?? []) {
    if (!subsectionOrder.includes(subsectionId)) subsectionOrder.push(subsectionId);
  }
}
const categories = subsectionOrder.map((id, index) => {
  const subsection = menu.subsectionsMap?.[id];
  if (!subsection) throw new Error(`Missing Uber category ${id}`);
  return { uberId: id, name: textValue(subsection.title), sortOrder: (index + 1) * 10, productIds: (subsection.displayItems ?? []).map((entry) => String(entry.uuid)) };
});
const productIds = [...new Set(categories.flatMap((category) => category.productIds))];
const groupMap = menu.entities?.customizationsMap ?? {};
const itemMap = menu.entities?.itemsMap ?? {};
const groups = Object.values(groupMap).map((group, index) => {
  const title = textValue(group.title);
  const quantity = group.quantityInfo?.defaultValue ?? {};
  const minSelections = Number(quantity.minPermitted ?? 0);
  const maxSelections = Number(quantity.maxPermitted ?? 1);
  return {
    uberId: String(group.uuid),
    title,
    preferredKey: preferredGroupKeys.get(title) ?? keyify(title, "uber-group"),
    sortOrder: (index + 1) * 10,
    minSelections,
    maxSelections,
    selectionType: maxSelections > 1 ? "quantity" : minSelections === 1 ? "single" : "multiple",
    optionIds: (group.options ?? []).map((entry) => String(entry.uuid))
  };
});
const optionIds = [...new Set(groups.flatMap((group) => group.optionIds))];
const referencedIds = new Set([...productIds, ...optionIds]);
const orphanIds = Object.keys(itemMap).filter((id) => !referencedIds.has(id));
if (categories.length < 10 || productIds.length < 20 || groups.length < 20 || optionIds.length < 150) {
  throw new Error(`Uber snapshot is incomplete: categories=${categories.length}, products=${productIds.length}, groups=${groups.length}, options=${optionIds.length}`);
}
for (const id of referencedIds) if (!itemMap[id]) throw new Error(`Missing Uber item entity ${id}`);

const brandRows = await sql`select id::text from brands where name = ${"まぁ麻"} and status = 'active' limit 1`;
const brandId = String(brandRows[0]?.id ?? "");
if (!brandId) throw new Error("まぁ麻 brand is missing");
const storeRows = await sql`
  select stores.id::text, stores.name
  from stores join store_brands on store_brands.store_id = stores.id
  where store_brands.brand_id = ${brandId} and stores.id::text = ${expectedStoreId} and stores.status = 'active'
`;
if (!storeRows[0]) throw new Error("The configured Uber store is not linked to まぁ麻");

const [existingCategories, existingItems, existingGroups, existingOptions, platformRows, sourceRows] = await Promise.all([
  sql`select id::text, coalesce(external_id, '') as "externalId", name from menu_categories where brand_id = ${brandId} and store_id is null`,
  sql`select id::text, coalesce(external_id, '') as "externalId", item_kind as "itemKind", promotion_prefix as "promotionPrefix", promotion_prefix_display_names as "promotionPrefixDisplayNames", name, display_names as "displayNames", category, coalesce(description, '') as description, description_display_names as "descriptionDisplayNames", coalesce(image_url, '') as "imageUrl", base_price::float as "basePrice", variable_schema as "variableSchema", is_active as "isActive" from menu_catalog_items where brand_id = ${brandId} and store_id is null`,
  sql`select id::text, coalesce(external_id, '') as "externalId", group_key as "groupKey", name, display_names as "displayNames", selection_type as "selectionType", rule_json as "ruleJson", is_active as "isActive" from menu_option_groups where brand_id = ${brandId}`,
  sql`select options.id::text, options.option_group_id::text as "groupId", coalesce(options.external_id, '') as "externalId", options.option_key as "optionKey", options.name, options.display_names as "displayNames", coalesce(options.image_url, '') as "imageUrl", options.is_active as "isActive" from menu_options options join menu_option_groups groups on groups.id = options.option_group_id where groups.brand_id = ${brandId}`,
  sql`select id::text from menu_external_platforms where brand_id = ${brandId} and store_id is null and platform_key = 'uber_eats' limit 1`,
  sql`select id::text from menu_sources where brand_id = ${brandId} and store_id is null and source_type = 'uber_eats' order by updated_at desc limit 1`
]);
const externalPlatformId = String(platformRows[0]?.id ?? "");
if (!externalPlatformId) throw new Error("Uber Eats platform config is missing");
const sourceId = String(sourceRows[0]?.id ?? randomUUID());
const [existingMappings, existingTargetSettings] = await Promise.all([
  sql`select target_type as "targetType", target_id::text as "targetId", external_id as "externalId" from menu_platform_object_mappings where external_platform_id = ${externalPlatformId}`,
  sql`select target_type as "targetType", target_id::text as "targetId", placement_config as "placementConfig" from menu_platform_target_settings where external_platform_id = ${externalPlatformId}`
]);
const mappingByExternal = new Map(existingMappings.map((row) => [`${row.targetType}:${row.externalId}`, row.targetId]));
const placementByTarget = new Map(existingTargetSettings.map((row) => [`${row.targetType}:${row.targetId}`, row.placementConfig ?? {}]));

const takeExisting = (candidateTiers, used, description) => {
  for (const tier of candidateTiers) {
    const unique = [...new Map((Array.isArray(tier) ? tier : [tier]).filter(Boolean).map((row) => [row.id, row])).values()]
      .filter((row) => !used.has(row.id));
    if (unique.length > 1) throw new Error(`Ambiguous OS match for ${description}: ${unique.map((row) => row.id).join(",")}`);
    const chosen = unique[0] ?? null;
    if (chosen) {
      used.add(chosen.id);
      return chosen;
    }
  }
  return null;
};
const usedCategoryIds = new Set();
const desiredCategories = categories.map((category) => {
  const mappedId = mappingByExternal.get(`category:${category.uberId}`);
  const existing = takeExisting([
    existingCategories.find((row) => row.id === mappedId),
    existingCategories.find((row) => row.externalId === category.uberId),
    existingCategories.filter((row) => normalize(row.name) === normalize(category.name))
  ], usedCategoryIds, `category ${category.name}`);
  return { ...category, id: existing?.id ?? randomUUID() };
});
const categoryByUberId = new Map(desiredCategories.map((category) => [category.uberId, category]));
const categoryForProduct = new Map(desiredCategories.flatMap((category) => category.productIds.map((id) => [id, category])));

const usedGroupIds = new Set();
const desiredGroups = groups.map((group) => {
  const mappedId = mappingByExternal.get(`option_group:${group.uberId}`);
  const existing = takeExisting([
    existingGroups.find((row) => row.id === mappedId),
    existingGroups.find((row) => row.externalId === group.uberId),
    existingGroups.find((row) => row.groupKey === group.preferredKey),
    existingGroups.filter((row) => normalize(row.name) === normalize(group.title))
  ], usedGroupIds, `group ${group.title}`);
  return { ...group, id: existing?.id ?? randomUUID(), groupKey: existing?.groupKey ?? group.preferredKey, existing };
});
const groupByUberId = new Map(desiredGroups.map((group) => [group.uberId, group]));

const usedItemIds = new Set();
const desiredItems = productIds.map((uberId, index) => {
  const item = itemMap[uberId];
  const title = splitLocalizedName(textValue(item.itemInfo?.title));
  const japanese = splitPromotionPrefix(title.ja);
  const category = categoryForProduct.get(uberId);
  const mappedId = mappingByExternal.get(`item:${uberId}`);
  const sourceMatch = existingItems.find((row) => String(row.variableSchema?.sourceProductId ?? "") === uberId);
  const candidateTiers = [
    existingItems.find((row) => row.id === mappedId),
    sourceMatch,
    existingItems.filter((row) => normalize(`${row.promotionPrefix}${row.name}`) === normalize(title.ja)),
    existingItems.filter((row) => normalize(row.name) === normalize(japanese.name) && (!category || normalize(row.category) === normalize(category.name)))
  ];
  const existing = takeExisting(candidateTiers, usedItemIds, `item ${title.ja}`);
  const uberPrice = priceFor(item);
  const status = availability(item);
  const customizationIds = item.customizationUUIDs?.defaultValue ?? [];
  return {
    uberId, id: existing?.id ?? randomUUID(), existing, rawTitle: textValue(item.itemInfo?.title), name: japanese.name,
    promotionPrefix: japanese.prefix, localized: { ...(existing?.displayNames ?? {}), ...title.localized },
    description: textValue(item.itemInfo?.description), imageUrl: imageUrl(item), uberPrice,
    basePrice: websitePrice(uberPrice), category, sortOrder: (index + 1) * 10, status,
    customizationIds: customizationIds.map(String),
    itemKind: existing?.itemKind ?? (customizationIds.length ? "buildable_product" : uberPrice === 0 ? "information" : "fixed_product")
  };
});
const itemByUberId = new Map(desiredItems.map((item) => [item.uberId, item]));

const usedOptionIds = new Set();
const desiredOptions = [];
for (const group of desiredGroups) {
  const existingInGroup = existingOptions.filter((option) => option.groupId === group.id);
  for (const [index, uberId] of group.optionIds.entries()) {
    const item = itemMap[uberId];
    const title = splitLocalizedName(textValue(item.itemInfo?.title));
    const mappedId = mappingByExternal.get(`option:${uberId}`);
    const existing = takeExisting([
      existingOptions.find((row) => row.id === mappedId),
      existingOptions.find((row) => row.externalId === uberId),
      existingInGroup.filter((row) => normalize(row.name) === normalize(title.ja))
    ], usedOptionIds, `option ${group.title}/${title.ja}`);
    const uberPrice = priceFor(item);
    desiredOptions.push({
      uberId, id: existing?.id ?? randomUUID(), existing, groupId: group.id, groupUberId: group.uberId,
      optionKey: existing?.optionKey ?? keyify(title.ja, "uber-option"), rawTitle: textValue(item.itemInfo?.title),
      name: title.ja, localized: { ...(existing?.displayNames ?? {}), ...title.localized }, imageUrl: imageUrl(item),
      uberPrice, basePrice: websitePrice(uberPrice), sortOrder: (index + 1) * 10, status: availability(item)
    });
  }
}
const reservedOptionKeys = new Map();
for (const option of existingOptions) {
  if (!reservedOptionKeys.has(option.groupId)) reservedOptionKeys.set(option.groupId, new Map());
  reservedOptionKeys.get(option.groupId).set(option.optionKey, option.id);
}
const assignedOptionKeys = new Map();
for (const option of desiredOptions) {
  if (!assignedOptionKeys.has(option.groupId)) assignedOptionKeys.set(option.groupId, new Set());
  const assigned = assignedOptionKeys.get(option.groupId);
  const reservedBy = reservedOptionKeys.get(option.groupId)?.get(option.optionKey);
  if ((reservedBy && reservedBy !== option.id) || assigned.has(option.optionKey)) {
    option.optionKey = `uber-${option.uberId.slice(0, 12)}`;
  }
  while (assigned.has(option.optionKey) || (reservedOptionKeys.get(option.groupId)?.has(option.optionKey) && reservedOptionKeys.get(option.groupId).get(option.optionKey) !== option.id)) {
    option.optionKey = `uber-${option.uberId}`;
  }
  assigned.add(option.optionKey);
}
const optionByUberId = new Map(desiredOptions.map((option) => [option.uberId, option]));

const capturedAt = String(menu.updatedAt ?? new Date().toISOString());
const snapshot = {
  source: "uber_getMenuData",
  menuId,
  capturedAt,
  complete: true,
  missingTargets: [],
  items: desiredItems.map((item) => ({
    targetId: item.id, externalId: item.uberId, externalParentId: item.category?.uberId ?? "", name: item.rawTitle,
    price: item.uberPrice, sourceBasePrice: item.basePrice, isActive: true,
    metadata: { isAvailable: item.status.isAvailable, suspendUntil: item.status.suspendUntil, category: item.category?.name ?? "" }
  })),
  options: desiredOptions.map((option) => ({
    targetId: option.id, externalId: option.uberId, externalParentId: option.groupUberId, name: option.rawTitle,
    price: option.uberPrice, sourceBasePrice: option.basePrice, isActive: true,
    metadata: { isAvailable: option.status.isAvailable, suspendUntil: option.status.suspendUntil, group: groupByUberId.get(option.groupUberId)?.title ?? "" }
  }))
};
const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
const activeItemIds = new Set(desiredItems.map((item) => item.id));
const activeGroupIds = new Set(desiredGroups.map((group) => group.id));
const activeOptionIds = new Set(desiredOptions.map((option) => option.id));
const summary = {
  mode: apply ? "apply" : "dry-run",
  source: { menuId, capturedAt, storeId: expectedStoreId, storeName: storeRows[0].name },
  uber: { categories: desiredCategories.length, products: desiredItems.length, groups: desiredGroups.length, options: desiredOptions.length, productGroupBindings: desiredItems.reduce((sum, item) => sum + item.customizationIds.length, 0), unavailableProducts: desiredItems.filter((item) => !item.status.isAvailable).length, unavailableOptions: desiredOptions.filter((item) => !item.status.isAvailable).length, ignoredOrphans: orphanIds.length },
  changes: {
    createCategories: desiredCategories.filter((row) => !existingCategories.some((old) => old.id === row.id)).length,
    createProducts: desiredItems.filter((row) => !row.existing).length,
    createGroups: desiredGroups.filter((row) => !row.existing).length,
    createOptions: desiredOptions.filter((row) => !row.existing).length,
    deactivateProducts: existingItems.filter((row) => row.isActive && !activeItemIds.has(row.id)).length,
    deactivateGroups: existingGroups.filter((row) => row.isActive && !activeGroupIds.has(row.id)).length,
    deactivateOptions: existingOptions.filter((row) => row.isActive && !activeOptionIds.has(row.id)).length
  }
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const backupPath = `/private/tmp/foundr1-maamaa-before-uber-sync-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const backupTables = {};
for (const [name, query] of Object.entries({
  categories: sql`select * from menu_categories where brand_id = ${brandId}`,
  items: sql`select * from menu_catalog_items where brand_id = ${brandId}`,
  groups: sql`select * from menu_option_groups where brand_id = ${brandId}`,
  options: sql`select options.* from menu_options options join menu_option_groups groups on groups.id = options.option_group_id where groups.brand_id = ${brandId}`,
  bindings: sql`select links.* from menu_catalog_item_option_groups links join menu_catalog_items items on items.id = links.menu_catalog_item_id where items.brand_id = ${brandId}`,
  itemStoreSettings: sql`select settings.* from menu_store_settings settings where settings.brand_id = ${brandId}`,
  optionStoreSettings: sql`select settings.* from menu_option_store_settings settings where settings.brand_id = ${brandId}`,
  targetSettings: sql`select settings.* from menu_platform_target_settings settings where settings.brand_id = ${brandId}`,
  mappings: sql`select mappings.* from menu_platform_object_mappings mappings where mappings.brand_id = ${brandId}`
})) backupTables[name] = await query;
await writeFile(backupPath, JSON.stringify({ createdAt: new Date().toISOString(), brandId, ...backupTables }, null, 2));

const categoryPayload = JSON.stringify(desiredCategories.map((row) => ({ id: row.id, externalId: row.uberId, name: row.name, sortOrder: row.sortOrder })));
const itemPayload = JSON.stringify(desiredItems.map((row) => ({
  id: row.id, externalId: row.existing?.externalId || `uber-${row.uberId}`, itemKind: row.itemKind,
  promotionPrefix: row.promotionPrefix, promotionPrefixDisplayNames: row.existing?.promotionPrefixDisplayNames ?? {},
  name: row.name, displayNames: row.localized, category: row.category?.name ?? "", description: row.description,
  descriptionDisplayNames: row.existing?.descriptionDisplayNames ?? {}, imageUrl: row.imageUrl, basePrice: row.basePrice,
  variableSchema: { ...(row.existing?.variableSchema ?? {}), source: "uber-eats-menu-maker", sourceStoreId: menuId, sourceProductId: row.uberId, sourceCapturedAt: capturedAt, categoryId: row.category?.uberId ?? "", customizationGroupIds: row.customizationIds, customizationGroupKeys: row.customizationIds.map((id) => groupByUberId.get(id)?.groupKey).filter(Boolean), uberPrice: row.uberPrice, websitePrice: row.basePrice },
  sortOrder: row.sortOrder
})));
const groupPayload = JSON.stringify(desiredGroups.map((row) => ({
  id: row.id, externalId: row.uberId, groupKey: row.groupKey, name: row.title, displayNames: row.existing?.displayNames ?? {},
  selectionType: row.selectionType, ruleJson: { ...(row.existing?.ruleJson ?? {}), source: "uber-eats-menu-maker", minSelections: row.minSelections, maxSelections: row.maxSelections, limit: row.maxSelections, perOptionMax: row.maxSelections, allowRepeat: row.maxSelections > 1 }, sortOrder: row.sortOrder
})));
const optionPayload = JSON.stringify(desiredOptions.map((row) => ({ id: row.id, groupId: row.groupId, externalId: row.uberId, optionKey: row.optionKey, name: row.name, displayNames: row.localized, imageUrl: row.imageUrl, priceDelta: row.basePrice, sortOrder: row.sortOrder })));
const bindingPayload = JSON.stringify(desiredItems.flatMap((item) => item.customizationIds.map((groupUberId, index) => ({ itemId: item.id, groupId: groupByUberId.get(groupUberId)?.id, sortOrder: (index + 1) * 10 })).filter((row) => row.groupId)));
const itemAvailabilityPayload = JSON.stringify(desiredItems.map((row) => ({ targetId: row.id, isAvailable: row.status.isAvailable, statusNote: row.status.isAvailable ? "Uber 同期: 販売中" : `Uber 同期: 売り切れ（${row.status.suspendUntil}まで）` })));
const optionAvailabilityPayload = JSON.stringify(desiredOptions.map((row) => ({ targetId: row.id, isAvailable: row.status.isAvailable, statusNote: row.status.isAvailable ? "Uber 同期: 販売中" : `Uber 同期: 売り切れ（${row.status.suspendUntil}まで）` })));
const targetSettingsPayload = JSON.stringify([
  ...desiredCategories.map((row) => ({ targetType: "category", targetId: row.id, name: row.name, price: null, description: "", externalId: row.uberId })),
  ...desiredItems.map((row) => ({ targetType: "item", targetId: row.id, name: row.rawTitle, price: row.uberPrice, description: row.description, externalId: row.uberId })),
  ...desiredGroups.map((row) => ({ targetType: "option_group", targetId: row.id, name: row.title, price: null, description: "", externalId: row.uberId })),
  ...desiredOptions.map((row) => ({ targetType: "option", targetId: row.id, name: row.rawTitle, price: row.uberPrice, description: "", externalId: row.uberId }))
].map((row) => ({ ...row, placementConfig: { ...(placementByTarget.get(`${row.targetType}:${row.targetId}`) ?? {}), useExactNameOverride: true, authoritativeSource: "uber_eats", sourceCapturedAt: capturedAt } })));
const mappingPayload = JSON.stringify([
  ...desiredCategories.map((row) => ({ targetType: "category", targetId: row.id, externalId: row.uberId, parentId: menuId, name: row.name, state: { name: row.name, sortOrder: row.sortOrder } })),
  ...snapshot.items.map((row) => ({ targetType: "item", targetId: row.targetId, externalId: row.externalId, parentId: row.externalParentId, name: row.name, state: row })),
  ...desiredGroups.map((row) => ({ targetType: "option_group", targetId: row.id, externalId: row.uberId, parentId: menuId, name: row.title, state: { name: row.title, minSelections: row.minSelections, maxSelections: row.maxSelections } })),
  ...snapshot.options.map((row) => ({ targetType: "option", targetId: row.targetId, externalId: row.externalId, parentId: row.externalParentId, name: row.name, state: row }))
]);
const candidatePayload = JSON.stringify([
  ...snapshot.items.map((row) => ({ targetType: "item", targetId: row.targetId, externalId: row.externalId, parentId: row.externalParentId, name: row.name, observed: row })),
  ...snapshot.options.map((row) => ({ targetType: "option", targetId: row.targetId, externalId: row.externalId, parentId: row.externalParentId, name: row.name, observed: row }))
]);

const queries = [
  sql`insert into menu_sources (id, brand_id, store_id, name, source_type, source_url, status, last_synced_at, updated_at) values (${sourceId}, ${brandId}, null, ${"まぁ麻 Uber Eats メニュー"}, 'uber_eats', ${`uber-eats:${menuId}`}, 'active', now(), now()) on conflict (id) do update set source_url=excluded.source_url, status='active', last_synced_at=now(), updated_at=now()`,
  sql`with rows as (select * from jsonb_to_recordset(${categoryPayload}::jsonb) as x(id uuid, "externalId" text, name text, "sortOrder" int)) insert into menu_categories (id,brand_id,store_id,external_id,name,note,sort_order,updated_at) select id,${brandId},null,"externalId",name,'',"sortOrder",now() from rows on conflict (id) do update set external_id=excluded.external_id,name=excluded.name,sort_order=excluded.sort_order,updated_at=now()`,
  sql`delete from menu_categories where brand_id=${brandId} and store_id is null and not (id = any(${desiredCategories.map((row) => row.id)}::uuid[]))`,
  sql`with rows as (select * from jsonb_to_recordset(${itemPayload}::jsonb) as x(id uuid,"externalId" text,"itemKind" text,"promotionPrefix" text,"promotionPrefixDisplayNames" jsonb,name text,"displayNames" jsonb,category text,description text,"descriptionDisplayNames" jsonb,"imageUrl" text,"basePrice" numeric,"variableSchema" jsonb,"sortOrder" int)) insert into menu_catalog_items (id,brand_id,store_id,menu_source_id,external_id,item_kind,promotion_prefix,promotion_prefix_display_names,name,display_names,category,description,description_display_names,image_url,base_price,variable_schema,sort_order,is_active,updated_at) select id,${brandId},null,${sourceId},"externalId","itemKind","promotionPrefix","promotionPrefixDisplayNames",name,"displayNames",category,description,"descriptionDisplayNames",nullif("imageUrl",''),"basePrice","variableSchema","sortOrder",true,now() from rows on conflict(id) do update set menu_source_id=excluded.menu_source_id,external_id=excluded.external_id,item_kind=excluded.item_kind,promotion_prefix=excluded.promotion_prefix,promotion_prefix_display_names=excluded.promotion_prefix_display_names,name=excluded.name,display_names=excluded.display_names,category=excluded.category,description=excluded.description,description_display_names=excluded.description_display_names,image_url=excluded.image_url,base_price=excluded.base_price,variable_schema=excluded.variable_schema,sort_order=excluded.sort_order,is_active=true,updated_at=now()`,
  sql`update menu_catalog_items set is_active=false,updated_at=now() where brand_id=${brandId} and store_id is null and not (id = any(${desiredItems.map((row) => row.id)}::uuid[]))`,
  sql`with rows as (select * from jsonb_to_recordset(${groupPayload}::jsonb) as x(id uuid,"externalId" text,"groupKey" text,name text,"displayNames" jsonb,"selectionType" text,"ruleJson" jsonb,"sortOrder" int)) insert into menu_option_groups (id,brand_id,menu_catalog_item_id,external_id,group_key,name,display_names,selection_type,affects_procedure,rule_json,sort_order,is_active,updated_at) select id,${brandId},null,"externalId","groupKey",name,"displayNames","selectionType",true,"ruleJson","sortOrder",true,now() from rows on conflict(id) do update set menu_catalog_item_id=null,external_id=excluded.external_id,group_key=excluded.group_key,name=excluded.name,display_names=excluded.display_names,selection_type=excluded.selection_type,rule_json=excluded.rule_json,sort_order=excluded.sort_order,is_active=true,updated_at=now()`,
  sql`update menu_option_groups set is_active=false,updated_at=now() where brand_id=${brandId} and not (id = any(${desiredGroups.map((row) => row.id)}::uuid[]))`,
  sql`with rows as (select * from jsonb_to_recordset(${optionPayload}::jsonb) as x(id uuid,"groupId" uuid,"externalId" text,"optionKey" text,name text,"displayNames" jsonb,"imageUrl" text,"priceDelta" numeric,"sortOrder" int)) insert into menu_options (id,option_group_id,external_id,option_key,name,display_names,image_url,price_delta,affects_procedure,sort_order,is_active,updated_at) select id,"groupId","externalId","optionKey",name,"displayNames",nullif("imageUrl",''),"priceDelta",true,"sortOrder",true,now() from rows on conflict(id) do update set option_group_id=excluded.option_group_id,external_id=excluded.external_id,option_key=excluded.option_key,name=excluded.name,display_names=excluded.display_names,image_url=excluded.image_url,price_delta=excluded.price_delta,sort_order=excluded.sort_order,is_active=true,updated_at=now()`,
  sql`update menu_options set is_active=false,updated_at=now() where id in (select options.id from menu_options options join menu_option_groups groups on groups.id=options.option_group_id where groups.brand_id=${brandId}) and not (id = any(${desiredOptions.map((row) => row.id)}::uuid[]))`,
  sql`delete from menu_catalog_item_option_groups where menu_catalog_item_id in (select id from menu_catalog_items where brand_id=${brandId})`,
  sql`with rows as (select * from jsonb_to_recordset(${bindingPayload}::jsonb) as x("itemId" uuid,"groupId" uuid,"sortOrder" int)) insert into menu_catalog_item_option_groups (menu_catalog_item_id,option_group_id,sort_order,is_active,updated_at) select "itemId","groupId","sortOrder",true,now() from rows`,
  sql`with rows as (select * from jsonb_to_recordset(${itemAvailabilityPayload}::jsonb) as x("targetId" uuid,"isAvailable" boolean,"statusNote" text)) insert into menu_store_settings (brand_id,store_id,menu_catalog_item_id,delivery_enabled,is_available,stock_status,status_note,updated_at) select ${brandId},${expectedStoreId},"targetId",true,"isAvailable",case when "isAvailable" then 'available' else 'unavailable' end,"statusNote",now() from rows on conflict(store_id,menu_catalog_item_id) do update set delivery_enabled=true,is_available=excluded.is_available,stock_status=excluded.stock_status,status_note=excluded.status_note,updated_at=now()`,
  sql`with rows as (select * from jsonb_to_recordset(${optionAvailabilityPayload}::jsonb) as x("targetId" uuid,"isAvailable" boolean,"statusNote" text)) insert into menu_option_store_settings (brand_id,store_id,menu_option_id,is_available,stock_status,status_note,updated_at) select ${brandId},${expectedStoreId},"targetId","isAvailable",case when "isAvailable" then 'available' else 'unavailable' end,"statusNote",now() from rows on conflict(store_id,menu_option_id) do update set is_available=excluded.is_available,stock_status=excluded.stock_status,status_note=excluded.status_note,updated_at=now()`,
  sql`delete from menu_platform_availability_settings where brand_id=${brandId} and store_id=${expectedStoreId} and platform='uber_eats'`,
  sql`with rows as (select * from jsonb_to_recordset(${JSON.stringify([...desiredItems.map((row) => ({ targetType: "item", targetId: row.id, isAvailable: row.status.isAvailable })), ...desiredOptions.map((row) => ({ targetType: "option", targetId: row.id, isAvailable: row.status.isAvailable }))])}::jsonb) as x("targetType" text,"targetId" uuid,"isAvailable" boolean)) insert into menu_platform_availability_settings (brand_id,store_id,target_kind,target_id,platform,availability,updated_at) select ${brandId},${expectedStoreId},"targetType","targetId",'uber_eats',case when "isAvailable" then 'available' else 'unavailable' end,now() from rows`,
  sql`with rows as (select * from jsonb_to_recordset(${targetSettingsPayload}::jsonb) as x("targetType" text,"targetId" uuid,name text,price numeric,description text,"externalId" text,"placementConfig" jsonb)) insert into menu_platform_target_settings (brand_id,store_id,external_platform_id,target_type,target_id,is_enabled,name_override,description_override,price_override,emoji_mode,placement_config,updated_at) select ${brandId},null,${externalPlatformId},"targetType","targetId",true,name,description,price,'follow',"placementConfig",now() from rows on conflict(external_platform_id,target_type,target_id) do update set is_enabled=true,name_override=excluded.name_override,description_override=excluded.description_override,price_override=excluded.price_override,placement_config=excluded.placement_config,updated_at=now()`,
  sql`delete from menu_platform_object_mappings where external_platform_id=${externalPlatformId}`,
  sql`with rows as (select * from jsonb_to_recordset(${mappingPayload}::jsonb) as x("targetType" text,"targetId" uuid,"externalId" text,"parentId" text,name text,state jsonb)) insert into menu_platform_object_mappings (brand_id,store_id,external_platform_id,target_type,target_id,external_id,external_parent_id,external_name,last_observed_state,last_verified_at,updated_at) select ${brandId},null,${externalPlatformId},"targetType","targetId","externalId","parentId",name,state,now(),now() from rows`,
  sql`update menu_platform_import_candidates set status='not_seen',adopted_target_id=null,resolved_at=null,updated_at=now() where external_platform_id=${externalPlatformId}`,
  sql`with rows as (select * from jsonb_to_recordset(${candidatePayload}::jsonb) as x("targetType" text,"targetId" uuid,"externalId" text,"parentId" text,name text,observed jsonb)) insert into menu_platform_import_candidates (brand_id,store_id,external_platform_id,target_type,external_id,external_parent_id,observed_name,observed_payload,status,adopted_target_id,last_seen_at,resolved_at,updated_at) select ${brandId},null,${externalPlatformId},"targetType","externalId","parentId",name,observed,'adopted',"targetId",now(),now(),now() from rows on conflict(external_platform_id,target_type,external_id) do update set external_parent_id=excluded.external_parent_id,observed_name=excluded.observed_name,observed_payload=excluded.observed_payload,status='adopted',adopted_target_id=excluded.adopted_target_id,last_seen_at=now(),resolved_at=now(),updated_at=now()`,
  sql`insert into menu_platform_snapshots (brand_id,store_id,external_platform_id,snapshot_type,rule_version,content_hash,payload,captured_at) values (${brandId},null,${externalPlatformId},'baseline','uber-v2',${hash},${JSON.stringify(snapshot)}::jsonb,now())`
];
await sql.transaction(queries);

console.log(JSON.stringify({ ...summary, backupPath, contentHash: hash }, null, 2));
