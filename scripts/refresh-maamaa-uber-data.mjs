import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rowsArgumentIndex = process.argv.indexOf("--rows");
const rowsPath = rowsArgumentIndex >= 0 ? resolve(String(process.argv[rowsArgumentIndex + 1] || "")) : "";
if (!rowsPath) throw new Error("Usage: node scripts/refresh-maamaa-uber-data.mjs --rows <uber-rows.json>");

const repoRoot = new URL("../", import.meta.url);
const mappingPath = new URL("../data/uber/maamaa-menu-mapping.json", import.meta.url);
const catalogPath = new URL("../data/uber/maamaa-catalog.json", import.meta.url);
const maamaaMenuPath = "/Users/wushengyin/Desktop/maamaa/src/data/malatang-menu.ts";

const input = JSON.parse(await readFile(rowsPath, "utf8"));
const rows = Array.isArray(input.rows) ? input.rows : [];
if (rows.length < 150) throw new Error(`Uber row snapshot is incomplete: ${rows.length}`);

const capturedAt = String(input.capturedAt || "2026-08-08");
const snapshotPath = new URL(`../data/uber/maamaa-menu-${capturedAt}.json`, import.meta.url);
const priceOf = (row) => Number(String(row?.price || "").replace(/[^0-9]/g, ""));
const websitePrice = (uberPrice) => Math.round((Number(uberPrice) * 0.8) / 10) * 10;
const splitLocalizedName = (value) => {
  const [name = "", zh = "", ko = "", en = ""] = String(value).split("｜").map((part) => part.trim());
  return {
    name,
    displayNames: Object.fromEntries(Object.entries({ zh, ko, en }).filter(([, text]) => text)),
  };
};
const normalizeName = (value, { stripWeight = false } = {}) => {
  let normalized = String(value || "").split("｜")[0].normalize("NFKC");
  if (stripWeight) normalized = normalized.replace(/(?:1人前)?約?\d+g/gi, "");
  return normalized
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\s【】\[\]()（）!！?？,，.。・:：〜～「」『』]/g, "")
    .toLowerCase();
};

const groupDefinitions = [
  { groupKey: "medicinal-spice", usage: "薬膳の有無を選ぶ" },
  { groupKey: "heat", usage: "【桁違いの風味の良さ🌶️】🔥辛さレベルをお選びください（希少で高価なジョロキア唐辛子使用🔥）" },
  { groupKey: "numb", usage: "【高級花椒】⚡️痺れレベルをお選びください" },
  { groupKey: "special-flavor", usage: "🌶️スペシャルな味変をお楽しみください👑" },
  { groupKey: "noodles", usage: "🍜麺の種類を選ぶ" },
  { groupKey: "noodle-replacement", usage: "🍜麺の種類を変更する", supplemental: true },
  { groupKey: "base", usage: "🟢ベーシックトッピング" },
  { groupKey: "standard", usage: "⚪️スタンダードトッピング" },
  { groupKey: "premium", usage: "💎プレミアムトッピング" },
  { groupKey: "vip", usage: "👑VIPトッピング" },
  { groupKey: "royal-vip", usage: "🏆️ロイヤルVIPトッピング" },
  { groupKey: "request", usage: "【リクエスト制👑】お客様の推しトッピング😍" },
  { groupKey: "drink", usage: "【王道で最強💪悪魔的ペアリング😈🥤💞汗だくからの大復活✨️】冷え冷えコーラ" },
  { groupKey: "limited", usage: "⏳限定トッピング" },
];
const excludedUberRows = new Set([
  "noodles:火锅宽粉",
  "noodles:紫薯年糕",
  "noodles:芝士年糕",
]);
const rowsByGroup = new Map(groupDefinitions.map((group) => [
  group.groupKey,
  rows.filter((row) => row.usage === group.usage && !excludedUberRows.has(`${group.groupKey}:${row.name}`)),
]));

const additions = [
  { groupKey: "base", optionKey: "plain-wonton", uberName: "ワンタン" },
  { groupKey: "base", optionKey: "soft-boiled-egg", uberName: "半熟味玉" },
  { groupKey: "base", optionKey: "shiitake-pork-meatball", uberName: "椎茸入り豚肉団子" },
  { groupKey: "base", optionKey: "chicken-cartilage-meatball", uberName: "軟骨入り鶏肉団子" },
  { groupKey: "premium", optionKey: "spicy-pollock-roe", uberName: "辛子明太子" },
  { groupKey: "noodles", optionKey: "hot-pot-wide-noodle", uberName: "火鍋板春雨" },
  { groupKey: "base", optionKey: "kelp-knots-3", uberName: "昆布結び3個" },
  { groupKey: "base", optionKey: "shredded-tofu-skin", uberName: "豆腐皮の細切り" },
  { groupKey: "standard", optionKey: "half-onion", uberName: "玉ねぎ1/2個" },
  { groupKey: "premium", optionKey: "large-peeled-shrimp", uberName: "むき海老（大）" },
  { groupKey: "premium", optionKey: "chicken-thigh", uberName: "鶏もも肉" },
  { groupKey: "vip", optionKey: "random-vegetable-trio", uberName: "おまかせ野菜3種盛り" },
  { groupKey: "vip", optionKey: "tofu-products-trio", uberName: "大豆製品3種盛り" },
  { groupKey: "vip", optionKey: "gout-seafood-five", uberName: "痛風海鮮5種盛り" },
];

const replacements = [
  { optionKey: "plain-wonton", fromGroupKey: "base", toGroupKey: "base", uberName: "海老ワンタン" },
  { optionKey: "beef-slice", fromGroupKey: "standard", toGroupKey: "premium", uberName: "【厳選】牛肉スライス(1人前約50g)" },
  { optionKey: "frankfurt", fromGroupKey: "vip", toGroupKey: "vip", uberName: "【数量限定𓃟】糸島豚の特大フランクフルト半本" },
  { optionKey: "seafood-set", fromGroupKey: "vip", toGroupKey: "vip", uberName: "特選海鮮3種盛り👑（大えび1匹、ほたて1個、ヤリイカリング約50g）" },
];

const displayNameOverrides = new Map([
  ["seafood-set", {
    zh: "精选三种海鲜拼盘（大虾1只、扇贝1个、枪乌贼圈约50克）",
    ko: "특선 해산물 3종 모둠 (왕새우 1마리, 가리비 1개, 한치 링 약 50g)",
    en: "Premium Seafood Trio (1 King Prawn, 1 Scallop, Approx. 50g Spear Squid Rings)",
  }],
]);

const mapping = JSON.parse(await readFile(mappingPath, "utf8"));
mapping.source.capturedAt = capturedAt;
mapping.source.pricingRule = { multiplier: 0.8, roundingUnit: 10 };

for (const replacement of replacements) {
  const fromGroup = mapping.groups.find((group) => group.groupKey === replacement.fromGroupKey);
  const toGroup = mapping.groups.find((group) => group.groupKey === replacement.toGroupKey);
  if (!fromGroup || !toGroup) throw new Error(`Missing replacement group for ${replacement.optionKey}`);
  let option = toGroup.options.find((entry) => entry.optionKey === replacement.optionKey);
  if (!option) {
    const optionIndex = fromGroup.options.findIndex((entry) => entry.optionKey === replacement.optionKey);
    if (optionIndex < 0) throw new Error(`Missing replacement option: ${replacement.optionKey}`);
    [option] = fromGroup.options.splice(optionIndex, 1);
    toGroup.options.push(option);
  } else if (fromGroup !== toGroup) {
    fromGroup.options = fromGroup.options.filter((entry) => entry.optionKey !== replacement.optionKey);
  }
  option.name = replacement.uberName;
  option.uberName = replacement.uberName;
}

const rowForMappedOption = (groupKey, option) => {
  const candidates = rowsByGroup.get(groupKey) || [];
  const exactKeys = new Set([normalizeName(option.uberName), normalizeName(option.name)]);
  const exact = candidates.filter((row) => exactKeys.has(normalizeName(row.name)));
  if (exact.length === 1) return exact[0];
  const softKeys = new Set([
    normalizeName(option.uberName, { stripWeight: true }),
    normalizeName(option.name, { stripWeight: true }),
  ]);
  const soft = candidates.filter((row) => softKeys.has(normalizeName(row.name, { stripWeight: true })));
  if (soft.length === 1) return soft[0];
  if (option.preserveWhenMissing === true) return null;
  throw new Error(`Could not uniquely match ${groupKey}:${option.optionKey} (${option.name}); exact=${exact.length}, soft=${soft.length}`);
};

for (const group of mapping.groups) {
  for (const option of group.options) {
    const row = rowForMappedOption(group.groupKey, option);
    if (!row) continue;
    const localized = splitLocalizedName(row.name);
    option.name = localized.name;
    option.displayNames = displayNameOverrides.get(option.optionKey) || localized.displayNames;
    option.uberName = row.name;
    option.uberPrice = priceOf(row);
    option.websitePrice = websitePrice(option.uberPrice);
    option.matchedExisting = true;
  }
}

for (const addition of additions) {
  const group = mapping.groups.find((entry) => entry.groupKey === addition.groupKey);
  if (!group) throw new Error(`Missing mapping group: ${addition.groupKey}`);
  if (group.options.some((option) => option.optionKey === addition.optionKey)) continue;
  const additionKey = normalizeName(addition.uberName);
  const matches = (rowsByGroup.get(addition.groupKey) || [])
    .filter((row) => {
      const rowKey = normalizeName(row.name);
      return rowKey === additionKey || rowKey.startsWith(additionKey);
    });
  if (matches.length !== 1) throw new Error(`Could not find new Uber option: ${addition.uberName}`);
  const row = matches[0];
  const localized = splitLocalizedName(row.name);
  group.options.push({
    optionKey: addition.optionKey,
    name: localized.name,
    displayNames: localized.displayNames,
    websitePrice: websitePrice(priceOf(row)),
    uberName: row.name,
    uberPrice: priceOf(row),
    matchedExisting: false,
  });
}

const baseSoupRow = rows.find((row) => row.href?.endsWith("/d0de8191-d77a-4bfa-9766-32f544384e0e"));
if (!baseSoupRow) throw new Error("The Uber base soup row is missing.");
mapping.baseSoup.uberName = baseSoupRow.name;
mapping.baseSoup.uberPrice = priceOf(baseSoupRow);
mapping.baseSoup.websitePrice = websitePrice(mapping.baseSoup.uberPrice);

const snapshotGroups = groupDefinitions
  .filter((group) => !group.supplemental)
  .map((group) => {
    const groupRows = rowsByGroup.get(group.groupKey) || [];
    return {
      accessibleName: `${group.usage} ${groupRows.length} オプション Chevron right`,
      rows: groupRows.map((row) => ({ name: row.name, priceText: row.price })),
    };
  });
const snapshot = {
  source: "Uber Eats Menu Maker",
  storeId: "d6205da2-b809-531c-a7b2-d9cf505cf1c0",
  capturedAt,
  groups: snapshotGroups,
};

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
catalog.source.capturedAt = capturedAt;
catalog.source.pricingRule = { multiplier: 0.8, roundingUnit: 10 };
const rowByUberId = new Map(rows.map((row) => [String(row.href || "").split("/").pop(), row]));
for (const product of catalog.products) {
  const row = rowByUberId.get(product.uberId);
  if (!row) continue;
  product.name = row.name;
  product.uberPrice = priceOf(row);
}

const specialGroupSpecs = [
  {
    key: "featured-quail",
    uberId: "uber-featured-quail-2026-08-08",
    name: "みんなが選ぶ！人気具材の山盛り",
    type: "multiple",
    limit: 1,
    usage: "みんなが選ぶ！人気具材の山盛り",
    optionId: "mountain-quail-10",
    optionName: "🥇山盛りうずら×🔟",
    attach: (product) => product.groupKeys.includes("base"),
  },
  {
    key: "extra-beef-tendon",
    uberId: "uber-extra-beef-tendon-2026-08-08",
    name: "とろとろ牛すじを追加する",
    type: "multiple",
    limit: 1,
    usage: "とろとろ牛すじを追加する",
    optionId: "extra-beef-tendon",
    optionName: "追加とろとろ牛すじ1人前(約50g)",
    attach: (product) => product.websiteId === "beef-tendon-dashi-ponzu",
  },
  {
    key: "extra-pork-cartilage",
    uberId: "uber-extra-pork-cartilage-2026-08-08",
    name: "とろとろ豚軟骨を追加する",
    type: "multiple",
    limit: 1,
    usage: "とろとろ豚軟骨を追加する",
    optionId: "extra-pork-cartilage",
    optionName: "追加豚軟骨1人前(約50g)",
    attach: (product) => product.websiteId === "pork-cartilage-dashi-ponzu",
  },
];
for (const spec of specialGroupSpecs) {
  const matches = rows.filter((row) => row.usage === spec.usage && normalizeName(row.name) === normalizeName(spec.optionName));
  if (matches.length !== 1) throw new Error(`Could not find special Uber option: ${spec.optionName}`);
  const row = matches[0];
  const localized = splitLocalizedName(row.name);
  const value = {
    key: spec.key,
    uberId: spec.uberId,
    name: spec.name,
    type: spec.type,
    limit: spec.limit,
    options: [{ id: spec.optionId, name: row.name, uberPrice: priceOf(row), displayNames: localized.displayNames }],
  };
  const existingIndex = catalog.extraGroups.findIndex((group) => group.key === spec.key);
  if (existingIndex >= 0) catalog.extraGroups[existingIndex] = value;
  else catalog.extraGroups.push(value);
  for (const product of catalog.products) {
    product.groupKeys = Array.isArray(product.groupKeys) ? product.groupKeys : [];
    if (spec.attach(product) && !product.groupKeys.includes(spec.key)) product.groupKeys.push(spec.key);
  }
}

let menuSource = await readFile(maamaaMenuPath, "utf8");
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const updateInlineChoice = (source, option) => {
  const localizedJson = JSON.stringify(option.displayNames || {});
  const prefix = `{ id: ${JSON.stringify(option.optionKey)}, name: `;
  const matcher = new RegExp(`\\{ id: ${JSON.stringify(option.optionKey)}, name: "(?:[^"\\\\]|\\\\.)*"(?:, displayNames: \\{[^\\n}]*\\})?, price: \\d+`);
  if (!matcher.test(source)) return source;
  return source.replace(matcher, `${prefix}${JSON.stringify(option.name)}, displayNames: ${localizedJson}, price: ${option.websitePrice}`);
};
for (const group of mapping.groups) {
  for (const option of group.options) menuSource = updateInlineChoice(menuSource, option);
}

const newSourceOptions = additions.map((addition) => {
  const option = mapping.groups.find((group) => group.groupKey === addition.groupKey)?.options
    .find((entry) => entry.optionKey === addition.optionKey);
  return { ...addition, option };
});
const sourceAnchorByGroup = {
  noodles: "knife-shaved-noodle",
  base: "traditional-tofu-skin",
  standard: "cabbage-roll",
  premium: "mussels",
  vip: "seafood-set",
};
for (const addition of newSourceOptions.filter((entry) => entry.option)) {
  if (menuSource.includes(`id: ${JSON.stringify(addition.optionKey)}`)) continue;
  const anchorId = sourceAnchorByGroup[addition.groupKey];
  if (!anchorId) throw new Error(`Missing website source anchor for ${addition.groupKey}:${addition.optionKey}`);
  const anchor = new RegExp(`^(\\s*)\\{ id: ${JSON.stringify(anchorId)}[^\\n]+$`, "m");
  if (!anchor.test(menuSource)) throw new Error(`Could not find website source anchor: ${anchorId}`);
  menuSource = menuSource.replace(anchor, (line, indent) => `${line}\n${indent}{ id: ${JSON.stringify(addition.optionKey)}, name: ${JSON.stringify(addition.option.name)}, displayNames: ${JSON.stringify(addition.option.displayNames)}, price: ${addition.option.websitePrice} },`);
}

const movedBeefSlice = mapping.groups.find((group) => group.groupKey === "premium")?.options
  .find((option) => option.optionKey === "beef-slice");
if (!movedBeefSlice) throw new Error("The reviewed beef slice mapping is missing.");
menuSource = menuSource.replace(/^\s*\{ id: "beef-slice"[^\n]+\n/m, "");
if (!menuSource.includes('id: "beef-slice"')) {
  const premiumAnchor = /^(\s*)\{ id: "mussels"[^\n]+$/m;
  menuSource = menuSource.replace(premiumAnchor, (line, indent) => `${line}\n${indent}{ id: "beef-slice", name: ${JSON.stringify(movedBeefSlice.name)}, displayNames: ${JSON.stringify(movedBeefSlice.displayNames)}, price: ${movedBeefSlice.websitePrice} },`);
}

const updateProductBlock = (source, product) => {
  const start = source.indexOf(`    id: ${JSON.stringify(product.websiteId)},`);
  if (start < 0) return source;
  const end = source.indexOf("\n  },", start);
  if (end < 0) throw new Error(`Could not isolate preset block: ${product.websiteId}`);
  const localized = splitLocalizedName(product.name);
  let block = source.slice(start, end);
  block = block.replace(/name: "(?:[^"\\]|\\.)*",/, `name: ${JSON.stringify(localized.name)},`);
  block = block.replace(/displayNames: \{[^\n}]*\},/, `displayNames: ${JSON.stringify(localized.displayNames)},`);
  block = block.replace(/price: \d+,/, `price: ${websitePrice(product.uberPrice)},`);
  return source.slice(0, start) + block + source.slice(end);
};
for (const product of catalog.products) menuSource = updateProductBlock(menuSource, product);
menuSource = menuSource.replace(/Source snapshot: Uber Menu Maker, \d{4}-\d{2}-\d{2}\./, `Source snapshot: Uber Menu Maker, ${capturedAt}.`);

await Promise.all([
  writeFile(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`),
  writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`),
  writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`),
  writeFile(maamaaMenuPath, menuSource),
]);

console.log(JSON.stringify({
  capturedAt,
  rows: rows.length,
  snapshotGroups: snapshot.groups.map((group) => group.rows.length),
  mappingOptions: mapping.groups.reduce((sum, group) => sum + group.options.length, 0),
  catalogProducts: catalog.products.length,
  catalogExtraGroups: catalog.extraGroups.length,
}, null, 2));
