import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
const sql = neon(process.env.DATABASE_URL);

await sql.query(`
  create table if not exists menu_inventory_sync_runs (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references stores(id) on delete cascade,
    run_type text not null default 'availability_change',
    action text not null,
    item_label text not null default '',
    inventory_key text not null default '',
    source text not null default 'store',
    requested_by uuid references employees(id) on delete set null,
    scheduled_for date,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    check (run_type in ('availability_change', 'full_sync')),
    check (action in ('available', 'low_stock', 'unavailable', 'platform_override', 'full_sync')),
    check (source in ('store', 'siri', 'scheduled', 'system'))
  )
`);
await sql.query(`
  create index if not exists menu_inventory_sync_runs_store_created_idx
  on menu_inventory_sync_runs(store_id, created_at desc)
`);
await sql.query(`
  create unique index if not exists menu_inventory_sync_runs_scheduled_day_idx
  on menu_inventory_sync_runs(store_id, scheduled_for)
  where source = 'scheduled' and scheduled_for is not null
`);

const rows = await sql`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'menu_inventory_sync_runs'
  order by ordinal_position
`;
console.log(JSON.stringify({ table: "menu_inventory_sync_runs", columns: rows.map((row) => row.column_name) }, null, 2));
