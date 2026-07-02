import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env.local --yes` first.");
}

const sql = neon(process.env.DATABASE_URL);

const zh = "带来选择乐趣与现做香气的麻辣烫专门店。";
const zhHant = "帶來選擇樂趣與現做香氣的麻辣燙專門店。";

const rows = await sql`
  update brand_site_sections
  set
    body_display_names = jsonb_set(
      jsonb_set(
        coalesce(body_display_names, '{}'::jsonb),
        '{zh}',
        to_jsonb(${zh}::text),
        true
      ),
      '{zh-Hant}',
      to_jsonb(${zhHant}::text),
      true
    ),
    updated_at = now()
  where page_key = 'footer'
    and section_key = 'footer'
    and brand_id in (
      select id
      from brands
      where lower(name) in ('maamaa', 'まぁ麻')
        or name ilike '%maamaa%'
        or name like '%まぁ麻%'
        or name like '%麻辣%'
    )
  returning id::text, body_display_names as "bodyDisplayNames"
`;

console.log(`Updated ${rows.length} maamaa footer section(s).`);
for (const row of rows) {
  console.log(JSON.stringify(row, null, 2));
}
