import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  select
    (select count(*) from stores) as stores,
    (select count(*) from brands) as brands,
    (select count(*) from products) as products,
    (select count(*) from suppliers) as suppliers,
    (select count(*) from supplier_locations) as supplier_locations,
    (select count(*) from product_brand_usages) as product_brand_usages,
    (select count(*) from product_supplier_options) as product_supplier_options
`;

console.log(JSON.stringify(rows[0], null, 2));
