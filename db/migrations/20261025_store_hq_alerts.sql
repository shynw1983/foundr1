-- Separate from account/bell notifications. Additive; no existing business rows changed.
create table if not exists store_hq_alerts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id),
  sender_employee_id uuid references employees(id) on delete set null,
  sender_name text not null,
  request_id uuid not null,
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (sender_employee_id, request_id)
);
create index if not exists store_hq_alerts_store_created_idx on store_hq_alerts(store_id, created_at desc, id desc);
create table if not exists store_hq_alert_receipts (
  alert_id uuid not null references store_hq_alerts(id) on delete cascade,
  device_id uuid not null,
  device_label text not null,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  reader_employee_id uuid references employees(id) on delete set null,
  reader_name text,
  primary key (alert_id, device_id),
  check (read_at is null or read_at >= delivered_at),
  check (read_at is null or reader_name is not null)
);
create index if not exists store_hq_alert_receipts_read_idx on store_hq_alert_receipts(alert_id, read_at) where read_at is not null;
