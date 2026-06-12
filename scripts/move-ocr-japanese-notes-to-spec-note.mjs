import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  update products
  set
    spec_note = trim(both from concat_ws(
      E'\n',
      nullif(spec_note, ''),
      regexp_replace(japanese_note, '^\\[情報未補完\\]\\s*', '')
    )),
    japanese_note = '',
    updated_at = now()
  where japanese_note like '[情報未補完] レシート OCR から追加:%'
  returning id::text, name
`;

console.log(JSON.stringify({
  updated: rows.length,
  products: rows.map((row) => ({ id: row.id, name: row.name }))
}, null, 2));
