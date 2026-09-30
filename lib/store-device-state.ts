import { estimateIndoorLight } from "./store-light-state";

export const deviceCooldownMs = 10_000;
export const deviceCommandLeaseMs = 60_000;
export const deviceObservationDelays = [5_000, 15_000, 30_000] as const;
export type DeviceKind = "indoorLight" | "bot" | "plug" | "shade" | "lock" | "hub" | "meter" | "keypad" | "remote" | "unsupported";
export type DeviceAction = "press" | "turnOn" | "turnOff" | "setPosition" | "lock" | "unlock" | "deadbolt";
export type DeviceSample = {
  battery?: number | null; lightLevel?: number | null; temperature?: number | null; humidity?: number | null;
  botMode?: string; power?: string; position?: number | null; moving?: boolean; calibrated?: boolean;
  lockState?: string; doorState?: string;
};
export type DeviceCommand = {
  id: string; action: DeviceAction; parameter: string;
  result: "pending" | "accepted" | "rejected" | "unknown";
  requestedAt: string; finishedAt: string | null; before: DeviceSample | null; reason: string;
};
export type StoreDevice = {
  key: string; name: string; type: string; kind: DeviceKind; actions: DeviceAction[];
  sample: DeviceSample | null; fetchedAt: string | null; readError: boolean; issue: string;
  controlEnabled: boolean; blockedUntil: string | null; command: DeviceCommand | null;
};
export type StoreDevicesView = { configured: boolean; storeId: string; devices: StoreDevice[] };
export function deviceCommandSkipped(command: DeviceCommand) { return ["already_in_state", "light_below_on_range", "light_ambiguous"].includes(command.reason); }

export function deviceObservation(device: StoreDevice, now = Date.now()): "none" | "waiting" | "observed" | "unconfirmed" | "rejected" {
  const command = device.command;
  if (!command) return "none";
  if (command.result === "rejected") return "rejected";
  if (command.reason === "already_in_state") return "observed";
  if (deviceCommandSkipped(command)) return "unconfirmed";
  const finished = command.finishedAt ? Date.parse(command.finishedAt) : Date.parse(command.requestedAt) + deviceCommandLeaseMs;
  if (!device.readError && device.sample && device.fetchedAt && Date.parse(device.fetchedAt) >= finished + 4_000) {
    const sample = device.sample;
    if (command.action === "setPosition" && !sample.moving && sample.position === Number(command.parameter)) return "observed";
    if (command.action === "lock" && sample.lockState === "locked") return "observed";
    if (command.action === "unlock" && sample.lockState === "unlocked") return "observed";
    if (command.action === "turnOn" && sample.power === "on") return "observed";
    if (command.action === "turnOff" && sample.power === "off") return "observed";
    if (device.kind === "indoorLight" && sample.botMode === "pressMode" && (command.action === "turnOn" || command.action === "turnOff")) {
      const after = estimateIndoorLight(sample.lightLevel, device.fetchedAt, Date.parse(device.fetchedAt));
      if (after === (command.action === "turnOn" ? "on" : "off")) return "observed";
    }
    if (device.kind === "indoorLight" && command.action === "press") {
      const before = estimateIndoorLight(command.before?.lightLevel, device.fetchedAt, Date.parse(device.fetchedAt));
      const after = estimateIndoorLight(sample.lightLevel, device.fetchedAt, Date.parse(device.fetchedAt));
      if (before !== "unknown" && after !== "unknown" && before !== after) return "observed";
    }
  }
  return now < finished + 35_000 ? "waiting" : "unconfirmed";
}

export function deviceStateLabel(device: StoreDevice): string {
  if (device.readError || !device.sample) return "状態を取得できません";
  const s = device.sample;
  if (device.kind === "indoorLight") {
    const state = estimateIndoorLight(s.lightLevel, device.fetchedAt, device.fetchedAt ? Date.parse(device.fetchedAt) : Date.now());
    return state === "on" ? "点灯（推定）" : state === "off" ? "消灯（推定）" : "状態を判定できません";
  }
  if (device.kind === "bot") return s.botMode === "pressMode" ? "点灯状態は取得できません" : s.power === "on" ? "オン" : s.power === "off" ? "オフ" : "状態を判定できません";
  if (device.kind === "plug") return s.power === "on" ? "オン" : s.power === "off" ? "オフ" : "状態を判定できません";
  if (device.kind === "lock") return s.lockState === "locked" ? "施錠中" : s.lockState === "unlocked" ? "解錠中" : "状態を判定できません";
  if (device.kind === "shade") return s.position == null ? "状態を判定できません" : s.moving ? "移動中" : s.position === 0 ? "全開" : s.position === 100 ? "全閉" : "途中の位置";
  return "取得済み";
}
