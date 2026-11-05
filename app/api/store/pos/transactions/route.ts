import { getTodaySummary } from "../../../../../lib/pos-daily-summary-data";
import { cancelIneligiblePosPrintDocuments, guardPosPrintRefund } from '../../../../../lib/pos-print-document-ledger';
import { finishHandedOffPosOrder } from "../../../../../lib/pos-bowl-data";
import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { reconcilePosRefundLoyalty } from "../../../../../lib/loyalty";
import { recordPosRefund, posRefundPresentation } from "../../../../../lib/pos-refunds";
import { PosRefundError, type OptionSelection } from "../../../../../lib/pos-refund-policy";
import { ensureProductionTasksForOrder } from "../../../../../lib/order-production";
import { syncWebReservationToSalesOrder } from "../../../../../lib/sales-orders";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";
import { markInventoryOrderReady } from "../../../../../lib/inventory-order-usage";

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

async function getTransactions(storeId: string) {
  return sql`
    select
      store_customer_orders.id::text,
      store_customer_orders.pickup_code as "pickupCode",
      array(
        select items.pickup_code
        from store_customer_order_items items
        where items.order_id = store_customer_orders.id
          and nullif(btrim(items.pickup_code), '') is not null
        order by items.sort_order, items.created_at, items.id
      ) as "servingPickupCodes",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      store_customer_orders.payment_provider as "paymentMethod",
      store_customer_orders.amount,
      coalesce((store_customer_orders.customer_summary->'printDocuments'->>'version')::int,0) as "printDocumentVersion",
      store_customer_orders.customer_summary->'printDocuments' as "printDocuments",
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
      and store_customer_orders.order_source in ('store_pos', 'table_qr')
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
      coalesce((store_customer_orders.customer_summary->'printDocuments'->>'version')::int,0) as "printDocumentVersion",
      store_customer_orders.customer_summary->'printDocuments' as "printDocuments",
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
      and store_customer_orders.order_source in ('store_pos', 'table_qr')
    limit 1
  `;
  const order = orderRows[0];
  if (!order) return null;

  const items = await sql`
    select
      id::text,
      item_name as name,
      pickup_code as "pickupCode",
      (select handed_off_at::text from order_production_tasks where order_item_id=store_customer_order_items.id limit 1) as "handedOffAt",
      coalesce(nullif(size_label, ''), size_key) as size,
      temperature,
      sweetness,
      ice,
      option_label as option,
      topping_labels as toppings,
      quantity,
      measured_quantity::float as "measuredQuantity",
      weight_measurement as "weightMeasurement",
      measured_unit as "measuredUnit",
      measured_unit_price::float as "measuredUnitPrice",
      amount,
      coalesce(nullif(gross_amount, 0), amount)::int as "grossAmount",
      discount_amount::int as "discountAmount",
      coupon_discount_amount::int as "couponDiscountAmount",
      coalesce(nullif(paid_amount, 0), case when coupon_discount_amount > 0 then 0 else amount end)::int as "paidAmount",
      coalesce(coupon_id::text, '') as "couponId",
      coalesce(refund_status, '') as "refundStatus",
      refunded_quantity::int as "refundedQuantity",
      refunded_amount::int as "refundedAmount",
      coalesce(refund_reason, '') as "refundReason",
      coalesce(external_refund_confirmed_at::text, '') as "externalRefundConfirmedAt",
      coalesce(refunded_at::text, '') as "refundedAt"
    from store_customer_order_items
    where order_id::text = ${orderId}
    order by sort_order, created_at
  `;
  const refunds = await posRefundPresentation(orderId, Number(order.amount));
  return { ...order, items: items.map(item => ({ ...item, ...refunds.get(String(item.id)) })) };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { selectedStoreId, forbidden } = await getSelectedStoreId(request, session);
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  let orderId = normalizeText(params.get("orderId"));
  const clientOrderId = normalizeText(params.get("clientOrderId"));
  if (!orderId && clientOrderId) {
    const rows = await sql`select id::text from store_customer_orders where store_id::text=${selectedStoreId} and offline_client_order_id=${clientOrderId} limit 1`;
    orderId = String(rows[0]?.id || "");
    if (!orderId) return Response.json({ error: "会計の同期を確認できません。" }, { status: 404 });
  }
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
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "返品内容を確認してください。" }, { status: 400 });
  const orderId = normalizeText(body.orderId);
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, body.storeId);
  if (!access.canCancelOrders || storeFilter === "__forbidden__" || !storeFilter) return Response.json({ error: "返金する権限がありません。" }, { status: 403 });
  if (!orderId) return Response.json({ error: "会計を選択してください。" }, { status: 400 });
  const sourceIds = body.itemIds === undefined ? [] : body.itemIds;
  const options = body.optionSelections === undefined ? [] : body.optionSelections;
  if (!Array.isArray(sourceIds) || !Array.isArray(options) || sourceIds.length > 200 || options.length > 1000 ||
    sourceIds.some((id: unknown) => typeof id !== "string" || !id.trim()) ||
    options.some((o: OptionSelection) => !o || typeof o.itemId !== "string" || typeof o.key !== "string" || !/^\d+:\d+$/.test(o.key))) {
    return Response.json({ error: "返品内容を確認してください。" }, { status: 400 });
  }
  // Existing terminals may omit requestId for whole-item refunds. Option refunds require it.
  if (options.length && typeof body.requestId !== "string") return Response.json({ error: "返品リクエストを確認してください。" }, { status: 400 });
  try {
    const result = await recordPosRefund({ storeId: storeFilter, orderId, requestId: body.requestId,
      itemIds: [...sourceIds, ...(body.itemId ? [normalizeText(body.itemId)] : [])], options,
      reason: normalizeText(body.reason).slice(0, 500), externalRefundConfirmed: body.externalRefundConfirmed === true,
      actor: { id: session.id, name: session.name } });
    try {
      await ensureProductionTasksForOrder(orderId);
      await finishHandedOffPosOrder(orderId);
      await markInventoryOrderReady(orderId);
      await reconcilePosRefundLoyalty(orderId);
      await syncWebReservationToSalesOrder(orderId);
    } catch (error) {
      console.error("POS refund saved; reconciliation requires replay", { orderId, requestId: result.requestId, error });
      return Response.json({ error: "返金は記録済みです。同じ内容で再試行して連携を更新してください。", requestId: result.requestId, refundRecorded: true }, { status: 503 });
    }
    const [transactions, selectedTransaction, todaySummary] = await Promise.all([getTransactions(storeFilter), getTransactionDetail(storeFilter, orderId), getTodaySummary(storeFilter)]);
    return Response.json({ ok: true, ...result, transactions, selectedTransaction, todaySummary });
  } catch (error) {
    if (error instanceof PosRefundError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
