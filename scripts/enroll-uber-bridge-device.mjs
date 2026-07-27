import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

import { neon } from "@neondatabase/serverless";

import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

const storeId = String(process.argv[2] ?? "").trim();
const deviceName = String(process.argv[3] ?? "Uber Orders tablet").trim();
const tabletDeviceName = deviceName.replace(/\s+/g, "_");
if (!/^[0-9a-f-]{36}$/i.test(storeId)) {
  throw new Error("Usage: node scripts/enroll-uber-bridge-device.mjs <store-uuid> [device-name]");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

const token = `fr1_${randomBytes(32).toString("hex")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const sql = neon(process.env.DATABASE_URL);
await sql`
  update local_bridge_devices
  set is_enabled = false, updated_at = now()
  where store_id::text = ${storeId}
    and platform = 'uber_eats'
    and device_name = ${deviceName}
    and is_enabled = true
`;
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
  "start",
  "-n",
  "jp.foundr1.bridge/jp.foundr1.store.bridge.BridgeActivity"
], { stdio: "ignore" });
execFileSync("adb", [
  "shell",
  "am",
  "broadcast",
  "--include-stopped-packages",
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
  tabletDeviceName,
  "--es",
  "bridgeToken",
  token
], { stdio: "ignore" });

let preferencesXml = "";
for (let attempt = 0; attempt < 5; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  preferencesXml = execFileSync("adb", [
    "exec-out",
    "run-as",
    "jp.foundr1.bridge",
    "cat",
    "shared_prefs/foundr1_bridge.xml"
  ], { encoding: "utf8" });
  if (preferencesXml.includes(token)) break;
}
if (!preferencesXml.includes('name="token"') || !preferencesXml.includes(token)) {
  await sql`delete from local_bridge_devices where id::text = ${deviceId}`;
  throw new Error("Tablet provisioning did not persist the bridge token.");
}

console.log(JSON.stringify({ deviceId, storeId, deviceName, tabletProvisioned: true }));
