import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

import { neon } from "@neondatabase/serverless";

import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

const storeId = String(process.argv[2] ?? "").trim();
const deviceName = String(process.argv[3] ?? "Uber Orders tablet").trim();
if (!/^[0-9a-f-]{36}$/i.test(storeId)) {
  throw new Error("Usage: node scripts/enroll-uber-bridge-device.mjs <store-uuid> [device-name]");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`
  insert into local_bridge_devices (
    store_id,
    platform,
    device_name,
    token_hash
  )
  values (
    ${storeId},
    'uber_eats',
    ${deviceName},
    ${tokenHash}
  )
  returning id::text
`;
const deviceId = String(rows[0]?.id ?? "");
if (!deviceId) throw new Error("Bridge device enrollment failed.");

execFileSync("adb", [
  "shell",
  "am",
  "broadcast",
  "-n",
  "jp.foundr1.bridge/jp.foundr1.store.bridge.BridgeProvisioningReceiver",
  "-a",
  "jp.foundr1.bridge.PROVISION",
  "--es",
  "endpoint",
  "https://www.foundr1.jp/api/local-bridge/uber-eats/events",
  "--es",
  "storeId",
  storeId,
  "--es",
  "deviceName",
  deviceName,
  "--es",
  "token",
  token
], { stdio: "ignore" });

console.log(JSON.stringify({ deviceId, storeId, deviceName, tabletProvisioned: true }));
