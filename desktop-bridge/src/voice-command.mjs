import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { BridgeApiClient } from "./api-client.mjs";
import { loadConfig } from "./config.mjs";
import { formatVoiceAcknowledgement, formatVoiceResult } from "./voice-result.mjs";

const args = process.argv.slice(2);
const action = String(args[0] ?? "").trim();
const preview = args.includes("--preview");
const confirmed = args.includes("--confirmed");
const shortcutMode = args.includes("--shortcut");
const backgroundMode = args.includes("--background");
const query = args.slice(1).filter((value) => !value.startsWith("--")).join(" ").trim();
const scriptFilename = fileURLToPath(import.meta.url);
const voiceLogDirectory = path.join(homedir(), "Library", "Logs", "Foundr1 Desktop Bridge");
const voiceLogFilename = path.join(voiceLogDirectory, "voice.log");

async function appendVoiceLog(message) {
  await mkdir(voiceLogDirectory, { recursive: true });
  await appendFile(voiceLogFilename, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function startBackgroundCommand() {
  const child = spawn(process.execPath, [
    scriptFilename,
    action,
    "--confirmed",
    "--shortcut",
    "--background",
    query
  ], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function speakChinese(message) {
  await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/say", ["-v", "Ting-Ting", message], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`say exited with code ${code}`)));
  });
}

function validateRequest() {
  if (!["stockout", "restore"].includes(action) || !query) {
    throw new Error("请说出要修改的商品名称。");
  }
  if (!preview && !confirmed) {
    throw new Error("缺少确认参数，未修改商品状态。");
  }
}

async function run() {
  validateRequest();
  const config = await loadConfig({ requireCredentials: true });
  const api = new BridgeApiClient(config);
  const result = await api.setVoiceInventory(action, query, { preview, confirmed });
  if (preview) {
    const nextStatus = result.isAvailable ? "恢复销售" : "设为永久缺货";
    return `已找到${result.brandName}的${result.matchedLabel}，将${nextStatus}。`;
  }

  const pending = new Map((result.commands ?? []).map((command) => [command.id, {
    ...command,
    status: "pending",
    error: ""
  }]));
  for (let attempt = 0; pending.size && attempt < 75; attempt += 1) {
    if (attempt > 0) await delay(2000);
    for (const [commandId, command] of [...pending]) {
      if (command.status !== "pending") continue;
      try {
        const status = await api.voiceInventoryCommandStatus(commandId);
        if (status.status === "succeeded" || status.status === "failed") {
          pending.set(commandId, {
            ...command,
            status: status.status,
            error: String(status.lastError ?? "")
          });
        }
      } catch (error) {
        if (attempt < 74) continue;
        pending.set(commandId, {
          ...command,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if ([...pending.values()].every((command) => command.status !== "pending")) break;
  }
  const commands = [...pending.values()].map((command) => command.status === "pending"
    ? { ...command, status: "failed", error: "结果确认超时" }
    : command);
  return formatVoiceResult({
    matchedLabel: String(result.matchedLabel ?? query),
    isAvailable: result.isAvailable === true,
    commands
  });
}

try {
  if (shortcutMode && !backgroundMode && !preview) {
    validateRequest();
    startBackgroundCommand();
    console.log(formatVoiceAcknowledgement({ query, isAvailable: action === "restore" }));
  } else {
    const message = await run();
    console.log(message);
    if (backgroundMode) {
      await appendVoiceLog(message).catch(() => undefined);
      await speakChinese(message);
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const feedback = `操作失败：${message.replace(/^Foundr1 HTTP \d+:\s*/i, "")}`;
  console.log(feedback);
  if (backgroundMode) {
    await appendVoiceLog(feedback).catch(() => undefined);
    await speakChinese(feedback).catch(() => undefined);
  }
  if (!shortcutMode) process.exitCode = 1;
}
