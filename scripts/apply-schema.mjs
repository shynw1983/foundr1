import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);
const schema = fs.readFileSync("db/schema.sql", "utf8");
const statements = schema
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement);
}

await sql.query("alter table purchase_orders add column if not exists deadline_label text");
await sql.query("alter table purchase_orders add column if not exists requested_item_count integer not null default 0");

console.log("Schema applied successfully.");
