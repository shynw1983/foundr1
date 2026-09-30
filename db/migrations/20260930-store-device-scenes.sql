-- Scene definitions use the existing store-scoped module_settings table.
-- Runs preserve confirmed steps and prevent overlapping or replayed physical commands.
create table if not exists store_device_scene_runs (
  id uuid primary key,
  store_id uuid not null references stores(id) on delete cascade,
  scene_id uuid not null,
  scene_name text not null,
  actor_employee_id uuid references employees(id) on delete set null,
  status text not null default 'running' check (status in ('running','finished','interrupted')),
  steps jsonb not null check (jsonb_typeof(steps) = 'array'),
  worker_token uuid,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 seconds',
  finished_at timestamptz
);
create unique index if not exists idx_store_device_scene_runs_active on store_device_scene_runs(store_id) where status = 'running';
create index if not exists idx_store_device_scene_runs_store on store_device_scene_runs(store_id, started_at desc);
