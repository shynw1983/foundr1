import { sql } from "./db";

type InventoryMappingTarget = {
  kind: "item" | "option";
  targetId: string;
};

export async function loadInventoryPlatformExternalIdMap(
  storeId: string,
  targets: InventoryMappingTarget[]
) {
  const uniqueTargets = Array.from(new Map(targets.map((target) => [
    `${target.kind}:${target.targetId}`,
    target
  ])).values());
  if (!uniqueTargets.length) return new Map<string, string[]>();

  const rows = await sql`
    with requested_targets as (
      select *
      from jsonb_to_recordset(${JSON.stringify(uniqueTargets)}::jsonb)
        as target(kind text, "targetId" uuid)
    )
    select
      platforms.platform_key as platform,
      mappings.target_type as kind,
      mappings.target_id::text as "targetId",
      mappings.external_id as "externalId"
    from menu_platform_object_mappings mappings
    join menu_external_platforms platforms on platforms.id = mappings.external_platform_id
    join store_brands on store_brands.brand_id = mappings.brand_id and store_brands.store_id::text = ${storeId}
    join requested_targets targets on targets.kind = mappings.target_type and targets."targetId" = mappings.target_id
    where platforms.platform_key in ('uber_eats', 'rocket_now', 'demae_can')
      and (mappings.store_id is null or mappings.store_id::text = ${storeId})
      and coalesce(mappings.external_id, '') <> ''
  `;
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const key = `${String(row.platform)}:${String(row.kind)}:${String(row.targetId)}`;
    result.set(key, Array.from(new Set([...(result.get(key) ?? []), String(row.externalId)])));
  }
  return result;
}

export function inventoryPlatformExternalIds(
  mappings: Map<string, string[]>,
  platform: string,
  target: InventoryMappingTarget
) {
  return mappings.get(`${platform}:${target.kind}:${target.targetId}`) ?? [];
}
