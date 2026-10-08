-- One-time preservation of the current store catalog.
-- Apply only when preserving the previous visibility range is authorized.
-- Run before 20261008_procurement_foundation.sql, which may follow in the same transaction.
-- New products default to internal; new stores inherit no grants.
-- Refuse to overwrite any already-configured publication policies.
begin;

-- Prevent product/store/brand-association additions during the snapshot and migration.
lock table products, stores, product_brand_usages, store_brands in share row exclusive mode;

do $$
begin
  if exists (
    select 1 from pg_attribute
    where attrelid = 'products'::regclass and attname = 'catalog_visibility' and not attisdropped
  ) then
    raise exception 'catalog_visibility already exists; refuse to backfill over configured or newly-created policies';
  end if;
end $$;

create temporary table legacy_catalog_products on commit drop as
  select id from products;
create temporary table legacy_catalog_expected_pairs on commit drop as
  select distinct products.id as product_id, stores.id as store_id
  from products cross join stores
  where coalesce(products.brand_scope, 'unset') = 'common'
    or exists (
      select 1
      from product_brand_usages usage
      join store_brands on store_brands.brand_id = usage.brand_id
      where usage.product_id = products.id and store_brands.store_id = stores.id
    );

-- Old listing SQL relied on an explicit product_brand_usages relation regardless of brand_scope.
-- Normalize that existing relation to the new policy's specific marker; add no new association.
update products set brand_scope = 'specific'
where id in (select id from legacy_catalog_products)
  and coalesce(brand_scope, 'unset') not in ('common', 'specific')
  and exists(select 1 from product_brand_usages usage where usage.product_id = products.id);

-- Refuse to silently activate an old, previously-unused stop flag and interrupt existing ordering.
-- These flags are neither cleared nor reinterpreted by this data-preserving migration.
do $$
begin
  if exists (
    select 1 from legacy_catalog_expected_pairs pairs
    where exists (
      select 1 from product_brand_usages usage join store_brands on store_brands.brand_id = usage.brand_id
      where usage.product_id = pairs.product_id and store_brands.store_id = pairs.store_id
    ) and not exists (
      select 1 from product_brand_usages usage join store_brands on store_brands.brand_id = usage.brand_id
      where usage.product_id = pairs.product_id and store_brands.store_id = pairs.store_id and usage.is_orderable
    )
  ) then
    raise exception 'Previously-visible store/SKU pairs have dormant is_orderable=false flags; review before enforcement';
  end if;
end $$;

alter table products add column catalog_visibility text not null default 'internal';
alter table products add column is_orderable boolean not null default true;
alter table products add constraint products_catalog_visibility_check
  check (catalog_visibility in ('internal', 'brand_stores', 'selected_stores'));
create table product_catalog_store_grants (
  product_id uuid not null references products(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  primary key(product_id, store_id)
);
create index idx_product_catalog_store_grants_store_product on product_catalog_store_grants(store_id, product_id);

insert into product_catalog_store_grants(product_id, store_id)
select product_id, store_id from legacy_catalog_expected_pairs;
update products set catalog_visibility = 'selected_stores'
where id in (select distinct product_id from legacy_catalog_expected_pairs);

-- Exact new-visible-pair comparison after normalization. Any expansion or loss aborts the transaction.
do $$
begin
  if exists (
    with actual_pairs as (
      select distinct products.id as product_id, stores.id as store_id
      from products cross join stores
      where products.catalog_visibility = 'selected_stores'
        and exists(select 1 from product_catalog_store_grants grants where grants.product_id = products.id and grants.store_id = stores.id)
        and (products.brand_scope = 'common' or (products.brand_scope = 'specific' and exists (
          select 1 from product_brand_usages usage join store_brands on store_brands.brand_id = usage.brand_id
          where usage.product_id = products.id and store_brands.store_id = stores.id
        )))
    ), differences as (
      (select product_id, store_id from actual_pairs except select product_id, store_id from legacy_catalog_expected_pairs)
      union all
      (select product_id, store_id from legacy_catalog_expected_pairs except select product_id, store_id from actual_pairs)
    ) select 1 from differences
  ) then
    raise exception 'Compatibility visibility delta is nonzero; publication migration rejected';
  end if;
end $$;

select count(*) as preserved_store_sku_pairs from product_catalog_store_grants;
select catalog_visibility, count(*) as product_count from products group by catalog_visibility order by catalog_visibility;
commit;
