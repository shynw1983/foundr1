import Pusher from "pusher";
import { type CustomerOrderRow, toPublicCustomerOrder } from "./customer-orders";
import { getAppVersion, getShortAppVersion } from "./app-version";
import { recordExternalServiceUsage } from "./external-service-usage";

let pusherClient: Pusher | null = null;

export function getPusher() {
  if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET || !process.env.PUSHER_CLUSTER) {
    return null;
  }

  if (!pusherClient) {
    pusherClient = new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER,
      useTLS: true
    });
  }

  return pusherClient;
}

export async function publishCustomerOrderEvent(eventName: "order.created" | "order.updated", order: CustomerOrderRow | null) {
  const pusher = getPusher();
  if (!pusher || !order?.storeId) return;

  await Promise.all([
    pusher.trigger(`private-store-orders-${order.storeId}`, eventName, { order }),
    pusher.trigger(`order-${order.id}`, eventName, { order: toPublicCustomerOrder(order) })
  ]);
  await recordExternalServiceUsage({
    serviceKey: "pusher",
    metricKey: "messages",
    quantity: 2,
    unit: "count",
    source: "customer_order_event",
    metadata: { eventName, storeId: order.storeId, orderId: order.id }
  });
}

export async function publishPosCustomerDisplayEvent(storeId: string, state: Record<string, unknown>) {
  const pusher = getPusher();
  if (!pusher || !storeId) return;

  await pusher.trigger(`private-store-orders-${storeId}`, "pos.customer-display.updated", {
    storeId,
    state
  });
  await recordExternalServiceUsage({
    serviceKey: "pusher",
    metricKey: "messages",
    quantity: 1,
    unit: "count",
    source: "pos_customer_display",
    metadata: { storeId }
  });
}

export async function publishStoreOperationalEvent(
  storeId: string,
  eventName: "store.seats.updated" | "procurement.updated"
) {
  const pusher = getPusher();
  if (!pusher || !storeId) return;

  await pusher.trigger(`private-store-orders-${storeId}`, eventName, { storeId });
  await recordExternalServiceUsage({
    serviceKey: "pusher",
    metricKey: "messages",
    quantity: 1,
    unit: "count",
    source: "store_operational_event",
    metadata: { storeId, eventName }
  });
}

export async function publishStoreVersionUpdatedEvent(version = getAppVersion()) {
  const pusher = getPusher();
  if (!pusher || !version || version === "local") return;

  await pusher.trigger("store-version", "store.version.updated", {
    version,
    shortVersion: getShortAppVersion(version),
    publishedAt: new Date().toISOString()
  });
  await recordExternalServiceUsage({
    serviceKey: "pusher",
    metricKey: "messages",
    quantity: 1,
    unit: "count",
    source: "store_version",
    metadata: { version }
  });
}
