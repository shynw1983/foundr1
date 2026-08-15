import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

const applyChanges = process.argv.includes("--apply");

loadLocalEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const brandRows = await sql`
  select id::text
  from brands
  where name = 'まぁ麻'
  limit 1
`;
const brandId = String(brandRows[0]?.id ?? "");
if (!brandId) throw new Error("The maamaa brand was not found.");

const duplicateCategories = await sql`
  select
    lower(name) as "normalizedName",
    name,
    coalesce(store_id::text, '') as "storeId",
    array_agg(id::text order by
      case when external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 0 else 1 end,
      sort_order,
      created_at,
      id
    ) as ids,
    array_agg(coalesce(external_id, '') order by
      case when external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 0 else 1 end,
      sort_order,
      created_at,
      id
    ) as "externalIds",
    min(sort_order)::int as "sortOrder"
  from menu_categories
  where brand_id = ${brandId}
  group by lower(name), name, coalesce(store_id::text, '')
  having count(*) > 1
  order by min(sort_order), name
`;

const temporaryProducts = await sql`
  select id::text, external_id as "externalId", name, is_active as "isActive"
  from menu_catalog_items
  where brand_id = ${brandId}
    and external_id in ('temp-hakata-motsunabe-broth', 'temp-sundubu-broth')
  order by external_id
`;

console.log(JSON.stringify({ duplicateCategories, temporaryProducts, applyChanges }, null, 2));

if (!applyChanges) {
  console.log("Dry run only. Re-run with --apply to repair the maamaa catalog.");
  process.exit(0);
}

for (const category of duplicateCategories) {
  const [keeperId, ...duplicateIds] = category.ids;
  await sql`
    update menu_categories
    set sort_order = ${category.sortOrder}, updated_at = now()
    where id = ${keeperId}
  `;
  if (duplicateIds.length) {
    await sql`delete from menu_categories where id = any(${duplicateIds}::uuid[])`;
  }
}

await sql`
  update menu_catalog_items
  set
    is_active = false,
    variable_schema = jsonb_set(variable_schema, '{websiteEnabled}', 'false'::jsonb, true),
    updated_at = now()
  where brand_id = ${brandId}
    and external_id in ('temp-hakata-motsunabe-broth', 'temp-sundubu-broth')
`;

console.log(`Repaired ${duplicateCategories.length} duplicate category group(s) and disabled ${temporaryProducts.length} temporary product(s).`);
