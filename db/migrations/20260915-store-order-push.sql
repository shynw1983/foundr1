-- Additive migration. Apply only to the approved target before enabling STORE_ORDER_PUSH_ENABLED.
create table if not exists store_order_push_preferences (
  employee_id uuid not null references employees(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  enabled boolean not null default false,
  exit_radius_m integer not null default 500 check (exit_radius_m between 150 and 10000),
  enter_radius_m integer not null default 300 check (enter_radius_m >= 100 and enter_radius_m < exit_radius_m),
  rule_version uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  primary key (employee_id, store_id)
);
create table if not exists store_order_push_devices (
  id uuid primary key,
  employee_id uuid not null references employees(id) on delete cascade,
  session_id uuid not null references employee_sessions(id) on delete cascade,
  provider text not null default 'fcm' check (provider = 'fcm'),
  presence_token_hash text not null,
  endpoint_hash text not null unique,
  registration jsonb not null,
  language text not null default 'ja' check (language in ('ja', 'zh-Hans', 'zh-Hant')),
  revoked_at timestamptz,
  last_success_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_store_order_push_devices_employee on store_order_push_devices(employee_id, revoked_at);
create table if not exists store_order_push_presence (
  device_id uuid not null references store_order_push_devices(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  rule_key text not null,
  state text not null check (state in ('inside', 'outside', 'unknown')),
  observed_at timestamptz not null,
  primary key (device_id, store_id)
);
create table if not exists store_order_push_deliveries (
  event_id uuid not null references store_order_alert_events(id) on delete cascade,
  device_id uuid not null references store_order_push_devices(id) on delete cascade,
  attempt integer not null check (attempt between 0 and 3),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  lease_until timestamptz not null default now(),
  last_error text not null default '',
  updated_at timestamptz not null default now(),
  primary key (event_id, device_id, attempt)
);
