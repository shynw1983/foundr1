-- Additive software stability window. No stores are enabled by this migration.
alter table pos_store_settings add column if not exists scale_filter_settings jsonb not null default '{"enabled":false,"revision":"","toleranceGrams":2,"settleMs":2000}'::jsonb;
alter table store_relay_stations add column if not exists scale_filter_state jsonb not null default '{}'::jsonb;
