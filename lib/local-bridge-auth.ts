import { createHash, timingSafeEqual } from "node:crypto";

import { sql } from "./db";

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function authorizeLocalBridge(request: Request, storeId: string, platform = "uber_eats") {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token && process.env.NODE_ENV !== "production") {
    return { authorized: true, deviceId: "", devicePlatform: platform };
  }
  if (token && storeId) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const rows = await sql`
      select id::text
      from local_bridge_devices
      where token_hash = ${tokenHash}
        and store_id::text = ${storeId}
        and platform = ${platform}
        and is_enabled = true
      limit 1
    `;
    if (rows[0]?.id) {
      return { authorized: true, deviceId: String(rows[0].id), devicePlatform: platform };
    }
  }
  const expectedToken = process.env.LOCAL_BRIDGE_TOKEN;
  if (expectedToken && token && secureEqual(token, expectedToken)) {
    return { authorized: true, deviceId: "", devicePlatform: "" };
  }
  return { authorized: false, deviceId: "", devicePlatform: "" };
}
