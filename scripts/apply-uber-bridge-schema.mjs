import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const sql = neon(process.env.DATABASE_URL);

await sql.query("alter table store_customer_orders add column if not exists source_external_id text");
await sql.query(`
  create unique index if not exists idx_store_customer_orders_source_external
  on store_customer_orders(order_source, source_external_id)
  where source_external_id is not null
`);
await sql.query(`
  create table if not exists local_bridge_devices (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references stores(id) on delete cascade,
    platform text not null default 'uber_eats',
    device_name text not null,
    token_hash text not null unique,
    is_enabled boolean not null default true,
    last_seen_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`);
await sql.query(`
  create index if not exists idx_local_bridge_devices_store
  on local_bridge_devices(store_id, platform, is_enabled)
`);

const columns = await sql`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'store_customer_orders'
    and column_name = 'source_external_id'
`;
const indexes = await sql`
  select indexname
  from pg_indexes
  where schemaname = 'public'
    and indexname = 'idx_store_customer_orders_source_external'
`;
const deviceTables = await sql`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name = 'local_bridge_devices'
`;

console.log(JSON.stringify({
  sourceExternalIdColumn: columns.length === 1,
  uniqueIndex: indexes.length === 1,
  deviceTable: deviceTables.length === 1
}));
