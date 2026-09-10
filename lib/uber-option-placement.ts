export const UBER_PLACEMENT_RULE_VERSION='uber-promotion-primary-v1';
export type PlacementNode = {
  sourceKey:string; kind:string; targetId:string; parentId:string|null;
  name:string; archived?:boolean;
};
export type PlacementMapping = {kind:string;targetId:string;externalId:string};

/** Promotion membership is presentation, not a new ingredient identity.
 * Names are used only to identify the presentation group, never the option.
 * Call separately per source/store and destination platform.
 */
export function resolveUberOptionPlacement(nodes:PlacementNode[], mappings:PlacementMapping[]) {
  const active=nodes.filter(n=>!n.archived);
  const promotionGroups=new Set(active.filter(n=>n.kind==='option_group'
    &&n.name.normalize('NFKC').split(/[|｜]/)[0].trim()==='新登場トッピング').map(n=>n.targetId));
  const mapped=new Set(mappings.filter(m=>m.kind==='option'&&m.externalId.trim()).map(m=>m.targetId));
  const byIdentity=new Map<string,PlacementNode[]>();
  for(const n of active.filter(n=>n.kind==='option')) {
    const parts=n.sourceKey.split(':');
    if(parts.length!==3||!parts[1]||!parts[2])continue;
    byIdentity.set(parts[2],[...(byIdentity.get(parts[2])??[]),n]);
  }
  const aliases:Array<{sourceKey:string;targetId:string;primaryTargetId:string}>=[];
  for(const [id,peers] of byIdentity) {
    if(!peers.some(n=>promotionGroups.has(n.parentId??'')))continue;
    const normal=peers.filter(n=>!promotionGroups.has(n.parentId??''));
    if(!normal.length)continue; // Truly new products are still published.
    const established=normal.filter(n=>mapped.has(n.targetId));
    const primary=normal.length===1?normal[0]:established.length===1?established[0]:null;
    if(!primary)throw Error(`Uber オプションの主所属を確認してください: ${peers[0].name} (${id})`);
    for(const n of peers.filter(n=>n!==primary)) {
      // Never silently detach, retire or repurpose an existing physical object.
      if(mapped.has(n.targetId))throw Error(`新登場の重複オプションには既存の公開先があります。対応関係を確認してください: ${n.name} (${id})`);
      aliases.push({sourceKey:n.sourceKey,targetId:n.targetId,primaryTargetId:primary.targetId});
    }
  }
  return aliases;
}
