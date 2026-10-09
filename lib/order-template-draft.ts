export type OrderTemplateItem = { productId: string; quantity: number; purchaseUnit: string };
export type CommonOrderTemplate = { id: string; name: string; items: OrderTemplateItem[]; unavailableItemCount: number };
type TemplateProduct = { id?: string; name: string; unit: string; category: string; subcategory?: string };
type TemplateDraft = { id: number; productId: string; productName: string; quantity: number | null; unit: string; category: string; subcategory: string; replenishment?: boolean; fromTemplate?: boolean };

export function templateItemsFromDraft(draft: TemplateDraft[], products: TemplateProduct[]): OrderTemplateItem[] | null {
  if (!draft.length) return null;
  const seen = new Set<string>();
  const result: OrderTemplateItem[] = [];
  for (const item of draft) {
    const product = products.find(candidate => candidate.id === item.productId);
    if (!product || product.unit !== item.unit || seen.has(item.productId) || !Number.isInteger(item.quantity) || item.quantity === null || item.quantity < 1 || item.quantity > 999) return null;
    seen.add(item.productId);
    result.push({ productId: item.productId, quantity: item.quantity, purchaseUnit: item.unit });
  }
  return result;
}

/** A template adds absent exact SKUs. Existing quantities, blanks and source flags are retained. */
export function appendOrderTemplate(draft: TemplateDraft[], template: CommonOrderTemplate, products: TemplateProduct[], nextId = Date.now()) {
  const items = [...draft];
  let added = 0, retained = 0, unavailable = template.unavailableItemCount || 0;
  const firstId = Math.max(nextId, ...draft.map(item => Number.isFinite(item.id) ? item.id + 1 : 0));
  for (const item of template.items) {
    const product = products.find(candidate => candidate.id === item.productId);
    if (!product || product.unit !== item.purchaseUnit || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) { unavailable++; continue; }
    if (items.some(candidate => candidate.productId === item.productId)) { retained++; continue; }
    items.push({ id: firstId + added, fromTemplate: true, productId: item.productId, productName: product.name, quantity: item.quantity,
      unit: product.unit, category: product.category, subcategory: product.subcategory ?? "未分類" });
    added++;
  }
  return { items, added, retained, unavailable };
}
