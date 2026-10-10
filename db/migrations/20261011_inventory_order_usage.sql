begin;

create table if not exists inventory_usage_settings (
  store_id uuid primary key references stores(id) on delete cascade,
  enabled boolean not null default false,
  enabled_from timestamptz,
  trigger_mode text not null default 'preparation' check (trigger_mode in ('preparation','confirmed_sale')),
  revision integer not null default 0 check (revision >= 0),
  updated_by uuid references employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (not enabled or enabled_from is not null)
);
create table if not exists inventory_product_usage_locations (
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  updated_by uuid references employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (store_id,product_id)
);

alter table store_customer_orders add column if not exists inventory_items_ready_at timestamptz;
alter table store_customer_orders add column if not exists inventory_source_snapshot jsonb;
alter table store_customer_orders add column if not exists inventory_first_prepared_at timestamptz;
alter table store_customer_orders add column if not exists inventory_preparation_source_snapshot jsonb;
-- Retain prior preparation evidence when an old task is later reset to New.
-- Do not mark historical item sets ready or invent consumption of old orders.
update store_customer_orders orders
set inventory_first_prepared_at = coalesce(orders.preparing_at,orders.ready_at,orders.completed_at,
  (select min(tasks.started_at) from order_production_tasks tasks where tasks.order_id=orders.id))
where orders.inventory_first_prepared_at is null and (
  orders.preparing_at is not null or orders.ready_at is not null or orders.completed_at is not null
  or exists(select 1 from order_production_tasks tasks where tasks.order_id=orders.id and tasks.started_at is not null)
);

create table if not exists inventory_order_usage_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references store_customer_orders(id) on delete restrict,
  store_id uuid not null references stores(id) on delete restrict,
  occurred_at timestamptz not null,
  source_snapshot jsonb not null,
  plan_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists inventory_movements (
  id bigint generated always as identity primary key,
  operation_key text not null unique,
  store_id uuid not null references stores(id) on delete restrict,
  product_id uuid not null references products(id) on delete restrict,
  inventory_item_id uuid references inventory_items(id) on delete restrict,
  kind text not null check(kind in ('receipt','count','order_use','production_input','production_output','adjustment','transfer_out','transfer_in')),
  quantity numeric(18,6),
  count_unit text not null default '',
  confidence text not null check(confidence in ('exact','estimate','unmeasured')),
  exposure numeric(18,6) not null default 0 check(exposure >= 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  source_order_id uuid,
  source_order_item_id uuid,
  recipe_version_id uuid,
  before_quantity numeric(18,6),
  after_quantity numeric(18,6),
  changes_stock boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  check(not changes_stock or (confidence='exact' and quantity is not null and inventory_item_id is not null))
);
do $$ begin
  if to_regclass('inventory_recipe_versions') is not null and not exists(
    select 1 from pg_constraint where conrelid='inventory_movements'::regclass and conname='inventory_movements_recipe_version_fk'
  ) then
    alter table inventory_movements add constraint inventory_movements_recipe_version_fk
      foreign key(recipe_version_id) references inventory_recipe_versions(id) on delete restrict;
  end if;
end $$;
create index if not exists idx_inventory_movements_item_time on inventory_movements(inventory_item_id,occurred_at,id);
create index if not exists idx_inventory_movements_store_order on inventory_movements(store_id,source_order_id);
create index if not exists idx_inventory_order_usage_store_time on inventory_order_usage_events(store_id,occurred_at desc);

create table if not exists inventory_order_usage_issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references store_customer_orders(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  code text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(order_id,code)
);
create index if not exists idx_inventory_order_usage_issues_store on inventory_order_usage_issues(store_id,resolved_at,updated_at desc);

commit;
