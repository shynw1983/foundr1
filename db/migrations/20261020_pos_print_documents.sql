-- Durable document snapshots are separate from transport-specific relay jobs.
create table if not exists pos_print_documents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  order_id uuid not null references store_customer_orders(id) on delete cascade,
  item_id uuid references store_customer_order_items(id) on delete cascade,
  brand_id uuid references brands(id) on delete set null,
  document_key text not null,
  kind text not null check (kind in ('kitchen','finishing','pickup','receipt')),
  sequence integer not null,
  copy_number integer not null default 1,
  pickup_code text not null default '',
  target text not null check (target in ('receipt','kitchen')),
  payload jsonb not null,
  mode text not null check (mode in ('auto','deferred','none')),
  state text not null check (state in ('not_requested','pending','sending','sent','uncertain','cancelled')),
  revision integer not null default 0,
  transport text check (transport in ('direct','relay')),
  relay_job_id uuid references store_relay_print_jobs(id),
  claim_token uuid,
  claim_operation_id uuid,
  claimed_by uuid references employees(id) on delete set null,
  claimed_at timestamptz,
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,document_key)
);
create index if not exists pos_print_documents_store_queue on pos_print_documents(store_id,state,created_at,id);
create index if not exists pos_print_documents_order on pos_print_documents(order_id,sequence);
create table if not exists pos_print_document_operations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references pos_print_documents(id) on delete cascade,
  operation_id uuid not null,
  action text not null check (action in ('claim','ack','confirmPrinted','voidIneligible')),
  employee_id uuid not null,
  request_fingerprint text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(document_id,operation_id)
);
