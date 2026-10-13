import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {inventoryReferencePlatform,validateUberAvailability} from './inventory-authority-policy.ts';
import {buildInventoryComparison} from './inventory-comparison.ts';
import {authorityPhysicalId} from '../desktop-bridge/src/uber-authority-parents.mjs';

const target={kind:'option',targetId:'00000000-0000-4000-8000-000000000001',brandId:'00000000-0000-4000-8000-000000000002',label:'配料',aliases:[],knownExternalIds:['uber-option']};
const result={targetCount:1,items:[{kind:'option',targetId:target.targetId,found:true,isAvailable:false,status:'sold_out'}]};
function harness({applied=false,missingDemae=false,busy=false,phase='awaiting_confirmation',expired=false,changed=false,quarantined=false,staged=false,release=false,
  reference='uber_eats',selectionChanged=false,proof='valid',readExpired=false,conflicts=false,auditChanged=false}={}) {
  const transactions:Array<Array<{text:string;values:unknown[]}>>=[];
  let wakes=0;
  let sequence=0;
  const now=new Date().toISOString();
  const uberResult=release?{...result,items:[{...result.items[0],isAvailable:true,status:'available'}]}:result;
  const details:Record<string,any>={osApplied:applied,targetCount:1,phase,referencePlatform:reference,referenceSelectionChanged:selectionChanged,previewRevision:'preview-a',
    comparisonVersion:1,comparisonPlatforms:['rocket_now','demae_can'],comparisonExclusions:quarantined?[{platform:'demae_can',kind:target.kind,targetId:target.targetId}]:[],
    preview:[{...target,isAvailable:release,wasAvailable:true}],previewAt:new Date(Date.now()-(expired?660000:0)).toISOString(),snapshot:{targets:[target],result:uberResult}};
  const externalId=(platform:string)=>platform==='rocket_now'?'sub_checkbox_9_20':'itemList_41064920true';
  const commands=['rocket_now','demae_can'].map(platform=>({platform,status:'succeeded',updatedAt:now,
    payload:{comparisonAudit:true,targets:platform==='demae_can'&&missingDemae?[]:[{...target,knownExternalIds:[externalId(platform)]}],demaeStaging:[]} as Record<string,any>,
    result:{targetCount:1,capturedAt:new Date(Date.now()-(readExpired?660000:0)).toISOString(),items:[{kind:target.kind,targetId:target.targetId,found:true,isAvailable:true,status:'available',
      externalIds:[externalId(platform)],nativeMatchBasis:'external_id',nativeObservations:[{externalId:externalId(platform),...(platform==='rocket_now'?{physicalId:'20'}:{}),found:true,isAvailable:true,matchBasis:'external_id'}]}]} as Record<string,any>}));
  if(proof==='missing')commands[0].result.items[0].nativeObservations=[];
  if(proof==='foreign')commands[0].result.items[0].nativeObservations[0].physicalId='999';
  if(proof==='prefix')for(const key of ['externalIds','nativeObservations']){
    if(key==='externalIds')commands[0].result.items[0][key]=['sub_checkbox_3_20'];
    else commands[0].result.items[0][key][0].externalId='sub_checkbox_3_20';
  }
  if(staged)commands[1].result.items=[{kind:target.kind,targetId:target.targetId,found:true,isAvailable:null,status:'staged',stagingVerified:true,...(release?{releasePlan:{kind:'option',id:'draft',groups:['g']}}:{})}];
  if(staged&&release)commands[1].payload.demaeStaging=[{storeId:'store'}];
  const sql=Object.assign((parts:TemplateStringsArray,...values:unknown[])=>{
    const text=parts.join('?');
    let rows:unknown[]=[];
    if(text.includes('select details'))rows=[{details}];
    if(text.includes("payload->>'comparisonAudit'='true'"))rows=commands;
    if(text.includes("coalesce(payload->>'comparisonAudit','false')"))rows=[{status:'succeeded',payload:{targets:[target]},result:auditChanged?{...uberResult,items:[]}:uberResult}];
    if(text.includes('select 1 where exists'))rows=changed?[{}]:[];
    if(text.includes('select id from local_bridge_commands'))rows=busy?[{id:'busy'}]:[];
    if(text.includes('select 1 from store_sales_sources'))rows=[{}];
    if(text.includes('select distinct source_platform'))rows=[{platform:'uber_eats'},{platform:'rocket_now'},{platform:'demae_can'}].filter(row=>text.includes("('uber_eats'")||row.platform!=='uber_eats');
    if(text.includes('jsonb_each(s.publish_config)') && quarantined)rows=[{platform:'demae_can',kind:target.kind,targetId:target.targetId}];
    if(text.includes("publish_config->'demae_can'->>'merchantId'"))rows=[{brandId:target.brandId,merchantId:'410649'}];
    if(text.includes('with requested as')&&conflicts)rows=[{kind:target.kind,targetId:target.targetId,reason:'inventory_block',platform:null}];
    if(text.includes('update menu_inventory_sync_runs')&&text.includes('returning id')){Object.assign(details,JSON.parse(values[0] as string));rows=[{id:'run'}];}
    return {text,values,then:(resolve:(v:unknown[])=>void)=>Promise.resolve(rows).then(resolve)};
  },{transaction:async(queries:Array<{text:string;values:unknown[]}>)=>{transactions.push(queries);return [];}});
  const mappings=new Map([['uber_eats:option:'+target.targetId,['uber-option']],['rocket_now:option:'+target.targetId,[externalId('rocket_now')]],
    ...(!missingDemae?[['demae_can:option:'+target.targetId,[externalId('demae_can')]] as [string,string[]]]:[])]);
  const modules:Record<string,unknown>={
    'node:crypto':{createHash,randomUUID:()=>`uuid-${++sequence}`},'./db':{sql},
    './inventory-platform-object-mappings':{loadDemaeStagingHints:async()=>[],loadInventoryPlatformExternalIdMap:async()=>mappings,inventoryPlatformExternalIds:(map:Map<string,string[]>,platform:string,t:typeof target)=>map.get(`${platform}:${t.kind}:${t.targetId}`)??[]},
    './inventory-operation-lock':{withInventoryOperationLock:async(_store:string,fn:()=>Promise<unknown>)=>fn(),assertNoWholeStoreSync:async()=>{}},
    './inventory-authority-policy':{validateUberAvailability,inventoryReferencePlatform},
    '../desktop-bridge/src/uber-authority-parents.mjs':{authorityPhysicalId},
    './inventory-comparison':{buildInventoryComparison},
    './uber-option-placement-store':{loadUberOptionPlacements:async()=>[]},
    './local-bridge-realtime':{publishBridgeCommandAvailable:async()=>{wakes++;}}
  };
  const exports:Record<string,(...args:unknown[])=>Promise<unknown>>={};
  runInNewContext(ts.transpileModule(readFileSync(new URL('./inventory-manual-sync.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:(name:string)=>{if(!(name in modules))throw Error(name);return modules[name];}});
  return {exports,transactions,details,commands,wakes:()=>wakes};
}
test('quarantined menu targets stay excluded from inventory publication',async()=>{
  const h=harness({missingDemae:true,quarantined:true});
  await h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true);
  const commands=h.transactions[0].filter(q=>q.text.includes('insert into local_bridge_commands'));
  assert.equal(commands.length,1);
  assert.equal(commands[0].values[2],'rocket_now');
});
test('manual start queues fresh platform reads, never availability writes',async()=>{
  const h=harness();await h.exports.startUberAvailabilitySync('store',[target],'operator');
  assert.equal(h.transactions.length,1);
  assert.equal(h.transactions[0].length,4);
  assert.match(h.transactions[0][1].text,/'audit_inventory'/);
  assert.ok(!h.transactions[0].some(q=>q.text.includes('menu_option_store_settings')));
});
test('other active writes prevent whole-store read from starting',async()=>{
  const h=harness({busy:true});await assert.rejects(h.exports.startUberAvailabilitySync('store',[target],'operator'));
  assert.equal(h.transactions.length,0);
});
test('complete read atomically commits OS, permanent downstream commands and receipt',async()=>{
  const h=harness();await h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true);
  assert.equal(h.transactions.length,1);
  const queries=h.transactions[0];
  assert.ok(queries.some(q=>q.text.includes('delete from menu_inventory_availability_blocks')));
  assert.ok(queries.some(q=>q.text.includes('insert into menu_option_store_settings')));
  const commands=queries.filter(q=>q.text.includes('insert into local_bridge_commands'));
  assert.equal(commands.length,2);
  for(const q of commands){const payload=JSON.parse(q.values[4] as string);assert.equal(payload.soldOutMode,'indefinite');assert.equal(payload.isAvailable,false);}
  assert.equal(h.wakes(),1);
});
test('unknown destination state blocks confirmation before any writes',async()=>{
  const h=harness({missingDemae:true});await assert.rejects(h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true));
  assert.equal(h.transactions.length,0);
});
test('verified draft is skipped while OS and another platform differences are applied',async()=>{
 const h=harness({staged:true});
 await h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true);
 const commands=h.transactions[0].filter(q=>q.text.includes('insert into local_bridge_commands'));
 assert.equal(commands.length,1);assert.equal(commands[0].values[2],'rocket_now');
 assert.ok(h.transactions[0].some(q=>q.text.includes('insert into menu_option_store_settings')));
 assert.ok(JSON.stringify(h.transactions).includes('verified_unpublished_draft'));
});
test('manual confirmation queues the exact verified release plan only for Uber available',async()=>{
 const h=harness({staged:true,release:true});
 await h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},{...result,items:[{...result.items[0],isAvailable:true,status:'available'}]},true);
 const commands=h.transactions[0].filter(q=>q.text.includes('insert into local_bridge_commands'));
 assert.equal(commands.length,1);assert.equal(commands[0].values[2],'demae_can');
 const payload=JSON.parse(commands[0].values[4] as string);
 assert.equal(payload.isAvailable,true);assert.equal(payload.targets[0].releasePlan.id,'draft');assert.equal(payload.demaeStaging[0].storeId,'store');
});

test('successful Uber read waits for human confirmation without OS writes or destination commands',async()=>{
  const h=harness({phase:'reading_uber'});
  await h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result);
  assert.equal(h.transactions.length,0);assert.equal(h.wakes(),0);
});

test('expired or locally superseded previews cannot be applied',async()=>{
  for(const config of [{expired:true},{changed:true},{phase:'reading_uber'}]){
    const h=harness(config);
    await assert.rejects(h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true));
    assert.equal(h.transactions.length,0);
  }
});
test('repeated successful receipt performs no writes; incomplete reads also perform no writes',async()=>{
  const done=harness({applied:true});await done.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result);
  assert.equal(done.transactions.length,0);
  const partial=harness();await assert.rejects(partial.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},{targetCount:1,items:[]}));
  assert.equal(partial.transactions.length,0);
});

const options=(h:ReturnType<typeof harness>)=>({referencePlatform:h.details.referencePlatform,previewRevision:h.details.previewRevision});
test('reference changes replace preview token without queuing stock writes or renewing read time',async()=>{
 const h=harness();const before=h.details.previewAt;
 const response=await h.exports.setInventorySyncReference('store','run','rocket_now','preview-a') as Record<string,unknown>;
 assert.equal(response.referencePlatform,'rocket_now');assert.notEqual(response.previewRevision,'preview-a');
 assert.equal(h.details.previewAt,before);assert.equal(h.details.referenceSelectionChanged,true);
 assert.equal(h.transactions.length,0);assert.equal(h.wakes(),0);
});
test('alternate reference queues exact Uber restoration, leaves the source unchanged and uses indefinite mode',async()=>{
 const h=harness({reference:'rocket_now'});
 await h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true,options(h));
 const commands=h.transactions[0].filter(query=>query.text.includes('insert into local_bridge_commands'));
 assert.equal(commands.length,1);assert.equal(commands[0].values[2],'uber_eats');
 const payload=JSON.parse(commands[0].values[4] as string);
 assert.equal(payload.referencePlatform,'rocket_now');assert.equal(payload.isAvailable,true);
 assert.equal(payload.operation,'available');assert.equal(payload.soldOutMode,'indefinite');
 assert.deepEqual(payload.targets[0].knownExternalIds,['uber-option']);
 const stock=h.transactions[0].find(query=>query.text.includes('insert into menu_option_store_settings'))!;
 assert.equal(stock.values[2],'[]','unchanged OS stock must not be rewritten');
});
test('stock conflicts need explicit acknowledgement even when only a delivery platform changes',async()=>{
 const h=harness({reference:'rocket_now',conflicts:true});
 await assert.rejects(h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true,options(h)),/競合/);
 assert.equal(h.transactions.length,0);
 await h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true,{...options(h),acknowledgeInventoryConflicts:true});
 const blockDelete=h.transactions[0].find(query=>query.text.includes('delete from menu_inventory_availability_blocks'))!;
 assert.ok(String(blockDelete.values[0]).includes(target.targetId));
});
test('stale or unbound confirmations cannot apply alternate or away-and-back reference selections',async()=>{
 for(const config of [{reference:'rocket_now'},{selectionChanged:true}]) {
  const h=harness(config);
  await assert.rejects(h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true));
  assert.equal(h.transactions.length,0);
 }
 const h=harness({reference:'rocket_now'});
 for(const request of [{referencePlatform:'uber_eats',previewRevision:'preview-a'},{referencePlatform:'rocket_now',previewRevision:'old'}])
  await assert.rejects(h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true,request));
 assert.equal(h.transactions.length,0);
});
test('invalid, incomplete, foreign physical observations and old captures cannot become reference proof',async()=>{
 for(const config of [{proof:'missing'},{proof:'foreign'},{readExpired:true},{auditChanged:true}]) {
  const h=harness(config);
  await assert.rejects(h.exports.setInventorySyncReference('store','run','rocket_now','preview-a'));
  assert.equal(h.transactions.length,0);assert.equal(h.details.previewRevision,'preview-a');
 }
});
test('Rocket checkbox parent prefix may vary only when exact native physical identity and state remain stable',async()=>{
 const h=harness({proof:'prefix'});
 await h.exports.setInventorySyncReference('store','run','rocket_now','preview-a');
 await h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true,options(h));
 assert.equal(h.transactions.length,1);
});
test('a changed comparison receipt after selecting a reference invalidates the confirmed preview',async()=>{
 const h=harness();await h.exports.setInventorySyncReference('store','run','rocket_now','preview-a');
 h.commands[1].result.items[0].isAvailable=false;h.commands[1].result.items[0].status='sold_out';
 await assert.rejects(h.exports.applyUberAvailabilitySync('store',{fullSyncRunId:'run',targets:[target]},result,true,options(h)),/プレビュー/);
 assert.equal(h.transactions.length,0);
});
test('Demae exact DOM proof does not invent a physicalId while native-stock proof requires the real one',async()=>{
 const h=harness();await h.exports.setInventorySyncReference('store','run','demae_can','preview-a');
 assert.equal(h.details.referencePlatform,'demae_can');assert.equal(h.transactions.length,0);
 const bad=harness();bad.commands[1].result.items[0].nativeMatchBasis='native_stock';
 bad.commands[1].result.items[0].nativeObservations[0].matchBasis='native_stock';
 bad.commands[1].result.items[0].nativeObservations[0].physicalId='999';
 await assert.rejects(bad.exports.setInventorySyncReference('store','run','demae_can','preview-a'));
 assert.equal(bad.transactions.length,0);
});
