begin;
create table if not exists product_packaging_templates (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references products(id) on delete restrict,
 supplier_id uuid references suppliers(id) on delete restrict, name text not null,
 packaging jsonb not null check(jsonb_typeof(packaging)='object'), status text not null default 'active' check(status in ('active','inactive')),
 create_request_payload jsonb,
 created_by uuid references employees(id) on delete set null, updated_by uuid references employees(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_product_packaging_templates_product on product_packaging_templates(product_id,status);
alter table product_packaging_templates add column if not exists create_request_payload jsonb;
create unique index if not exists idx_product_packaging_templates_name on product_packaging_templates(product_id,name);
-- Unknown old batches remain unknown; do not backfill from today's master or shipping weight.
alter table purchase_order_items add column if not exists actual_packaging_snapshot jsonb;
alter table purchase_actuals add column if not exists packaging_snapshot jsonb;
alter table price_records add column if not exists packaging_snapshot jsonb;
alter table inventory_stock_receipts add column if not exists batch_packaging_snapshot jsonb;
commit;
