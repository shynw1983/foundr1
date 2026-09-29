import { sql } from "./db";
import { estimateIndoorLight } from "./store-light-state";
import { deviceCommandLeaseMs, deviceCooldownMs, type DeviceAction, type DeviceCommand, type DeviceSample, type StoreDevice, type StoreDevicesView } from "./store-device-state";
import { deviceActions, indoorLightConfig, listStoreSwitchBots, readRawStatus, readStoreDevice, sendStoreDeviceCommand, SwitchBotError, validateDeviceAction } from "./switchbot";

export class StoreDeviceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
type CommandRow = { id: string; store_id?: string; device_id?: string; command: DeviceAction; parameter: string; result: DeviceCommand["result"]; before_sample: DeviceSample | null; reason: string; requested_at: string; finished_at: string | null };
const iso = (v: string | Date | null | undefined) => v ? new Date(v).toISOString() : null;
function publicCommand(row: CommandRow | null | undefined): DeviceCommand | null {
  if (!row) return null;
  return { id: row.id, action: row.command, parameter: row.parameter, result: row.result === "pending" && Date.now() - Date.parse(row.requested_at) >= deviceCommandLeaseMs ? "unknown" : row.result, before: row.before_sample, reason: row.reason, requestedAt: iso(row.requested_at)!, finishedAt: iso(row.finished_at) };
}
const priority = { indoorLight: 0, plug: 1, bot: 2, shade: 3, lock: 4, hub: 5, meter: 6, keypad: 7, remote: 8, unsupported: 9 };
async function storeDeviceConfig(storeId: string) {
  const config = indoorLightConfig(storeId);
  if (!config) return null;
  const rows = await sql`select settings from module_settings where scope_key=${`store:${storeId}`} and module_key='store_devices' limit 1`;
  const settings = rows[0]?.settings || {};
  const strings = (value: unknown, pattern: RegExp): string[] => Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && pattern.test(v)))].slice(0, 128) : [];
  return { config: { ...config, directDeviceIds: strings(settings.directDeviceIds, /^[A-F0-9]{12}$/) }, order: strings(settings.deviceOrder, /^[a-f0-9]{24}$/) };
}

export async function saveStoreDeviceOrder(storeId: string, actorId: string, order: unknown) {
  const configured = await storeDeviceConfig(storeId);
  if (!configured) throw new StoreDeviceError("この店舗の機器は未設定です。", 409);
  if (!Array.isArray(order) || order.length > 128 || order.some(key => typeof key !== "string" || !/^[a-f0-9]{24}$/.test(key)) || new Set(order).size !== order.length) throw new StoreDeviceError("機器の並び順を確認してください。", 400);
  const devices = await listStoreSwitchBots(configured.config);
  if (order.some(key => !devices.some(device => device.key === key))) throw new StoreDeviceError("機器の一覧が変わりました。更新してから並び替えてください。", 400);
  await sql`insert into module_settings(scope_key,module_key,settings,updated_by,updated_at)
    values(${`store:${storeId}`},'store_devices',${JSON.stringify({ deviceOrder: order })}::jsonb,${actorId}::uuid,now())
    on conflict(scope_key,module_key) do update set settings=module_settings.settings || excluded.settings,updated_by=excluded.updated_by,updated_at=now()`;
  return { order: order as string[] };
}

export async function getStoreDevices(storeId: string, key?: string): Promise<StoreDevicesView> {
  const configured = await storeDeviceConfig(storeId);
  if (!configured) return { configured: false, storeId, devices: [] };
  const { config, order } = configured;
  let devices = await listStoreSwitchBots(config);
  if (key) {
    devices = devices.filter(d => d.key === key);
    if (!devices.length) throw new StoreDeviceError("この店舗の機器が見つかりません。", 404);
  }
  const ranks = new Map(order.map((key, index) => [key, index]));
  devices.sort((a, b) => (ranks.get(a.key) ?? order.length) - (ranks.get(b.key) ?? order.length) || priority[a.kind] - priority[b.kind] || a.name.localeCompare(b.name));
  // Status reads do not create/update rows or persist sensor samples.
  const runtime = await sql`select r.device_id, r.blocked_until, row_to_json(c) as command
    from store_light_runtime r left join lateral (
      select id::text, command, parameter, result, before_sample, reason, requested_at, finished_at
      from store_light_commands where store_id=r.store_id and device_id=r.device_id order by requested_at desc limit 1
    ) c on true where r.store_id=${storeId}::uuid`;
  const hub = devices.some(d => d.kind === "indoorLight" || d.id === config.hubId) ? readRawStatus(config, config.hubId) : undefined;
  void hub?.catch(() => {});
  const views: StoreDevice[] = [];
  for (let i = 0; i < devices.length; i += 3) {
    views.push(...await Promise.all(devices.slice(i, i + 3).map(async device => {
      let sample: DeviceSample | null = null, fetchedAt: string | null = null, issue = "";
      if (device.kind === "remote" || device.kind === "unsupported") issue = "status_unsupported";
      else {
        try { sample = await readStoreDevice(config, device, hub); fetchedAt = new Date().toISOString(); }
        catch (error) { issue = error instanceof SwitchBotError ? error.code : "unavailable"; }
      }
      const row = runtime.find(r => r.device_id === device.id);
      return { key: device.key, name: device.name, type: device.type, kind: device.kind, actions: deviceActions(device, sample), sample, fetchedAt, readError: Boolean(issue), issue, controlEnabled: config.controlEnabled, blockedUntil: iso(row?.blocked_until as string | null), command: publicCommand(row?.command as CommandRow | null) };
    })));
  }
  return { configured: true, storeId, devices: views };
}

export async function requestStoreDeviceCommand(storeId: string, actorId: string, key: string, requestId: string, action: DeviceAction, parameter: string) {
  const config = (await storeDeviceConfig(storeId))?.config;
  if (!config || !config.controlEnabled) throw new StoreDeviceError("機器の操作はまだ有効になっていません。", 409);
  const device = (await listStoreSwitchBots(config)).find(d => d.key === key);
  if (!device) throw new StoreDeviceError("この店舗の機器が見つかりません。", 404);
  if (!["press", "turnOn", "turnOff", "setPosition", "lock", "unlock", "deadbolt"].includes(action) ||
      (action === "setPosition" ? device.kind !== "shade" || !/^(100|[1-9]?\d)$/.test(parameter) : parameter !== "default") ||
      !deviceActions(device, action === "turnOn" || action === "turnOff" ? { botMode: "switchMode" } : null).includes(action)) throw new StoreDeviceError("この機器では実行できない操作です。", 400);
  const previous = await sql`select * from store_light_commands where id=${requestId}::uuid`;
  if (previous[0]) {
    const row = previous[0] as CommandRow;
    if (row.store_id !== storeId || row.device_id !== device.id || row.command !== action || row.parameter !== parameter) throw new StoreDeviceError("操作番号が一致しません。", 409);
    return { command: publicCommand(row)!, blockedUntil: new Date(Date.parse(row.finished_at || row.requested_at) + (row.finished_at ? deviceCooldownMs : deviceCommandLeaseMs)).toISOString() };
  }
  await sql`insert into store_light_runtime(store_id,device_id) values(${storeId}::uuid,${device.id}) on conflict do nothing`;
  // A bounded in-flight lease prevents slow requests from overlapping a send.
  // Normal completion replaces it with the requested 10-second cooldown.
  const claimed = await sql`with device_claim as (
    update store_light_runtime set blocked_until=now()+interval '60 seconds'
    where store_id=${storeId}::uuid and device_id=${device.id} and (blocked_until is null or blocked_until<=now())
      and not exists(select 1 from store_light_commands where id=${requestId}::uuid)
    returning store_id,device_id
  ) insert into store_light_commands(id,store_id,device_id,actor_employee_id,result,command,parameter)
    select ${requestId}::uuid,store_id,device_id,${actorId}::uuid,'pending',${action},${parameter} from device_claim
    on conflict(id) do nothing returning id`;
  if (!claimed.length) throw new StoreDeviceError("直前の操作を処理中です。状態を更新してから再度お試しください。", 409);
  let result: DeviceCommand["result"] = "rejected", reason = "preflight_failed", attempted = false;
  try {
    const sample = await readStoreDevice(config, device);
    validateDeviceAction(device, sample, action, parameter);
    const beforeState = device.kind === "indoorLight" ? estimateIndoorLight(sample.lightLevel, new Date().toISOString()) : "unknown";
    await sql`update store_light_commands set before_sample=${JSON.stringify(sample)}::jsonb, before_state=${beforeState}, before_level=${sample.lightLevel ?? null} where id=${requestId}::uuid`;
    attempted = true;
    await sendStoreDeviceCommand(config, device, action, parameter);
    result = "accepted"; reason = "";
  } catch (error) {
    result = attempted && (!(error instanceof SwitchBotError) || error.uncertain) ? "unknown" : "rejected";
    reason = error instanceof SwitchBotError ? error.code : "unavailable";
  }
  console.info("store_device_command_result", { storeId, deviceKey: key, kind: device.kind, requestId, action, parameter, attempted, result, reason });
  const rows = await sql`with completed as (
    update store_light_commands set result=${result},reason=${reason},finished_at=now() where id=${requestId}::uuid returning *
  ), released as (
    update store_light_runtime set blocked_until=now()+interval '10 seconds',refresh_after=now(),refresh_token=null
    where store_id=${storeId}::uuid and device_id=${device.id} returning blocked_until
  ) select completed.*, released.blocked_until from completed cross join released`;
  return { command: publicCommand(rows[0] as CommandRow)!, blockedUntil: iso(rows[0].blocked_until as string)! };
}
