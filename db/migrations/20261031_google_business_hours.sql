-- Apply before deploying the Google Business hours integration. No existing shift/business-hour data is rewritten.
alter table timecard_shift_publications add column if not exists shift_snapshot jsonb;
create table if not exists google_business_connections (
  store_id uuid primary key references stores(id) on delete cascade,
  token_ciphertext text,
  location_name text unique,
  location_title text,
  preparation_minutes integer check (preparation_minutes between 0 and 720),
  cleanup_minutes integer check (cleanup_minutes between 0 and 720),
  enabled boolean not null default false,
  revision integer not null default 1,
  applied_dates jsonb not null default '{}'::jsonb,
  lease_id uuid,
  lease_until timestamptz,
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now(),
  check (not enabled or (token_ciphertext is not null and location_name is not null and preparation_minutes is not null and cleanup_minutes is not null))
);
create table if not exists google_business_hours_jobs (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  publication_id uuid not null unique references timecard_shift_publications(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  schedule_month text not null,
  connection_revision integer not null,
  location_name text not null,
  rules jsonb not null,
  closed_dates jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','failed','conflict','synced','superseded')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  intended_periods jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists google_business_hours_jobs_queue on google_business_hours_jobs(status, next_attempt_at);
create index if not exists google_business_hours_jobs_store on google_business_hours_jobs(store_id, created_at desc);
create table if not exists google_business_oauth_states (
  state_hash text primary key,
  employee_id uuid not null references employees(id) on delete cascade,
  session_id uuid not null references employee_sessions(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  verifier_ciphertext text not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
