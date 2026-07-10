import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

const maamaaMenuPath = "/Users/wushengyin/Desktop/maamaa/src/data/malatang-menu.ts";
const applyChanges = process.argv.includes("--apply");

// Target prices are Uber Eats prices × 80%, rounded to the nearest ¥10.

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);
const source = await readFile(maamaaMenuPath, "utf8");
const optionPrices = new Map(
  [...source.matchAll(/\{ id: "([^"]+)", name: "[^"]+", price: (\d+)/g)]
    .map((match) => [match[1], Number(match[2])])
);

// This option exists in OS but is not part of the local fallback menu.
optionPrices.set("option-dcafe1ea", 220);

const basePrice = Number(
  source.match(/export const baseSoup[\s\S]*?price: (\d+)/)?.[1]
);

if (!Number.isFinite(basePrice) || optionPrices.size < 70) {
  throw new Error("Could not read the complete maamaa fallback price list.");
}

const brandRows = await sql`
  select id::text
  from brands
  where name = 'まぁ麻'
  limit 1
`;
const brandId = String(brandRows[0]?.id ?? "");

if (!brandId) throw new Error("The maamaa brand was not found.");

const currentItems = await sql`
  select external_id as "externalId", name, base_price::float as price
  from menu_catalog_items
  where brand_id::text = ${brandId}
    and is_active = true
  order by sort_order, name
`;
const currentOptions = await sql`
  select o.option_key as "optionKey", o.name, o.price_delta::float as price
  from menu_options o
  join menu_option_groups g on g.id = o.option_group_id
  where g.brand_id::text = ${brandId}
    and o.is_active = true
  order by g.sort_order, o.sort_order
`;

const itemChanges = currentItems
  .filter((item) => item.externalId === "mala-soup" && Number(item.price) !== basePrice)
  .map((item) => ({ name: item.name, from: Number(item.price), to: basePrice }));
const optionChanges = currentOptions
  .map((option) => ({
    optionKey: String(option.optionKey),
    name: String(option.name),
    from: Number(option.price),
    to: optionPrices.get(String(option.optionKey))
  }))
  .filter((option) => option.to !== undefined && option.from !== option.to);
const missingKeys = currentOptions
  .filter((option) => !optionPrices.has(String(option.optionKey)))
  .map((option) => `${option.name} (${option.optionKey})`);

console.table([...itemChanges, ...optionChanges].map(({ name, from, to }) => ({ name, from, to })));
if (missingKeys.length) console.warn(`No target price for: ${missingKeys.join(", ")}`);

if (!applyChanges) {
  console.log(`Dry run: ${itemChanges.length + optionChanges.length} price(s) would change. Re-run with --apply.`);
  process.exit(0);
}

await sql`
  update menu_catalog_items
  set base_price = ${basePrice}, updated_at = now()
  where brand_id::text = ${brandId}
    and external_id = 'mala-soup'
    and base_price is distinct from ${basePrice}
`;

const priceRows = [...optionPrices].map(([optionKey, price]) => ({ optionKey, price }));
await sql`
  update menu_options o
  set price_delta = target.price, updated_at = now()
  from menu_option_groups g,
    jsonb_to_recordset(${JSON.stringify(priceRows)}::jsonb) as target("optionKey" text, price numeric)
  where g.id = o.option_group_id
    and g.brand_id::text = ${brandId}
    and o.option_key = target."optionKey"
    and o.price_delta is distinct from target.price
`;

console.log(`Updated ${itemChanges.length + optionChanges.length} maamaa website price(s).`);
