export const openReplenishmentOrderStatuses = ["requested", "purchased", "in_delivery", "delivered"] as const;

export type ReplenishmentOrderIntent = { storeId: string; productIds: string[] };
export type ReplenishmentOrderContext = ReplenishmentOrderIntent & {
  expectedOpenItemIds: string[];
  additionalOrderConfirmed: boolean;
};
export type ReplenishmentOpenOrderItem = {
  itemId: string;
  productId: string;
  orderId: string;
  status: string;
  requestedQuantity: number;
  requestedUnit: string;
  href: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readIds(value: unknown, allowEmpty = false, maximum = 100): string[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) return null;
  if (value.some((id) => typeof id !== "string" || !uuidPattern.test(id))) return null;
  return [...new Set(value.map((id: string) => id.toLowerCase()))].sort();
}

export function readReplenishmentOrderIntent(search: URLSearchParams): { intent: ReplenishmentOrderIntent | null; error?: string } {
  const storeId = search.get("replenishStoreId");
  const rawProductIds = search.getAll("replenishProductId");
  if (!storeId && rawProductIds.length === 0) return { intent: null };
  const productIds = readIds(rawProductIds);
  if (!storeId || !uuidPattern.test(storeId) || !productIds) {
    return { intent: null, error: "補充対象の店舗と商品を確認して、もう一度開いてください。" };
  }
  return { intent: { storeId: storeId.toLowerCase(), productIds } };
}

export function readReplenishmentOrderContext(value: unknown): ReplenishmentOrderContext | null {
  try {
    const context = typeof value === "string" ? JSON.parse(value) : value;
    if (!context || typeof context !== "object" || typeof context.storeId !== "string" || !uuidPattern.test(context.storeId)) return null;
    const productIds = readIds(context.productIds);
    const expectedOpenItemIds = readIds(context.expectedOpenItemIds, true, 10000);
    if (!productIds || !expectedOpenItemIds || typeof context.additionalOrderConfirmed !== "boolean") return null;
    return { storeId: context.storeId.toLowerCase(), productIds, expectedOpenItemIds, additionalOrderConfirmed: context.additionalOrderConfirmed };
  } catch {
    return null;
  }
}

export function normalizeReplenishmentOrderIntent(value: unknown): ReplenishmentOrderIntent | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<ReplenishmentOrderIntent>;
  const productIds = readIds(input.productIds);
  return typeof input.storeId === "string" && uuidPattern.test(input.storeId) && productIds
    ? { storeId: input.storeId.toLowerCase(), productIds } : null;
}

export function isOpenReplenishmentOrderItem(status: string, orderNo: string) {
  return !orderNo.startsWith("RCPT-") && (openReplenishmentOrderStatuses as readonly string[]).includes(status);
}

export function replenishmentItemIdsMatch(expectedIds: string[], currentIds: string[]) {
  return JSON.stringify([...new Set(expectedIds)].sort()) === JSON.stringify([...new Set(currentIds)].sort());
}

export function validateReplenishmentOrderSubmission(
  context: ReplenishmentOrderContext,
  input: { storeId: string; productIds: string[]; quantities: unknown[] }
): string | null {
  const ids = readIds(input.productIds);
  if (input.storeId !== context.storeId || !ids || ids.length !== input.productIds.length || !replenishmentItemIdsMatch(ids, context.productIds)) {
    return "補充対象の店舗または商品が変わりました。最新の内容を確認してください。";
  }
  if (input.quantities.length !== input.productIds.length || input.quantities.some((quantity) => {
    if (quantity === "" || quantity === null || quantity === undefined) return true;
    const number = Number(quantity);
    return !Number.isInteger(number) || number < 1 || number > 999;
  })) return "補充する数量を1から999の整数で入力してください。";
  if (context.expectedOpenItemIds.length > 0 && !context.additionalOrderConfirmed) {
    return "未受領の発注を確認して、追加の補充が必要か確認してください。";
  }
  return null;
}

/** Exact IDs only: never replace an unavailable source SKU with a similar public product. */
export function resolveReplenishmentPrefill<T extends { id?: string; name: string }, P extends { id?: string; orderableStoreIds?: string[] }>(
  intent: ReplenishmentOrderIntent,
  stores: T[],
  products: P[]
): { store: T; products: P[] } | { error: string } {
  const store = stores.find((candidate) => candidate.id === intent.storeId);
  if (!store) return { error: "この店舗で補充依頼を作成する権限がありません。" };
  const targets = intent.productIds.map((id) => products.find((product) => product.id === id));
  if (targets.some((product) => !product || !product.orderableStoreIds?.includes(intent.storeId))) {
    return { error: "非公開または発注停止中の商品が含まれています。対象商品を確認してください。" };
  }
  return { store, products: targets as P[] };
}
