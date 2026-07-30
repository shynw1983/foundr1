import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

const repoRoot = new URL("../", import.meta.url);
const defaultSnapshotPath = new URL("../data/uber/maamaa-menu-2026-07-30.json", import.meta.url);
const mappingPath = new URL("../data/uber/maamaa-menu-mapping.json", import.meta.url);
const maamaaMenuPath = "/Users/wushengyin/Desktop/maamaa/src/data/malatang-menu.ts";
const applyChanges = process.argv.includes("--apply");
const snapshotArgumentIndex = process.argv.indexOf("--snapshot");
const snapshotPath = snapshotArgumentIndex >= 0
  ? String(process.argv[snapshotArgumentIndex + 1] ?? "").trim()
  : defaultSnapshotPath;

if (!snapshotPath) throw new Error("--snapshot requires a file path.");

loadLocalEnv();
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const [snapshot, mapping, menu] = await Promise.all([
  readFile(snapshotPath, "utf8").then(JSON.parse),
  readFile(mappingPath, "utf8").then(JSON.parse),
  import(`${pathToFileURL(maamaaMenuPath).href}?sync=${Date.now()}`)
]);

const expectedGroupKeys = [
  "medicinal-spice",
  "heat",
  "numb",
  "special-flavor",
  ...menu.menuSections.map((section) => section.id)
];
const expectedGroups = new Map([
  ["medicinal-spice", { name: "薬膳スパイス", items: menu.medicinalSpiceOptions }],
  ["heat", { name: "辛さ", items: menu.heatLevels }],
  ["numb", { name: "痺れ", items: menu.numbLevels }],
  ["special-flavor", { name: "味変・追加調味", items: menu.specialFlavors }],
  ...menu.menuSections.map((section) => [section.id, { name: section.title, items: section.items }])
]);
const expectedOptionCount = [...expectedGroups.values()]
  .reduce((total, group) => total + group.items.length, 0);
const snapshotOptionCount = snapshot.groups
  .reduce((total, group) => total + group.rows.length, 0);
const mappingOptionCount = mapping.groups
  .reduce((total, group) => total + group.options.length, 0);

if (snapshot.groups.length !== expectedGroups.size) {
  throw new Error(`Unexpected Uber snapshot group count: ${snapshot.groups.length}; expected ${expectedGroups.size}.`);
}
if (mapping.groups.length !== expectedGroups.size || mappingOptionCount !== expectedOptionCount) {
  throw new Error(`Mapping/menu mismatch: mapping ${mapping.groups.length}/${mappingOptionCount}, menu ${expectedGroups.size}/${expectedOptionCount}.`);
}

const mappedOptionKeys = new Set(mapping.groups.flatMap((group) => group.options.map((option) => option.optionKey)));
const sourceOptionKeys = new Set([...expectedGroups.values()].flatMap((group) => group.items.map((option) => option.id)));
const missingSourceKeys = [...mappedOptionKeys].filter((key) => !sourceOptionKeys.has(key));
const unmappedSourceKeys = [...sourceOptionKeys].filter((key) => !mappedOptionKeys.has(key));
if (missingSourceKeys.length || unmappedSourceKeys.length) {
  throw new Error(`Mapping keys do not match website menu. Missing: ${missingSourceKeys.join(", ")}; unmapped: ${unmappedSourceKeys.join(", ")}`);
}

const snapshotSourceNames = new Set(snapshot.groups.flatMap((group, index) => (
  group.rows.map((row) => `${expectedGroupKeys[index]}:${row.name}`)
)));
const mappedSourceNames = new Set(mapping.groups.flatMap((group) => (
  group.options.map((option) => `${group.groupKey}:${option.uberName}`)
)));
const newUberOptions = [...snapshotSourceNames].filter((key) => !mappedSourceNames.has(key));
const removedUberOptions = [...mappedSourceNames].filter((key) => !snapshotSourceNames.has(key));

const sql = neon(process.env.DATABASE_URL);
const brandRows = await sql`
  select id::text
  from brands
  where name = 'まぁ麻'
  limit 1
`;
const brandId = String(brandRows[0]?.id ?? "");
if (!brandId) throw new Error("The maamaa brand was not found.");

const [currentItems, currentGroups, currentOptions] = await Promise.all([
  sql`
    select
      external_id as "externalId",
      coalesce(promotion_prefix, '') as "promotionPrefix",
      name,
      base_price::float as price,
      is_active as "isActive"
    from menu_catalog_items
    where brand_id::text = ${brandId}
  `,
  sql`
    select group_key as "groupKey", name, is_active as "isActive"
    from menu_option_groups
    where brand_id::text = ${brandId}
  `,
  sql`
    select g.group_key as "groupKey", o.option_key as "optionKey", o.name,
      o.price_delta::float as price, o.is_active as "isActive"
    from menu_options o
    join menu_option_groups g on g.id = o.option_group_id
    where g.brand_id::text = ${brandId}
  `
]);

const changes = [];
const base = currentItems.find((item) => item.externalId === menu.baseSoup.id);
const currentBaseName = base ? `${base.promotionPrefix || ""}${base.name}` : "";
if (!base) {
  changes.push({ type: "add", group: "base-soup", key: menu.baseSoup.id, from: "-", to: `${menu.baseSoup.name} / ¥${menu.baseSoup.price}` });
} else if (!base.isActive || currentBaseName !== menu.baseSoup.name || Number(base.price) !== Number(menu.baseSoup.price)) {
  changes.push({ type: "update", group: "base-soup", key: menu.baseSoup.id, from: `${currentBaseName} / ¥${base.price}`, to: `${menu.baseSoup.name} / ¥${menu.baseSoup.price}` });
}

const currentGroupByKey = new Map(currentGroups.map((group) => [String(group.groupKey), group]));
const currentOptionByKey = new Map(currentOptions.map((option) => [`${option.groupKey}:${option.optionKey}`, option]));

for (const groupKey of expectedGroupKeys) {
  const expectedGroup = expectedGroups.get(groupKey);
  const currentGroup = currentGroupByKey.get(groupKey);
  if (!currentGroup) {
    changes.push({ type: "add", group: groupKey, key: groupKey, from: "-", to: expectedGroup.name });
  } else if (!currentGroup.isActive || currentGroup.name !== expectedGroup.name) {
    changes.push({ type: "update", group: groupKey, key: groupKey, from: currentGroup.name, to: expectedGroup.name });
  }
  for (const option of expectedGroup.items) {
    const key = `${groupKey}:${option.id}`;
    const current = currentOptionByKey.get(key);
    if (!current) {
      changes.push({ type: "add", group: groupKey, key: option.id, from: "-", to: `${option.name} / ¥${option.price}` });
    } else if (!current.isActive || current.name !== option.name || Number(current.price) !== Number(option.price)) {
      changes.push({ type: "update", group: groupKey, key: option.id, from: `${current.name} / ¥${current.price}`, to: `${option.name} / ¥${option.price}` });
    }
  }
}

for (const group of currentGroups) {
  if (group.isActive && !expectedGroups.has(String(group.groupKey))) {
    changes.push({ type: "deactivate", group: String(group.groupKey), key: String(group.groupKey), from: group.name, to: "inactive" });
  }
}
for (const option of currentOptions) {
  const expected = expectedGroups.get(String(option.groupKey));
  if (option.isActive && expected && !expected.items.some((item) => item.id === option.optionKey)) {
    changes.push({ type: "deactivate", group: String(option.groupKey), key: String(option.optionKey), from: `${option.name} / ¥${option.price}`, to: "inactive" });
  }
}

console.table(changes);
console.log(JSON.stringify({
  snapshot: { capturedAt: snapshot.capturedAt, groups: snapshot.groups.length, options: snapshotOptionCount },
  target: { groups: expectedGroups.size, options: expectedOptionCount },
  changes: {
    total: changes.length,
    add: changes.filter((change) => change.type === "add").length,
    update: changes.filter((change) => change.type === "update").length,
    deactivate: changes.filter((change) => change.type === "deactivate").length
  },
  sourceReview: {
    newUberOptions,
    removedOrRenamedUberOptions: removedUberOptions
  }
}, null, 2));

if (!applyChanges) {
  console.log("Dry run only. Re-run with --apply to publish the reviewed maamaa menu.");
  process.exit(0);
}
if (newUberOptions.length || removedUberOptions.length) {
  throw new Error("The Uber snapshot contains unmapped additions, removals, or renames. Review and update the mapping before publishing.");
}

const result = spawnSync(
  process.execPath,
  ["scripts/import-brand-menus.mjs", "--brand", "maamaa", "--prune"],
  { cwd: new URL(".", repoRoot), encoding: "utf8", stdio: "inherit" }
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("Published the reviewed Uber-based maamaa menu to Foundr1 OS.");
