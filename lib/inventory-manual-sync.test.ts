import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {validateUberAvailability} from './inventory-authority-policy.ts';
import {buildInventoryComparison} from './inventory-comparison.ts';

const target={kind:'option',targetId:'00000000-0000-4000-8000-000000000001',brandId:'00000000-0000-4000-8000-000000000002',label:'配料',aliases:[],knownExternalIds:['uber-option']};
const result={targetCount:1,items:[{kind:'option',targetId:target.targetId,found:true,isAvailable:false,status:'sold_out'}]};
function harness({applied=false,missingDemae=false,busy=false,phase='awaiting_confirmation',expired=false,changed=false,quarantined=false,staged=false}={}) {
  const transactions:Array<Array<{text:string;values:unknown[]}>>=[];
  let wakes=0;
  let sequence=0;
  const sql=Object.assign((parts:TemplateStringsArray,...values:unknown[])=>{
    const text=parts.join('?');
    let rows:unknown[]=[];
    if(text.includes('select details'))rows=[{details:{osApplied:applied,targetCount:1,phase,comparisonVersion:1,comparisonPlatforms:['rocket_now','demae_can'],comparisonExclusions:quarantined?[{platform:'demae_can',kind:target.kind,targetId:target.targetId}]:[],preview:[{...target,isAvailable:false,wasAvailable:true}],previewAt:new Date(Date.now()-(expired?660000:0)).toISOString()}}];
    if(text.includes("payload->>'comparisonAudit'='true'"))rows=['rocket_now','demae_can'].map(platform=>({platform,status:'succeeded',payload:{comparisonAudit:true,targets:platform==='demae_can'&&missingDemae?[]:[{...target,knownExternalIds:[platform==='rocket_now'?'rocket-option':'demae-option']}]},result:{items:[{kind:target.kind,targetId:target.targetId,found:true,isAvailable:true,status:'available'}]}}));
    if(text.includes('select 1 where exists'))rows=changed?[{}]:[];
    if(staged&&text.includes("payload->>'comparisonAudit'='true'"))for(const row of rows as any[])if(row.platform==='demae_can')row.result.items=[{kind:target.kind,targetId:target.targetId,found:true,isAvailable:null,status:'staged',stagingVerified:true}];
    if(text.includes('select id from local_bridge_commands'))rows=busy?[{id:'busy'}]:[];
    if(text.includes('select 1 from store_sales_sources'))rows=[{}];
    if(text.includes('select distinct source_platform'))rows=[{platform:'rocket_now'},{platform:'demae_can'}];
    if(text.includes('jsonb_each(s.publish_config)') && quarantined)rows=[{platform:'demae_can',kind:target.kind,targetId:target.targetId}];
    return {text,values,then:(resolve:(v:unknown[])=>void)=>Promise.resolve(rows).then(resolve)};
  },{transaction:async(queries:Array<{text:string;values:unknown[]}>)=>{transactions.push(queries);return [];}});
  const mappings=new Map([['uber_eats:option:'+target.targetId,['uber-option']],['rocket_now:option:'+target.targetId,['rocket-option']],
    ...(!missingDemae?[['demae_can:option:'+target.targetId,['demae-option']] as [string,string[]]]:[])]);
  const modules:Record<string,unknown>={
    'node:crypto':{randomUUID:()=>`uuid-${++sequence}`},'./db':{sql},
    './inventory-platform-object-mappings':{loadDemaeStagingHints:async()=>[],loadInventoryPlatformExternalIdMap:async()=>mappings,inventoryPlatformExternalIds:(map:Map<string,string[]>,platform:string,t:typeof target)=>map.get(`${platform}:${t.kind}:${t.targetId}`)??[]},
    './inventory-operation-lock':{withInventoryOperationLock:async(_store:string,fn:()=>Promise<unknown>)=>fn(),assertNoWholeStoreSync:async()=>{}},
    './inventory-authority-policy':{validateUberAvailability},
    './inventory-comparison':{buildInventoryComparison},
    './local-bridge-realtime':{publishBridgeCommandAvailable:async()=>{wakes++;}}
  };
  const exports:Record<string,(...args:unknown[])=>Promise<unknown>>={};
  runInNewContext(ts.transpileModule(readFileSync(new URL('./inventory-manual-sync.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:(name:string)=>{if(!(name in modules))throw Error(name);return modules[name];}});
  return {exports,transactions,wakes:()=>wakes};
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
