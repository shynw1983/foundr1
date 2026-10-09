begin;
create table if not exists menu_product_links (
  id uuid primary key default gen_random_uuid(),
  menu_catalog_item_id uuid references menu_catalog_items(id) on delete cascade,
  menu_option_id uuid references menu_options(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_product_links_exactly_one_target check (num_nonnulls(menu_catalog_item_id, menu_option_id) = 1),
  unique(menu_catalog_item_id, product_id),
  unique(menu_option_id, product_id)
);
create index if not exists idx_menu_product_links_product on menu_product_links(product_id);
alter table purchase_orders add column if not exists replenishment_source jsonb;
commit;
