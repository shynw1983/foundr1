import {rocketPhysicalId} from './rocket-menu-client.mjs';

const externalIds=values=>[...new Set((values??[]).flatMap(value=>String(value).split(',')).map(value=>value.trim()).filter(Boolean))];
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=240&&!/[\u0000-\u001f\u007f]/u.test(value);

// Read-only, stable-ID-only destination audit. An adapter's aggregate match is
// not proof: keep the actual checkbox/row identities and require complete
// physical coverage. Mixed occurrence states and partial matches are unknown.
export async function auditDestination(adapter, payload, platform) {
 const items=[];
 for(const kind of ['item','option']) {
  const targets=(payload.targets??[]).filter(t=>t.kind===kind);
  if(!targets.length)continue;
  if(targets.some(t=>!externalIds(t.knownExternalIds).length))throw Error('inventory_audit_requires_mapping');
  const located=await adapter.locateTargets(targets);
  for(let i=0;i<targets.length;i++) {
   const target=targets[i], row=located[i];
   const matches=row?.matches?.length===1?(row.matches[0].rowMatches??row.matches):[];
   const states=matches.map(m=>m.unavailable);
   let observations=[],complete=false;
   try {
    const expected=externalIds(target.knownExternalIds);
    const actual=matches.map(match=>platform==='rocket_now'?match.checkboxId:match.rowId);
    if(expected.every(safeId)&&actual.length>0&&actual.every(safeId)&&new Set(actual).size===actual.length) {
     const physical=value=>platform==='rocket_now'?rocketPhysicalId(value):value;
     const expectedPhysical=new Set(expected.map(physical));
     const actualPhysical=new Set(actual.map(physical));
     complete=expectedPhysical.size===actualPhysical.size&&[...expectedPhysical].every(id=>actualPhysical.has(id));
     observations=matches.map((match,index)=>({externalId:actual[index],
      ...(platform==='rocket_now'?{physicalId:physical(actual[index])}:{}),
      found:true,isAvailable:!match.unavailable,matchBasis:'external_id'}));
    }
   }catch { /* Malformed/foreign IDs never become native evidence. */ }
   const known=row?.kind===kind&&row?.label===target.label&&row.matchBasis==='external_id'
    &&complete&&states.length>0&&states.every(s=>typeof s==='boolean'&&s===states[0]);
   items.push({kind,targetId:target.targetId,found:known,isAvailable:known?!states[0]:null,status:known?(states[0]?'sold_out':'available'):'unknown',
    externalIds:known?observations.map(observation=>observation.externalId):[],
    nativeMatchBasis:known?'external_id':null,nativeObservations:known?observations:[]});
  }
 }
 return {targetCount:(payload.targets??[]).length,items,capturedAt:new Date().toISOString()};
}
