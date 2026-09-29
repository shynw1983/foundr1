-- Additive pilot schema. Contains no credentials or live device bindings.
create table if not exists store_light_runtime (
  store_id uuid not null references stores(id) on delete cascade,
  device_id text not null,
  sample jsonb,
  fetched_at timestamptz,
  read_error boolean not null default false,
  refresh_after timestamptz not null default '-infinity',
  refresh_token uuid,
  blocked_until timestamptz,
  primary key (store_id, device_id)
);
create table if not exists store_light_commands (
  id uuid primary key,
  store_id uuid not null references stores(id) on delete cascade,
  device_id text not null,
  actor_employee_id uuid references employees(id) on delete set null,
  result text not null check (result in ('pending','accepted','rejected','unknown')),
  before_state text not null default 'unknown' check (before_state in ('on','off','unknown')),
  before_level smallint check (before_level between 1 and 20),
  reason text not null default '',
  requested_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_store_light_commands_device on store_light_commands(store_id, device_id, requested_at desc);
