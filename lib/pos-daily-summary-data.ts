import { sql } from "./db";
import { summarizePosProducts, type PosDailyOrder } from "./pos-daily-summary";

export async function getTodaySummary(storeId: string) {
  if (!storeId) return { orderCount: 0, total: 0, average: 0, products: [], latestOrders: [] };
  // One snapshot for both payment and product totals. JST calendar boundaries match
  // the existing 本日 label; opening the register does not reset today's sales.
  const [orders, latestOrders] = await Promise.all([
    sql`
      select o.id::text, o.amount::int,
        coalesce(jsonb_agg(jsonb_build_object(
          'id', i.id::text, 'catalogId', coalesce(i.menu_catalog_item_id::text, ''),
          'localId', coalesce(o.customer_summary->'items'->i.sort_order->>'storeMenuItemId', ''),
          'name', i.item_name,
          'isBowl', case when o.customer_summary->'items'->i.sort_order->>'productionType' in ('bowl','drink','item')
            then o.customer_summary->'items'->i.sort_order->>'productionType' = 'bowl'
            else coalesce(i.pickup_code, '') <> '' end,
          'quantity', i.quantity, 'refundedQuantity', i.refunded_quantity,
          'refundStatus', i.refund_status, 'refundedAmount', i.refunded_amount,
          'paidAmount', case when i.gross_amount > 0 or i.discount_amount > 0 or i.coupon_discount_amount > 0
            then i.paid_amount else i.amount end,
          'snapshotPaidAmount', i.refund_snapshot->'paidAmount'
        ) order by i.id) filter (where i.id is not null), '[]'::jsonb) as items
      from store_customer_orders o
      left join store_customer_order_items i on i.order_id = o.id
      where o.store_id::text = ${storeId}
        and o.order_source in ('store_pos', 'table_qr')
        and o.created_at >= (date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')
        and o.created_at < ((date_trunc('day', now() at time zone 'Asia/Tokyo') + interval '1 day') at time zone 'Asia/Tokyo')
        and o.status not in ('cancelled', 'refund_pending')
        and o.payment_status in ('paid', 'partial_refunded')
      group by o.id order by o.created_at desc, o.id
    `,
    sql`
      select id::text, pickup_code as "pickupCode", amount, payment_provider as "paymentMethod",
        to_char(created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime"
      from store_customer_orders where store_id::text = ${storeId} and order_source in ('store_pos', 'table_qr')
      order by created_at desc limit 8
    `
  ]);
  const day = orders as PosDailyOrder[];
  const orderCount = day.length, total = day.reduce((n, o) => n + Number(o.amount), 0);
  return { orderCount, total, average: orderCount ? Math.round(total / orderCount) : 0,
    products: summarizePosProducts(day), latestOrders };
}
