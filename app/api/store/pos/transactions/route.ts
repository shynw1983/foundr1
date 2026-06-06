import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { reverseLoyaltyForRefundedOrder } from "../../../../../lib/loyalty";
import { syncWebReservationToSalesOrder } from "../../../../../lib/sales-orders";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

async function getSelectedStoreId(request: Request, session: Awaited<ReturnType<typeof requireOsSession>>) {
  if (!session) return { access: null, selectedStoreId: "", forbidden: false };
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { access, selectedStoreId: "", forbidden: true };
  return { access, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
}

async function getTodaySummary(selectedStoreId: string) {
  const rows = await sql`
    select
      count(*)::int as "orderCount",
      coalesce(sum(amount), 0)::int as total
    from store_customer_orders
    where store_id::text = ${selectedStoreId}
      and order_source = 'store_pos'
      and created_at >= (date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')
      and created_at < ((date_trunc('day', now() at time zone 'Asia/Tokyo') + interval '1 day') at time zone 'Asia/Tokyo')
      and status <> 'cancelled'
  `;
  const summary = rows[0] as { orderCount: number; total: number } | undefined;
  const orderCount = Number(summary?.orderCount ?? 0);
  const total = Number(summary?.total ?? 0);
  return { orderCount, total, average: orderCount ? Math.round(total / orderCount) : 0 };
}

async function getTransactions(storeId: string) {
  return sql`
    select
      store_customer_orders.id::text,
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      store_customer_orders.payment_provider as "paymentMethod",
      store_customer_orders.amount,
      coalesce(store_customer_orders.customer_summary ->> 'cashierName', '') as "cashierName",
      coalesce((store_customer_orders.customer_summary ->> 'cashTenderedAmount')::int, null) as "cashTenderedAmount",
      coalesce((store_customer_orders.customer_summary ->> 'cashChangeAmount')::int, null) as "cashChangeAmount",
      to_char(store_customer_orders.created_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "createdLabel",
      to_char(store_customer_orders.created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime",
      store_customer_orders.created_at::text as "createdAt",
      coalesce(store_customer_orders.payment_refund_status, '') as "refundStatus",
      coalesce(store_customer_orders.payment_refunded_at::text, '') as "refundedAt",
      coalesce(pos_cash_sessions.status, '') as "cashSessionStatus"
    from store_customer_orders
    left join pos_cash_sessions on pos_cash_sessions.id = store_customer_orders.pos_cash_session_id
    where store_customer_orders.store_id::text = ${storeId}
      and store_customer_orders.order_source = 'store_pos'
      and store_customer_orders.created_at > now() - interval '7 days'
    order by store_customer_orders.created_at desc
    limit 200
  `;
}

async function getTransactionDetail(storeId: string, orderId: string) {
  const orderRows = await sql`
    select
      store_customer_orders.id::text,
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      store_customer_orders.payment_provider as "paymentMethod",
      store_customer_orders.amount,
      coalesce(store_customer_orders.customer_summary ->> 'orderType', '') as "orderType",
      coalesce(store_customer_orders.customer_summary ->> 'note', '') as note,
      coalesce(store_customer_orders.customer_summary ->> 'cashierName', '') as "cashierName",
      coalesce((store_customer_orders.customer_summary ->> 'cashTenderedAmount')::int, null) as "cashTenderedAmount",
      coalesce((store_customer_orders.customer_summary ->> 'cashChangeAmount')::int, null) as "cashChangeAmount",
      coalesce(store_customer_orders.customer_summary ->> 'refundReason', '') as "refundReason",
      to_char(store_customer_orders.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel",
      store_customer_orders.created_at::text as "createdAt",
      coalesce(store_customer_orders.cancelled_at::text, '') as "cancelledAt",
      coalesce(store_customer_orders.payment_refund_status, '') as "refundStatus",
      coalesce(store_customer_orders.payment_refunded_at::text, '') as "refundedAt",
      coalesce(pos_cash_sessions.status, '') as "cashSessionStatus"
    from store_customer_orders
    left join pos_cash_sessions on pos_cash_sessions.id = store_customer_orders.pos_cash_session_id
    where store_customer_orders.store_id::text = ${storeId}
      and store_customer_orders.id::text = ${orderId}
      and store_customer_orders.order_source = 'store_pos'
    limit 1
  `;
  const order = orderRows[0];
  if (!order) return null;

  const items = await sql`
    select
      id::text,
      item_name as name,
      coalesce(nullif(size_label, ''), size_key) as size,
      temperature,
      sweetness,
      ice,
      option_label as option,
      topping_labels as toppings,
      quantity,
      measured_quantity::float as "measuredQuantity",
      measured_unit as "measuredUnit",
      measured_unit_price::float as "measuredUnitPrice",
      amount
    from store_customer_order_items
    where order_id::text = ${orderId}
    order by sort_order, created_at
  `;
  return { ...order, items };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { selectedStoreId, forbidden } = await getSelectedStoreId(request, session);
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const orderId = normalizeText(params.get("orderId"));
  const [transactions, selectedTransaction] = await Promise.all([
    getTransactions(selectedStoreId),
    orderId ? getTransactionDetail(selectedStoreId, orderId) : Promise.resolve(null)
  ]);
  if (orderId && !selectedTransaction) return Response.json({ error: "会計が見つかりません。" }, { status: 404 });
  return Response.json({ transactions, selectedTransaction }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { storeId?: string; orderId?: string; reason?: string };
  const orderId = normalizeText(body.orderId);
  const reason = normalizeText(body.reason);
  if (!orderId) return Response.json({ error: "会計を選択してください。" }, { status: 400 });

  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, body.storeId);
  if (storeFilter === "__forbidden__" || !storeFilter) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const targetRows = await sql`
    select
      store_customer_orders.id::text,
      store_customer_orders.store_id::text as "storeId",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      coalesce(pos_cash_sessions.status, '') as "cashSessionStatus"
    from store_customer_orders
    left join pos_cash_sessions on pos_cash_sessions.id = store_customer_orders.pos_cash_session_id
    where store_customer_orders.id::text = ${orderId}
      and store_customer_orders.store_id::text = ${storeFilter}
      and store_customer_orders.order_source = 'store_pos'
    limit 1
  `;
  const target = targetRows[0] as { id: string; storeId: string; status: string; paymentStatus: string; cashSessionStatus: string } | undefined;
  if (!target) return Response.json({ error: "会計が見つかりません。" }, { status: 404 });
  if (target.status === "cancelled" || target.paymentStatus === "refunded") {
    return Response.json({ error: "この会計はすでに返金済みです。" }, { status: 400 });
  }
  if (target.cashSessionStatus !== "open") {
    return Response.json({ error: "締め済みのレジ会計は店舗 POS から返金できません。管理画面で修正してください。" }, { status: 400 });
  }

  const rows = await sql`
    update store_customer_orders
    set
      status = 'cancelled',
      payment_status = 'refunded',
      payment_refund_status = 'succeeded',
      payment_refunded_at = now(),
      cancelled_at = coalesce(cancelled_at, now()),
      customer_summary = customer_summary || ${JSON.stringify({
        refundReason: reason,
        refundedById: session.id,
        refundedByName: session.name
      })}::jsonb,
      updated_at = now()
    where id::text = ${orderId}
    returning id::text
  `;
  if (!rows[0]?.id) return Response.json({ error: "返金を保存できませんでした。" }, { status: 500 });

  await syncWebReservationToSalesOrder(orderId);
  await reverseLoyaltyForRefundedOrder(orderId);
  const [transactions, selectedTransaction, todaySummary] = await Promise.all([
    getTransactions(storeFilter),
    getTransactionDetail(storeFilter, orderId),
    getTodaySummary(storeFilter)
  ]);
  return Response.json({ ok: true, transactions, selectedTransaction, todaySummary });
}
