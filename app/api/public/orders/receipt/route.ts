import { sql } from "../../../../../lib/db";
import { recordOnlineReceiptDownload } from "../../../../../lib/receipt-data";
import { createReceiptPdf } from "../../../../../lib/receipt-pdf";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function formatDate(value: string | Date | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getReceiptStatus(input: {
  status: unknown;
  paymentStatus: unknown;
  paymentRefundStatus: unknown;
  paymentRefundedAt: unknown;
  cancelledAt: unknown;
  refundAmount: number;
  totalAmount: number;
}) {
  const status = clean(input.status);
  const paymentStatus = clean(input.paymentStatus);
  const paymentRefundStatus = clean(input.paymentRefundStatus);
  const refundedAt = formatDate(input.paymentRefundedAt as string | Date | null) || formatDate(input.cancelledAt as string | Date | null);
  if (paymentStatus === "refunded" || status === "cancelled") {
    return {
      statusLabel: "取消済み",
      statusDetail: "対象注文は取消・返金済みです。",
      refundAmount: input.refundAmount > 0 ? input.refundAmount : input.totalAmount,
      refundedAt
    };
  }
  if (paymentStatus === "partial_refunded" || paymentRefundStatus === "partial" || input.refundAmount > 0) {
    return {
      statusLabel: "一部返金済み",
      statusDetail: "対象注文には一部返金があります。",
      refundAmount: input.refundAmount,
      refundedAt
    };
  }
  return {
    statusLabel: "",
    statusDetail: "",
    refundAmount: 0,
    refundedAt: ""
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = clean(url.searchParams.get("orderId"));
  const pickupCode = clean(url.searchParams.get("pickupCode"));
  if (!orderId || !pickupCode) {
    return Response.json({ error: "orderId and pickupCode are required." }, { status: 400 });
  }

  const rows = await sql`
    select
      store_customer_orders.id::text as id,
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.status,
      store_customer_orders.payment_status as "paymentStatus",
      coalesce(store_customer_orders.payment_refund_status, '') as "paymentRefundStatus",
      store_customer_orders.payment_provider as "paymentProvider",
      store_customer_orders.pickup_date::text as "pickupDate",
      store_customer_orders.pickup_time as "pickupTime",
      store_customer_orders.amount,
      store_customer_orders.currency,
      store_customer_orders.drink,
      store_customer_orders.size,
      store_customer_orders.toppings,
      store_customer_orders.customer_summary as "customerSummary",
      store_customer_orders.paid_at as "paidAt",
      store_customer_orders.payment_refunded_at as "paymentRefundedAt",
      store_customer_orders.cancelled_at as "cancelledAt",
      store_customer_orders.created_at as "createdAt",
      coalesce(companies.legal_name, companies.name, stores.name, '') as "issuerName",
      coalesce(companies.invoice_registration_number, '') as "invoiceRegistrationNumber",
      coalesce(companies.receipt_purpose_text, 'テイクアウト飲食代') as "receiptPurposeText",
      coalesce(companies.receipt_tax_rate, 8)::float as "receiptTaxRate",
      coalesce(companies.address, '') as "issuerAddress",
      coalesce(companies.phone, '') as "issuerPhone"
    from store_customer_orders
    left join stores on stores.id = store_customer_orders.store_id
    left join companies on companies.id = stores.company_id
    where store_customer_orders.id::text = ${orderId}
      and store_customer_orders.pickup_code = ${pickupCode}
    limit 1
  `;
  const order = rows[0] as Record<string, unknown> | undefined;
  if (!order) return Response.json({ error: "Order not found." }, { status: 404 });
  if (!["paid", "refunded", "partial_refunded"].includes(clean(order.paymentStatus))) {
    return Response.json({ error: "Receipt is available after payment is completed." }, { status: 409 });
  }

  const totalAmount = Number(order.amount ?? 0);
  const refundRows = await sql`
    select coalesce(sum(refunded_amount), 0)::int as "refundAmount"
    from store_customer_order_items
    where order_id = ${orderId}
  `;
  const receiptStatus = getReceiptStatus({
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentRefundStatus: order.paymentRefundStatus,
    paymentRefundedAt: order.paymentRefundedAt,
    cancelledAt: order.cancelledAt,
    refundAmount: Number(refundRows[0]?.refundAmount ?? 0),
    totalAmount
  });
  const customerSummary = (order.customerSummary && typeof order.customerSummary === "object" ? order.customerSummary : {}) as Record<string, unknown>;
  const customer = (customerSummary.customer && typeof customerSummary.customer === "object" ? customerSummary.customer : {}) as Record<string, unknown>;
  const customerName = clean(customer.name) || clean(customerSummary.name) || "お客様";
  const itemSummary = [clean(order.drink), clean(order.size), clean(order.toppings)].filter(Boolean).join("\n");
  const issuedAt = formatDate(new Date());
  const downloadRecord = await recordOnlineReceiptDownload({ orderId, pickupCode });
  const pdf = createReceiptPdf({
    receiptNo: `${clean(order.pickupCode)}-${clean(order.id).slice(0, 8)}`,
    issuedAt,
    recipientName: customerName,
    amount: totalAmount,
    currency: clean(order.currency) || "JPY",
    pickupCode: clean(order.pickupCode),
    pickupDate: clean(order.pickupDate),
    pickupTime: clean(order.pickupTime),
    itemSummary,
    paymentProvider: clean(order.paymentProvider),
    paidAt: formatDate(order.paidAt as string | Date | null) || formatDate(order.createdAt as string | Date | null),
    issuerName: clean(order.issuerName),
    issuerAddress: clean(order.issuerAddress),
    issuerPhone: clean(order.issuerPhone),
    invoiceRegistrationNumber: clean(order.invoiceRegistrationNumber),
    purposeText: clean(order.receiptPurposeText) || "テイクアウト飲食代",
    taxRate: Number(order.receiptTaxRate ?? 8),
    downloadedAt: formatDate(downloadRecord?.downloadedAt ?? null),
    downloadCount: downloadRecord?.downloadCount ?? 0,
    ...receiptStatus
  });

  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${clean(order.pickupCode)}.pdf"`,
      "Cache-Control": "no-store"
    }
  });
}
