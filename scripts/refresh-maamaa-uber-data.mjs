import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rowsArgumentIndex = process.argv.indexOf("--rows");
const rowsPath = rowsArgumentIndex >= 0 ? resolve(String(process.argv[rowsArgumentIndex + 1] || "")) : "";
if (!rowsPath) throw new Error("Usage: node scripts/refresh-maamaa-uber-data.mjs --rows <uber-rows.json>");

const repoRoot = new URL("../", import.meta.url);
const mappingPath = new URL("../data/uber/maamaa-menu-mapping.json", import.meta.url);
const catalogPath = new URL("../data/uber/maamaa-catalog.json", import.meta.url);
const snapshotPath = new URL("../data/uber/maamaa-menu-2026-08-08.json", import.meta.url);
const maamaaMenuPath = "/Users/wushengyin/Desktop/maamaa/src/data/malatang-menu.ts";

const input = JSON.parse(await readFile(rowsPath, "utf8"));
const rows = Array.isArray(input.rows) ? input.rows : [];
if (rows.length < 150) throw new Error(`Uber row snapshot is incomplete: ${rows.length}`);

const capturedAt = String(input.capturedAt || "2026-08-08");
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
const rowsByGroup = new Map(groupDefinitions.map((group) => [
  group.groupKey,
  rows.filter((row) => row.usage === group.usage),
]));

const additions = [
  { groupKey: "base", optionKey: "plain-wonton", uberName: "ワンタン" },
  { groupKey: "base", optionKey: "soft-boiled-egg", uberName: "半熟味玉" },
  { groupKey: "base", optionKey: "shiitake-pork-meatball", uberName: "椎茸入り豚肉団子" },
  { groupKey: "base", optionKey: "chicken-cartilage-meatball", uberName: "軟骨入り鶏肉団子" },
  { groupKey: "premium", optionKey: "spicy-pollock-roe", uberName: "辛子明太子" },
];

const mapping = JSON.parse(await readFile(mappingPath, "utf8"));
mapping.source.capturedAt = capturedAt;
mapping.source.pricingRule = { multiplier: 0.8, roundingUnit: 10 };

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
    option.displayNames = localized.displayNames;
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
  const matches = (rowsByGroup.get(addition.groupKey) || [])
    .filter((row) => normalizeName(row.name) === normalizeName(addition.uberName));
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
for (const addition of newSourceOptions.filter((entry) => entry.groupKey === "base" && entry.option)) {
  if (menuSource.includes(`id: ${JSON.stringify(addition.optionKey)}`)) continue;
  const anchor = /^(\s*)\{ id: "traditional-tofu-skin"[^\n]+$/m;
  menuSource = menuSource.replace(anchor, (line, indent) => `${line}\n${indent}{ id: ${JSON.stringify(addition.optionKey)}, name: ${JSON.stringify(addition.option.name)}, displayNames: ${JSON.stringify(addition.option.displayNames)}, price: ${addition.option.websitePrice} },`);
}
for (const addition of newSourceOptions.filter((entry) => entry.groupKey === "premium" && entry.option)) {
  if (menuSource.includes(`id: ${JSON.stringify(addition.optionKey)}`)) continue;
  const anchor = /^(\s*)\{ id: "mussels"[^\n]+$/m;
  menuSource = menuSource.replace(anchor, (line, indent) => `${line}\n${indent}{ id: ${JSON.stringify(addition.optionKey)}, name: ${JSON.stringify(addition.option.name)}, displayNames: ${JSON.stringify(addition.option.displayNames)}, price: ${addition.option.websitePrice} },`);
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
