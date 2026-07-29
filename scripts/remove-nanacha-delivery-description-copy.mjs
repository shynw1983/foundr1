import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const shouldApply = process.argv.includes("--apply");
const sql = neon(process.env.DATABASE_URL);
const expectedItems = [
  "濃厚黒ごまチーズタピオカフラッペ",
  "バニラタピオカフラッペ",
  "キャラメルタピオカフラッペ",
  "チョコミントタピオカフラッペ",
  "オレオタピオカフラッペ",
  "バナナタピオカフラッペ",
  "チョコタピオカフラッペ",
  "抹茶タピオカフラッペ"
];
const deliveryNoticePattern = /\n*\s*※配達中の揺れにより、[^\n]*(?:\n|$)/g;

const [brand] = await sql`
  select id::text
  from brands
  where lower(name) = lower('nanacha')
    and status = 'active'
  limit 1
`;
if (!brand?.id) throw new Error("nanacha brand not found.");

const items = await sql`
  select id::text, name, description
  from menu_catalog_items
  where brand_id = ${brand.id}
    and is_active = true
    and name = any(${expectedItems})
  order by name
`;
const itemByName = new Map(items.map((item) => [item.name, item]));
const missing = expectedItems.filter((name) => !itemByName.has(name));
if (missing.length) {
  throw new Error(`Missing nanacha menu items: ${missing.join(", ")}`);
}

const updates = items.map((item) => {
  const description = String(item.description || "");
  const cleanedDescription = description
    .replace(deliveryNoticePattern, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (description === cleanedDescription) {
    throw new Error(`Delivery notice was not found on ${item.name}.`);
  }
  return {
    id: item.id,
    name: item.name,
    description: cleanedDescription
  };
});

if (shouldApply) {
  await sql`
    update menu_catalog_items as items
    set
      description = updates.description,
      updated_at = now()
    from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) as updates(
      id uuid,
      name text,
      description text
    )
    where items.id = updates.id
      and items.brand_id = ${brand.id}
  `;
}

const remaining = shouldApply
  ? await sql`
      select name
      from menu_catalog_items
      where brand_id = ${brand.id}
        and is_active = true
        and description ~ '(配達|配送|デリバリー|配達員|運搬|宅配|配送料|ドライバー)'
      order by name
    `
  : [];

console.log(JSON.stringify({
  mode: shouldApply ? "applied" : "preview",
  updated: updates.length,
  items: updates.map((item) => item.name),
  remainingDeliveryReferences: remaining.map((item) => item.name)
}, null, 2));
