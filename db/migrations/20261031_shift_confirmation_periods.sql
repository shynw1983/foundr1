-- Requires 20261031_google_business_hours.sql. Additive; never infer historical blank dates as closed.
create table if not exists timecard_schedule_settings (
  store_id uuid primary key references stores(id) on delete cascade,
  auto_confirm boolean not null default false,
  last_checked_at timestamptz,
  first_day integer check(first_day between 0 and 31),
  first_time time,
  second_day integer check(second_day between 1 and 16),
  second_time time,
  revision integer not null default 1,
  updated_by uuid references employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  check(not auto_confirm or(first_day is not null and first_time is not null and second_day is not null and second_time is not null))
);
create table if not exists timecard_schedule_days (
  store_id uuid not null references stores(id) on delete cascade,
  work_date date not null,
  business_status text not null default 'pending' check(business_status in('pending','open','closed')),
  revision integer not null default 1,
  confirmed_at timestamptz,
  confirmed_by uuid references employees(id) on delete set null,
  confirmation_source text check(confirmation_source in('manual','automatic','change')),
  shift_snapshot jsonb,
  needs_refresh boolean not null default false,
  refresh_after timestamptz not null default now(),
  attention_reason text,
  updated_at timestamptz not null default now(),
  primary key(store_id,work_date)
);
create index if not exists timecard_schedule_days_dirty on timecard_schedule_days(needs_refresh,work_date) where needs_refresh;
alter table google_business_hours_jobs add column if not exists work_date date;
alter table google_business_hours_jobs add column if not exists day_revision integer;
alter table timecard_shift_publications add column if not exists period_key text;
alter table timecard_shift_publications add column if not exists work_date date;
-- Unsent month-only work has no explicit day/period confirmation contract. Retain it as history.
update google_business_hours_jobs set status='superseded' where work_date is null and status in('pending','failed','conflict');
create index if not exists google_business_hours_jobs_day on google_business_hours_jobs(store_id,work_date,sequence desc);

create or replace function mark_confirmed_schedule_day_dirty() returns trigger language plpgsql as $$
begin
  if TG_OP='UPDATE' then
    if (old.store_id,old.work_date,old.scheduled_start,old.scheduled_end) is not distinct from
       (new.store_id,new.work_date,new.scheduled_start,new.scheduled_end) then return new; end if;
  end if;
  if TG_OP in('UPDATE','DELETE') then
    update timecard_schedule_days set needs_refresh=true,refresh_after=now(),attention_reason=null,revision=revision+1,updated_at=now()
    where store_id=old.store_id and work_date between old.work_date-1 and old.work_date+1 and confirmed_at is not null;
  end if;
  if TG_OP in('INSERT','UPDATE') then
    if TG_OP='INSERT' then
      update timecard_schedule_days set needs_refresh=true,refresh_after=now(),attention_reason=null,revision=revision+1,updated_at=now()
      where store_id=new.store_id and work_date between new.work_date-1 and new.work_date+1 and confirmed_at is not null;
    elsif (old.store_id,old.work_date) is distinct from (new.store_id,new.work_date) then
      update timecard_schedule_days set needs_refresh=true,refresh_after=now(),attention_reason=null,revision=revision+1,updated_at=now()
      where store_id=new.store_id and work_date between new.work_date-1 and new.work_date+1 and confirmed_at is not null;
    end if;
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists timecard_shifts_confirmation_dirty on timecard_shifts;
create trigger timecard_shifts_confirmation_dirty after insert or update or delete on timecard_shifts
for each row execute function mark_confirmed_schedule_day_dirty();
