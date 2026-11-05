-- Additive. No store is enabled by this migration. Configure and verify before enabling.
create table if not exists store_relay_stations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id),
  name text not null default 'レジ A',
  enabled boolean not null default false,
  print_enabled boolean not null default false,
  scale_enabled boolean not null default false,
  epoch integer not null default 0,
  owner_hash text not null default '',
  owner_employee_id uuid references employees(id),
  owner_session_id text not null default '',
  owner_until timestamptz,
  scale_session uuid,
  scale_sequence bigint not null default -1,
  scale_reading jsonb,
  scale_received_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(store_id, name)
);
create table if not exists store_relay_devices (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null unique references store_relay_stations(id),
  token_hash text not null default '',
  pairing_hash text not null default '',
  pairing_until timestamptz,
  revoked boolean not null default false,
  heartbeat_at timestamptz,
  status jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists store_relay_print_jobs (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references store_relay_stations(id),
  store_id uuid not null references stores(id),
  order_id uuid references store_customer_orders(id),
  document_key text not null unique,
  sequence integer not null,
  kind text not null check (kind in ('kitchen','pickup','receipt','test')),
  payload jsonb not null,
  state text not null default 'pending' check (state in ('pending','sending','sent','uncertain','cancelled')),
  claim_token uuid,
  claimed_by uuid references store_relay_devices(id),
  claimed_at timestamptz,
  error text not null default '',
  reprint_of uuid references store_relay_print_jobs(id),
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists store_relay_jobs_station_queue on store_relay_print_jobs(station_id,created_at,sequence);
create table if not exists store_relay_events (
  id bigint generated always as identity primary key,
  station_id uuid not null references store_relay_stations(id),
  employee_id uuid references employees(id),
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists store_relay_scale_captures (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references store_relay_stations(id),
  session_id uuid not null unique,
  epoch integer not null,
  employee_id uuid not null references employees(id),
  grams numeric not null check(grams>0 and grams<=3000),
  reading jsonb not null,
  received_at timestamptz not null,
  order_id uuid references store_customer_orders(id),
  created_at timestamptz not null default now()
);
