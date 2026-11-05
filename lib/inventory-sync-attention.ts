import { inventorySyncCurrentBusinessDaySql } from "./inventory-sync-business-day.ts";

export const INVENTORY_SYNC_OVERDUE_MINUTES = 5;

export type InventorySyncCommand = {
  id: string; storeId: string; storeName: string; platform: string; status: string;
  payload: Record<string, unknown>; result: Record<string, unknown>; lastError: string; attempts: number;
  createdAt: string; updatedAt: string; needsAttention: boolean; overdue: boolean;
  attentionKey: string; canRetry: boolean; targetLabels: string[];
  retryBlockedReason?: string;
};

const targetsSql = (alias: string) => `case when jsonb_typeof(${alias}.payload->'targets') = 'array'
  then ${alias}.payload->'targets' else '[]'::jsonb end`;
const runSql = (alias: string) => `coalesce(nullif(btrim(${alias}.payload->>'syncRunId'), ''), nullif(btrim(${alias}.payload->>'fullSyncRunId'), ''))`;

// Names and linkage keys are never identities. Missing identities are retained
// for attention, while only exact store/platform/kind/target IDs are replaced.
// Qualify JSON scalar columns: stores.external_id is text in the production query.
function projectionSql(alias: string) {
  return `select
    coalesce(jsonb_agg(old_target order by position) filter (where not replaced), '[]'::jsonb) as remaining,
    coalesce(jsonb_agg(old_target order by position) filter (where replaced), '[]'::jsonb) as removed,
    coalesce(bool_and(coalesce(old_target->>'kind' in ('item', 'option')
      and coalesce(btrim(old_target->>'targetId'), '') <> ''
      and jsonb_typeof(old_target->'knownExternalIds') = 'array'
      and jsonb_array_length(case when jsonb_typeof(old_target->'knownExternalIds') = 'array'
        then old_target->'knownExternalIds' else '[]'::jsonb end) > 0
      and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(old_target->'knownExternalIds') = 'array'
        then old_target->'knownExternalIds' else '[]'::jsonb end) known_ids(native_id)
        where jsonb_typeof(known_ids.native_id) <> 'string' or coalesce(btrim(known_ids.native_id#>>'{}'), '') = ''), false))
      filter (where not replaced), false) as identified
  from (
    select old_target, position, exists (
      select 1 from local_bridge_commands newer
      cross join lateral jsonb_array_elements(${targetsSql('newer')}) newer_target
      where newer.store_id = ${alias}.store_id and newer.platform = ${alias}.platform
        and newer.command_type = 'set_inventory_availability'
        and newer.status in ('pending', 'processing', 'succeeded', 'failed')
        and newer.created_at > ${alias}.created_at
        and ${runSql(alias)} is not null and ${runSql('newer')} is not null
        and ${runSql('newer')} <> ${runSql(alias)}
        and old_target->>'kind' in ('item', 'option')
        and coalesce(btrim(old_target->>'targetId'), '') <> ''
        and newer_target->>'kind' = old_target->>'kind'
        and newer_target->>'targetId' = old_target->>'targetId'
    ) as replaced
    from jsonb_array_elements(${targetsSql(alias)}) with ordinality targets(old_target, position)
  ) compared`;
}

function retryEligibleSql(alias: string) {
  return `${alias}.status = 'failed' and parts.identified and jsonb_array_length(parts.remaining) > 0
    and ${alias}.platform in ('uber_eats', 'rocket_now', 'demae_can')
    and ${runSql(alias)} is not null and jsonb_typeof(${alias}.payload->'isAvailable') = 'boolean'
    and coalesce(${alias}.payload->>'mappingBlocked', 'false') <> 'true'
    and (${alias}.platform <> 'demae_can' or ${alias}.payload->>'isAvailable' <> 'true'
      or nullif(${alias}.payload->>'fullSyncRunId', '') is not null or ${alias}.payload->>'manualItemRelease' = 'true')
    and not exists (
      select 1 from local_bridge_commands reading where reading.store_id = ${alias}.store_id
        and reading.command_type = 'audit_inventory' and reading.payload->>'availabilityAuthority' = 'uber_eats'
        and reading.status in ('pending', 'processing')
    )
    and not exists (
      select 1 from local_bridge_commands contender
      cross join lateral jsonb_array_elements(${targetsSql('contender')}) contender_target
      cross join lateral jsonb_array_elements(parts.remaining) remaining_target
      where contender.store_id = ${alias}.store_id and contender.platform = ${alias}.platform
        and contender.command_type = 'set_inventory_availability' and contender.id <> ${alias}.id
        and contender.status in ('pending', 'processing', 'succeeded', 'failed')
        and contender.created_at >= ${alias}.created_at
        and (${runSql('contender')} is null or ${runSql('contender')} <> ${runSql(alias)})
        and contender_target->>'kind' = remaining_target->>'kind'
        and contender_target->>'targetId' = remaining_target->>'targetId'
    )`;
}

// $1: authorized store ID, or NULL for a server-only scan. Active and failed
// candidate operations belong to the current store business day. Keep all
// historical source commands for supersession, then compare each exact
// identity with its latest two distinct runs. Same-run siblings never supersede
// each other; a null run can block retry but cannot resolve an old failure.
// The query never changes state or replays work.
function inventorySyncProjectionSql(commandParameter?: "$7") {
  const candidateFilter = commandParameter ? `and c.id::text = ${commandParameter}` : "";
  return `
  with source_commands as materialized (
    select c.*, ${runSql('c')} as run_id
    from local_bridge_commands c
    where ($1::text is null or c.store_id::text = $1)
      and c.command_type = 'set_inventory_availability'
      and c.status in ('failed', 'pending', 'processing', 'succeeded')
  ), candidate_commands as materialized (
    select c.* from source_commands c
    join stores scope_store on scope_store.id = c.store_id
    where ${inventorySyncCurrentBusinessDaySql('c', 'scope_store')}
      and (c.status in ('failed', 'pending', 'processing')
      or (c.status = 'succeeded' and c.created_at > now() - interval '30 minutes'))
      ${candidateFilter}
  ), command_targets as materialized (
    select c.id as command_id, c.store_id, c.platform, c.created_at, c.run_id,
      targets.target_data, targets.position,
      targets.target_data->>'kind' as target_kind, targets.target_data->>'targetId' as target_id
    from source_commands c
    cross join lateral jsonb_array_elements(${targetsSql('c')}) with ordinality targets(target_data, position)
  ), intent_runs as (
    select t.store_id, t.platform, t.target_kind, t.target_id, t.run_id, max(t.created_at) as latest_at
    from command_targets t
    where t.run_id is not null and t.target_kind in ('item', 'option') and coalesce(btrim(t.target_id), '') <> ''
    group by t.store_id, t.platform, t.target_kind, t.target_id, t.run_id
  ), ranked_intents as (
    select r.*, row_number() over (
      partition by r.store_id, r.platform, r.target_kind, r.target_id order by r.latest_at desc, r.run_id
    ) as position from intent_runs r
  ), intent_heads as materialized (
    select r.store_id, r.platform, r.target_kind, r.target_id,
      max(r.run_id) filter (where r.position = 1) as first_run,
      max(r.latest_at) filter (where r.position = 1) as first_at,
      max(r.latest_at) filter (where r.position = 2) as second_at
    from ranked_intents r where r.position <= 2
    group by r.store_id, r.platform, r.target_kind, r.target_id
  ), null_intents as materialized (
    select t.store_id, t.platform, t.target_kind, t.target_id, max(t.created_at) as latest_at
    from command_targets t
    where t.run_id is null and t.target_kind in ('item', 'option') and coalesce(btrim(t.target_id), '') <> ''
    group by t.store_id, t.platform, t.target_kind, t.target_id
  ), busy_stores as materialized (
    select distinct c.store_id from local_bridge_commands c
    where ($1::text is null or c.store_id::text = $1)
      and c.command_type = 'audit_inventory' and c.payload->>'availabilityAuthority' = 'uber_eats'
      and c.status in ('pending', 'processing')
  ), candidate_targets as (
    select t.*, case when h.first_run <> t.run_id then h.first_at else h.second_at end as other_run_at,
      n.latest_at as null_run_at
    from command_targets t join candidate_commands c on c.id = t.command_id
    left join intent_heads h on h.store_id = t.store_id and h.platform = t.platform
      and h.target_kind = t.target_kind and h.target_id = t.target_id
    left join null_intents n on n.store_id = t.store_id and n.platform = t.platform
      and n.target_kind = t.target_kind and n.target_id = t.target_id
  ), target_facts as (
    select t.*,
      coalesce(t.run_id is not null and t.other_run_at > t.created_at, false) as replaced,
      coalesce(t.other_run_at >= t.created_at or t.null_run_at >= t.created_at, false) as retry_conflict
    from candidate_targets t
  ), parts_by_command as materialized (
    select t.command_id,
      coalesce(jsonb_agg(t.target_data order by t.position) filter (where not t.replaced), '[]'::jsonb) as remaining,
      coalesce(bool_and(coalesce(t.target_kind in ('item', 'option') and coalesce(btrim(t.target_id), '') <> ''
        and jsonb_typeof(t.target_data->'knownExternalIds') = 'array'
        and jsonb_array_length(case when jsonb_typeof(t.target_data->'knownExternalIds') = 'array'
          then t.target_data->'knownExternalIds' else '[]'::jsonb end) > 0
        and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(t.target_data->'knownExternalIds') = 'array'
          then t.target_data->'knownExternalIds' else '[]'::jsonb end) known_ids(native_id)
          where jsonb_typeof(known_ids.native_id) <> 'string' or coalesce(btrim(known_ids.native_id#>>'{}'), '') = ''), false))
        filter (where not t.replaced), false) as identified,
      coalesce(bool_or(t.retry_conflict) filter (where not t.replaced), false) as retry_conflict
    from target_facts t group by t.command_id
  ), projected as materialized (
    select c.id::text, c.store_id::text as "storeId", coalesce(s.name, '') as "storeName", c.platform, c.status,
      coalesce(c.payload, '{}'::jsonb) || jsonb_build_object('targets', coalesce(parts.remaining, '[]'::jsonb)) as payload,
      coalesce(c.result, '{}'::jsonb) as result, coalesce(c.last_error, '') as "lastError", c.attempts,
      c.created_at::text as "createdAt", c.updated_at::text as "updatedAt", c.created_at as created_at,
      (c.status in ('pending', 'processing') and c.created_at < now() - interval '${INVENTORY_SYNC_OVERDUE_MINUTES} minutes') as overdue,
      (c.status = 'failed' or (c.status in ('pending', 'processing') and (
        c.created_at < now() - interval '${INVENTORY_SYNC_OVERDUE_MINUTES} minutes' or coalesce(c.payload ? 'manualRetryAt', false)
      ))) as "needsAttention",
      ('inventory-sync:' || c.id::text) as "attentionKey",
      coalesce((c.status = 'failed' and parts.identified and jsonb_array_length(parts.remaining) > 0
        and c.platform in ('uber_eats', 'rocket_now', 'demae_can') and c.run_id is not null
        and jsonb_typeof(c.payload->'isAvailable') = 'boolean' and coalesce(c.payload->>'mappingBlocked', 'false') <> 'true'
        and (c.platform <> 'demae_can' or c.payload->>'isAvailable' <> 'true'
          or nullif(c.payload->>'fullSyncRunId', '') is not null or c.payload->>'manualItemRelease' = 'true')
        and busy.store_id is null and not parts.retry_conflict), false) as "canRetry",
      coalesce(c.run_id, 'command:' || c.id::text) as run_id
    from candidate_commands c left join stores s on s.id = c.store_id
    left join parts_by_command parts on parts.command_id = c.id
    left join busy_stores busy on busy.store_id = c.store_id
    where (c.status in ('failed', 'pending', 'processing')
        or (c.status = 'succeeded' and c.created_at > now() - interval '30 minutes'))
      and (jsonb_array_length(coalesce(parts.remaining, '[]'::jsonb)) > 0 or jsonb_array_length(${targetsSql('c')}) = 0)
  ), recent_success_runs as (
    select "storeId", run_id,
      row_number() over (partition by "storeId" order by max(created_at) desc, run_id) as position
    from projected group by "storeId", run_id having bool_and(status = 'succeeded')
  )
  select p.id, p."storeId", p."storeName", p.platform, p.status, p.payload, p.result, p."lastError", p.attempts,
    p."createdAt", p."updatedAt", p.overdue, p."needsAttention", p."attentionKey", p."canRetry"
  from projected p
  where p.status in ('failed', 'pending', 'processing')
    or exists (select 1 from projected active where active."storeId" = p."storeId" and active.run_id = p.run_id
      and active.status in ('failed', 'pending', 'processing'))
    or exists (select 1 from recent_success_runs recent where recent."storeId" = p."storeId"
      and recent.run_id = p.run_id and recent.position <= 4)
  order by p."needsAttention" desc, p.created_at desc, p.id
`;
}

export const inventorySyncCommandsSql = inventorySyncProjectionSql();
// Notification INSERT/claim parameter $7 is the captured command ID. Filter
// candidates before target facts and aggregation, while retaining all history
// for exact-target supersession. A surrounding WHERE cannot push through the
// multiply-referenced materialized projection by itself.
export const inventorySyncCommandRecheckSql = inventorySyncProjectionSql("$7");

// Run under withInventoryOperationLock. Recheck identities in the UPDATE;
// record replaced targets and replay only the still-current identified targets.
// manualRetryAt renews only the Bridge execution TTL; created_at remains the
// original inventory intent for supersession and business-day membership.
export const retryInventorySyncCommandSql = `
  with target as materialized (
    select * from local_bridge_commands where id::text = $1 and store_id::text = $2
      and command_type = 'set_inventory_availability' and status = 'failed' for update
  ), eligible as (
    select target.id, parts.remaining, parts.removed from target
    cross join lateral (${projectionSql('target')}) parts where ${retryEligibleSql('target')}
  )
  update local_bridge_commands c set status = 'pending', attempts = 0, available_at = now(),
    claimed_by_device_id = null, claimed_at = null, claim_expires_at = null, completed_at = null,
    payload = c.payload || jsonb_build_object('manualRetryAt', now(), 'targets', eligible.remaining,
      'supersededTargets', coalesce(c.payload->'supersededTargets', '[]'::jsonb) || eligible.removed),
    result = $3::jsonb, last_error = '', updated_at = now()
  from eligible where c.id = eligible.id and c.status = 'failed'
  returning c.id::text, c.platform
`;

export function inventorySyncTargetLabels(row: Pick<InventorySyncCommand, 'payload'>) {
  const targets = Array.isArray(row.payload.targets) ? row.payload.targets : [];
  const labels = targets.map(target => target && typeof target === 'object'
    ? String(target.label || target.targetId || '').trim() : '').filter(Boolean);
  // Same names can describe different IDs. Labels never deduplicate targets.
  return labels.length ? labels : [String(row.payload.feedbackLabel || row.payload.ingredientLabel || '').trim()].filter(Boolean);
}

export function inventorySyncRetryBlockedReason(row: Pick<InventorySyncCommand, 'status' | 'payload' | 'platform' | 'canRetry'>) {
  if (row.canRetry) return '';
  if (row.status !== 'failed') return ['pending', 'processing'].includes(row.status) ? 'still_running' : '';
  const payload = row.payload;
  const targets = Array.isArray(payload.targets) ? payload.targets : [];
  if (!(payload.syncRunId || payload.fullSyncRunId) || typeof payload.isAvailable !== 'boolean' || !targets.length || targets.some(target =>
    !target || !['item', 'option'].includes(target.kind) || !String(target.targetId || '').trim() ||
    !Array.isArray(target.knownExternalIds) || !target.knownExternalIds.length || target.knownExternalIds.some((id: unknown) => typeof id !== 'string' || !id.trim()))) {
    return 'identity_unverified';
  }
  if (payload.mappingBlocked === true || payload.mappingBlocked === 'true') return 'mapping_unverified';
  if (!['uber_eats', 'rocket_now', 'demae_can'].includes(row.platform)) return 'unsupported_platform';
  if (row.platform === 'demae_can' && payload.isAvailable && !payload.fullSyncRunId && payload.manualItemRelease !== true) return 'stale_demae_release';
  return 'operation_in_progress';
}

export async function getInventorySyncCommands(storeId?: string): Promise<InventorySyncCommand[]> {
  const { sql } = await import('./db');
  const rows = await sql.query(inventorySyncCommandsSql, [storeId ?? null]) as Omit<InventorySyncCommand, 'targetLabels'>[];
  return rows.map(row => ({ ...row, targetLabels: inventorySyncTargetLabels(row), retryBlockedReason: inventorySyncRetryBlockedReason(row) }));
}

export async function getInventorySyncAttentionCommands(storeId?: string): Promise<InventorySyncCommand[]> {
  return (await getInventorySyncCommands(storeId)).filter(row => row.needsAttention);
}

export function inventorySyncCommandStatus(row: InventorySyncCommand) {
  if (row.status === 'cancelled') return 'superseded' as const;
  if (row.status === 'succeeded') return 'succeeded' as const;
  if (row.status === 'failed') return /timeout|timed out|waiting failed|waiting for selector|超时|expired/i.test(row.lastError)
    ? 'timed_out' as const : 'failed' as const;
  const progress = row.result?.progress && typeof row.result.progress === 'object'
    ? row.result.progress as Record<string, unknown> : {};
  if (String(progress.phase ?? '') === 'retrying' || (row.status === 'pending' && row.attempts > 0)) return 'retrying' as const;
  return row.status === 'processing' ? 'processing' as const : 'queued' as const;
}

export function buildInventorySyncRuns(rows: InventorySyncCommand[]) {
  type Platform = {
    commandId: string; platform: string; status: ReturnType<typeof inventorySyncCommandStatus>;
    error: string; phase: string; attempt: number; maxAttempts: number; updatedAt: string;
    needsAttention: boolean; overdue: boolean; attentionKey: string; canRetry: boolean; targetLabels: string[]; retryBlockedReason: string;
    desiredAvailable: boolean | null;
  };
  type Run = {
    id: string; storeId: string; itemLabel: string; isAvailable: boolean; source: 'siri' | 'store'; createdAt: string; platforms: Platform[];
  };
  const grouped = new Map<string, Run>();
  for (const row of rows) {
    const payload = row.payload;
    const runId = String(payload.syncRunId || payload.fullSyncRunId || `command:${row.id}`);
    const key = `${row.storeId}:${runId}`;
    const run: Run = grouped.get(key) ?? {
      id: runId, storeId: row.storeId, itemLabel: String(payload.feedbackLabel || payload.ingredientLabel || row.targetLabels.join('、')),
      isAvailable: payload.isAvailable === true, source: payload.syncSource === 'siri' ? 'siri' : 'store', createdAt: row.createdAt,
      platforms: [{ commandId: `${runId}-foundr1`, platform: 'foundr1', status: 'succeeded', error: '', phase: '',
        attempt: 1, maxAttempts: 1, updatedAt: row.createdAt, needsAttention: false, overdue: false,
        attentionKey: '', canRetry: false, targetLabels: [], retryBlockedReason: '', desiredAvailable: null }]
    };
    const progress = row.result?.progress && typeof row.result.progress === 'object'
      ? row.result.progress as Record<string, unknown> : {};
    run.platforms.push({ commandId: row.id, platform: row.platform, status: inventorySyncCommandStatus(row), error: row.lastError,
      phase: String(progress.phase ?? ''), attempt: Math.max(1, Number(progress.attempt ?? row.attempts ?? 1)),
      maxAttempts: Math.max(1, Number(progress.maxAttempts ?? (row.platform === 'demae_can' ? 2 : 3))), updatedAt: row.updatedAt,
      needsAttention: row.needsAttention, overdue: row.overdue, attentionKey: row.attentionKey, canRetry: row.canRetry, targetLabels: row.targetLabels,
      retryBlockedReason: row.retryBlockedReason ?? inventorySyncRetryBlockedReason(row),
      desiredAvailable: typeof payload.isAvailable === 'boolean' ? payload.isAvailable : null });
    grouped.set(key, run);
  }
  const order = new Map([['foundr1', 0], ['uber_eats', 1], ['rocket_now', 2], ['demae_can', 3]]);
  return [...grouped.values()].sort((a, b) => {
    const attention = (run: typeof a) => run.platforms.some(p => p.needsAttention);
    return Number(attention(b)) - Number(attention(a)) || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  }).map(run => ({ ...run, platforms: run.platforms.sort((a, b) => (order.get(a.platform) ?? 99) - (order.get(b.platform) ?? 99)) }));
}
