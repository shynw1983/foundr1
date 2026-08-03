import { neon } from "@neondatabase/serverless";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "./db-env.mjs";

const maamaaMenuPath = "/Users/wushengyin/Desktop/maamaa/src/data/malatang-menu.ts";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);
const menu = await import(pathToFileURL(maamaaMenuPath).href);
const allOptions = menu.noodleReplacementOptions ?? [];
const optionArgumentIndex = process.argv.indexOf("--option");
const selectedOptionKey = optionArgumentIndex >= 0 ? String(process.argv[optionArgumentIndex + 1] ?? "").trim() : "";

if (allOptions.length !== 13) {
  throw new Error(`Expected 13 noodle replacement options, found ${allOptions.length}`);
}

const options = selectedOptionKey
  ? allOptions.filter((option) => option.id === selectedOptionKey)
  : allOptions;

if (selectedOptionKey && options.length !== 1) {
  throw new Error(`Unknown noodle replacement option: ${selectedOptionKey}`);
}

const optionKeys = options.map((option) => option.id);
const existing = await sql`
  select menu_options.option_key
  from menu_options
  join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
  join brands on brands.id = menu_option_groups.brand_id
  where brands.name = 'まぁ麻'
    and menu_option_groups.group_key = 'noodle-replacement'
    and menu_options.option_key in (
      select jsonb_array_elements_text(${JSON.stringify(optionKeys)}::jsonb)
    )
  order by menu_options.option_key
`;

if (existing.length !== options.length) {
  const found = new Set(existing.map((row) => row.option_key));
  const missing = optionKeys.filter((key) => !found.has(key));
  throw new Error(`Missing production menu options: ${missing.join(", ")}`);
}

const payload = options.map((option, index) => ({
  option_key: option.id,
  name: option.name,
  display_names: option.displayNames ?? {},
  price_delta: option.price ?? 0,
  sort_order: (index + 1) * 10
}));

const updated = await sql`
  with expected as (
    select *
    from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as option_data(
      option_key text,
      name text,
      display_names jsonb,
      price_delta numeric,
      sort_order integer
    )
  )
  update menu_options
  set
    external_id = expected.option_key,
    name = expected.name,
    display_names = expected.display_names,
    price_delta = expected.price_delta,
    sort_order = expected.sort_order,
    is_active = true,
    updated_at = now()
  from expected, menu_option_groups, brands
  where menu_options.option_group_id = menu_option_groups.id
    and menu_option_groups.brand_id = brands.id
    and brands.name = 'まぁ麻'
    and menu_option_groups.group_key = 'noodle-replacement'
    and menu_options.option_key = expected.option_key
  returning menu_options.option_key, menu_options.name
`;

if (updated.length !== options.length) {
  throw new Error(`Expected to update ${options.length} options, updated ${updated.length}`);
}

console.log(JSON.stringify({ updated: updated.length, options: updated }, null, 2));
