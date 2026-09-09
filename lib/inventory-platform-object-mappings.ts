import { sql } from "./db";

// Hints identify what to re-read, not proof of current publication state.
export async function loadDemaeStagingHints(storeId:string) {
  const rows=await sql`select distinct on (payload->>'sourceId') payload,result from local_bridge_commands where store_id=${storeId} and platform='demae_can' and status='succeeded' and payload->>'authoritativePublication'='true' order by payload->>'sourceId',created_at desc`;
  const current=await sql`select m.brand_id::text as "brandId",m.target_type as kind,m.target_id::text as "targetId",m.external_id as "externalId",m.external_parent_id as "externalParentId" from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id join store_brands b on b.brand_id=m.brand_id and b.store_id=${storeId} where p.platform_key='demae_can' and (m.store_id is null or m.store_id=${storeId})`;
  return rows.map(row=>{
    const p=row.payload as Record<string,unknown>;
    const observations=(row.result?.observations??[]) as Array<Record<string,unknown>>;
    const targets:Array<Record<string,unknown>>=((p.targets??[]) as Array<Record<string,unknown>>).map(t=>({...t,mappings:current.filter(m=>m.brandId===p.brandId&&m.kind===t.kind&&m.targetId===t.targetId).flatMap(m=>String(m.externalId).split(',').filter(Boolean).map(externalId=>({externalId,externalParentId:m.externalParentId})))}));
    return {storeId,merchantId:p.merchantId,menuPatternCode:p.menuPatternCode,draftPatternCode:p.draftPatternCode,draftCarrierItemCode:p.draftCarrierItemCode,
      graph:targets.filter(t=>!t.archived&&!t.quarantined).map(t=>({kind:t.kind,targetId:t.targetId,parentId:t.parentId,sourceKey:t.sourceKey,source:t.source,mappings:t.mappings})),
      targets:targets.filter(t=>!t.archived&&!t.quarantined&&['item','option'].includes(String(t.kind))&&observations.some(o=>o.sourceKey===t.sourceKey&&o.exists===true&&o.hidden===true&&o.placement==='staged'))
        .map(t=>({kind:t.kind,targetId:t.targetId,marker:t.marker,mappings:t.mappings}))};
  });
}

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
      and not (platforms.platform_key='uber_eats' and exists (
        select 1 from menu_uber_objects owned join menu_uber_sources source on source.id=owned.source_id
        where source.enabled=true and source.store_id::text=${storeId}
          and owned.kind=mappings.target_type and owned.target_id=mappings.target_id
      ))
    union
    select 'uber_eats' as platform, objects.kind, objects.target_id::text as "targetId", objects.uber_id as "externalId"
    from menu_uber_objects objects
    join menu_uber_sources sources on sources.id=objects.source_id
    join requested_targets targets on targets.kind=objects.kind and targets."targetId"=objects.target_id
    where sources.enabled=true and sources.store_id::text=${storeId}
      and objects.archived=false
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
