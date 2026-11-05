// Actual claim/ACK route SQL and guarded retry SQL execute only in isolated
// PGlite. No real database, Bridge, browser or native writes are used.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {retryInventorySyncCommandSql} from './inventory-sync-attention.ts';
import {reconcileInventoryCommandsSql} from './inventory-command-supersession.ts';
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const routeFile=process.env.BRIDGE_COMMAND_ROUTE_SOURCE||'app/api/local-bridge/uber-eats/commands/route.ts';
const target={kind:'option',targetId:'a',label:'same name',knownExternalIds:['native-a']};
const device='11111111-1111-4111-8111-111111111111';
const queued={progress:{phase:'queued',attempt:1,maxAttempts:3}};
async function fixture() {
 const db=new PGlite();let clock='2026-10-21T04:00:00Z';
 const atClock=(query:string)=>query.replace(/\bnow\(\)/gi,`'${clock}'::timestamptz`);
 await db.exec(`create table local_bridge_commands (
  id text primary key,store_id text default 'store',platform text default 'uber_eats',command_type text default 'set_inventory_availability',
  status text default 'failed',payload jsonb default '{}',result jsonb default '{}',last_error text default '',attempts int default 0,
  created_at timestamptz,updated_at timestamptz,available_at timestamptz,
  claimed_by_device_id uuid,claimed_at timestamptz,claim_expires_at timestamptz,completed_at timestamptz);
  create table local_bridge_devices(id text,store_id text default 'store',platform text default 'desktop',is_enabled boolean,health_status jsonb);
  insert into local_bridge_devices(id,is_enabled,health_status) values('${device}',true,'{"connectionRecoveryVersion":1}')`);
 const query=async(text:string,args:unknown[]=[])=>{
  // These independent menu/order consumers are outside this inventory test.
  // Every actual local command expiry/claim/progress/completion query runs.
  if(/menu_change_sync_tasks|menu_publish_batches|menu_uber_sources|^\s*update local_bridge_devices/.test(text))return [];
  return (await db.query(atClock(text),args)).rows;
 };
 const sql=Object.assign(async(strings:TemplateStringsArray,...values:unknown[])=>{
  const text=strings.reduce((out,part,index)=>out+(index?`$${index}`:'')+part,'');
  return query(text,values);
 },{query});
 const auth={authorized:true,storeId:'store',deviceId:device,devicePlatform:'desktop'};
 const exports:{GET?:(req:Request)=>Promise<Response>;POST?:(req:Request)=>Promise<Response>}={};
 const modules:Record<string,unknown>={
  db:{sql},'next/server':{after:()=>{}},'local-bridge-auth':{authorizeLocalBridge:async()=>auth},
  'inventory-command-supersession':{reconcileInventoryCommandsSql},'menu-sync-status':{menuSyncIssue:()=>null},
  'local-bridge-realtime':{publishBridgeCommandUpdated:async()=>{},publishBridgeInventoryUpdated:async()=>{}}
 };
 vm.runInNewContext(ts.transpileModule(readFileSync(routeFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Response,URL,Date:class extends Date {static now(){return Date.parse(clock);}},require:(name:string)=>modules[name]??modules[name.split('/').at(-1)!]??{}});
 const add=async(id:string,{age=180,status='failed',payload={},type='set_inventory_availability',store='store',platform='uber_eats'}:{age?:number;status?:string;payload?:Record<string,unknown>;type?:string;store?:string;platform?:string}={})=>
  query(`insert into local_bridge_commands(id,store_id,platform,command_type,status,payload,created_at,updated_at,available_at)
   values($1,$2,$3,$4,$5,$6,now()-$7::numeric*interval '1 minute',now(),now())`,
   [id,store,platform,type,status,JSON.stringify({syncRunId:id,isAvailable:false,targets:[target],...payload}),age]);
 const retry=async(id:string)=>query(retryInventorySyncCommandSql,[id,'store',JSON.stringify(queued)]);
 const row=async(id:string)=>(await query('select *,created_at::text as "createdAt",claimed_at::text as "claimedAt",claim_expires_at::text as "claimExpiresAt" from local_bridge_commands where id=$1',[id]))[0] as Record<string,any>;
 const get=()=>exports.GET!(new Request('https://test/api/local-bridge/uber-eats/commands?storeId=store&platformMode=desktop'));
 const post=(id:string,status='processing',result:Record<string,unknown>={progress:{phase:'processing',attempt:1}})=>exports.POST!(new Request('https://test/api/local-bridge/uber-eats/commands?storeId=store&platformMode=desktop',
  {method:'POST',body:JSON.stringify({commandId:id,status,result})}));
 return {db,auth,query,add,retry,row,get,post,setClock:(value:string)=>{clock=value;}};
}

test('guarded manual retry after original two-hour TTL can claim, report progress and complete without changing intent time/ID',async()=>{
 const f=await fixture();try {
  await f.add('original');const before=await f.row('original');
  assert.equal((await f.retry('original')).length,1);
  const retried=await f.row('original');assert.equal(retried.createdAt,before.createdAt);assert.equal(retried.attempts,0);
  assert.ok(retried.payload.manualRetryAt);assert.equal(retried.payload.isAvailable,false);
  const response=await f.get();assert.equal(response.status,200);
  const {command}=await response.json();assert.equal(command.id,'original');assert.equal(command.attempts,1);
  f.setClock('2026-10-21T04:01:00Z');assert.equal((await f.post('original')).status,200);
  assert.equal(Date.parse((await f.row('original')).claimExpiresAt),Date.parse('2026-10-21T04:16:00Z'));
  assert.equal((await f.post('original','succeeded')).status,200);
  const done=await f.row('original');assert.equal(done.status,'succeeded');assert.equal(done.createdAt,before.createdAt);assert.equal(done.id,'original');
 } finally {await f.db.close();}
});

test('heartbeats and automatic lease requeues never move the absolute two-hour manual retry deadline',async()=>{
 const f=await fixture();try {
  await f.add('bounded');await f.retry('bounded');await f.get();
  f.setClock('2026-10-21T05:55:00Z');assert.equal((await f.post('bounded')).status,200);
  assert.equal(Date.parse((await f.row('bounded')).claimExpiresAt),Date.parse('2026-10-21T06:00:00Z'));
  f.setClock('2026-10-21T06:00:01Z');assert.equal((await f.post('bounded')).status,409);
  await f.get();const expired=await f.row('bounded');
  assert.equal(expired.status,'failed');assert.equal(expired.last_error,'Bridge command expired before execution.');
  assert.equal(Date.parse(expired.payload.manualRetryAt),Date.parse('2026-10-21T04:00:00Z'));
 } finally {await f.db.close();}
});

test('a newly superseding exact kind + target ID still cancels the old retried intent before claim',async()=>{
 const f=await fixture();try {
  await f.add('old');const before=await f.row('old');await f.retry('old');
  await f.add('new',{age:1,status:'pending',payload:{isAvailable:true}});
  const {command}=await (await f.get()).json();assert.equal(command.id,'new');
  assert.equal((await f.row('old')).status,'cancelled');assert.equal((await f.row('old')).createdAt,before.createdAt);
 } finally {await f.db.close();}
});

test('partial overlap and same-name/different-kind targets retain exact identity rules during renewed retry',async()=>{
 const f=await fixture();try {
  const retained={...target,kind:'item',targetId:'b',knownExternalIds:['native-b']};
  await f.add('partial',{payload:{targets:[target,retained]}});
  await f.add('new',{age:1,status:'succeeded'});
  assert.equal((await f.retry('partial')).length,1);
  assert.deepEqual((await f.row('partial')).payload.targets,[retained]);
  const {command}=await (await f.get()).json();assert.equal(command.id,'partial');assert.deepEqual(command.payload.targets,[retained]);
 } finally {await f.db.close();}
});

test('retry writer still blocks missing identity, unknown/newer intent, mapping block, active work and unsupported Demae release',async()=>{
 const f=await fixture();try {
  const cases:[string,Record<string,unknown>,Record<string,unknown>][]=[
   ['missing-native-id',{targets:[{...target,knownExternalIds:[]}]},{}],['unknown-run',{syncRunId:''},{}],
   ['blocked-mapping',{mappingBlocked:true},{}],['active',{}, {status:'processing'}],
   ['legacy-demae-release',{isAvailable:true},{platform:'demae_can'}]
  ];
  for(const [id,payload,extra] of cases) {
   await f.query('truncate local_bridge_commands');await f.add(id,{...extra,payload});assert.equal((await f.retry(id)).length,0,id);
   assert.equal((await f.row(id)).payload.manualRetryAt,undefined,id);
  }
 } finally {await f.db.close();}
});

for(const [label,value] of Object.entries({absent:undefined,malformed:'not a timestamp',impossibleDate:'2026-02-30T04:00:00Z',
 future:'2030-01-01T00:00:00Z',beforeCreation:'2020-01-01T00:00:00Z',relative:'now',infinite:'infinity',number:1,object:{at:'2026-10-21T04:00:00Z'}}))
 test(`untrusted or absent retry timestamp does not extend default command expiry: ${label}`,async()=>{
  const f=await fixture();try {
   await f.add('old',{status:'pending',payload:{manualRetryAt:value}});
   assert.equal((await f.get()).status,200);assert.equal((await f.row('old')).status,'failed');
  } finally {await f.db.close();}
 });

test('updated_at/available_at alone and inventory retry metadata on another command type do not renew TTL',async()=>{
 const f=await fixture();try {
  await f.add('old',{status:'pending'});
  await f.add('read',{status:'pending',type:'audit_inventory',payload:{manualRetryAt:'2026-10-21T04:00:00Z'}});
  await f.get();assert.equal((await f.row('old')).status,'failed');assert.equal((await f.row('read')).status,'failed');
 } finally {await f.db.close();}
});

test('fresh inventory commands keep their default execution window without any retry metadata',async()=>{
 const f=await fixture();try {
  await f.add('fresh',{age:1,status:'pending'});
  const {command}=await (await f.get()).json();assert.equal(command.id,'fresh');assert.equal(command.payload.manualRetryAt,undefined);
  assert.equal((await f.post('fresh')).status,200);
 } finally {await f.db.close();}
});

test('existing authoritative menu retry history continues to renew only its existing menu window',async()=>{
 const f=await fixture();try {
  await f.add('menu',{status:'pending',type:'publish_menu_changes',payload:{authoritativePublication:true,manualRetryHistory:[{at:'2026-10-21T04:00:00Z'}]}});
  const {command}=await (await f.get()).json();assert.equal(command.id,'menu');assert.equal(command.type,'publish_menu_changes');
 } finally {await f.db.close();}
});

test('scoped connection reset has pending priority and one fixed five-minute lease, never inventory work',async()=>{
 const f=await fixture();try {
  await f.add('inventory',{age:1,status:'pending'});
  await f.add('reset',{age:0,status:'pending',type:'reset_platform_connection',payload:{deviceId:device}});
  const {command}=await (await f.get()).json();assert.equal(command.id,'reset');assert.equal((await f.row('inventory')).attempts,0);
  const lease=(await f.row('reset')).claimExpiresAt;assert.equal(Date.parse(lease),Date.parse('2026-10-21T04:05:00Z'));
  f.setClock('2026-10-21T04:01:00Z');assert.equal((await f.post('reset')).status,200);assert.equal((await f.row('reset')).claimExpiresAt,lease);
  assert.equal((await f.post('reset','succeeded',{connectionRecovered:true,inventoryChanged:false,verifiedAt:'2026-10-21T04:01:00.000Z',rawSecret:'discard'})).status,200);
  assert.deepEqual((await f.row('reset')).result,{connectionRecovered:true,inventoryChanged:false,verifiedAt:'2026-10-21T04:01:00.000Z'});
  assert.equal((await f.row('inventory')).status,'pending');assert.equal((await f.row('inventory')).attempts,0);
 } finally {await f.db.close();}
});

test('connection reset never interrupts already-processing work, even work owned by another device',async()=>{
 const f=await fixture();try {
  await f.add('inventory',{age:1,status:'processing'});
  await f.query(`update local_bridge_commands set attempts=1,claimed_by_device_id=$1::uuid,claimed_at=now(),claim_expires_at=now()+interval '15 minutes' where id='inventory'`,[device]);
  await f.add('reset',{age:0,status:'pending',type:'reset_platform_connection',payload:{deviceId:device}});
  assert.equal((await (await f.get()).json()).command.id,'inventory');assert.equal((await f.row('reset')).attempts,0);
  await f.query("update local_bridge_commands set claimed_by_device_id='22222222-2222-4222-8222-222222222222' where id='inventory'");
  assert.equal((await (await f.get()).json()).command,null);assert.equal((await f.row('reset')).attempts,0);
 } finally {await f.db.close();}
});

test('reset claim requires exact bound desktop device, current capability and single enabled device',async()=>{
 const f=await fixture();try {
  const cases:[string,()=>Promise<unknown>][]=[
   ['wrong bound device',async()=>f.query("update local_bridge_commands set payload=jsonb_set(payload,'{deviceId}','\"other\"')")],
   ['missing capability',async()=>f.db.exec("update local_bridge_devices set health_status='{}'")],
   ['disabled device',async()=>f.db.exec('update local_bridge_devices set is_enabled=false')],
   ['foreign store device',async()=>f.db.exec("update local_bridge_devices set store_id='other'")],
   ['multiple enabled devices',async()=>f.db.exec("insert into local_bridge_devices(id,is_enabled,health_status) values('second',true,'{\"connectionRecoveryVersion\":1}')")],
   ['tablet caller',async()=>{f.auth.devicePlatform='android';}]
  ];
  for(const [label,mutate] of cases) {
   await f.query('truncate local_bridge_commands');await f.db.exec('truncate local_bridge_devices');
   await f.db.exec(`insert into local_bridge_devices(id,is_enabled,health_status) values('${device}',true,'{"connectionRecoveryVersion":1}')`);
   f.auth.devicePlatform='desktop';await f.add('reset',{age:0,status:'pending',type:'reset_platform_connection',payload:{deviceId:device}});
   await mutate();assert.equal((await (await f.get()).json()).command,null,label);assert.equal((await f.row('reset')).attempts,0,label);
  }
 } finally {await f.db.close();}
});

test('reset ACK rejects missing/stale/changed-inventory proof and device drift before terminal success',async()=>{
 const f=await fixture();try {
  await f.add('reset',{age:0,status:'pending',type:'reset_platform_connection',payload:{deviceId:device}});await f.get();
  const good={connectionRecovered:true,inventoryChanged:false,verifiedAt:'2026-10-21T04:00:01.000Z'};
  f.setClock('2026-10-21T04:00:02Z');
  for(const invalid of [{},{...good,connectionRecovered:false},{...good,inventoryChanged:true},{...good,verifiedAt:'invalid'},
   {...good,verifiedAt:'2026-10-21T03:59:59.000Z'},{...good,verifiedAt:'2026-10-21T04:05:00.000Z'}]) {
   assert.equal((await f.post('reset','succeeded',invalid)).status,409);assert.equal((await f.row('reset')).status,'processing');
  }
  await f.db.exec("update local_bridge_devices set health_status='{}'");assert.equal((await f.post('reset','succeeded',good)).status,409);
  await f.db.exec("update local_bridge_devices set health_status='{\"connectionRecoveryVersion\":1}'");
  assert.equal((await f.post('reset','succeeded',good)).status,200);assert.equal((await f.row('reset')).status,'succeeded');
 } finally {await f.db.close();}
});

test('failed and expired resets stay terminal instead of automatically replaying a browser close',async()=>{
 const f=await fixture();try {
  await f.add('reset',{age:0,status:'pending',type:'reset_platform_connection',payload:{deviceId:device}});await f.get();
  assert.equal((await f.post('reset','failed',{arbitrary:'discard'})).status,200);
  assert.equal((await f.row('reset')).status,'failed');assert.deepEqual((await f.row('reset')).result,{});
  assert.equal((await (await f.get()).json()).command,null);
  await f.query('truncate local_bridge_commands');
  await f.add('reset',{age:0,status:'pending',type:'reset_platform_connection',payload:{deviceId:device}});await f.get();
  f.setClock('2026-10-21T04:05:01Z');assert.equal((await f.post('reset')).status,409);
  await f.get();assert.equal((await f.row('reset')).status,'failed');assert.equal((await f.row('reset')).last_error,'connection_recovery_expired');
  assert.equal((await f.row('reset')).attempts,1);assert.equal((await (await f.get()).json()).command,null);
 } finally {await f.db.close();}
});
