import { sql } from "./db";

type RecoveryTarget = { kind: string; targetId: string; label: string; isAvailable: boolean };
type RecoveryObservation = {
  kind: string;
  targetId: string;
  source: string;
  action: string;
  persistOverall: boolean;
  platform: string;
  status: string;
  isAvailable: boolean | null;
  outcome: string;
};
export type InventoryWriteRecoveryHint = RecoveryTarget & { successfulPlatforms: string[] };

/** Advisory only. A failed write is not a menu snapshot or permission to replay it. */
export async function loadInventoryWriteRecoveryHints(storeId: string, targets: RecoveryTarget[]) {
  if (!targets.length) return [];
  const observations = await sql`
    with wanted as (
      select kind, "targetId" from jsonb_to_recordset(${JSON.stringify(targets)}::jsonb)
        as t(kind text, "targetId" text)
    ), recent_runs as (
      select id, source, action, details, created_at
      from menu_inventory_sync_runs
      where store_id = ${storeId}
        and created_at >= now() - interval '30 days'
      order by created_at desc, id desc
      limit 100
    ), observations as (
      select runs.id as run_id, runs.source, runs.action,
        coalesce(runs.details->'persistOverall', 'true'::jsonb) = 'true'::jsonb as "persistOverall",
        runs.created_at as intent_at, commands.id as command_id,
        commands.created_at as command_at, commands.platform, commands.status,
        target->>'kind' as kind, target->>'targetId' as "targetId",
        case when jsonb_typeof(commands.payload->'isAvailable') = 'boolean'
          then (commands.payload->>'isAvailable')::boolean else null end as "isAvailable",
        coalesce(commands.result->>'outcome', '') as outcome
      from recent_runs runs
      join local_bridge_commands commands
        on commands.store_id = ${storeId}
        and coalesce(nullif(commands.payload->>'syncRunId', ''), commands.payload->>'fullSyncRunId') = runs.id::text
        and commands.command_type = 'set_inventory_availability'
      cross join lateral jsonb_array_elements(case
        when jsonb_typeof(commands.payload->'targets') = 'array' then commands.payload->'targets'
        else '[]'::jsonb end) target
      join wanted on wanted.kind = target->>'kind' and wanted."targetId" = target->>'targetId'
    ), latest_intent as (
      select distinct on (kind, "targetId") kind, "targetId", run_id
      from observations
      order by kind, "targetId", intent_at desc, run_id desc
    )
    select distinct on (observations.kind, observations."targetId", observations.platform)
      observations.kind, observations."targetId", source, action, "persistOverall",
      platform, status, "isAvailable", outcome
    from observations
    join latest_intent using (kind, "targetId", run_id)
    order by observations.kind, observations."targetId", observations.platform,
      command_at desc, command_id desc
  ` as RecoveryObservation[];

  return targets.flatMap((target): InventoryWriteRecoveryHint[] => {
    const rows = observations.filter(row => row.kind === target.kind && row.targetId === target.targetId);
    const uber = rows.find(row => row.platform === "uber_eats");
    if (!uber || uber.source !== "store" || uber.action === "platform_override" || !uber.persistOverall
      || !["failed", "timed_out"].includes(uber.status) || typeof uber.isAvailable !== "boolean"
      || uber.isAvailable === target.isAvailable) return [];
    const successfulPlatforms = rows.filter(row => ["rocket_now", "demae_can"].includes(row.platform)
      && row.status === "succeeded" && row.outcome !== "not_applicable"
      && row.isAvailable === uber.isAvailable).map(row => row.platform);
    return successfulPlatforms.length ? [{ ...target, isAvailable: uber.isAvailable, successfulPlatforms }] : [];
  });
}
