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
await sql.query(`
  create table if not exists local_bridge_commands (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references stores(id) on delete cascade,
    platform text not null default 'uber_eats',
    command_type text not null,
    idempotency_key text not null unique,
    payload jsonb not null default '{}'::jsonb,
    status text not null default 'pending',
    attempts integer not null default 0,
    available_at timestamptz not null default now(),
    claimed_by_device_id uuid references local_bridge_devices(id) on delete set null,
    claimed_at timestamptz,
    claim_expires_at timestamptz,
    completed_at timestamptz,
    result jsonb not null default '{}'::jsonb,
    last_error text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`);
await sql.query(`
  create index if not exists idx_local_bridge_commands_pending
  on local_bridge_commands(store_id, platform, status, available_at, created_at)
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
const commandTables = await sql`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name = 'local_bridge_commands'
`;

console.log(JSON.stringify({
  sourceExternalIdColumn: columns.length === 1,
  uniqueIndex: indexes.length === 1,
  deviceTable: deviceTables.length === 1,
  commandTable: commandTables.length === 1
}));
