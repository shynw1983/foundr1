import { sql } from "../../../../../lib/db";

export const runtime = "nodejs";

function cleanText(value: unknown, maxLength = 4000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isAuthorized(request: Request) {
  const expectedToken = process.env.LOCAL_BRIDGE_TOKEN;
  if (!expectedToken) return true;
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token === expectedToken;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized bridge token." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const source = body as Record<string, unknown>;
  const kind = cleanText(source.kind, 80) || "unknown";
  const platform = cleanText(source.platform, 80) || "uber_eats";
  const packageName = cleanText(source.packageName, 160);
  const deviceName = cleanText(source.deviceName, 240);
  const storeId = cleanText(source.storeId, 80);
  const payload = source.payload && typeof source.payload === "object" ? source.payload : {};

  const rows = await sql`
    insert into local_bridge_events (
      platform,
      kind,
      package_name,
      device_name,
      store_external_id,
      payload
    )
    values (
      ${platform},
      ${kind},
      ${packageName},
      ${deviceName},
      ${storeId},
      ${JSON.stringify(payload)}::jsonb
    )
    returning id::text, created_at
  `;

  return Response.json({ ok: true, event: rows[0] });
}
