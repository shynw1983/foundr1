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

async function fixture({kind='option_group',attempts=1,status='processing',platform='rocket_now',batch=false}={}) {
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
 if(batch) {
  const name='ひとくち台湾豚ソーセージ｜一口台湾猪肉肠｜한입 대만식 돼지고기 소시지｜Bite-Sized Taiwanese Pork Sausage';
  for(const target of [primary,secondary])Object.assign(target,{kind:'option',name,
   sourceName:'ひとくち台湾豚ソーセージ',price:316});
  primary.sourceKey='option:first-group:first';primary.parentId=randomUUID();
  secondary.sourceKey='option:second-group:second';secondary.parentId=randomUUID();
 }
 const payload={authoritativePublication:true,sourceId:ids.source,storeId:ids.store,brandId:ids.brand,revision:37,
  platformKey:platform,merchantId:platform==='rocket_now'?'118575':'0076',targets:[primary,secondary],imagePolicy:'read_only',newItemsHidden:true,
  authorityState:{[secondary.sourceKey]:{status:'identified',externalId:'native-secondary',externalParentId:'stage:0010'}},
  migrationState:{migration:{sourceKey:secondary.sourceKey,phase:'complete',fromId:'old',newId:'native-secondary'}},
  manualRetryHistory:[{at:'2026-10-04T00:00:00Z',error:'previous issue',attempts:1}]};
 const config={rocket_now:{merchantId:'118575',priceMode:'uber',otherSetting:'preserve'},demae_can:{merchantId:'0076',selectionPolicy:'preserve_native'}};
 await db.query('insert into menu_uber_sources(id,brand_id,store_id,revision,enabled,auto_publish,publish_config) values($1,$2,$3,37,true,true,$4)',[ids.source,ids.brand,ids.store,JSON.stringify(config)]);
 await db.query('insert into local_bridge_commands(id,store_id,platform,status,attempts,payload,result,last_error,claimed_by_device_id,claimed_at,claim_expires_at) values($1,$2,$3,$4,$5,$6,$7,\'original rejection\',$8,$9,now()+interval \'30 minutes\')',
  [ids.command,ids.store,platform,status,attempts,JSON.stringify(payload),JSON.stringify({receipt:'receipt-kept',progress:{sourceKey:primary.sourceKey}}),ids.device,claim.claimedAt]);
 await db.query('insert into menu_external_platforms(id,brand_id,platform_key) values($1,$2,$3)',[ids.platform,ids.brand,platform]);
 await db.query("insert into menu_uber_creation_attempts values($1,$2,$3,'identified','native-secondary','stage:0010',$4)",[ids.source,platform,secondary.sourceKey,ids.command]);
 await db.query("insert into menu_platform_availability_settings values($1,'unavailable')",[ids.target]);
 await db.query("insert into menu_uber_option_migrations values($1,$2,'migration',$3)",[ids.source,platform,JSON.stringify(payload.migrationState.migration)]);
 let gate,aiFailure,aiHandler;
 const requests=[],reconciliations=[],mutations=[];
 const mocks={
  'lib/menu-name-adaptation.ts':{
   async requestMenuNameAdaptation(input) {
    requests.push(json(input));
    if(gate)await gate.promise;
    if(aiFailure)throw aiFailure;
    if(aiHandler)return aiHandler(input,requests.length);
    return {sourceKey:input.sourceKey,targetId:input.targetId,inputName:input.inputName,
     name:batch?input.inputName.replace('Bite-Sized Taiwanese Pork Sausage','Taiwanese Pork Sausage Bites'):
      kind==='item'?'四川風麻辣湯330円から':'お願い：商品合計1,600円からで',
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
  return {queued:1,blocked:[],jobs:[{id:ids.command,platform}]};
 }};
 // Neon tagged queries are lazy; transaction statements must not run before
 // BEGIN. This adapter exercises exactly their emitted SQL on local Postgres.
 const sql=(parts,...params)=>{
  const text=parts.map((part,index)=>part+(index<params.length?`$${index+1}`:'')).join('');
  return {text,params,then(resolve,reject){
   if(/^\s*(?:update|insert|delete)\b/i.test(text))mutations.push(text);
   return db.query(text,params).then(result=>result.rows).then(resolve,reject);
  }};
 };
 sql.transaction=statements=>db.transaction(async tx=>{
  const results=[];
  for(const statement of statements) {
   if(/^\s*(?:update|insert|delete)\b/i.test(statement.text))mutations.push(statement.text);
   results.push((await tx.query(statement.text,statement.params)).rows);
  }
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
 const generation=mocks['lib/menu-name-adaptation.ts'].requestMenuNameAdaptation;
 Object.assign(mocks['lib/menu-name-adaptation.ts'],helper,{requestMenuNameAdaptation:generation});
 const service=load('lib/uber-menu-name-adaptation-store.ts');
 const publication=load('lib/uber-menu-publication-store.ts');
 const nameIssues=payload.targets.map(target=>({sourceKey:target.sourceKey,code:'native_name_prohibited_substring',
  rule:'demae-option-size-substring',fragment:'size'}));
 const input={commandId:ids.command,storeId:ids.store,platform,status,claim,
  error:batch?`uber_authority_preflight_blocked:${nameIssues.length}:${JSON.stringify(nameIssues)}`:
   `uber_authority_content_failed:${primary.sourceKey}:${primary.name}:merchant_menu_request_failed:200:10036:productName contains special characters`};
 await db.query('update local_bridge_commands set last_error=$1 where id=$2',[input.error,ids.command]);
 const command=async()=>(await db.query('select * from local_bridge_commands where id=$1',[ids.command])).rows[0];
 const source=async()=>(await db.query('select * from menu_uber_sources where id=$1',[ids.source])).rows[0];
 const external=async()=>({receipts:(await db.query('select * from menu_uber_creation_attempts')).rows,stock:(await db.query('select * from menu_platform_availability_settings')).rows});
 const setCandidate=async candidate=>db.query('update menu_uber_sources set publish_config=jsonb_set(publish_config,array[$1],publish_config->$1||jsonb_build_object(\'nameAdaptations\',jsonb_build_object($2::text,$3::jsonb)))',[platform,primary.sourceKey,JSON.stringify(candidate)]);
 return {db,ids,claim,payload,config,primary,secondary,nameIssues,input,service,publication,helper,requests,reconciliations,mutations,command,source,external,setCandidate,
  publicationBuilder:load('lib/uber-menu-publication.ts'),
  generate(handler){aiHandler=handler;},
  menuSyncIssue:load('lib/menu-sync-status.ts').menuSyncIssue,
  defer(){gate=defer();return gate;},
  failAI(code='menu_name_ai_invalid',diagnostic={stage:'output_json',model:'test-model',attempts:[]}) {
   aiFailure=code?Object.assign(new Error(code),{code,diagnostic}):undefined;
  },
  ack(body){return load('app/api/local-bridge/uber-eats/commands/route.ts').POST(new Request(`http://isolated.test/api/local-bridge/uber-eats/commands?storeId=${ids.store}`,{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId:ids.command,...body})}));},
  manual(language='zh-Hans'){return load('app/api/menus/uber-source/route.ts').POST(new Request('http://isolated.test/api/menus/uber-source',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({brandId:ids.brand,action:'retry',jobId:ids.command,language})}));},
  async waitForRequests(count=1){for(let i=0;i<100&&requests.length<count;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.ok(requests.length>=count);}
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

const batchFixture=options=>fixture({kind:'option',platform:'demae_can',batch:true,...options});
const batchError=issues=>`uber_authority_preflight_blocked:${issues.length}:${JSON.stringify(issues)}`;
const batchCandidate=input=>({sourceKey:input.sourceKey,targetId:input.targetId,inputName:input.inputName,
 name:input.inputName.replace('Bite-Sized Taiwanese Pork Sausage','Taiwanese Pork Sausage Bites'),
 reason:'Preserve the product and each unaffected language',model:'test-model',policyVersion:'contextual-name-v1'});
const persisted=async h=>({command:await h.command(),source:await h.source(),external:await h.external(),
 migrations:(await h.db.query('select * from menu_uber_option_migrations')).rows});

test('two independent same-name options prepare atomically for the original command without sharing identities',async()=>{
 const h=await batchFixture();
 try {
  const before=await persisted(h);
  const prepared=await h.service.adaptRejectedUberMenuName({...h.input,result:{nativePreflight:'preserved'}});
  const after=await persisted(h);
  assert.equal(h.requests.length,2);
  assert.deepEqual(h.requests.map(row=>[row.sourceKey,row.targetId]),h.payload.targets.map(row=>[row.sourceKey,row.targetId]));
  assert.equal(prepared.sourceKey,h.primary.sourceKey);assert.equal(prepared.remainingNameIssues,0);
  assert.deepEqual(json(prepared.adaptedTargets.map(row=>row.sourceKey)),h.payload.targets.map(row=>row.sourceKey));
  assert.equal(after.command.id,before.command.id);assert.equal(after.command.status,'pending');
  assert.equal(after.command.attempts,before.command.attempts);assert.equal(after.command.claimed_at,null);
  assert.equal(after.command.claimed_by_device_id,null);assert.equal(after.command.claim_expires_at,null);
  assert.equal(after.command.result.receipt,'receipt-kept');assert.equal(after.command.result.nativePreflight,'preserved');
  assert.deepEqual(after.external,before.external);assert.deepEqual(after.migrations,before.migrations);
  const restored=json(after.command.payload);
  for(let index=0;index<restored.targets.length;index++) {
   const target=restored.targets[index],old=before.command.payload.targets[index];
   assert.equal(target.name,batchCandidate(h.requests[index]).name);
   assert.equal(target.nameProjection,old.name);assert.equal(target.nameAdaptation.verified,false);
   assert.deepEqual(target.nameAdaptation.attemptedNames,[target.name]);
   assert.equal(target.nameAdaptation.sourceKey,old.sourceKey);assert.equal(target.nameAdaptation.targetId,old.targetId);
   assert.deepEqual(target.name.split('｜').slice(0,3),old.name.split('｜').slice(0,3));
   target.name=old.name;delete target.nameAdaptation;delete target.nameProjection;
  }
  assert.deepEqual(restored,before.command.payload);
  assert.deepEqual(after.source.publish_config.rocket_now,before.source.publish_config.rocket_now);
  const slots=after.source.publish_config.demae_can.nameAdaptations;
  assert.deepEqual(Object.keys(slots).sort(),h.payload.targets.map(row=>row.sourceKey).sort());
  assert.equal(h.mutations.length,2,'the batch has one source update and one same-command update');
 } finally {await h.db.close();}
});

test('a failed-mode batch saves two candidates but never queues by itself',async()=>{
 const h=await batchFixture({status:'failed'});
 try {
  const before=await h.command();
  const prepared=await h.service.adaptRejectedUberMenuName(h.input),after=await h.command();
  assert.equal(prepared.adaptedTargets.length,2);assert.equal(after.status,'failed');
  assert.equal(after.id,before.id);assert.equal(after.attempts,before.attempts);
  assert.equal(after.available_at.getTime(),before.available_at.getTime());
  assert.deepEqual(after.result.receipt,before.result.receipt);
 } finally {await h.db.close();}
});

for(const change of ['revision','claim','attempt','receipt','capture','auto_publish','config'])test(`two-target batch: deferred ${change} rejects the entire stale preparation`,async()=>{
 const h=await batchFixture();
 try {
  const gate=h.defer(),operation=h.service.adaptRejectedUberMenuName(h.input);
  await h.waitForRequests();
  if(change==='revision')await h.db.exec('update menu_uber_sources set revision=38');
  if(change==='claim')await h.db.exec("update local_bridge_commands set claimed_at=claimed_at+interval '1 minute'");
  if(change==='attempt')await h.db.exec('update local_bridge_commands set attempts=2');
  if(change==='receipt')await h.db.exec("update local_bridge_commands set payload=jsonb_set(payload,'{authorityState,newReceipt}',jsonb_build_object('status','identified','externalId','new-real-id'))");
  if(change==='capture')await h.db.query("insert into local_bridge_commands(id,store_id,platform,status,attempts,payload) values($1,$2,'uber_eats','pending',0,$3)",
   [randomUUID(),h.ids.store,JSON.stringify({sourceId:h.ids.source,authoritativeSource:true})]);
  if(change==='auto_publish')await h.db.exec('update menu_uber_sources set auto_publish=false');
  if(change==='config')await h.db.exec("update menu_uber_sources set publish_config=jsonb_set(publish_config,'{demae_can,otherSetting}','\"changed while AI pending\"')");
  const latest=await persisted(h);
  gate.release();await assert.rejects(operation,error=>error instanceof h.service.MenuNameAdaptationConflict);
  assert.deepEqual(await persisted(h),latest);assert.equal(h.mutations.length,0);
 } finally {await h.db.close();}
});

test('duplicate two-target acknowledgements cannot persist two batches or consume another queue attempt',async()=>{
 const h=await batchFixture();
 try {
  const gate=h.defer(),first=h.service.adaptRejectedUberMenuName(h.input),second=h.service.adaptRejectedUberMenuName(h.input);
  await h.waitForRequests(2);gate.release();
  const results=await Promise.allSettled([first,second]);
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(results.filter(row=>row.status==='rejected'&&row.reason instanceof h.service.MenuNameAdaptationConflict).length,1);
  const after=await h.command();assert.equal(after.status,'pending');assert.equal(after.attempts,1);
  assert.equal(Object.keys((await h.source()).publish_config.demae_can.nameAdaptations).length,2);
  assert.equal(h.mutations.length,2);
 } finally {await h.db.close();}
});

for(const unsafeSecond of [false,true])test(`two batch AI requests start concurrently and wait for both outcomes (${unsafeSecond?'second unsafe':'both safe'})`,async()=>{
 const h=await batchFixture();
 try {
  const gates=[defer(),defer()],before=await persisted(h);
  h.generate(async(input,index)=>{
   await gates[index-1].promise;
   if(index===2&&unsafeSecond)throw Object.assign(new Error('menu_name_ai_unsafe'),{code:'menu_name_ai_unsafe',
    diagnostic:{stage:'candidate_identity',model:'test-model',attempts:[]}});
   return batchCandidate(input);
  });
  const operation=h.service.adaptRejectedUberMenuName(h.input);
  await h.waitForRequests(2);assert.equal(h.requests.length,2,'both requests start without waiting for the first AI answer');
  gates[0].release();
  await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(h.mutations.length,0);assert.deepEqual(await persisted(h),before,'first answer never creates a partial persisted candidate');
  gates[1].release();
  if(unsafeSecond) {
   await assert.rejects(operation,error=>error instanceof h.service.MenuNameAdaptationFailure);
   const after=await persisted(h);
   assert.deepEqual(after.command.payload,before.command.payload);assert.deepEqual(after.source,before.source);
   assert.equal(after.command.result.nameAdaptationDiagnostic.sourceKey,h.secondary.sourceKey);
   assert.deepEqual(after.external,before.external);assert.deepEqual(after.migrations,before.migrations);
  } else {
   const prepared=await operation;assert.equal(prepared.adaptedTargets.length,2);assert.equal((await h.command()).status,'pending');
  }
 } finally {await h.db.close();}
});

for(const failure of ['unsafe','identity','generation'])test(`second batch candidate ${failure} leaves every name, receipt, stock and queue state untouched`,async()=>{
 const h=await batchFixture();
 try {
  const before=await persisted(h);
  h.generate((input,index)=>{
   if(index===1)return batchCandidate(input);
   if(failure==='identity')return {...batchCandidate(input),targetId:randomUUID()};
   const code=failure==='unsafe'?'menu_name_ai_unsafe':'menu_name_ai_unavailable';
   throw Object.assign(new Error(code),{code,diagnostic:{stage:failure==='unsafe'?'candidate_identity':'http',model:'test-model',attempts:[]}});
  });
  await assert.rejects(h.service.adaptRejectedUberMenuName(h.input),error=>error instanceof h.service.MenuNameAdaptationFailure);
  const after=await persisted(h);
  assert.equal(h.requests.length,2);assert.deepEqual(after.command.payload,before.command.payload);
  assert.deepEqual(after.source,before.source);assert.deepEqual(after.external,before.external);assert.deepEqual(after.migrations,before.migrations);
  assert.equal(after.command.status,before.command.status);assert.equal(after.command.attempts,before.command.attempts);
  assert.equal(after.command.claimed_at.getTime(),before.command.claimed_at.getTime());
  assert.equal(after.command.available_at.getTime(),before.command.available_at.getTime());
  assert.equal(after.command.result.receipt,before.command.result.receipt);
  assert.equal(after.command.result.nameAdaptation,undefined);
  assert.equal(after.command.result.nameAdaptationDiagnostic.sourceKey,h.secondary.sourceKey);
  assert.ok(h.mutations.every(statement=>/^\s*update local_bridge_commands set\s+result=coalesce/i.test(statement)),
   'only the bounded server failure diagnostic may be saved; no candidate/config/payload/queue update');
 } finally {await h.db.close();}
});

for(const problem of ['mixed non-name issue','unknown name rule','forged contract rule','forged contract fragment','missing contract proof','declared count mismatch',
 'duplicate source key','missing source key','empty mapping','empty external id','physical alias','target alias','payload key duplicate',
 'unreported key duplicate','unreported target duplicate','archived target','quarantined target','saved name no longer violates',
 'unfinished migration'])test(`batch ${problem} cannot use a name repair to bypass an unresolved identity or non-name failure`,async()=>{
 const h=await batchFixture();
 try {
  const payload=json(h.payload),issues=json(h.nameIssues);
  if(problem==='mixed non-name issue')issues.push({sourceKey:h.primary.sourceKey,code:'item_group_migration_required'});
  if(problem==='unknown name rule')issues[1].code='native_name_prohibited_future_rule';
  if(problem==='forged contract rule')issues[1].rule='demae-option-unverified-rule';
  if(problem==='forged contract fragment')issues[1].fragment='not-size';
  if(problem==='missing contract proof')delete issues[1].fragment;
  if(problem==='duplicate source key')issues.push({...issues[0]});
  if(problem==='missing source key')issues[1].sourceKey='option:unknown:missing';
  if(problem==='empty mapping')payload.targets[1].mappings=[];
  if(problem==='empty external id')payload.targets[1].mappings[0].externalId='';
  if(problem==='physical alias')payload.targets[1].mappings=json(payload.targets[0].mappings);
  if(problem==='target alias')payload.targets[1].targetId=payload.targets[0].targetId;
  if(problem==='payload key duplicate')payload.targets.push({...json(payload.targets[0]),targetId:randomUUID(),mappings:[{externalId:'another-native',externalParentId:'another-parent'}]});
  if(problem==='unreported key duplicate'||problem==='unreported target duplicate') {
   const other={...json(payload.targets[0]),sourceKey:'option:ordinary:unreported',targetId:randomUUID(),name:'Ordinary Sausage',
    mappings:[{externalId:'unreported-native-1',externalParentId:'ordinary-parent'}]};
   const duplicate={...json(other),sourceKey:problem==='unreported key duplicate'?other.sourceKey:'option:other:unreported',
    targetId:problem==='unreported target duplicate'?other.targetId:randomUUID(),mappings:[{externalId:'unreported-native-2',externalParentId:'another-parent'}]};
   payload.targets.push(other,duplicate);
  }
  if(problem==='archived target')payload.targets[1].archived=true;
  if(problem==='quarantined target')payload.targets[1].quarantined=true;
  if(problem==='saved name no longer violates')payload.targets[1].name='Taiwanese Pork Sausage Bites';
  if(problem==='unfinished migration')payload.migrationState.migration.phase='creating';
  const error=problem==='declared count mismatch'?`uber_authority_preflight_blocked:${issues.length+1}:${JSON.stringify(issues)}`:batchError(issues);
  await h.db.query('update local_bridge_commands set payload=$1,last_error=$2',[JSON.stringify(payload),error]);
  const before=await persisted(h);
  assert.equal(await h.service.adaptRejectedUberMenuName({...h.input,error}),false);
  assert.equal(h.requests.length,0);assert.equal(h.mutations.length,0);assert.deepEqual(await persisted(h),before);
 } finally {await h.db.close();}
});

test('generic Demae HTTP400 cannot become a name failure even when the saved option contains size',async()=>{
 const h=await batchFixture();
 try {
  const error=`uber_authority_content_failed:${h.primary.sourceKey}:${h.primary.name}:merchant_menu_request_failed:400:MWA0012`;
  await h.db.query('update local_bridge_commands set last_error=$1',[error]);
  const before=await persisted(h);
  assert.equal(await h.service.adaptRejectedUberMenuName({...h.input,error}),false);
  assert.equal(h.requests.length,0);assert.equal(h.mutations.length,0);assert.deepEqual(await persisted(h),before);
 } finally {await h.db.close();}
});

for(const alias of ['across reported targets','within one target','unreported active owner','wrong chain','wrong kind'])test(`Demae physical mapping normalization rejects ${alias} before any AI or adaptation write`,async()=>{
 const h=await batchFixture();
 try {
  const payload=json(h.payload);payload.merchantId='410649';
  payload.targets[0].mappings=[{externalId:'itemList_41064900000264true',externalParentId:'stage:0094'}];
  payload.targets[1].mappings=[{externalId:'00000263',externalParentId:'stage:0093',created:true}];
  if(alias==='across reported targets')payload.targets[1].mappings[0].externalId='00000264';
  if(alias==='within one target')payload.targets[0].mappings.push({externalId:'00000264',externalParentId:'stage:0094'});
  if(alias==='unreported active owner')payload.targets.push({...json(payload.targets[0]),sourceKey:'option:ordinary:unreported',
   targetId:randomUUID(),name:'Ordinary Sausage',mappings:[{externalId:'00000264',externalParentId:'stage:0094'}]});
  if(alias==='wrong chain')payload.targets[0].mappings[0].externalId='itemList_99999900000264true';
  if(alias==='wrong kind')payload.targets[0].mappings[0].externalId='itemList_41064900000264false';
  await h.db.query('update local_bridge_commands set payload=$1',[JSON.stringify(payload)]);
  const before=await persisted(h);
  assert.equal(await h.service.adaptRejectedUberMenuName(h.input),false);
  assert.equal(h.requests.length,0);assert.equal(h.mutations.length,0);assert.deepEqual(await persisted(h),before);
 } finally {await h.db.close();}
});

test('a two-target repair cannot exceed the shared three-execution queue cap',async()=>{
 const h=await batchFixture({attempts:3});
 try {
  const before=await persisted(h);
  assert.equal(await h.service.adaptRejectedUberMenuName(h.input),false);
  assert.equal(h.requests.length,0);assert.equal(h.mutations.length,0);assert.deepEqual(await persisted(h),before);
 } finally {await h.db.close();}
});

test('a larger definite-name preflight prepares only the first two payload targets and reports the remaining issue',async()=>{
 const h=await batchFixture();
 try {
  const payload=json(h.payload),third={...json(h.secondary),sourceKey:'option:third-group:third',targetId:randomUUID(),parentId:randomUUID(),
   mappings:[{externalId:'native-third',externalParentId:'third-parent'}]};
  payload.targets.push(third);
  // Raw failure ordering must not decide which two physical records are changed.
  const issues=[...h.nameIssues,{...h.nameIssues[0],sourceKey:third.sourceKey}].reverse(),error=batchError(issues);
  await h.db.query('update local_bridge_commands set payload=$1,last_error=$2',[JSON.stringify(payload),error]);
  const prepared=await h.service.adaptRejectedUberMenuName({...h.input,error}),after=await h.command();
  assert.deepEqual(h.requests.map(row=>row.sourceKey),payload.targets.slice(0,2).map(row=>row.sourceKey));
  assert.deepEqual(json(prepared.adaptedTargets.map(row=>row.sourceKey)),payload.targets.slice(0,2).map(row=>row.sourceKey));
  assert.equal(prepared.remainingNameIssues,1);assert.deepEqual(after.payload.targets[2],third);
  assert.equal(after.attempts,1);assert.equal(after.status,'pending');
  assert.equal(Object.keys((await h.source()).publish_config.demae_can.nameAdaptations).length,2);
 } finally {await h.db.close();}
});

test('an exhausted second target stops AI for the entire batch before any first candidate is generated',async()=>{
 const h=await batchFixture();
 try {
  const saved={...batchCandidate({sourceKey:h.secondary.sourceKey,targetId:h.secondary.targetId,inputName:h.secondary.name}),
   sourceName:h.secondary.sourceName,verified:false,attemptedNames:['first rejected','second rejected'],
   rejectionReason:h.input.error,createdAt:'2026-10-05T00:00:00Z'};
  await h.db.query("update menu_uber_sources set publish_config=jsonb_set(publish_config,'{demae_can,nameAdaptations}',jsonb_build_object($1::text,$2::jsonb),true)",
   [h.secondary.sourceKey,JSON.stringify(saved)]);
  const before=await persisted(h);
  await assert.rejects(h.service.adaptRejectedUberMenuName(h.input),/menu_name_ai_exhausted/);
  const after=await persisted(h);
  assert.equal(h.requests.length,0);assert.deepEqual(after.command.payload,before.command.payload);
  assert.deepEqual(after.source,before.source);assert.equal(after.command.status,before.command.status);
  assert.equal(after.command.result.nameAdaptationDiagnostic.sourceKey,h.secondary.sourceKey);
 } finally {await h.db.close();}
});

test('the real failed ACK hands off one atomic two-target batch and cannot inject its own adaptation records',async()=>{
 const h=await batchFixture();
 try {
  const before=await h.command();
  const response=await h.ack({status:'failed',error:h.input.error,result:{nativePreflight:'confirmed-name-only',
   nameAdaptationDiagnostic:{sourceKey:'forged'},nameAdaptation:{adaptedTargets:[{sourceKey:'forged',adaptedName:'forged'}]}}});
  assert.equal(response.status,200);
  const after=await h.command();assert.equal(after.id,before.id);assert.equal(after.status,'pending');assert.equal(after.attempts,1);
  assert.equal(after.result.nameAdaptationDiagnostic,undefined);
  assert.equal(after.result.nativePreflight,'confirmed-name-only');
  assert.deepEqual(after.result.nameAdaptation.adaptedTargets.map(row=>row.sourceKey),h.payload.targets.map(row=>row.sourceKey));
  assert.doesNotMatch(JSON.stringify(after.result.nameAdaptation),/forged/);assert.equal(h.requests.length,2);
 } finally {await h.db.close();}
});

test('both independent candidates are confirmed only after every native occurrence passes the ordinary full verifier',async()=>{
 const h=await batchFixture();
 try {
  await h.service.adaptRejectedUberMenuName(h.input);
  await h.db.exec("update local_bridge_commands set status='processing'");
  const command=await h.command();
  const observations=command.payload.targets.map(target=>({sourceKey:target.sourceKey,externalId:target.mappings[0].externalId,
   name:target.name,price:target.price,hidden:true,structureVerified:true}));
  const args={commandId:h.ids.command,storeId:h.ids.store,platform:'demae_can',progress:{}};
  const assertUnverified=async()=>{
   const slots=(await h.source()).publish_config.demae_can.nameAdaptations;
   assert.deepEqual(Object.values(slots).map(row=>row.verified),[false,false]);
  };
  for(const invalid of [observations.slice(0,1),observations.map((row,index)=>index===1?{...row,externalId:'wrong-native'}:row),
   observations.map((row,index)=>index===1?{...row,name:h.primary.name}:row),
   observations.map((row,index)=>index===1?{...row,structureVerified:false}:row)]) {
   await assert.rejects(h.publication.recordUberPublicationProgress({...args,result:{observations:invalid}}));
   await assertUnverified();
  }
  await h.publication.recordUberPublicationProgress({...args,result:{observations}});
  assert.deepEqual(Object.values((await h.source()).publish_config.demae_can.nameAdaptations).map(row=>row.verified),[true,true]);
 } finally {await h.db.close();}
});

test('a future payload can reuse both name slots only after real full verification confirms their exact identities',async()=>{
 const h=await batchFixture();
 try {
  await h.service.adaptRejectedUberMenuName(h.input);
  const command=await h.command();
  const nodes=h.payload.targets.map(target=>({sourceKey:target.sourceKey,kind:'option',targetId:target.targetId,parentId:target.parentId,
   name:target.sourceName,displayNames:{zh:'一口台湾猪肉肠',ko:'한입 대만식 돼지고기 소시지',en:'Bite-Sized Taiwanese Pork Sausage'},
   uberPrice:316,price:316,description:target.description??'',imageUrl:'',sortOrder:target.sortOrder,payload:target.source}));
  const mappings=h.payload.targets.flatMap(target=>target.mappings.map(mapping=>({...mapping,kind:'option',targetId:target.targetId})));
  const build=async overrides=>h.publicationBuilder.buildUberPublication({sourceId:h.ids.source,storeId:h.ids.store,brandId:h.ids.brand,
   revision:37,platform:'demae_can',merchantId:'0076',nodes,mappings,
   nameAdaptations:(await h.source()).publish_config.demae_can.nameAdaptations,...overrides});
  const unconfirmed=await build();
  assert.deepEqual(unconfirmed.targets.map(target=>target.name),h.payload.targets.map(target=>target.name));
  assert.ok(unconfirmed.targets.every(target=>!target.nameAdaptation));
  await h.db.exec("update local_bridge_commands set status='processing'");
  await h.publication.recordUberPublicationProgress({commandId:h.ids.command,storeId:h.ids.store,platform:'demae_can',progress:{},
   result:{observations:command.payload.targets.map(target=>({sourceKey:target.sourceKey,externalId:target.mappings[0].externalId,
    name:target.name,price:target.price,hidden:true,structureVerified:true}))}});
  const confirmed=await build();
  assert.deepEqual(confirmed.targets.map(target=>target.name),command.payload.targets.map(target=>target.name));
  assert.ok(confirmed.targets.every(target=>target.nameAdaptation?.verified===true));
  for(const patch of [{targetId:randomUUID()},{name:'別の商品'},
   {displayNames:{...nodes[1].displayNames,en:'Taiwanese Chicken Sausage'}}]) {
   const altered=await build({nodes:[nodes[0],{...nodes[1],...patch}]});
   assert.equal(altered.targets[0].name,command.payload.targets[0].name);
   assert.equal(altered.targets[1].nameAdaptation,undefined,'a cache slot never crosses target, source or projection identity');
  }
 } finally {await h.db.close();}
});
