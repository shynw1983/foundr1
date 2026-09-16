import { requireOsSession } from "../../../../../lib/api-auth";
import { getOrderPushConfig, OrderPushTransportError, verifyOrderPushTransport } from "../../../../../lib/store-order-push-transport";

// Read-only deployment/support check for the same roles that configure notifications.
// FCM validates the connection without sending a notification or changing an order.
export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "owner" && session.role !== "manager") return Response.json({ error: "forbidden" }, { status: 403 });
  if (!getOrderPushConfig().fcm) return Response.json({ error: "FCM_NOT_CONFIGURED" }, { status: 503 });
  try {
    await verifyOrderPushTransport();
    return Response.json({ ok: true, validateOnly: true, enabled: getOrderPushConfig().enabled }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof OrderPushTransportError ? error.message : "FCM_VERIFICATION_FAILED" }, { status: 502 });
  }
}
