// Preserve the complete source graph, including unlinked items. A missing
// category placement is not evidence that Uber deleted the underlying item.
export function captureUberAuthoritativeCatalog(raw, storeUuid) {
  const menuId = raw?.data?.menuMapping?.find(x => x.menuType === 'MENU_TYPE_FULFILLMENT_DELIVERY')?.menuUUID;
  const menu = raw?.data?.menus?.[menuId];
  if (!menu || !Array.isArray(menu.sections) || !menu.subsectionsMap || !menu.entities?.itemsMap || !menu.entities?.customizationsMap) {
    throw new Error('uber_source_incomplete');
  }
  const text = value => String(value?.defaultValue ?? '');
  const money = value => {
    if (!value || !Number.isInteger(value.low) || !Number.isInteger(value.high)) throw new Error('uber_source_price_missing');
    const amount = (Number(value.high) * 4294967296 + (Number(value.low) >>> 0)) / 100;
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('uber_source_price_invalid');
    return amount;
  };
  const ids = list => (list ?? []).map(x => typeof x === 'string' ? x : String(x.uuid));
  const categories = Object.entries(menu.subsectionsMap).map(([id, row]) => ({
    id, name: text(row.title), itemIds: ids(row.displayItems), hidden: row.invisible === true
  }));
  const groups = Object.entries(menu.entities.customizationsMap).map(([id, row]) => ({
    id, name: text(row.title), optionIds: ids(row.options),
    min: Number(row.quantityInfo?.defaultValue?.minPermitted ?? 0),
    max: row.quantityInfo?.defaultValue?.maxPermitted ?? null,
    quantityInfo: row.quantityInfo ?? null
  }));
  const entities = Object.entries(menu.entities.itemsMap).map(([id, row]) => ({
    id, name: text(row.itemInfo?.title), description: text(row.itemInfo?.description),
    imageUrl: String(row.itemInfo?.image?.imageURL ?? ''),
    price: money(row.paymentInfo?.priceInfo?.defaultValue?.price),
    groupIds: ids(row.customizationUUIDs?.defaultValue ?? (Array.isArray(row.customizationUUIDs) ? row.customizationUUIDs : [])),
    groupOverrides: row.customizationUUIDs?.overrides ?? [],
    contextPrices: (row.paymentInfo?.priceInfo?.overrides ?? []).map(x => ({
      contextType: x.contextType, contextId: x.contextValue, price: money(x.overriddenValue?.price)
    })),
    quantityInfo: row.quantityInfo ?? null,
    suspensionInfo: row.suspensionInfo ?? null,
    visibility: row.visibility ?? null,
    taxInfo: row.taxInfo ?? null
  }));
  const entityIds = new Set(entities.map(x => x.id));
  const groupIds = new Set(groups.map(x => x.id));
  for (const row of [...categories, ...groups]) {
    for (const id of row.itemIds ?? row.optionIds) if (!entityIds.has(id)) throw new Error(`uber_source_dangling_item:${id}`);
  }
  for (const row of entities) for (const id of row.groupIds) {
    if (!groupIds.has(id)) throw new Error(`uber_source_dangling_group:${id}`);
  }
  return { version: 1, storeUuid, menuId, capturedAt: new Date().toISOString(), updatedAt: menu.updatedAt,
    sections: menu.sections.map(row => ({id: row.uuid, name: text(row.title), categoryIds: ids(row.subsectionUUIDs), hours: row.regularHours, hidden: row.invisible === true})),
    categories, groups, entities };
}
