create extension if not exists pgcrypto;

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  owner_name text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  brand_type text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists store_brands (
  store_id uuid not null references stores(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  primary key (store_id, brand_id)
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  login_id text unique,
  email text unique,
  password_hash text,
  role text not null,
  status text not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table employees add column if not exists last_seen_at timestamptz;

create table if not exists employee_scopes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  scope_type text not null,
  store_id uuid references stores(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade,
  supplier_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references product_categories(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_brand_name text,
  manufacturer text,
  category text not null,
  subcategory text,
  unit text not null,
  reference_price numeric(12, 2),
  origin_countries text[] not null default '{}',
  package_quantity numeric(12, 3),
  package_quantity_unit text,
  package_spec text,
  spec_note text,
  photo_url text,
  brand_scope text not null default 'unset',
  is_key_item boolean not null default false,
  is_price_sensitive boolean not null default false,
  storage_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products add column if not exists spec_note text;
alter table products add column if not exists photo_url text;
alter table products add column if not exists storage_type text;
alter table products add column if not exists subcategory text;
alter table products add column if not exists origin_countries text[] not null default '{}';
alter table products add column if not exists package_quantity numeric(12, 3);
alter table products add column if not exists package_quantity_unit text;
alter table products add column if not exists package_spec text;
alter table products add column if not exists product_brand_name text;
alter table products add column if not exists manufacturer text;
alter table products add column if not exists brand_scope text not null default 'unset';
alter table products drop constraint if exists products_name_key;

create table if not exists product_brand_usages (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  usage_note text,
  default_order_quantity text,
  spec_note text,
  priority text not null default 'medium',
  is_orderable boolean not null default true,
  sort_order integer not null default 0,
  unique (product_id, brand_id)
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  channel_type text not null,
  reliability text,
  address text,
  phone text,
  contact_person text,
  business_hours text,
  order_url text,
  contact_note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists supplier_locations (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  name text not null,
  location_type text not null,
  area text,
  address text,
  opening_hours text,
  purchase_method text,
  supports_delivery boolean not null default false,
  supports_urgent_purchase boolean not null default false,
  note text,
  unique (supplier_id, name)
);

create table if not exists product_supplier_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  preferred_location_id uuid references supplier_locations(id) on delete set null,
  role text not null,
  reference_price numeric(12, 2),
  min_order_quantity text,
  lead_time text,
  note text,
  is_active boolean not null default true,
  unique (product_id, supplier_id, role)
);

create table if not exists field_notes (
  id uuid primary key default gen_random_uuid(),
  note_type text not null default 'idea',
  title text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text,
  supplier_location text,
  product_name text,
  observed_price numeric(12, 2),
  photo_url text,
  note text,
  status text not null default 'open',
  recorded_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table field_notes add column if not exists note_type text not null default 'idea';
alter table field_notes add column if not exists title text not null default '';
alter table field_notes add column if not exists supplier_id uuid references suppliers(id) on delete set null;
alter table field_notes add column if not exists supplier_name text;
alter table field_notes add column if not exists supplier_location text;
alter table field_notes add column if not exists product_name text;
alter table field_notes add column if not exists observed_price numeric(12, 2);
alter table field_notes add column if not exists photo_url text;
alter table field_notes add column if not exists note text;
alter table field_notes add column if not exists status text not null default 'open';
alter table field_notes add column if not exists recorded_by uuid references employees(id);

create table if not exists field_note_comments (
  id uuid primary key default gen_random_uuid(),
  field_note_id uuid not null references field_notes(id) on delete cascade,
  comment text not null,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create table if not exists product_comparisons (
  id uuid primary key default gen_random_uuid(),
  base_product_id uuid references products(id) on delete set null,
  candidate_product_name text not null,
  candidate_supplier_id uuid references suppliers(id) on delete set null,
  candidate_supplier_name text,
  candidate_origin text,
  candidate_price numeric(12, 2) not null default 0,
  candidate_original_price numeric(12, 2) not null default 0,
  candidate_currency text not null default 'JPY',
  exchange_rate numeric(12, 6) not null default 1,
  candidate_quantity numeric(12, 3) not null default 1,
  candidate_unit text not null default 'g',
  candidate_weight_kg numeric(12, 3) not null default 0,
  import_quantity numeric(12, 3) not null default 1,
  freight_rate_per_kg numeric(12, 2) not null default 0,
  freight_rate_original_per_kg numeric(12, 2) not null default 0,
  base_price numeric(12, 2) not null default 0,
  base_quantity numeric(12, 3) not null default 1,
  base_unit text not null default 'g',
  is_imported boolean not null default false,
  freight_cost numeric(12, 2) not null default 0,
  tax_cost numeric(12, 2) not null default 0,
  other_cost numeric(12, 2) not null default 0,
  photo_url text,
  note text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table product_comparisons add column if not exists base_product_id uuid references products(id) on delete set null;
alter table product_comparisons add column if not exists candidate_product_name text not null default '';
alter table product_comparisons add column if not exists candidate_supplier_id uuid references suppliers(id) on delete set null;
alter table product_comparisons add column if not exists candidate_supplier_name text;
alter table product_comparisons add column if not exists candidate_origin text;
alter table product_comparisons add column if not exists candidate_price numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists candidate_original_price numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists candidate_currency text not null default 'JPY';
alter table product_comparisons add column if not exists exchange_rate numeric(12, 6) not null default 1;
alter table product_comparisons add column if not exists candidate_quantity numeric(12, 3) not null default 1;
alter table product_comparisons add column if not exists candidate_unit text not null default 'g';
alter table product_comparisons add column if not exists candidate_weight_kg numeric(12, 3) not null default 0;
alter table product_comparisons add column if not exists import_quantity numeric(12, 3) not null default 1;
alter table product_comparisons add column if not exists freight_rate_per_kg numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists freight_rate_original_per_kg numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists base_price numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists base_quantity numeric(12, 3) not null default 1;
alter table product_comparisons add column if not exists base_unit text not null default 'g';
alter table product_comparisons add column if not exists is_imported boolean not null default false;
alter table product_comparisons add column if not exists freight_cost numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists tax_cost numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists other_cost numeric(12, 2) not null default 0;
alter table product_comparisons add column if not exists photo_url text;
alter table product_comparisons add column if not exists note text;
alter table product_comparisons add column if not exists created_by uuid references employees(id);

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  store_id uuid not null references stores(id),
  brand_id uuid references brands(id),
  requested_by uuid references employees(id),
  assigned_to uuid references employees(id),
  deadline_label text,
  deadline_at timestamptz,
  expected_arrival_date date,
  online_order_status text not null default 'not_started',
  requested_item_count integer not null default 0,
  priority text not null default 'medium',
  status text not null default 'submitted',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid not null references products(id),
  brand_id uuid references brands(id),
  requested_quantity numeric(12, 2) not null,
  requested_unit text not null,
  note text,
  status text not null default 'requested'
);

alter table purchase_order_items add column if not exists brand_id uuid references brands(id);
alter table purchase_order_items add column if not exists actual_quantity numeric(12, 2);
alter table purchase_order_items add column if not exists actual_price numeric(12, 2);
alter table purchase_order_items add column if not exists procurement_note text;
alter table purchase_order_items add column if not exists price_exception_note text;
alter table purchase_order_items add column if not exists selected_supplier_id uuid references suppliers(id);
alter table purchase_order_items add column if not exists store_feedback_confirmed_at timestamptz;
alter table purchase_order_items add column if not exists store_feedback_confirmed_by uuid references employees(id);

alter table purchase_orders add column if not exists expected_arrival_date date;
alter table purchase_orders add column if not exists online_order_status text not null default 'not_started';
alter table purchase_orders add column if not exists requested_by uuid references employees(id);
alter table purchase_orders add column if not exists assigned_to uuid references employees(id);
alter table suppliers add column if not exists address text;
alter table suppliers add column if not exists phone text;
alter table suppliers add column if not exists contact_person text;
alter table suppliers add column if not exists business_hours text;
alter table suppliers add column if not exists order_url text;

create table if not exists ops_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_employee_id uuid not null references employees(id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists purchase_actuals (
  id uuid primary key default gen_random_uuid(),
  purchase_order_item_id uuid not null references purchase_order_items(id) on delete cascade,
  supplier_id uuid references suppliers(id),
  supplier_location_id uuid references supplier_locations(id),
  actual_quantity numeric(12, 2),
  actual_unit text,
  actual_price numeric(12, 2),
  price_is_exception boolean not null default false,
  note text,
  recorded_by uuid references employees(id),
  recorded_at timestamptz not null default now()
);

alter table purchase_actuals add column if not exists actual_price numeric(12, 2);

create table if not exists delivery_batches (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  batch_no integer not null,
  status text not null default 'in_delivery',
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  store_confirmed_at timestamptz,
  store_confirmed_by uuid references employees(id),
  unique (purchase_order_id, batch_no)
);

alter table delivery_batches add column if not exists store_confirmed_at timestamptz;
alter table delivery_batches add column if not exists store_confirmed_by uuid references employees(id);

create table if not exists delivery_batch_items (
  delivery_batch_id uuid not null references delivery_batches(id) on delete cascade,
  purchase_order_item_id uuid not null references purchase_order_items(id) on delete cascade,
  primary key (delivery_batch_id, purchase_order_item_id),
  unique (purchase_order_item_id)
);

create table if not exists purchase_exceptions (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  purchase_order_item_id uuid references purchase_order_items(id) on delete cascade,
  exception_type text not null,
  message text not null,
  resolution_note text,
  needs_store_confirmation boolean not null default false,
  affects_operation boolean not null default false,
  follow_up_at timestamptz,
  status text not null default 'open',
  resolved_by uuid references employees(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table purchase_exceptions add column if not exists resolved_by uuid references employees(id);
alter table purchase_exceptions add column if not exists resolved_at timestamptz;

create table if not exists price_records (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  supplier_id uuid references suppliers(id),
  supplier_location_id uuid references supplier_locations(id),
  price numeric(12, 2) not null,
  unit text not null,
  source text not null default 'manual',
  receipt_note text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references employees(id)
);

create index if not exists idx_purchase_orders_store_status on purchase_orders(store_id, status);
create index if not exists idx_purchase_orders_deadline on purchase_orders(deadline_at);
create index if not exists idx_delivery_batches_order_status on delivery_batches(purchase_order_id, status);
create index if not exists idx_purchase_exceptions_status on purchase_exceptions(status);
create index if not exists idx_price_records_product_recorded on price_records(product_id, recorded_at desc);
create index if not exists idx_ops_notifications_recipient_read on ops_notifications(recipient_employee_id, read_at, created_at desc);
