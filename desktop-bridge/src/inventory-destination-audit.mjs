// Read-only, stable-ID-only destination audit. Mixed occurrence states are unknown.
export async function auditDestination(adapter, payload, platform) {
 const items=[];
 for(const kind of ['item','option']) {
  const targets=(payload.targets??[]).filter(t=>t.kind===kind);
  if(!targets.length)continue;
  if(targets.some(t=>!t.knownExternalIds?.length))throw Error('inventory_audit_requires_mapping');
  const located=await adapter.locateTargets(targets);
  for(let i=0;i<targets.length;i++) {
   const target=targets[i], row=located[i];
   const matches=row?.matches?.length===1?(row.matches[0].rowMatches??row.matches):[];
   const states=matches.map(m=>m.unavailable);
   const known=row?.kind===kind&&row?.label===target.label&&states.length>0&&states.every(s=>typeof s==='boolean'&&s===states[0]);
   items.push({kind,targetId:target.targetId,found:known,isAvailable:known?!states[0]:null,status:known?(states[0]?'sold_out':'available'):'unknown'});
  }
 }
 return {targetCount:(payload.targets??[]).length,items,capturedAt:new Date().toISOString()};
}
