// Real PostgreSQL queue/manifest tests. No production configuration or platform
// network is loaded; the native publisher remains the existing verified runner.
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

async function fixture({status='failed',trigger='manual',missing=false}={}) {
 const db=new PGlite();
 await db.exec(`
 create table menu_uber_sources(id uuid primary key,brand_id uuid,store_id uuid,uber_store_uuid text,revision int,enabled boolean,auto_publish boolean,publish_config jsonb,last_catalog jsonb,last_content_hash text,missing_keys text[] default '{}',last_checked_at timestamptz,last_error text default '',updated_at timestamptz default now());
 create table menu_uber_objects(source_id uuid,source_key text,kind text,uber_id text,parent_uber_id text,target_id uuid,price_mode text,archived boolean default false,last_uber_price numeric,source_payload jsonb,updated_at timestamptz default now(),primary key(source_id,source_key));
 create table menu_catalog_items(id uuid primary key,brand_id uuid,store_id uuid,external_id text,name text,display_names jsonb,base_price numeric,variable_schema jsonb,description text,image_url text,sort_order int,is_active boolean default true);
 create table menu_option_groups(id uuid primary key,brand_id uuid,external_id text,name text,display_names jsonb,group_key text,rule_json jsonb,sort_order int,is_active boolean default true);
 create table menu_options(id uuid primary key,option_group_id uuid,external_id text,name text,display_names jsonb,price_delta numeric,image_url text,sort_order int,is_active boolean default true);
 create table menu_categories(id uuid primary key,brand_id uuid,store_id uuid,external_id text,name text,sort_order int);
 create table menu_external_platforms(id uuid primary key,brand_id uuid,store_id uuid,platform_key text,is_active boolean default true);
 create table menu_platform_object_mappings(id uuid primary key default gen_random_uuid(),brand_id uuid,store_id uuid,external_platform_id uuid,target_type text,target_id uuid,external_id text,external_parent_id text,external_name text,unique(external_platform_id,target_type,external_id));
 create table menu_uber_creation_attempts(source_id uuid,platform text,source_key text,status text,external_id text,external_parent_id text,command_id uuid,primary key(source_id,platform,source_key));
 create table menu_uber_option_migrations(source_id uuid,platform text,migration_key text,state jsonb,primary key(source_id,platform,migration_key));
 create table local_bridge_commands(id uuid primary key default gen_random_uuid(),store_id uuid,platform text,command_type text,status text default 'pending',attempts int default 0,idempotency_key text unique,payload jsonb,result jsonb default '{}',last_error text default '',created_at timestamptz default now(),updated_at timestamptz default now(),available_at timestamptz default now(),completed_at timestamptz,claimed_by_device_id uuid,claimed_at timestamptz,claim_expires_at timestamptz);
 create table menu_uber_sync_runs(id uuid primary key default gen_random_uuid(),source_id uuid,command_id uuid,revision int,content_hash text,summary jsonb,created_at timestamptz default now());
 create table menu_store_settings(brand_id uuid,menu_catalog_item_id uuid,price_override numeric);
 create table menu_platform_target_settings(brand_id uuid,target_type text,target_id uuid,price_override numeric);
 create table menu_platform_availability_settings(target_id uuid,availability text);
 `);
 const lock=readFileSync(resolve(root,'db/uber-menu-authority.sql'),'utf8').match(/create or replace function lock_menu_uber_revision[\s\S]*?\$\$;/)?.[0];
 assert.ok(lock);await db.exec(lock);
 let beforeTransaction;
 const sql=(parts,...params)=>({text:parts.map((part,index)=>part+(index<params.length?`$${index+1}`:'')).join(''),params,
   then(resolve,reject){return db.query(this.text,this.params).then(result=>result.rows).then(resolve,reject);}});
 sql.transaction=async(statements,options)=>{
  if(beforeTransaction){const action=beforeTransaction;beforeTransaction=undefined;await action();}
  return db.transaction(async tx=>{const rows=[];for(const statement of statements)rows.push((await tx.query(statement.text,statement.params)).rows);return rows;});
 };
 const broadcasts=[];
 const mocks={'lib/db.ts':{sql},'lib/local-bridge-realtime.ts':{publishBridgeCommandAvailable:async store=>broadcasts.push(store)}};
 const cache=new Map();
 function load(path) {
  if(mocks[path])return mocks[path];if(cache.has(path))return cache.get(path);
  const exports={};cache.set(path,exports);
  const source=ts.transpileModule(readFileSync(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,Date,Error,console,process,structuredClone,require:name=>{
   if(!name.startsWith('.'))return require(name);
   let dependency=relative(root,resolve(root,dirname(path),name));if(!dependency.endsWith('.ts'))dependency+='.ts';return load(dependency);
  }});return exports;
 }
 const ids={source:randomUUID(),store:randomUUID(),brand:randomUUID(),capture:randomUUID(),rocket:randomUUID(),demae:randomUUID(),item:randomUUID(),category:randomUUID(),g1:randomUUID(),g2:randomUUID(),o1:randomUUID(),o2:randomUUID()};
 const catalog={version:1,storeUuid:'uber-store',menuId:'delivery',capturedAt:'2026-10-06T00:00:00Z',sections:[{id:'s',name:'All day',categoryIds:['c'],hours:[],hidden:false}],
  categories:[{id:'c',name:'汤底',itemIds:['a'],hidden:false}],
  groups:[{id:'g2',name:'豆腐',optionIds:['b2'],min:0,max:1},{id:'g1',name:'ねぎ',optionIds:['b1'],min:0,max:1}],
  entities:[{id:'a',name:'麻辣湯｜麻辣汤',description:'Soup description',imageUrl:'https://image.invalid/a',price:330,groupIds:['g1','g2'],contextPrices:[]},
   {id:'b1',name:'ねぎ50g',description:'',imageUrl:'',price:70,groupIds:[],contextPrices:[]},
   {id:'b2',name:'豆腐50g',description:'',imageUrl:'',price:90,groupIds:[],contextPrices:[]}]};
 const objects=[{sourceKey:'category:c',kind:'category',uberId:'c',targetId:ids.category,parentUberId:'',payload:catalog.categories[0],sortOrder:0,price:null,parentId:null},
  ...catalog.groups.map((group,index)=>({sourceKey:`option_group:${group.id}`,kind:'option_group',uberId:group.id,targetId:ids[group.id],parentUberId:'',payload:group,sortOrder:index*10,price:null,parentId:null})),
  {sourceKey:'option:g1:b1',kind:'option',uberId:'b1',parentUberId:'g1',targetId:ids.o1,payload:{...catalog.entities[1],groupId:'g1'},sortOrder:0,price:70,parentId:ids.g1},
  {sourceKey:'option:g2:b2',kind:'option',uberId:'b2',parentUberId:'g2',targetId:ids.o2,payload:{...catalog.entities[2],groupId:'g2'},sortOrder:0,price:90,parentId:ids.g2},
  {sourceKey:'item:a',kind:'item',uberId:'a',targetId:ids.item,parentUberId:'',payload:{...catalog.entities[0],categoryIds:['c'],attached:true},sortOrder:0,price:330,parentId:ids.category}];
 const authority=load('lib/uber-menu-authority.ts');
 const hash=authority.uberSourceContentHash(catalog);
 const config={rocket_now:{merchantId:'1',optionMigrationPolicy:'preserve_stock'},demae_can:{merchantId:'1',menuPatternCode:'live',draftPatternCode:'draft',draftCarrierItemCode:'15',selectionPolicy:'strict'}};
 await db.query('insert into menu_uber_sources values($1,$2,$3,\'uber-store\',38,true,true,$4,$5,$6,\'{}\',now(),\'\',now())',[ids.source,ids.brand,ids.store,JSON.stringify(config),JSON.stringify(catalog),hash]);
 for(const object of objects) {
  await db.query('insert into menu_uber_objects(source_id,source_key,kind,uber_id,parent_uber_id,target_id,price_mode,last_uber_price,source_payload) values($1,$2,$3,$4,$5,$6,\'automatic\',$7,$8)',[ids.source,object.sourceKey,object.kind,object.uberId,object.parentUberId,object.targetId,object.price,JSON.stringify(object.payload)]);
  if(object.kind==='category')await db.query('insert into menu_categories(id,brand_id,external_id,name,sort_order) values($1,$2,$3,$4,$5)',[object.targetId,ids.brand,object.uberId,object.payload.name,object.sortOrder]);
  if(object.kind==='option_group')await db.query('insert into menu_option_groups(id,brand_id,external_id,name,display_names,group_key,rule_json,sort_order) values($1,$2,$3,$4,\'{}\',$3,\'{}\',$5)',[object.targetId,ids.brand,object.uberId,object.payload.name,object.sortOrder]);
  if(object.kind==='option')await db.query('insert into menu_options(id,option_group_id,external_id,name,display_names,price_delta,sort_order) values($1,$2,$3,$4,\'{}\',$5,$6)',[object.targetId,object.parentId,object.uberId,object.payload.name,object.price,object.sortOrder]);
  if(object.kind==='item')await db.query('insert into menu_catalog_items(id,brand_id,external_id,name,display_names,base_price,variable_schema,description,image_url,sort_order) values($1,$2,$3,\'麻辣湯\',\'{"zh":"麻辣汤"}\',$4,\'{}\',$5,$6,$7)',[object.targetId,ids.brand,object.uberId,object.price,object.payload.description,object.payload.imageUrl,object.sortOrder]);
 }
 const native={},payloads={};
 const publication=load('lib/uber-menu-publication.ts');
 const nodes=objects.map(object=>({sourceKey:object.sourceKey,kind:object.kind,targetId:object.targetId,parentId:object.parentId,
  ...authority.splitUberName(object.payload.name),uberPrice:object.price,price:object.price,description:object.payload.description??'',imageUrl:'',sortOrder:object.sortOrder,payload:object.payload}));
 for(const platform of ['uber_eats','rocket_now','demae_can']) {
  const platformId=randomUUID();native[platform]=platformId;
  await db.query('insert into menu_external_platforms(id,brand_id,platform_key) values($1,$2,$3)',[platformId,ids.brand,platform]);
  for(const object of objects) {
   const externalId=platform==='uber_eats'?object.uberId:`native-${object.uberId}`;
   const parent=object.kind==='option'?platform==='uber_eats'?object.parentUberId:`native-${object.parentUberId}`:'';
   await db.query('insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_parent_id,external_name) values($1,$2,$3,$4,$5,$6,$7)',[ids.brand,platformId,object.kind,object.targetId,externalId,parent,object.payload.name]);
  }
  if(platform==='uber_eats')continue;
  const mappings=objects.map(object=>({kind:object.kind,targetId:object.targetId,externalId:`native-${object.uberId}`,externalParentId:object.kind==='option'?`native-${object.parentUberId}`:''}));
  const payload=publication.buildUberPublication({sourceId:ids.source,storeId:ids.store,brandId:ids.brand,revision:38,platform,...config[platform],nodes,mappings,creationIdentities:[]});
  Object.assign(payload,{authorityState:{},migrationState:{},pendingRemovals:[],manualRetryHistory:[{error:'earlier issue',attempts:1}]});
  payloads[platform]=payload;
  if(!missing)await db.query('insert into local_bridge_commands(id,store_id,platform,command_type,idempotency_key,status,attempts,payload,result,last_error,created_at) values($1,$2,$3,\'publish_menu_changes\',$4,$5,3,$6,$7,\'menu_name_ai_invalid\',\'2026-10-05T00:00:00Z\')',
   [ids[platform==='rocket_now'?'rocket':'demae'],ids.store,platform,`uber-publish:${ids.source}:38:${platform}`,status,JSON.stringify(payload),JSON.stringify({receipt:'keep',progress:{phase:'content'},privateJournal:{item:'native-a'}})]);
 }
 await db.query('insert into local_bridge_commands(id,store_id,platform,command_type,status,payload) values($1,$2,\'uber_eats\',\'capture_menu_snapshot\',\'processing\',$3)',[ids.capture,ids.store,JSON.stringify({sourceId:ids.source,brandId:ids.brand,authoritativeSource:true,trigger})]);
 const policies=load('lib/uber-option-placement.ts');
 await db.query('insert into menu_uber_sync_runs(source_id,command_id,revision,content_hash,summary,created_at) values($1,$2,38,$3,$4,\'2026-10-05T00:00:00Z\')',[ids.source,randomUUID(),hash,JSON.stringify({placementRuleVersion:policies.UBER_PLACEMENT_RULE_VERSION,priceRuleVersion:authority.UBER_PRICE_RULE_VERSION})]);
 await db.query('insert into menu_platform_availability_settings values($1,\'unavailable\')',[ids.item]);
 const service=load('lib/uber-menu-publication-reconcile.ts');
 const input={sourceId:ids.source,storeId:ids.store,revision:38,mode:trigger,captureCommandId:ids.capture};
 const command=async platform=>(await db.query('select * from local_bridge_commands where id=$1',[ids[platform==='rocket_now'?'rocket':'demae']])).rows[0];
 return {db,ids,catalog,nodes,native,payloads,service,input,publication,command,broadcasts,
  reconcile:patch=>service.reconcileUberPublications({...input,...patch}),
  race(action){beforeTransaction=action;},
  async finish(){await db.query("update local_bridge_commands set status='succeeded' where platform in ('rocket_now','demae_can')");},
  async external(){return {stock:(await db.query('select * from menu_platform_availability_settings')).rows,receipts:(await db.query('select * from menu_uber_creation_attempts')).rows,migrations:(await db.query('select * from menu_uber_option_migrations')).rows};},
  async ingest(){const next={...catalog,capturedAt:'2026-10-06T00:10:00Z'};return load('lib/uber-menu-source-sync.ts').ingestUberMenuSource({sourceId:ids.source,storeId:ids.store,commandId:ids.capture,catalog:next});}
 };
}

test('unchanged manual OS scan queues both legacy failed commands, preserving IDs/results and exact policies',async()=>{
 const h=await fixture();try {
  const old=await h.command('rocket_now'),external=await h.external();
  const result=await h.ingest();assert.equal(result.noChanges,true);assert.equal(result.reconciliation.queued,2);assert.equal(result.reconciliation.blocked.length,0);
  for(const platform of ['rocket_now','demae_can']) {
   const command=await h.command(platform);assert.equal(command.status,'pending');assert.equal(command.attempts,0);assert.equal(command.id,h.ids[platform==='rocket_now'?'rocket':'demae']);
   assert.deepEqual(command.result,old.result);assert.equal(command.payload.revision,38);assert.equal(command.payload.imagePolicy,'read_only');assert.equal(command.payload.newItemsHidden,true);
   assert.deepEqual(command.payload.targets.map(row=>row.sourceKey).sort(),h.payloads[platform].targets.map(row=>row.sourceKey).sort());
   assert.equal(command.payload.targets.find(row=>row.sourceKey==='item:a').price,330);assert.deepEqual(command.payload.targets.find(row=>row.sourceKey==='item:a').source.groupIds,['g1','g2']);
   assert.equal(command.payload.targets.find(row=>row.sourceKey==='option_group:g2').sortOrder,0);assert.equal(command.payload.targets.find(row=>row.sourceKey==='option_group:g1').sortOrder,10);
  }
  assert.deepEqual(await h.external(),external);assert.deepEqual(h.broadcasts,[h.ids.store]);
  const source=(await h.db.query('select revision from menu_uber_sources')).rows[0];assert.equal(source.revision,38);
 }finally {await h.db.close();}
});

test('manual scan also requeues successful platforms for fresh native verification; repeated ACK is idempotent',async()=>{
 const h=await fixture({status:'succeeded'});try {
  assert.equal((await h.ingest()).reconciliation.queued,2);await h.finish();
  const repeated=await h.ingest();assert.equal(repeated.reconciliation.queued,2);
  assert.equal((await h.command('rocket_now')).payload.manualRetryHistory.length,2);
  assert.equal((await h.command('rocket_now')).status,'succeeded');assert.equal((await h.command('demae_can')).status,'succeeded');
 }finally {await h.db.close();}
});

for(const changed of ['revision','capture time'])test(`late unchanged ACK cannot requeue a newer ${changed}`,async()=>{
 const h=await fixture();try {
  const first=await h.ingest();await h.finish();
  if(changed==='revision')await h.db.query('update menu_uber_sources set revision=39');
  else await h.db.query("update menu_uber_sources set last_catalog=jsonb_set(last_catalog,'{capturedAt}','\"2026-10-06T01:00:00Z\"')");
  const before=await h.command('rocket_now');assert.deepEqual(await h.ingest(),json(first));
  assert.deepEqual((await h.command('rocket_now')).payload,before.payload);assert.equal((await h.command('rocket_now')).status,'succeeded');
 }finally {await h.db.close();}
});

test('unknown in-flight creation journal is retained, never converted to permission for a new create',async()=>{
 const h=await fixture();try {
  const command=await h.command('rocket_now');command.payload.authorityState['option:orphan:key']={status:'creating',externalId:'receipt-only-id',externalParentId:'stage:old'};
  await h.db.query('update local_bridge_commands set payload=$1 where id=$2',[JSON.stringify(command.payload),h.ids.rocket]);
  assert.equal((await h.reconcile()).queued,2);assert.deepEqual((await h.command('rocket_now')).payload.authorityState,command.payload.authorityState);
 }finally {await h.db.close();}
});

test('a temporarily blocked committed import can reconcile on a repeated capture ACK instead of losing the downstream run',async()=>{
 const h=await fixture();try {
  const active=randomUUID();await h.db.query('insert into local_bridge_commands(id,store_id,platform,command_type,status,payload) values($1,$2,\'rocket_now\',\'publish_menu_changes\',\'processing\',$3)',[active,h.ids.store,JSON.stringify({...h.payloads.rocket_now,unrelated:'active'})]);
  const first=await h.ingest();assert.equal(first.noChanges,true);assert.equal(first.reconciliation.queued,0);assert.match(first.reconciliation.blocked[0].code,/active/);
  await h.db.query("delete from local_bridge_commands where id=$1",[active]);
  assert.equal((await h.ingest()).reconciliation.queued,2);
 }finally {await h.db.close();}
});

test('missing current revision commands use ordinary new publication keys with complete source ordering',async()=>{
 const h=await fixture({missing:true});try {
  const result=await h.reconcile();assert.equal(result.queued,2);
  const rows=(await h.db.query("select * from local_bridge_commands where command_type='publish_menu_changes' order by platform")).rows;
  assert.equal(rows.length,2);for(const row of rows){assert.equal(row.idempotency_key,`uber-publish:${h.ids.source}:38:${row.platform}`);assert.equal(row.payload.targets.length,6);}
 }finally {await h.db.close();}
});

for(const head of ['missing','older revision'])test(`a ${head} publication cannot bypass a newer failed head during preparation`,async()=>{
 const h=await fixture({missing:head==='missing'});try {
  if(head==='older revision')await h.db.query("update local_bridge_commands set payload=jsonb_set(payload,'{revision}','37') where platform in ('rocket_now','demae_can')");
  const concurrent=randomUUID();h.race(async()=>{
   await h.db.query('insert into local_bridge_commands(id,store_id,platform,command_type,status,idempotency_key,payload) values($1,$2,\'demae_can\',\'publish_menu_changes\',\'failed\',\'different-key\',$3)',[concurrent,h.ids.store,JSON.stringify(h.payloads.demae_can)]);
  });
  const result=await h.reconcile();assert.equal(result.queued,0);assert.equal(result.blocked[0].code,'uber_publication_reconcile_conflict');
  assert.equal((await h.db.query("select count(*) as n from local_bridge_commands where status='pending'")).rows[0].n,0);
  assert.equal((await h.db.query('select status from local_bridge_commands where id=$1',[concurrent])).rows[0].status,'failed');
 }finally {await h.db.close();}
});

test('scheduled recovery skips successes and content failures; only two extra network retries are permitted',async()=>{
 const h=await fixture({trigger:'scheduled'});try {
  assert.equal((await h.reconcile()).queued,0);
  await h.db.query("update local_bridge_commands set status='succeeded' where id=$1",[h.ids.demae]);
  await h.db.query("update local_bridge_commands set last_error='merchant_menu_timeout' where id=$1",[h.ids.rocket]);
  for(let count=1;count<=2;count++) {
   const capture=count===1?h.ids.capture:randomUUID();
   if(count===2)await h.db.query('insert into local_bridge_commands(id,store_id,platform,command_type,status,payload) values($1,$2,\'uber_eats\',\'capture_menu_snapshot\',\'processing\',$3)',[capture,h.ids.store,JSON.stringify({sourceId:h.ids.source,authoritativeSource:true,trigger:'scheduled'})]);
   if(count===2)await h.db.query("update local_bridge_commands set status='succeeded' where id=$1",[h.ids.capture]);
   assert.equal((await h.reconcile({captureCommandId:capture})).queued,1);
   const command=await h.command('rocket_now');assert.equal(command.payload.publicationReconciliation.scheduledRetries,count);
   await h.db.query("update local_bridge_commands set status='failed',last_error='merchant_menu_timeout' where id=$1",[h.ids.rocket]);
   await h.db.query("update local_bridge_commands set status='succeeded' where id=$1",[capture]);
  }
  const result=await h.reconcile({captureCommandId:undefined});assert.equal(result.queued,0);assert.ok(result.blocked.some(row=>row.code.endsWith('scheduled_limit')));
 }finally {await h.db.close();}
});

test('exact prepared candidate, migrated/created flags and unfinished journals survive refresh',async()=>{
 const h=await fixture();try {
  const before=await h.command('rocket_now'),payload=before.payload,target=payload.targets.find(row=>row.sourceKey==='option:g1:b1');
  target.nameAdaptation={sourceKey:target.sourceKey,targetId:target.targetId,sourceName:target.sourceName,inputName:target.nameProjection,name:'ねぎ 50g',verified:false};target.name='ねぎ 50g';target.mappings[0].created=true;target.mappings[0].migrated=true;
  payload.authorityState[target.sourceKey]={status:'identified',externalId:target.mappings[0].externalId,externalParentId:target.mappings[0].externalParentId};
  payload.migrationState.incomplete={targetId:target.targetId,phase:'identity_saved',sourceKey:target.sourceKey,newId:'native-b1'};
  await h.db.query('update local_bridge_commands set payload=$1 where id=$2',[JSON.stringify(payload),h.ids.rocket]);
  const result=await h.reconcile();assert.equal(result.queued,2);
  const after=await h.command('rocket_now'),actual=after.payload.targets.find(row=>row.sourceKey===target.sourceKey);
  assert.deepEqual(actual.nameAdaptation,target.nameAdaptation);assert.equal(actual.name,target.name);assert.equal(actual.mappings[0].created,true);assert.equal(actual.mappings[0].migrated,true);
  assert.deepEqual(after.payload.authorityState,payload.authorityState);assert.deepEqual(after.payload.migrationState,payload.migrationState);assert.deepEqual(after.result,before.result);
  const observations=after.payload.targets.map(row=>({sourceKey:row.sourceKey,externalId:row.mappings[0].externalId,name:row.name,price:row.price,hidden:false,structureVerified:true}));
  assert.throws(()=>h.publication.verifyUberPublication(after.payload,{observations}),/draft_exposed/);
 }finally {await h.db.close();}
});

test('old-key Demae carrier receipts remain complete even after their option moves to another source group',async()=>{
 const h=await fixture();try {
  const old=await h.command('demae_can');const target=old.payload.targets.find(row=>row.sourceKey==='option:g1:b1');
  const key='option:retired-group:b1';target.mappings[0].externalParentId='stage:0010';
  const mappings=old.payload.targets.flatMap(row=>row.mappings.map(mapping=>({kind:row.kind,targetId:row.targetId,...mapping})));
  await h.db.query("update menu_platform_object_mappings set external_parent_id='stage:0010' where external_platform_id=$1 and target_id=$2",[h.native.demae_can,target.targetId]);
  await h.db.query("insert into menu_uber_creation_attempts values($1,'demae_can',$2,'identified',$3,'stage:0010',$4)",[h.ids.source,key,target.mappings[0].externalId,h.ids.demae]);
  const reconstructed=h.publication.buildUberPublication({sourceId:h.ids.source,storeId:h.ids.store,brandId:h.ids.brand,revision:38,platform:'demae_can',merchantId:'1',menuPatternCode:'live',draftPatternCode:'draft',draftCarrierItemCode:'15',nodes:h.nodes,mappings,
   creationIdentities:[{sourceKey:key,status:'identified',externalId:target.mappings[0].externalId,externalParentId:'stage:0010'}]});
  old.payload.targets=reconstructed.targets;
  await h.db.query('update local_bridge_commands set payload=$1 where id=$2',[JSON.stringify(old.payload),h.ids.demae]);
  assert.equal((await h.reconcile()).queued,2);const after=await h.command('demae_can');
  assert.equal(after.payload.targets.find(row=>row.sourceKey===target.sourceKey).marker,reconstructed.targets.find(row=>row.sourceKey===target.sourceKey).marker);
  assert.equal(after.payload.authorityState[key].externalParentId,'stage:0010');
 }finally {await h.db.close();}
});

test('persisted replay retains archived identities and applies the ordinary promotion alias policy',async()=>{
 const h=await fixture();try {
  const archived=randomUUID(),promotion=randomUUID(),alias=randomUUID();
  const catalog=json(h.catalog);catalog.groups.push({id:'new',name:'新登場トッピング',optionIds:['b1'],min:0,max:1});catalog.entities[0].groupIds.push('new');
  const itemPayload={...catalog.entities[0],categoryIds:['c'],attached:true};
  await h.db.query('update menu_uber_sources set last_catalog=$1',[JSON.stringify(catalog)]);
  await h.db.query("update menu_uber_objects set source_payload=$1 where source_key='item:a'",[JSON.stringify(itemPayload)]);
  await h.db.query("insert into menu_option_groups(id,brand_id,name,display_names) values($1,$2,'新登場トッピング','{}')",[promotion,h.ids.brand]);
  await h.db.query("insert into menu_options(id,option_group_id,name,display_names,price_delta) values($1,$2,'ねぎ50g','{}',70)",[alias,promotion]);
  const additions=[
   {sourceKey:'option_group:retired',kind:'option_group',targetId:archived,parentId:null,name:'',displayNames:{},uberPrice:null,price:null,description:'',imageUrl:'',sortOrder:0,payload:{},archived:true},
   {sourceKey:'option_group:new',kind:'option_group',targetId:promotion,parentId:null,name:'新登場トッピング',displayNames:{},uberPrice:null,price:null,description:'',imageUrl:'',sortOrder:20,payload:catalog.groups.at(-1)},
   {sourceKey:'option:new:b1',kind:'option',targetId:alias,parentId:promotion,name:'ねぎ50g',displayNames:{},uberPrice:70,price:70,description:'',imageUrl:'',sortOrder:0,payload:{...catalog.entities[1],groupId:'new'}}
  ];
  for(const node of additions)await h.db.query('insert into menu_uber_objects(source_id,source_key,kind,uber_id,parent_uber_id,target_id,price_mode,archived,last_uber_price,source_payload) values($1,$2,$3,$4,$5,$6,\'automatic\',$7,$8,$9)',
   [h.ids.source,node.sourceKey,node.kind,node.kind==='option'?'b1':node.sourceKey.split(':').at(-1),node.kind==='option'?'new':'',node.targetId,Boolean(node.archived),node.uberPrice,JSON.stringify(node.payload)]);
  const nodes=h.nodes.map(node=>node.kind==='item'?{...node,payload:itemPayload}:node).concat(additions);
  for(const platform of ['rocket_now','demae_can']) {
   for(const [targetId,externalId]of [[archived,'native-retired'],[promotion,'native-new']])await h.db.query('insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_parent_id) values($1,$2,\'option_group\',$3,$4,\'\')',[h.ids.brand,h.native[platform],targetId,externalId]);
   const before=await h.command(platform),mappings=before.payload.targets.flatMap(node=>node.mappings.map(mapping=>({kind:node.kind,targetId:node.targetId,...mapping}))).concat([{kind:'option_group',targetId:archived,externalId:'native-retired',externalParentId:''},{kind:'option_group',targetId:promotion,externalId:'native-new',externalParentId:''}]);
   const fresh=h.publication.buildUberPublication({...before.payload,platform,nodes,mappings,creationIdentities:[]});
   await h.db.query('update local_bridge_commands set payload=$1 where id=$2',[JSON.stringify({...before.payload,...fresh}),before.id]);
  }
  const result=await h.reconcile();assert.equal(result.queued,2);assert.equal(result.blocked.length,0);
  for(const platform of ['rocket_now','demae_can']) {
   const targets=(await h.command(platform)).payload.targets;
   assert.equal(targets.find(row=>row.sourceKey==='option_group:retired').archived,true);
   assert.equal(targets.find(row=>row.sourceKey==='option_group:retired').targetId,archived);
   assert.equal(targets.some(row=>row.sourceKey==='option:new:b1'),false);
   assert.deepEqual(targets.find(row=>row.sourceKey==='item:a').source.groupIds,['g1','g2','new']);
   assert.equal(targets.find(row=>row.sourceKey==='option_group:new').sortOrder,20);
  }
 }finally {await h.db.close();}
});

for(const change of ['creation rejection','creation parent','migration new id','migration parent'])test(`conflicting ${change} cannot weaken a saved write journal`,async()=>{
 const h=await fixture();try {
  const command=await h.command('rocket_now'),key='option:g1:b1';
  if(change.startsWith('creation')) {
   command.payload.authorityState[key]={status:'creating',externalId:change==='creation parent'?'native-b1':'',externalParentId:change==='creation parent'?'native-g1':''};
   await h.db.query("insert into menu_uber_creation_attempts values($1,'rocket_now',$2,$3,$4,$5,$6)",[h.ids.source,key,change==='creation rejection'?'rejected':'creating',change==='creation parent'?'native-b1':'',change==='creation parent'?'foreign-parent':'',h.ids.rocket]);
  }else {
   const prior={key:'migration',sourceKey:key,targetId:h.ids.o1,phase:'received',fromId:'1',fromParentId:'2',toParentId:'3',newId:'4',marker:'FSoriginal',name:'ねぎ50g',price:70,displayStatus:'NOT_EXPOSE'};
   command.payload.migrationState.migration=prior;
   const current={...prior,...(change==='migration new id'?{newId:'5'}:{toParentId:'6'})};
   await h.db.query("insert into menu_uber_option_migrations values($1,'rocket_now','migration',$2)",[h.ids.source,JSON.stringify(current)]);
  }
  await h.db.query('update local_bridge_commands set payload=$1 where id=$2',[JSON.stringify(command.payload),h.ids.rocket]);
  const result=await h.reconcile({jobId:h.ids.rocket});assert.equal(result.queued,0);assert.equal(result.blocked[0].code,'uber_publication_reconcile_identity_changed');
  assert.deepEqual((await h.command('rocket_now')).payload,command.payload);assert.deepEqual((await h.command('rocket_now')).result,command.result);
 }finally {await h.db.close();}
});

test('a received command keeps its stronger receipt state when the durable store still records creating',async()=>{
 const h=await fixture();try {
  const command=await h.command('rocket_now'),key='option:g1:b1';
  command.payload.authorityState[key]={status:'received',externalId:'native-b1',externalParentId:'native-g1'};
  await h.db.query("insert into menu_uber_creation_attempts values($1,'rocket_now',$2,'creating','native-b1','native-g1',$3)",[h.ids.source,key,h.ids.rocket]);
  await h.db.query('update local_bridge_commands set payload=$1 where id=$2',[JSON.stringify(command.payload),h.ids.rocket]);
  assert.equal((await h.reconcile()).queued,2);assert.deepEqual((await h.command('rocket_now')).payload.authorityState[key],{sourceKey:key,...command.payload.authorityState[key]});
 }finally {await h.db.close();}
});

for(const change of ['revision','auto publish','source enabled','store','config','catalog','source identity','mapping','creation receipt','migration','result','newer command','other active'])test(`preparation CAS rejects ${change} without partial requeue`,async()=>{
 const h=await fixture();try {
  const before=await h.command('rocket_now');h.race(async()=>{
   if(change==='revision')await h.db.query('update menu_uber_sources set revision=39');
   if(change==='auto publish')await h.db.query('update menu_uber_sources set auto_publish=false');
   if(change==='source enabled')await h.db.query('update menu_uber_sources set enabled=false');
   if(change==='store')await h.db.query('update menu_uber_sources set store_id=$1',[randomUUID()]);
   if(change==='config')await h.db.query("update menu_uber_sources set publish_config=jsonb_set(publish_config,'{rocket_now,merchantId}','\"other\"')");
   if(change==='catalog')await h.db.query("update menu_uber_sources set last_catalog=jsonb_set(last_catalog,'{capturedAt}','\"later\"')");
   if(change==='source identity')await h.db.query('update menu_uber_objects set target_id=$1 where kind=\'item\'',[randomUUID()]);
   if(change==='mapping')await h.db.query("update menu_platform_object_mappings set external_id='changed' where target_id=$1 and external_platform_id=$2",[h.ids.item,h.native.rocket_now]);
   if(change==='creation receipt')await h.db.query("insert into menu_uber_creation_attempts values($1,'rocket_now','option:g1:b1','creating','','',$2)",[h.ids.source,h.ids.rocket]);
   if(change==='migration')await h.db.query("insert into menu_uber_option_migrations values($1,'rocket_now','migration','{\"phase\":\"creating\"}')",[h.ids.source]);
   if(change==='result')await h.db.query("update local_bridge_commands set result='{\"lateReceipt\":true}' where id=$1",[h.ids.demae]);
   if(change==='newer command'||change==='other active')await h.db.query('insert into local_bridge_commands(id,store_id,platform,command_type,status,payload) values($1,$2,\'demae_can\',\'publish_menu_changes\',$3,$4)',[randomUUID(),h.ids.store,change==='other active'?'pending':'failed',JSON.stringify(h.payloads.demae_can)]);
  });
  const result=await h.reconcile();assert.equal(result.queued,0);assert.ok(result.blocked.length);
  assert.equal((await h.command('rocket_now')).status,'failed');assert.equal((await h.command('rocket_now')).attempts,before.attempts);
 }finally {await h.db.close();}
});

for(const change of ['pending removals','target id','physical parent','prepared candidate'])test(`unsafe ${change} is blocked, not silently overwritten`,async()=>{
 const h=await fixture();try {
  const before=await h.command('rocket_now'),payload=before.payload;
  if(change==='pending removals')payload.pendingRemovals=[{sourceKey:'item:missing'}];
  if(change==='target id')payload.targets[0].targetId=randomUUID();
  if(change==='physical parent')payload.targets.find(row=>row.kind==='option').mappings[0].externalParentId='foreign-group';
  if(change==='prepared candidate')payload.targets[0].nameAdaptation={name:'wrong',sourceKey:payload.targets[0].sourceKey,targetId:payload.targets[0].targetId,inputName:'other projection',sourceName:payload.targets[0].sourceName};
  await h.db.query('update local_bridge_commands set payload=$1 where id=$2',[JSON.stringify(payload),h.ids.rocket]);
  const result=await h.reconcile({jobId:h.ids.rocket});assert.equal(result.queued,0);assert.ok(result.blocked.length);
  assert.deepEqual((await h.command('rocket_now')).payload,payload);assert.deepEqual((await h.command('rocket_now')).result,before.result);
 }finally {await h.db.close();}
});

test('job retry is exact latest failed/current scope, excludes no unrelated capture and never targets another platform',async()=>{
 const h=await fixture();try {
  assert.equal((await h.reconcile({jobId:h.ids.rocket,captureCommandId:undefined})).queued,0);
  await h.db.query("update local_bridge_commands set status='succeeded' where id=$1",[h.ids.capture]);
  const result=await h.reconcile({jobId:h.ids.rocket,captureCommandId:undefined});assert.equal(result.queued,1);assert.equal(result.jobs[0].platform,'rocket_now');assert.equal((await h.command('demae_can')).status,'failed');
  await h.finish();assert.equal((await h.reconcile({jobId:randomUUID(),captureCommandId:undefined})).queued,0);
 }finally {await h.db.close();}
});
