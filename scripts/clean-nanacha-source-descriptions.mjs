import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const sql = neon(process.env.DATABASE_URL);

function cleanDescription(value) {
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

const items = await sql`
  select menu_catalog_items.id::text, menu_catalog_items.external_id, menu_catalog_items.name,
    menu_catalog_items.description
  from menu_catalog_items
  join brands on brands.id = menu_catalog_items.brand_id
  where lower(brands.name) = lower('nanacha')
    and menu_catalog_items.store_id is null
    and menu_catalog_items.description ilike '%This item does not contain tapioca.%'
`;

const updates = items
  .map((item) => ({
    id: item.id,
    externalId: item.external_id,
    name: item.name,
    description: cleanDescription(item.description)
  }))
  .filter((item, index) => item.description !== items[index].description);

for (const item of updates) {
  await sql`
    update menu_catalog_items
    set description = ${item.description},
        updated_at = now()
    where id = ${item.id}
  `;
}

console.log(
  JSON.stringify(
    {
      updated: updates.length,
      items: updates.map(({ externalId, name }) => ({ externalId, name }))
    },
    null,
    2
  )
);
