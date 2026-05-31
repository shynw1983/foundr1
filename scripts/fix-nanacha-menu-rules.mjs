import { sql } from "../lib/db.ts";

const allOptionIds = ["none", "premium", "soy", "decaf"];
const allToppingIds = [
  "extra-tapioca",
  "extra-oreo",
  "extra-whip",
  "choco-chip",
  "cheese-foam",
  "no-tapioca",
  "no-whip"
];

function isDecafItem(item) {
  return /カフェ|コーヒ|coffee|cafe/i.test(item.name);
}

function normalizeArray(value, fallback) {
  return Array.isArray(value) && value.length ? value.map(String) : fallback;
}

const rows = await sql`
  select
    menu_catalog_items.id::text,
    menu_catalog_items.name,
    menu_catalog_items.variable_schema
  from menu_catalog_items
  join brands on brands.id = menu_catalog_items.brand_id
  where lower(brands.name) = lower('nanacha')
    and menu_catalog_items.store_id is null
`;

let updated = 0;

for (const row of rows) {
  const schema = { ...(row.variable_schema ?? {}) };
  const categoryId = String(schema.categoryId || "");
  const isTapiocaFree = schema.isTapiocaFree === true || ["smoothie", "special", "tea-coffee"].includes(categoryId);
  const hasWhipByDefault = schema.hasWhipByDefault === true || categoryId === "frappe";

  const optionIds = normalizeArray(schema.allowedOptions, allOptionIds);
  const toppingIds = normalizeArray(schema.allowedToppings, allToppingIds);

  schema.allowedOptions = optionIds.filter((id) => id !== "decaf" || isDecafItem(row));
  schema.allowedToppings = toppingIds.filter((id) => {
    if (id === "no-tapioca") return !isTapiocaFree;
    if (id === "no-whip") return hasWhipByDefault;
    return true;
  });

  if (JSON.stringify(row.variable_schema ?? {}) !== JSON.stringify(schema)) {
    await sql`
      update menu_catalog_items
      set variable_schema = ${schema},
          updated_at = now()
      where id = ${row.id}
    `;
    updated += 1;
  }
}

console.log(JSON.stringify({ updated, total: rows.length }, null, 2));
