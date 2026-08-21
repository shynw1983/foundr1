import { setTimeout as delay } from "node:timers/promises";

import { BridgeApiClient } from "./api-client.mjs";
import { createAdapter } from "./adapters/index.mjs";
import { BrowserSession } from "./browser-session.mjs";
import { loadConfig } from "./config.mjs";
import {
  DEMAE_CAN_CIRCUIT_FAILURE_THRESHOLD,
  DEMAE_CAN_CIRCUIT_OPEN_MS,
  inventoryCommandMaxAttempts,
  isDemaeCanCircuitFailure,
  isRetryableInventoryError,
  partialInventoryTargetError,
  shouldRestartDemaeCanBrowser
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
let demaeCanConsecutiveTimeouts = 0;
let demaeCanCircuitOpenUntil = 0;

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

function platformStatusProblem(item) {
  const label = item.platform === "demae_can" ? "出前馆" : item.platform;
  const error = String(item.error ?? "");
  if (/credentials_missing/u.test(error)) return `${label}: 尚未设置自动登录信息`;
  if (/credentials_rejected/u.test(error)) return `${label}: 自动登录信息不正确`;
  if (/account_locked/u.test(error)) return `${label}: 账号已锁定，需要人工处理`;
  if (/password_expired/u.test(error)) return `${label}: 密码已过期，需要人工处理`;
  if (/manual_verification_required/u.test(error)) return `${label}: 需要验证码或人工验证`;
  if (/keychain_unavailable/u.test(error)) return `${label}: Mac 钥匙串暂时无法读取`;
  if (/login/u.test(error) || item.loginRequired) return `${label}: 自动重新登录失败`;
  return `${label}: 平台页面暂时不可用`;
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
  const manualRetry = Boolean(payload.manualRetryAt);
  if (platform === "demae_can" && manualRetry) {
    demaeCanConsecutiveTimeouts = 0;
    demaeCanCircuitOpenUntil = 0;
  }
  if (platform === "demae_can" && Date.now() < demaeCanCircuitOpenUntil) {
    throw new Error(`demae_can_circuit_open_until:${new Date(demaeCanCircuitOpenUntil).toISOString()}`);
  }
  const maxAttempts = inventoryCommandMaxAttempts(platform);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await reportProgress(command, {
        phase: "locating",
        attempt,
        maxAttempts
      });
      const located = await adapter.locateTargets(targets);
      const ambiguous = located.filter((item) => item.matches.length > 1);
      const verified = located.filter((item) => item.matches.length === 1);
      const missing = located.filter((item) => item.matches.length === 0);
      if (ambiguous.length || !verified.length) {
        const problems = [];
        if (ambiguous.length) {
          problems.push(`Multiple target matches: ${ambiguous.map((item) => `${item.label}=${item.matches.length}`).join(", ")}`);
        }
        if (missing.length) {
          problems.push(`Target verification failed: ${missing.map((item) => `${item.label}=0`).join(", ")}`);
        }
        throw new Error(problems.join("; "));
      }
      await reportProgress(command, {
        phase: "applying",
        attempt,
        maxAttempts
      });
      const result = await adapter.setInventory(payload, verified);
      const partialError = partialInventoryTargetError(missing.map((item) => item.label), verified.length);
      if (partialError) throw new Error(partialError);
      if (platform === "demae_can") {
        demaeCanConsecutiveTimeouts = 0;
        demaeCanCircuitOpenUntil = 0;
      }
      return {
        ...result,
        matchedTargetCount: verified.length,
        missingTargetCount: missing.length,
        missingTargets: missing.map((item) => item.label)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts || !isRetryableInventoryError(message)) {
        if (platform === "demae_can" && isDemaeCanCircuitFailure(message)) {
          demaeCanConsecutiveTimeouts += 1;
          if (demaeCanConsecutiveTimeouts >= DEMAE_CAN_CIRCUIT_FAILURE_THRESHOLD) {
            demaeCanCircuitOpenUntil = Date.now() + DEMAE_CAN_CIRCUIT_OPEN_MS;
          }
        }
        throw error;
      }
      console.error(new Date().toISOString(), `${platform} retry ${attempt}/${maxAttempts - 1}: ${message}`);
      await reportProgress(command, {
        phase: "retrying",
        attempt: attempt + 1,
        maxAttempts
      }, message);
      if (platform === "demae_can" && shouldRestartDemaeCanBrowser(message)) {
        await sessions.get(platform)?.close();
      } else {
        await sessions.get(platform)?.disconnect();
      }
      await delay(1500 * attempt);
    }
  }
  throw new Error("Inventory command retry limit reached.");
}

async function executeMenuCommand(command) {
  const platform = String(command.platform);
  const adapter = adapters.get(platform);
  if (!adapter) throw new Error(`No enabled adapter for ${platform}`);
  const payload = command.payload && typeof command.payload === "object" ? command.payload : {};
  if (command.type === "capture_menu_snapshot") {
    await reportProgress(command, { phase: "capturing", attempt: 1, maxAttempts: 3 });
    return adapter.captureMenuSnapshot(payload);
  }
  if (command.type === "publish_menu_changes") {
    await reportProgress(command, { phase: "locating", attempt: 1, maxAttempts: 3 });
    return adapter.publishMenuChanges(payload, async (progress) => reportProgress(command, progress));
  }
  throw new Error(`unsupported_menu_command:${command.type}`);
}

async function executeAuditCommand(command) {
  const platform = String(command.platform);
  const adapter = adapters.get(platform);
  if (!adapter || typeof adapter.auditInventory !== "function") {
    throw new Error(`unsupported_inventory_audit:${platform}`);
  }
  const payload = command.payload && typeof command.payload === "object" ? command.payload : {};
  await reportProgress(command, { phase: "auditing", attempt: 1, maxAttempts: 1 });
  return adapter.auditInventory(payload);
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
    command = await api.nextCommand();
    if (command) {
      const result = command.type === "audit_inventory"
        ? await executeAuditCommand(command)
        : ["publish_menu_changes", "capture_menu_snapshot"].includes(command.type)
          ? await executeMenuCommand(command)
          : await executeInventoryCommand(command);
      await api.acknowledge(command.id, "succeeded", result);
      continue;
    }
    if (Date.now() - lastStatusAt > 60000) {
      const checks = await inspectAll();
      const healthy = checks.every((item) => item.ok);
      await api.reportStatus({
        level: healthy ? "healthy" : "attention",
        problem: healthy ? "" : checks.filter((item) => !item.ok).map(platformStatusProblem).join("; "),
        realtimeConnected: false,
        accessibilityConnected: true,
        notificationConnected: false
      });
      lastStatusAt = Date.now();
    }
    await delay(config.pollIntervalMs);
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
