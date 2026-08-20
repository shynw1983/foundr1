import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes("--apply");
const managedGroups = ["noodles", "noodle-replacement", "cold-noodles", "medicinal-spice", "special-flavor"];

function grams(name) {
  return String(name).match(/(\d+)g/iu)?.[1] ?? "";
}

function appendGrams(value, amount, language) {
  if (!amount || /\d+\s*(?:g|克)/iu.test(value)) return value;
  return language === "zh" ? `${value}${amount}克` : `${value} ${amount}g`;
}

function insertKoreanReplacementGrams(value, amount) {
  if (!amount || /\d+\s*g/iu.test(value)) return value;
  const match = value.match(/^(.*?)(?:으로|로) 변경$/u);
  return match ? `${match[1]} ${amount}g으로 변경` : `${value} ${amount}g`;
}

function translatedPatch(row) {
  const names = row.displayNames && typeof row.displayNames === "object" ? row.displayNames : {};
  const amount = grams(row.name);
  const patch = {};

  if (row.groupKey === "noodles" && amount) {
    patch.en = appendGrams(String(names.en ?? ""), amount, "en");
    patch.ko = appendGrams(String(names.ko ?? ""), amount, "ko");
    patch.zh = appendGrams(String(names.zh ?? ""), amount, "zh");
  }

  if (row.groupKey === "cold-noodles") {
    const en = String(names.en ?? "").replace(/^Chilled\s+/iu, "");
    const ko = String(names.ko ?? "").replace(/^차가운\s+/u, "");
    const zh = String(names.zh ?? "").replace(/^冷/u, "");
    patch.en = `Chilled ${appendGrams(en, amount, "en")}`;
    patch.ko = `차가운 ${appendGrams(ko, amount, "ko")}`;
    patch.zh = `冷${appendGrams(zh, amount, "zh")}`;
  }

  if (row.groupKey === "noodle-replacement" && amount) {
    patch.en = appendGrams(String(names.en ?? ""), amount, "en");
    patch.ko = row.name.endsWith("追加")
      ? (/\d+\s*g/iu.test(String(names.ko ?? ""))
          ? String(names.ko ?? "")
          : `${String(names.ko ?? "").replace(/\s*추가$/u, "")} ${amount}g 추가`)
      : insertKoreanReplacementGrams(String(names.ko ?? ""), amount);
    patch.zh = appendGrams(String(names.zh ?? ""), amount, "zh");
  }

  if (row.groupKey === "medicinal-spice" && row.optionKey === "with-spice") {
    patch.en = "With Herbal Spice Blend";
    patch.ko = "약선 향신료 포함";
    patch.zh = "含药膳香料";
  }
  if (row.groupKey === "special-flavor" && row.optionKey === "extra-spice") {
    patch.en = "Extra Herbal Spice Blend";
    patch.ko = "약선 향신료 추가";
    patch.zh = "追加药膳香料";
  }

  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value));
}

const rows = await sql`
  select options.id::text, groups.group_key as "groupKey", options.option_key as "optionKey",
    options.name, coalesce(options.display_names, '{}'::jsonb) as "displayNames"
  from menu_options options
  join menu_option_groups groups on groups.id = options.option_group_id
  join brands on brands.id = groups.brand_id
  where brands.name = 'まぁ麻' and groups.group_key = any(${managedGroups})
  order by groups.group_key, options.sort_order, options.name
`;

const changes = rows.map((row) => ({ row, patch: translatedPatch(row) })).filter(({ row, patch }) => (
  Object.entries(patch).some(([language, value]) => String(row.displayNames?.[language] ?? "") !== value)
));

for (const { row, patch } of changes) {
  console.log(`${row.groupKey}/${row.optionKey}: ${JSON.stringify(patch)}`);
  if (!apply) continue;
  await sql`
    update menu_options
    set display_names = display_names || ${JSON.stringify(patch)}::jsonb, updated_at = now()
    where id = ${row.id}
  `;
}

console.log(`${apply ? "Updated" : "Would update"} ${changes.length} menu options.`);
