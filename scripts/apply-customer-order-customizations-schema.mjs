import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const sql = neon(process.env.DATABASE_URL);

await sql`
  alter table store_customer_order_items
  add column if not exists customizations jsonb not null default '[]'::jsonb
`;

const columns = await sql`
  select column_name, data_type, column_default, is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'store_customer_order_items'
    and column_name = 'customizations'
`;

console.log(JSON.stringify(columns, null, 2));
