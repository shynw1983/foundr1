-- Requires both 20261031 migrations. Formal business arrangements are the Google source.
alter table timecard_schedule_days add column if not exists hours_source text not null default 'schedule' check(hours_source in('schedule','manual'));
alter table timecard_schedule_days add column if not exists manual_periods jsonb;
alter table timecard_schedule_days add column if not exists business_periods jsonb;
alter table timecard_shift_publications add column if not exists business_periods jsonb;
-- Old confirmed snapshots must be resolved once before external sync; preserve all original data.
update timecard_schedule_days set needs_refresh=true,refresh_after=now(),revision=revision+1
where confirmed_at is not null and business_periods is null and not needs_refresh;

-- Import existing rule values once. Clearing them later must remain an explicit unset value.
do $$ begin
  if not exists(select 1 from information_schema.columns where table_name='timecard_schedule_settings' and column_name='preparation_minutes' and table_schema=current_schema()) then
    alter table timecard_schedule_settings add column preparation_minutes integer check(preparation_minutes between 0 and 720);
    alter table timecard_schedule_settings add column cleanup_minutes integer check(cleanup_minutes between 0 and 720);
    update timecard_schedule_settings s set preparation_minutes=c.preparation_minutes,cleanup_minutes=c.cleanup_minutes from google_business_connections c where c.store_id=s.store_id;
  end if;
end $$;
-- Google connectivity no longer depends on staffing conversion settings.
do $$ declare item record; begin
  for item in select conname from pg_constraint where conrelid='google_business_connections'::regclass and contype='c' and pg_get_constraintdef(oid) like '%enabled%' and pg_get_constraintdef(oid) like '%preparation_minutes%' loop
    execute format('alter table google_business_connections drop constraint %I',item.conname);
  end loop;
end $$;
alter table google_business_connections drop constraint if exists google_business_connection_ready;
alter table google_business_connections add constraint google_business_connection_ready check(not enabled or(token_ciphertext is not null and location_name is not null));
