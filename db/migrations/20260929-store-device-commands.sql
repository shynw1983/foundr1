-- Preserve indoor-light history and locks. Historical table names allow an additive rollout.
alter table store_light_commands add column if not exists command text not null default 'press';
alter table store_light_commands add column if not exists parameter text not null default 'default';
alter table store_light_commands add column if not exists before_sample jsonb;
