-- An empty policy keeps the existing separate counter menus. No store is enabled by this migration.
alter table pos_store_settings add column if not exists counter_menu_policy jsonb not null default '{}'::jsonb;
