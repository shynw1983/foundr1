import { createHash, randomUUID } from "node:crypto";
import { sql } from "./db";
import { requestStoreDeviceCommand, storeDeviceConfig, StoreDeviceError } from "./store-devices";
import { listStoreSwitchBots } from "./switchbot";
import { deviceCommandSkipped } from "./store-device-state";
import { defaultStoreScenes, sceneActions, sceneUuid, validScenes, type StoreScene, type SceneRun, type SceneStepResult, type SceneView } from "./store-scene-state";

type RunRow = { id: string; store_id: string; scene_id: string; scene_name: string; actor_employee_id: string; status: SceneRun["status"]; steps: SceneStepResult[]; started_at: string | Date; expires_at: string | Date; finished_at: string | Date | null };
const iso = (v: string | Date) => new Date(v).toISOString();
function publicRun(row: RunRow): SceneRun {
  const expired = row.status === "running" && new Date(row.expires_at).getTime() <= Date.now();
  return { id: row.id, sceneId: row.scene_id, name: row.scene_name, status: expired ? "interrupted" : row.status,
    startedAt: iso(row.started_at), expiresAt: iso(row.expires_at), finishedAt: row.finished_at ? iso(row.finished_at) : null,
    steps: row.steps.map(step => (expired || row.status === "interrupted") && (step.status === "waiting" || step.status === "running")
      ? { ...step, status: step.status === "running" ? "unknown" : "not_run", reason: "interrupted" } : step) };
}
async function definitions(storeId: string) {
  const rows = await sql`select settings from module_settings where scope_key=${`store:${storeId}`} and module_key='store_device_scenes' limit 1`;
  const settings = rows[0]?.settings;
  const configured = await storeDeviceConfig(storeId);
  if (!configured) return { configured: null, devices: [], revision: "", scenes: [] as StoreScene[] };
  const devices = await listStoreSwitchBots(configured.config);
  return { configured, devices, revision: typeof settings?.revision === "string" ? settings.revision : "",
    scenes: settings ? validScenes(settings.scenes) ? settings.scenes as StoreScene[] : [] : defaultStoreScenes(devices) };
}
export async function getStoreSceneRun(storeId: string, id?: string): Promise<SceneRun | null> {
  const rows = id ? await sql`select * from store_device_scene_runs where store_id=${storeId}::uuid and id=${id}::uuid`
    : await sql`select * from store_device_scene_runs where store_id=${storeId}::uuid order by started_at desc limit 1`;
  return rows[0] ? publicRun(rows[0] as RunRow) : null;
}
export async function getStoreScenes(storeId: string): Promise<SceneView> {
  const [data, latestRun] = await Promise.all([definitions(storeId), getStoreSceneRun(storeId)]);
  return { storeId, configured: Boolean(data.configured), revision: data.revision, scenes: data.scenes, latestRun };
}
function validateDevices(scenes: StoreScene[], devices: Awaited<ReturnType<typeof listStoreSwitchBots>>) {
  for (const scene of scenes) for (const step of scene.steps) {
    const device = devices.find(d => d.key === step.device);
    if (!device || !sceneActions(device).includes(step.action)) throw new StoreDeviceError("機器または操作が変更されています。シーンを編集してください。", 400);
  }
}
export async function saveStoreScenes(storeId: string, actorId: string, scenes: unknown, expectedRevision: unknown) {
  if (!validScenes(scenes) || typeof expectedRevision !== "string" || (expectedRevision && !sceneUuid.test(expectedRevision))) throw new StoreDeviceError("シーン名と操作内容を確認してください。", 400);
  const data = await definitions(storeId);
  if (!data.configured) throw new StoreDeviceError("この店舗の機器は未設定です。", 409);
  validateDevices(scenes, data.devices);
  const cleaned = scenes.map(scene => ({ id: scene.id, name: scene.name.trim(), steps: scene.steps.map(step => ({ device: step.device, action: step.action, ...(step.action === "setPosition" ? { position: step.position } : {}) })) }));
  const revision = randomUUID(), settings = JSON.stringify({ revision, scenes: cleaned });
  const saved = await sql`with updated as (
    update module_settings set settings=module_settings.settings || ${settings}::jsonb, updated_by=${actorId}::uuid, updated_at=now()
    where scope_key=${`store:${storeId}`} and module_key='store_device_scenes' and coalesce(settings->>'revision','')=${expectedRevision}
    returning settings
  ), inserted as (
    insert into module_settings(scope_key,module_key,settings,updated_by,updated_at)
    select ${`store:${storeId}`},'store_device_scenes',${settings}::jsonb,${actorId}::uuid,now()
    where ${expectedRevision}='' and not exists(select 1 from module_settings where scope_key=${`store:${storeId}`} and module_key='store_device_scenes')
    on conflict do nothing returning settings
  ) select settings from updated union all select settings from inserted`;
  if (!saved.length) throw new StoreDeviceError("別の端末でシーンが変更されました。再読込してください。", 409);
  return { scenes: cleaned, revision };
}

export async function createStoreSceneRun(storeId: string, actorId: string, sceneId: string, requestId: string, revision: string, allowUnlock: boolean) {
  const existing = await getStoreSceneRun(storeId, requestId);
  if (existing) {
    if (existing.sceneId !== sceneId) throw new StoreDeviceError("操作番号が一致しません。", 409);
    return { run: existing, created: false };
  }
  const data = await definitions(storeId);
  if (!data.configured?.config.controlEnabled) throw new StoreDeviceError("機器の操作はまだ有効になっていません。", 409);
  if (revision !== data.revision) throw new StoreDeviceError("別の端末でシーンが変更されました。再読込してください。", 409);
  const scene = data.scenes.find(s => s.id === sceneId);
  if (!scene) throw new StoreDeviceError("シーンが見つかりません。再読込してください。", 404);
  validateDevices([scene], data.devices);
  if (scene.steps.some(step => step.action === "unlock") && !allowUnlock) throw new StoreDeviceError("解錠する操作を確認してください。", 400);
  const steps: SceneStepResult[] = scene.steps.map(step => ({ ...step, name: data.devices.find(d => d.key === step.device)!.name, status: "waiting", reason: "" }));
  // Expired runs are never resumed: a lost response may still mean a switch was pressed.
  await sql`update store_device_scene_runs set status='interrupted',finished_at=now() where store_id=${storeId}::uuid and status='running' and expires_at<=now()`;
  const rows = await sql`insert into store_device_scene_runs(id,store_id,scene_id,scene_name,actor_employee_id,steps)
    values(${requestId}::uuid,${storeId}::uuid,${sceneId}::uuid,${scene.name},${actorId}::uuid,${JSON.stringify(steps)}::jsonb)
    on conflict do nothing returning *`;
  if (rows[0]) return { run: publicRun(rows[0] as RunRow), created: true };
  const duplicate = await getStoreSceneRun(storeId, requestId);
  if (duplicate?.sceneId === sceneId) return { run: duplicate, created: false };
  throw new StoreDeviceError("シーンを実行中です。完了後に操作してください。", 409);
}

export async function executeStoreSceneRun(storeId: string, id: string) {
  const token = randomUUID();
  const claimed = await sql`update store_device_scene_runs set worker_token=${token}::uuid
    where id=${id}::uuid and store_id=${storeId}::uuid and status='running' and worker_token is null and expires_at>now() returning *`;
  if (!claimed[0]) return;
  const row = claimed[0] as RunRow, steps = row.steps;
  const deadline = new Date(row.expires_at).getTime() - 30_000;
  let interrupted = false;
  for (let index = 0; index < steps.length; index++) {
    if (Date.now() >= deadline) { interrupted = true; break; }
    const step = steps[index];
    const hex = createHash("sha256").update(`store-scene:${id}:${index}`).digest("hex");
    const commandId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
    steps[index] = { ...step, commandId, status: "running" };
    const alive = await sql`update store_device_scene_runs set steps=${JSON.stringify(steps)}::jsonb
      where id=${id}::uuid and worker_token=${token}::uuid and status='running' and expires_at>now() returning id`;
    if (!alive.length) return;
    try {
      const { command } = await requestStoreDeviceCommand(storeId, row.actor_employee_id, step.device, commandId, step.action, step.action === "setPosition" ? String(step.position) : "default", id);
      steps[index] = { ...steps[index], status: command.result === "accepted" ? deviceCommandSkipped(command) ? "skipped" : "sent" : command.result === "rejected" ? "failed" : "unknown", reason: command.reason };
    } catch (error) {
      // A transport/DB error may happen after the command; never retry automatically.
      steps[index] = { ...steps[index], status: error instanceof StoreDeviceError ? "failed" : "unknown", reason: error instanceof StoreDeviceError && error.status === 409 ? "device_busy" : "unavailable" };
    }
    await sql`update store_device_scene_runs set steps=${JSON.stringify(steps)}::jsonb where id=${id}::uuid and worker_token=${token}::uuid and status='running'`;
  }
  const finalSteps = steps.map(step => step.status === "waiting" ? { ...step, status: "not_run", reason: "not_run" } : step);
  await sql`update store_device_scene_runs set steps=${JSON.stringify(finalSteps)}::jsonb, status=${interrupted ? "interrupted" : "finished"},finished_at=now()
    where id=${id}::uuid and worker_token=${token}::uuid and status='running'`;
}
