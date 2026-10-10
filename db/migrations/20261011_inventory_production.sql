begin;
create table if not exists inventory_transfers (
 id uuid primary key default gen_random_uuid(),
 source_store_id uuid not null references stores(id) on delete restrict,
 target_store_id uuid not null references stores(id) on delete restrict,
 product_id uuid not null references products(id) on delete restrict,
 source_inventory_item_id uuid not null references inventory_items(id) on delete restrict,
 target_inventory_item_id uuid not null references inventory_items(id) on delete restrict,
 quantity numeric(18,6) not null check(quantity>0), received_quantity numeric(18,6) not null default 0,
 unit text not null, status text not null default 'in_transit' check(status in ('in_transit','received')),
 cost_price_jpy numeric(12,2), supply_price_jpy numeric(12,2), snapshot jsonb not null,
 dispatched_by uuid references employees(id) on delete set null, dispatched_at timestamptz not null default now(), received_at timestamptz,
 check(source_store_id<>target_store_id), check(source_inventory_item_id<>target_inventory_item_id),
 check(received_quantity>=0 and received_quantity<=quantity),
 check(cost_price_jpy is null or cost_price_jpy>=0), check(supply_price_jpy is null or supply_price_jpy>=0)
);
create table if not exists inventory_production_operations (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 action text not null check(action in ('produce','transfer_dispatch','transfer_receive')),
 store_id uuid not null references stores(id) on delete restrict,
 recipe_version_id uuid references inventory_recipe_versions(id) on delete restrict,
 transfer_id uuid references inventory_transfers(id) on delete restrict,
 output_inventory_item_id uuid references inventory_items(id) on delete restrict,
 output_quantity numeric(18,6), request_payload jsonb not null, snapshot jsonb not null,
 recorded_by uuid references employees(id) on delete set null, recorded_by_name text not null default '',
 created_at timestamptz not null default now(),
 check((action='produce' and recipe_version_id is not null and transfer_id is null and output_inventory_item_id is not null and output_quantity is not null and output_quantity>0)
   or (action in ('transfer_dispatch','transfer_receive') and recipe_version_id is null and transfer_id is not null))
);
create index if not exists idx_inventory_production_store on inventory_production_operations(store_id,created_at desc);
create index if not exists idx_inventory_transfers_target on inventory_transfers(target_store_id,status,dispatched_at);
create or replace function inventory_production_operation_immutable() returns trigger language plpgsql as $$ begin
 raise exception 'Inventory production history is immutable' using errcode='23000'; end $$;
drop trigger if exists inventory_production_operation_immutable on inventory_production_operations;
create trigger inventory_production_operation_immutable before update or delete on inventory_production_operations for each row execute function inventory_production_operation_immutable();
create or replace function inventory_transfer_source_immutable() returns trigger language plpgsql as $$ begin
 if tg_op='DELETE' or (to_jsonb(new)-'received_quantity'-'status'-'received_at') is distinct from (to_jsonb(old)-'received_quantity'-'status'-'received_at') or new.received_quantity<old.received_quantity then
  raise exception 'Dispatched inventory transfer facts are immutable' using errcode='23000';
 end if; return new; end $$;
drop trigger if exists inventory_transfer_source_immutable on inventory_transfers;
create trigger inventory_transfer_source_immutable before update or delete on inventory_transfers for each row execute function inventory_transfer_source_immutable();
commit;
