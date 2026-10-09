export type ReplenishmentOrderLockScope = { storeId: string; productIds: Array<string | null | undefined> };

/** Existing-order edits lock the order first, then every affected store/SKU in one order. */
export function replenishmentOrderLockKeys(scopes: ReplenishmentOrderLockScope[], purchaseOrderId?: string) {
  const skuKeys = scopes.flatMap((scope) => scope.productIds
    .filter((id): id is string => Boolean(id?.trim()))
    .map((id) => `purchase-order:${scope.storeId.toLowerCase()}:${id.trim().toLowerCase()}`));
  return [
    ...(purchaseOrderId ? [`purchase-order-items:${purchaseOrderId.toLowerCase()}`] : []),
    ...[...new Set(skuKeys)].sort()
  ];
}

export function createReplenishmentOrderLocks<T>(
  query: (parts: TemplateStringsArray, ...values: any[]) => T,
  scopes: ReplenishmentOrderLockScope[],
  purchaseOrderId?: string
) {
  return replenishmentOrderLockKeys(scopes, purchaseOrderId).map((key) => query`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** A guard statement deliberately raises this code to roll back a stale transaction. */
export function isReplenishmentOrderGuardConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "22012");
}
