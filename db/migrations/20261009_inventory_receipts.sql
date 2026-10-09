begin;

-- Initialize book stock exactly once. Re-running must never reset later receipts or counts.
do $$ declare initialize_stock boolean; begin
  initialize_stock := not exists(select 1 from pg_attribute where attrelid = 'inventory_items'::regclass and attname = 'stock_quantity' and not attisdropped);
  alter table inventory_items add column if not exists stock_quantity numeric(18, 6);
  alter table inventory_items add column if not exists stock_conversion_snapshot jsonb;
  alter table inventory_items add column if not exists stock_revision integer not null default 0;
  alter table inventory_items add column if not exists last_received_at timestamptz;
  if initialize_stock then
    update inventory_items set stock_quantity = current_quantity, stock_conversion_snapshot = count_conversion_snapshot
      where current_quantity is not null;
  end if;
end $$;

create table if not exists inventory_stock_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  purchase_order_item_id uuid not null references purchase_order_items(id) on delete restrict,
  purchase_order_id uuid not null references purchase_orders(id) on delete restrict,
  store_id uuid not null references stores(id) on delete restrict,
  product_id uuid not null references products(id) on delete restrict,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  purchase_quantity numeric(18, 6) not null check (purchase_quantity > 0),
  purchase_unit text not null,
  count_quantity numeric(18, 6) not null check (count_quantity > 0),
  count_unit text not null,
  mode text not null check (mode in ('add', 'included')),
  before_stock_quantity numeric(18, 6),
  after_stock_quantity numeric(18, 6),
  conversion_snapshot jsonb not null,
  source_snapshot jsonb not null,
  request_payload jsonb not null,
  recorded_by uuid references employees(id) on delete set null,
  recorded_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_inventory_stock_receipts_source on inventory_stock_receipts(purchase_order_item_id, created_at);
create index if not exists idx_inventory_stock_receipts_store on inventory_stock_receipts(store_id, created_at desc);
create index if not exists idx_inventory_stock_receipts_item on inventory_stock_receipts(inventory_item_id, created_at desc);

commit;
