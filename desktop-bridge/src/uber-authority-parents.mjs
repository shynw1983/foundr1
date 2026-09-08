import {rocketPhysicalId} from './rocket-menu-client.mjs';

export function authorityPhysicalId(platform,kind,value,merchantId) {
  if(platform==='rocket_now')return rocketPhysicalId(value);
  const text=String(value??'');
  const prefix=`itemList_${merchantId}`;
  if(text.startsWith('itemList_')&&!text.startsWith(prefix))throw Error('demae_mapping_chain_mismatch');
  if(text.startsWith(prefix)) {
    const suffix=kind==='option'?'true':'false';
    if(!text.endsWith(suffix))throw Error('demae_mapping_kind_mismatch');
    return text.slice(prefix.length,-suffix.length);
  }
  if(!/^[A-Za-z0-9_-]+$/.test(text))throw Error('authority_mapping_id_invalid');
  return text;
}

/** Parent identity derives exclusively from stable child IDs. Mixed physical
 * parents and multiple possible logical owners require a restructuring plan;
 * names (including translations) never establish ownership. No writes here. */
export function planAuthorityParents(payload,remoteParents) {
  const bindings=[],issues=[];
  for(const kind of ['category','option_group']) {
    const childKind=kind==='category'?'item':'option';
    const parents=payload.targets.filter(t=>t.kind===kind&&!t.archived);
    const children=payload.targets.filter(t=>t.kind===childKind&&!t.archived);
    const owners=new Map();
    for(const child of children)for(const mapping of child.mappings??[]) {
      const id=authorityPhysicalId(payload.platformKey,childKind,mapping.externalId,payload.merchantId);
      const entries=owners.get(id)??[];entries.push(child);owners.set(id,entries);
    }
    for(const remote of remoteParents.filter(p=>p.kind===kind)) {
      const ids=[...new Set(remote.childIds.map(String))];
      const matched=ids.flatMap(id=>owners.get(id)??[]);
      const parentIds=[...new Set(matched.map(child=>child.parentId).filter(Boolean))];
      if(parentIds.length>1) {
        issues.push({code:'mixed_parent',kind,externalId:remote.externalId,name:remote.name,parentIds});continue;
      }
      if(parentIds.length===1) {
        const target=parents.find(parent=>parent.targetId===parentIds[0]);
        if(!target)continue;
        const unknown=ids.filter(id=>!owners.has(id));
        bindings.push({sourceKey:target.sourceKey,targetId:target.targetId,kind,externalId:String(remote.externalId),name:remote.name,evidenceIds:ids.filter(id=>owners.has(id)),unknownIds:unknown});
        if(unknown.length)issues.push({code:'unmapped_children',kind,sourceKey:target.sourceKey,externalId:remote.externalId,unknownIds:unknown});
      }
    }
    for(const target of parents) {
      const found=bindings.filter(binding=>binding.sourceKey===target.sourceKey);
      if(found.length>1)issues.push({code:'split_parent',kind,sourceKey:target.sourceKey,name:target.name,externalIds:found.map(row=>row.externalId)});
      if(!found.length && !(target.mappings?.length))issues.push({code:'parent_unresolved',kind,sourceKey:target.sourceKey,name:target.name});
    }
  }
  return {bindings,issues};
}
