import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

const action = process.argv[2];
if (!new Set(["pause", "resume"]).has(action)) {
  throw new Error("Usage: node scripts/set-maamaa-shimizu-reservations.mjs <pause|resume>");
}

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);
const storeRows = await sql`
  select stores.id::text, stores.name
  from stores
  join store_brands on store_brands.store_id = stores.id
  join brands on brands.id = store_brands.brand_id
  where brands.name = 'まぁ麻'
    and (stores.external_id = 'shimizu' or stores.name = '清水店')
  limit 1
`;
const store = storeRows[0];

if (!store) throw new Error("The maamaa Shimizu store was not found.");

const reservationsEnabled = action === "resume";
const statusNote = reservationsEnabled ? "" : "一時休止中";

const rows = await sql`
  insert into store_operations (
    store_id,
    reservations_enabled,
    status_note,
    temporary_status_until,
    updated_at
  )
  values (
    ${store.id},
    ${reservationsEnabled},
    ${statusNote},
    null,
    now()
  )
  on conflict (store_id)
  do update set
    reservations_enabled = excluded.reservations_enabled,
    status_note = excluded.status_note,
    temporary_status_until = null,
    updated_at = now()
  returning
    store_id::text as "storeId",
    reservations_enabled as "reservationsEnabled",
    status_note as "statusNote",
    minimum_pickup_minutes as "minimumPickupMinutes",
    temporary_status_until as "temporaryStatusUntil"
`;

console.log(JSON.stringify({ store: store.name, ...rows[0] }, null, 2));
