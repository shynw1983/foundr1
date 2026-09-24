// Shared by enqueue, claim and retry. A linkage key is NOT a platform target.
// Missing run/target identity is deliberately not eligible for cancellation.
export function newerInventoryOperationSql(oldAlias: "stale" | "target") {
  return `newer.store_id = ${oldAlias}.store_id
    and newer.platform = ${oldAlias}.platform
    and newer.command_type = ${oldAlias}.command_type
    and newer.created_at > ${oldAlias}.created_at
    and coalesce(nullif(${oldAlias}.payload->>'syncRunId', ''), nullif(${oldAlias}.payload->>'fullSyncRunId', '')) is not null
    and coalesce(nullif(newer.payload->>'syncRunId', ''), nullif(newer.payload->>'fullSyncRunId', '')) is not null
    and coalesce(nullif(newer.payload->>'syncRunId', ''), newer.payload->>'fullSyncRunId')
      <> coalesce(nullif(${oldAlias}.payload->>'syncRunId', ''), ${oldAlias}.payload->>'fullSyncRunId')
    and newer.status in ('pending', 'processing', 'succeeded', 'failed')`;
}

export const inventoryTargetOverlapSql = `newer_target->>'kind' = old_target->>'kind'
  and old_target->>'kind' in ('item', 'option')
  and coalesce(old_target->>'targetId', '') <> ''
  and newer_target->>'targetId' = old_target->>'targetId'`;

// Lock pending rows before deriving their new payload. A claimant either gets
// the trimmed targets or owns the row first; processing work is never mutated.
// $1: authorized store, $2: authorized platform array.
export const reconcileInventoryCommandsSql = `
  with pending as materialized (
    select * from local_bridge_commands
    where store_id::text = $1 and platform = any($2::text[])
      and command_type = 'set_inventory_availability' and status = 'pending'
    for update skip locked
  ), trimmed as (
    select stale.id, stale.payload, parts.remaining, parts.removed
    from pending stale
    cross join lateral (
      select coalesce(jsonb_agg(old_target order by position) filter (where not replaced), '[]'::jsonb) remaining,
        coalesce(jsonb_agg(old_target order by position) filter (where replaced), '[]'::jsonb) removed
      from (
        select old_target, position, exists (
          select 1 from local_bridge_commands newer
          cross join lateral jsonb_array_elements(coalesce(newer.payload->'targets', '[]'::jsonb)) newer_target
          where ${newerInventoryOperationSql("stale")}
            and ${inventoryTargetOverlapSql}
        ) replaced
        from jsonb_array_elements(coalesce(stale.payload->'targets', '[]'::jsonb))
          with ordinality as targets(old_target, position)
      ) compared
    ) parts
    where jsonb_array_length(parts.removed) > 0
  )
  update local_bridge_commands command
  set payload = jsonb_set(command.payload, '{targets}', trimmed.remaining)
      || jsonb_build_object('supersededTargets', coalesce(command.payload->'supersededTargets', '[]'::jsonb) || trimmed.removed),
    status = case when jsonb_array_length(trimmed.remaining) = 0 then 'cancelled' else command.status end,
    result = case when jsonb_array_length(trimmed.remaining) = 0
      then jsonb_build_object('outcome', 'superseded') else command.result end,
    completed_at = case when jsonb_array_length(trimmed.remaining) = 0 then now() else command.completed_at end,
    last_error = case when jsonb_array_length(trimmed.remaining) = 0 then '' else command.last_error end,
    updated_at = now()
  from trimmed where command.id = trimmed.id and command.status = 'pending'
  returning command.id::text, command.status
`;
