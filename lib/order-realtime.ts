import Pusher from "pusher";
import { type CustomerOrderRow, toPublicCustomerOrder } from "./customer-orders";
import { getAppVersion, getShortAppVersion } from "./app-version";
import { appVersionChannel, appVersionEventName, isContentAppVersion, type AppVersionScope } from "./app-version-protocol";
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

export async function publishPublicMenuUpdatedEvent(storeId: string) {
  const pusher = getPusher();
  if (!pusher || !storeId) return;

  await pusher.trigger(`menu-${storeId}`, "menu.updated", {
    storeId,
    updatedAt: new Date().toISOString()
  });
  await recordExternalServiceUsage({
    serviceKey: "pusher",
    metricKey: "messages",
    quantity: 1,
    unit: "count",
    source: "public_menu_updated",
    metadata: { storeId }
  });
}

export async function publishStoreOperationalEvent(
  storeId: string,
  eventName: "store.seats.updated" | "procurement.updated" | "pos.reconciliation.updated"
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

export async function publishAppVersionUpdatedEvent(app: AppVersionScope, version = getAppVersion(app)) {
  const pusher = getPusher();
  if (!pusher || !isContentAppVersion(version)) return;

  await pusher.trigger(appVersionChannel(app), appVersionEventName, {
    app,
    version,
    shortVersion: getShortAppVersion(version),
    publishedAt: new Date().toISOString()
  });
  await recordExternalServiceUsage({
    serviceKey: "pusher",
    metricKey: "messages",
    quantity: 1,
    unit: "count",
    source: `${app}_version`,
    metadata: { app, version }
  });
}

export async function publishStoreVersionUpdatedEvent(version = getAppVersion("store")) {
  return publishAppVersionUpdatedEvent("store", version);
}
