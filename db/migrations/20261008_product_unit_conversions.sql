begin;

-- Relations are explicit. Existing names/specifications and historical counts are not interpreted or backfilled.
alter table products add column if not exists inventory_unit_conversions jsonb not null default '[]'::jsonb;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid = 'products'::regclass and conname = 'products_inventory_unit_conversions_array') then
    alter table products add constraint products_inventory_unit_conversions_array check (jsonb_typeof(inventory_unit_conversions) = 'array');
  end if;
end $$;
alter table inventory_items add column if not exists count_conversion_snapshot jsonb;
alter table inventory_checks add column if not exists unit_conversion_snapshot jsonb;

-- Widen precision without changing the value or meaning of recorded quantities.
alter table inventory_items alter column current_quantity type numeric(18, 6), alter column safety_stock type numeric(18, 6);
alter table inventory_checks alter column quantity type numeric(18, 6);

commit;
