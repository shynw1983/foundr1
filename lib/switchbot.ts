import { createHash, createHmac, randomUUID } from "node:crypto";
import type { DeviceAction, DeviceKind, DeviceSample } from "./store-device-state";

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

async function switchBotRequest(config: IndoorLightConfig, path: string, command?: { command: string; parameter: string; commandType: "command" }): Promise<Record<string, unknown>> {
  const t = String(Date.now());
  const nonce = randomUUID();
  const sign = createHmac("sha256", config.secret).update(`${config.token}${t}${nonce}`).digest("base64");
  let response: Response;
  try {
    response = await fetch(`https://api.switch-bot.com/v1.1/${path}`, {
      method: command ? "POST" : "GET",
      headers: { Authorization: config.token, sign, t, nonce, "Content-Type": "application/json" },
      ...(command ? { body: JSON.stringify(command) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    // A lost POST response can still mean the physical switch was pressed.
    throw new SwitchBotError("connection", Boolean(command));
  }
  if (!response.ok) throw new SwitchBotError(`http_${response.status}`, Boolean(command) && response.status >= 500);
  let envelope: { statusCode?: number; body?: Record<string, unknown> };
  try { envelope = await response.json(); } catch { throw new SwitchBotError("invalid_response", Boolean(command)); }
  if (envelope.statusCode !== 100) throw new SwitchBotError(`api_${Number(envelope.statusCode) || 0}`, Boolean(command) && ![151, 152, 160, 161, 171, 190].includes(Number(envelope.statusCode)));
  return envelope.body ?? {};
}

export type SwitchBotDevice = { id: string; key: string; name: string; type: string; kind: DeviceKind; cloud: boolean; secondary: boolean };
export function deviceKey(storeId: string, id: string) { return createHash("sha256").update(`${storeId}:${id}`).digest("hex").slice(0, 24); }
export function readRawStatus(config: IndoorLightConfig, id: string) { return switchBotRequest(config, `devices/${encodeURIComponent(id)}/status`); }

export async function listStoreSwitchBots(config: IndoorLightConfig): Promise<SwitchBotDevice[]> {
  const body = await switchBotRequest(config, "devices");
  if (!Array.isArray(body.deviceList)) throw new SwitchBotError("invalid_response");
  return body.deviceList.filter((d): d is Record<string, unknown> => Boolean(d && typeof d === "object"))
    .filter(d => d.deviceId === config.hubId || d.hubDeviceId === config.hubId)
    .filter(d => typeof d.deviceId === "string" && /^[A-F0-9]{12}$/.test(d.deviceId))
    .map(d => {
      const id = String(d.deviceId), type = String(d.deviceType);
      const kind: DeviceKind = type === "Bot" ? (id === config.botId ? "indoorLight" : "bot") : type === "Roller Shade" ? "shade" : type === "Smart Lock Pro" ? "lock" : type === "Hub 2" ? "hub" : type === "Meter" ? "meter" : type === "Keypad Vision" ? "keypad" : type === "Remote" ? "remote" : "unsupported";
      return { id, key: deviceKey(config.storeId, id), name: String(d.deviceName || type), type, kind, cloud: d.enableCloudService === true, secondary: d.group === true && d.master === false };
    });
}

const bounded = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
export async function readStoreDevice(config: IndoorLightConfig, device: SwitchBotDevice, hubRead?: Promise<Record<string, unknown>>): Promise<DeviceSample> {
  if (!device.cloud) throw new SwitchBotError("cloud_disabled");
  const raw = device.id === config.hubId && hubRead ? await hubRead : await readRawStatus(config, device.id);
  if (raw.deviceId !== device.id || raw.deviceType !== device.type || raw.hubDeviceId !== config.hubId) throw new SwitchBotError("device_mismatch");
  const battery = bounded(raw.battery, 0, 100);
  if (device.kind === "indoorLight" || device.kind === "bot") {
    if (!["pressMode", "switchMode"].includes(String(raw.deviceMode))) throw new SwitchBotError("unsupported_mode");
    const sample: DeviceSample = { battery, botMode: String(raw.deviceMode), ...(raw.deviceMode === "switchMode" ? { power: String(raw.power) } : {}) };
    if (device.kind === "indoorLight") {
      const hub = hubRead ? await hubRead : await readRawStatus(config, config.hubId);
      if (hub.deviceId !== config.hubId || hub.deviceType !== "Hub 2") throw new SwitchBotError("device_mismatch");
      sample.lightLevel = bounded(hub.lightLevel, 1, 20);
      if (!Number.isInteger(sample.lightLevel)) throw new SwitchBotError("invalid_light_level");
    }
    return sample;
  }
  if (device.kind === "shade") return { battery, position: Number.isInteger(raw.slidePosition) ? bounded(raw.slidePosition, 0, 100) : null, moving: raw.moving === true, calibrated: raw.calibrate === true };
  if (device.kind === "lock") return { battery, calibrated: raw.calibrate === true, lockState: String(raw.lockState ?? "").replace(/^lock$/, "locked").replace(/^unlock$/, "unlocked"), doorState: String(raw.doorState ?? "").replace(/^close$/, "closed") };
  if (device.kind === "meter" && battery === 0 && raw.temperature === 0 && raw.humidity === 0) throw new SwitchBotError("sensor_unavailable");
  if (device.kind === "hub" || device.kind === "meter") return { ...(device.kind === "meter" ? { battery } : { lightLevel: bounded(raw.lightLevel, 1, 20) }), temperature: bounded(raw.temperature, -100, 100), humidity: bounded(raw.humidity, 0, 100) };
  return { battery };
}

export function deviceActions(device: SwitchBotDevice, sample: DeviceSample | null): DeviceAction[] {
  if (!device.cloud || device.secondary) return [];
  if (device.kind === "indoorLight" || device.kind === "bot") return sample?.botMode === "switchMode" ? ["turnOn", "turnOff"] : ["press"];
  if (device.kind === "shade") return ["setPosition"];
  if (device.kind === "lock") return ["lock", "unlock", "deadbolt"];
  return [];
}

export function validateDeviceAction(device: SwitchBotDevice, sample: DeviceSample, action: DeviceAction, parameter: string) {
  if (!deviceActions(device, sample).includes(action)) throw new SwitchBotError("unsupported_command");
  if (action === "setPosition") {
    if (!/^(100|[1-9]?\d)$/.test(parameter)) throw new SwitchBotError("invalid_position");
    if (!sample.calibrated || sample.position === null) throw new SwitchBotError("not_calibrated");
    return;
  }
  if (parameter !== "default") throw new SwitchBotError("invalid_parameter");
  if (device.kind === "lock") {
    if (!sample.calibrated || !["locked", "unlocked"].includes(sample.lockState || "")) throw new SwitchBotError("lock_unavailable");
    if (action === "lock" && sample.doorState !== "closed") throw new SwitchBotError("door_not_closed");
  }
  // A freshly fetched cloud value can still describe an older physical state.
  // Validate safety here; do not discard a deliberate user command based on it.
}

function assertDeviceCommandResult(body: Record<string, unknown>, deviceId: string) {
  // HTTP/envelope success does not imply the nested device result succeeded.
  // Older API responses have an empty body and only acknowledge acceptance.
  let code: unknown;
  if (Object.hasOwn(body, "items")) {
    if (!Array.isArray(body.items)) throw new SwitchBotError("invalid_device_result", true);
    const matches = body.items.filter(item => item && typeof item === "object" && String(item.deviceID ?? item.deviceId).toUpperCase() === deviceId);
    if (matches.length !== 1) throw new SwitchBotError("device_result_missing", true);
    code = matches[0].code;
  } else if (Object.hasOwn(body, "code")) code = body.code;
  else return;
  if (typeof code !== "number" || !Number.isInteger(code)) throw new SwitchBotError("invalid_device_result", true);
  if (code !== 100) throw new SwitchBotError(`api_${code}`, ![151, 152, 160, 161, 171, 190].includes(code));
}

export async function sendStoreDeviceCommand(config: IndoorLightConfig, device: SwitchBotDevice, action: DeviceAction, parameter: string) {
  // Called only after typed command validation and a durable device claim.
  const body = await switchBotRequest(config, `devices/${device.id}/commands`, { command: action, parameter, commandType: "command" });
  assertDeviceCommandResult(body, device.id);
}
