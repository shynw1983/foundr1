-- Prepared only: deploy the scoped guards before applying to an approved database.
-- Give franchise owners access to their store's existing POS settings/reports
-- and expense management. No other role, scope or business record is changed.
begin;
insert into role_permissions (role, permission_key, is_enabled)
values ('store_owner', 'module.pos', true),
       ('store_owner', 'analytics.manageExpenses', true)
on conflict (role, permission_key) do update
set is_enabled = excluded.is_enabled, updated_at = now();
commit;
