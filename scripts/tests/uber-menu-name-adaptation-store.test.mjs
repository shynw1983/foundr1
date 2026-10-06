// Real PostgreSQL tests for the production name adapter SQL. AI generation is
// stubbed. Manual route tests also stub the shared publication reconciler;
// its complete manifest/CAS SQL is covered by uber-menu-publication-reconcile.
// DATABASE_URL is never loaded or used.
// Run with PGLITE_MODULE pointing to an isolated @electric-sql/pglite install.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {resolve,dirname,relative} from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=resolve(dirname(new URL(import.meta.url).pathname),'../..');
const json=value=>JSON.parse(JSON.stringify(value));
const defer=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};

async function fixture({kind='option_group',attempts=1,status='processing'}={}) {
 const db=new PGlite();
 await db.exec(`
  create table menu_uber_sources(id uuid primary key,brand_id uuid,store_id uuid,revision integer,enabled boolean,auto_publish boolean,publish_config jsonb,updated_at timestamptz default now());
  create table local_bridge_commands(id uuid primary key,store_id uuid,platform text,command_type text default 'publish_menu_changes',status text,attempts integer,payload jsonb,result jsonb default '{}',last_error text default '',created_at timestamptz default now(),updated_at timestamptz default now(),available_at timestamptz default now(),completed_at timestamptz,claimed_by_device_id uuid,claimed_at timestamptz,claim_expires_at timestamptz);
  create table menu_external_platforms(id uuid primary key,brand_id uuid,store_id uuid,platform_key text);
  create table menu_uber_creation_attempts(source_id uuid,platform text,source_key text,status text,external_id text,external_parent_id text,command_id uuid);
  create table menu_platform_availability_settings(target_id uuid,availability text);
  create table local_bridge_devices(id uuid primary key,last_seen_at timestamptz,updated_at timestamptz);
  create table menu_change_sync_tasks(command_id uuid,status text,phase text,attempts integer,error_code text,error_detail text,updated_at timestamptz,completed_at timestamptz);
  create table menu_uber_option_migrations(source_id uuid,platform text,migration_key text,state jsonb);
 `);
 const lock=readFileSync(resolve(root,'db/uber-menu-authority.sql'),'utf8')
  .match(/create or replace function lock_menu_uber_revision[\s\S]*?\$\$;/)?.[0];
 assert.ok(lock);await db.exec(lock);
 const ids={source:randomUUID(),store:randomUUID(),brand:randomUUID(),command:randomUUID(),device:randomUUID(),platform:randomUUID(),target:randomUUID(),option:randomUUID()};
 const claim={deviceId:ids.device,claimedAt:'2026-10-05T00:00:00.000Z'};
 const primary={sourceKey:`${kind}:primary`,kind,targetId:ids.target,parentId:null,
  name:kind==='item'?'四川風麻辣湯330円〜':'お願い：商品合計1,600円〜で',sourceName:kind==='item'?'四川風麻辣湯330円〜':'お願い：商品合計1,600円〜で',
  price:kind==='item'?330:null,sortOrder:7,description:'Keep the original description',source:{groupIds:['g2','g1'],optionIds:['o2','o1']},
  mappings:[{externalId:'native-primary',externalParentId:'native-parent'}]};
 const secondary={sourceKey:'option:other:second',kind:'option',targetId:ids.option,parentId:ids.target,
  name:'刀削麺100g',price:170,sortOrder:2,source:{quantity:100},
  mappings:[{externalId:'native-secondary',externalParentId:'native-other',created:true}]};
 const payload={authoritativePublication:true,sourceId:ids.source,storeId:ids.store,brandId:ids.brand,revision:37,
  platformKey:'rocket_now',merchantId:'118575',targets:[primary,secondary],imagePolicy:'read_only',newItemsHidden:true,
  authorityState:{[secondary.sourceKey]:{status:'identified',externalId:'native-secondary',externalParentId:'stage:0010'}},
  migrationState:{migration:{sourceKey:secondary.sourceKey,phase:'complete',fromId:'old',newId:'native-secondary'}},
  manualRetryHistory:[{at:'2026-10-04T00:00:00Z',error:'previous issue',attempts:1}]};
 const config={rocket_now:{merchantId:'118575',priceMode:'uber',otherSetting:'preserve'},demae_can:{merchantId:'0076',selectionPolicy:'preserve_native'}};
 await db.query('insert into menu_uber_sources(id,brand_id,store_id,revision,enabled,auto_publish,publish_config) values($1,$2,$3,37,true,true,$4)',[ids.source,ids.brand,ids.store,JSON.stringify(config)]);
 await db.query('insert into local_bridge_commands(id,store_id,platform,status,attempts,payload,result,last_error,claimed_by_device_id,claimed_at,claim_expires_at) values($1,$2,\'rocket_now\',$3,$4,$5,$6,\'original rejection\',$7,$8,now()+interval \'30 minutes\')',
  [ids.command,ids.store,status,attempts,JSON.stringify(payload),JSON.stringify({receipt:'receipt-kept',progress:{sourceKey:primary.sourceKey}}),ids.device,claim.claimedAt]);
 await db.query("insert into menu_external_platforms(id,brand_id,platform_key) values($1,$2,'rocket_now')",[ids.platform,ids.brand]);
 await db.query("insert into menu_uber_creation_attempts values($1,'rocket_now',$2,'identified','native-secondary','stage:0010',$3)",[ids.source,secondary.sourceKey,ids.command]);
 await db.query("insert into menu_platform_availability_settings values($1,'unavailable')",[ids.target]);
 await db.query("insert into menu_uber_option_migrations values($1,'rocket_now','migration',$2)",[ids.source,JSON.stringify(payload.migrationState.migration)]);
 let gate,aiFailure;
 const requests=[],reconciliations=[];
 const mocks={
  'lib/menu-name-adaptation.ts':{
   async requestMenuNameAdaptation(input) {
    requests.push(json(input));
    if(gate)await gate.promise;
    if(aiFailure)throw aiFailure;
    return {sourceKey:input.sourceKey,targetId:input.targetId,inputName:input.inputName,
     name:kind==='item'?'四川風麻辣湯330円から':'お願い：商品合計1,600円からで',
     reason:'Keep the minimum amount meaning',model:'test-model',policyVersion:'contextual-name-v1'};
   }
  }
 };
 // Exercise the actual acknowledgement/manual routes and name adapter on real
 // local PostgreSQL. The publication helper's minimal queue test double models
 // its handoff, not its separately tested canonical source-manifest rebuild.
 Object.assign(mocks,{
  'lib/inventory-command-supersession.ts':{},'lib/inventory-manual-sync.ts':{},'lib/menu-platform-snapshot-merge.ts':{},
  'lib/uber-menu-source-sync.ts':{},'lib/order-realtime.ts':{publishPublicMenuUpdatedEvent:async()=>{}},
  'lib/local-bridge-auth.ts':{authorizeLocalBridge:async()=>({authorized:true,storeId:ids.store,deviceId:ids.device,devicePlatform:'desktop'})},
  'lib/competitor-bridge-snapshot.ts':{},
  'lib/local-bridge-realtime.ts':{publishBridgeCommandUpdated:async()=>{},publishBridgeInventoryUpdated:async()=>{},publishBridgeCommandAvailable:async()=>{}},
  'lib/api-auth.ts':{requireMasterOsSession:async()=>({role:'owner'})}
 });
 mocks['lib/uber-menu-publication-reconcile.ts']={async reconcileUberPublications(input) {
  reconciliations.push(json(input));
  assert.deepEqual(json(input),{sourceId:ids.source,storeId:ids.store,revision:37,mode:'manual',jobId:ids.command});
  const active=await db.query("select id from local_bridge_commands where store_id=$1 and payload->>'sourceId'=$2 and status in ('pending','processing')",[ids.store,ids.source]);
  if(active.rows.length)return {queued:0,blocked:[{code:'uber_publication_reconcile_active'}],jobs:[]};
  const before=(await db.query('select * from local_bridge_commands where id=$1',[ids.command])).rows[0];
  assert.equal(before.status,'failed');
  const next={...before.payload,
   publicationReconciliation:{...before.payload.publicationReconciliation,mode:'manual',scheduledRetries:0},
   manualRetryHistory:[...before.payload.manualRetryHistory,{at:new Date().toISOString(),error:before.last_error,
    attempts:before.attempts,status:before.status,reason:'manual_source_verification'}]};
  await db.query("update local_bridge_commands set status='pending',attempts=0,available_at=now(),completed_at=null,claimed_by_device_id=null,claimed_at=null,claim_expires_at=null,payload=$1,last_error='',updated_at=now() where id=$2",[JSON.stringify(next),ids.command]);
  return {queued:1,blocked:[],jobs:[{id:ids.command,platform:'rocket_now'}]};
 }};
 // Neon tagged queries are lazy; transaction statements must not run before
 // BEGIN. This adapter exercises exactly their emitted SQL on local Postgres.
 const sql=(parts,...params)=>{
  const text=parts.map((part,index)=>part+(index<params.length?`$${index+1}`:'')).join('');
  return {text,params,then(resolve,reject){return db.query(text,params).then(result=>result.rows).then(resolve,reject);}};
 };
 sql.transaction=statements=>db.transaction(async tx=>{
  const results=[];
  for(const statement of statements)results.push((await tx.query(statement.text,statement.params)).rows);
  return results;
 });
 mocks['lib/db.ts']={sql};
 const cache=new Map();
 function load(path,bypassMock=false) {
  if(mocks[path]&&!bypassMock)return mocks[path];
  if(cache.has(path))return cache.get(path);
  const exports={};cache.set(path,exports);
  const source=ts.transpileModule(readFileSync(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,Date,Error,Request,Response,URL,console,process,structuredClone,
   require:name=>{
    if(!name.startsWith('.'))return require(name);
    let dependency=relative(root,resolve(root,dirname(path),name));
    if(!/\.(?:ts|mjs)$/.test(dependency))dependency+='.ts';
    return load(dependency);
   }});
  return exports;
 }
 // The exact native rejection classifier is production code too. Stub only
 // generation, not its field/identity or authentication-error checks.
 const helper=load('lib/menu-name-adaptation.ts',true);
 mocks['lib/menu-name-adaptation.ts'].findRejectedMenuNameTarget=helper.findRejectedMenuNameTarget;
 const service=load('lib/uber-menu-name-adaptation-store.ts');
 const publication=load('lib/uber-menu-publication-store.ts');
 const input={commandId:ids.command,storeId:ids.store,platform:'rocket_now',status,claim,
  error:`uber_authority_content_failed:${primary.sourceKey}:${primary.name}:merchant_menu_request_failed:200:10036:productName contains special characters`};
 await db.query('update local_bridge_commands set last_error=$1 where id=$2',[input.error,ids.command]);
 const command=async()=>(await db.query('select * from local_bridge_commands where id=$1',[ids.command])).rows[0];
 const source=async()=>(await db.query('select * from menu_uber_sources where id=$1',[ids.source])).rows[0];
 const external=async()=>({receipts:(await db.query('select * from menu_uber_creation_attempts')).rows,stock:(await db.query('select * from menu_platform_availability_settings')).rows});
 const setCandidate=async candidate=>db.query("update menu_uber_sources set publish_config=jsonb_set(publish_config,'{rocket_now}',publish_config->'rocket_now'||jsonb_build_object('nameAdaptations',jsonb_build_object($1::text,$2::jsonb)))",[primary.sourceKey,JSON.stringify(candidate)]);
 return {db,ids,claim,payload,config,primary,input,service,publication,requests,reconciliations,command,source,external,setCandidate,
  menuSyncIssue:load('lib/menu-sync-status.ts').menuSyncIssue,
  defer(){gate=defer();return gate;},
  failAI(code='menu_name_ai_invalid',diagnostic={stage:'output_json',model:'test-model',attempts:[]}) {
   aiFailure=code?Object.assign(new Error(code),{code,diagnostic}):undefined;
  },
  ack(body){return load('app/api/local-bridge/uber-eats/commands/route.ts').POST(new Request(`http://isolated.test/api/local-bridge/uber-eats/commands?storeId=${ids.store}`,{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId:ids.command,...body})}));},
  manual(language='zh-Hans'){return load('app/api/menus/uber-source/route.ts').POST(new Request('http://isolated.test/api/menus/uber-source',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({brandId:ids.brand,action:'retry',jobId:ids.command,language})}));},
  async waitForRequests(count=1){for(let i=0;i<100&&requests.length<count;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(requests.length,count);}
 };
}

for(const kind of ['item','option_group'])test(`${kind}: adaptation keeps exact command, receipts, stock, ordering and relationships`,async()=>{
 const h=await fixture({kind});
 try {
  const before=await h.command(),external=await h.external();
  const prepared=await h.service.adaptRejectedUberMenuName({...h.input,result:{platformResponse:'name rejected'}});
  const after=await h.command(),source=await h.source();
  assert.equal(after.id,before.id);assert.equal(after.status,'pending');assert.equal(after.attempts,1);
  assert.equal(after.claimed_at,null);assert.equal(after.claimed_by_device_id,null);assert.equal(after.claim_expires_at,null);
  assert.equal(after.completed_at,null);assert.ok(after.available_at>before.available_at);
  assert.equal(after.result.receipt,'receipt-kept');assert.equal(after.result.platformResponse,'name rejected');
  assert.equal(after.result.nameAdaptation.adaptedName,prepared.adaptedName);
  assert.match(after.last_error,/menu_name_ai_retry_prepared:/);
  const unchanged=json(after.payload);
  unchanged.targets[0].name=before.payload.targets[0].name;
  delete unchanged.targets[0].nameProjection;delete unchanged.targets[0].nameAdaptation;
  assert.deepEqual(unchanged,before.payload);
  assert.deepEqual(await h.external(),external);
  assert.deepEqual(source.publish_config.demae_can,h.config.demae_can);
  assert.equal(source.publish_config.rocket_now.otherSetting,'preserve');
  const saved=source.publish_config.rocket_now.nameAdaptations[h.primary.sourceKey];
  assert.equal(saved.verified,false);assert.deepEqual(saved.attemptedNames,[prepared.adaptedName]);
 }finally {await h.db.close();}
});

test('same-batch pending Demae publication allows Rocket automatic adaptation',async()=>{
 const h=await fixture();
 try {
  await h.db.query("insert into local_bridge_commands(id,store_id,platform,status,attempts,payload) values($1,$2,'demae_can','pending',0,$3)",
   [randomUUID(),h.ids.store,JSON.stringify({...h.payload,platformKey:'demae_can'})]);
  assert.ok(await h.service.adaptRejectedUberMenuName(h.input));assert.equal((await h.command()).status,'pending');
 }finally {await h.db.close();}
});

test('manual failed-mode repair waits for other platforms rather than bypassing retry ordering',async()=>{
 const h=await fixture({status:'failed'});
 try {
  await h.db.query("insert into local_bridge_commands(id,store_id,platform,status,attempts,payload) values($1,$2,'demae_can','pending',0,$3)",
   [randomUUID(),h.ids.store,JSON.stringify({...h.payload,platformKey:'demae_can'})]);
  assert.equal(await h.service.adaptRejectedUberMenuName(h.input),false);assert.equal(h.requests.length,0);
 }finally {await h.db.close();}
});

for(const change of ['revision','claim','receipt','source capture','auto-publish setting'])test(`deferred AI: ${change} change rejects atomically without overwriting latest state`,async()=>{
 const h=await fixture();
 try {
  const gate=h.defer();
  const operation=h.service.adaptRejectedUberMenuName(h.input);
  await h.waitForRequests();
  if(change==='revision')await h.db.exec('update menu_uber_sources set revision=38');
  if(change==='claim')await h.db.query("update local_bridge_commands set claimed_at=claimed_at+interval '1 minute',claimed_by_device_id=$1,attempts=2",[randomUUID()]);
  if(change==='receipt')await h.db.exec("update local_bridge_commands set payload=jsonb_set(payload,'{authorityState,newReceipt}',jsonb_build_object('status','received','externalId','new-exact-id'))");
  if(change==='source capture')await h.db.query("insert into local_bridge_commands(id,store_id,platform,status,attempts,payload) values($1,$2,'uber_eats','pending',0,$3)",
   [randomUUID(),h.ids.store,JSON.stringify({sourceId:h.ids.source,authoritativeSource:true})]);
  if(change==='auto-publish setting')await h.db.exec('update menu_uber_sources set auto_publish=false');
  const latest=await h.command(),config=(await h.source()).publish_config;
  gate.release();await assert.rejects(operation,error=>error instanceof h.service.MenuNameAdaptationConflict);
  assert.deepEqual(await h.command(),latest);assert.deepEqual((await h.source()).publish_config,config);
 }finally {await h.db.close();}
});

test('duplicate acknowledgements persist exactly one candidate and one pending transition',async()=>{
 const h=await fixture();
 try {
  const gate=h.defer(),first=h.service.adaptRejectedUberMenuName(h.input),second=h.service.adaptRejectedUberMenuName(h.input);
  await h.waitForRequests(2);gate.release();
  const results=await Promise.allSettled([first,second]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const rejected=results.find(result=>result.status==='rejected');
  assert.ok(rejected.reason instanceof h.service.MenuNameAdaptationConflict);
  assert.equal((await h.command()).status,'pending');
  const saved=(await h.source()).publish_config.rocket_now.nameAdaptations[h.primary.sourceKey];
  assert.equal(saved.attemptedNames.length,1);
 }finally {await h.db.close();}
});

test('execution cap does not generate a candidate or claim a queued retry',async()=>{
 const h=await fixture({attempts:3});
 try {
  const before=await h.command();assert.equal(await h.service.adaptRejectedUberMenuName(h.input),false);
  assert.equal(h.requests.length,0);assert.deepEqual(await h.command(),before);
  assert.deepEqual((await h.source()).publish_config,h.config);
 }finally {await h.db.close();}
});

test('two previously rejected names stop further AI calls and preserve command content with a bounded diagnostic',async()=>{
 const h=await fixture();
 try {
  await h.setCandidate({sourceKey:h.primary.sourceKey,targetId:h.primary.targetId,sourceName:h.primary.sourceName,
   inputName:h.primary.name,name:'previous candidate',verified:false,attemptedNames:['candidate one','candidate two']});
  const before=await h.command(),config=(await h.source()).publish_config;
  await assert.rejects(h.service.adaptRejectedUberMenuName(h.input),/menu_name_ai_exhausted/);
  const after=await h.command();
  assert.equal(h.requests.length,0);assert.deepEqual(after.payload,before.payload);
  assert.equal(after.status,before.status);assert.equal(after.claimed_at.getTime(),before.claimed_at.getTime());
  assert.equal(after.result.nameAdaptationDiagnostic.errorCode,'menu_name_ai_exhausted');
  assert.equal(after.result.nameAdaptationDiagnostic.platformRejection,h.input.error);
  assert.deepEqual((await h.source()).publish_config,config);
 }finally {await h.db.close();}
});

test('AI failure saves native rejection and bound identities, without changing content or exposing response bodies',async()=>{
 const h=await fixture();
 try {
  const before=await h.command(),external=await h.external();
  h.failAI('menu_name_ai_invalid',{stage:'output_incomplete',model:'m'.repeat(1000),responseStatus:'incomplete',
   incompleteReason:'max_output_tokens',httpStatus:200,usage:{inputTokens:123,outputTokens:2000,totalTokens:2123,reasoningTokens:1400,secret:999},
   candidateName:'n'.repeat(2000),candidateReason:'Bearer sk-secret-token '+ 'r'.repeat(2000),raw:'PRIVATE RESPONSE',reasoning:'PRIVATE REASONING',
   attempts:[1,2,3,4].map(attempt=>({attempt,stage:'output_incomplete',model:'test-model',raw:'PRIVATE RESPONSE'}))});
  await assert.rejects(h.service.adaptRejectedUberMenuName(h.input),error=>error instanceof h.service.MenuNameAdaptationFailure);
  const after=await h.command(),diagnostic=after.result.nameAdaptationDiagnostic;
  assert.equal(diagnostic.commandId,h.ids.command);assert.equal(diagnostic.sourceId,h.ids.source);assert.equal(diagnostic.revision,37);
  assert.equal(diagnostic.platform,'rocket_now');assert.equal(diagnostic.sourceKey,h.primary.sourceKey);
  assert.equal(diagnostic.targetId,h.primary.targetId);assert.equal(diagnostic.inputName,h.primary.name);
  assert.equal(diagnostic.sourceName,h.primary.sourceName);assert.equal(diagnostic.rejectedName,h.primary.name);
  assert.equal(diagnostic.platformRejection,h.input.error);assert.equal(diagnostic.errorCode,'menu_name_ai_invalid');
  assert.equal(diagnostic.ai.stage,'output_incomplete');assert.equal(diagnostic.ai.model.length,200);
  assert.equal(diagnostic.ai.candidateName.length,512);assert.equal(diagnostic.ai.candidateReason.length,512);
  assert.equal(diagnostic.ai.attempts.length,2);assert.deepEqual(diagnostic.ai.usage,{inputTokens:123,outputTokens:2000,totalTokens:2123,reasoningTokens:1400});
  assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE|sk-secret-token|"secret"/);
  assert.match(after.last_error,/"stage":"output_incomplete"/);
  assert.equal(after.status,'processing');assert.equal(after.attempts,before.attempts);
  assert.deepEqual(after.payload,before.payload);assert.equal(after.result.receipt,before.result.receipt);
  assert.deepEqual(await h.external(),external);assert.deepEqual((await h.source()).publish_config,h.config);
 }finally {await h.db.close();}
});

for(const status of ['processing','failed'])test(`${status}: saved AI failure is repaired directly for the same native target on manual retry`,async()=>{
 const h=await fixture({status});
 try {
  h.failAI();await assert.rejects(h.service.adaptRejectedUberMenuName(h.input),/menu_name_ai_invalid/);
  const diagnosed=await h.command();
  await h.db.exec("update local_bridge_commands set status='failed',completed_at=now(),claimed_by_device_id=null,claimed_at=null,claim_expires_at=null");
  h.failAI(null);
  const prepared=await h.service.adaptRejectedUberMenuName({...h.input,status:'failed',error:diagnosed.last_error});
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].sourceKey,h.primary.sourceKey);
  assert.equal(h.requests[1].targetId,h.primary.targetId);assert.equal(h.requests[1].inputName,h.primary.name);
  assert.equal(h.requests[1].rejectionReason,'merchant_menu_request_failed:200:10036:productName contains special characters');
  const after=await h.command();assert.equal(after.id,h.ids.command);assert.equal(after.status,'failed');
  assert.equal(after.payload.targets[0].name,prepared.adaptedName);assert.equal(after.result.receipt,'receipt-kept');
  assert.equal(after.result.nameAdaptationDiagnostic.platformRejection,h.input.error);
  assert.match(after.last_error,/menu_name_ai_candidate_prepared/);
  const again=await h.service.adaptRejectedUberMenuName({...h.input,status:'failed',error:after.last_error});
  assert.equal(again,false);assert.equal(h.requests.length,2);
 }finally {await h.db.close();}
});

for(const change of ['revision','claim','receipt','source disabled','auto-publish disabled'])test(`deferred AI failure: ${change} prevents even diagnostic writes`,async()=>{
 const h=await fixture();
 try {
  h.failAI();const gate=h.defer(),operation=h.service.adaptRejectedUberMenuName(h.input);
  await h.waitForRequests();
  if(change==='revision')await h.db.exec('update menu_uber_sources set revision=38');
  if(change==='claim')await h.db.query("update local_bridge_commands set claimed_at=claimed_at+interval '1 minute',claimed_by_device_id=$1",[randomUUID()]);
  if(change==='receipt')await h.db.exec("update local_bridge_commands set payload=jsonb_set(payload,'{authorityState,newReceipt}',jsonb_build_object('status','received','externalId','new-exact-id'))");
  if(change==='source disabled')await h.db.exec('update menu_uber_sources set enabled=false');
  if(change==='auto-publish disabled')await h.db.exec('update menu_uber_sources set auto_publish=false');
  const latest=await h.command(),config=(await h.source()).publish_config;
  gate.release();await assert.rejects(operation,error=>error instanceof h.service.MenuNameAdaptationConflict);
  assert.deepEqual(await h.command(),latest);assert.deepEqual((await h.source()).publish_config,config);
 }finally {await h.db.close();}
});

for(const patch of ['sourceKey','targetId','sourceId','commandId','revision','platform','rejectedName','sourceName','inputName','native price rejection','native authentication rejection'])test(`manual recovery cannot use an untrusted ${patch} diagnostic`,async()=>{
 const h=await fixture();
 try {
  h.failAI();await assert.rejects(h.service.adaptRejectedUberMenuName(h.input));
  const command=await h.command(),diagnostic=command.result.nameAdaptationDiagnostic;
  if(patch==='revision')diagnostic.revision=38;
  else if(patch==='native price rejection')diagnostic.platformRejection=`uber_authority_content_failed:${h.primary.sourceKey}:${h.primary.name}:optionName invalid price quantity`;
  else if(patch==='native authentication rejection')diagnostic.platformRejection=`uber_authority_content_failed:${h.primary.sourceKey}:${h.primary.name}:merchant_menu_request_failed:401:MWA0007`;
  else diagnostic[patch]='forged';
  await h.db.query("update local_bridge_commands set status='failed',result=$1",[JSON.stringify({...command.result,nameAdaptationDiagnostic:diagnostic})]);
  const before=await h.command();h.failAI(null);
  await assert.rejects(h.service.adaptRejectedUberMenuName({...h.input,status:'failed',error:before.last_error}),error=>error instanceof h.service.MenuNameAdaptationConflict);
  assert.equal(h.requests.length,1);assert.deepEqual(await h.command(),before);
 }finally {await h.db.close();}
});

test('legacy AI failures without native rejection cannot choose targets from last_error JSON',async()=>{
 const h=await fixture({status:'failed'});
 try {
  await h.db.query('update local_bridge_commands set last_error=$1',[`menu_name_ai_invalid:${JSON.stringify({sourceKey:h.primary.sourceKey,targetId:h.primary.targetId,name:h.primary.name})}`]);
  const before=await h.command();
  await assert.rejects(h.service.adaptRejectedUberMenuName({...h.input,error:before.last_error}),error=>error instanceof h.service.MenuNameAdaptationRecoveryUnavailable);
  assert.equal(h.requests.length,0);assert.deepEqual(await h.command(),before);
 }finally {await h.db.close();}
});

test('Bridge result cannot overwrite a server diagnosis while preparing a name candidate',async()=>{
 const h=await fixture();
 try {
  const existing={audit:'server-only'};
  await h.db.query("update local_bridge_commands set result=result||jsonb_build_object('nameAdaptationDiagnostic',$1::jsonb)",[JSON.stringify(existing)]);
  await h.service.adaptRejectedUberMenuName({...h.input,result:{nameAdaptationDiagnostic:{sourceKey:'forged'},nameAdaptation:{name:'forged'},platformResponse:'allowed'}});
  const command=await h.command();assert.deepEqual(command.result.nameAdaptationDiagnostic,existing);
  assert.equal(command.result.platformResponse,'allowed');assert.notEqual(command.result.nameAdaptation.adaptedName,'forged');
 }finally {await h.db.close();}
});

test('actual failed ACK preserves the server diagnostic and strips a Bridge-supplied recovery record',async()=>{
 const h=await fixture();
 try {
  h.failAI('menu_name_ai_invalid',{stage:'output_incomplete',model:'test-model',incompleteReason:'max_output_tokens',attempts:[]});
  const response=await h.ack({status:'failed',error:h.input.error,result:{platformResponse:'name rejected',
   nameAdaptationDiagnostic:{platformRejection:'forged',sourceKey:'forged'},nameAdaptation:{adaptedName:'forged'}}});
  assert.equal(response.status,200);
  const after=await h.command();assert.equal(after.status,'failed');assert.equal(after.claimed_at,null);
  assert.equal(after.result.platformResponse,'name rejected');assert.equal(after.result.nameAdaptation,undefined);
  assert.equal(after.result.nameAdaptationDiagnostic.platformRejection,h.input.error);
  assert.equal(after.result.nameAdaptationDiagnostic.sourceKey,h.primary.sourceKey);
  assert.equal(after.result.nameAdaptationDiagnostic.ai.stage,'output_incomplete');
  assert.match(after.last_error,/menu_name_ai_invalid/);assert.equal(h.requests.length,1);
 }finally {await h.db.close();}
});

test('actual final ACK cannot inject a recovery record when no server diagnostic exists',async()=>{
 const h=await fixture();
 try {
  const response=await h.ack({status:'failed',error:'merchant_menu_request_failed:401:MWA0007',
   result:{nameAdaptationDiagnostic:{sourceKey:h.primary.sourceKey,platformRejection:h.input.error},nameAdaptation:{adaptedName:'forged'},allowed:'retained'}});
  assert.equal(response.status,200);const after=await h.command();
  assert.equal(after.status,'failed');assert.equal(after.result.allowed,'retained');
  assert.equal(after.result.nameAdaptationDiagnostic,undefined);assert.equal(after.result.nameAdaptation,undefined);
  assert.equal(h.requests.length,0);
 }finally {await h.db.close();}
});

test('actual manual route regenerates for a diagnosed target before requeuing the original command',async()=>{
 const h=await fixture();
 try {
  h.failAI();assert.equal((await h.ack({status:'failed',error:h.input.error,result:{}})).status,200);
  h.failAI(null);const response=await h.manual();assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{queued:1,blocked:[],jobs:[{id:h.ids.command,platform:'rocket_now'}]});
  assert.equal(h.reconciliations.length,1);
  const after=await h.command();assert.equal(after.id,h.ids.command);assert.equal(after.status,'pending');assert.equal(after.attempts,0);
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].targetId,h.primary.targetId);
  assert.notEqual(after.payload.targets[0].name,h.primary.name);
  assert.equal(after.payload.authorityState['option:other:second'].externalId,'native-secondary');
  assert.equal(after.payload.migrationState.migration.phase,'complete');
  assert.equal(after.result.nameAdaptationDiagnostic.platformRejection,h.input.error);
 }finally {await h.db.close();}
});

test('actual manual route replays legacy jobs through the shared helper without inventing native rejection',async()=>{
 const h=await fixture({status:'failed'});
 try {
  const legacyError=`menu_name_ai_invalid:${JSON.stringify({sourceKey:h.primary.sourceKey,targetId:h.primary.targetId,name:h.primary.name})}`;
  await h.db.query('update local_bridge_commands set last_error=$1',[legacyError]);
  const before=await h.command(),external=await h.external();
  const response=await h.manual();assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{queued:1,blocked:[],jobs:[{id:h.ids.command,platform:'rocket_now'}]});
  assert.equal(h.reconciliations.length,1);
  const after=await h.command();assert.equal(after.id,before.id);assert.equal(after.status,'pending');assert.equal(after.attempts,0);
  assert.equal(after.claimed_at,null);assert.equal(after.claimed_by_device_id,null);assert.equal(after.claim_expires_at,null);
  const retained=json(after.payload);delete retained.publicationReconciliation;
  const retry=retained.manualRetryHistory.at(-1);assert.ok(Number.isFinite(Date.parse(retry.at)));
  assert.deepEqual({...retry,at:undefined},{at:undefined,error:legacyError,attempts:before.attempts,
   status:'failed',reason:'manual_source_verification'});
  retained.manualRetryHistory.pop();assert.deepEqual(retained,before.payload);
  assert.deepEqual(after.result,before.result);assert.deepEqual(await h.external(),external);
  assert.equal(after.result.nameAdaptationDiagnostic,undefined);
  assert.equal(h.requests.length,0);
 }finally {await h.db.close();}
});

test('actual manual route retains the latest failure diagnosis while returning human recovery advice',async()=>{
 const h=await fixture({status:'failed'});
 try {
  h.failAI('menu_name_ai_invalid',{stage:'output_schema',model:'test-model',attempts:[]});
  const response=await h.manual();assert.equal(response.status,409);const body=await response.json();
  assert.match(body.error,/没有提交给平台/);assert.match(body.error,/直接.*重新生成/);assert.doesNotMatch(body.error,/menu_name_ai_|output_schema/);
  const after=await h.command();assert.equal(after.status,'failed');assert.equal(after.payload.targets[0].name,h.primary.name);
  assert.equal(after.result.nameAdaptationDiagnostic.ai.stage,'output_schema');
  assert.equal(after.result.nameAdaptationDiagnostic.platformRejection,h.input.error);assert.equal(after.result.receipt,'receipt-kept');
 }finally {await h.db.close();}
});

test('manual preparation followed by a competing queued job reports saved candidate, never a scheduled retry',async()=>{
 const h=await fixture({status:'failed'});
 try {
  const adapt=h.service.adaptRejectedUberMenuName;
  h.service.adaptRejectedUberMenuName=async input=>{
   const prepared=await adapt(input);
   await h.db.query("insert into local_bridge_commands(id,store_id,platform,status,attempts,payload) values($1,$2,'demae_can','pending',0,$3)",
    [randomUUID(),h.ids.store,JSON.stringify({...h.payload,platformKey:'demae_can'})]);
   return prepared;
  };
  const response=await h.manual();assert.equal(response.status,409);
  const after=await h.command();assert.equal(after.status,'failed');assert.match(after.last_error,/menu_name_ai_candidate_prepared/);
  assert.equal(after.result.nameAdaptation.adaptedName,after.payload.targets[0].name);
  // The route cannot queue this task; the saved status must describe only what
  // actually happened, not promise a platform save or a scheduled execution.
  assert.match(h.menuSyncIssue(after.last_error,'zh-Hans').action,/尚未执行/);
  assert.doesNotMatch(h.menuSyncIssue(after.last_error,'zh-Hans').action,/已安排重试|同步成功|已完成/);
 }finally {await h.db.close();}
});

test('native verification must finish before a generated candidate becomes reusable',async()=>{
 const h=await fixture();
 try {
  await h.service.adaptRejectedUberMenuName(h.input);
  await h.db.exec("update local_bridge_commands set status='processing'");
  const command=await h.command();
  const observations=command.payload.targets.map(target=>({sourceKey:target.sourceKey,externalId:target.mappings[0].externalId,
   name:target.name,price:target.price,hidden:true,structureVerified:true}));
  const args={commandId:h.ids.command,storeId:h.ids.store,platform:'rocket_now',progress:{}};
  await assert.rejects(h.publication.recordUberPublicationProgress({...args,result:{observations:observations.map((row,index)=>index===0?{...row,name:h.primary.name}:row)}}),/content_mismatch/);
  assert.equal((await h.source()).publish_config.rocket_now.nameAdaptations[h.primary.sourceKey].verified,false);
  await assert.rejects(h.publication.recordUberPublicationProgress({...args,result:{observations:observations.map((row,index)=>index===0?{...row,structureVerified:false}:row)}}),/structure_unverified/);
  assert.equal((await h.source()).publish_config.rocket_now.nameAdaptations[h.primary.sourceKey].verified,false);
  await h.publication.recordUberPublicationProgress({...args,result:{observations}});
  assert.equal((await h.source()).publish_config.rocket_now.nameAdaptations[h.primary.sourceKey].verified,true);
 }finally {await h.db.close();}
});

test('confirmation cannot verify a changed saved name, input, source name or target identity',async()=>{
 const h=await fixture();
 try {
  await h.service.adaptRejectedUberMenuName(h.input);
  const command=await h.command(),candidate=command.payload.targets[0].nameAdaptation;
  for(const patch of [{name:'different candidate'},{inputName:'different projection'},{sourceName:'different original'},{targetId:randomUUID()}]) {
   await h.setCandidate({...candidate,...patch});
   await h.service.confirmUberMenuNameAdaptations({sourceId:h.ids.source,revision:37,platform:'rocket_now',payload:command.payload});
   assert.equal((await h.source()).publish_config.rocket_now.nameAdaptations[h.primary.sourceKey].verified,false);
  }
 }finally {await h.db.close();}
});
