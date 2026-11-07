import { sql } from './db';
import { readDineInMenus } from './store-dine-in-menu';
import { normalizeDineInCatalogPricing, resolveDineInItemFulfillmentMode, getDineInLinkedItemDisabledReason, dineInGroupAppliesToItem, dineInOptionAppliesToItem, isLocalDineInOption, type StoreDineInItem, type StoreDineInOption } from './store-dine-in-menu-policy';
import { getPosOptionSelectionRules } from './dine-in-option-selection';
import type { PosItemFulfillmentMode } from './pos-item-fulfillment';
import { defaultPosCounterMenuPolicy, getPosCounterItemFlags, type PosCounterMenuPolicy } from './pos-counter-menu-policy';

export type DineInMenuState = Awaited<ReturnType<typeof readDineInMenus>>;

/** Imported choices retain source sellability. Native choices belong only to
 * this trusted store snapshot and never acquire a canonical stock identity. */
export async function resolveDineInCatalog(storeId: string, state: DineInMenuState, counterPolicy: PosCounterMenuPolicy = defaultPosCounterMenuPolicy) {
  const enabled = state.menus.filter(menu => menu.enabled).map(menu => ({ ...menu, catalog: normalizeDineInCatalogPricing(menu.catalog) }));
  const itemIds = [...new Set(enabled.flatMap(menu => menu.catalog.items.map(item => item.sourceItemId)))];
  const optionIds = [...new Set(enabled.flatMap(menu => menu.catalog.optionGroups.flatMap(group => group.options.filter(option => !option.linkedItemId && !isLocalDineInOption(option)).map(option => option.sourceOptionId))))];
  const [sourceItems, sourceOptions] = await Promise.all([
    itemIds.length ? sql`select i.id::text, i.brand_id::text as "brandId", i.is_active as active,
      coalesce(s.is_available,true) as available
      from menu_catalog_items i join store_brands sb on sb.brand_id=i.brand_id and sb.store_id::text=${storeId}
      join brands b on b.id=i.brand_id and b.status='active'
      left join menu_store_settings s on s.menu_catalog_item_id=i.id and s.store_id::text=${storeId}
      where i.id::text=any(${itemIds}::text[]) and (i.store_id is null or (i.store_id::text=${storeId} and i.variable_schema->>'storeDineInOnly'='true'))` : [],
    optionIds.length ? sql`select o.id::text,g.brand_id::text as "brandId",g.id::text as "groupId",
      (o.is_active and g.is_active) as active,coalesce(s.is_available,true) as available
      from menu_options o join menu_option_groups g on g.id=o.option_group_id
      join store_brands sb on sb.brand_id=g.brand_id and sb.store_id::text=${storeId}
      left join menu_option_store_settings s on s.menu_option_id=o.id and s.store_id::text=${storeId}
      where o.id::text=any(${optionIds}::text[])` : []
  ]);
  const availableItems = new Map(sourceItems.map(item => [String(item.id), item]));
  const availableOptions = new Map(sourceOptions.map(option => [String(option.id), option]));
  const categories = enabled.flatMap(menu => menu.catalog.categories).sort((a, b) => a.sortOrder - b.sortOrder);
  const counterFlags = getPosCounterItemFlags(counterPolicy, categories);
  const eligibleItems = enabled.flatMap(menu => menu.catalog.items.filter(item => {
    const source = availableItems.get(item.sourceItemId);
    return source?.active && source.available && source.brandId === menu.brandId;
  }).map(item => ({ ...item, ...counterFlags(item), fulfillmentMode: resolveDineInItemFulfillmentMode(menu.catalog, item), isAvailable: true, dineInMenuRevision: menu.revision })));
  const items = eligibleItems.filter(item => item.visible).sort((a, b) => a.sortOrder - b.sortOrder);
  const linkedItems = new Map(eligibleItems.map(item => [item.id, item]));
  const itemSet = new Set(items.map(item => item.id));
  const optionGroups = enabled.flatMap(menu => menu.catalog.optionGroups
    .filter(group => group.visible && (!group.menuCatalogItemId || itemSet.has(group.menuCatalogItemId)))
    .map(group => ({ ...group, options: group.options.flatMap<StoreDineInOption & { linkedSourceItemId?: string; fulfillmentMode?: PosItemFulfillmentMode; counterStandardTax?: boolean; counterTakeoutRestricted?: boolean }>(option => {
      if (!option.visible) return [];
      if (option.linkedItemId) {
        const linked = linkedItems.get(option.linkedItemId);
        if (!linked || linked.brandId !== group.brandId || getDineInLinkedItemDisabledReason(menu.catalog, linked)) return [];
        return [{ ...option, name: linked.name, displayNames: linked.displayNames, priceDelta: linked.price,
          linkedSourceItemId: linked.sourceItemId, fulfillmentMode: linked.fulfillmentMode,
          counterStandardTax: linked.counterStandardTax, counterTakeoutRestricted: linked.counterTakeoutRestricted }];
      }
      const inheritedTax = { ...option, counterStandardTax: undefined, counterTakeoutRestricted: undefined };
      if (isLocalDineInOption(option)) return group.brandId === menu.brandId ? [inheritedTax] : [];
      const source = availableOptions.get(option.sourceOptionId);
      return source?.active && source.available && source.brandId === menu.brandId && source.groupId === (option.sourceGroupId || group.sourceGroupId) ? [inheritedTax] : [];
    }).sort((a, b) => a.sortOrder - b.sortOrder) })));
  const snapshotGroupsById = new Map(enabled.flatMap(menu => menu.catalog.optionGroups.map(group => [group.id, group] as const)));
  const groupsById = new Map(optionGroups.map(group => [group.id, group]));
  // A required group with all options sold out cannot become an optional group at checkout.
  const canSell = (item: StoreDineInItem) => item.optionGroupIds.every(id => {
    const group = groupsById.get(id);
    if (!group) return true; // Explicitly hidden groups are not offered.
    // Existing POS ignores historical groups that never had any choices.
    // Check the stored snapshot, not the stock-filtered group: choices hidden
    // or sold out after copying must still enforce their required minimum.
    if (snapshotGroupsById.get(id)?.options.length === 0) return true;
    if (!dineInGroupAppliesToItem(group, item)) return true;
    const { min: minimum, type, max, perOptionMax } = getPosOptionSelectionRules(group);
    if (!minimum) return true;
    const available = group.options.filter(option => dineInOptionAppliesToItem(option, group, item));
    return max >= minimum && (type === 'quantity' ? available.length * perOptionMax >= minimum : available.length >= minimum);
  });
  return {
    items: items.filter(canSell), optionGroups,
    categories,
    brandIds: enabled.map(menu => menu.brandId)
  };
}

export function flattenDineInOptions(catalog: Awaited<ReturnType<typeof resolveDineInCatalog>>) {
  return catalog.optionGroups.flatMap(group => group.options.map(option => ({
    ...option, groupId: group.id, sourceGroupId: option.sourceGroupId || group.sourceGroupId, brandId: group.brandId,
    menuCatalogItemId: group.menuCatalogItemId, groupApplicableCategories: group.applicableCategories,
    groupKey: group.groupKey, groupName: group.name, groupSourceName: group.sourceName, groupDisplayNames: group.displayNames,
    selectionType: group.selectionType, ruleJson: group.ruleJson, posEnabled: group.posEnabled, localKind: group.localKind, explicitItemLinks: group.explicitItemLinks, itemOptionExclusions: group.itemOptionExclusions
  })));
}
