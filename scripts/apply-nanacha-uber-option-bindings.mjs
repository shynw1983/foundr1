import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set.");
}

const sql = neon(process.env.DATABASE_URL);
const rules = new Map([
  ["5d7da578-1ef5-4c24-a528-e866108c2c66", [0, 2, false, null]],
  ["8944390c-944f-40b1-936d-6349ef58a72f", [0, 1, false, null]],
  ["375025a9-4f16-4761-a42a-a18044138054", [0, 1, false, null]],
  ["2472a227-9115-4ee8-a4f4-6ca4e7d16b97", [0, 1, false, null]],
  ["d7035dad-587a-4cc5-8e35-761c4d1eb0d4", [0, 1, false, null]],
  ["4cfbe05b-8118-471c-8b01-00dc3cc4b1f0", [0, 1, false, null]],
  ["41627012-d5b1-4676-a8d9-2022a2b8f12b", [0, 2, true, 2]],
  ["95bfa553-d61d-46a6-99e1-10ccd5114017", [0, 2, false, null]],
  ["fcd65290-f261-445e-a5f0-a2d3b146cd14", [0, 2, false, null]],
  ["3242adf6-fce4-4eee-8034-3ca80a095dc7", [1, 1, false, null]],
  ["574612fa-8e5a-413b-b741-5049c13fc2a5", [0, 4, false, null]],
  ["4be5ccf9-d0b8-439c-a0c9-52d40f1a65e9", [0, 1, false, null]],
  ["d970dbbd-d955-4385-8557-f6138c3e2be1", [0, 1, false, null]],
  ["712625eb-3c48-48a4-8402-8f67cf4b28d6", [1, 1, false, null]],
  ["632b9525-5485-4417-b1d0-fd638a3ba89e", [1, 1, false, null]],
  ["a860d601-30c8-4f34-8105-9daf6980570b", [0, null, true, 4]],
  ["8c992113-a19f-4bdb-b804-923b4e25858d", [0, 6, true, 3]],
  ["c2e531fe-9413-4f06-ad87-799f58452b23", [0, 3, true, 3]],
  ["ad61605b-a433-489d-a4db-32666586a775", [1, 1, false, null]],
  ["d1fa5e40-b0d4-479b-b088-ed03e410d81b", [1, 1, false, null]],
  ["7c057d21-d94b-439a-aa45-bdaef9ee712d", [0, 1, false, null]],
  ["7786c04e-c4ce-45ee-aec5-b31255592d30", [0, 1, false, null]],
  ["742a396f-6a44-440b-9ba5-0e4c04b41f7d", [0, 3, false, null]],
  ["ef3992cb-d0e9-4ab4-bc7d-91e64c6fda9c", [0, 1, false, null]],
  ["17e09938-c587-4d45-bf4d-b6ceb46cd510", [1, 1, false, null]],
  ["4872e0c9-a953-4689-a5ed-b1a57d28a7ed", [0, 1, false, null]],
  ["c4445714-aaf9-4be7-a305-5bb169afa2ff", [1, 1, false, null]],
  ["4d7d2a94-b96b-41d4-a1ff-b7f79eae89b1", [0, 1, false, null]],
  ["fd46fa60-1572-4674-85eb-97146880c02e", [0, 1, false, null]],
  ["2c2a6e4d-9289-4d82-bc31-d62f4ae53532", [0, 2, false, null]],
  ["8ee2dbde-8221-4aae-a427-9f658a3c0290", [0, 1, false, null]]
]);

const brands = await sql`
  select id::text
  from brands
  where lower(name) = lower('nanacha')
    and status = 'active'
  limit 1
`;
const brandId = brands[0]?.id;
if (!brandId) throw new Error("nanacha brand not found.");

const groups = await sql`
  select id::text, external_id, rule_json
  from menu_option_groups
  where brand_id = ${brandId}
    and external_id = any(${Array.from(rules.keys())})
`;
if (groups.length !== rules.size) {
  const found = new Set(groups.map((group) => String(group.external_id)));
  const missing = Array.from(rules.keys()).filter((id) => !found.has(id));
  throw new Error(`Uber option groups are incomplete. Missing: ${missing.join(", ")}`);
}

const groupIdByExternalId = new Map();
const groupUpdates = [];
for (const group of groups) {
  const externalId = String(group.external_id);
  const [minSelections, maxSelections, allowRepeat, perOptionMax] = rules.get(externalId);
  const rulePatch = {
    source: "uber_eats",
    importStatus: "active",
    minSelections,
    maxSelections,
    allowRepeat,
    perOptionMax,
    importedRuleVersion: "2026-07-29"
  };
  groupUpdates.push({
    id: String(group.id),
    selection_type: maxSelections === 1 ? "single" : "multiple",
    rule_patch: rulePatch
  });
  groupIdByExternalId.set(externalId, String(group.id));
}

await sql`
  update menu_option_groups as groups
  set
    selection_type = updates.selection_type,
    rule_json = groups.rule_json || updates.rule_patch,
    is_active = true,
    updated_at = now()
  from jsonb_to_recordset(${JSON.stringify(groupUpdates)}::jsonb) as updates(
    id uuid,
    selection_type text,
    rule_patch jsonb
  )
  where groups.id = updates.id
`;
await sql`
  update menu_options
  set is_active = true, updated_at = now()
  where option_group_id = any(${Array.from(groupIdByExternalId.values())}::uuid[])
`;

const items = await sql`
  select id::text, name, is_active, variable_schema
  from menu_catalog_items
  where brand_id = ${brandId}
    and variable_schema ? 'uberEatsImport'
  order by name
`;

const linkedItems = items
  .map((item) => ({
    ...item,
    customizationGroupIds: Array.isArray(item.variable_schema?.uberEatsImport?.customizationGroupIds)
      ? item.variable_schema.uberEatsImport.customizationGroupIds.map(String)
      : []
  }))
  .filter((item) => item.customizationGroupIds.length);

const bindings = linkedItems.flatMap((item) => (
  item.customizationGroupIds.map((externalId, index) => {
    const optionGroupId = groupIdByExternalId.get(externalId);
    if (!optionGroupId) {
      throw new Error(`Unknown Uber group ${externalId} on ${item.name}.`);
    }
    return {
      menu_catalog_item_id: String(item.id),
      option_group_id: optionGroupId,
      sort_order: (index + 1) * 10
    };
  })
));

await sql`
  delete from menu_catalog_item_option_groups
  where menu_catalog_item_id = any(${linkedItems.map((item) => String(item.id))}::uuid[])
`;
await sql`
  insert into menu_catalog_item_option_groups (
    menu_catalog_item_id,
    option_group_id,
    sort_order,
    is_active,
    updated_at
  )
  select
    bindings.menu_catalog_item_id,
    bindings.option_group_id,
    bindings.sort_order,
    true,
    now()
  from jsonb_to_recordset(${JSON.stringify(bindings)}::jsonb) as bindings(
    menu_catalog_item_id uuid,
    option_group_id uuid,
    sort_order integer
  )
  on conflict (menu_catalog_item_id, option_group_id)
  do update set
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now()
`;
await sql`
  update menu_catalog_items
  set
    variable_schema = jsonb_set(
      variable_schema,
      '{uberEatsImport,optionsAppliedAt}',
      to_jsonb(now()::text),
      true
    ),
    updated_at = now()
  where id = any(${linkedItems.map((item) => String(item.id))}::uuid[])
`;

const [summary] = await sql`
  select
    count(distinct groups.id)::int as "activeUberGroups",
    count(distinct options.id)::int as "activeUberOptions",
    count(distinct links.menu_catalog_item_id)::int as "linkedItems",
    count(distinct (links.menu_catalog_item_id, links.option_group_id))::int as "itemGroupLinks"
  from menu_option_groups groups
  left join menu_options options
    on options.option_group_id = groups.id
    and options.is_active = true
  left join menu_catalog_item_option_groups links
    on links.option_group_id = groups.id
    and links.is_active = true
  where groups.brand_id = ${brandId}
    and groups.rule_json ->> 'source' = 'uber_eats'
    and groups.is_active = true
`;

console.log(JSON.stringify({
  ...summary,
  activeItems: linkedItems.filter((item) => item.is_active).length,
  draftItems: linkedItems.filter((item) => !item.is_active).length
}, null, 2));
