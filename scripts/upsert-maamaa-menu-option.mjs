import { neon } from "@neondatabase/serverless";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "./db-env.mjs";

const maamaaMenuPath = "/Users/wushengyin/Desktop/maamaa/src/data/malatang-menu.ts";
const groupArgumentIndex = process.argv.indexOf("--group");
const optionArgumentIndex = process.argv.indexOf("--option");
const groupKey = groupArgumentIndex >= 0 ? String(process.argv[groupArgumentIndex + 1] ?? "").trim() : "";
const optionKey = optionArgumentIndex >= 0 ? String(process.argv[optionArgumentIndex + 1] ?? "").trim() : "";

if (!groupKey || !optionKey) {
  throw new Error("Usage: node scripts/upsert-maamaa-menu-option.mjs --group <group-key> --option <option-key>");
}

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const menu = await import(pathToFileURL(maamaaMenuPath).href);
const section = (menu.menuSections ?? []).find((candidate) => candidate.id === groupKey);

if (!section) {
  throw new Error(`Unknown maamaa menu group: ${groupKey}`);
}

const optionIndex = section.items.findIndex((candidate) => candidate.id === optionKey);
const option = section.items[optionIndex];

if (!option) {
  throw new Error(`Unknown option ${optionKey} in group ${groupKey}`);
}

const sql = neon(process.env.DATABASE_URL);
const groups = await sql`
  select menu_option_groups.id::text
  from menu_option_groups
  join brands on brands.id = menu_option_groups.brand_id
  where brands.name = 'まぁ麻'
    and menu_option_groups.group_key = ${groupKey}
    and menu_option_groups.is_active = true
`;

if (groups.length !== 1) {
  throw new Error(`Expected one active ${groupKey} group, found ${groups.length}`);
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
    ${groups[0].id},
    ${option.id},
    ${option.id},
    ${option.name},
    ${JSON.stringify(option.displayNames ?? {})}::jsonb,
    ${option.price ?? 0},
    true,
    ${(optionIndex + 1) * 10},
    true,
    now()
  )
  on conflict (option_group_id, option_key)
  do update set
    external_id = excluded.external_id,
    name = excluded.name,
    display_names = excluded.display_names,
    price_delta = excluded.price_delta,
    affects_procedure = excluded.affects_procedure,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now()
  returning option_key, name, price_delta
`;

console.log(JSON.stringify({ groupKey, option: rows[0] }, null, 2));
