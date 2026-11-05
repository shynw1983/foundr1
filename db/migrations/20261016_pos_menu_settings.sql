-- POS-only sales configuration. No menu or price is changed by applying this migration.
create table if not exists menu_pos_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  item_id uuid references menu_catalog_items(id) on delete cascade,
  group_id uuid references menu_option_groups(id) on delete cascade,
  option_id uuid references menu_options(id) on delete cascade,
  visible boolean,
  price_override numeric(12,2) check (price_override >= 0 and price_override <= 999999),
  revision bigint not null default 1,
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(item_id,group_id,option_id)=1),
  check (group_id is null or price_override is null),
  unique(store_id,item_id),
  unique(store_id,group_id),
  unique(store_id,option_id)
);
create index if not exists menu_pos_settings_store_brand on menu_pos_settings(store_id,brand_id);
