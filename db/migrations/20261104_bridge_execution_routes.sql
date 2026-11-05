create table if not exists local_bridge_execution_routes (
  store_id uuid not null references stores(id) on delete cascade,
  platform text not null,
  device_id uuid not null references local_bridge_devices(id),
  probe_command_id uuid references local_bridge_commands(id) on delete set null,
  primary key (store_id, platform)
);
