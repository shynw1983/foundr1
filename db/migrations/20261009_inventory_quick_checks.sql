begin;

-- Visual observations never populate physical counts, book stock or count dates.
alter table inventory_items add column if not exists quick_status text;
alter table inventory_items add column if not exists quick_checked_at timestamptz;
alter table inventory_items add column if not exists quick_checked_by uuid references employees(id) on delete set null;
alter table inventory_items add column if not exists quick_checked_by_name text not null default '';
alter table inventory_items add column if not exists quick_estimate jsonb;
alter table inventory_items add column if not exists quick_basis jsonb;
alter table inventory_items add column if not exists quick_revision integer not null default 0;
alter table inventory_items add column if not exists quick_superseded_at timestamptz;
alter table inventory_items drop constraint if exists inventory_items_quick_status_check;
alter table inventory_items add constraint inventory_items_quick_status_check check (quick_status is null or quick_status in ('enough', 'low', 'out'));
alter table inventory_items drop constraint if exists inventory_items_quick_revision_check;
alter table inventory_items add constraint inventory_items_quick_revision_check check (quick_revision >= 0);

alter table inventory_checks add column if not exists quick_check_snapshot jsonb;

commit;
