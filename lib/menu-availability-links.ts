import { sql } from "./db";
import type {
  UberInventoryItemTarget,
  UberInventoryOptionRow,
  UberInventoryTarget
} from "./uber-inventory-targets";
import {
  resolveLinkedTargetKeys,
  type MenuAvailabilityLink,
  type MenuAvailabilityTargetKey
} from "./menu-availability-link-graph";

function aliases(row: { name: string; displayNames: Record<string, unknown> | null }) {
  return Array.from(new Set([
    row.name,
    ...Object.values(row.displayNames ?? {}).map(String)
  ].map((value) => value.trim()).filter(Boolean)));
}

export async function loadLinkedMenuTargets(input: {
  storeId: string;
  brandId: string;
  sourceTargets: Array<{ kind: "item" | "option"; targetId: string; brandId: string }>;
}): Promise<Array<UberInventoryItemTarget | UberInventoryTarget>> {
  const brandId = input.brandId || input.sourceTargets[0]?.brandId || "";
  if (!brandId) return [];
  const links = await sql`
    select
      source_kind as "sourceKind",
      source_id::text as "sourceId",
      dependent_kind as "dependentKind",
      dependent_id::text as "dependentId",
      is_bidirectional as "isBidirectional"
    from menu_availability_links
    where brand_id::text = ${brandId}
  ` as MenuAvailabilityLink[];
  const sourceKeys = input.sourceTargets.map((target) => (
    `${target.kind}:${target.targetId}` as MenuAvailabilityTargetKey
  ));
  const linkedKeys = resolveLinkedTargetKeys(links, sourceKeys);
  const itemIds = linkedKeys.filter((key) => key.startsWith("item:")).map((key) => key.slice(5));
  const optionIds = linkedKeys.filter((key) => key.startsWith("option:")).map((key) => key.slice(7));

  const [itemRows, optionRows] = await Promise.all([
    itemIds.length ? sql`
      select
        menu_catalog_items.id::text,
        menu_catalog_items.brand_id::text as "brandId",
        coalesce(menu_catalog_items.external_id, '') as "externalId",
        menu_catalog_items.name,
        menu_catalog_items.display_names as "displayNames",
        coalesce(menu_store_settings.is_available, true) as "isAvailable"
      from menu_catalog_items
      join store_brands
        on store_brands.brand_id = menu_catalog_items.brand_id
        and store_brands.store_id::text = ${input.storeId}
      left join menu_store_settings
        on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
        and menu_store_settings.store_id::text = ${input.storeId}
      where menu_catalog_items.id::text = any(${itemIds})
        and menu_catalog_items.is_active = true
        and (menu_catalog_items.store_id is null or menu_catalog_items.store_id::text = ${input.storeId})
    ` : [],
    optionIds.length ? sql`
      select
        menu_options.id::text,
        menu_option_groups.brand_id::text as "brandId",
        menu_option_groups.group_key as "groupKey",
        menu_options.option_key as "optionKey",
        coalesce(menu_options.external_id, '') as "externalId",
        menu_options.name,
        menu_options.display_names as "displayNames",
        coalesce(menu_option_store_settings.is_available, true) as "isAvailable"
      from menu_options
      join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
      join store_brands
        on store_brands.brand_id = menu_option_groups.brand_id
        and store_brands.store_id::text = ${input.storeId}
      left join menu_option_store_settings
        on menu_option_store_settings.menu_option_id = menu_options.id
        and menu_option_store_settings.store_id::text = ${input.storeId}
      where menu_options.id::text = any(${optionIds})
        and menu_options.is_active = true
        and menu_option_groups.is_active = true
    ` : []
  ]);

  const itemTargets = itemRows.map((row) => ({
    kind: "item" as const,
    targetId: String(row.id),
    menuCatalogItemId: String(row.id),
    brandId: String(row.brandId),
    inventoryKey: `item:${row.externalId || row.id}`,
    label: String(row.name),
    aliases: aliases({ name: String(row.name), displayNames: row.displayNames as Record<string, unknown> | null }),
    isAvailable: row.isAvailable !== false
  }));
  const optionTargets = (optionRows as UberInventoryOptionRow[]).map((row) => ({
    kind: "option" as const,
    targetId: row.id,
    menuOptionId: row.id,
    brandId: row.brandId,
    groupKey: row.groupKey,
    optionKey: row.optionKey,
    inventoryKey: `option:${row.externalId || row.id}`,
    label: row.name,
    aliases: aliases(row),
    isAvailable: row.isAvailable
  }));
  return [...itemTargets, ...optionTargets];
}
