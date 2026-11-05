import { isPosBowl } from './pos-serving-policy';

export type PosItemFulfillmentMode = 'prepare' | 'immediate';
export type PosFulfillmentItem = {
  fulfillmentMode?: string; productionType?: string; itemKind?: string; brandName?: string; posPricingMode?: string;
};
export type PosItemFulfillmentSnapshot = {
  version: 1;
  items: Record<string, { mode: PosItemFulfillmentMode; handedOffAt?: string }>;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** This property comes from the store's trusted POS catalog, never the submitted cart. */
export function getPosItemFulfillmentMode(item: PosFulfillmentItem): PosItemFulfillmentMode {
  return !isPosBowl(item) && item.fulfillmentMode === 'immediate' ? 'immediate' : 'prepare';
}
export function isPosImmediateItem(item: PosFulfillmentItem): boolean { return getPosItemFulfillmentMode(item) === 'immediate'; }

export function createPosItemFulfillmentSnapshot(items: Array<PosFulfillmentItem & { orderItemId: string }>, handedOffAt: string): PosItemFulfillmentSnapshot {
  if (!Number.isFinite(Date.parse(handedOffAt))) throw new Error('Invalid handoff time');
  const result: PosItemFulfillmentSnapshot = { version: 1, items: {} };
  for (const item of items) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.orderItemId) || result.items[item.orderItemId]) throw new Error('Invalid order item identity');
    const mode = getPosItemFulfillmentMode(item);
    result.items[item.orderItemId] = mode === 'immediate' ? { mode, handedOffAt } : { mode };
  }
  return result;
}

/** Unknown/legacy snapshots keep their original preparation workflow. */
export function isPosOrderItemImmediate(summary: unknown, itemId: string, orderSource: string): boolean {
  const policy = record(record(summary).posItemFulfillment);
  return orderSource === 'store_pos' && policy.version === 1 && record(record(policy.items)[itemId]).mode === 'immediate';
}
function alias(value: string): string { if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error('Invalid internal SQL alias'); return value; }
/** Fixed internal fragments share the immutable per-line contract across queue readers. */
export function posImmediateItemSql(orderAlias: string, itemAlias: string): string {
  const o = alias(orderAlias), i = alias(itemAlias);
  return `coalesce((${o}.order_source='store_pos' and ${o}.customer_summary->'posItemFulfillment'->'version'='1'::jsonb and ${o}.customer_summary->'posItemFulfillment'->'items'->(${i}.id::text)->>'mode'='immediate'),false)`;
}
export function posPreparationItemSql(orderAlias: string, itemAlias: string): string { return `(not ${posImmediateItemSql(orderAlias, itemAlias)})`; }
export function posOrderHasPreparationSql(orderAlias: string): string {
  const o = alias(orderAlias);
  return `exists(select 1 from store_customer_order_items fulfillment_item where fulfillment_item.order_id=${o}.id and fulfillment_item.refund_status<>'refunded' and ${posPreparationItemSql(o, 'fulfillment_item')})`;
}
