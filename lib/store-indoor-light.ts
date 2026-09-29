import { randomUUID } from "node:crypto";
import { sql } from "./db";
import { estimateIndoorLight, lightCommandCooldownMs, type IndoorLightView, type LightCommand, type LightSample } from "./store-light-state";
import { indoorLightConfig, readIndoorLight, pressIndoorLight, SwitchBotError, type IndoorLightConfig } from "./switchbot";

type RuntimeRow = {
  sample: LightSample | null;
  fetched_at: string | null;
  read_error: boolean;
  blocked_until: string | null;
};
type CommandRow = { id: string; result: LightCommand["result"]; requested_at: string; finished_at: string | null; before_state: LightCommand["beforeState"]; reason: string };

function iso(value: string | Date | null) { return value ? new Date(value).toISOString() : null; }
function publicCommand(row?: CommandRow): LightCommand | null {
  if (!row) return null;
  return {
    id: row.id,
    result: row.result === "pending" && Date.now() - Date.parse(row.requested_at) >= lightCommandCooldownMs ? "unknown" : row.result,
    requestedAt: iso(row.requested_at)!, finishedAt: iso(row.finished_at), beforeState: row.before_state, reason: row.reason
  };
}
async function ensureRuntime(config: IndoorLightConfig) {
  await sql`insert into store_light_runtime(store_id, device_id) values(${config.storeId}::uuid, ${config.botId}) on conflict do nothing`;
}
async function latestCommand(config: IndoorLightConfig) {
  const rows = await sql`select id::text, result, requested_at, finished_at, before_state, reason from store_light_commands where store_id=${config.storeId}::uuid and device_id=${config.botId} order by requested_at desc limit 1`;
  return publicCommand(rows[0] as CommandRow | undefined);
}

export async function getIndoorLight(storeId: string): Promise<IndoorLightView> {
  const config = indoorLightConfig(storeId);
  const empty: IndoorLightView = { configured: false, storeId, sample: null, fetchedAt: null, estimate: "unknown", readError: false, canPress: false, controlEnabled: false, blockedUntil: null, command: null, offMax: 3, onMin: 10 };
  if (!config) return empty;
  await ensureRuntime(config);
  const refreshToken = randomUUID();
  // Shared across browser tabs and serverless instances. A crashed reader expires
  // after 30 seconds; successful reads are cached for 60 seconds (5 after a press).
  const claimed = await sql`update store_light_runtime set refresh_token=${refreshToken}::uuid, refresh_after=now()+interval '30 seconds'
    where store_id=${storeId}::uuid and device_id=${config.botId} and refresh_after <= now() returning device_id`;
  if (claimed.length) {
    try {
      const sample = await readIndoorLight(config);
      await sql`update store_light_runtime set sample=${JSON.stringify(sample)}::jsonb, fetched_at=now(), read_error=false,
        refresh_after=now()+case when blocked_until>now() then interval '5 seconds' else interval '60 seconds' end
        where store_id=${storeId}::uuid and device_id=${config.botId} and refresh_token=${refreshToken}::uuid`;
    } catch {
      await sql`update store_light_runtime set read_error=true, refresh_after=now()+interval '30 seconds'
        where store_id=${storeId}::uuid and device_id=${config.botId} and refresh_token=${refreshToken}::uuid`;
    }
  }
  const [rows, command] = await Promise.all([
    sql`select sample, fetched_at, read_error, blocked_until from store_light_runtime where store_id=${storeId}::uuid and device_id=${config.botId}`,
    latestCommand(config)
  ]);
  const row = rows[0] as RuntimeRow;
  const fetchedAt = iso(row.fetched_at);
  const responseTime = command ? (command.finishedAt ? Date.parse(command.finishedAt) : Date.parse(command.requestedAt) + lightCommandCooldownMs) : 0;
  const beforePress = command && command.result !== "rejected" && (!fetchedAt || Date.parse(fetchedAt) < responseTime + 5_000);
  const estimate = row.read_error || beforePress ? "unknown" : estimateIndoorLight(row.sample?.lightLevel, fetchedAt);
  return {
    ...empty, configured: true, sample: row.sample, fetchedAt, estimate, readError: row.read_error,
    controlEnabled: config.controlEnabled,
    canPress: config.controlEnabled && !row.read_error && Boolean(fetchedAt) && Date.now()-Date.parse(fetchedAt!) <= 120_000 && row.sample?.botMode === "pressMode" && (!row.blocked_until || Date.parse(row.blocked_until) <= Date.now()),
    blockedUntil: iso(row.blocked_until), command
  };
}

export class IndoorLightError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function requestIndoorLightPress(storeId: string, actorId: string, requestId: string): Promise<LightCommand> {
  const config = indoorLightConfig(storeId);
  if (!config || !config.controlEnabled) throw new IndoorLightError("照明の操作はまだ有効になっていません。", 409);
  const previous = await sql`select id::text, store_id::text, device_id, result, requested_at, finished_at, before_state, reason from store_light_commands where id=${requestId}::uuid`;
  if (previous[0]) {
    if (previous[0].store_id !== storeId || previous[0].device_id !== config.botId) throw new IndoorLightError("操作番号が一致しません。", 409);
    return publicCommand(previous[0] as CommandRow)!;
  }
  await ensureRuntime(config);
  // One atomic claim. No HTTP request is made unless this durable record exists.
  // The row lock serializes *different* request IDs for the same physical Bot.
  const claimed = await sql`with device_claim as (
    update store_light_runtime set blocked_until=now()+interval '90 seconds'
    where store_id=${storeId}::uuid and device_id=${config.botId} and (blocked_until is null or blocked_until<=now())
      and not exists(select 1 from store_light_commands where id=${requestId}::uuid)
    returning store_id, device_id
  ) insert into store_light_commands(id,store_id,device_id,actor_employee_id,result)
    select ${requestId}::uuid,store_id,device_id,${actorId}::uuid,'pending' from device_claim
    on conflict(id) do nothing returning id`;
  if (!claimed.length) {
    const duplicate = await sql`select id::text, result, requested_at, finished_at, before_state, reason from store_light_commands where id=${requestId}::uuid and store_id=${storeId}::uuid and device_id=${config.botId}`;
    if (duplicate[0]) return publicCommand(duplicate[0] as CommandRow)!;
    throw new IndoorLightError("直前の操作を確認中です。時間をおいて状態を更新してください。", 409);
  }
  let result: LightCommand["result"] = "rejected";
  let reason = "preflight_failed";
  let attempted = false;
  try {
    const sample = await readIndoorLight(config);
    if (sample.botMode !== "pressMode") throw new SwitchBotError("unsupported_mode");
    const beforeState = estimateIndoorLight(sample.lightLevel, new Date().toISOString());
    await sql`update store_light_commands set before_state=${beforeState}, before_level=${sample.lightLevel} where id=${requestId}::uuid`;
    attempted = true;
    await pressIndoorLight(config);
    result = "accepted";
    reason = "";
  } catch (error) {
    result = attempted && (!(error instanceof SwitchBotError) || error.uncertain) ? "unknown" : "rejected";
    reason = error instanceof SwitchBotError ? error.code : "unavailable";
  }
  // If this persistence fails after a press, the original pending record remains:
  // retries with the same ID still cannot send another physical command.
  const rows = await sql`update store_light_commands set result=${result}, reason=${reason}, finished_at=now()
    where id=${requestId}::uuid returning id::text,result,requested_at,finished_at,before_state,reason`;
  await sql`update store_light_runtime set refresh_after=now()+interval '5 seconds', refresh_token=null
    where store_id=${storeId}::uuid and device_id=${config.botId}`;
  return publicCommand(rows[0] as CommandRow)!;
}
