-- Internal push delivery receipts. 'sent' means provider acceptance, not device acknowledgement.
-- This additive migration does not change menu availability or bridge command state.
create table if not exists menu_inventory_sync_alert_deliveries (
  command_id uuid not null references local_bridge_commands(id) on delete cascade,
  recipient_employee_id uuid not null references employees(id) on delete cascade,
  channel text not null check (channel in ('web_push', 'fcm')),
  destination_key text not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  lease_token uuid not null,
  lease_until timestamptz not null,
  next_attempt_at timestamptz not null default now(),
  last_error text not null default '',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (command_id, recipient_employee_id, channel, destination_key)
);
create index if not exists menu_inventory_sync_alert_deliveries_retry
  on menu_inventory_sync_alert_deliveries(next_attempt_at, lease_until)
  where status <> 'sent';
