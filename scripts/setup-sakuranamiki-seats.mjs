import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const sql = neon(process.env.DATABASE_URL);
const statements = [
  `create table if not exists store_floor_layouts (
    store_id uuid primary key references stores(id) on delete cascade,
    layout_key text not null default 'default',
    background_path text not null default '',
    canvas_width integer not null default 800,
    canvas_height integer not null default 1200,
    layout_data jsonb not null default '{}'::jsonb,
    updated_by uuid references employees(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists store_dining_sessions (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references stores(id) on delete cascade,
    table_group_label text not null,
    status text not null default 'selecting',
    party_size integer not null default 1,
    order_id uuid references store_customer_orders(id) on delete set null,
    assigned_by uuid references employees(id) on delete set null,
    assigned_at timestamptz not null default now(),
    paid_at timestamptz,
    served_at timestamptz,
    vacated_at timestamptz,
    cleaned_at timestamptz,
    completed_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint store_dining_sessions_status_check check (status in ('selecting', 'cooking', 'dining', 'cleaning', 'completed')),
    constraint store_dining_sessions_party_size_check check (party_size between 1 and 20)
  )`,
  `create table if not exists store_dining_session_tables (
    session_id uuid not null references store_dining_sessions(id) on delete cascade,
    table_id uuid not null references store_tables(id) on delete cascade,
    assigned_at timestamptz not null default now(),
    released_at timestamptz,
    primary key (session_id, table_id)
  )`,
  `alter table store_dining_sessions add column if not exists order_status text not null default 'selecting'`,
  `alter table store_dining_sessions add column if not exists dine_in_entitled boolean not null default false`,
  `alter table store_dining_sessions drop constraint if exists store_dining_sessions_status_check`,
  `update store_dining_sessions set order_status = case when status = 'cooking' then 'cooking' when status = 'selecting' then 'selecting' else 'idle' end, status = case when status in ('selecting', 'cooking') then 'seated' else status end`,
  `alter table store_dining_sessions add constraint store_dining_sessions_status_check check (status in ('seated', 'dining', 'cleaning', 'completed'))`,
  `alter table store_dining_sessions drop constraint if exists store_dining_sessions_order_status_check`,
  `alter table store_dining_sessions add constraint store_dining_sessions_order_status_check check (order_status in ('selecting', 'cooking', 'idle'))`,
  `create table if not exists store_dining_session_orders (
    session_id uuid not null references store_dining_sessions(id) on delete cascade,
    order_id uuid not null unique references store_customer_orders(id) on delete cascade,
    linked_at timestamptz not null default now(),
    primary key (session_id, order_id)
  )`,
  `alter table store_dining_session_tables add column if not exists seat_key text not null default 'TABLE'`,
  `drop index if exists store_dining_session_tables_active_table_idx`,
  `create unique index if not exists store_dining_session_tables_active_seat_idx on store_dining_session_tables(table_id, seat_key) where released_at is null`,
  `create index if not exists store_dining_sessions_store_status_idx on store_dining_sessions(store_id, status, updated_at desc)`,
  `create index if not exists store_dining_session_orders_session_idx on store_dining_session_orders(session_id, linked_at)`,
  `insert into store_tables (
    store_id, label, display_name, area_name, seat_count, status,
    table_ordering_enabled, sort_order, metadata, updated_at
  )
  select stores.id, seat.label, seat.display_name, seat.area_name, seat.seat_count,
    'active', true, seat.sort_order, jsonb_build_object('seatManagementKind', seat.kind), now()
  from stores
  cross join (values
    ('A', 'Aテーブル', 'テーブル席', 2, 10, 'table'),
    ('B', 'Bテーブル', 'テーブル席', 2, 20, 'table'),
    ('C1', 'C1', 'カウンター', 1, 101, 'counter'),
    ('C2', 'C2', 'カウンター', 1, 102, 'counter'),
    ('C3', 'C3', 'カウンター', 1, 103, 'counter'),
    ('C4', 'C4', 'カウンター', 1, 104, 'counter'),
    ('C5', 'C5', 'カウンター', 1, 105, 'counter'),
    ('C6', 'C6', 'カウンター', 1, 106, 'counter'),
    ('C7', 'C7', 'カウンター', 1, 107, 'counter'),
    ('C8', 'C8', 'カウンター', 1, 108, 'counter')
  ) as seat(label, display_name, area_name, seat_count, sort_order, kind)
  where stores.name = '桜並木店'
  on conflict (store_id, label) do update set
    display_name = excluded.display_name,
    area_name = excluded.area_name,
    seat_count = excluded.seat_count,
    status = 'active',
    table_ordering_enabled = true,
    sort_order = excluded.sort_order,
    metadata = store_tables.metadata || excluded.metadata,
    updated_at = now()`,
  `insert into store_floor_layouts (
    store_id, layout_key, background_path, canvas_width, canvas_height, layout_data, updated_at
  )
  select stores.id, 'maamaa-sakuranamiki-v1', '/store/maamaa-floor-background.svg', 800, 1200,
    '{"tables":[{"label":"A","x":513,"y":387},{"label":"B","x":619,"y":387}],"counterSeats":[{"label":"C8","x":235,"y":288},{"label":"C7","x":235,"y":386},{"label":"C6","x":235,"y":484},{"label":"C5","x":235,"y":582},{"label":"C4","x":235,"y":680},{"label":"C3","x":235,"y":778},{"label":"C2","x":235,"y":876},{"label":"C1","x":235,"y":974}]}'::jsonb,
    now()
  from stores
  where stores.name = '桜並木店'
  on conflict (store_id) do update set
    layout_key = excluded.layout_key,
    background_path = excluded.background_path,
    canvas_width = excluded.canvas_width,
    canvas_height = excluded.canvas_height,
    layout_data = excluded.layout_data,
    updated_at = now()`
];

for (const statement of statements) await sql.query(statement);

const verification = await sql.query(`
  select
    stores.id::text as "storeId",
    stores.name as "storeName",
    count(store_tables.id)::int as "seatCount",
    bool_or(store_floor_layouts.store_id is not null) as "hasLayout"
  from stores
  left join store_tables
    on store_tables.store_id = stores.id
    and store_tables.label in ('A','B','C1','C2','C3','C4','C5','C6','C7','C8')
  left join store_floor_layouts on store_floor_layouts.store_id = stores.id
  where stores.name = '桜並木店'
  group by stores.id, stores.name
`);

console.log(JSON.stringify(verification[0] ?? null));
