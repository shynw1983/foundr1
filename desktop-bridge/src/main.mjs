import { setTimeout as delay } from "node:timers/promises";

import { BridgeApiClient } from "./api-client.mjs";
import { createAdapter } from "./adapters/index.mjs";
import { BrowserSession } from "./browser-session.mjs";
import { loadConfig } from "./config.mjs";
import {
  INVENTORY_COMMAND_MAX_ATTEMPTS,
  isRetryableInventoryError
} from "./retry-policy.mjs";

const mode = process.argv[2] ?? "check";
const requestedPlatform = String(process.argv[3] ?? "").trim();
const locateHasKind = mode === "locate" && ["item", "option"].includes(process.argv[4]);
const requestedKind = locateHasKind
  ? process.argv[4]
  : "item";
const requestedTarget = String(process.argv.slice(locateHasKind ? 5 : 4).join(" ") ?? "").trim();
const config = await loadConfig({ requireCredentials: mode === "run" });
const enabledPlatforms = ["uber_eats", "rocket_now", "demae_can"]
  .filter((platform) => config.platforms[platform]?.enabled !== false)
  .filter((platform) => !requestedPlatform || requestedPlatform === platform);
if (requestedPlatform && !enabledPlatforms.length) {
  throw new Error(`Platform is not enabled: ${requestedPlatform}`);
}
const sessions = new Map();
const adapters = new Map();

for (const platform of enabledPlatforms) {
  const session = new BrowserSession(config, platform);
  sessions.set(platform, session);
  adapters.set(platform, createAdapter(platform, session, config.platforms[platform]));
}

async function inspectAll() {
  const results = [];
  for (const platform of enabledPlatforms) {
    try {
      results.push(await adapters.get(platform).inspect());
    } catch (error) {
      results.push({ platform, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

async function shutdown() {
  await Promise.all([...sessions.values()].map((session) => session.disconnect()));
}

async function reportProgress(command, progress, error = "") {
  await api.reportProgress(command.id, progress, error).catch((progressError) => {
    console.error(new Date().toISOString(), "progress update failed", progressError instanceof Error ? progressError.message : progressError);
  });
}

async function executeInventoryCommand(command) {
  const platform = String(command.platform);
  const adapter = adapters.get(platform);
  if (!adapter) throw new Error(`No enabled adapter for ${platform}`);
  const payload = command.payload && typeof command.payload === "object" ? command.payload : {};
  const targets = Array.isArray(payload.targets) ? payload.targets : [];

  for (let attempt = 1; attempt <= INVENTORY_COMMAND_MAX_ATTEMPTS; attempt += 1) {
    try {
      await reportProgress(command, {
        phase: "locating",
        attempt,
        maxAttempts: INVENTORY_COMMAND_MAX_ATTEMPTS
      });
      const located = await adapter.locateTargets(targets);
      const ambiguous = located.filter((item) => item.matches.length > 1);
      const verified = located.filter((item) => item.matches.length === 1);
      const missing = located.filter((item) => item.matches.length === 0);
      if (ambiguous.length || !verified.length) {
        const rejected = [...ambiguous, ...missing];
        throw new Error(`Target verification failed: ${rejected.map((item) => `${item.label}=${item.matches.length}`).join(", ")}`);
      }
      await reportProgress(command, {
        phase: "applying",
        attempt,
        maxAttempts: INVENTORY_COMMAND_MAX_ATTEMPTS
      });
      const result = await adapter.setInventory(payload, verified);
      return {
        ...result,
        matchedTargetCount: verified.length,
        missingTargetCount: missing.length,
        missingTargets: missing.map((item) => item.label)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= INVENTORY_COMMAND_MAX_ATTEMPTS || !isRetryableInventoryError(message)) throw error;
      console.error(new Date().toISOString(), `${platform} retry ${attempt}/${INVENTORY_COMMAND_MAX_ATTEMPTS - 1}: ${message}`);
      await reportProgress(command, {
        phase: "retrying",
        attempt: attempt + 1,
        maxAttempts: INVENTORY_COMMAND_MAX_ATTEMPTS
      }, message);
      await sessions.get(platform)?.disconnect();
      await delay(1500 * attempt);
    }
  }
  throw new Error("Inventory command retry limit reached.");
}

process.once("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});
process.once("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});

if (mode === "login") {
  const results = await inspectAll();
  console.log(JSON.stringify(results, null, 2));
  console.log("Dedicated Chrome windows are open. Sign in, then press Ctrl-C.");
  await new Promise(() => undefined);
}

if (mode === "check") {
  console.log(JSON.stringify(await inspectAll(), null, 2));
  await shutdown();
  process.exit(0);
}

if (mode === "locate") {
  if (!requestedPlatform || !requestedTarget) {
    throw new Error("Usage: node src/main.mjs locate <platform> [item|option] <exact product name>");
  }
  const result = await adapters.get(requestedPlatform).locateTargets([{ kind: requestedKind, label: requestedTarget, aliases: [] }]);
  console.log(JSON.stringify(result, null, 2));
  await shutdown();
  process.exit(0);
}

if (mode !== "run") throw new Error(`Unknown mode: ${mode}`);
if (!config.executionEnabled) {
  throw new Error("executionEnabled is false. Complete read-only browser validation before enabling command execution.");
}

const api = new BridgeApiClient(config);
let lastStatusAt = 0;
for (;;) {
  let command = null;
  try {
    if (Date.now() - lastStatusAt > 60000) {
      const checks = await inspectAll();
      const healthy = checks.every((item) => item.ok);
      await api.reportStatus({
        level: healthy ? "healthy" : "attention",
        problem: healthy ? "" : checks.filter((item) => !item.ok).map((item) => `${item.platform}: login required`).join("; "),
        realtimeConnected: false,
        accessibilityConnected: true,
        notificationConnected: false
      });
      lastStatusAt = Date.now();
    }
    command = await api.nextCommand();
    if (!command) {
      await delay(config.pollIntervalMs);
      continue;
    }
    const result = await executeInventoryCommand(command);
    await api.acknowledge(command.id, "succeeded", result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(new Date().toISOString(), message);
    if (command?.id) {
      await api.acknowledge(command.id, "failed", {}, message).catch((ackError) => {
        console.error(new Date().toISOString(), "acknowledgement failed", ackError instanceof Error ? ackError.message : ackError);
      });
    }
    await delay(config.pollIntervalMs);
  }
}
