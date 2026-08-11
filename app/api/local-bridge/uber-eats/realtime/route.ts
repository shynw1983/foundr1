import { createHash } from "node:crypto";

import { authorizeLocalBridge } from "../../../../../lib/local-bridge-auth";
import { bridgeRealtimeChannel } from "../../../../../lib/local-bridge-realtime";
import { getPusher } from "../../../../../lib/order-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function authorize(request: Request) {
  const url = new URL(request.url);
  const storeId = cleanText(url.searchParams.get("storeId"), 80);
  const deviceName = cleanText(url.searchParams.get("deviceName"), 160) || "Uber Bridge";
  let authorization = await authorizeLocalBridge(request, storeId);
  if (!authorization.authorized) {
    authorization = await authorizeLocalBridge(request, storeId, "rocket_now");
  }
  if (!authorization.authorized) {
    authorization = await authorizeLocalBridge(request, storeId, "demae_can");
  }
  return { storeId, deviceName, ...authorization };
}

export async function GET(request: Request) {
  const authorization = await authorize(request);
  if (!authorization.authorized || !authorization.storeId) {
    return Response.json({ error: "Unauthorized bridge token." }, { status: 401 });
  }
  if (!process.env.PUSHER_KEY || !process.env.PUSHER_CLUSTER) {
    return Response.json({ error: "Realtime unavailable." }, { status: 503 });
  }
  return Response.json({
    key: process.env.PUSHER_KEY,
    cluster: process.env.PUSHER_CLUSTER,
    channel: bridgeRealtimeChannel(authorization.storeId)
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const authorization = await authorize(request);
  if (!authorization.authorized || !authorization.storeId) {
    return Response.json({ error: "Unauthorized bridge token." }, { status: 401 });
  }
  const form = await request.formData();
  const socketId = cleanText(form.get("socket_id"), 120);
  const channelName = cleanText(form.get("channel_name"), 240);
  const expectedChannel = bridgeRealtimeChannel(authorization.storeId);
  if (!socketId || channelName !== expectedChannel) {
    return Response.json({ error: "Invalid realtime request." }, { status: 400 });
  }
  const pusher = getPusher();
  if (!pusher) return Response.json({ error: "Realtime unavailable." }, { status: 503 });
  const fallbackId = createHash("sha256")
    .update(`${authorization.storeId}:${authorization.deviceName}`)
    .digest("hex")
    .slice(0, 20);
  return Response.json(pusher.authorizeChannel(socketId, channelName, {
    user_id: `bridge:${authorization.deviceId || fallbackId}`,
    user_info: {
      role: "bridge",
      platform: "uber_eats",
      deviceName: authorization.deviceName
    }
  }));
}
