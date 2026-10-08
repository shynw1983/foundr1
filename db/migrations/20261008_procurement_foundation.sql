begin;

-- Procurement foundation: additive changes; review publication grants before release.
-- Existing products default to internal. Existing stock and order history are retained.
alter table products add column if not exists catalog_visibility text not null default 'internal';
alter table products add column if not exists is_orderable boolean not null default true;
alter table products drop constraint if exists products_catalog_visibility_check;
alter table products add constraint products_catalog_visibility_check
  check (catalog_visibility in ('internal', 'brand_stores', 'selected_stores'));
create table if not exists product_catalog_store_grants (
  product_id uuid not null references products(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  primary key (product_id, store_id)
);
create index if not exists idx_product_catalog_store_grants_store_product
  on product_catalog_store_grants (store_id, product_id);
alter table purchase_order_items add column if not exists price_feedback_confirmation jsonb;
alter table purchase_order_items add column if not exists quantity_feedback_confirmation jsonb;
-- Historical units were not recorded. Do not infer them from current inventory settings.
alter table inventory_checks add column if not exists count_unit text not null default '';

commit;
