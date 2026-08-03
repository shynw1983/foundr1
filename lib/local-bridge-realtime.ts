import { getPusher } from "./order-realtime";
import { recordExternalServiceUsage } from "./external-service-usage";

export function bridgeRealtimeChannel(storeId: string) {
  return `presence-store-bridge-${storeId}`;
}

async function publishBridgeEvent(
  storeId: string,
  eventName: "bridge.command.available" | "bridge.command.updated" | "bridge.status.updated",
  payload: Record<string, unknown>
) {
  const pusher = getPusher();
  if (!pusher || !storeId) return;
  await pusher.trigger(bridgeRealtimeChannel(storeId), eventName, payload);
  await recordExternalServiceUsage({
    serviceKey: "pusher",
    metricKey: "messages",
    quantity: 1,
    unit: "count",
    source: "local_bridge_realtime",
    metadata: { storeId, eventName }
  });
}

export async function publishBridgeCommandAvailable(storeId: string) {
  await publishBridgeEvent(storeId, "bridge.command.available", { storeId });
}

export async function publishBridgeCommandUpdated(
  storeId: string,
  command: Record<string, unknown>
) {
  await publishBridgeEvent(storeId, "bridge.command.updated", { storeId, command });
}

export async function publishBridgeStatus(
  storeId: string,
  status: Record<string, unknown>
) {
  await publishBridgeEvent(storeId, "bridge.status.updated", { storeId, status });
}
