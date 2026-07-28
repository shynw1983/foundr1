import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const sql = neon(process.env.DATABASE_URL);

const options = await sql`
  select menu_options.id::text, menu_options.name
  from menu_options
  join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
  join brands on brands.id = menu_option_groups.brand_id
  where lower(brands.name) = lower('nanacha')
    and menu_option_groups.rule_json ->> 'source' = 'uber_eats'
    and menu_options.name ~ '(Large|Regular|Small) \\([0-9]+ml\\)$'
`;

const updates = options.map((option) => ({
  id: option.id,
  before: option.name,
  after: String(option.name).replace(/\s+(Large|Regular|Small) \(\d+ml\)$/, "").trim()
}));

for (const update of updates) {
  await sql`
    update menu_options
    set name = ${update.after},
        updated_at = now()
    where id = ${update.id}
  `;
}

console.log(JSON.stringify({ updated: updates.length, options: updates }, null, 2));
