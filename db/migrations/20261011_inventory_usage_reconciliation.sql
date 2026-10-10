begin;
alter table inventory_items add column if not exists usage_anchor_check_id uuid references inventory_checks(id) on delete set null deferrable initially deferred;
alter table inventory_checks add column if not exists reconciliation_snapshot jsonb;
create index if not exists idx_inventory_checks_usage_period on inventory_checks(inventory_item_id, created_at desc) where record_type = 'count';
commit;
