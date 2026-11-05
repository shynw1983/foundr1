-- Additive only: existing orders keep their original pickup codes and production grouping.
create table if not exists pos_pickup_counters (
  store_id uuid primary key references stores(id) on delete cascade,
  last_number bigint not null default 0 check (last_number >= 0)
);
-- Tombstones prevent an abandoned, unrecorded request from arriving late and creating a sale.
create table if not exists pos_abandoned_checkouts (
  store_id uuid not null references stores(id) on delete cascade,
  request_id text not null,
  abandoned_by uuid not null references employees(id),
  abandoned_at timestamptz not null default now(),
  primary key (store_id, request_id)
);
alter table store_customer_order_items add column if not exists pickup_code text not null default '';
alter table store_customer_order_items add column if not exists preparation_note text not null default '';
alter table order_production_tasks add column if not exists order_item_id uuid references store_customer_order_items(id) on delete cascade;
alter table order_production_tasks add column if not exists pickup_code text not null default '';
alter table order_production_tasks add column if not exists handed_off_at timestamptz;
create index if not exists idx_production_order_item on order_production_tasks(order_item_id) where order_item_id is not null;
create index if not exists idx_customer_items_pickup on store_customer_order_items(order_id, pickup_code) where pickup_code <> '';
