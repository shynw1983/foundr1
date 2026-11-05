import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url),root=new URL('../../',import.meta.url);
const {PGlite}=await import(process.env.FOUNDR1_PGLITE_MODULE||'@electric-sql/pglite');
function load(file,mocks){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(file,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Error,Request,Response,URL,console,require:name=>name.startsWith('node:')?require(name):mocks[name.split('/').at(-1)]??assert.fail(`Unexpected import ${name}`)});return exports;}
async function fixture(){
 const db=new PGlite(),ids=Object.fromEntries(['store','otherStore','actor','device','nonce'].map(key=>[key,randomUUID()]));
 await db.exec(`create table stores(id uuid primary key,name text,status text,business_hours jsonb);
 create table local_bridge_devices(id uuid primary key,store_id uuid,platform text,is_enabled bool,last_seen_at timestamptz,last_status_at timestamptz,updated_at timestamptz,health_status jsonb);
 create table menu_inventory_operation_locks(store_id uuid primary key,token uuid,expires_at timestamptz);
 create table local_bridge_commands(id uuid primary key default gen_random_uuid(),store_id uuid,platform text,command_type text,idempotency_key text unique,payload jsonb,result jsonb default '{}',status text default 'pending',created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz,claim_expires_at timestamptz,last_error text default '');`);
 await db.query("insert into stores values($1,'清水店','active','{}')",[ids.store]);
 await db.query("insert into local_bridge_devices values($1,$2,'desktop',true,now(),now(),now(),'{\"connectionRecoveryVersion\":1}')",[ids.device,ids.store]);
 const queries=[],events=[];let role='owner',allowedStore=ids.store,devicePlatform='desktop',loseInsertReply=false;
 const sql=(parts,...params)=>{const text=parts.map((part,index)=>part+(index<params.length?`$${index+1}`:'')).join('');return {then(resolve,reject){queries.push(text);return db.query(text,params).then(result=>{if(loseInsertReply&&/insert into local_bridge_commands/.test(text)){loseInsertReply=false;throw Error('lost database acknowledgement');}return result.rows;}).then(resolve,reject);}};};
 const apiAuth={requireMasterOsSession:async()=>role?{id:ids.actor,role}:null,getSessionStoreScope:async()=>({allStores:false,storeIds:[allowedStore]})};
 const scope=load('lib/store-order-access.ts',{'api-auth':apiAuth,db:{sql},'role-permissions':{roleHasPermission:async()=>true}}),lock=load('lib/inventory-operation-lock.ts',{db:{sql}});
 const route=load('app/api/bridge/connection-recovery/route.ts',{'api-auth':apiAuth,'store-order-access':scope,'inventory-operation-lock':lock,db:{sql},'local-bridge-realtime':{publishBridgeCommandAvailable:async id=>events.push(id)}});
 const status=load('app/api/local-bridge/uber-eats/status/route.ts',{db:{sql},'local-bridge-auth':{authorizeLocalBridge:async()=>({authorized:true,deviceId:ids.device,devicePlatform})},'local-bridge-realtime':{publishBridgeStatus:async()=>{}}});
 const url='http://isolated.test/api/bridge/connection-recovery';
 const post=(body={},headers={origin:'http://isolated.test','sec-fetch-site':'same-origin'})=>route.POST(new Request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({storeId:ids.store,platform:'uber_eats',requestId:ids.nonce,...body})}));
 const get=(params={})=>route.GET(new Request(url+'?'+new URLSearchParams({storeId:ids.store,...params})));
 return {db,ids,queries,events,post,get,role:value=>role=value,scope:value=>allowedStore=value,
  loseNextInsertReply(){loseInsertReply=true;},
  rows:async()=>(await db.query('select * from local_bridge_commands order by created_at')).rows,
  async report(version,platform='desktop'){devicePlatform=platform;return status.POST(new Request('http://isolated.test/api/local-bridge/uber-eats/status',{method:'POST',body:JSON.stringify({storeId:ids.store,connectionRecoveryVersion:version,menuSyncRecoveryVersion:1})}));}};
}
test('actual route queues only reset for one capable scoped device, deduplicates active requests and preserves busy work',async()=>{
 const h=await fixture();try{
  const busy=randomUUID();await h.db.query("insert into local_bridge_commands(id,store_id,platform,command_type,payload,status) values($1,$2,'uber_eats','set_inventory_availability','{\"isAvailable\":false}','processing')",[busy,h.ids.store]);
  const response=await h.post();assert.equal(response.status,200);const body=await response.json(),rows=await h.rows();assert.equal(rows.length,2);const recovery=rows.find(row=>row.id===body.command.id);assert.equal(recovery.command_type,'reset_platform_connection');assert.equal(recovery.payload.deviceId,h.ids.device);assert.equal(recovery.payload.requestId,h.ids.nonce);assert.equal(rows.find(row=>row.id===busy).status,'processing');assert.equal('targets' in recovery.payload,false);
  const again=await h.post({requestId:randomUUID()});assert.equal((await again.json()).command.id,body.command.id);assert.equal((await h.rows()).length,2);
 }finally{await h.db.close();}
});
test('master role and active-store scope protect GET and POST before browser-control queries',async()=>{
 const h=await fixture();try{
  for(const role of ['', 'staff','store_manager','store_owner']){h.role(role);assert.equal((await h.post()).status,403);assert.equal((await h.get({id:randomUUID()})).status,403);}
  h.role('manager');h.scope(h.ids.otherStore);assert.equal((await h.post()).status,403);assert.equal((await h.get({id:randomUUID()})).status,403);assert.equal((await h.rows()).length,0);
  h.scope(h.ids.store);await h.db.exec("update stores set status='inactive'");assert.equal((await h.post()).status,403);
 }finally{await h.db.close();}
});
test('same-origin and sec-fetch-site controls reject cross-site POST without queuing',async()=>{
 const h=await fixture();try{
  for(const headers of [{},{origin:'http://other.test'},{origin:'http://isolated.test','sec-fetch-site':'cross-site'}])assert.equal((await h.post({},headers)).status,403);
  assert.equal((await h.rows()).length,0);
 }finally{await h.db.close();}
});
for(const scenario of ['zero','two','offline','unsupported'])test(`actual POST refuses ${scenario} desktop registration`,async()=>{
 const h=await fixture();try{
  if(scenario==='zero')await h.db.exec('delete from local_bridge_devices');
  if(scenario==='two')await h.db.query("insert into local_bridge_devices values($1,$2,'desktop',true,now(),now(),now(),'{\"connectionRecoveryVersion\":1}')",[randomUUID(),h.ids.store]);
  if(scenario==='offline')await h.db.exec("update local_bridge_devices set last_seen_at=now()-interval '3 minutes'");
  if(scenario==='unsupported')await h.db.exec("update local_bridge_devices set health_status='{\"connectionRecoveryVersion\":0}'");
  assert.equal((await h.post()).status,409);assert.equal((await h.rows()).length,0);
 }finally{await h.db.close();}
});
test('cooldown and expired recovery records never reset stock or interrupt an active command',async()=>{
 const h=await fixture();try{
  await h.post();await h.db.exec("update local_bridge_commands set status='succeeded'");assert.equal((await h.post({requestId:randomUUID()})).status,409);
  await h.db.exec("update local_bridge_commands set status='pending',created_at=now()-interval '6 minutes'");assert.equal((await h.post({requestId:randomUUID()})).status,200);
  const rows=await h.rows();assert.equal(rows.length,2);assert.equal(rows[0].status,'failed');assert.equal(rows[0].last_error,'connection_recovery_expired');assert.equal(rows[1].status,'pending');
 }finally{await h.db.close();}
});
test('GET result allowlist and request nonce cannot mistake an older success or another store for this request',async()=>{
 const h=await fixture();try{
  const response=await h.post(),id=(await response.json()).command.id;
  await h.db.query("update local_bridge_commands set status='succeeded',result=$1,last_error='Cookie secret',payload=payload||'{\"raw\":\"private\"}' where id=$2",[JSON.stringify({connectionRecovered:true,inventoryChanged:false,verifiedAt:new Date().toISOString(),token:'NEVER_RETURN',snapshot:{customer:'private'}}),id]);
  const result=await (await h.get({id})).json();assert.equal(result.command.result.connectionRecovered,true);assert.deepEqual(Object.keys(result.command.result).sort(),['connectionRecovered','inventoryChanged','verifiedAt']);assert.doesNotMatch(JSON.stringify(result),/Cookie|NEVER_RETURN|private|payload|error/);
  assert.equal((await (await h.get({platform:'uber_eats',requestId:randomUUID()})).json()).command,null);
  assert.equal((await (await h.get({platform:'rocket_now',requestId:h.ids.nonce})).json()).command,null);
  assert.equal((await (await h.get({platform:'uber_eats',requestId:h.ids.nonce})).json()).command.id,id);
  assert.equal((await h.get({platform:'uber_eats'})).status,400);assert.equal((await h.get({storeId:h.ids.otherStore,id})).status,403);
 }finally{await h.db.close();}
});
test('lost insert acknowledgement is reported unknown and can be read by exact request nonce without replay',async()=>{
 const h=await fixture();try{
  h.loseNextInsertReply();const response=await h.post();assert.equal(response.status,503);assert.equal((await response.json()).error,'request_unknown');
  const rows=await h.rows();assert.equal(rows.length,1);assert.equal(rows[0].status,'pending');
  const observed=await (await h.get({platform:'uber_eats',requestId:h.ids.nonce})).json();assert.equal(observed.command.id,rows[0].id);
 }finally{await h.db.close();}
});
test('held store operation lock gives explicit busy rejection without adding a browser command',async()=>{
 const h=await fixture();try{
  await h.db.query("insert into menu_inventory_operation_locks values($1,$2,now()+interval '5 minutes')",[h.ids.store,randomUUID()]);
  const response=await h.post();assert.equal(response.status,409);assert.equal((await response.json()).error,'busy');assert.equal((await h.rows()).length,0);
 }finally{await h.db.close();}
});
test('actual status sanitizer retains truthful capability only for desktop numeric version one',async()=>{
 const h=await fixture();try{
  for(const [version,platform,expected] of [[1,'desktop',1],[2,'desktop',0],['1','desktop',0],[1,'uber_eats',0],[1,'rocket_now',0]]){
   const response=await h.report(version,platform);assert.equal(response.status,200);assert.equal((await response.json()).status.connectionRecoveryVersion,expected);
   const row=(await h.db.query('select health_status from local_bridge_devices where id=$1',[h.ids.device])).rows[0];assert.equal(row.health_status.connectionRecoveryVersion,expected);
  }
 }finally{await h.db.close();}
});
