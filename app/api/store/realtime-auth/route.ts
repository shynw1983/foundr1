import { canAccessStore, requireOsSession } from "../../../../lib/api-auth";
import { getPusher } from "../../../../lib/order-realtime";
import { bridgeRealtimeChannel } from "../../../../lib/local-bridge-realtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const form = await request.formData();
  const socketId = String(form.get("socket_id") || "");
  const channelName = String(form.get("channel_name") || "");
  const notificationChannel = `private-os-notifications-${session.id}`;
  if (socketId && channelName === notificationChannel) {
    const pusher = getPusher();
    if (!pusher) return Response.json({ error: "Realtime unavailable" }, { status: 503 });
    return Response.json(pusher.authorizeChannel(socketId, channelName));
  }

  const bridgePrefix = "presence-store-bridge-";
  const bridgeStoreId = channelName.startsWith(bridgePrefix)
    ? channelName.slice(bridgePrefix.length)
    : "";
  if (socketId && bridgeStoreId && await canAccessStore(session, bridgeStoreId)) {
    const pusher = getPusher();
    if (!pusher) return Response.json({ error: "Realtime unavailable" }, { status: 503 });
    return Response.json(pusher.authorizeChannel(socketId, bridgeRealtimeChannel(bridgeStoreId), {
      user_id: `kitchen:${session.id}`,
      user_info: { role: "kitchen" }
    }));
  }

  const prefix = "private-store-orders-";
  const storeId = channelName.startsWith(prefix) ? channelName.slice(prefix.length) : "";
  if (!socketId || !storeId || !(await canAccessStore(session, storeId))) {
    return Response.json({ error: "Invalid realtime request" }, { status: 400 });
  }

  const pusher = getPusher();
  if (!pusher) return Response.json({ error: "Realtime unavailable" }, { status: 503 });

  return Response.json(pusher.authorizeChannel(socketId, channelName));
}
