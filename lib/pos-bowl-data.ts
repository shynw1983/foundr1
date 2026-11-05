import { sql } from "./db";
import { posOrderHasPreparationSql, posPreparationItemSql } from "./pos-item-fulfillment";
import { posOrderHasActiveImmediateSql, posOrderHasPreparationOrLegacySql, posPreparationTaskSql } from "./pos-production-task-filter";
import type { PosServingTicket } from "./pos-serving-policy";

export async function abandonUnrecordedPosCheckout(storeId: string, requestId: string, employeeId: string) {
  const [, rows] = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${`pos:${storeId}:${requestId}`},0))`,
    sql`insert into pos_abandoned_checkouts(store_id,request_id,abandoned_by)
      select ${storeId}::uuid,${requestId},${employeeId}::uuid
      where not exists (select 1 from store_customer_orders where store_id::text=${storeId} and offline_client_order_id=${requestId})
      on conflict (store_id,request_id) do update set request_id=excluded.request_id returning request_id`
  ]);
  return Boolean(rows[0]);
}

export class PosCashSessionChangedError extends Error {
  readonly code = "POS_CASH_SESSION_CHANGED";
  readonly status = 409;
  constructor() {
    super("レジの開閉店状態が変わりました。画面を更新して会計をやり直してください。");
    this.name = "PosCashSessionChangedError";
  }
}

/** Always acquire this before a cash-session row or pickup-counter lock. */
export function posCashStoreLock(storeId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${`pos-cash-session:${storeId}`},0))`;
}

export function posCashSessionGuards(storeId: string, cashSessionId: string) {
  return [
    posCashStoreLock(storeId),
    sql`select id from pos_cash_sessions where store_id::text=${storeId} and id::text=${cashSessionId} for update`,
    sql`select 1 / case when exists(select 1 from pos_cash_sessions
      where store_id::text=${storeId} and id::text=${cashSessionId} and status='open') then 1 else 0 end as cash_session_current`
  ];
}

export async function isPosCashSessionOpen(storeId: string, cashSessionId: string) {
  const rows = await sql`select exists(select 1 from pos_cash_sessions
    where store_id::text=${storeId} and id::text=${cashSessionId} and status='open') as "isOpen"`;
  return rows[0]?.isOpen === true;
}

export async function allocatePosBowlCodes(storeId: string, count: number, cashSessionId: string): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > 99) throw new Error("1回の会計は99杯までです。");
  if (!cashSessionId) throw new PosCashSessionChangedError();
  try {
    const results = await sql.transaction([
      ...posCashSessionGuards(storeId, cashSessionId),
      // Retain the running sequence on deployment, including a legacy store
      // without a counter row. Only a successful new opening resets it to zero.
      sql`insert into pos_pickup_counters(store_id,last_number)
        select ${storeId}::uuid, coalesce((select max(history.pickup_code::bigint) from (
          select pickup_code from store_customer_orders where store_id::text=${storeId}
          union all
          select items.pickup_code from store_customer_order_items items
            join store_customer_orders orders on orders.id=items.order_id where orders.store_id::text=${storeId}
        ) history where history.pickup_code ~ '^[0-9]{1,12}$'),0)
        where not exists(select 1 from pos_pickup_counters where store_id::text=${storeId})
        on conflict(store_id) do nothing`,
      sql`with reserved as materialized (
        select distinct active.pickup_code::bigint as number from (
          select items.pickup_code from store_customer_order_items items
          join store_customer_orders orders on orders.id=items.order_id
          where orders.store_id::text=${storeId} and orders.status in ('new','preparing','ready')
            and orders.payment_status in ('paid','partial_refunded') and items.refund_status<>'refunded'
            and ${sql.unsafe(posPreparationItemSql('orders', 'items'))}
            and (not exists(select 1 from order_production_tasks tasks where tasks.order_item_id=items.id)
              or exists(select 1 from order_production_tasks tasks where tasks.order_item_id=items.id and tasks.handed_off_at is null))
          union all
          select orders.pickup_code from store_customer_orders orders
          where orders.store_id::text=${storeId} and orders.status in ('new','preparing','ready')
            and orders.payment_status in ('paid','partial_refunded')
            and ${sql.unsafe(posOrderHasPreparationOrLegacySql('orders'))}
            and (not exists(select 1 from store_customer_order_items items where items.order_id=orders.id)
              or exists(select 1 from store_customer_order_items items where items.order_id=orders.id and items.refund_status<>'refunded'))
            and (not exists(select 1 from store_customer_order_items items where items.order_id=orders.id and items.pickup_code<>'')
              or exists(select 1 from order_production_tasks tasks where tasks.order_id=orders.id
                and tasks.order_item_id is null and tasks.handed_off_at is null))
            and (not exists(select 1 from order_production_tasks tasks where tasks.order_id=orders.id and tasks.order_item_id is null)
              or exists(select 1 from order_production_tasks tasks where tasks.order_id=orders.id
                and tasks.order_item_id is null and tasks.handed_off_at is null))
        ) active where active.pickup_code ~ '^[0-9]{1,12}$'
      ), chosen as materialized (
        select candidates.number from pos_pickup_counters counter
        cross join lateral generate_series(counter.last_number+1,
          counter.last_number+${count}+(select count(*) from reserved)) candidates(number)
        where counter.store_id::text=${storeId} and not exists(select 1 from reserved where reserved.number=candidates.number)
        order by candidates.number limit ${count}
      ), updated as (
        update pos_pickup_counters set last_number=(select max(number) from chosen)
        where store_id::text=${storeId} returning store_id
      ) select chosen.number::text as code from chosen cross join updated order by chosen.number`
    ]);
    return results[results.length - 1].map(row => String(row.code).padStart(3, "0"));
  } catch (error) {
    if ((error as { code?: string }).code === "22012") throw new PosCashSessionChangedError();
    throw error;
  }
}

export async function readPosServingTickets(orderId: string): Promise<PosServingTicket[]> {
  return await sql`
    select items.sort_order::int as "itemIndex", items.pickup_code as "pickupCode",
      items.id::text as "itemId", tasks.id::text as "taskId", coalesce(tasks.handed_off_at::text, '') as "handedOffAt"
    from store_customer_order_items items
    join store_customer_orders orders on orders.id=items.order_id
    left join order_production_tasks tasks on tasks.order_item_id = items.id
    where items.order_id::text = ${orderId} and items.pickup_code <> ''
      and ${sql.unsafe(posPreparationItemSql('orders', 'items'))}
    order by items.sort_order
  ` as PosServingTicket[];
}

export async function handoffPosBowl(taskId: string, storeId: string) {
  const [, rows] = await sql.transaction([
    sql`select orders.id from store_customer_orders orders join order_production_tasks tasks on tasks.order_id=orders.id
      where tasks.id::text=${taskId} and orders.store_id::text=${storeId} for update of orders`,
    sql`with locked as materialized (
      select orders.id from store_customer_orders orders
      join order_production_tasks tasks on tasks.order_id = orders.id
      where tasks.id::text = ${taskId} and orders.store_id::text = ${storeId}
        and orders.status in ('new', 'preparing', 'ready')
        and orders.payment_status in ('paid', 'partial_refunded')
        and ${sql.unsafe(posPreparationTaskSql('orders', 'tasks'))}
      for update of orders
    ), changed as (
      update order_production_tasks tasks set handed_off_at = now(), updated_at = now()
      from locked where tasks.order_id = locked.id and tasks.id::text = ${taskId}
        and tasks.order_item_id is not null and tasks.status = 'ready' and tasks.handed_off_at is null
        and exists (select 1 from store_customer_order_items items where items.id = tasks.order_item_id and items.refund_status <> 'refunded')
      returning tasks.id, tasks.order_id
    )
    update store_customer_orders orders set
      status = case when not exists (
        select 1 from order_production_tasks tasks
        left join store_customer_order_items items on items.id = tasks.order_item_id
        where tasks.order_id = orders.id and tasks.handed_off_at is null
          and tasks.id <> changed.id and coalesce(items.refund_status, '') <> 'refunded'
          and ${sql.unsafe(posPreparationTaskSql('orders', 'tasks'))}
      ) then 'completed' else orders.status end,
      completed_at = case when not exists (
        select 1 from order_production_tasks tasks
        left join store_customer_order_items items on items.id = tasks.order_item_id
        where tasks.order_id = orders.id and tasks.handed_off_at is null
          and tasks.id <> changed.id and coalesce(items.refund_status, '') <> 'refunded'
          and ${sql.unsafe(posPreparationTaskSql('orders', 'tasks'))}
      ) then now() else orders.completed_at end,
      updated_at = now()
    from changed where orders.id = changed.order_id returning orders.id::text as "orderId"
  `]);
  return String(rows[0]?.orderId || "");
}

// A refund of the last outstanding bowl can finish an otherwise fully handed-off sale.
export async function finishHandedOffPosOrder(orderId: string) {
  await sql`
    update store_customer_orders orders set status='completed', completed_at=coalesce(completed_at,now()), updated_at=now()
    where orders.id::text=${orderId} and orders.order_source='store_pos'
      and orders.status in ('new','preparing','ready') and orders.payment_status in ('paid','partial_refunded')
      and (exists (select 1 from order_production_tasks tasks where tasks.order_id=orders.id and tasks.handed_off_at is not null)
        or (not ${sql.unsafe(posOrderHasPreparationSql('orders'))} and ${sql.unsafe(posOrderHasActiveImmediateSql('orders'))}))
      and not exists (
        select 1 from order_production_tasks tasks left join store_customer_order_items items on items.id=tasks.order_item_id
        where tasks.order_id=orders.id and tasks.handed_off_at is null and coalesce(items.refund_status,'') <> 'refunded'
          and ${sql.unsafe(posPreparationTaskSql('orders', 'tasks'))}
      )
  `;
}

/** Reject a stale closing amount if checkout/refund changed cash sales before close acquired its lock. */
export function posCashFinancialGuard(storeId: string, cashSessionId: string, expectedAmount: number) {
  return sql`select 1 / case when s.opening_amount
    + coalesce((select sum(o.amount) from store_customer_orders o where o.pos_cash_session_id=s.id and o.order_source in ('store_pos','table_qr') and o.payment_status in ('paid','partial_refunded') and o.payment_provider='cash' and o.status<>'cancelled'),0)
    + coalesce((select sum(case when m.movement_type='cash_in' then m.amount when m.movement_type='cash_out' then -m.amount else 0 end) from pos_cash_movements m where m.session_id=s.id),0)
    = ${expectedAmount} then 1 else 0 end as financials_current from pos_cash_sessions s where s.id::text=${cashSessionId} and s.store_id::text=${storeId}`;
}
