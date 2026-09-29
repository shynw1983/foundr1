import { createHmac, randomUUID } from "node:crypto";
import type { LightSample } from "./store-light-state";

export type IndoorLightConfig = { storeId: string; botId: string; hubId: string; token: string; secret: string; controlEnabled: boolean };
export class SwitchBotError extends Error {
  readonly code: string;
  readonly uncertain: boolean;
  constructor(code: string, uncertain = false) {
    super(code);
    this.name = "SwitchBotError";
    this.code = code;
    this.uncertain = uncertain;
  }
}

export function indoorLightConfig(storeId: string): IndoorLightConfig | null {
  if (!storeId || storeId !== process.env.SWITCHBOT_INDOOR_LIGHT_STORE_ID?.trim()) return null;
  const token = process.env.SWITCHBOT_TOKEN?.trim();
  const secret = process.env.SWITCHBOT_SECRET?.trim();
  const botId = process.env.SWITCHBOT_INDOOR_LIGHT_BOT_ID?.trim().toUpperCase();
  const hubId = process.env.SWITCHBOT_INDOOR_LIGHT_HUB_ID?.trim().toUpperCase();
  if (!token || !secret || !botId || !hubId || !/^[A-F0-9]{12}$/.test(botId) || !/^[A-F0-9]{12}$/.test(hubId) || botId === hubId) return null;
  return { storeId, token, secret, botId, hubId, controlEnabled: process.env.SWITCHBOT_CONTROL_ENABLED === "true" };
}

async function switchBotRequest(config: IndoorLightConfig, deviceId: string, press = false): Promise<Record<string, unknown>> {
  const t = String(Date.now());
  const nonce = randomUUID();
  const sign = createHmac("sha256", config.secret).update(`${config.token}${t}${nonce}`).digest("base64");
  let response: Response;
  try {
    response = await fetch(`https://api.switch-bot.com/v1.1/devices/${encodeURIComponent(deviceId)}/${press ? "commands" : "status"}`, {
      method: press ? "POST" : "GET",
      headers: { Authorization: config.token, sign, t, nonce, "Content-Type": "application/json" },
      ...(press ? { body: JSON.stringify({ command: "press", parameter: "default", commandType: "command" }) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    // A lost POST response can still mean the physical switch was pressed.
    throw new SwitchBotError("connection", press);
  }
  if (!response.ok) throw new SwitchBotError(`http_${response.status}`, press && response.status >= 500);
  let envelope: { statusCode?: number; body?: Record<string, unknown> };
  try { envelope = await response.json(); } catch { throw new SwitchBotError("invalid_response", press); }
  if (envelope.statusCode !== 100) throw new SwitchBotError(`api_${Number(envelope.statusCode) || 0}`, press && ![151, 152, 160, 161, 171, 190].includes(Number(envelope.statusCode)));
  return envelope.body ?? {};
}

export async function readIndoorLight(config: IndoorLightConfig): Promise<LightSample> {
  const [hub, bot] = await Promise.all([switchBotRequest(config, config.hubId), switchBotRequest(config, config.botId)]);
  if (hub.deviceId !== config.hubId || hub.deviceType !== "Hub 2" || bot.deviceId !== config.botId || bot.deviceType !== "Bot" || bot.hubDeviceId !== config.hubId) throw new SwitchBotError("device_mismatch");
  const lightLevel = hub.lightLevel;
  if (typeof lightLevel !== "number" || !Number.isInteger(lightLevel) || lightLevel < 1 || lightLevel > 20) throw new SwitchBotError("invalid_light_level");
  return {
    lightLevel,
    battery: typeof bot.battery === "number" && bot.battery >= 0 && bot.battery <= 100 ? bot.battery : null,
    botMode: String(bot.deviceMode ?? "")
  };
}

export async function pressIndoorLight(config: IndoorLightConfig) {
  // The only supported command and target in this pilot. No generic proxy.
  await switchBotRequest(config, config.botId, true);
}
