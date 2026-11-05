// Actual recovery service and route SQL on isolated in-memory Postgres.
// Only authentication, native publication continuation, and realtime are stubs.
// No .env, live database, or merchant service is loaded.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {authorityPhysicalId} from '../../desktop-bridge/src/uber-authority-parents.mjs';

const require=createRequire(import.meta.url);
const {PGlite}=await import(process.env.FOUNDR1_PGLITE_MODULE||'@electric-sql/pglite');
const root=new URL('../../',import.meta.url);
function load(path,modules={}) {
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,Date,Error,Request,Response,URL,structuredClone,console,
    require:name=>name.startsWith('node:')?require(name):modules[name.split('/').at(-1).replace(/\.ts$/,'')]??assert.fail(`Unexpected import ${name}`)});
  return exports;
}

async function fixture() {
  const db=new PGlite(),ids=Object.fromEntries(['brand','store','source','job','device','actor','target','platform','mapping'].map(key=>[key,randomUUID()]));
  await db.exec(`
    create table local_bridge_commands(id text primary key,store_id text,platform text,command_type text,status text default 'pending',
      payload jsonb,result jsonb default '{}',last_error text default '',idempotency_key text unique,created_at timestamptz default now(),
      updated_at timestamptz default now(),completed_at timestamptz,claim_expires_at timestamptz,claimed_by_device_id text);
    create table menu_uber_sources(id text primary key,store_id text,brand_id text,revision integer,enabled bool,auto_publish bool,publish_config jsonb,updated_at timestamptz default now());
    create table menu_external_platforms(id text primary key,brand_id text,store_id text,platform_key text,is_active bool);
    create table menu_platform_object_mappings(id text primary key,external_platform_id text,store_id text,target_type text,target_id text,external_id text,external_parent_id text);
    create table menu_uber_creation_attempts(source_id text,platform text,source_key text,status text,external_id text,external_parent_id text,updated_at timestamptz default now()-interval '2 minutes');
    create table menu_platform_availability_settings(store_id text,brand_id text,target_kind text,target_id text,platform text,availability text,updated_at timestamptz default now());
    create table menu_inventory_availability_blocks(store_id text,target_kind text,target_id text);
    create table menu_store_settings(store_id text,menu_catalog_item_id text,is_available bool);
    create table menu_option_store_settings(store_id text,menu_option_id text,is_available bool);
    create table menu_inventory_operation_locks(store_id text primary key,token text,expires_at timestamptz);
    create table local_bridge_devices(id text primary key,store_id text,platform text,is_enabled bool,last_seen_at timestamptz,health_status jsonb);
    create function lock_menu_uber_revision(source text,revision integer) returns integer as $$
      select 1/count(*)::integer from menu_uber_sources s where s.id=source and s.revision=revision
    $$ language sql;
  `);
  const target={sourceKey:'item:uber-soup',kind:'item',targetId:ids.target,name:'麻辣湯',price:980,mappings:[{externalId:'17',externalParentId:'',created:true}]};
  const payload={authoritativePublication:true,sourceId:ids.source,storeId:ids.store,brandId:ids.brand,platformKey:'rocket_now',merchantId:'12',revision:5,targets:[target],pendingRemovals:[]};
  await db.query('insert into menu_uber_sources(id,store_id,brand_id,revision,enabled,auto_publish,publish_config) values($1,$2,$3,5,true,true,$4)',[ids.source,ids.store,ids.brand,JSON.stringify({rocket_now:{merchantId:'12'}})]);
  await db.query('insert into local_bridge_commands(id,store_id,platform,command_type,status,payload,last_error,created_at) values($1,$2,\'rocket_now\',\'publish_menu_changes\',\'failed\',$3,$4,now()-interval \'10 minutes\')',[ids.job,ids.store,JSON.stringify(payload),'uber_authority_draft_exposed:item:uber-soup']);
  await db.query('insert into menu_external_platforms values($1,$2,null,\'rocket_now\',true)',[ids.platform,ids.brand]);
  await db.query('insert into menu_platform_object_mappings values($1,$2,null,\'item\',$3,\'17\',\'\')',[ids.mapping,ids.platform,ids.target]);
  await db.query('insert into menu_uber_creation_attempts(source_id,platform,source_key,status,external_id,external_parent_id) values($1,\'rocket_now\',\'item:uber-soup\',\'identified\',\'17\',\'\')',[ids.source]);
  await db.query('insert into menu_platform_availability_settings(store_id,brand_id,target_kind,target_id,platform,availability) values($1,$2,\'item\',$3,\'rocket_now\',\'unavailable\')',[ids.store,ids.brand,ids.target]);
  await db.query('insert into local_bridge_devices values($1,$2,\'desktop\',true,now(),\'{"menuSyncRecoveryVersion":1}\')',[ids.device,ids.store]);
  const sql=(parts,...params)=>{
    const text=parts.map((part,index)=>part+(index<params.length?`$${index+1}`:'')).join('');
    return {text,params,then(resolve,reject){return db.query(text,params).then(value=>value.rows).then(resolve,reject);}};
  };
  sql.transaction=ops=>db.transaction(async transaction=>{
    const results=[];for(const op of ops)results.push((await transaction.query(op.text,op.params)).rows);return results;
  });
  const events=[],continuations=[];let blockedContinuation='';
  const domain=load('lib/menu-sync-recovery.ts');
  const lock=load('lib/inventory-operation-lock.ts',{db:{sql}});
  const service=load('lib/menu-sync-recovery-store.ts',{
    db:{sql},'inventory-operation-lock':lock,'menu-sync-recovery':domain,
    'local-bridge-realtime':{publishBridgeCommandAvailable:async storeId=>events.push(storeId)},
    'uber-authority-parents.mjs':{authorityPhysicalId},
    'uber-menu-publication-reconcile':{reconcileUberPublications:async input=>{
      if(blockedContinuation==='throw')throw new Error('fixture continuation service unavailable');
      continuations.push(input);return blockedContinuation?{queued:0,blocked:[{code:blockedContinuation}],jobs:[]}:{queued:1,blocked:[],jobs:[{id:ids.job,platform:'rocket_now'}]};
    }}
  });
  let authenticated=true;
  const route=load('app/api/menus/recovery/route.ts',{'api-auth':{requireMasterOsSession:async()=>authenticated?{id:ids.actor,role:'owner'}:null},'menu-sync-recovery-store':service});
  const url=`http://isolated.test/api/menus/recovery?brandId=${ids.brand}&jobId=${ids.job}`;
  const request=(body,headers={origin:'http://isolated.test'})=>new Request(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({brandId:ids.brand,jobId:ids.job,...body})});
  const commands=async()=>(await db.query("select *,created_at::text as \"createdAt\" from local_bridge_commands where command_type in ('inspect_menu_sync','repair_menu_sync') order by created_at desc,id desc")).rows;
  const start=async action=>service.startMenuRecovery({brandId:ids.brand,jobId:ids.job,actorId:ids.actor,...action});
  const claim=async command=>{await db.query("update local_bridge_commands set status='processing',claimed_by_device_id=$2,claim_expires_at=now()+interval '5 minutes' where id=$1",[command.id,ids.device]);return command;};
  const result=(command,extra={})=>({recoveryVersion:1,mode:command.payload.recovery.mode,failedJobId:ids.job,sourceId:ids.source,storeId:ids.store,brandId:ids.brand,
    platformKey:'rocket_now',merchantId:'12',revision:5,sourceKey:target.sourceKey,targetId:ids.target,kind:'item',externalId:'17',externalParentId:'',
    inspectedAt:Date.now(),outcome:'inspected',changed:0,blockers:[],canRestoreHidden:true,
    inspection:{found:true,identityVerified:true,name:target.name,price:980,hidden:false,isAvailable:true},...extra});
  const ack=(command,data,status='succeeded')=>service.acknowledgeMenuRecovery({commandId:command.id,storeId:ids.store,deviceId:ids.device,status,result:data,error:''});
  const inspect=async()=>{await start({action:'inspect'});const command=await claim((await commands())[0]);await ack(command,result(command));return service.menuRecoveryView(ids.brand,ids.job);};
  const inventory=async({status='pending',isAvailable=true}={})=>{
    const id=randomUUID();await db.query("insert into local_bridge_commands(id,store_id,platform,command_type,status,payload) values($1,$2,'rocket_now','set_inventory_availability',$3,$4)",
      [id,ids.store,status,JSON.stringify({syncSource:'store',isAvailable,targets:[{kind:'item',targetId:ids.target,knownExternalIds:['17']} ]})]);return id;
  };
  return {db,ids,service,lock,route,url,request,commands,start,claim,result,ack,inspect,inventory,events,continuations,asUnauthorized(){authenticated=false;},blockContinuation(code){blockedContinuation=code;}};
}

test('actual route: inspect queues read-only command, ACK yields exact plan, explicit repair ACK queues continuation',async()=>{
  const h=await fixture();try {
    const initial=await h.route.GET(new Request(h.url));assert.equal(initial.status,200);assert.equal((await initial.json()).status,'idle');
    const response=await h.route.POST(h.request({action:'inspect'}));assert.equal(response.status,200);assert.equal((await response.json()).status,'checking');
    let commands=await h.commands();assert.equal(commands.length,1);assert.equal(commands[0].command_type,'inspect_menu_sync');
    assert.equal((await h.db.query('select availability from menu_platform_availability_settings')).rows[0].availability,'unavailable');
    const inspection=await h.claim(commands[0]);await h.ack(inspection,h.result(inspection));
    const ready=await h.service.menuRecoveryView(h.ids.brand,h.ids.job);assert.equal(ready.status,'ready');assert.equal(ready.plan.mode,'restore_hidden');assert.equal(ready.target.name,'麻辣湯');
    const repair=await h.route.POST(h.request({action:ready.plan.mode,inspectionId:ready.inspection.id,token:ready.plan.token}));assert.equal(repair.status,200);assert.equal((await repair.json()).status,'repairing');
    commands=await h.commands();assert.equal(commands.length,2);assert.equal(commands[0].command_type,'repair_menu_sync');
    const command=await h.claim(commands[0]);await h.ack(command,h.result(command,{outcome:'restored_hidden',changed:1,inspection:{found:true,identityVerified:true,name:'麻辣湯',price:980,hidden:true,isAvailable:false}}));
    const done=await h.service.menuRecoveryView(h.ids.brand,h.ids.job);assert.equal(done.status,'verified');assert.equal(done.continuation.id,h.ids.job);assert.equal(h.continuations.length,1);
    assert.equal((await h.db.query('select status from local_bridge_commands where id=$1',[h.ids.job])).rows[0].status,'failed');
    assert.equal((await h.db.query('select count(*)::int as count from local_bridge_commands where command_type=\'set_inventory_availability\'')).rows[0].count,0);
  }finally{await h.db.close();}
});

test('actual route rejects unauthorized, cross-origin, malformed input and never queues an operation',async()=>{
  const h=await fixture();try {
    assert.equal((await h.route.POST(h.request({action:'inspect'},{origin:'https://foreign.test'}))).status,403);
    assert.equal((await h.route.POST(h.request({action:'inspect'},{origin:'http://isolated.test','sec-fetch-site':'cross-site'}))).status,403);
    assert.equal((await h.route.POST(h.request({action:'unknown'}))).status,400);
    assert.equal((await h.route.GET(new Request(h.url.replace(h.ids.brand,'invalid')))).status,400);
    h.asUnauthorized();assert.equal((await h.route.GET(new Request(h.url))).status,403);assert.equal((await h.route.POST(h.request({action:'inspect'}))).status,403);
    assert.equal((await h.commands()).length,0);
  }finally{await h.db.close();}
});

test('stale token, inspection ID, newer inventory intent and changed mapping cannot authorize repair',async()=>{
  const h=await fixture();try {
    const ready=await h.inspect();
    for(const patch of [{token:'stale'},{inspectionId:randomUUID()}]) {
      const response=await h.route.POST(h.request({action:'restore_hidden',inspectionId:ready.inspection.id,token:ready.plan.token,...patch}));assert.equal(response.status,409);
    }
    const inventory=await h.inventory();
    assert.equal((await h.route.POST(h.request({action:'restore_hidden',inspectionId:ready.inspection.id,token:ready.plan.token}))).status,409);
    await h.db.query('delete from local_bridge_commands where id=$1',[inventory]);
    await h.db.query("update menu_platform_object_mappings set external_id='18' where id=$1",[h.ids.mapping]);
    assert.equal((await h.service.menuRecoveryView(h.ids.brand,h.ids.job)).code,'mapping_changed');
    assert.equal((await h.route.POST(h.request({action:'restore_hidden',inspectionId:ready.inspection.id,token:ready.plan.token}))).status,409);
    assert.equal((await h.commands()).length,1);
  }finally{await h.db.close();}
});

test('source revision changes and ambiguous physical ownership block inspection',async()=>{
  const h=await fixture();try {
    await h.db.exec('update menu_uber_sources set revision=6');assert.equal((await h.service.menuRecoveryView(h.ids.brand,h.ids.job)).code,'source_changed');
    await assert.rejects(h.start({action:'inspect'}),/source_changed/);
    await h.db.exec('update menu_uber_sources set revision=5');
    await h.db.query("insert into menu_platform_object_mappings values($1,$2,null,'item',$3,'17','')",[randomUUID(),h.ids.platform,randomUUID()]);
    assert.equal((await h.service.menuRecoveryView(h.ids.brand,h.ids.job)).code,'mapping_changed');await assert.rejects(h.start({action:'inspect'}),/mapping_changed/);
    assert.equal((await h.commands()).length,0);
  }finally{await h.db.close();}
});

test('changed configured native menu scope is rejected even when source revision is unchanged',async()=>{
  const h=await fixture();try {
    await h.db.exec("update menu_uber_sources set publish_config=jsonb_set(publish_config,'{rocket_now,draftPatternCode}','\"changed-native-scope\"')");
    assert.equal((await h.service.menuRecoveryView(h.ids.brand,h.ids.job)).code,'source_changed');
    await assert.rejects(h.start({action:'inspect'}),/source_changed/);assert.equal((await h.commands()).length,0);
  }finally{await h.db.close();}
});

test('unknown/failed command state stays non-successful and does not queue publication',async()=>{
  const h=await fixture();try {
    await h.start({action:'inspect'});let command=(await h.commands())[0];
    await h.db.query("update local_bridge_commands set created_at=now()-interval '6 minutes' where id=$1",[command.id]);
    assert.equal((await h.service.menuRecoveryView(h.ids.brand,h.ids.job)).status,'unknown');
    await h.db.query("update local_bridge_commands set status='failed',last_error='menu_sync_recovery_result_unknown' where id=$1",[command.id]);
    const failed=await h.service.menuRecoveryView(h.ids.brand,h.ids.job);assert.equal(failed.status,'unknown');assert.equal(failed.code,'result_unknown');assert.equal(h.continuations.length,0);
  }finally{await h.db.close();}
});

test('duplicate inspection request reuses active command; wrong device and expired claim cannot ACK',async()=>{
  const h=await fixture();try {
    await h.start({action:'inspect'});await h.start({action:'inspect'});assert.equal((await h.commands()).length,1);
    const command=await h.claim((await h.commands())[0]);
    await assert.rejects(h.service.acknowledgeMenuRecovery({commandId:command.id,storeId:h.ids.store,deviceId:randomUUID(),status:'succeeded',result:h.result(command),error:''}),/state_changed|device_selection_required/);
    await h.db.query("update local_bridge_commands set claim_expires_at=now()-interval '1 second' where id=$1",[command.id]);
    await assert.rejects(h.ack(command,h.result(command)),/state_changed/);assert.equal(h.continuations.length,0);
  }finally{await h.db.close();}
});

test('inspection stores blocked native diagnostics but refuses mode-contradicting mutation proof',async()=>{
  const h=await fixture();try {
    await h.start({action:'inspect'});const command=await h.claim((await h.commands())[0]);
    await assert.rejects(h.ack(command,h.result(command,{inspectedAt:Date.now()-30000})),/inspection_expired/);
    await assert.rejects(h.ack(command,h.result(command,{outcome:'restored_hidden',changed:1})),/native_identity_unverified|recovery_blocked/);
    await h.ack(command,h.result(command,{outcome:'blocked',blockers:['native_identity_unverified'],inspection:{found:true,identityVerified:false,name:'別の商品',price:980,hidden:false,isAvailable:true}}));
    const view=await h.service.menuRecoveryView(h.ids.brand,h.ids.job);assert.equal(view.status,'blocked');assert.equal(view.code,'native_identity_unverified');assert.equal(view.plan,undefined);assert.equal(view.inspection.native.name,'別の商品');
    assert.equal((await h.commands())[0].status,'succeeded');assert.equal(h.continuations.length,0);
  }finally{await h.db.close();}
});

test('queued repair refuses newly arrived inventory intent at execution and ACK guard',async()=>{
  const h=await fixture();try {
    const ready=await h.inspect();await h.start({action:'restore_hidden',inspectionId:ready.inspection.id,token:ready.plan.token});
    const repair=await h.claim((await h.commands())[0]);await h.inventory();
    await assert.rejects(h.service.guardMenuRecoveryCommand({commandId:repair.id,storeId:h.ids.store,deviceId:h.ids.device},true),/state_changed|inventory_pending/);
    await assert.rejects(h.ack(repair,h.result(repair,{outcome:'restored_hidden',changed:1,inspection:{found:true,identityVerified:true,name:'麻辣湯',price:980,hidden:true,isAvailable:false}})),/state_changed|inventory_pending/);
    assert.equal((await h.commands())[0].status,'processing');assert.equal(h.continuations.length,0);
  }finally{await h.db.close();}
});

test('failed ACK can record unknown result after scope changes, but processing ACK cannot complete recovery',async()=>{
  const h=await fixture();try {
    await h.start({action:'inspect'});const command=await h.claim((await h.commands())[0]);
    await assert.rejects(h.ack(command,h.result(command),'processing'),/state_changed/);
    await h.db.exec('update menu_uber_sources set revision=6');
    await h.service.acknowledgeMenuRecovery({commandId:command.id,storeId:h.ids.store,deviceId:h.ids.device,status:'failed',result:{},error:'menu_sync_recovery_result_unknown'});
    const view=await h.service.menuRecoveryView(h.ids.brand,h.ids.job);assert.equal(view.status,'unknown');assert.equal(view.code,'result_unknown');assert.equal(h.continuations.length,0);
  }finally{await h.db.close();}
});

test('offline, outdated and ambiguous Bridge device states do not queue recovery',async()=>{
  const h=await fixture();try {
    await h.db.exec("update local_bridge_devices set last_seen_at=now()-interval '3 minutes'");await assert.rejects(h.start({action:'inspect'}),/bridge_offline/);
    await h.db.exec("update local_bridge_devices set last_seen_at=now(),health_status='{}'");await assert.rejects(h.start({action:'inspect'}),/bridge_update_required/);
    await h.db.exec("update local_bridge_devices set health_status='{\"menuSyncRecoveryVersion\":1}'");
    await h.db.query("insert into local_bridge_devices values($1,$2,'desktop',true,now(),'{\"menuSyncRecoveryVersion\":1}')",[randomUUID(),h.ids.store]);
    await assert.rejects(h.start({action:'inspect'}),/device_selection_required/);assert.equal((await h.commands()).length,0);
  }finally{await h.db.close();}
});

test('already hidden target uses read-only retry and cannot ACK a hidden-state mutation',async()=>{
  const h=await fixture();try {
    await h.start({action:'inspect'});const inspection=await h.claim((await h.commands())[0]);
    const hidden={found:true,identityVerified:true,name:'麻辣湯',price:980,hidden:true,isAvailable:false};
    await h.ack(inspection,h.result(inspection,{inspection:hidden}));
    const ready=await h.service.menuRecoveryView(h.ids.brand,h.ids.job);assert.equal(ready.plan.mode,'retry');
    await h.start({action:'retry',inspectionId:ready.inspection.id,token:ready.plan.token});const retry=await h.claim((await h.commands())[0]);
    assert.equal(retry.payload.recovery.mode,'inspect');assert.equal(retry.command_type,'repair_menu_sync');
    await assert.rejects(h.ack(retry,h.result(retry,{outcome:'restored_hidden',changed:1,inspection:hidden})),/recovery_blocked/);
    await h.ack(retry,h.result(retry,{inspection:hidden}));assert.equal(h.continuations.length,1);
  }finally{await h.db.close();}
});

test('release plan requires a fully verified later Store availability operation for this exact mapping',async()=>{
  const h=await fixture();try {
    await h.db.exec("update menu_platform_availability_settings set availability='available'");
    const inventory=await h.inventory({status:'succeeded'});
    const targets=[{kind:'item',targetId:h.ids.target,knownExternalIds:['17']}];
    const inventoryPayload={syncSource:'store',isAvailable:true,verifyAvailability:true,targets};
    const inventoryResult={outcome:'applied',missingTargetCount:0,matchedTargetCount:1,missingTargets:[],desiredHidden:false};
    await h.db.query('update local_bridge_commands set payload=$2,result=$3,completed_at=now() where id=$1',[inventory,JSON.stringify(inventoryPayload),JSON.stringify(inventoryResult)]);
    let ready=await h.inspect();assert.equal(ready.plan.mode,'verify_release');assert.equal(ready.inspection.latestOperation.status,'succeeded');
    await h.db.query('update local_bridge_commands set result=$2 where id=$1',[inventory,JSON.stringify({...inventoryResult,missingTargetCount:1})]);
    ready=await h.inspect();assert.equal(ready.status,'blocked');assert.equal(ready.code,'hold_conflict');assert.equal(ready.plan,undefined);
    await h.db.query('update local_bridge_commands set payload=$2,result=$3 where id=$1',[inventory,JSON.stringify({...inventoryPayload,targets:[{...targets[0],knownExternalIds:['18']}]}),JSON.stringify(inventoryResult)]);
    ready=await h.inspect();assert.equal(ready.status,'blocked');assert.equal(ready.plan,undefined);assert.equal(h.continuations.length,0);
  }finally{await h.db.close();}
});

test('legacy Rocket Store intent with no hold offers a new read-only release check and preserves the old command',async()=>{
  const h=await fixture();try {
    await h.db.exec('delete from menu_platform_availability_settings');
    await h.db.query('insert into menu_store_settings values($1,$2,true)',[h.ids.store,h.ids.target]);
    const inventory=await h.inventory({status:'succeeded'});
    const result={outcome:'applied',missingTargetCount:0,matchedTargetCount:1,missingTargets:[],desiredHidden:false};
    await h.db.query('update local_bridge_commands set result=$2,completed_at=now() where id=$1',[inventory,JSON.stringify(result)]);
    const original=(await h.db.query('select * from local_bridge_commands where id=$1',[inventory])).rows[0];
    const ready=await h.inspect();
    assert.equal(ready.status,'ready');assert.equal(ready.plan.mode,'verify_release');assert.equal(ready.inspection.hold,null);
    await h.start({action:'verify_release',inspectionId:ready.inspection.id,token:ready.plan.token});
    const repair=await h.claim((await h.commands())[0]);
    assert.equal(repair.command_type,'repair_menu_sync');assert.equal(repair.payload.recovery.mode,'verify_release');
    assert.equal(repair.payload.recovery.guard.releaseCommandId,inventory);
    assert.deepEqual(repair.payload.recovery.inventoryTargets,original.payload.targets);
    assert.deepEqual((await h.db.query('select * from local_bridge_commands where id=$1',[inventory])).rows[0],original);
    await assert.rejects(h.ack(repair,h.result(repair,{outcome:'verified_release',changed:1})),/recovery_blocked/);
    // A newer shortage invalidates even a previously accepted preview and
    // prevents both execution and ACK, without rewriting the prior intent.
    await h.inventory({status:'succeeded',isAvailable:false});
    await assert.rejects(h.service.guardMenuRecoveryCommand({commandId:repair.id,storeId:h.ids.store,deviceId:h.ids.device}),/state_changed/);
    await assert.rejects(h.ack(repair,h.result(repair,{outcome:'verified_release',changed:0})),/state_changed/);
    assert.equal(h.continuations.length,0);
  }finally{await h.db.close();}
});

test('legacy release preview keeps explicit opt-out, partial result and OS stock protections',async()=>{
  const h=await fixture();try {
    await h.db.exec('delete from menu_platform_availability_settings');
    const inventory=await h.inventory({status:'succeeded'});
    const command=(await h.db.query('select payload from local_bridge_commands where id=$1',[inventory])).rows[0];
    const result={outcome:'applied',missingTargetCount:0,matchedTargetCount:1,missingTargets:[],desiredHidden:false};
    const reset=async()=>{
      await h.db.exec('delete from menu_inventory_availability_blocks;delete from menu_store_settings');
      await h.db.query('update local_bridge_commands set payload=$2,result=$3,completed_at=now() where id=$1',[inventory,JSON.stringify(command.payload),JSON.stringify(result)]);
    };
    for(const flag of [false,null,'true']) {
      await reset();await h.db.query('update local_bridge_commands set payload=$2 where id=$1',[inventory,JSON.stringify({...command.payload,verifyAvailability:flag})]);
      const view=await h.inspect();assert.equal(view.status,'blocked');assert.equal(view.plan,undefined);
    }
    for(const patch of [{missingTargetCount:1},{matchedTargetCount:0},{missingTargets:['exact target']},{desiredHidden:true},{outcome:'not_applicable'}]) {
      await reset();await h.db.query('update local_bridge_commands set result=$2 where id=$1',[inventory,JSON.stringify({...result,...patch})]);
      assert.equal((await h.inspect()).plan,undefined,JSON.stringify(patch));
    }
    await reset();await h.db.query("insert into menu_inventory_availability_blocks values($1,'item',$2)",[h.ids.store,h.ids.target]);
    assert.equal((await h.inspect()).plan,undefined);
    await reset();await h.db.query('insert into menu_store_settings values($1,$2,false)',[h.ids.store,h.ids.target]);
    assert.equal((await h.inspect()).plan,undefined);
    await reset();await h.db.query("update local_bridge_commands set created_at=now()-interval '3 minutes' where id=$1",[inventory]);
    assert.equal((await h.inspect()).plan,undefined,'an intent before creation identification is insufficient');
    assert.equal(h.continuations.length,0);
  }finally{await h.db.close();}
});

for(const [reconcileCode,expectedCode] of [['uber_publication_reconcile_active','uber_publication_reconcile_active'],['throw','continuation_unavailable']])test(`verified native repair exposes ${expectedCode} separately and can be inspected again`,async()=>{
  const h=await fixture();try {
    const ready=await h.inspect();await h.start({action:'restore_hidden',inspectionId:ready.inspection.id,token:ready.plan.token});
    const repair=await h.claim((await h.commands())[0]);h.blockContinuation(reconcileCode);
    await h.ack(repair,h.result(repair,{outcome:'restored_hidden',changed:1,inspection:{found:true,identityVerified:true,name:'麻辣湯',price:980,hidden:true,isAvailable:false}}));
    const response=await h.route.GET(new Request(h.url));assert.equal(response.status,200);const view=await response.json();
    assert.equal(view.status,'blocked');assert.equal(view.code,'continuation_blocked');assert.equal(view.continuation.status,'blocked');assert.equal(view.continuation.code,expectedCode);
    assert.equal(view.inspection.native.hidden,true);assert.equal(view.plan,undefined);
    assert.equal((await h.commands())[0].status,'succeeded');assert.equal((await h.db.query('select status from local_bridge_commands where id=$1',[h.ids.job])).rows[0].status,'failed');
    await h.start({action:'inspect'});assert.equal((await h.commands()).length,3);
  }finally{await h.db.close();}
});

test('actual Store mutation guard blocks only the active same-store repair window',async()=>{
  const h=await fixture();try {
    const id=randomUUID();await h.db.query("insert into local_bridge_commands(id,store_id,platform,command_type,status,payload) values($1,$2,'rocket_now','repair_menu_sync','pending','{}')",[id,h.ids.store]);
    await assert.rejects(h.lock.assertNoWholeStoreSync(h.ids.store),/メニューの修復・確認中/);
    await h.db.query("update local_bridge_commands set status='processing',claim_expires_at=now()+interval '1 minute' where id=$1",[id]);
    await assert.rejects(h.lock.assertNoWholeStoreSync(h.ids.store),/メニューの修復・確認中/);
    for(const status of ['succeeded','failed']) {
      await h.db.query('update local_bridge_commands set status=$2 where id=$1',[id,status]);await h.lock.assertNoWholeStoreSync(h.ids.store);
    }
  }finally{await h.db.close();}
});

test('actual Store mutation guard allows read-only inspection and expired recovery windows',async()=>{
  const h=await fixture();try {
    const id=randomUUID();await h.db.query("insert into local_bridge_commands(id,store_id,platform,command_type,status,payload) values($1,$2,'rocket_now','inspect_menu_sync','pending','{}')",[id,h.ids.store]);
    await h.lock.assertNoWholeStoreSync(h.ids.store);
    await h.db.query("update local_bridge_commands set status='processing',claim_expires_at=now()+interval '1 minute' where id=$1",[id]);await h.lock.assertNoWholeStoreSync(h.ids.store);
    await h.db.query("update local_bridge_commands set command_type='repair_menu_sync',status='pending',created_at=now()-interval '6 minutes' where id=$1",[id]);await h.lock.assertNoWholeStoreSync(h.ids.store);
    await h.db.query("update local_bridge_commands set status='processing',claim_expires_at=now()-interval '1 second' where id=$1",[id]);await h.lock.assertNoWholeStoreSync(h.ids.store);
    await h.db.query('update local_bridge_commands set claim_expires_at=null where id=$1',[id]);await h.lock.assertNoWholeStoreSync(h.ids.store);
  }finally{await h.db.close();}
});

test('actual Store mutation guard excludes another store repair while retaining whole-store protection',async()=>{
  const h=await fixture();try {
    const id=randomUUID(),otherStore=randomUUID();
    await h.db.query("insert into local_bridge_commands(id,store_id,platform,command_type,status,payload) values($1,$2,'rocket_now','repair_menu_sync','pending','{}')",[id,otherStore]);
    await h.lock.assertNoWholeStoreSync(h.ids.store);await assert.rejects(h.lock.assertNoWholeStoreSync(otherStore),/メニューの修復・確認中/);
    await h.db.query("update local_bridge_commands set status='processing',claim_expires_at=now()+interval '1 minute' where id=$1",[id]);await h.lock.assertNoWholeStoreSync(h.ids.store);
    await h.db.query("insert into local_bridge_commands(id,store_id,platform,command_type,status,payload) values($1,$2,'rocket_now','publish_menu_changes','pending','{\"availabilityAuthority\":\"uber_eats\"}')",[randomUUID(),h.ids.store]);
    await assert.rejects(h.lock.assertNoWholeStoreSync(h.ids.store),/Uber 基準の全店同期中/);
  }finally{await h.db.close();}
});
