import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const sql = neon(process.env.DATABASE_URL);

// Customer-visible order from the Uber Eats Menu Maker overview.
// Foundr1-only categories stay after the Uber categories.
const categoryOrder = [
  { externalId: "signature" },
  { externalId: "milk" },
  { externalId: "frappe" },
  { externalId: "cheese-tea" },
  { externalId: "tea" },
  { externalId: "smoothie" },
  { externalId: "special" },
  { externalId: "original-teaade" },
  { externalId: "estate-latte" },
  { name: "カップマーラータン" },
  { externalId: "limited" },
  { externalId: "coffee" },
  { externalId: "tea-coffee" }
];

const brands = await sql`
  select id::text
  from brands
  where lower(name) = lower('nanacha')
    and status = 'active'
  limit 1
`;
const brandId = brands[0]?.id;
if (!brandId) throw new Error("nanacha brand not found.");

const categories = await sql`
  select id::text, external_id, name
  from menu_categories
  where brand_id = ${brandId}
    and store_id is null
`;
const orderedCategories = categoryOrder.map((selector) =>
  categories.find((category) =>
    selector.externalId
      ? String(category.external_id) === selector.externalId
      : category.name === selector.name
  )
);
const missing = categoryOrder.filter((_, index) => !orderedCategories[index]);
if (missing.length) {
  throw new Error(`nanacha categories are incomplete. Missing: ${JSON.stringify(missing)}`);
}

const updates = orderedCategories.map((category, index) => ({
  id: category.id,
  sort_order: (index + 1) * 10
}));

await sql`
  update menu_categories as categories
  set
    sort_order = updates.sort_order,
    updated_at = now()
  from (
    select *
    from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
      as rows(id uuid, sort_order integer)
  ) as updates
  where categories.id = updates.id
`;

const result = await sql`
  select external_id, name, sort_order
  from menu_categories
  where brand_id = ${brandId}
    and store_id is null
  order by sort_order, name
`;

console.log(JSON.stringify(result, null, 2));
