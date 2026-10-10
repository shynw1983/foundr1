begin;
create table if not exists inventory_recipes (
 id uuid primary key default gen_random_uuid(), brand_id uuid not null references brands(id) on delete restrict,
 name text not null, kind text not null check(kind in ('menu','production')),
 target_type text check(target_type in ('item','option')), target_id uuid,
 output_product_id uuid references products(id) on delete restrict,
 current_version_id uuid, status text not null default 'active' check(status in ('active','inactive')),
 create_request_payload jsonb,
 created_by uuid references employees(id) on delete set null, updated_by uuid references employees(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint inventory_recipes_target check(
  (kind='menu' and target_type is not null and target_id is not null and output_product_id is null)
  or (kind='production' and target_type is null and target_id is null and output_product_id is not null))
);
alter table inventory_recipes add column if not exists create_request_payload jsonb;
create unique index if not exists idx_inventory_recipes_active_menu on inventory_recipes(brand_id,target_type,target_id) where kind='menu' and status='active';
create table if not exists inventory_recipe_versions (
 id uuid primary key default gen_random_uuid(), recipe_id uuid not null references inventory_recipes(id) on delete restrict,
 version integer not null check(version > 0), snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 created_by uuid references employees(id) on delete set null, created_at timestamptz not null default now(), unique(recipe_id,version)
);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='inventory_recipes_current_version_fk' and conrelid='inventory_recipes'::regclass) then
  alter table inventory_recipes add constraint inventory_recipes_current_version_fk foreign key(current_version_id) references inventory_recipe_versions(id) on delete restrict;
 end if;
end $$;
create table if not exists inventory_recipe_version_products (
 recipe_version_id uuid not null references inventory_recipe_versions(id) on delete restrict,
 product_id uuid not null references products(id) on delete restrict, primary key(recipe_version_id,product_id)
);
create or replace function inventory_recipe_version_immutable() returns trigger language plpgsql as $$ begin
 if tg_op='DELETE' or new.snapshot is distinct from old.snapshot or new.recipe_id is distinct from old.recipe_id or new.version is distinct from old.version then
  raise exception 'Published inventory recipe versions are immutable' using errcode='23000';
 end if; return new;
end $$;
drop trigger if exists inventory_recipe_version_immutable on inventory_recipe_versions;
create trigger inventory_recipe_version_immutable before update or delete on inventory_recipe_versions for each row execute function inventory_recipe_version_immutable();
commit;
