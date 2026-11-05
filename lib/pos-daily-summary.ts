import { allocateRefundYen } from "./pos-refund-policy";

export type PosProductSummary = {
  key: string; name: string; isBowl: boolean; quantity: number; total: number; average: number;
};
export type PosDailyItem = {
  id: string; catalogId: string; localId?: string; name: string; isBowl: boolean;
  quantity: number; refundedQuantity: number; refundedAmount: number; paidAmount: number;
  refundStatus?: string; snapshotPaidAmount?: number | null;
};
export type PosDailyOrder = { id: string; amount: number; items: PosDailyItem[] };

// Read the historical checkout amounts, including paid options. Allocate tax/rounding
// exactly like refunds; today's catalog prices must never recalculate a paid sale.
export function summarizePosProducts(orders: PosDailyOrder[]): PosProductSummary[] {
  const products = new Map<string, PosProductSummary>();
  for (const order of orders) {
    const originalTotal = order.amount + order.items.reduce((n, i) => n + i.refundedAmount, 0);
    const weights = order.items.map(i => Math.max(0, i.paidAmount));
    // Orders without structured items remain in the payment summary only.
    if (!order.items.length) continue;
    const allocated = weights.some(Boolean) ? allocateRefundYen(originalTotal, weights) : weights;
    order.items.forEach((item, index) => {
      const quantity = item.refundStatus === "refunded" ? 0 : Math.max(0, item.quantity - item.refundedQuantity);
      if (!quantity) return;
      const identity = item.localId ? `local:${item.localId}` : item.catalogId ? `catalog:${item.catalogId}` : `name:${item.name}`;
      const key = `${identity}:${item.isBowl ? "bowl" : "item"}`;
      const entry = products.get(key) || { key, name: item.name, isBowl: item.isBowl, quantity: 0, total: 0, average: 0 };
      entry.quantity += quantity;
      entry.total += Math.max(0, (item.snapshotPaidAmount ?? allocated[index]) - item.refundedAmount);
      entry.average = Math.round(entry.total / entry.quantity);
      products.set(key, entry);
    });
  }
  return [...products.values()].sort((a, b) => Number(b.isBowl) - Number(a.isBowl) || b.quantity - a.quantity || a.key.localeCompare(b.key));
}
