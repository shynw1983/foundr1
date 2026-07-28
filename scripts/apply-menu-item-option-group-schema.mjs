import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const sql = neon(process.env.DATABASE_URL);

await sql`
  create table if not exists menu_catalog_item_option_groups (
    menu_catalog_item_id uuid not null references menu_catalog_items(id) on delete cascade,
    option_group_id uuid not null references menu_option_groups(id) on delete cascade,
    sort_order integer not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (menu_catalog_item_id, option_group_id)
  )
`;
await sql`
  create index if not exists idx_menu_catalog_item_option_groups_item
  on menu_catalog_item_option_groups(menu_catalog_item_id, sort_order)
`;
await sql`
  create index if not exists idx_menu_catalog_item_option_groups_group
  on menu_catalog_item_option_groups(option_group_id, menu_catalog_item_id)
`;

console.log(JSON.stringify({ table: "menu_catalog_item_option_groups", status: "ready" }));
