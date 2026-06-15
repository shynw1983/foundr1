import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const sql = neon(process.env.DATABASE_URL);
const schema = readFileSync("db/schema.sql", "utf8");
const statements = schema.split(";").map((statement) => statement.trim()).filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
}

const productPackageSpecColumns = await sql`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name = 'package_spec'
`;
if (productPackageSpecColumns.length > 0) {
  await sql.query(`
    update products
    set
      product_family_name = coalesce(nullif(product_family_name, ''), name),
      variant_name = case
        when coalesce(package_spec, '') = '' then coalesce(variant_name, '')
        when coalesce(variant_name, '') = '' then package_spec
        when position(package_spec in variant_name) > 0 then variant_name
        else concat(variant_name, ' / ', package_spec)
      end,
      updated_at = now()
    where coalesce(package_spec, '') <> ''
  `);
  await sql.query(`
    update products
    set
      name = trim(concat(coalesce(nullif(product_family_name, ''), name), ' ', coalesce(nullif(variant_name, ''), ''))),
      updated_at = now()
    where coalesce(variant_name, '') <> ''
  `);
  await sql.query("alter table products drop column if exists package_spec");
}

await sql.query("alter table purchase_orders add column if not exists deadline_label text");
await sql.query("alter table purchase_orders add column if not exists requested_item_count integer not null default 0");
await sql.query("alter table employees add column if not exists login_id text unique");
await sql.query("alter table employees add column if not exists password_hash text");
await sql.query("alter table employees add column if not exists password_must_change boolean not null default false");
await sql.query("alter table employees add column if not exists password_changed_at timestamptz");
await sql.query(`
  update employees
  set password_must_change = true
  where role in ('store_manager', 'staff')
    and password_hash is not null
    and password_changed_at is null
    and password_must_change = false
`);
await sql.query("alter table employees add column if not exists session_version integer not null default 1");

const tables = await sql`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('delivery_batches', 'delivery_batch_items')
  order by table_name
`;
const orderItemColumns = await sql`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'purchase_order_items'
    and column_name in ('actual_quantity', 'actual_price', 'brand_id', 'procurement_note', 'price_exception_note')
  order by column_name
`;
const actualColumns = await sql`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'purchase_actuals'
    and column_name in ('actual_price')
  order by column_name
`;

console.log(JSON.stringify({ tables, orderItemColumns, actualColumns }, null, 2));
