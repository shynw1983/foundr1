import { sql } from './db';
import type { PosPrintPayload } from './pos-printer';

// These fixed SQL fragments all refer to the print job as `j`. No caller input is
// interpolated as SQL. A bowl code identifies one item; aggregate legacy kitchen
// documents cannot safely be rewritten after a partial refund.
export const relayJobHasRefundSql = `exists (
  select 1 from store_customer_orders ro where ro.id=j.order_id
    and (ro.payment_status in ('partial_refunded','refunded')
      or exists(select 1 from store_customer_order_items ri where ri.order_id=ro.id and (ri.refund_status='refunded' or cardinality(ri.refunded_option_keys)>0)))
)`;
export const relayJobRefundedSql = `(exists (
  select 1 from store_customer_orders ro where ro.id=j.order_id
    and (ro.payment_status='refunded' or ro.status='cancelled')
) or (j.kind in ('kitchen','pickup') and (
  exists(select 1 from store_customer_order_items ri where ri.order_id=j.order_id
    and ri.pickup_code<>'' and ri.pickup_code=j.payload->'order'->>'pickupCode' and (ri.refund_status='refunded' or cardinality(ri.refunded_option_keys)>0))
  or (${relayJobHasRefundSql} and not exists(select 1 from store_customer_order_items ri
    where ri.order_id=j.order_id and ri.pickup_code<>'' and ri.pickup_code=j.payload->'order'->>'pickupCode'))
)))`;
export const relayJobCanPrintSql = `(j.order_id is null or exists (
  select 1 from store_customer_orders ro where ro.id=j.order_id
    and ro.payment_status in ('paid','partial_refunded') and ro.status not in ('cancelled','refund_pending')
    and (j.kind='receipt' or ro.status in ('new','preparing','ready'))
)) and not ${relayJobRefundedSql}`;
export const relayJobCanReprintSql = `(${relayJobCanPrintSql}) and (
  j.kind not in ('kitchen','pickup') or not exists (
    select 1 from order_production_tasks rt join store_customer_order_items ri on ri.id=rt.order_item_id
    where rt.order_id=j.order_id and ri.pickup_code=j.payload->'order'->>'pickupCode'
      and (rt.handed_off_at is not null or ri.refund_status='refunded')
  )
)`;
export const relayJobNeedsReviewSql = `(j.state='uncertain' or
  (j.state='sending' and j.claimed_at<clock_timestamp()-interval '2 minutes'))`;

export function relayPrintLock(storeId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${`store-relay-print:${storeId}`},0))`;
}

// Call inside the same transaction as the refund or a claim, under relayPrintLock.
// Never rewrite a snapshot or silently resolve a task that may already have sent.
export function cancelRefundedRelayJobs(storeId: string, orderId = '') {
  return sql`update store_relay_print_jobs j set state='cancelled',claim_token=null,
    error='返金・キャンセルにより未送信の伝票を終了しました。',updated_at=now()
    where j.store_id::text=${storeId} and (${orderId}='' or j.order_id::text=${orderId})
      and j.state='pending' and ${sql.unsafe(relayJobRefundedSql)} returning j.id`;
}

export function relayReceiptWithRefundNotice(payload: PosPrintPayload): PosPrintPayload {
  return { ...payload, printer: { ...payload.printer, openCashDrawer: false },
    order: payload.order ? { ...payload.order,
      receiptTitle: '返金前の原会計・一部返金あり',
      note: ['返金前の金額です。現在の残額・返金額を示すものではありません。', payload.order.note].filter(Boolean).join('\n')
    } : payload.order };
}
