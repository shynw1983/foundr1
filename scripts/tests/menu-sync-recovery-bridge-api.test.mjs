// Execute the actual Bridge command/status handlers and their PostgreSQL SQL.
// Authentication and external services are stubs; no environment/live DB loads.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const {PGlite}=await import(process.env.FOUNDR1_PGLITE_MODULE||process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=new URL('../../',import.meta.url);
function load(path,mocks) {
 const exports={};
 const source=ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(source,{exports,Date,Error,Request,Response,URL,console,process,structuredClone,
  require:name=>name.startsWith('node:')?require(name):mocks[name.split('/').at(-1).replace(/\.ts$/,'')]??assert.fail(`Unexpected import ${name}`)});
 return exports;
}
async function fixture() {
 const db=new PGlite(),ids=Object.fromEntries(['store','device','otherDevice','command','otherCommand'].map(key=>[key,randomUUID()]));
 await db.exec(`
 create table local_bridge_commands(id uuid primary key,store_id uuid,platform text,command_type text,status text default 'pending',attempts int default 0,
 payload jsonb,result jsonb default '{}',last_error text default '',created_at timestamptz default now(),updated_at timestamptz default now(),
 available_at timestamptz default now(),completed_at timestamptz,claimed_by_device_id uuid,claimed_at timestamptz,claim_expires_at timestamptz);
 create table local_bridge_devices(id uuid primary key,store_id uuid,platform text,is_enabled bool,health_status jsonb,last_seen_at timestamptz,last_status_at timestamptz,updated_at timestamptz);
 create table menu_change_sync_tasks(command_id uuid,publish_batch_id uuid,status text,phase text,attempts int,error_code text,error_detail text,is_retryable bool,updated_at timestamptz,completed_at timestamptz);
 create table menu_publish_batches(id uuid,store_id uuid,status text,completed_at timestamptz,updated_at timestamptz);
 create table menu_uber_sources(store_id uuid,brand_id uuid,enabled bool,revision int);
 `);
 await db.query("insert into local_bridge_devices(id,store_id,platform,is_enabled,health_status) values($1,$2,'desktop',true,'{\"menuSyncRecoveryVersion\":1}')",[ids.device,ids.store]);
 const queries=[],guardCalls=[],ackCalls=[],events=[];let guardError,deviceId=ids.device,devicePlatform='desktop',authorized=true;
 const sql=(parts,...params)=>{
  const text=parts.map((part,index)=>part+(index<params.length?`$${index+1}`:'')).join('');
  return {then(resolve,reject){queries.push({text,params});return db.query(text,params).then(result=>result.rows).then(resolve,reject);}};
 };
 sql.query=async()=>[];
 const noop=async()=>{};
 const service=load('lib/menu-sync-recovery-store.ts',{
  db:{sql},'inventory-operation-lock':{withInventoryOperationLock:async(_store,fn)=>fn()},'local-bridge-realtime':{publishBridgeCommandAvailable:noop},
  'uber-authority-parents.mjs':{},'uber-menu-publication-reconcile':{},'menu-sync-recovery':{}
 });
 const recovery={
  guardMenuRecoveryCommand:async(input,writeGuard)=>{guardCalls.push({input,writeGuard});if(guardError)throw Error(guardError);return {};},
  acknowledgeMenuRecovery:async input=>{ackCalls.push(input);assert.equal(input.status,'failed','Only failure ACK is unstubbed in this route fixture');return service.acknowledgeMenuRecovery(input);}
 };
 const mocks={
  db:{sql},'local-bridge-auth':{authorizeLocalBridge:async()=>({authorized,deviceId,devicePlatform})},
  server:{after:noop},'inventory-sync-notifications':{notifyInventorySyncAttention:noop},'inventory-command-supersession':{reconcileInventoryCommandsSql:'select 1'},
  'inventory-manual-sync':{applyUberAvailabilitySync:async()=>assert.fail('Recovery reached stock result dispatch')},
  'menu-sync-status':{menuSyncIssue:()=>null},'menu-name-adaptation':{findRejectedMenuNameTargets:()=>[]},'menu-platform-snapshot-merge':{},
  'uber-menu-source-sync':{ingestUberMenuSource:async()=>assert.fail('Recovery reached source ingestion')},
  'order-realtime':{publishPublicMenuUpdatedEvent:noop},'competitor-bridge-snapshot':{applyCompetitorBridgeSnapshot:async()=>assert.fail('Recovery reached competitor dispatch')},
  'local-bridge-realtime':{publishBridgeCommandUpdated:async(...args)=>events.push(args),publishBridgeInventoryUpdated:async()=>assert.fail('Recovery published stock update'),publishBridgeStatus:async(...args)=>events.push(args)},
  'menu-sync-recovery-store':recovery,
  'uber-menu-publication-store':{recordUberPublicationProgress:async()=>assert.fail('Recovery reached ordinary publication dispatch')}
 };
 const commands=load('app/api/local-bridge/uber-eats/commands/route.ts',mocks),status=load('app/api/local-bridge/uber-eats/status/route.ts',mocks);
 const url=`http://isolated.test/api/local-bridge/uber-eats/commands?storeId=${ids.store}&platformMode=all`;
 return {db,ids,queries,guardCalls,ackCalls,events,
  asDevice(id=ids.device,platform='desktop'){deviceId=id;devicePlatform=platform;},asUnauthorized(){authorized=false;},rejectGuard(error){guardError=error;},
  async insert({id=ids.command,type='inspect_menu_sync',state='pending',boundDevice=ids.device,owner=ids.device,age=0,lease=5,attempts=0}={}) {
   await db.query(`insert into local_bridge_commands(id,store_id,platform,command_type,status,attempts,payload,result,created_at,claimed_by_device_id,claimed_at,claim_expires_at)
    values($1,$2,'rocket_now',$3,$4,$5,$6,'{"retained":"receipt"}',now()-$7*interval '1 minute',$8,
      case when $4='processing' then now()-interval '1 minute' else null end,case when $4='processing' then now()+$9*interval '1 minute' else null end)`,
    [id,ids.store,type,state,attempts,JSON.stringify({authoritativePublication:true,recovery:{deviceId:boundDevice}}),age,state==='processing'?owner:null,lease]);
  },
  row:async(id=ids.command)=>(await db.query('select *,extract(epoch from (claim_expires_at-now())) lease_seconds from local_bridge_commands where id=$1',[id])).rows[0],
  get:()=>commands.GET(new Request(url)),
  ack:(state='processing',result={progress:{phase:'recovery_guard',recoveryGuard:true}},error='native read failed')=>commands.POST(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId:ids.command,status:state,result,error})})),
  report:body=>status.POST(new Request('http://isolated.test/api/local-bridge/uber-eats/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({storeId:ids.store,level:'healthy',...body})}))
 };
}

for(const type of ['inspect_menu_sync','repair_menu_sync'])test(`actual GET claims ${type} only for the capable bound desktop, with fixed five-minute lease`,async()=>{
 const h=await fixture();try {
  await h.insert({type});const response=await h.get();assert.equal(response.status,200);const body=await response.json();assert.equal(body.command.id,h.ids.command);assert.equal(body.command.type,type);
  let row=await h.row();assert.equal(row.status,'processing');assert.equal(row.attempts,1);assert.equal(row.claimed_by_device_id,h.ids.device);assert.ok(Number(row.lease_seconds)>290&&Number(row.lease_seconds)<=300);
  const claim=row.claimed_at.toISOString(),expires=row.claim_expires_at.toISOString();
  assert.equal((await (await h.get()).json()).command.id,h.ids.command);row=await h.row();assert.equal(row.attempts,1);assert.equal(row.claimed_at.toISOString(),claim);
  assert.equal((await h.ack()).status,200);row=await h.row();assert.equal(row.claim_expires_at.toISOString(),expires,'Recovery heartbeats must never extend the absolute lease');
  assert.equal(row.result.retained,'receipt');assert.equal(row.result.progress.phase,'recovery_guard');assert.equal(h.guardCalls.length,1);assert.equal(h.guardCalls[0].writeGuard,true);assert.equal(h.ackCalls.length,0);
 } finally {await h.db.close();}
});

test('actual tablet GET neither claims, resumes nor generically expires recovery commands',async()=>{
 const h=await fixture();try {
  h.asDevice(h.ids.device,'rocket_now');await h.insert();assert.equal((await (await h.get()).json()).command,null);assert.equal((await h.row()).status,'pending');
  await h.db.query("update local_bridge_commands set status='processing',attempts=1,claimed_by_device_id=$1,claimed_at=now()-interval '3 hours',created_at=now()-interval '3 hours',claim_expires_at=now()+interval '2 minutes' where id=$2",[h.ids.device,h.ids.command]);
  assert.equal((await (await h.get()).json()).command,null);const row=await h.row();assert.equal(row.status,'processing');assert.equal(row.attempts,1);assert.equal(row.claimed_by_device_id,h.ids.device);
 } finally {await h.db.close();}
});

for(const scenario of ['wrong-device','unsupported-version','disabled','store-busy'])test(`actual claim gate rejects ${scenario} without changing recovery state`,async()=>{
 const h=await fixture();try {
  await h.insert({boundDevice:scenario==='wrong-device'?h.ids.otherDevice:h.ids.device});
  if(scenario==='unsupported-version')await h.db.exec("update local_bridge_devices set health_status='{\"menuSyncRecoveryVersion\":0}'");
  if(scenario==='disabled')await h.db.exec('update local_bridge_devices set is_enabled=false');
  if(scenario==='store-busy')await h.insert({id:h.ids.otherCommand,type:'mark_order_ready',state:'processing',owner:h.ids.otherDevice});
  assert.equal((await (await h.get()).json()).command,null);const row=await h.row();assert.equal(row.status,'pending');assert.equal(row.attempts,0);assert.equal(row.claimed_at,null);
 } finally {await h.db.close();}
});

for(const state of ['pending','processing'])test(`five-minute expired ${state} recovery becomes terminal before generic requeue`,async()=>{
 const h=await fixture();try {
  await h.insert({state,age:state==='pending'?6:1,lease:-1,attempts:1});assert.equal((await (await h.get()).json()).command,null);
  const row=await h.row();assert.equal(row.status,'failed');assert.equal(row.last_error,'menu_sync_recovery_expired');assert.equal(row.attempts,1);assert.ok(row.completed_at);assert.deepEqual(row.result,{retained:'receipt'});
 } finally {await h.db.close();}
});

test('actual processing ACK rejects tablet and another device before recovery guard or persistence',async()=>{
 const h=await fixture();try {
  await h.insert({state:'processing'});const before=await h.row();h.asDevice(h.ids.device,'rocket_now');assert.equal((await h.ack()).status,403);
  h.asDevice(h.ids.otherDevice);assert.equal((await h.ack()).status,409);const after=await h.row();assert.equal(h.guardCalls.length,0);assert.equal(h.ackCalls.length,0);assert.deepEqual(after.result,before.result);assert.equal(after.claim_expires_at.toISOString(),before.claim_expires_at.toISOString());
 } finally {await h.db.close();}
});

test('fresh server guard rejection stops processing result persistence and lease renewal',async()=>{
 const h=await fixture();try {
  await h.insert({type:'repair_menu_sync',state:'processing'});const before=await h.row();h.rejectGuard('newer_inventory_intent');
  for(const writeGuard of [true,false]) {
   const response=await h.ack('processing',{progress:{phase:writeGuard?'recovery_guard':'recovery_inspecting',recoveryGuard:writeGuard}});assert.equal(response.status,409);assert.equal((await response.json()).error,'newer_inventory_intent');
   assert.equal(h.guardCalls.at(-1).writeGuard,writeGuard);
  }
  const after=await h.row();assert.equal(after.status,'processing');assert.deepEqual(after.result,before.result);assert.equal(after.claim_expires_at.toISOString(),before.claim_expires_at.toISOString());assert.equal(h.guardCalls.length,2);assert.equal(h.ackCalls.length,0);
 } finally {await h.db.close();}
});

test('failure ACK executes actual service terminal update for the exact owned recovery command',async()=>{
 const h=await fixture();try {
  await h.insert({type:'repair_menu_sync',state:'processing'});await h.insert({id:h.ids.otherCommand,type:'repair_menu_sync',state:'processing',owner:h.ids.otherDevice});
  const otherBefore=await h.row(h.ids.otherCommand);h.asDevice(h.ids.otherDevice);assert.equal((await h.ack('failed')).status,409);assert.equal((await h.row()).status,'processing');
  h.asDevice();assert.equal((await h.ack('failed',{},'native outcome unknown')).status,200);const row=await h.row();assert.equal(row.status,'failed');assert.equal(row.last_error,'native outcome unknown');assert.ok(row.completed_at);assert.equal(h.ackCalls.length,1);assert.equal(h.guardCalls.length,0);
  const otherAfter=await h.row(h.ids.otherCommand);assert.equal(otherAfter.status,'processing');assert.deepEqual(otherAfter.result,otherBefore.result);assert.equal((await h.ack('failed')).status,409);
 } finally {await h.db.close();}
});

test('status capability is whitelisted as version one only from an authenticated desktop device',async()=>{
 const h=await fixture();try {
  for(const [platform,version,expected] of [['desktop',1,1],['desktop',2,0],['desktop','1',0],['rocket_now',1,0],['uber_eats',1,0]]) {
   h.asDevice(h.ids.device,platform);const response=await h.report({menuSyncRecoveryVersion:version,platformMode:'desktop',changed:true,unsafeCapability:'invented'});assert.equal(response.status,200);
   const body=await response.json();assert.equal(body.status.menuSyncRecoveryVersion,expected);assert.equal('unsafeCapability' in body.status,false);
   const saved=(await h.db.query('select health_status from local_bridge_devices where id=$1',[h.ids.device])).rows[0].health_status;assert.equal(saved.menuSyncRecoveryVersion,expected);assert.equal('unsafeCapability' in saved,false);
  }
 } finally {await h.db.close();}
});

test('unauthorized requests cannot claim, acknowledge or advertise recovery capability',async()=>{
 const h=await fixture();try {
  await h.insert();h.asUnauthorized();assert.equal((await h.get()).status,401);assert.equal((await h.ack()).status,401);assert.equal((await h.report({menuSyncRecoveryVersion:1})).status,401);assert.equal((await h.row()).status,'pending');assert.equal(h.queries.length,0);
 } finally {await h.db.close();}
});
