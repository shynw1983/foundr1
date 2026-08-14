import { setTimeout as delay } from "node:timers/promises";
import { BridgeApiClient } from "./api-client.mjs";
import { loadConfig } from "./config.mjs";
import { formatVoiceResult } from "./voice-result.mjs";

const args = process.argv.slice(2);
const action = String(args[0] ?? "").trim();
const preview = args.includes("--preview");
const confirmed = args.includes("--confirmed");
const shortcutMode = args.includes("--shortcut");
const query = args.slice(1).filter((value) => !value.startsWith("--")).join(" ").trim();

async function run() {
  if (!["stockout", "restore"].includes(action) || !query) {
    throw new Error("请说出要修改的商品名称。");
  }
  if (!preview && !confirmed) {
    throw new Error("缺少确认参数，未修改商品状态。");
  }
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
  console.log(await run());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`操作失败：${message.replace(/^Foundr1 HTTP \d+:\s*/i, "")}`);
  if (!shortcutMode) process.exitCode = 1;
}
