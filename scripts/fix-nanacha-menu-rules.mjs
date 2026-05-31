import { readFile } from "node:fs/promises";
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

const menuJson = JSON.parse(await readFile("/Users/wushengyin/Desktop/nanacha New HP/published/menu.json", "utf8"));
const sourceCategories = Array.isArray(menuJson?.baseMenu?.categories) ? menuJson.baseMenu.categories : [];
const brandRows = await sql`
  select id::text
  from brands
  where lower(name) = lower('nanacha')
  limit 1
`;
const brandId = brandRows[0]?.id;
if (!brandId) throw new Error("nanacha brand not found");

let categoriesSynced = 0;
for (const [index, category] of sourceCategories.entries()) {
  const externalId = String(category.id ?? "").trim();
  const name = String(category.label ?? category.id ?? "").trim();
  if (!name) continue;
  const updatedRows = await sql`
    update menu_categories
    set
      external_id = ${externalId},
      name = ${name},
      note = ${String(category.note ?? "").trim()},
      is_tapioca_free = ${category.isTapiocaFree === true},
      has_whip_by_default = ${category.hasWhipByDefault === true},
      sort_order = ${(index + 1) * 10},
      updated_at = now()
    where brand_id = ${brandId}
      and store_id is null
      and (external_id = ${externalId} or name = ${name})
    returning id::text
  `;
  if (!updatedRows[0]) {
    await sql`
      insert into menu_categories (
        brand_id,
        store_id,
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
        null,
        ${externalId},
        ${name},
        ${String(category.note ?? "").trim()},
        ${category.isTapiocaFree === true},
        ${category.hasWhipByDefault === true},
        ${(index + 1) * 10},
        now()
      )
    `;
  }
  categoriesSynced += 1;
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

console.log(JSON.stringify({ categoriesSynced, updated, total: rows.length }, null, 2));
