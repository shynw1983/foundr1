import { createHmac, timingSafeEqual } from "crypto";
import { findCustomerOrderByPaymentReference, updateCustomerOrder } from "./customer-orders";
import { publishCustomerOrderEvent } from "./order-realtime";
import type { StorePaymentAccount } from "./store-payment-accounts";

function clean(value = "") {
  return String(value).trim().replace(/^["']|["']$/g, "");
}

function verifySignature(rawBody: string, signature: string, secret: string) {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function getPaymentFromEvent(event: Record<string, any>) {
  return event.data?.object?.payment ?? event.data?.payment ?? event.data ?? {};
}

function getSessionId(payment: Record<string, any>) {
  if (typeof payment.session === "string") return payment.session;
  if (payment.session?.id) return String(payment.session.id);
  if (typeof payment.session_id === "string") return payment.session_id;
  return "";
}

function getRefundId(payment: Record<string, any>) {
  const refund = payment.refund ?? payment.refunds?.[0] ?? {};
  return String(payment.refund_id || refund.id || payment.latest_refund_id || "");
}

export async function handleKomojuWebhook(request: Request, account?: StorePaymentAccount | null) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-komoju-signature") || "";
  const webhookSecret = account?.webhookSecret || clean(process.env.KOMOJU_WEBHOOK_SECRET || process.env.KOMOJU_WEBHOOK_SECRET_TOKEN);
  if (!verifySignature(rawBody, signature, webhookSecret)) {
    return Response.json({ error: "Invalid signature" }, { status: 403 });
  }

  const event = JSON.parse(rawBody) as Record<string, any>;
  const eventType = String(request.headers.get("x-komoju-event") || event.type || "");
  if (eventType === "ping") return Response.json({ ok: true });

  const payment = getPaymentFromEvent(event);
  const metadata = payment.metadata ?? {};
  const sessionId = getSessionId(payment);
  const paymentId = String(payment.id || "");
  const orderId = String(metadata.orderId || metadata.order_id || "");
  const order = await findCustomerOrderByPaymentReference({
    provider: "komoju",
    sessionId,
    paymentId,
    orderId
  });
  if (!order) return Response.json({ ok: true });
  if (account?.storeId && order.storeId !== account.storeId) {
    return Response.json({ error: "Webhook store does not match order store." }, { status: 403 });
  }

  const paidAt = payment.captured_at || payment.authorized_at || payment.updated_at || payment.created_at || new Date().toISOString();
  const receiptUrl = String(payment.receipt_url || payment.url || "");
  if (["payment.captured", "payment.authorized"].includes(eventType) || ["captured", "authorized"].includes(String(payment.status))) {
    const updatedOrder = await updateCustomerOrder(order.id, {
      status: order.status === "pending_payment" ? "new" : order.status,
      paymentStatus: "paid",
      paymentProvider: "komoju",
      paymentAccountId: account?.id || order.paymentAccountId || undefined,
      paymentSessionId: sessionId,
      paymentId,
      paymentReceiptUrl: receiptUrl,
      paymentUpdatedAt: payment.updated_at || paidAt,
      paidAt
    });
    await publishCustomerOrderEvent("order.created", updatedOrder);
  } else if (eventType === "payment.refunded" || payment.status === "refunded") {
    const updatedOrder = await updateCustomerOrder(order.id, {
      status: "cancelled",
      paymentStatus: "refunded",
      paymentProvider: "komoju",
      paymentAccountId: account?.id || order.paymentAccountId || undefined,
      paymentSessionId: sessionId,
      paymentId,
      paymentReceiptUrl: receiptUrl,
      paymentRefundId: getRefundId(payment),
      paymentRefundStatus: "refunded",
      paymentRefundError: "",
      paymentRefundedAt: payment.refunded_at || payment.updated_at || new Date().toISOString(),
      paymentUpdatedAt: payment.updated_at || new Date().toISOString()
    });
    await publishCustomerOrderEvent("order.updated", updatedOrder);
  } else if (
    ["payment.failed", "payment.cancelled", "payment.expired"].includes(eventType) ||
    ["failed", "cancelled", "expired"].includes(String(payment.status))
  ) {
    const updatedOrder = await updateCustomerOrder(order.id, {
      status: eventType === "payment.cancelled" || payment.status === "cancelled" ? "cancelled" : "payment_failed",
      paymentStatus: payment.status === "cancelled" ? "canceled" : "failed",
      paymentProvider: "komoju",
      paymentAccountId: account?.id || order.paymentAccountId || undefined,
      paymentSessionId: sessionId,
      paymentId,
      paymentReceiptUrl: receiptUrl,
      paymentUpdatedAt: payment.updated_at || new Date().toISOString()
    });
    await publishCustomerOrderEvent("order.updated", updatedOrder);
  }

  return Response.json({ ok: true });
}
