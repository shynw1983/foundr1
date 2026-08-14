import { chmod, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function expandHome(value) {
  const text = String(value ?? "").trim();
  if (text === "~") return homedir();
  if (text.startsWith("~/")) return path.join(homedir(), text.slice(2));
  return text;
}

export function configPath() {
  return process.env.FOUNDR1_DESKTOP_BRIDGE_CONFIG
    ? path.resolve(expandHome(process.env.FOUNDR1_DESKTOP_BRIDGE_CONFIG))
    : path.join(bridgeRoot, "config.local.json");
}

export async function loadConfig({ requireCredentials = false } = {}) {
  const filename = configPath();
  const source = JSON.parse(await readFile(filename, "utf8"));
  const config = {
    serverUrl: String(source.serverUrl ?? "https://www.foundr1.jp").replace(/\/$/, ""),
    storeId: String(source.storeId ?? "").trim(),
    bridgeToken: String(source.bridgeToken ?? "").trim(),
    deviceName: String(source.deviceName ?? "Foundr1 Desktop Bridge").trim(),
    executionEnabled: source.executionEnabled === true,
    pollIntervalMs: Math.max(2000, Math.min(60000, Number(source.pollIntervalMs ?? 5000))),
    chromeExecutablePath: expandHome(source.chromeExecutablePath),
    chromeProfilesRoot: expandHome(source.chromeProfilesRoot),
    platforms: source.platforms && typeof source.platforms === "object" ? source.platforms : {}
  };
  if (!config.chromeExecutablePath) throw new Error("chromeExecutablePath is required.");
  if (!config.chromeProfilesRoot) throw new Error("chromeProfilesRoot is required.");
  if (requireCredentials && (!config.storeId || !config.bridgeToken)) {
    throw new Error("storeId and bridgeToken are required before command polling can start.");
  }
  await chmod(filename, 0o600).catch(() => undefined);
  return config;
}
