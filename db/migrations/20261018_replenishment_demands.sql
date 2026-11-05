-- Demand is a shared store/SKU observation and review record, not an order or stock movement.
-- Apply separately after reviewing the target; this migration is additive and keeps existing purchase/receipt facts.
create table if not exists replenishment_demands (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id),
  product_id uuid not null references products(id),
  status text not null default 'open' check (status in ('open','reviewing','deferred','ordered','resolved','dismissed')),
  cycle integer not null default 1 check (cycle > 0),
  version integer not null default 1 check (version > 0),
  quantity integer check (quantity between 1 and 999),
  unit text not null check (length(btrim(unit)) > 0),
  note text not null default '',
  deferred_until timestamptz,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  automatic_fingerprint text,
  automatic_observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, product_id)
);
create index if not exists replenishment_demands_pool_idx on replenishment_demands(store_id,status,updated_at desc);
create table if not exists replenishment_demand_events (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references replenishment_demands(id),
  kind text not null check (kind in ('report','automatic','review','create_order')),
  actor_id uuid references employees(id) on delete set null,
  actor_name text,
  request_id uuid unique,
  request_fingerprint text,
  quantity integer check (quantity between 1 and 999),
  note text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists replenishment_demand_events_history_idx on replenishment_demand_events(demand_id,created_at desc,id);
create table if not exists replenishment_demand_issues (
  request_id uuid primary key,
  request_fingerprint text not null,
  actor_id uuid references employees(id) on delete set null,
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  order_no text not null,
  created_at timestamptz not null default now()
);
create table if not exists replenishment_demand_order_items (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid not null references replenishment_demands(id),
  issue_request_id uuid not null references replenishment_demand_issues(request_id),
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  purchase_order_item_id uuid unique references purchase_order_items(id) on delete set null,
  order_no text not null,
  cycle integer not null default 1 check (cycle > 0),
  requested_quantity integer not null check (requested_quantity between 1 and 999),
  unit text not null check (length(btrim(unit)) > 0),
  created_at timestamptz not null default now(),
  unique(demand_id,issue_request_id)
);
create index if not exists replenishment_demand_order_items_history_idx on replenishment_demand_order_items(demand_id,created_at desc);

-- Store watermark also covers empty snapshots and SKUs that have never had a demand row.
create table if not exists replenishment_demand_sync_state (
  store_id uuid primary key references stores(id),
  observed_at timestamptz not null
);
