// Isolated PostgreSQL + actual ACK route. Never loads production env or invokes
// any merchant/browser API; only persisted command/native-proof recognition.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {dirname,relative,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const root=resolve(dirname(new URL(import.meta.url).pathname),'../..');
const json=value=>JSON.parse(JSON.stringify(value));

async function fixture(platform='rocket_now') {
  const db=new PGlite();
  await db.exec(`
    create table menu_uber_sources(id uuid,store_id uuid,brand_id uuid,enabled bool,auto_publish bool,publish_config jsonb);
    create table menu_uber_objects(source_id uuid,source_key text,kind text,target_id uuid,archived bool);
    create table menu_external_platforms(id uuid,brand_id uuid,store_id uuid,platform_key text);
    create table menu_platform_object_mappings(external_platform_id uuid,store_id uuid,target_type text,target_id uuid,external_id text,external_parent_id text);
    create table menu_uber_creation_attempts(source_id uuid,platform text,source_key text,status text,external_id text,external_parent_id text,updated_at timestamptz);
    create table local_bridge_commands(id uuid primary key,store_id uuid,platform text,command_type text,status text,attempts int default 1,payload jsonb,result jsonb,last_error text default '',
      created_at timestamptz,completed_at timestamptz,updated_at timestamptz default now(),available_at timestamptz default now(),claimed_by_device_id uuid,claimed_at timestamptz,claim_expires_at timestamptz);
    create table local_bridge_devices(id uuid,last_seen_at timestamptz,updated_at timestamptz);
  `);
  const ids={source:randomUUID(),store:randomUUID(),brand:randomUUID(),platform:randomUUID(),inventory:randomUUID(),audit:randomUUID(),device:randomUUID(),otherDevice:randomUUID(),target:randomUUID()};
  const times={identified:new Date(Date.now()-120000).toISOString(),created:new Date(Date.now()-60000).toISOString(),completed:new Date(Date.now()-40000).toISOString(),
    auditCreated:new Date(Date.now()-30000).toISOString(),captured:new Date(Date.now()-20000).toISOString(),auditCompleted:new Date(Date.now()-10000).toISOString()};
  const merchantId=platform==='rocket_now'?'118575':'410649';
  const sourceKey='option:b5187634-964d-459b-9f0d-42fc34d3d041:ccda6a50-8940-4522-a341-b2151a2febda';
  const externalId=platform==='rocket_now'?'sub_checkbox_1669488_7876263':'itemList_41064900000251true';
  const parent=platform==='rocket_now'?'1669488':'stage:0081',physicalId=platform==='rocket_now'?'7876263':'00000251';
  const mappings=[{kind:'option',targetId:ids.target,externalId,externalParentId:parent}];
  const nodes=[{kind:'option',targetId:ids.target,sourceKey,archived:false}];
  const graph=[{kind:'option',targetId:ids.target,sourceKey,mappings}];
  const target={kind:'option',targetId:ids.target,label:'……まぁ、いいか',knownExternalIds:[externalId]};
  const context=platform==='demae_can'?{demaeStaging:[{storeId:ids.store,merchantId,graph}]}:{};
  const inventoryPayload={syncSource:'store',isAvailable:true,verifyAvailability:true,targets:[target],...context};
  const inventoryResult={outcome:'applied',matchedTargetCount:1,missingTargetCount:0,missingTargets:[],...(platform==='rocket_now'?{desiredHidden:false}:{})};
  const auditPayload={sourceId:ids.source,merchantId,creationHoldAuditForCommandId:ids.inventory,targets:[target],...context};
  const basis=platform==='rocket_now'?'external_id':'native_stock';
  const auditResult={capturedAt:times.captured,targetCount:1,items:[{kind:'option',targetId:ids.target,found:true,isAvailable:true,status:'available',externalIds:[externalId],nativeMatchBasis:basis,
    nativeObservations:[{externalId,physicalId,found:true,isAvailable:true,matchBasis:basis}]}]};
  const proof={sourceId:ids.source,storeId:ids.store,platform,merchantId,sourceKey,kind:'option',targetId:ids.target,externalId,externalParentId:parent,
    inventoryCommandId:ids.inventory,auditCommandId:ids.audit,completedAt:times.completed,capturedAt:times.captured,verified:true,isAvailable:true};
  const scope={sourceId:ids.source,storeId:ids.store,platform,merchantId,nodes,mappings,releases:[proof]};
  await db.query('insert into menu_uber_sources values($1,$2,$3,true,true,$4)',[ids.source,ids.store,ids.brand,JSON.stringify({[platform]:{merchantId}})]);
  await db.query('insert into menu_uber_objects values($1,$2,\'option\',$3,false)',[ids.source,sourceKey,ids.target]);
  await db.query('insert into menu_external_platforms values($1,$2,null,$3)',[ids.platform,ids.brand,platform]);
  await db.query('insert into menu_platform_object_mappings values($1,null,\'option\',$2,$3,$4)',[ids.platform,ids.target,externalId,parent]);
  const reset=async()=>{
    await db.query('delete from menu_uber_creation_attempts');
    await db.query('insert into menu_uber_creation_attempts values($1,$2,$3,\'identified\',$4,$5,$6)',[ids.source,platform,sourceKey,externalId,parent,times.identified]);
    await db.query('delete from local_bridge_commands');
    for(const [id,type,payload,result,created,completed] of [[ids.inventory,'set_inventory_availability',inventoryPayload,inventoryResult,times.created,times.completed],[ids.audit,'audit_inventory',auditPayload,auditResult,times.auditCreated,times.auditCompleted]])
      await db.query('insert into local_bridge_commands(id,store_id,platform,command_type,status,payload,result,created_at,completed_at,claimed_by_device_id,claimed_at,claim_expires_at) values($1,$2,$3,$4,\'succeeded\',$5,$6,$7,$8,$9,now(),now()+interval \'30 minutes\')',
        [id,ids.store,platform,type,JSON.stringify(payload),JSON.stringify(result),created,completed,ids.device]);
  };
  await reset();
  let authenticated=true,deviceId=ids.device,desktop=true;
  const sql=(parts,...params)=>({text:parts.map((part,index)=>part+(index<params.length?`$${index+1}`:'')).join(''),params,
    then(resolve,reject){return db.query(this.text,this.params).then(result=>result.rows).then(resolve,reject);}});
  const noops=async()=>{};
  const mocks={'lib/db.ts':{sql},'lib/local-bridge-auth.ts':{authorizeLocalBridge:async()=>({authorized:authenticated,storeId:ids.store,deviceId,devicePlatform:desktop?'desktop':'uber_eats'})},
    'lib/inventory-command-supersession.ts':{},'lib/inventory-manual-sync.ts':{applyUberAvailabilitySync:async()=>{throw Error('must not mutate stock');}},
    'lib/menu-platform-snapshot-merge.ts':{},'lib/uber-menu-source-sync.ts':{},'lib/order-realtime.ts':{publishPublicMenuUpdatedEvent:async()=>{throw Error('dedicated read is not a public menu write');}},
    'lib/competitor-bridge-snapshot.ts':{},'lib/local-bridge-realtime.ts':{publishBridgeCommandUpdated:noops,publishBridgeInventoryUpdated:noops}};
  const cache=new Map();
  function load(path) {
    if(mocks[path])return mocks[path];if(cache.has(path))return cache.get(path);
    const exports={};cache.set(path,exports);
    const source=ts.transpileModule(readFileSync(resolve(root,path),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    runInNewContext(source,{exports,Date,Error,Request,Response,URL,process,console,structuredClone,require:name=>{
      if(!name.startsWith('.'))return require(name);
      let dependency=relative(root,resolve(root,dirname(path),name));if(!/\.(?:ts|mjs)$/.test(dependency))dependency+='.ts';return load(dependency);
    }});return exports;
  }
  const service=load('lib/uber-creation-hold-releases.ts');
  const command=async id=>(await db.query('select * from local_bridge_commands where id=$1',[id])).rows[0];
  const change=async(role,field,value)=>{
    assert.ok(['payload','result','status','platform','command_type','created_at','completed_at','store_id'].includes(field));
    await db.query(`update local_bridge_commands set ${field}=$1 where id=$2`,[typeof value==='object'?JSON.stringify(value):value,ids[role]]);
  };
  return {db,ids,times,scope,proof,mappings,nodes,service,inventoryPayload,inventoryResult,auditPayload,auditResult,reset,command,change,
    recognize:patch=>service.loadVerifiedCreationHoldReleases({...scope,...patch}),
    async ack(result=auditResult) {
      await db.query("update local_bridge_commands set status='processing',completed_at=null where id=$1",[ids.audit]);
      return load('app/api/local-bridge/uber-eats/commands/route.ts').POST(new Request(`http://isolated.test/api/local-bridge/uber-eats/commands?storeId=${ids.store}`,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId:ids.audit,status:'succeeded',result})}));
    },asOtherDevice(){deviceId=ids.otherDevice;},asUnauthenticated(){authenticated=false;},asTablet(){desktop=false;}};
}

for(const platform of ['rocket_now','demae_can'])test(`${platform}: only real explicit restore plus later full native audit releases the exact hold`,async()=>{
  const h=await fixture(platform);try {
    const result=json(await h.recognize());assert.equal(result.length,1);assert.equal(result[0].validation,'persisted-native-audit-v1');
    assert.deepEqual({...result[0],validation:undefined},{...h.proof,validation:undefined});
    assert.equal((await h.command(h.ids.inventory)).status,'succeeded');
    assert.equal((await h.recognize({releases:[{...h.proof,approval:true,verified:false}]})).length,0);
    const wrongBasis=platform==='rocket_now'?'native_stock':'external_id';
    const item=h.auditResult.items[0];
    await h.change('audit','result',{...h.auditResult,items:[{...item,nativeMatchBasis:wrongBasis,nativeObservations:[{...item.nativeObservations[0],matchBasis:wrongBasis}]}]});
    assert.equal((await h.recognize()).length,0,'another platform proof basis cannot release a hold');await h.reset();
    for(const patch of [{externalId:'other'},{externalParentId:'other'},{sourceKey:'option:other:other'},{targetId:randomUUID()},{kind:'item'},{storeId:randomUUID()},{platform:'uber_eats'},{merchantId:'other'},
      {completedAt:new Date(Date.parse(h.times.completed)-1000).toISOString()},{capturedAt:new Date(Date.parse(h.times.captured)-1000).toISOString()},{inventoryCommandId:h.ids.audit},{auditCommandId:randomUUID()}])
      assert.equal((await h.recognize({releases:[{...h.proof,...patch}]})).length,0,JSON.stringify(patch));
    assert.equal((await h.recognize({releases:[h.proof,h.proof]})).length,0);
  }finally {await h.db.close();}
});

test('failed/partial/non-Store/unverified and pre-creation inventory operations do not release',async()=>{
  const h=await fixture();try {
    for(const [field,value] of [['status','failed'],['command_type','audit_inventory'],['payload',{...h.inventoryPayload,isAvailable:false}],['payload',{...h.inventoryPayload,syncSource:'menu'}],
      ['payload',{...h.inventoryPayload,verifyAvailability:false}],['payload',{...h.inventoryPayload,targets:[{...h.inventoryPayload.targets[0],knownExternalIds:['other']}]}],
      ['result',{...h.inventoryResult,missingTargetCount:1}],['result',{...h.inventoryResult,matchedTargetCount:0}],['result',{...h.inventoryResult,desiredHidden:true}],
      ['result',{...h.inventoryResult,outcome:'not_applicable'}],['created_at',new Date(Date.parse(h.times.identified)-1000).toISOString()]]) {
      await h.reset();await h.change('inventory',field,value);assert.equal((await h.recognize()).length,0,field);
    }
    await h.reset();await h.db.query("update menu_uber_creation_attempts set status='creating'");assert.equal((await h.recognize()).length,0);
  }finally {await h.db.close();}
});

test('old, partial, alias, mixed, fictitious native identities and wrong-time audits remain held',async()=>{
  const h=await fixture();try {
    const item=h.auditResult.items[0];
    for(const row of [{...item,nativeObservations:undefined},{...item,nativeMatchBasis:'alias'},{...item,found:false},{...item,isAvailable:false},
      {...item,nativeObservations:[]},{...item,nativeObservations:[{...item.nativeObservations[0],isAvailable:false}]},
      {...item,nativeObservations:[{...item.nativeObservations[0],found:false}]},{...item,nativeObservations:[{...item.nativeObservations[0],matchBasis:'name'}]},
      {...item,nativeObservations:[{...item.nativeObservations[0],physicalId:'other'}]},{...item,nativeObservations:[{...item.nativeObservations[0],externalId:'sub_checkbox_999_7876263'}]},
      {...item,nativeObservations:[...item.nativeObservations,...item.nativeObservations]},{...item,externalIds:['other']}]) {
      await h.reset();await h.change('audit','result',{...h.auditResult,items:[row]});assert.equal((await h.recognize()).length,0,JSON.stringify(row));
    }
    for(const [field,value] of [['status','pending'],['command_type','set_inventory_availability'],['payload',{...h.auditPayload,creationHoldAuditForCommandId:randomUUID()}],
      ['payload',{...h.auditPayload,sourceId:randomUUID()}],['payload',{...h.auditPayload,merchantId:'other'}],['created_at',h.times.created],['completed_at',h.times.auditCreated]]) {
      await h.reset();await h.change('audit',field,value);assert.equal((await h.recognize()).length,0,field);
    }
    await h.reset();const future=new Date(Date.now()+6*60*1000).toISOString();
    await h.change('audit','result',{...h.auditResult,capturedAt:future});await h.change('audit','completed_at',new Date(Date.now()+7*60*1000).toISOString());
    assert.equal((await h.recognize({releases:[{...h.proof,capturedAt:future}]})).length,0);
  }finally {await h.db.close();}
});

test('Demae carrier context stays bound to mapping, not a fabricated actual business parent',async()=>{
  const h=await fixture('demae_can');try {
    const item=h.auditResult.items[0];assert.equal(item.nativeObservations[0].externalParentId,undefined);
    assert.equal((await h.recognize()).length,1);
    for(const role of ['inventory','audit']) {
      await h.reset();const payload=role==='inventory'?h.inventoryPayload:h.auditPayload;
      await h.change(role,'payload',{...payload,demaeStaging:[{...payload.demaeStaging[0],graph:[{...payload.demaeStaging[0].graph[0],mappings:[{...h.mappings[0],externalParentId:'stage:9999'}]}]}]});
      assert.equal((await h.recognize()).length,0);
    }
    await h.reset();await h.change('audit','result',{...h.auditResult,items:[{...item,status:'staged',isAvailable:null,nativeObservations:[]}]});assert.equal((await h.recognize()).length,0);
  }finally {await h.db.close();}
});

for(const platform of ['rocket_now','demae_can'])test(`${platform}: actual ACK accepts only the dedicated proven read, never mutating inventory`,async()=>{
  const h=await fixture(platform);try {
    assert.equal((await h.ack()).status,200);assert.equal((await h.command(h.ids.audit)).status,'succeeded');
    assert.equal((await h.recognize()).length,1);
    assert.equal((await h.command(h.ids.inventory)).status,'succeeded');
    const wrongBasis=platform==='rocket_now'?'native_stock':'external_id';
    for(const result of [{...h.auditResult,capturedAt:h.times.created},{...h.auditResult,items:[{...h.auditResult.items[0],nativeObservations:[]}]},
      {...h.auditResult,items:[{...h.auditResult.items[0],nativeMatchBasis:wrongBasis,nativeObservations:[{...h.auditResult.items[0].nativeObservations[0],matchBasis:wrongBasis}]}]},
      {...h.auditResult,items:[{...h.auditResult.items[0],isAvailable:false}]}]) {
      await h.reset();assert.equal((await h.ack(result)).status,200);assert.notEqual((await h.command(h.ids.audit)).status,'succeeded');
      assert.equal((await h.recognize()).length,0);
    }
    await h.reset();await h.change('inventory','status','pending');await h.ack();assert.notEqual((await h.command(h.ids.audit)).status,'succeeded');
    await h.reset();await h.change('audit','payload',{...h.auditPayload,targets:[{...h.auditPayload.targets[0],targetId:randomUUID()}]});await h.ack();assert.notEqual((await h.command(h.ids.audit)).status,'succeeded');
  }finally {await h.db.close();}
});

test('dedicated audit never bypasses existing authentication, device claim or tablet restriction',async()=>{
  for(const mode of ['unauthenticated','otherDevice','tablet']) {
    const h=await fixture();try {
      if(mode==='unauthenticated')h.asUnauthenticated();if(mode==='otherDevice')h.asOtherDevice();if(mode==='tablet')h.asTablet();
      const response=await h.ack();assert.equal(response.status,mode==='unauthenticated'?401:mode==='otherDevice'?409:200);
      assert.notEqual((await h.command(h.ids.audit)).status,'succeeded');
    }finally {await h.db.close();}
  }
});
