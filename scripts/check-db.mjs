import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);
const tables = [
  "stores",
  "brands",
  "store_brands",
  "employees",
  "employee_scopes",
  "products",
  "product_brand_usages",
  "suppliers",
  "supplier_locations",
  "product_supplier_options",
  "purchase_orders",
  "purchase_order_items",
  "purchase_actuals",
  "purchase_exceptions",
  "price_records",
  "os_audit_logs",
  "os_notifications"
];

const rows = await sql`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name = any(${tables})
  order by table_name
`;
const legacyRows = await sql`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('ops_audit_logs', 'ops_notifications')
  order by table_name
`;

console.log(JSON.stringify({
  tables: rows.map((row) => row.table_name),
  legacyTables: legacyRows.map((row) => row.table_name)
}, null, 2));
