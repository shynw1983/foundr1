-- OS-owned local sales snapshots. No catalog is initialized or enabled by DDL.
create table if not exists store_dine_in_menus (
  store_id uuid not null references stores(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  enabled boolean not null default false,
  catalog jsonb not null default '{"version":1,"items":[],"optionGroups":[],"categories":[]}'::jsonb,
  updated_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id,brand_id),
  check (coalesce(jsonb_typeof(catalog)='object' and catalog->>'version'='1'
    and jsonb_typeof(catalog->'items')='array' and jsonb_typeof(catalog->'optionGroups')='array'
    and jsonb_typeof(catalog->'categories')='array',false))
);
create table if not exists store_dine_in_menu_operations (
  store_id uuid not null,
  brand_id uuid not null,
  operation_id uuid not null,
  employee_id uuid not null references employees(id),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (store_id,brand_id,operation_id),
  foreign key (store_id,brand_id) references store_dine_in_menus(store_id,brand_id) on delete cascade
);
