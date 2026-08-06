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

const wait = (milliseconds) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const readEnabledComponents = () => {
  const value = adb(
    "shell",
    "settings",
    "get",
    "secure",
    "enabled_accessibility_services"
  ).trim();
  return value && value !== "null" ? value.split(":").filter(Boolean) : [];
};

const readAccessibilityHealth = () => {
  const dump = adb("shell", "dumpsys", "accessibility");
  const boundLine = dump.match(/Bound services:\{([^\n]*)/i)?.[1] || "";
  const crashedLine = dump.match(/Crashed services:\{([^\n]*)/i)?.[1] || "";
  return {
    enabled: readEnabledComponents().includes(component),
    bound: boundLine.includes("Foundr1 Bridge")
      || boundLine.includes("Foundr1 Delivery Bridge")
      || boundLine.includes("jp.foundr1.bridge"),
    crashed: crashedLine.includes("Foundr1 Bridge")
      || crashedLine.includes("Foundr1 Delivery Bridge")
      || crashedLine.includes("jp.foundr1.bridge"),
  };
};

const rebindAccessibilityService = () => {
  const enabledComponents = readEnabledComponents().filter((value) => value !== component);

  // Reinstalling an enabled accessibility service can leave Android reporting it as
  // enabled while the service remains in the crashed set. Fully cycle accessibility
  // and restore every previously enabled component so the new APK is really bound.
  adb("shell", "settings", "put", "secure", "accessibility_enabled", "0");
  if (enabledComponents.length > 0) {
    adb(
      "shell",
      "settings",
      "put",
      "secure",
      "enabled_accessibility_services",
      enabledComponents.join(":")
    );
  } else {
    adb("shell", "settings", "delete", "secure", "enabled_accessibility_services");
  }
  wait(1200);
  enabledComponents.push(component);
  adb(
    "shell",
    "settings",
    "put",
    "secure",
    "enabled_accessibility_services",
    enabledComponents.join(":")
  );
  adb("shell", "settings", "put", "secure", "accessibility_enabled", "1");
};

process.stdout.write(adb("install", "-r", apkPath));

let accessibilityHealth = { enabled: false, bound: false, crashed: false };
for (let attempt = 1; attempt <= 3; attempt += 1) {
  rebindAccessibilityService();
  wait(1800);
  accessibilityHealth = readAccessibilityHealth();
  if (
    accessibilityHealth.enabled
    && accessibilityHealth.bound
    && !accessibilityHealth.crashed
  ) break;
}
if (
  !accessibilityHealth.enabled
  || !accessibilityHealth.bound
  || accessibilityHealth.crashed
) {
  throw new Error(
    `Bridge accessibility service is unhealthy after installation: ${JSON.stringify(accessibilityHealth)}`
  );
}

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

console.log(JSON.stringify({
  deviceId,
  apkPath,
  accessibilityEnabled: accessibilityHealth.enabled,
  accessibilityBound: accessibilityHealth.bound,
  accessibilityCrashed: accessibilityHealth.crashed,
  bridgeStarted: true,
  uberStarted: true
}));
