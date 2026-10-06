import test from 'node:test';
import assert from 'node:assert/strict';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';
import {createMenuProgress} from '../src/menu-progress.mjs';
const target={kind:'item',sourceKey:'item:a',targetId:'a',name:'new',price:227,marker:'FS0123456789abcd',mappings:[{externalId:'1'}]};
const payload=()=>({authoritativePublication:true,sourceId:'s',storeId:'os',platformKey:'rocket_now',merchantId:'1',revision:1,newItemsHidden:true,imagePolicy:'read_only',targets:[structuredClone(target)]});

test('unconfirmed missing identities block every platform before reads or writes, also on retry',async()=>{
 for(const platform of ['rocket_now','demae_can']) {
  const p={...payload(),platformKey:platform,pendingRemovals:[{sourceKey:'option:fruit:mango',name:'マンゴー',targetId:'os-mango',mappings:[{externalId:'207',externalParentId:'stage:0041'}]}]};
  const {driver,events}=fixture();driver.platform=platform;
  driver.preflight=async()=>{throw Error('must not touch platform');};
  const before=structuredClone(p);
  for(let n=0;n<2;n++)await assert.rejects(()=>runUberAuthorityPublication(p,driver,async()=>{}),/uber_source_pending_removal:.*マンゴー/);
  assert.deepEqual(events,[]);assert.deepEqual(p,before);
 }
});
function fixture(issues=[]) {
 const events=[],native={name:'old',price:100};
 const driver={platform:'rocket_now',merchantId:'1',preflight:async()=>({issues}),
  updateContent:async target=>{events.push('content');native.name=target.name;native.price=target.price;},
  updateRelationships:async()=>events.push('relationships'),
  observe:async target=>{events.push('read');return [{sourceKey:target.sourceKey,externalId:'1',name:native.name,price:native.price,structureVerified:true}];}};
 return {events,driver};
}
test('full preflight and required acknowledgements happen before any write',async()=>{
 const {driver,events}=fixture([{sourceKey:'item:a',code:'ambiguous'}]);
 await assert.rejects(()=>runUberAuthorityPublication(payload(),driver,async()=>{}),/preflight_blocked/);
 assert.deepEqual(events,[]);
 await assert.rejects(()=>runUberAuthorityPublication(payload(),fixture().driver,async()=>{throw Error('offline');}),/offline/);
});
test('content then relationships then independent observations execute in one runner',async()=>{
 const {driver,events}=fixture();
 const result=await runUberAuthorityPublication(payload(),driver,async()=>{});
 assert.deepEqual(events,['content','relationships','read']);assert.equal(result.observations[0].price,227);
});
test('reports current target before work and counts only completed objects per stage',async()=>{
 const {driver}=fixture(),rows=[];
 driver.updateContent=async t=>{assert.equal(rows.at(-1).targetName,t.name);assert.equal(rows.at(-1).completed,0);};
 driver.observe=async t=>[{sourceKey:t.sourceKey,externalId:'1',name:t.name,price:t.price,structureVerified:true}];
 await runUberAuthorityPublication(payload(),driver,async row=>rows.push(row));
 for(const phase of ['content','relationships','verifying'])assert.ok(rows.some(r=>r.phase===phase&&r.completed===1&&r.total===1));
});
test('both retirement batches reset inherited counts and advance only after each successful retirement',async()=>{
 const p=payload(),events=[],rows=[],{driver}=fixture();
 const archived=(kind,id)=>({...structuredClone(target),kind,targetId:id,sourceKey:`${kind}:${id}`,archived:true,price:null});
 p.targets.push(archived('option','choice'),archived('item','oldItem'),archived('option_group','group'),archived('category','category'),
  {...archived('category','quarantined'),quarantined:true});
 let now=0;const progress=createMenuProgress(async row=>rows.push(row),()=>now+=6000);
 driver.retire=async t=>{
  const current=rows.at(-1);events.push(t.sourceKey);
  assert.equal(current.phase,'retiring');assert.equal(current.total,2);assert.equal(current.completed,events.length%2===1?0:1);
  assert.equal(current.sourceKey,t.sourceKey);
 };
 driver.observe=async t=>t.archived?[{sourceKey:t.sourceKey,exists:false,externalId:'1'}]
  :[{sourceKey:t.sourceKey,externalId:'1',name:t.name,price:t.price,structureVerified:true}];
 await runUberAuthorityPublication(p,driver,update=>progress.stage(update));
 assert.deepEqual(events,['option:choice','item:oldItem','option_group:group','category:category']);
 const resets=rows.filter(r=>r.phase==='retiring'&&r.completed===0&&!r.sourceKey);
 assert.equal(resets.length,2);assert.ok(resets.every(r=>r.total===2));
 assert.equal(rows.filter(r=>r.phase==='retiring'&&r.completed===2).length,2);
 assert.equal(rows.at(-1).phase,'verifying');assert.equal(rows.at(-1).completed,5);assert.equal(rows.at(-1).total,5);
});
test('a failed retirement does not advance its completed count or enter relationships',async()=>{
 const p=payload(),{driver}=fixture(),rows=[];
 p.targets.push({...structuredClone(target),kind:'option',sourceKey:'option:old',targetId:'old',archived:true,price:null});
 driver.retire=async()=>{throw Error('native_guard_failed');};
 await assert.rejects(()=>runUberAuthorityPublication(p,driver,async row=>rows.push(row)),/native_guard_failed/);
 assert.deepEqual(rows.at(-1),{phase:'retiring',sourceKey:'option:old',targetName:'new',completed:0,total:1});
 assert.ok(!rows.some(r=>r.phase==='relationships'));
});
test('a successful merchant response without actual changed values is rejected',async()=>{
 const {driver}=fixture();driver.updateContent=async()=>{};
 await assert.rejects(()=>runUberAuthorityPublication(payload(),driver,async()=>{}),/content_unverified/);
});
test('incomplete occurrence readback and exposed new items cannot succeed',async()=>{
 for(const created of [false,true]) {
  const p=payload(),{driver}=fixture();
  if(created)p.targets[0].mappings[0].created=true;
  else p.targets[0].mappings.push({externalId:'2'});
  await assert.rejects(()=>runUberAuthorityPublication(p,driver,async()=>{}),/draft_exposed|occurrence_unverified/);
 }
});
test('wrong scope and old image-enabled commands fail before preflight',async()=>{
 for(const patch of [{merchantId:'2'},{imagePolicy:undefined},{revision:0}]) {
  const {driver}=fixture();driver.preflight=async()=>{throw Error('should not read');};
  await assert.rejects(()=>runUberAuthorityPublication({...payload(),...patch},driver,async()=>{}),/command_invalid/);
 }
});

test('new parents may contain existing selling children, but new options remain hidden',async()=>{
 for(const kind of ['category','option_group','option']) {
  const p=payload(),{driver}=fixture();p.targets[0].kind=kind;
  p.targets[0].mappings[0].created=true;
  if(kind==='option')await assert.rejects(()=>runUberAuthorityPublication(p,driver,async()=>{}),/draft_exposed/);
  else assert.equal((await runUberAuthorityPublication(p,driver,async()=>{})).outcome,'applied');
 }
});

test('exact proven inventory release permits a historical created occurrence, never another draft or stock write',async()=>{
 for(const platform of ['rocket_now','demae_can'])for(const hidden of [false,true]) {
  const p={...payload(),platformKey:platform};
  const mapping=p.targets[0].mappings[0];mapping.created=true;
  mapping.creationHoldRelease={sourceId:p.sourceId,storeId:p.storeId,platform,merchantId:p.merchantId,sourceKey:p.targets[0].sourceKey,kind:'item',targetId:'a',externalId:'1',externalParentId:'',
   inventoryCommandId:'11111111-1111-4111-8111-111111111111',auditCommandId:'22222222-2222-4222-8222-222222222222',completedAt:'2026-10-05T00:00:00Z',capturedAt:'2026-10-05T00:01:00Z',
   verified:true,isAvailable:true,validation:'persisted-native-audit-v1'};
  const native={sourceKey:'item:a',externalId:'1',name:'new',price:227,structureVerified:true,hidden};
  let writes=0;
  const driver={platform,merchantId:'1',preflight:async()=>({issues:[]}),updateContent:async()=>{},updateRelationships:async()=>{},
   createHidden:async()=>{writes++;throw Error('cannot create');},observe:async()=>[structuredClone(native)]};
  assert.equal((await runUberAuthorityPublication(p,driver,async()=>{})).outcome,'applied');assert.equal(writes,0);
  assert.equal(mapping.created,true);assert.equal(native.hidden,hidden);
  for(const patch of [{externalId:'other'},{externalParentId:'other'},{targetId:'other'},{sourceKey:'item:other'},{storeId:'other'},{sourceId:'other'},{platform:'other'},
    {merchantId:'other'},{validation:'approved-only'},{verified:false},{isAvailable:false},{capturedAt:'2026-10-04T00:00:00Z'}]) {
   const changed=structuredClone(p);Object.assign(changed.targets[0].mappings[0].creationHoldRelease,patch);
   native.hidden=false;
   await assert.rejects(()=>runUberAuthorityPublication(changed,driver,async()=>{}),/draft_exposed/);
  }
 }
});
