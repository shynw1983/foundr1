import { sql } from "../../../../../lib/db";
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
      store_customer_orders.payment_status as "paymentStatus",
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
      store_customer_orders.created_at as "createdAt",
      coalesce(companies.legal_name, companies.name, stores.name, '') as "issuerName",
      coalesce(companies.invoice_registration_number, '') as "invoiceRegistrationNumber",
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
  if (order.paymentStatus !== "paid") {
    return Response.json({ error: "Receipt is available after payment is completed." }, { status: 409 });
  }

  const customerSummary = (order.customerSummary && typeof order.customerSummary === "object" ? order.customerSummary : {}) as Record<string, unknown>;
  const customer = (customerSummary.customer && typeof customerSummary.customer === "object" ? customerSummary.customer : {}) as Record<string, unknown>;
  const customerName = clean(customer.name) || clean(customerSummary.name) || "お客様";
  const itemSummary = [clean(order.drink), clean(order.size), clean(order.toppings)].filter(Boolean).join("\n");
  const issuedAt = formatDate(new Date());
  const pdf = createReceiptPdf({
    receiptNo: `${clean(order.pickupCode)}-${clean(order.id).slice(0, 8)}`,
    issuedAt,
    recipientName: customerName,
    amount: Number(order.amount ?? 0),
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
    invoiceRegistrationNumber: clean(order.invoiceRegistrationNumber)
  });

  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${clean(order.pickupCode)}.pdf"`,
      "Cache-Control": "no-store"
    }
  });
}
