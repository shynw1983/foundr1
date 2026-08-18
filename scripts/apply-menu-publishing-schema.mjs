import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const sql = neon(process.env.DATABASE_URL);

await sql.transaction([
  sql`alter table menu_external_platforms add column if not exists rule_version text not null default ''`,
  sql`alter table menu_external_platforms add column if not exists rule_config jsonb not null default '{}'::jsonb`,
  sql`create table if not exists menu_platform_target_settings (
    id uuid primary key default gen_random_uuid(), brand_id uuid not null references brands(id) on delete cascade,
    store_id uuid references stores(id) on delete cascade, external_platform_id uuid not null references menu_external_platforms(id) on delete cascade,
    target_type text not null, target_id uuid not null, is_enabled boolean not null default true,
    name_override text not null default '', description_override text not null default '', price_override numeric(12, 2),
    emoji_mode text not null default 'follow', placement_config jsonb not null default '{}'::jsonb,
    updated_by uuid references employees(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (external_platform_id, target_type, target_id), check (target_type in ('item', 'option', 'category', 'option_group')),
    check (emoji_mode in ('follow', 'show', 'hide'))
  )`,
  sql`create table if not exists menu_platform_object_mappings (
    id uuid primary key default gen_random_uuid(), brand_id uuid not null references brands(id) on delete cascade,
    store_id uuid references stores(id) on delete cascade, external_platform_id uuid not null references menu_external_platforms(id) on delete cascade,
    target_type text not null, target_id uuid not null, external_id text not null, external_parent_id text not null default '',
    external_name text not null default '', last_observed_state jsonb not null default '{}'::jsonb, last_verified_at timestamptz,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (external_platform_id, target_type, target_id), unique (external_platform_id, target_type, external_id),
    check (target_type in ('item', 'option', 'category', 'option_group'))
  )`,
  sql`create table if not exists menu_platform_snapshots (
    id uuid primary key default gen_random_uuid(), brand_id uuid not null references brands(id) on delete cascade,
    store_id uuid references stores(id) on delete cascade, external_platform_id uuid not null references menu_external_platforms(id) on delete cascade,
    snapshot_type text not null, rule_version text not null default '', content_hash text not null default '', payload jsonb not null default '{}'::jsonb,
    captured_by_device_id uuid, captured_at timestamptz not null default now(), created_at timestamptz not null default now(),
    check (snapshot_type in ('baseline', 'pre_publish', 'target', 'verification', 'drift'))
  )`,
  sql`create table if not exists menu_publish_batches (
    id uuid primary key default gen_random_uuid(), brand_id uuid not null references brands(id) on delete cascade,
    store_id uuid references stores(id) on delete cascade, status text not null default 'draft', requested_platforms text[] not null default '{}',
    rule_versions jsonb not null default '{}'::jsonb, preview_payload jsonb not null default '{}'::jsonb, target_payload jsonb not null default '{}'::jsonb,
    created_by uuid references employees(id) on delete set null, confirmed_by uuid references employees(id) on delete set null,
    created_at timestamptz not null default now(), confirmed_at timestamptz, completed_at timestamptz, updated_at timestamptz not null default now(),
    check (status in ('draft', 'blocked', 'queued', 'processing', 'partially_succeeded', 'succeeded', 'failed', 'cancelled'))
  )`,
  sql`alter table menu_change_sync_tasks add column if not exists publish_batch_id uuid references menu_publish_batches(id) on delete cascade`,
  sql`alter table menu_change_sync_tasks add column if not exists rule_version text not null default ''`,
  sql`alter table menu_change_sync_tasks add column if not exists current_value jsonb not null default '{}'::jsonb`,
  sql`alter table menu_change_sync_tasks add column if not exists projected_value jsonb not null default '{}'::jsonb`,
  sql`alter table menu_change_sync_tasks add column if not exists command_id uuid`,
  sql`alter table menu_change_sync_tasks add column if not exists phase text not null default 'queued'`,
  sql`alter table menu_change_sync_tasks add column if not exists attempts integer not null default 0`,
  sql`alter table menu_change_sync_tasks add column if not exists max_attempts integer not null default 3`,
  sql`alter table menu_change_sync_tasks add column if not exists error_code text not null default ''`,
  sql`alter table menu_change_sync_tasks add column if not exists error_detail text not null default ''`,
  sql`alter table menu_change_sync_tasks add column if not exists is_retryable boolean not null default true`,
  sql`alter table menu_change_sync_tasks add column if not exists verified_at timestamptz`,
  sql`create index if not exists idx_menu_publish_batches_brand_created on menu_publish_batches(brand_id, created_at desc)`,
  sql`create index if not exists idx_menu_platform_target_settings_target on menu_platform_target_settings(brand_id, target_type, target_id)`,
  sql`create index if not exists idx_menu_platform_object_mappings_target on menu_platform_object_mappings(brand_id, target_type, target_id)`,
  sql`create index if not exists idx_menu_platform_snapshots_latest on menu_platform_snapshots(external_platform_id, snapshot_type, captured_at desc)`,
  sql`create index if not exists idx_menu_change_sync_tasks_batch on menu_change_sync_tasks(publish_batch_id, status, created_at)`
]);

console.log("Menu publishing schema applied.");
