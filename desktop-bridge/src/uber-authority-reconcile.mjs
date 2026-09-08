import {authorityPhysicalId} from './uber-authority-parents.mjs';

function nameKey(value) {
  return String(value??'').normalize('NFKC').split(/[｜|]/u)[0]
    .replace(/【[^】]*】|\[[^\]]*\]/gu,'')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/gu,'')
    .replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
}
function aliases(target) {
  const names=[target.name,target.source?.name];
  // Rocket appends a translated name to its projected Japanese name.
  if(target.name)names.push(target.name.replace(/[（(][^（）()]*[）)]$/u,''));
  return [...new Set(names.map(nameKey).filter(Boolean))];
}

/** Bootstrap only with three independent signals: exact normalized Japanese
 * name, exact platform price, and an already ID-verified logical parent. Both
 * sides must be unique. Existing ownership is never replaced or duplicated. */
export function reconcileAuthorityChildren(payload,remote) {
  const physical=(kind,id)=>authorityPhysicalId(payload.platformKey,kind,id,payload.merchantId);
  const owned=new Set(payload.targets.flatMap(target=>(target.mappings??[]).map(m=>`${target.kind}:${physical(target.kind,m.externalId)}`)));
  const parents=new Map(payload.targets.filter(target=>['category','option_group'].includes(target.kind))
    .map(target=>[target.targetId,(target.mappings??[]).map(m=>physical(target.kind,m.externalId))]));
  const candidates=[];
  for(const target of payload.targets.filter(target=>['item','option'].includes(target.kind)&&!target.archived&&!target.quarantined&&!target.mappings?.length)) {
    const parentIds=parents.get(target.parentId)??[];
    if(!parentIds.length)continue;
    const keys=aliases(target);
    const matches=remote.filter(row=>row.kind===target.kind&&!owned.has(`${row.kind}:${String(row.id)}`)
      &&Number.isSafeInteger(row.price)&&row.price===target.price&&keys.includes(nameKey(row.name))
      &&row.parentIds.some(id=>parentIds.includes(String(id))));
    const unique=[...new Map(matches.map(row=>[String(row.id),row])).values()];
    if(unique.length===1)candidates.push({target,row:unique[0]});
  }
  return candidates.filter(candidate=>candidates.filter(other=>other.target.kind===candidate.target.kind&&String(other.row.id)===String(candidate.row.id)).length===1)
    .map(({target,row})=>({sourceKey:target.sourceKey,targetId:target.targetId,kind:target.kind,name:row.name,
      externalId:payload.platformKey==='rocket_now'?String(row.id):`itemList_${payload.merchantId}${row.id}${target.kind==='option'?'true':'false'}`,
      externalParentId:String(row.parentIds[0]),evidence:{method:'name-price-verified-parent',price:row.price,parentIds:row.parentIds}}));
}
