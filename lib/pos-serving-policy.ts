export type PosServingTicket = { itemIndex: number; pickupCode: string; itemId?: string; taskId?: string; handedOffAt?: string };

export function isPosBowl(item: { brandName?: string; itemKind?: string; posPricingMode?: string; productionType?: string }) {
  if (item.productionType) return item.productionType === 'bowl';
  return /maamaa|まぁ麻|麻辣/i.test(item.brandName || "") && item.itemKind !== "drink";
}

// Each customer's bowl remains a separate line, even when weight and options match.
export function expandPosBowls<T extends { quantity: number; brandName?: string; itemKind?: string }>(items: T[]): T[] {
  return items.flatMap((item) => isPosBowl(item)
    ? Array.from({ length: item.quantity }, () => ({ ...item, quantity: 1, ...("amount" in item ? { amount: Number(item.amount) / item.quantity } : {}) }))
    : [item]);
}

export function offlineServingTickets(items: Array<{ quantity: number; brandName?: string; itemKind?: string }>, base: string): PosServingTicket[] {
  return expandPosBowls(items).flatMap((item, itemIndex) => isPosBowl(item)
    ? [{ itemIndex, pickupCode: `${base}-${itemIndex + 1}` }]
    : []);
}

export function isDineInBowlOptionGroup(group: { groupKey: string; name?: string; groupName?: string; sourceName?: string; groupSourceName?: string; posEnabled?: boolean }) {
  return group.posEnabled === true || ["heat", "heat-level", "numb", "soup-selection", "request", "uber-group-a2511c75", "medicinal-spice", "special-flavor", "noodle-replacement", "noodle-addition", "soup", "soup_base", "broth", "flavor", "noodle", "noodles", "noodle_type",
    "dine-in-customer-ingredient", "dine-in-customer-ingredients", "customer-requested-ingredient", "customer-requested-ingredients",
    "counter-ingredient", "counter-ingredients", "counter-requested-ingredient", "counter-requested-ingredients"].includes(group.groupKey)
    || [group.name || group.groupName || "", group.groupSourceName || (group.groupName === undefined ? group.sourceName || "" : "")].some(name => ["堂吃客人指定食材", "堂食客人指定食材", "柜台指定食材", "カウンター指定食材", "店内客指定食材", "店内お客様指定食材"].includes(name));
}
