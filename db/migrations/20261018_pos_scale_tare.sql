-- Additive only. Defaults keep existing stores on device/manual net weights.
-- Apply before the web/native feature rollout; no weights are inferred.
alter table pos_store_settings add column if not exists scale_tare_settings jsonb not null default '{}'::jsonb;
alter table store_relay_stations add column if not exists scale_tare_context jsonb not null default '{}'::jsonb;
alter table store_customer_order_items add column if not exists weight_measurement jsonb not null default '{}'::jsonb;
