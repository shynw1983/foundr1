import {sql} from './db';
import {resolveUberOptionPlacement, type PlacementNode, type PlacementMapping} from './uber-option-placement.ts';

// Same resolver as menu publication; no persisted name-based stock links.
export async function loadUberOptionPlacements(storeId:string,brandId?:string) {
  const sources=await sql`select id::text,brand_id::text as "brandId",publish_config from menu_uber_sources
    where enabled=true and store_id::text=${storeId} and (${brandId??''}='' or brand_id::text=${brandId??''})`;
  const result:Array<{platform:string;sourceKey:string;targetId:string;primaryTargetId:string}>=[];
  for(const source of sources) {
    const nodes=await sql`select o.source_key as "sourceKey",o.kind,o.target_id::text as "targetId",
      g.target_id::text as "parentId",coalesce(o.source_payload->>'name','') as name,o.archived
      from menu_uber_objects o left join menu_uber_objects g on g.source_id=o.source_id
        and g.kind='option_group' and g.uber_id=o.parent_uber_id
      where o.source_id=${source.id}` as PlacementNode[];
    const mappings=await sql`select p.platform_key as platform,m.target_type as kind,m.target_id::text as "targetId",m.external_id as "externalId"
      from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id
      where p.brand_id::text=${source.brandId} and p.store_id is null
        and (m.store_id is null or m.store_id::text=${storeId})`;
    for(const platform of ['rocket_now','demae_can']) {
      const config=source.publish_config?.[platform]??{};
      const excluded=new Set<string>([...(config.excludedSourceKeys??[]),...(config.quarantinedSourceKeys??[])]);
      const aliases=resolveUberOptionPlacement(nodes.filter(n=>!excluded.has(n.sourceKey)),
        mappings.filter(m=>m.platform===platform) as PlacementMapping[]);
      result.push(...aliases.map(a=>({...a,platform})));
    }
  }
  return result;
}
