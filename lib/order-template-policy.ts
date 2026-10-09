export type OrderTemplateItem = { productId: string; quantity: number; purchaseUnit: string };
export type OrderTemplate = { id: string; name: string; items: OrderTemplateItem[]; unavailableItemCount: number };
export type OrderTemplatesResponse = { templates: OrderTemplate[]; canManage: boolean };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeOrderTemplate(value: unknown): { storeId: string; name: string; items: OrderTemplateItem[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const storeId = typeof input.storeId === "string" ? input.storeId.trim().toLowerCase() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!uuid.test(storeId) || !name || name.length > 60 || !Array.isArray(input.items) || !input.items.length || input.items.length > 100) return null;
  const seen = new Set<string>();
  const items: OrderTemplateItem[] = [];
  for (const value of input.items) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    const productId = typeof item.productId === "string" ? item.productId.trim().toLowerCase() : "";
    const purchaseUnit = typeof item.purchaseUnit === "string" ? item.purchaseUnit.trim() : "";
    if (!uuid.test(productId) || seen.has(productId) || !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 999 || !purchaseUnit || purchaseUnit.length > 40) return null;
    seen.add(productId);
    items.push({ productId, quantity: Number(item.quantity), purchaseUnit });
  }
  return { storeId, name, items };
}

/** A saved template is a draft. Current scoped SKU/unit access decides what may be shown. */
export function filterOrderTemplateItems(items: unknown, eligibleUnits: Map<string, string>) {
  const raw = Array.isArray(items) ? items : [];
  const visible: OrderTemplateItem[] = [];
  let unavailableItemCount = 0;
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) { unavailableItemCount++; continue; }
    const item = value as OrderTemplateItem;
    if (eligibleUnits.get(item.productId) !== item.purchaseUnit || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) { unavailableItemCount++; continue; }
    visible.push({ productId: item.productId, quantity: item.quantity, purchaseUnit: item.purchaseUnit });
  }
  return { items: visible, unavailableItemCount };
}
