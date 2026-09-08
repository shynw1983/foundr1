create table if not exists menu_uber_option_migrations (
 source_id uuid not null references menu_uber_sources(id) on delete cascade,
 platform text not null check (platform='rocket_now'),
 migration_key text not null,
 state jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(source_id,platform,migration_key),
 check(state->>'phase' in ('reserved','received','prepared','complete'))
);
