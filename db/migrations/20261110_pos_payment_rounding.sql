alter table pos_store_settings add column if not exists payment_rounding jsonb not null default '{}'::jsonb;
