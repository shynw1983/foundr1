-- Additive: preserve existing orders, original item amounts and all prior refunds.
alter table store_customer_order_items add column if not exists refund_snapshot jsonb;
alter table store_customer_order_items add column if not exists refunded_option_keys text[] not null default '{}';
create table if not exists pos_refund_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  order_id uuid not null references store_customer_orders(id) on delete cascade,
  request_id uuid not null,
  request_fingerprint text not null,
  amount integer not null check (amount >= 0),
  allocations jsonb not null,
  reason text not null default '',
  payment_method text not null,
  external_refund_confirmed boolean not null default false,
  created_by uuid references employees(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (store_id, request_id)
);
create index if not exists idx_pos_refund_events_order on pos_refund_events(order_id, created_at);
