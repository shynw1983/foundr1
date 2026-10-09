import {
  canViewCatalogProductAtStore,
  evaluateProductOrderability,
  type CatalogPolicyProduct,
  type CatalogPolicyStore
} from "./product-catalog-policy";
import { isOpenReplenishmentOrderItem } from "./replenishment-order-intent";
import type { ProductUnitConversionSnapshot } from "./product-unit-conversions";
import { effectiveQuickInventoryStockStatus, type InventoryQuickCheck } from "./inventory-quick-policy";

export type ReplenishmentStockStatus = "low_stock" | "unavailable";
export type ReplenishmentSource = {
  kind: "item" | "option" | "inventory";
  id: string;
  name: string;
  displayNames?: Record<string, string>;
  stockStatus: ReplenishmentStockStatus;
  note?: string;
  locationName?: string;
  countUnit?: string;
  quantity?: number | null;
  lastCountedAt?: string | null;
  countConfidence?: "unknown" | "stale" | "confirmed";
  currentConversion?: ProductUnitConversionSnapshot | null;
  countConversionSnapshot?: ProductUnitConversionSnapshot | null;
  stockConversionSnapshot?: ProductUnitConversionSnapshot | null;
  lastCountedQuantity?: number | null;
  stockRevision?: number;
  lastReceivedAt?: string | null;
  conversionChanged?: boolean;
  purchaseEquivalent?: { quantity: number; unit: string } | null;
  quickCheck?: InventoryQuickCheck | null;
};
export type ReplenishmentOpenOrder = {
  id: string;
  orderNo: string;
  itemId: string;
  status: string;
  requestedQuantity: number | null;
  actualQuantity: number | null;
  unit: string;
  actualUnit: string | null;
};
export type ReplenishmentRisk = {
  key: string;
  product: { id: string; name: string; unit: string; isOrderable: boolean };
  sources: ReplenishmentSource[];
  openOrders: ReplenishmentOpenOrder[];
  pendingReceipts: ReplenishmentPendingReceipt[];
  blockedReason?: "unpublished" | "not_orderable";
};
export type ReplenishmentPendingReceipt = {
  itemId: string;
  orderNo: string;
  actualQuantity: number | null;
  actualUnit: string | null;
  receivedPurchaseQuantity: number;
  remainingPurchaseQuantity: number | null;
};
export type ReplenishmentUnmapped = {
  kind: "item" | "option";
  id: string;
  name: string;
  displayNames?: Record<string, string>;
  stockStatus: ReplenishmentStockStatus;
  brandId: string;
};
export type ReplenishmentSnapshot = {
  store: { id: string; name: string };
  risks: ReplenishmentRisk[];
  unmapped: ReplenishmentUnmapped[];
  restrictedSourceCount: number;
  canCreateOrder: boolean;
  canManageMenuLinks: boolean;
};
export type ReplenishmentResponse = ReplenishmentSnapshot;
export type ReplenishmentProductRow = CatalogPolicyProduct & { name: string; unit: string };
export type ReplenishmentMenuRow = {
  kind: "item" | "option";
  id: string;
  brandId: string;
  name: string;
  displayNames?: Record<string, string>;
  stockStatus: string;
  note: string;
  productIds: string[];
  availabilityBlockKeys: string[];
};
export type ReplenishmentInventoryRow = {
  id: string;
  productId: string;
  locationName: string;
  countUnit: string;
  quantity: number | null;
  safetyStock: number | null;
  exceptionCode: string;
  note: string;
  lastCountedAt: string | null;
  quickCheck?: InventoryQuickCheck | null;
};
export type ReplenishmentOrderRow = ReplenishmentOpenOrder & { productId: string };

export function nullableReplenishmentNumber(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function hasDirectMenuReplenishmentSignal(row: ReplenishmentMenuRow) {
  if (row.stockStatus === "low_stock") return true;
  if (row.stockStatus !== "unavailable") return false;
  // Pre-blocker settings were direct manual states. A blocked recipe must not
  // invent a shortage of every product associated with the dependent menu.
  if (!row.availabilityBlockKeys.length) return true;
  const identities = new Set([`${row.kind}:${row.id}`, `manual-existing:${row.id}`]);
  return row.availabilityBlockKeys.some((key) => identities.has(key));
}

export function inventoryReplenishmentSignal(row: ReplenishmentInventoryRow): ReplenishmentStockStatus | null {
  const status = effectiveQuickInventoryStockStatus({
    quantity: nullableReplenishmentNumber(row.quantity), safetyStock: nullableReplenishmentNumber(row.safetyStock),
    exceptionCode: row.exceptionCode, lastCountedAt: row.lastCountedAt, countUnit: row.countUnit, quickCheck: row.quickCheck
  });
  return status === "available" ? null : status;
}

/** A read model only: neither a shortage nor an open order creates quantities. */
export function deriveReplenishmentSnapshot(input: {
  store: CatalogPolicyStore & { name: string };
  role: string;
  canCreateOrder: boolean;
  canManageMenuLinks?: boolean;
  products: ReplenishmentProductRow[];
  menu: ReplenishmentMenuRow[];
  inventory: ReplenishmentInventoryRow[];
  orders: ReplenishmentOrderRow[];
  now?: number;
}): ReplenishmentSnapshot {
  const products = new Map(input.products.map((product) => [product.id, product]));
  const risks = new Map<string, ReplenishmentRisk>();
  const sourceKeys = new Map<string, Set<string>>();
  const restrictedSources = new Set<string>();
  const unmapped = new Map<string, ReplenishmentUnmapped>();
  const now = input.now ?? Date.now();

  function addSource(productId: string, source: ReplenishmentSource) {
    const sourceKey = `${source.kind}:${source.id}`;
    const product = products.get(productId);
    if (!product || !canViewCatalogProductAtStore(product, input.store, input.role, true)) {
      restrictedSources.add(sourceKey);
      return;
    }
    let risk = risks.get(productId);
    if (!risk) {
      const decision = evaluateProductOrderability(product, input.store, input.role, true);
      risk = {
        key: `${input.store.id}:${productId}`,
        product: { id: product.id, name: product.name, unit: product.unit, isOrderable: decision.allowed },
        sources: [], openOrders: [], pendingReceipts: [],
        ...(!decision.allowed ? { blockedReason: decision.reason === "not_orderable" ? "not_orderable" as const : "unpublished" as const } : {})
      };
      risks.set(productId, risk);
      sourceKeys.set(productId, new Set());
    }
    if (!sourceKeys.get(productId)?.has(sourceKey)) {
      risk.sources.push(source);
      sourceKeys.get(productId)?.add(sourceKey);
    }
  }

  for (const row of input.menu) {
    if (!hasDirectMenuReplenishmentSignal(row)) continue;
    const stockStatus = row.stockStatus as ReplenishmentStockStatus;
    const ids = Array.from(new Set(row.productIds));
    if (!ids.length) {
      unmapped.set(`${row.kind}:${row.id}`, { kind: row.kind, id: row.id, name: row.name, displayNames: row.displayNames, stockStatus, brandId: row.brandId });
      continue;
    }
    for (const productId of ids) {
      const product = products.get(productId);
      // A store may operate several brands. A stale link after a menu changes
      // brand must not borrow another brand's otherwise-visible SKU.
      const matchesMenuBrand = product?.brandScope === "common" || (
        product?.brandScope === "specific" && product.brandUsages.some((usage) => usage.brandId === row.brandId)
      );
      if (!matchesMenuBrand) {
        restrictedSources.add(`${row.kind}:${row.id}`);
        continue;
      }
      addSource(productId, {
        kind: row.kind, id: row.id, name: row.name, displayNames: row.displayNames, stockStatus, ...(row.note ? { note: row.note } : {})
      });
    }
  }
  for (const row of input.inventory) {
    const stockStatus = inventoryReplenishmentSignal(row);
    if (!stockStatus) continue;
    const countedAt = row.lastCountedAt ? Date.parse(row.lastCountedAt) : NaN;
    const quantity = nullableReplenishmentNumber(row.quantity);
    const countConfidence = quantity === null || !row.countUnit.trim() || !Number.isFinite(countedAt)
      ? "unknown" : now - countedAt > 7 * 24 * 60 * 60 * 1000 || countedAt > now ? "stale" : "confirmed";
    addSource(row.productId, {
      kind: "inventory", id: row.id, name: products.get(row.productId)?.name ?? "",
      stockStatus, locationName: row.locationName, countUnit: row.countUnit,
      quantity, lastCountedAt: row.lastCountedAt, countConfidence, quickCheck: row.quickCheck ?? null,
      ...(row.note ? { note: row.note } : {})
    });
  }
  const orderIds = new Set<string>();
  for (const order of input.orders) {
    const risk = risks.get(order.productId);
    if (!risk || !isOpenReplenishmentOrderItem(order.status, order.orderNo) || orderIds.has(order.itemId)) continue;
    orderIds.add(order.itemId);
    risk.openOrders.push({
      id: order.id, orderNo: order.orderNo, itemId: order.itemId, status: order.status,
      requestedQuantity: nullableReplenishmentNumber(order.requestedQuantity),
      actualQuantity: nullableReplenishmentNumber(order.actualQuantity),
      unit: order.unit, actualUnit: order.actualUnit || null
    });
  }
  return {
    store: { id: input.store.id, name: input.store.name },
    risks: [...risks.values()].sort((left, right) => left.product.name.localeCompare(right.product.name, "ja")),
    unmapped: [...unmapped.values()], restrictedSourceCount: restrictedSources.size,
    canCreateOrder: input.canCreateOrder,
    canManageMenuLinks: input.canManageMenuLinks === true
  };
}
