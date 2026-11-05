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
    create table menu_uber_sources(id uuid,store_id uuid,brand_id uuid,enabled bool,auto_publish bool,publish_config jsonb,revision integer default 52);
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
  await db.query('insert into menu_uber_sources(id,store_id,brand_id,enabled,auto_publish,publish_config) values($1,$2,$3,true,true,$4)',[ids.source,ids.store,ids.brand,JSON.stringify({[platform]:{merchantId}})]);
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
    await db.query(`update local_bridge_commands set ${field}=$1 where id=$2`,[value!==null&&typeof value==='object'?JSON.stringify(value):value,ids[role]]);
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
      ['payload',{...h.inventoryPayload,verifyAvailability:false}],['payload',{...h.inventoryPayload,verifyAvailability:undefined}],
      ['payload',{...h.inventoryPayload,targets:[{...h.inventoryPayload.targets[0],knownExternalIds:['other']}]}],
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


async function recoveryFixture(platform='rocket_now') {
  const h=await fixture(platform),parentTarget=randomUUID(),parentSource=`option_group:${randomUUID()}`;
  const parentId=platform==='rocket_now'?h.proof.externalParentId:'0080';
  const parent={kind:'option_group',targetId:parentTarget,sourceKey:parentSource,archived:false};
  const parentMapping={kind:'option_group',targetId:parentTarget,externalId:parentId,externalParentId:''};
  h.scope.nodes.push(parent);h.scope.mappings.push(parentMapping);
  await h.db.query("insert into menu_uber_objects values($1,$2,'option_group',$3,false)",[h.ids.source,parentSource,parentTarget]);
  await h.db.query("insert into menu_platform_object_mappings values($1,null,'option_group',$2,$3,'')",[h.ids.platform,parentTarget,parentId]);
  const recovery={version:1,mode:'verify_release',failedJobId:randomUUID(),failedJobError:`uber_authority_draft_exposed:${h.proof.sourceKey}`,
    sourceKey:h.proof.sourceKey,externalId:h.proof.externalId,externalParentId:h.proof.externalParentId,
    guard:{revision:52,checkedAt:Date.parse(h.times.auditCreated)-500,expectedAvailable:true,releaseCommandId:h.ids.inventory},
    inventoryTargets:json(h.inventoryPayload.targets)};
  const target={...h.nodes[0],parentId:parentTarget,name:'Exact native choice',price:316,marker:'FS1234567890abcd',mappings:[{...h.mappings[0],created:true}]};
  const repairPayload={authoritativePublication:true,sourceId:h.ids.source,brandId:h.ids.brand,storeId:h.ids.store,platformKey:platform,merchantId:h.scope.merchantId,
    revision:52,newItemsHidden:true,imagePolicy:'read_only',targets:[{...parent,name:'Group',marker:'FS2234567890abcd',mappings:[parentMapping]},target],recovery};
  const inspection={found:true,identityVerified:true,sourceKey:h.proof.sourceKey,targetId:h.proof.targetId,kind:h.proof.kind,
    externalId:h.proof.externalId,externalParentId:h.proof.externalParentId,name:target.name,price:target.price,hidden:false,isAvailable:true,
    nativeStatus:platform==='rocket_now'?'ON_SALE':'AVAILABLE',parentIds:[parentId],parentNames:['Group'],staged:false};
  const repairResult={recoveryVersion:1,sourceId:h.ids.source,brandId:h.ids.brand,storeId:h.ids.store,revision:52,platformKey:platform,merchantId:h.scope.merchantId,
    failedJobId:recovery.failedJobId,mode:'verify_release',sourceKey:h.proof.sourceKey,targetId:h.proof.targetId,kind:h.proof.kind,
    externalId:h.proof.externalId,externalParentId:h.proof.externalParentId,inspection,observations:[inspection],outcome:'verified_release',changed:0,blockers:[],
    inspectedAt:Date.parse(h.times.captured),capturedAt:h.times.captured};
  const oldReset=h.reset;
  h.reset=async()=>{await oldReset();await h.change('audit','command_type','repair_menu_sync');await h.change('audit','payload',repairPayload);await h.change('audit','result',repairResult);};
  await h.reset();
  return {...h,repairPayload,repairResult,parentId,async validate(result=repairResult,payload=repairPayload,patch={}) {
    await h.change('audit','status','processing');await h.change('audit','completed_at',null);
    return h.service.validateMenuRecoveryHoldReleaseAcknowledgement({commandId:h.ids.audit,storeId:h.ids.store,platform,payload,result,...patch});
  }};
}

for(const platform of ['rocket_now','demae_can'])test(`${platform}: persisted exact native recovery read recognizes only the selected explicit release`,async()=>{
  const h=await recoveryFixture(platform);try {
    assert.equal((await h.recognize()).length,1);
    const proof=await h.validate();assert.equal(proof.auditCommandId,h.ids.audit);assert.equal(proof.inventoryCommandId,h.ids.inventory);
    assert.equal(proof.validation,'persisted-native-audit-v1');
    await h.change('audit','status','succeeded');await h.change('audit','completed_at',h.times.auditCompleted);
    assert.equal((await h.recognize()).length,1);
    await h.db.query('update menu_uber_creation_attempts set updated_at=$1',[h.times.auditCreated]);
    assert.equal((await h.recognize()).length,0,'receipt changed since explicit inventory release');
    await assert.rejects(h.validate(),/menu_recovery_hold_release_unverified/);
  }finally {await h.db.close();}
});

test('legacy Rocket intent requires a new exact read-only recovery proof; the historical command remains immutable',async()=>{
  const h=await recoveryFixture();try {
    const legacy={...h.inventoryPayload};delete legacy.verifyAvailability;
    const reset=async()=>{await h.reset();await h.change('inventory','payload',legacy);};
    await reset();const original=json(await h.command(h.ids.inventory));
    assert.equal((await h.recognize()).length,1,'the fresh recovery read supplies verification, not the historical intent');
    const proof=await h.validate();assert.equal(proof.inventoryCommandId,h.ids.inventory);assert.equal(proof.auditCommandId,h.ids.audit);
    assert.deepEqual(json(await h.command(h.ids.inventory)),original);
    await h.change('audit','status','succeeded');await h.change('audit','completed_at',h.times.auditCompleted);
    assert.equal((await h.recognize()).length,1,'the exact evidence remains recognizable after persistence');
    for(const flag of [false,null,'true']) {
      await reset();await h.change('inventory','payload',{...legacy,verifyAvailability:flag});
      assert.equal((await h.recognize()).length,0);await assert.rejects(h.validate(),/menu_recovery_hold_release_unverified/);
    }
    for(const patch of [{changed:1},{outcome:'inspected'},{observations:[]},{inspectedAt:Date.parse(h.times.auditCreated)-1000},
      {inspection:{...h.repairResult.inspection,isAvailable:false}},{inspection:{...h.repairResult.inspection,hidden:true}},
      {inspection:{...h.repairResult.inspection,forceNotExpose:true}},{inspection:{...h.repairResult.inspection,parentIds:['other']}}]) {
      await reset();const result={...h.repairResult,...patch};
      if(patch.inspection)result.observations=[patch.inspection];
      await h.change('audit','result',result);assert.equal((await h.recognize()).length,0,JSON.stringify(patch));
      await assert.rejects(h.validate(result),/menu_recovery_hold_release_unverified/);
    }
    await reset();await h.change('audit','status','pending');assert.equal((await h.recognize()).length,0,'historical intent alone never supplies proof');
    await reset();await h.change('audit','command_type','audit_inventory');assert.equal((await h.recognize()).length,0,'legacy omission cannot use the ordinary audit path');
  }finally {await h.db.close();}
});

test('missing verification flag remains unsupported outside the confirmed legacy Rocket recovery path',async()=>{
  const h=await recoveryFixture('demae_can');try {
    const legacy={...h.inventoryPayload};delete legacy.verifyAvailability;await h.change('inventory','payload',legacy);
    assert.equal((await h.recognize()).length,0);await assert.rejects(h.validate(),/menu_recovery_hold_release_unverified/);
  }finally {await h.db.close();}
});

test('recovery native proof rejects partial, ambiguous, mismatched and stale evidence',async()=>{
  const h=await recoveryFixture();try {
    const row=h.repairResult.inspection;
    const mutations=[{inspection:{...row,found:false}},{inspection:{...row,identityVerified:false}},{inspection:{...row,isAvailable:false}},
      {inspection:{...row,hidden:true}},{inspection:{...row,externalId:'other'}},{inspection:{...row,externalParentId:'other'}},
      {inspection:{...row,sourceKey:'option:other:other'}},{inspection:{...row,targetId:randomUUID()}},{inspection:{...row,parentIds:[]}},
      {inspection:{...row,parentIds:[h.parentId,h.parentId]}},{inspection:{...row,name:'different'}},{inspection:{...row,price:317}},
      {inspection:{...row,nativeStatus:'UNKNOWN'}},{inspection:{...row,forceNotExpose:true}},
      {observations:[]},{observations:[row,row]},{observations:[{...row,name:'other'}]},{changed:1},{blockers:['identity_unverified']},
      {outcome:'inspected'},{mode:'inspect'},{sourceId:randomUUID()},{storeId:randomUUID()},{brandId:randomUUID()},{revision:53},
      {failedJobId:randomUUID()},{platformKey:'demae_can'},{merchantId:'other'},{capturedAt:h.times.auditCreated},
      {inspectedAt:Date.parse(h.times.auditCreated)-1000},{inspectedAt:String(Date.parse(h.times.captured))}];
    for(const patch of mutations) {
      await h.reset();const result={...h.repairResult,...patch};
      if(patch.inspection)result.observations=[patch.inspection];
      await h.change('audit','result',result);assert.equal((await h.recognize()).length,0,JSON.stringify(patch));
      await assert.rejects(h.validate(result),/menu_recovery_hold_release_unverified/,JSON.stringify(patch));
    }
    for(const [role,field,value] of [['inventory','completed_at',h.times.auditCreated],['inventory','created_at',new Date(Date.parse(h.times.identified)-1000).toISOString()],
      ['inventory','status','failed'],['inventory','store_id',randomUUID()],['inventory','platform','demae_can'],
      ['audit','created_at',h.times.created],['audit','completed_at',h.times.auditCreated]]) {
      await h.reset();await h.change(role,field,value);assert.equal((await h.recognize()).length,0,`${role}.${field}`);
    }
    for(const recovery of [{...h.repairPayload.recovery,inventoryTargets:[]},{...h.repairPayload.recovery,inventoryTargets:[...h.repairPayload.recovery.inventoryTargets,...h.repairPayload.recovery.inventoryTargets]},
      {...h.repairPayload.recovery,guard:{...h.repairPayload.recovery.guard,releaseCommandId:randomUUID()}},
      {...h.repairPayload.recovery,guard:{...h.repairPayload.recovery.guard,checkedAt:Date.parse(h.times.captured)-121000}}]) {
      await h.reset();const payload={...h.repairPayload,recovery};await h.change('audit','payload',payload);
      assert.equal((await h.recognize()).length,0);await assert.rejects(h.validate(h.repairResult,payload),/menu_recovery_hold_release_unverified/);
    }
    await h.reset();await assert.rejects(h.validate(h.repairResult,h.repairPayload,{storeId:randomUUID()}),/menu_recovery_hold_release_unverified/);
    await h.reset();await h.db.query('update menu_uber_sources set revision=53');await assert.rejects(h.validate(),/menu_recovery_hold_release_unverified/);
  }finally {await h.db.close();}
});

test('recovery can use one exact subset of a successful whole inventory operation, with no target borrowing',async()=>{
  const h=await recoveryFixture();try {
    const other={...h.inventoryPayload.targets[0],targetId:randomUUID(),label:'Other',knownExternalIds:['sub_checkbox_999_888']};
    const inventoryPayload={...h.inventoryPayload,targets:[h.inventoryPayload.targets[0],other]};
    await h.change('inventory','payload',inventoryPayload);await h.change('inventory','result',{...h.inventoryResult,matchedTargetCount:2});
    assert.equal((await h.recognize()).length,1);assert.ok(await h.validate());
    await h.change('audit','status','succeeded');await h.change('audit','completed_at',h.times.auditCompleted);
    const wrong={...h.repairPayload,recovery:{...h.repairPayload.recovery,inventoryTargets:[other]}};
    await h.change('audit','payload',wrong);assert.equal((await h.recognize()).length,0);await assert.rejects(h.validate(h.repairResult,wrong),/menu_recovery_hold_release_unverified/);
    await h.reset();await h.change('inventory','payload',inventoryPayload);assert.equal((await h.recognize()).length,0,'a partial original whole-operation result is rejected');
  }finally {await h.db.close();}
});

test('recovery mapping/parent ambiguity cannot grant a persisted release',async()=>{
  const h=await recoveryFixture();try {
    const selected=h.repairPayload.targets[1];
    for(const targets of [[...h.repairPayload.targets,selected],
      [h.repairPayload.targets[0],{...selected,mappings:[...selected.mappings,...selected.mappings]}],
      [h.repairPayload.targets[0],{...selected,parentId:randomUUID()}],
      [{...h.repairPayload.targets[0],mappings:[{...h.repairPayload.targets[0].mappings[0],externalId:'999'}]},selected],
      [h.repairPayload.targets[0],{...selected,mappings:[{...selected.mappings[0],created:false}]}]]) {
      await h.reset();const payload={...h.repairPayload,targets};await h.change('audit','payload',payload);
      assert.equal((await h.recognize()).length,0);await assert.rejects(h.validate(h.repairResult,payload),/menu_recovery_hold_release_unverified/);
    }
    await h.reset();const duplicate={...h.mappings[0],targetId:randomUUID()};
    await h.db.query("insert into menu_platform_object_mappings values($1,null,'option',$2,$3,$4)",[h.ids.platform,duplicate.targetId,h.proof.externalId,h.proof.externalParentId]);
    assert.equal((await h.recognize({mappings:[...h.mappings,duplicate]})).length,0);await assert.rejects(h.validate(),/menu_recovery_hold_release_unverified/);
  }finally {await h.db.close();}
});
