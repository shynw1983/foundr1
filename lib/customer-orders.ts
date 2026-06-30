import { sql } from "./db";
import { awardLoyaltyForPaidOrder, redeemPendingCouponForPaidOrder, reverseLoyaltyForRefundedOrder } from "./loyalty";
import { ensureProductionTasksForOrder } from "./order-production";
import { syncWebReservationToSalesOrder } from "./sales-orders";
import { getActiveStorePaymentAccount, getStorePaymentAccountById } from "./store-payment-accounts";

export type CustomerOrderRow = {
  id: string;
  brandId: string;
  storeId: string;
  storeName: string;
  orderSource: string;
  pickupCode: string;
  status: string;
  paymentStatus: string;
  paymentProvider: string;
  paymentAccountId: string;
  paymentSessionId: string;
  paymentId: string;
  paymentReceiptUrl: string;
  paymentRefundId: string;
  paymentRefundStatus: string;
  paymentRefundError: string;
  paymentRefundedAt: string;
  squareOrderId: string;
  squarePaymentId: string;
  squareReceiptUrl: string;
  pickupDate: string;
  pickupTime: string;
  amount: number;
  currency: string;
  drink: string;
  size: string;
  temperature: string;
  sweetness: string;
  ice: string;
  option: string;
  toppings: string;
  customerName: string;
  customerPhone: string;
  customerNote: string;
  storeTableLabel?: string;
  tableSessionKey?: string;
  checkoutStatus?: string;
  checkoutRequestType?: string;
  checkoutRequestedAt?: string;
  checkoutHandledAt?: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string;
  preparingAt: string;
  readyAt: string;
  completedAt: string;
  cancelledAt: string;
  memberId: string;
};

export type CustomerOrderItemInput = {
  menuCatalogItemId: string;
  itemName: string;
  sizeKey: string;
  sizeLabel: string;
  temperature: string;
  sweetness: string;
  ice: string;
  optionKey: string;
  optionLabel: string;
  toppingKeys: string[];
  toppingLabels: string[];
  amount: number;
};

export function createPickupCode(prefix = "M") {
  return `${prefix}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

function getPickupDateTime(order: Pick<CustomerOrderRow, "pickupDate" | "pickupTime">) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order.pickupDate) || !/^\d{2}:\d{2}$/.test(order.pickupTime)) return null;
  const date = new Date(`${order.pickupDate}T${order.pickupTime}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getCustomerOrderCancelInfo(order: CustomerOrderRow, now = new Date()) {
  const pickupAt = getPickupDateTime(order);
  const cancelDeadline = pickupAt ? new Date(pickupAt.getTime() - 30 * 60 * 1000) : null;
  const canCancel = order.orderSource === "maamaa_web" &&
    ["pending_payment", "new"].includes(order.status) &&
    !order.preparingAt &&
    !order.readyAt &&
    !order.completedAt &&
    !order.cancelledAt &&
    Boolean(cancelDeadline && now < cancelDeadline);

  return {
    canCancel,
    cancelDeadline: cancelDeadline ? cancelDeadline.toISOString() : "",
    cancelWindowMinutes: 30
  };
}

function pickupCodeCandidates(pickupCode: string) {
  const code = String(pickupCode ?? "").trim();
  if (!code) return [];
  const candidates = new Set([code]);
  const withoutKnownPrefix = code.replace(/^[A-Z]-/i, "");
  if (withoutKnownPrefix) {
    candidates.add(withoutKnownPrefix);
    candidates.add(`N-${withoutKnownPrefix}`);
    candidates.add(`M-${withoutKnownPrefix}`);
  }
  return Array.from(candidates);
}

function withPublicBaseUrl(path: string, baseUrl = "") {
  const cleanBase = String(baseUrl || "").replace(/\/$/, "");
  return cleanBase ? `${cleanBase}${path}` : path;
}

export function toPublicCustomerOrder(order: CustomerOrderRow, baseUrl = "") {
  const cancelInfo = getCustomerOrderCancelInfo(order);
  const receiptParams = new URLSearchParams({
    orderId: order.id,
    pickupCode: order.pickupCode
  }).toString();
  const canShowReceipt = ["paid", "refunded", "partial_refunded"].includes(order.paymentStatus);
  const receiptPreviewPath = `/public/orders/receipt/preview?${receiptParams}`;
  const receiptPdfPath = `/api/public/orders/receipt?${receiptParams}`;
  return {
    orderId: order.id,
    pickupCode: order.pickupCode,
    storeId: order.storeId,
    storeName: order.storeName,
    status: order.status,
    paymentStatus: order.paymentStatus,
    refundStatus: order.paymentRefundStatus,
    refundError: order.paymentRefundError,
    refundedAt: order.paymentRefundedAt,
    squareReceiptUrl: order.squareReceiptUrl,
    receiptPreviewUrl: canShowReceipt ? withPublicBaseUrl(receiptPreviewPath, baseUrl) : "",
    receiptPdfUrl: canShowReceipt ? withPublicBaseUrl(receiptPdfPath, baseUrl) : "",
    drink: order.drink,
    size: order.size,
    temperature: order.temperature,
    sweetness: order.sweetness,
    ice: order.ice,
    option: order.option,
    toppings: order.toppings,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerNote: order.customerNote,
    amount: order.amount,
    pickupDate: order.pickupDate,
    pickupTime: order.pickupTime,
    canCancel: cancelInfo.canCancel,
    cancelDeadline: cancelInfo.cancelDeadline,
    cancelWindowMinutes: cancelInfo.cancelWindowMinutes
  };
}

export async function createCustomerOrder(input: {
  brandId: string;
  storeId: string;
  orderSource?: string;
  paymentProvider?: string;
  paymentAccountId?: string;
  memberId?: string;
  pickupCode: string;
  pickupDate: string;
  pickupTime: string;
  amount: number;
  currency?: string;
  customerSummary: Record<string, unknown>;
  drink: string;
  size: string;
  temperature: string;
  sweetness: string;
  ice: string;
  option: string;
  toppings: string;
  items: CustomerOrderItemInput[];
}) {
  const rows = await sql`
    insert into store_customer_orders (
      brand_id,
      store_id,
      order_source,
      payment_provider,
      payment_account_id,
      member_id,
      pickup_code,
      pickup_date,
      pickup_time,
      amount,
      currency,
      customer_summary,
      drink,
      size,
      temperature,
      sweetness,
      ice,
      option_text,
      toppings
    )
    values (
      ${input.brandId},
      ${input.storeId},
      ${input.orderSource ?? "nanacha_web"},
      ${input.paymentProvider ?? "square"},
      ${input.paymentAccountId || null},
      ${input.memberId || null},
      ${input.pickupCode},
      ${input.pickupDate},
      ${input.pickupTime},
      ${input.amount},
      ${input.currency ?? "JPY"},
      ${JSON.stringify(input.customerSummary)},
      ${input.drink},
      ${input.size},
      ${input.temperature},
      ${input.sweetness},
      ${input.ice},
      ${input.option},
      ${input.toppings}
    )
    returning id::text
  `;
  const orderId = rows[0]?.id as string;

  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    await sql`
      insert into store_customer_order_items (
        order_id,
        menu_catalog_item_id,
        item_name,
        size_key,
        size_label,
        temperature,
        sweetness,
        ice,
        option_key,
        option_label,
        topping_keys,
        topping_labels,
        amount,
        sort_order
      )
      values (
        ${orderId},
        ${item.menuCatalogItemId},
        ${item.itemName},
        ${item.sizeKey},
        ${item.sizeLabel},
        ${item.temperature},
        ${item.sweetness},
        ${item.ice},
        ${item.optionKey},
        ${item.optionLabel},
        ${item.toppingKeys},
        ${item.toppingLabels},
        ${item.amount},
        ${index}
      )
    `;
  }

  await syncWebReservationToSalesOrder(orderId);
  return findCustomerOrderById(orderId);
}

export async function updateCustomerOrder(orderId: string, patch: Partial<{
  status: string;
  paymentStatus: string;
  paymentProvider: string;
  paymentAccountId: string;
  paymentSessionId: string;
  paymentId: string;
  paymentReceiptUrl: string;
  paymentRefundId: string;
  paymentRefundStatus: string;
  paymentRefundError: string;
  paymentRefundedAt: string;
  paymentUpdatedAt: string;
  squareOrderId: string;
  squarePaymentId: string;
  squareReceiptUrl: string;
  squarePaymentUpdatedAt: string;
  paidAt: string;
}>) {
  const rows = await sql`
    update store_customer_orders
    set
      status = coalesce(${patch.status ?? null}, status),
      payment_status = coalesce(${patch.paymentStatus ?? null}, payment_status),
      payment_provider = coalesce(${patch.paymentProvider ?? null}, payment_provider),
      payment_account_id = coalesce(nullif(${patch.paymentAccountId ?? null}, '')::uuid, payment_account_id),
      payment_session_id = coalesce(${patch.paymentSessionId ?? null}, payment_session_id),
      payment_id = coalesce(${patch.paymentId ?? null}, payment_id),
      payment_receipt_url = coalesce(${patch.paymentReceiptUrl ?? null}, payment_receipt_url),
      payment_updated_at = coalesce(${patch.paymentUpdatedAt ?? null}::timestamptz, payment_updated_at),
      payment_refund_id = coalesce(${patch.paymentRefundId ?? null}, payment_refund_id),
      payment_refund_status = coalesce(${patch.paymentRefundStatus ?? null}, payment_refund_status),
      payment_refund_error = coalesce(${patch.paymentRefundError ?? null}, payment_refund_error),
      payment_refunded_at = coalesce(${patch.paymentRefundedAt ?? null}::timestamptz, payment_refunded_at),
      square_order_id = coalesce(${patch.squareOrderId ?? null}, square_order_id),
      square_payment_id = coalesce(${patch.squarePaymentId ?? null}, square_payment_id),
      square_receipt_url = coalesce(${patch.squareReceiptUrl ?? null}, square_receipt_url),
      square_payment_updated_at = coalesce(${patch.squarePaymentUpdatedAt ?? null}::timestamptz, square_payment_updated_at),
      paid_at = coalesce(${patch.paidAt ?? null}::timestamptz, paid_at),
      cancelled_at = case when ${patch.status ?? null} = 'cancelled' and cancelled_at is null then now() else cancelled_at end,
      updated_at = now()
    where id = ${orderId}
    returning id::text
  `;
  if (rows[0]?.id) {
    if (patch.paymentStatus === "paid" || patch.status === "new") {
      await redeemPendingCouponForPaidOrder(rows[0].id as string);
      await ensureProductionTasksForOrder(rows[0].id as string);
      await awardLoyaltyForPaidOrder(rows[0].id as string);
    }
    if (patch.paymentStatus === "refunded" || patch.status === "cancelled") {
      await reverseLoyaltyForRefundedOrder(rows[0].id as string);
    }
    await syncWebReservationToSalesOrder(rows[0].id as string);
  }
  return rows[0]?.id ? findCustomerOrderById(rows[0].id as string) : null;
}

export async function findCustomerOrderById(orderId: string) {
  const rows = await sql`
    select
      store_customer_orders.id::text,
      coalesce(store_customer_orders.brand_id::text, '') as "brandId",
      coalesce(store_customer_orders.store_id::text, '') as "storeId",
      coalesce(stores.name, '') as "storeName",
      store_customer_orders.order_source as "orderSource",
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      store_customer_orders.payment_provider as "paymentProvider",
      coalesce(store_customer_orders.payment_account_id::text, '') as "paymentAccountId",
      coalesce(store_customer_orders.payment_session_id, '') as "paymentSessionId",
      coalesce(store_customer_orders.payment_id, '') as "paymentId",
      coalesce(store_customer_orders.payment_receipt_url, store_customer_orders.square_receipt_url, '') as "paymentReceiptUrl",
      coalesce(store_customer_orders.payment_refund_id, '') as "paymentRefundId",
      coalesce(store_customer_orders.payment_refund_status, '') as "paymentRefundStatus",
      coalesce(store_customer_orders.payment_refund_error, '') as "paymentRefundError",
      coalesce(store_customer_orders.payment_refunded_at::text, '') as "paymentRefundedAt",
      coalesce(store_customer_orders.member_id::text, '') as "memberId",
      coalesce(store_customer_orders.square_order_id, '') as "squareOrderId",
      coalesce(store_customer_orders.square_payment_id, '') as "squarePaymentId",
      coalesce(store_customer_orders.square_receipt_url, '') as "squareReceiptUrl",
      store_customer_orders.pickup_date::text as "pickupDate",
      store_customer_orders.pickup_time as "pickupTime",
      store_customer_orders.amount,
      store_customer_orders.currency,
      store_customer_orders.drink,
      store_customer_orders.size,
      store_customer_orders.temperature,
      store_customer_orders.sweetness,
      store_customer_orders.ice,
      store_customer_orders.option_text as "option",
      store_customer_orders.toppings,
      coalesce(
        store_customer_orders.customer_summary #>> '{customer,name}',
        store_customer_orders.customer_summary ->> 'name',
        ''
      ) as "customerName",
      coalesce(
        store_customer_orders.customer_summary #>> '{customer,phone}',
        store_customer_orders.customer_summary ->> 'phone',
        ''
      ) as "customerPhone",
      coalesce(
        store_customer_orders.customer_summary #>> '{customer,note}',
        store_customer_orders.customer_summary ->> 'note',
        ''
      ) as "customerNote",
      coalesce(nullif(store_tables.display_name, ''), store_tables.label, '') as "storeTableLabel",
      coalesce(store_customer_orders.customer_summary ->> 'tableSessionKey', store_customer_orders.table_session_key, '') as "tableSessionKey",
      coalesce(store_customer_orders.customer_summary ->> 'checkoutStatus', '') as "checkoutStatus",
      coalesce(store_customer_orders.customer_summary ->> 'checkoutRequestType', '') as "checkoutRequestType",
      coalesce(store_customer_orders.customer_summary ->> 'checkoutRequestedAt', '') as "checkoutRequestedAt",
      coalesce(store_customer_orders.customer_summary ->> 'checkoutHandledAt', '') as "checkoutHandledAt",
      store_customer_orders.created_at as "createdAt",
      store_customer_orders.updated_at as "updatedAt",
      coalesce(store_customer_orders.paid_at::text, '') as "paidAt",
      coalesce(store_customer_orders.preparing_at::text, '') as "preparingAt",
      coalesce(store_customer_orders.ready_at::text, '') as "readyAt",
      coalesce(store_customer_orders.completed_at::text, '') as "completedAt",
      coalesce(store_customer_orders.cancelled_at::text, '') as "cancelledAt"
    from store_customer_orders
    left join stores on stores.id = store_customer_orders.store_id
    left join store_tables on store_tables.id = store_customer_orders.store_table_id
    where store_customer_orders.id = ${orderId}
    limit 1
  `;
  return (rows[0] as CustomerOrderRow | undefined) ?? null;
}

export async function findCustomerOrderBySquareOrderId(squareOrderId: string) {
  const rows = await sql`
    select id::text
    from store_customer_orders
    where square_order_id = ${squareOrderId}
      or (payment_provider = 'square' and payment_session_id = ${squareOrderId})
    limit 1
  `;
  return rows[0]?.id ? findCustomerOrderById(rows[0].id as string) : null;
}

function komojuAuthHeader(secretKey: string) {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

function refundErrorMessage(status: number, body: unknown) {
  const details = body && typeof body === "object" ? body as Record<string, any> : {};
  const message = String(details.error || details.message || details.error_message || "").trim();
  if (message) return message;
  if (status === 422) return "KOMOJU says this payment is not refundable.";
  if (status === 404) return "KOMOJU payment was not found.";
  if (status === 403) return "KOMOJU refund authorization failed.";
  return "KOMOJU refund failed.";
}

async function getRefundPaymentAccount(order: CustomerOrderRow) {
  const account = await getStorePaymentAccountById(order.paymentAccountId);
  if (account?.secretKey) return account;
  return getActiveStorePaymentAccount({
    storeId: order.storeId,
    provider: "komoju",
    allowFallback: true
  });
}

async function refundKomojuPayment(order: CustomerOrderRow) {
  if (order.paymentProvider !== "komoju") {
    return { ok: false, error: "This payment provider does not support automatic refund here.", refundId: "" };
  }
  if (!order.paymentId) {
    return { ok: false, error: "Payment ID is missing, so the refund cannot be processed automatically.", refundId: "" };
  }

  const account = await getRefundPaymentAccount(order);
  if (!account?.secretKey) {
    return { ok: false, error: "KOMOJU refund secret is not configured.", refundId: "" };
  }

  const response = await fetch(`https://komoju.com/api/v1/payments/${encodeURIComponent(order.paymentId)}/refund`, {
    method: "POST",
    headers: {
      Authorization: komojuAuthHeader(account.secretKey),
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      description: `Customer cancellation ${order.pickupCode}`
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: refundErrorMessage(response.status, body), refundId: "" };
  }

  const refundId = String((body as Record<string, any>).id || (body as Record<string, any>).refund?.id || "");
  return { ok: true, error: "", refundId };
}

export async function cancelPublicMaamaaCustomerOrder(input: { orderId?: string | null; pickupCode?: string | null; pickupDate?: string | null }) {
  const order = await findPublicCustomerOrder(input);
  if (!order) return { order: null, error: "Not found", status: 404 };
  if (order.orderSource !== "maamaa_web") {
    return { order, error: "This order cannot be cancelled from this page.", status: 403 };
  }
  if (!getCustomerOrderCancelInfo(order).canCancel) {
    return { order, error: "Orders can be cancelled until 30 minutes before pickup.", status: 409 };
  }

  const lockRows = await sql`
    update store_customer_orders
    set
      status = 'refund_pending',
      payment_refund_status = case when payment_status = 'paid' then 'pending' else payment_refund_status end,
      payment_refund_error = '',
      updated_at = now()
    where id = ${order.id}
      and order_source = 'maamaa_web'
      and status in ('pending_payment', 'new')
      and preparing_at is null
      and ready_at is null
      and completed_at is null
      and cancelled_at is null
      and ((pickup_date::text || ' ' || pickup_time)::timestamp at time zone 'Asia/Tokyo') > now() + interval '30 minutes'
    returning id::text, payment_status as "paymentStatus"
  `;
  if (!lockRows[0]?.id) {
    const latestOrder = await findCustomerOrderById(order.id);
    return { order: latestOrder ?? order, error: "Orders can be cancelled until 30 minutes before pickup.", status: 409 };
  }

  if (order.paymentStatus === "paid") {
    const refund = await refundKomojuPayment(order);
    if (!refund.ok) {
      await sql`
        update store_customer_orders
        set
          status = ${order.status},
          payment_refund_status = 'failed',
          payment_refund_error = ${refund.error},
          updated_at = now()
        where id = ${order.id}
      `;
      await syncWebReservationToSalesOrder(order.id);
      return { order: await findCustomerOrderById(order.id), error: refund.error, status: 502 };
    }

    await sql`
      update store_customer_orders
      set
        status = 'cancelled',
        payment_status = 'refunded',
        payment_refund_id = ${refund.refundId},
        payment_refund_status = 'refunded',
        payment_refund_error = '',
        payment_refunded_at = now(),
        payment_updated_at = now(),
        cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now()
      where id = ${order.id}
    `;
    await reverseLoyaltyForRefundedOrder(order.id);
  } else {
    await sql`
      update store_customer_orders
      set
        status = 'cancelled',
        payment_refund_status = '',
        payment_refund_error = '',
        cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now()
      where id = ${order.id}
    `;
    await reverseLoyaltyForRefundedOrder(order.id);
  }

  await syncWebReservationToSalesOrder(order.id);
  return { order: await findCustomerOrderById(order.id), error: "", status: 200 };
}

export async function findCustomerOrderByPaymentReference(input: {
  provider: string;
  sessionId?: string | null;
  paymentId?: string | null;
  orderId?: string | null;
}) {
  const provider = String(input.provider ?? "").trim();
  const sessionId = String(input.sessionId ?? "").trim();
  const paymentId = String(input.paymentId ?? "").trim();
  const orderId = String(input.orderId ?? "").trim();
  if (!provider || (!sessionId && !paymentId && !orderId)) return null;

  const rows = await sql`
    select id::text
    from store_customer_orders
    where payment_provider = ${provider}
      and (
        (${sessionId} <> '' and payment_session_id = ${sessionId})
        or (${paymentId} <> '' and payment_id = ${paymentId})
        or (${orderId} <> '' and id::text = ${orderId})
      )
    order by updated_at desc
    limit 1
  `;
  return rows[0]?.id ? findCustomerOrderById(rows[0].id as string) : null;
}

export async function findPublicCustomerOrder(input: { orderId?: string | null; pickupCode?: string | null; pickupDate?: string | null }) {
  const orderId = String(input.orderId ?? "").trim();
  const pickupCode = String(input.pickupCode ?? "").trim();
  const pickupDate = String(input.pickupDate ?? "").trim();
  if (orderId) return findCustomerOrderById(orderId);
  if (!pickupCode) return null;
  const candidates = pickupCodeCandidates(pickupCode);

  const rows = pickupDate
    ? await sql`
        select id::text
        from store_customer_orders
        where pickup_code = any(${candidates})
          and pickup_date = ${pickupDate}
        order by created_at desc
        limit 1
      `
    : await sql`
        select id::text
        from store_customer_orders
        where pickup_code = any(${candidates})
        order by created_at desc
        limit 1
      `;

  return rows[0]?.id ? findCustomerOrderById(rows[0].id as string) : null;
}
