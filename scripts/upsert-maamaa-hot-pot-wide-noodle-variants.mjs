import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const brandRows = await sql`select id::text from brands where name = 'まぁ麻' limit 1`;
const brandId = brandRows[0]?.id;
if (!brandId) throw new Error("The maamaa brand was not found");

const variants = [
  {
    groupKey: "noodle-replacement",
    optionKey: "replace-hot-pot-wide-noodle",
    name: "火鍋板春雨に変更",
    displayNames: { zh: "更换为火锅宽粉", ko: "훠궈 넓적당면으로 변경", en: "Change to Hot Pot Potato Wide Noodles" },
    price: 170
  },
  {
    groupKey: "cold-noodles",
    optionKey: "cold-hot-pot-wide-noodles",
    name: "冷やし火鍋板春雨100g",
    displayNames: { zh: "火锅宽粉", ko: "훠궈 넓적당면", en: "Hot Pot Potato Wide Noodles" },
    price: 170
  }
];

const sourceRows = await sql`
  select o.id::text
  from menu_options o
  join menu_option_groups g on g.id = o.option_group_id
  where g.brand_id = ${brandId}
    and g.group_key = 'noodles'
    and o.option_key = 'hot-pot-wide-noodle'
    and o.is_active = true
  limit 1
`;
const sourceOptionId = sourceRows[0]?.id;
if (!sourceOptionId) throw new Error("Source option hot-pot-wide-noodle was not found");

const changed = [];
for (const variant of variants) {
  const groupRows = await sql`
    select id::text
    from menu_option_groups
    where brand_id = ${brandId} and group_key = ${variant.groupKey} and is_active = true
  `;
  if (groupRows.length !== 1) throw new Error(`Expected one active ${variant.groupKey} group, found ${groupRows.length}`);

  const sortRows = await sql`
    select coalesce(max(sort_order), 0)::int + 10 as sort_order
    from menu_options
    where option_group_id = ${groupRows[0].id}
  `;
  const optionRows = await sql`
    insert into menu_options (
      option_group_id, external_id, option_key, name, display_names,
      price_delta, affects_procedure, sort_order, is_active, updated_at
    ) values (
      ${groupRows[0].id}, ${variant.optionKey}, ${variant.optionKey}, ${variant.name},
      ${JSON.stringify(variant.displayNames)}::jsonb, ${variant.price}, true,
      ${sortRows[0].sort_order}, true, now()
    )
    on conflict (option_group_id, option_key) do update set
      external_id = excluded.external_id,
      name = excluded.name,
      display_names = excluded.display_names,
      price_delta = excluded.price_delta,
      affects_procedure = true,
      is_active = true,
      updated_at = now()
    returning id::text, option_key, name, price_delta::float
  `;
  const optionId = optionRows[0].id;

  await sql`
    insert into menu_option_store_settings (
      brand_id, store_id, menu_option_id, is_available, stock_status,
      status_note, updated_by, updated_at
    )
    select brand_id, store_id, ${optionId}, is_available, stock_status,
      status_note, updated_by, now()
    from menu_option_store_settings
    where menu_option_id = ${sourceOptionId}
    on conflict (store_id, menu_option_id) do update set
      is_available = excluded.is_available,
      stock_status = excluded.stock_status,
      status_note = excluded.status_note,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  await sql`
    insert into menu_platform_availability_settings (
      brand_id, store_id, target_kind, target_id, platform,
      availability, updated_by, updated_at
    )
    select brand_id, store_id, 'option', ${optionId}, platform,
      availability, updated_by, now()
    from menu_platform_availability_settings
    where target_kind = 'option' and target_id = ${sourceOptionId}
    on conflict (store_id, target_kind, target_id, platform) do update set
      availability = excluded.availability,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  changed.push(optionRows[0]);
}

console.log(JSON.stringify({ sourceOptionId, variants: changed }, null, 2));
