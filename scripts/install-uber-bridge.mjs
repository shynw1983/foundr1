import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const component = "jp.foundr1.bridge/jp.foundr1.store.bridge.UberAccessibilityService";
const defaultApk = resolve(
  "Foundr1Android/app/build/outputs/apk/bridge/debug/app-bridge-debug.apk"
);
const apkPath = resolve(process.argv[2] || defaultApk);
const requestedDevice = String(process.argv[3] || "").trim();

if (!existsSync(apkPath)) {
  throw new Error(`Bridge APK not found: ${apkPath}`);
}

const devices = execFileSync("adb", ["devices"], { encoding: "utf8" })
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter((parts) => parts[0] && parts[1] === "device")
  .map((parts) => parts[0]);
const deviceId = requestedDevice || (devices.length === 1 ? devices[0] : "");
if (!deviceId) {
  throw new Error(
    requestedDevice
      ? `ADB device is not connected: ${requestedDevice}`
      : `Expected exactly one connected ADB device, found ${devices.length}.`
  );
}
if (!devices.includes(deviceId)) {
  throw new Error(`ADB device is not connected: ${deviceId}`);
}

const adb = (...args) => execFileSync(
  "adb",
  ["-s", deviceId, ...args],
  { encoding: "utf8" }
);

process.stdout.write(adb("install", "-r", apkPath));

const enabledValue = adb(
  "shell",
  "settings",
  "get",
  "secure",
  "enabled_accessibility_services"
).trim();
const enabledComponents = enabledValue && enabledValue !== "null"
  ? enabledValue.split(":").filter(Boolean)
  : [];
if (!enabledComponents.includes(component)) enabledComponents.push(component);

adb(
  "shell",
  "settings",
  "put",
  "secure",
  "enabled_accessibility_services",
  enabledComponents.join(":")
);
adb("shell", "settings", "put", "secure", "accessibility_enabled", "1");
adb(
  "shell",
  "am",
  "start",
  "-n",
  "jp.foundr1.bridge/jp.foundr1.store.bridge.BridgeActivity"
);
adb(
  "shell",
  "am",
  "start",
  "-n",
  "com.uber.restaurants/.RootActivity"
);

const verified = adb(
  "shell",
  "settings",
  "get",
  "secure",
  "enabled_accessibility_services"
).trim().split(":").includes(component);
if (!verified) throw new Error("Bridge accessibility service was not enabled after installation.");

console.log(JSON.stringify({
  deviceId,
  apkPath,
  accessibilityEnabled: true,
  bridgeStarted: true,
  uberStarted: true
}));
