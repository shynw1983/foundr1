import { createHash, randomUUID } from 'node:crypto';
import { sql } from './db';
import { posCashStoreLock } from './pos-bowl-data';
import { isMemberExchangeCoupon } from './loyalty';
import { planPosRefund, refundSnapshots, PosRefundError, type RefundItem, type OptionSelection } from './pos-refund-policy';
import { relayPrintLock, cancelRefundedRelayJobs } from './store-relay-print-policy';
import { guardPosPrintRefund, cancelIneligiblePosPrintDocuments } from './pos-print-document-ledger';

export type PosRefundInput = { storeId: string; orderId: string; requestId?: string; itemIds: string[]; options: OptionSelection[]; reason: string; externalRefundConfirmed: boolean; actor: { id: string; name: string } };
export const posRefundItemFields = `i.id::text, i.quantity, i.amount, coalesce(nullif(i.gross_amount,0),i.amount)::int as "grossAmount",
 case when i.gross_amount>0 or i.discount_amount>0 or i.coupon_discount_amount>0 then i.paid_amount else i.amount end::int as "paidAmount",
 i.discount_amount as "discountAmount",i.coupon_discount_amount as "couponDiscountAmount",coalesce(i.coupon_id::text,'') as "couponId",
 i.refund_status as "refundStatus",i.refunded_amount as "refundedAmount",i.customizations,i.refund_snapshot as "refundSnapshot",i.refunded_option_keys as "refundedOptionKeys",
 i.size_key as "sizeKey",i.size_label as size,i.temperature,i.sweetness,i.ice,i.option_key as "optionKey",i.option_label as option,i.topping_keys as "toppingKeys",i.topping_labels as toppings,
 c.issued_source as "couponIssuedSource",c.name as "couponName",to_jsonb(i) as state`;
export async function readPosRefundItems(orderId: string): Promise<(RefundItem & { state: unknown })[]> {
  const rows = await sql`select ${sql.unsafe(posRefundItemFields)} from store_customer_order_items i left join member_coupons c on c.id=i.coupon_id where i.order_id::text=${orderId} order by i.id`;
  return rows.map(row => ({ ...row, exchangeCoupon: isMemberExchangeCoupon({ issuedSource: String(row.couponIssuedSource || ''), name: String(row.couponName || '') }) })) as (RefundItem & { state: unknown })[];
}
export async function posRefundPresentation(orderId: string, amount: number) {
  const items = await readPosRefundItems(orderId), snapshots = refundSnapshots(items, amount);
  return new Map(items.map((item, i) => [item.id, {
    remainingPaidAmount: Math.max(0, snapshots[i].paidAmount - item.refundedAmount),
    refundOptions: snapshots[i].options.map(option => ({ ...option, refunded: item.refundStatus === 'refunded' || item.refundedOptionKeys.includes(option.key) })),
    refundedOptionKeys: item.refundedOptionKeys
  }]));
}
export async function recordPosRefund(input: PosRefundInput) {
  const requestId = input.requestId || randomUUID();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) throw new PosRefundError('返品リクエストを確認してください。');
  const fingerprint = createHash('sha256').update(JSON.stringify({ orderId: input.orderId, itemIds: [...input.itemIds].sort(), options: [...input.options].sort((a,b) => `${a.itemId}/${a.key}`.localeCompare(`${b.itemId}/${b.key}`)), reason: input.reason, externalRefundConfirmed: input.externalRefundConfirmed })).digest('hex');
  const replay = async () => {
    const rows = await sql`select request_fingerprint as fingerprint,amount,allocations from pos_refund_events where store_id::text=${input.storeId} and request_id=${requestId}::uuid`;
    if (!rows.length) return null;
    if (rows[0].fingerprint !== fingerprint) throw new PosRefundError('同じリクエスト番号で返品内容を変更できません。', 409);
    return { refundAmount: Number(rows[0].amount), requestId, allocations: rows[0].allocations, replayed: true };
  };
  const existing = await replay(); if (existing) return existing;
  const orders = await sql`select o.id::text,o.amount,o.status,o.payment_status as "paymentStatus",o.payment_provider as "paymentMethod",o.pos_cash_session_id::text as "cashSessionId",coalesce(c.status,'') as "cashSessionStatus"
    from store_customer_orders o left join pos_cash_sessions c on c.id=o.pos_cash_session_id where o.id::text=${input.orderId} and o.store_id::text=${input.storeId} and o.order_source in ('store_pos','table_qr')`;
  const order = orders[0];
  if (!order) throw new PosRefundError('会計が見つかりません。',404);
  if (order.cashSessionStatus !== 'open') throw new PosRefundError('締め済みのレジ会計は管理画面で修正してください。');
  if (!['paid','partial_refunded'].includes(String(order.paymentStatus)) || ['cancelled','refund_pending'].includes(String(order.status))) throw new PosRefundError('この会計は返金できません。',409);
  const items = await readPosRefundItems(input.orderId);
  const plan = planPosRefund(items, Number(order.amount), input.itemIds.length || input.options.length ? input.itemIds : items.filter(i => i.refundStatus !== 'refunded').map(i => i.id), input.options);
  if (order.paymentMethod !== 'cash' && plan.amount > 0 && !input.externalRefundConfirmed) throw new PosRefundError('外部決済端末で返金操作を完了してから、外部返金済みにチェックしてください。');
  const originalTotal = Number(order.amount) + items.reduce((n,i) => n+i.refundedAmount,0);
  const cumulativeRefund = originalTotal - Number(order.amount) + plan.amount;
  const stampQuantity = plan.updates.reduce((n,u) => n+u.stampQuantity,0);
  const allocations = plan.updates.map(u => ({ itemId: u.id, full: u.full, amount: u.amount, options: u.options }));
  const writes = [posCashStoreLock(input.storeId),relayPrintLock(input.storeId),
    sql`select id from pos_cash_sessions where id::text=${order.cashSessionId} for update`,
    sql`select id from store_customer_orders where id::text=${input.orderId} and store_id::text=${input.storeId} for update`,guardPosPrintRefund(input.storeId,input.orderId),
    sql`select 1 / case when exists(select 1 from store_customer_orders o join pos_cash_sessions c on c.id=o.pos_cash_session_id
      where o.id::text=${input.orderId} and o.store_id::text=${input.storeId} and o.amount=${Number(order.amount)} and o.payment_status in ('paid','partial_refunded')
      and o.status not in ('cancelled','refund_pending') and c.status='open' and o.payment_provider=${String(order.paymentMethod)})
      and not exists(select 1 from pos_refund_events where store_id::text=${input.storeId} and request_id=${requestId}::uuid)
      and (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from store_customer_order_items i where i.order_id::text=${input.orderId})=${JSON.stringify(items.map(i => i.state))}::jsonb then 1 else 0 end as refund_allowed`];
  for (const u of plan.updates) {
    writes.push(sql`update store_customer_order_items set refund_snapshot=coalesce(refund_snapshot,${JSON.stringify(u.snapshot)}::jsonb),refunded_option_keys=${u.refundedOptionKeys}::text[],
      refund_status=${u.full?'refunded':'partial'},refunded_quantity=case when ${u.full} then quantity else refunded_quantity end,refunded_amount=${u.refundedAmount},refund_reason=${input.reason},
      external_refund_confirmed_at=case when ${order.paymentMethod!=='cash'&&u.amount>0} then now() else external_refund_confirmed_at end,refunded_at=now(),refunded_by=${input.actor.id}::uuid,
      customizations=${JSON.stringify(u.customizations)}::jsonb,size_key=${u.labels.sizeKey},size_label=${u.labels.size},temperature=${u.labels.temperature},sweetness=${u.labels.sweetness},ice=${u.labels.ice},option_key=${u.labels.optionKey},option_label=${u.labels.option},topping_keys=${u.labels.toppingKeys}::text[],topping_labels=${u.labels.toppings}::text[]
      where id::text=${u.id} and order_id::text=${input.orderId}`);
  }
  writes.push(sql`update store_customer_orders set amount=amount-${plan.amount},status=case when ${plan.allRefunded} then 'cancelled' else status end,
    payment_status=case when ${plan.allRefunded} then 'refunded' else 'partial_refunded' end,payment_refund_status=case when ${plan.allRefunded} then 'succeeded' else 'partial' end,payment_refunded_at=now(),
    cancelled_at=case when ${plan.allRefunded} then coalesce(cancelled_at,now()) else cancelled_at end,inventory_items_ready_at=null,
    customer_summary=customer_summary || ${JSON.stringify({lastRefundRequestId:requestId,lastRefundAmount:plan.amount,lastRefundReason:input.reason,lastRefundedById:input.actor.id,lastRefundedByName:input.actor.name})}::jsonb,updated_at=now() where id::text=${input.orderId}`);
  // Points, spend, stamps and used coupon changes share the financial transaction.
  writes.push(sql`insert into member_accounts(member_id) select member_id from store_customer_orders where id::text=${input.orderId} and member_id is not null on conflict(member_id) do nothing`);
  writes.push(sql`with earned as (select * from loyalty_point_ledger where order_id::text=${input.orderId} and movement_type='earn'), reversed as (
      select coalesce(-sum(points),0)::int as points,coalesce(sum(eligible_amount),0)::int as amount from loyalty_point_ledger where order_id::text=${input.orderId} and movement_type in ('refund_reversal','item_refund_reversal')
    ), adjustment as (insert into loyalty_point_ledger(member_id,order_id,brand_id,store_id,company_id,movement_type,points,eligible_amount,point_rate_basis,source,note)
      select e.member_id,e.order_id,e.brand_id,e.store_id,e.company_id,${plan.allRefunded?'refund_reversal':'item_refund_reversal'},
        -greatest(0,least(e.points,case when ${plan.allRefunded} then e.points else floor(e.points::numeric*${cumulativeRefund}/greatest(1,${originalTotal}))::int end)-r.points),
        greatest(0,least(e.eligible_amount,case when ${plan.allRefunded} then e.eligible_amount else floor(e.eligible_amount::numeric*${cumulativeRefund}/greatest(1,${originalTotal}))::int end)-r.amount),
        e.point_rate_basis,'refund',${`POS 返品 ${requestId}`} from earned e cross join reversed r on conflict do nothing returning member_id,points,eligible_amount)
      update member_accounts a set point_balance=greatest(0,a.point_balance+x.points),lifetime_points_earned=greatest(0,a.lifetime_points_earned+x.points),lifetime_spend_amount=greatest(0,a.lifetime_spend_amount-x.eligible_amount),
        lifetime_visit_count=greatest(0,a.lifetime_visit_count-case when ${plan.allRefunded} then 1 else 0 end),updated_at=now() from adjustment x where a.member_id=x.member_id`);
  writes.push(sql`update loyalty_stamp_ledger set stamps=greatest(0,stamps-${stampQuantity}) where order_id::text=${input.orderId}`);
  const couponIds = plan.updates.map(u => u.couponId).filter(Boolean);
  writes.push(sql`update member_coupons set status='available',used_order_id=null,used_store_id=null,used_at=null,metadata=metadata||${JSON.stringify({restoredByRefundRequestId:requestId})}::jsonb where id::text=any(${couponIds}::text[]) and used_order_id::text=${input.orderId} and status='used'`);
  writes.push(sql`insert into pos_refund_events(store_id,order_id,request_id,request_fingerprint,amount,allocations,reason,payment_method,external_refund_confirmed,created_by,created_by_name)
    values(${input.storeId}::uuid,${input.orderId}::uuid,${requestId}::uuid,${fingerprint},${plan.amount},${JSON.stringify(allocations)}::jsonb,${input.reason},${String(order.paymentMethod)},${input.externalRefundConfirmed},${input.actor.id}::uuid,${input.actor.name})`);
  writes.push(cancelRefundedRelayJobs(input.storeId,input.orderId),cancelIneligiblePosPrintDocuments(input.storeId,input.orderId));
  try { await sql.transaction(writes); }
  catch(error) { if ((error as {code?:string}).code==='22012') { const replayed=await replay();if(replayed)return replayed;throw new PosRefundError('返金状態が変わりました。会計を再確認してください。',409); } throw error; }
  return {refundAmount:plan.amount,requestId,allocations,replayed:false};
}
