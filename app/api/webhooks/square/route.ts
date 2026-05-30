import { createHmac, timingSafeEqual } from "crypto";
import { findCustomerOrderBySquareOrderId, updateCustomerOrder } from "../../../../lib/customer-orders";

export const dynamic = "force-dynamic";

function verifySignature(rawBody: string, signature: string) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "";
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL || "";
  if (!key || !notificationUrl || !signature) return false;

  const expected = createHmac("sha256", key).update(`${notificationUrl}${rawBody}`).digest("base64");
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature") || "";
  if (!verifySignature(rawBody, signature)) {
    return Response.json({ error: "Invalid signature" }, { status: 403 });
  }

  const event = JSON.parse(rawBody) as Record<string, any>;
  if (!["payment.created", "payment.updated"].includes(String(event.type))) {
    return Response.json({ ok: true });
  }

  const payment = event.data?.object?.payment;
  const squareOrderId = payment?.order_id;
  if (!squareOrderId) return Response.json({ ok: true });

  const order = await findCustomerOrderBySquareOrderId(squareOrderId);
  if (!order) return Response.json({ ok: true });

  if (payment.status === "COMPLETED") {
    await updateCustomerOrder(order.id, {
      status: order.status === "pending_payment" ? "new" : order.status,
      paymentStatus: "paid",
      squarePaymentId: payment.id || "",
      squareReceiptUrl: payment.receipt_url || "",
      squarePaymentUpdatedAt: payment.updated_at || payment.created_at || new Date().toISOString(),
      paidAt: payment.updated_at || payment.created_at || new Date().toISOString()
    });
  } else if (["FAILED", "CANCELED"].includes(payment.status)) {
    await updateCustomerOrder(order.id, {
      status: "payment_failed",
      paymentStatus: String(payment.status).toLowerCase(),
      squarePaymentId: payment.id || "",
      squareReceiptUrl: payment.receipt_url || "",
      squarePaymentUpdatedAt: payment.updated_at || payment.created_at || new Date().toISOString()
    });
  }

  return Response.json({ ok: true });
}
