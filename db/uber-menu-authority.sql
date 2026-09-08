-- Uber is the menu authority for explicitly configured brands only.
-- Deploy external-ID-keyed mapping writers before applying this migration.
alter table menu_platform_object_mappings
 drop constraint if exists menu_platform_object_mappings_external_platform_id_target_t_key;

create table if not exists menu_uber_sources (
 id uuid primary key default gen_random_uuid(),
 brand_id uuid not null unique references brands(id) on delete cascade,
 store_id uuid not null references stores(id) on delete cascade,
 uber_store_uuid text not null,
 enabled boolean not null default false,
 auto_publish boolean not null default false,
 publish_config jsonb not null default '{}',
 revision integer not null default 0,
 last_catalog jsonb,
 last_content_hash text not null default '',
 missing_keys text[] not null default '{}',
 last_checked_at timestamptz,
 last_error text not null default '',
 updated_at timestamptz not null default now()
);
alter table menu_uber_sources add column if not exists publish_config jsonb not null default '{}';
create table if not exists menu_uber_objects (
 source_id uuid not null references menu_uber_sources(id) on delete cascade,
 source_key text not null,
 kind text not null check (kind in ('item','option','category','option_group')),
 uber_id text not null,
 parent_uber_id text not null default '',
 target_id uuid not null,
 price_mode text not null default 'manual' check (price_mode in ('manual','automatic')),
 last_uber_price numeric,
 source_payload jsonb not null default '{}',
 archived boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key (source_id, source_key),
 unique (source_id, kind, target_id)
);
create table if not exists menu_uber_creation_attempts (
 source_id uuid not null references menu_uber_sources(id) on delete cascade,
 platform text not null check (platform in ('rocket_now','demae_can')),
 source_key text not null,
 status text not null check (status in ('creating','identified','rejected')),
 external_id text not null default '',
 external_parent_id text not null default '',
 command_id uuid not null,
 updated_at timestamptz not null default now(),
 primary key (source_id,platform,source_key)
);
alter table menu_uber_creation_attempts drop constraint if exists menu_uber_creation_attempts_status_check;
alter table menu_uber_creation_attempts add constraint menu_uber_creation_attempts_status_check check(status in ('creating','identified','rejected'));
create table if not exists menu_uber_sync_runs (
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references menu_uber_sources(id) on delete cascade,
 command_id uuid unique,
 revision integer not null,
 content_hash text not null,
 summary jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create or replace function lock_menu_uber_revision(source_uuid uuid, expected_revision integer)
returns void language plpgsql as $$
declare actual_revision integer;
begin
 select revision into actual_revision from menu_uber_sources where id=source_uuid and enabled=true for update;
 if actual_revision is null or actual_revision <> expected_revision then
  raise exception 'uber_source_revision_conflict';
 end if;
end;
$$;
