import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { BridgeApiClient } from "./api-client.mjs";
import { loadConfig } from "./config.mjs";
import {
  formatVoiceAcknowledgement,
  formatVoiceConfirmation,
  formatVoiceFailure,
  formatVoiceResult,
  classifyVoiceConfirmation
} from "./voice-result.mjs";

const args = process.argv.slice(2);
const action = String(args[0] ?? "").trim();
const preview = args.includes("--preview");
const confirmed = args.includes("--confirmed");
const shortcutMode = args.includes("--shortcut");
const backgroundMode = args.includes("--background");
const voiceConfirmMode = args.includes("--voice-confirm");
const restartShortcutMode = args.includes("--restart-shortcut");
const query = args.slice(1).filter((value) => !value.startsWith("--")).join(" ").trim();
const scriptFilename = fileURLToPath(import.meta.url);
const voiceLogDirectory = path.join(homedir(), "Library", "Logs", "Foundr1 Desktop Bridge");
const voiceLogFilename = path.join(voiceLogDirectory, "voice.log");
const pendingDirectory = path.join(homedir(), "Library", "Application Support", "Foundr1 Desktop Bridge");
const pendingFilename = path.join(pendingDirectory, `voice-pending-${action}.json`);

async function appendVoiceLog(message) {
  await mkdir(voiceLogDirectory, { recursive: true });
  await appendFile(voiceLogFilename, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function startBackgroundCommand(commandQuery = query) {
  const child = spawn(process.execPath, [
    scriptFilename,
    action,
    "--confirmed",
    "--shortcut",
    "--background",
    commandQuery
  ], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function savePendingQuery(commandQuery) {
  await mkdir(pendingDirectory, { recursive: true });
  await writeFile(pendingFilename, JSON.stringify({ query: commandQuery, createdAt: Date.now() }), "utf8");
}

async function loadPendingQuery() {
  const pending = JSON.parse(await readFile(pendingFilename, "utf8"));
  if (!pending?.query || Date.now() - Number(pending.createdAt ?? 0) > 5 * 60 * 1000) {
    throw new Error("确认已经超时，请重新开始。 ");
  }
  return String(pending.query);
}

async function clearPendingQuery() {
  await rm(pendingFilename, { force: true });
}

function shortcutName() {
  return action === "restore" ? "商品恢复" : "商品缺货";
}

function startShortcutAgain() {
  const child = spawn(process.execPath, [scriptFilename, action, "--restart-shortcut", "--background"], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function restartShortcut() {
  await delay(500);
  const child = spawn("/usr/bin/shortcuts", ["run", shortcutName()], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
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
    await savePendingQuery(query);
    return formatVoiceConfirmation({ query, isAvailable: result.isAvailable === true });
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
    matchedLabel: String(result.query ?? query),
    isAvailable: result.isAvailable === true,
    commands
  });
}

try {
  if (restartShortcutMode && backgroundMode) {
    await restartShortcut();
  } else if (voiceConfirmMode && shortcutMode) {
    if (!query) throw new Error("请回答是或者不是。");
    const confirmation = classifyVoiceConfirmation(query);
    if (confirmation === "no") {
      await clearPendingQuery();
      const feedback = "好的，请重新说商品名称。";
      console.log(feedback);
      await speakChinese(feedback);
      startShortcutAgain();
    } else if (confirmation === "yes") {
      const pendingQuery = await loadPendingQuery();
      await clearPendingQuery();
      startBackgroundCommand(pendingQuery);
      const feedback = formatVoiceAcknowledgement({ query: pendingQuery, isAvailable: action === "restore" });
      console.log(feedback);
      await speakChinese(feedback);
    } else {
      await clearPendingQuery();
      const feedback = "我没有听清。我们重新来一次，请再说商品名称。";
      console.log(feedback);
      await speakChinese(feedback);
      startShortcutAgain();
    }
  } else if (shortcutMode && !backgroundMode && !preview) {
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
  const feedback = formatVoiceFailure(message);
  console.log(feedback);
  if (backgroundMode || voiceConfirmMode) {
    await appendVoiceLog(feedback).catch(() => undefined);
    await speakChinese(feedback).catch(() => undefined);
  }
  if (!shortcutMode) process.exitCode = 1;
}
