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

await sql.query("alter table purchase_orders add column if not exists deadline_label text");
await sql.query("alter table purchase_orders add column if not exists requested_item_count integer not null default 0");

const tables = await sql`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('delivery_batches', 'delivery_batch_items')
  order by table_name
`;
const columns = await sql`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'purchase_order_items'
    and column_name in ('actual_quantity', 'brand_id', 'procurement_note', 'price_exception_note')
  order by column_name
`;

console.log(JSON.stringify({ tables, columns }, null, 2));
