import { sql } from "../../../../../lib/db";

type MenuItemRow = {
  id: string;
  externalId: string;
  name: string;
  description: string;
  basePrice: number | null;
  variableSchema: Record<string, unknown>;
};

type MenuGroupRow = {
  id: string;
  groupKey: string;
  name: string;
  ruleJson: Record<string, unknown>;
  sortOrder: number;
};

type MenuOptionRow = {
  optionGroupId: string;
  optionKey: string;
  name: string;
  priceDelta: number | null;
  sortOrder: number;
};

function choice(option: MenuOptionRow) {
  return {
    id: option.optionKey,
    name: option.name,
    price: option.priceDelta ?? 0
  };
}

export async function GET() {
  const brands = await sql`
    select id::text
    from brands
    where name = 'まぁ麻'
      and status = 'active'
    limit 1
  `;
  const brand = brands[0];
  if (!brand) return Response.json({ error: "まぁ麻 brand not found" }, { status: 404 });

  const [items, groups, options] = await Promise.all([
    sql`
      select
        id::text,
        coalesce(external_id, '') as "externalId",
        name,
        coalesce(description, '') as description,
        base_price::float as "basePrice",
        variable_schema as "variableSchema"
      from menu_catalog_items
      where brand_id = ${brand.id}
        and item_kind = 'buildable_product'
        and is_active = true
      order by updated_at desc
      limit 1
    `,
    sql`
      select
        id::text,
        group_key as "groupKey",
        name,
        rule_json as "ruleJson",
        sort_order as "sortOrder"
      from menu_option_groups
      where brand_id = ${brand.id}
        and is_active = true
      order by sort_order, name
    `,
    sql`
      select
        option_group_id::text as "optionGroupId",
        option_key as "optionKey",
        name,
        price_delta::float as "priceDelta",
        sort_order as "sortOrder"
      from menu_options
      where is_active = true
        and option_group_id in (
          select id
          from menu_option_groups
          where brand_id = ${brand.id}
        )
      order by sort_order, name
    `
  ]) as [MenuItemRow[], MenuGroupRow[], MenuOptionRow[]];

  const base = items[0];
  if (!base) return Response.json({ error: "base menu item not found" }, { status: 404 });

  const optionsByGroup = new Map<string, MenuOptionRow[]>();
  for (const option of options) {
    const list = optionsByGroup.get(option.optionGroupId) ?? [];
    list.push(option);
    optionsByGroup.set(option.optionGroupId, list);
  }

  const groupByKey = new Map(groups.map((group) => [group.groupKey, group]));
  const choices = (key: string) => (optionsByGroup.get(groupByKey.get(key)?.id ?? "") ?? []).map(choice);
  const fixedGroupKeys = new Set(["medicinal-spice", "heat", "numb", "special-flavor"]);

  const menuSections = groups
    .filter((group) => !fixedGroupKeys.has(group.groupKey))
    .map((group) => ({
      id: group.groupKey,
      title: group.name,
      limit: Number(group.ruleJson?.limit ?? 99),
      items: (optionsByGroup.get(group.id) ?? []).map(choice)
    }));

  return Response.json({
    baseSoup: {
      id: base.externalId || "mala-soup",
      name: base.name,
      price: base.basePrice ?? 0,
      note: base.description
    },
    medicinalSpiceOptions: choices("medicinal-spice"),
    heatLevels: choices("heat"),
    numbLevels: choices("numb"),
    specialFlavors: choices("special-flavor"),
    menuSections,
    generatedAt: new Date().toISOString()
  });
}
