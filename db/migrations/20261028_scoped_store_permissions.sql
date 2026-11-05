-- Prepared only. Apply to an explicitly approved environment AFTER the new
-- staff scope guards are deployed, so existing clients cannot use the old guards.
-- Restore the documented local-staff management policy; preserve every other setting.
begin;
insert into role_permissions (role, permission_key, is_enabled)
values ('store_owner', 'staff.manage', true), ('store_manager', 'staff.manage', true)
on conflict (role, permission_key) do update set is_enabled = true, updated_at = now();

commit;
