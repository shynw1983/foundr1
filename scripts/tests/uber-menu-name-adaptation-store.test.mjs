// Real PostgreSQL tests for the production adapter SQL. The only service
// dependency stub is AI generation; DATABASE_URL is never loaded or used.
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
  create table local_bridge_commands(id uuid primary key,store_id uuid,platform text,status text,attempts integer,payload jsonb,result jsonb default '{}',last_error text default '',created_at timestamptz default now(),updated_at timestamptz default now(),available_at timestamptz default now(),completed_at timestamptz,claimed_by_device_id uuid,claimed_at timestamptz,claim_expires_at timestamptz);
  create table menu_external_platforms(id uuid primary key,brand_id uuid,store_id uuid,platform_key text);
  create table menu_uber_creation_attempts(source_id uuid,platform text,source_key text,status text,external_id text,external_parent_id text,command_id uuid);
  create table menu_platform_availability_settings(target_id uuid,availability text);
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
 let gate;
 const requests=[];
 const mocks={
  'lib/menu-name-adaptation.ts':{
   findRejectedMenuNameTarget(value,error) {
    const target=value.targets.find(row=>error.startsWith(`uber_authority_content_failed:${row.sourceKey}:${row.name}:`));
    return target?{platform:value.platformKey,sourceKey:target.sourceKey,targetId:target.targetId,kind:target.kind,inputName:target.name,originalName:target.sourceName,rejectionReason:error}:null;
   },
   async requestMenuNameAdaptation(input) {
    requests.push(json(input));
    if(gate)await gate.promise;
    return {sourceKey:input.sourceKey,targetId:input.targetId,inputName:input.inputName,
     name:kind==='item'?'四川風麻辣湯330円から':'お願い：商品合計1,600円からで',
     reason:'Keep the minimum amount meaning',model:'test-model',policyVersion:'contextual-name-v1'};
   }
  }
 };
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
 function load(path) {
  if(mocks[path])return mocks[path];
  if(cache.has(path))return cache.get(path);
  const exports={};cache.set(path,exports);
  const source=ts.transpileModule(readFileSync(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,Date,Error,Response,URL,console,process,structuredClone,
   require:name=>{
    if(!name.startsWith('.'))return require(name);
    let dependency=relative(root,resolve(root,dirname(path),name));
    if(!dependency.endsWith('.ts'))dependency+='.ts';
    return load(dependency);
   }});
  return exports;
 }
 const service=load('lib/uber-menu-name-adaptation-store.ts');
 const publication=load('lib/uber-menu-publication-store.ts');
 const input={commandId:ids.command,storeId:ids.store,platform:'rocket_now',status,claim,
  error:`uber_authority_content_failed:${primary.sourceKey}:${primary.name}:merchant_menu_request_failed:200:10036`};
 const command=async()=>(await db.query('select * from local_bridge_commands where id=$1',[ids.command])).rows[0];
 const source=async()=>(await db.query('select * from menu_uber_sources where id=$1',[ids.source])).rows[0];
 const external=async()=>({receipts:(await db.query('select * from menu_uber_creation_attempts')).rows,stock:(await db.query('select * from menu_platform_availability_settings')).rows});
 const setCandidate=async candidate=>db.query("update menu_uber_sources set publish_config=jsonb_set(publish_config,'{rocket_now}',publish_config->'rocket_now'||jsonb_build_object('nameAdaptations',jsonb_build_object($1::text,$2::jsonb)))",[primary.sourceKey,JSON.stringify(candidate)]);
 return {db,ids,claim,payload,config,primary,input,service,publication,requests,command,source,external,setCandidate,
  defer(){gate=defer();return gate;},
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

test('two previously rejected names stop further AI calls and preserve the command',async()=>{
 const h=await fixture();
 try {
  await h.setCandidate({sourceKey:h.primary.sourceKey,targetId:h.primary.targetId,sourceName:h.primary.sourceName,
   inputName:h.primary.name,name:'previous candidate',verified:false,attemptedNames:['candidate one','candidate two']});
  const before=await h.command(),config=(await h.source()).publish_config;
  await assert.rejects(h.service.adaptRejectedUberMenuName(h.input),/menu_name_ai_exhausted/);
  assert.equal(h.requests.length,0);assert.deepEqual(await h.command(),before);
  assert.deepEqual((await h.source()).publish_config,config);
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
