import { sql } from "../../../../../lib/db";
import { authorizeLocalBridge } from "../../../../../lib/local-bridge-auth";
import { publishBridgeStatus } from "../../../../../lib/local-bridge-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const source = body as Record<string, unknown>;
  const storeId = cleanText(source.storeId, 80);
  const authorization = await authorizeLocalBridge(request, storeId);
  if (!authorization.authorized || !storeId) {
    return Response.json({ error: "Unauthorized bridge token." }, { status: 401 });
  }
  const status = {
    level: ["healthy", "attention", "error"].includes(cleanText(source.level, 20))
      ? cleanText(source.level, 20)
      : "attention",
    problem: cleanText(source.problem, 500),
    pendingCount: Math.max(0, Math.min(10000, Number(source.pendingCount ?? 0) || 0)),
    lastOrderCode: cleanText(source.lastOrderCode, 40),
    lastOrderAt: cleanText(source.lastOrderAt, 80),
    versionName: cleanText(source.versionName, 40),
    platformMode: ["uber_eats", "rocket_now", "dual"].includes(cleanText(source.platformMode, 20))
      ? cleanText(source.platformMode, 20)
      : "dual",
    primaryPlatform: cleanText(source.primaryPlatform, 20) === "rocket_now"
      ? "rocket_now"
      : "uber_eats",
    realtimeConnected: source.realtimeConnected === true,
    accessibilityConnected: source.accessibilityConnected === true,
    notificationConnected: source.notificationConnected === true
  };
  if (authorization.deviceId) {
    await sql`
      update local_bridge_devices
      set
        health_status = ${JSON.stringify(status)}::jsonb,
        last_seen_at = now(),
        last_status_at = now(),
        updated_at = now()
      where id::text = ${authorization.deviceId}
    `;
  }
  if (source.changed === true) {
    await publishBridgeStatus(storeId, status).catch(() => undefined);
  }
  return Response.json({ ok: true, status });
}
