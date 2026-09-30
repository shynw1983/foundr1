import type { DeviceAction, DeviceKind, DeviceSample } from "./store-device-state";

export const sceneMaxSteps = 8;
export const sceneMaxCount = 20;
export const sceneRunLifetimeMs = 180_000;
export const sceneUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type SceneAction = Exclude<DeviceAction, "deadbolt">;
export type SceneStep = { device: string; action: SceneAction; position?: number };
export type StoreScene = { id: string; name: string; steps: SceneStep[] };
export type SceneCatalogDevice = { key: string; name: string; kind: DeviceKind; cloud?: boolean; secondary?: boolean };
export type SceneStepResult = SceneStep & { name: string; status: "waiting" | "running" | "sent" | "skipped" | "failed" | "unknown" | "not_run"; reason: string; commandId?: string };
export type SceneRun = { id: string; sceneId: string; name: string; status: "running" | "finished" | "interrupted"; startedAt: string; expiresAt: string; finishedAt: string | null; steps: SceneStepResult[] };
export type SceneView = { storeId: string; configured: boolean; revision: string; scenes: StoreScene[]; latestRun: SceneRun | null };

export function sceneActions(device: SceneCatalogDevice): SceneAction[] {
  if (device.cloud === false || device.secondary) return [];
  if (device.kind === "indoorLight" || device.kind === "plug") return ["turnOn", "turnOff"];
  if (device.kind === "bot") return ["press", "turnOn", "turnOff"];
  if (device.kind === "shade") return ["setPosition"];
  if (device.kind === "lock") return ["lock", "unlock"];
  return [];
}

export function validScenes(value: unknown): value is StoreScene[] {
  if (!Array.isArray(value) || value.length > sceneMaxCount) return false;
  const ids = new Set<string>();
  return value.every(scene => {
    if (!scene || typeof scene !== "object" || typeof scene.id !== "string" || !sceneUuid.test(scene.id) || ids.has(scene.id)
      || typeof scene.name !== "string" || !scene.name.trim() || scene.name.length > 40
      || !Array.isArray(scene.steps) || !scene.steps.length || scene.steps.length > sceneMaxSteps) return false;
    ids.add(scene.id);
    const devices = new Set<string>();
    return scene.steps.every((step: SceneStep) => {
      if (!step || typeof step.device !== "string" || !/^[a-f0-9]{24}$/.test(step.device) || devices.has(step.device)
        || !["press", "turnOn", "turnOff", "setPosition", "lock", "unlock"].includes(step.action)) return false;
      devices.add(step.device);
      return step.action === "setPosition" ? Number.isInteger(step.position) && step.position! >= 0 && step.position! <= 100 : step.position === undefined;
    });
  });
}

export function defaultStoreScenes(devices: SceneCatalogDevice[]): StoreScene[] {
  const one = (kind: DeviceKind, match = (_: SceneCatalogDevice) => true) => {
    const found = devices.filter(d => d.kind === kind && sceneActions(d).length && match(d));
    return found.length === 1 ? found[0] : null;
  };
  const indoor = one("indoorLight"), ambient = one("plug", d => /間接|氛围|氛圍|ambient|mood/i.test(d.name)), shade = one("shade"), lock = one("lock");
  if (!indoor || !ambient || !shade || !lock) return [];
  return [{ id: "1efbd558-7d9b-478c-a6bf-213d8d1f08a3", name: "休憩モード", steps: [
    { device: indoor.key, action: "turnOff" }, { device: ambient.key, action: "turnOn" },
    { device: shade.key, action: "setPosition", position: 100 }, { device: lock.key, action: "lock" },
  ] }];
}

/** Called inside the existing device claim, after a fresh reading, immediately before sending. */
export function indoorSceneDecision(sample: DeviceSample, action: DeviceAction): { action: DeviceAction; skip: string } {
  if (sample.botMode !== "pressMode" || (action !== "turnOn" && action !== "turnOff")) return { action, skip: "" };
  const level = sample.lightLevel;
  if (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 20) return { action: "press", skip: "invalid_light_level" };
  if (action === "turnOff") return { action: "press", skip: level >= 10 ? "" : level <= 3 ? "already_in_state" : "light_below_on_range" };
  return { action: "press", skip: level <= 3 ? "" : level >= 10 ? "already_in_state" : "light_ambiguous" };
}

export const sceneReasonLabels: Record<string, string> = {
  already_in_state: "すでに指定状態のため、押していません。",
  light_below_on_range: "明るさが10未満のため、押していません。",
  light_ambiguous: "明るさが判定保留の範囲のため、押していません。",
  invalid_light_level: "明るさを確認できないため、押していません。",
  door_not_closed: "ドアを閉めてから施錠してください。",
  not_calibrated: "SwitchBotアプリで位置を校正してください。",
  lock_unavailable: "ドアとロックの状態を現地で確認してください。",
  device_busy: "直前の操作を処理中です。状態を確認してください。",
  unavailable: "機器の接続と状態を確認してください。",
  interrupted: "実行が中断されました。状態を確認してから再操作してください。",
  not_run: "この操作は送信していません。",
};
