import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { neon } from "@neondatabase/serverless";

import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

const storeId = String(process.argv[2] ?? "").trim();
const deviceName = String(process.argv[3] ?? "Kitchen MacBook Air").trim();
if (!/^[0-9a-f-]{36}$/i.test(storeId)) {
  throw new Error("Usage: node scripts/enroll-desktop-bridge-device.mjs <store-uuid> [device-name]");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

const token = `fr1_desktop_${randomBytes(32).toString("hex")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const sql = neon(process.env.DATABASE_URL);

await sql`
  update local_bridge_devices
  set is_enabled = false, updated_at = now()
  where store_id::text = ${storeId}
    and platform = 'desktop'
    and device_name = ${deviceName}
    and is_enabled = true
`;
const rows = await sql`
  insert into local_bridge_devices (
    store_id, platform, device_name, token_hash
  )
  values (
    ${storeId}, 'desktop', ${deviceName}, ${tokenHash}
  )
  returning id::text
`;

await sql`
  insert into store_sales_sources (
    store_id, source_platform, source_label, source_type,
    brand_name, is_enabled, sort_order, metadata, updated_at
  )
  values (
    ${storeId}, 'demae_can', '出前館', 'delivery',
    '', true, 600, ${JSON.stringify({ importSupported: true })}::jsonb, now()
  )
  on conflict (store_id, source_platform, source_label, brand_name)
  do update set
    is_enabled = true,
    metadata = excluded.metadata,
    updated_at = now()
`;

const bridgeRoot = path.resolve("desktop-bridge");
const configFilename = path.join(bridgeRoot, "config.local.json");
const exampleFilename = path.join(bridgeRoot, "config.example.json");
let config;
try {
  config = JSON.parse(await readFile(configFilename, "utf8"));
} catch {
  config = JSON.parse(await readFile(exampleFilename, "utf8"));
}
config.storeId = storeId;
config.bridgeToken = token;
config.deviceName = deviceName;
config.executionEnabled = false;
await writeFile(configFilename, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await chmod(configFilename, 0o600);

console.log(JSON.stringify({
  ok: true,
  deviceId: String(rows[0]?.id ?? ""),
  storeId,
  deviceName,
  configFilename,
  executionEnabled: false,
  demaeCanSourceEnabled: true
}, null, 2));
