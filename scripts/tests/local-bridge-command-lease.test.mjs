// Exercise the actual command route SQL on isolated PostgreSQL. No production
// configuration is loaded; publication persistence and notifications are stubs.
// PGLITE_MODULE may point at a temporary @electric-sql/pglite installation.
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

async function fixture({type='publish_menu_changes',platform='demae_can',createdMinutesAgo=40,
  expired=true,status='processing',attempts=1,authoritative=true,devicePlatform='desktop'}={}) {
  const db=new PGlite();
  await db.exec(`
    create table local_bridge_commands(id uuid primary key,store_id uuid,platform text,command_type text,status text,attempts int,payload jsonb,result jsonb default '{}',last_error text default '',created_at timestamptz default now(),updated_at timestamptz default now(),available_at timestamptz default now(),completed_at timestamptz,claimed_by_device_id uuid,claimed_at timestamptz,claim_expires_at timestamptz);
    create table local_bridge_devices(id uuid primary key,last_seen_at timestamptz,updated_at timestamptz);
    create table menu_change_sync_tasks(command_id uuid,publish_batch_id uuid,status text,phase text,attempts int,error_code text,error_detail text,is_retryable bool,updated_at timestamptz,completed_at timestamptz);
    create table menu_publish_batches(id uuid,store_id uuid,status text,completed_at timestamptz,updated_at timestamptz);
    create table menu_uber_sources(store_id uuid,brand_id uuid,enabled bool,revision int);
  `);
  const ids={command:randomUUID(),store:randomUUID(),device:randomUUID(),otherDevice:randomUUID()};
  const payload={authoritativePublication:authoritative,targets:[],receiptState:{nativeId:'0015'}};
  await db.query(`insert into local_bridge_commands(id,store_id,platform,command_type,status,attempts,payload,result,created_at,claimed_by_device_id,claimed_at,claim_expires_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,now()-$9*interval '1 minute',$10,now()-interval '35 minutes',now()+$11*interval '1 minute')`,
    [ids.command,ids.store,platform,type,status,attempts,JSON.stringify(payload),JSON.stringify({receipt:'native-receipt-kept'}),createdMinutesAgo,ids.device,expired?-5:10]);
  let authenticatedDevice=ids.device,beforeQuery;
  const progressCalls=[],events=[];
  const sql=(parts,...params)=>{
    const text=parts.map((part,index)=>part+(index<params.length?`$${index+1}`:'')).join('');
    return {then(resolve,reject){return (async()=>{
      if(beforeQuery)await beforeQuery(text,params);
      return (await db.query(text,params)).rows;
    })().then(resolve,reject);}};
  };
  // Inventory supersession is independently tested; it is not a lease policy.
  sql.query=async()=>[];
  const noop=async()=>{};
  const mocks={
    'lib/db.ts':{sql},
    'lib/local-bridge-auth.ts':{authorizeLocalBridge:async()=>({authorized:true,deviceId:authenticatedDevice,devicePlatform})},
    'lib/inventory-command-supersession.ts':{reconcileInventoryCommandsSql:'select 1'},
    'lib/inventory-manual-sync.ts':{},'lib/menu-platform-snapshot-merge.ts':{},'lib/uber-menu-source-sync.ts':{},
    'lib/menu-sync-status.ts':{menuSyncIssue:()=>null},
    'lib/menu-name-adaptation.ts':{findRejectedMenuNameTarget:()=>null},
    'lib/order-realtime.ts':{publishPublicMenuUpdatedEvent:noop},
    'lib/competitor-bridge-snapshot.ts':{applyCompetitorBridgeSnapshot:noop},
    'lib/local-bridge-realtime.ts':{publishBridgeCommandUpdated:async(...args)=>events.push(args),publishBridgeInventoryUpdated:noop},
    'lib/uber-menu-publication-store.ts':{recordUberPublicationProgress:async input=>progressCalls.push(input)}
  };
  const path='app/api/local-bridge/uber-eats/commands/route.ts';
  const exports={};
  const source=ts.transpileModule(readFileSync(resolve(root,path),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  runInNewContext(source,{exports,Date,Error,Request,Response,URL,console,process,
    require:name=>{
      if(!name.startsWith('.'))return require(name);
      let dependency=relative(root,resolve(root,dirname(path),name));
      if(!dependency.endsWith('.ts'))dependency+='.ts';
      assert.ok(mocks[dependency],`Unexpected dependency: ${dependency}`);
      return mocks[dependency];
    }});
  const url=`http://isolated.test/api/local-bridge/uber-eats/commands?storeId=${ids.store}`;
  return {db,ids,payload,events,progressCalls,
    command:async()=>(await db.query('select *,extract(epoch from (claim_expires_at-now())) as lease_seconds,extract(epoch from (greatest(created_at,case when payload->>\'authoritativePublication\'=\'true\' then (payload->\'manualRetryHistory\'->-1->>\'at\')::timestamptz else null end)+interval \'2 hours\'-claim_expires_at)) as deadline_slack from local_bridge_commands where id=$1',[ids.command])).rows[0],
    ack:(status='processing',result={progress:{phase:'verifying',completed:8}})=>exports.POST(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId:ids.command,status,result})})),
    get:()=>exports.GET(new Request(url)),
    asOtherDevice(){authenticatedDevice=ids.otherDevice;},
    beforeQuery(hook){beforeQuery=hook;}
  };
}

test('healthy Demae progress renews an expired unchanged claim and GET does not replay it',async()=>{
  const h=await fixture();
  try {
    const before=await h.command();
    assert.ok(Number(before.lease_seconds)<0);
    assert.equal((await h.ack()).status,200);
    const after=await h.command();
    assert.equal(after.status,'processing');assert.equal(after.attempts,1);
    assert.equal(after.claimed_at.toISOString(),before.claimed_at.toISOString());
    assert.equal(after.claimed_by_device_id,before.claimed_by_device_id);
    assert.ok(Number(after.lease_seconds)>1790&&Number(after.lease_seconds)<=1800);
    assert.equal(after.result.receipt,'native-receipt-kept');
    assert.equal(after.result.progress.phase,'verifying');
    assert.deepEqual(after.payload,before.payload);
    assert.equal(h.progressCalls.length,1);
    const response=await h.get();assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.command.id,h.ids.command);assert.equal(body.command.attempts,1);
    assert.equal((await h.command()).claimed_at.toISOString(),before.claimed_at.toISOString());
  } finally {await h.db.close();}
});

test('lease renewal is capped at the absolute two-hour execution deadline',async()=>{
  const h=await fixture({createdMinutesAgo:115});
  try {
    for(let i=0;i<3;i++) {
      assert.equal((await h.ack('processing',{progress:{phase:'verifying',completed:i}})).status,200);
      const row=await h.command();
      assert.ok(Number(row.lease_seconds)>290&&Number(row.lease_seconds)<=300);
      assert.equal(Number(row.deadline_slack),0);
    }
    await h.db.exec("update local_bridge_commands set created_at=now()-interval '121 minutes'");
    const before=await h.command();
    assert.equal((await h.ack()).status,409);
    const after=await h.command();assert.equal(after.claim_expires_at.toISOString(),before.claim_expires_at.toISOString());
    assert.deepEqual(after.result,before.result);assert.equal(h.progressCalls.length,3);
    assert.equal((await h.get()).status,200);
    assert.equal((await h.command()).status,'failed');
    assert.match((await h.command()).last_error,/expired before execution/);
  } finally {await h.db.close();}
});

test('a validated manual retry restarts only the bounded window, not the creation timestamp',async()=>{
  const h=await fixture({createdMinutesAgo:300});
  try {
    await h.db.exec("update local_bridge_commands set payload=payload||jsonb_build_object('manualRetryHistory',jsonb_build_array(jsonb_build_object('at',(now()-interval '115 minutes')::text)))");
    const before=await h.command();
    assert.equal((await h.ack()).status,200);
    const after=await h.command();
    assert.equal(after.created_at.toISOString(),before.created_at.toISOString());
    assert.ok(Number(after.lease_seconds)>290&&Number(after.lease_seconds)<=300);
    assert.equal(Number(after.deadline_slack),0);
    // Non-authoritative input cannot use this field to evade the original cap.
    await h.db.exec("update local_bridge_commands set payload=jsonb_set(payload,'{authoritativePublication}','false')");
    assert.equal((await h.ack()).status,409);
  } finally {await h.db.close();}
});

test('without progress a dead worker expires, is reclaimed, and retains native receipts',async()=>{
  const h=await fixture();
  try {
    const before=await h.command();
    const response=await h.get();assert.equal(response.status,200);
    assert.equal((await response.json()).command.attempts,2);
    const after=await h.command();assert.equal(after.status,'processing');
    assert.equal(after.attempts,2);assert.ok(after.claimed_at>before.claimed_at);
    assert.equal(after.result.receipt,'native-receipt-kept');assert.deepEqual(after.payload,before.payload);
    assert.ok(Number(after.lease_seconds)>1790);
  } finally {await h.db.close();}
});

test('no-heartbeat exhaustion and the absolute timeout remain terminal',async()=>{
  for(const options of [{attempts:3},{createdMinutesAgo:121,attempts:1}]) {
    const h=await fixture(options);
    try {
      const response=await h.get();assert.equal(response.status,200);assert.equal((await response.json()).command,null);
      const before=await h.command();assert.equal(before.status,'failed');
      assert.equal(before.claimed_at,null);assert.equal(before.claim_expires_at,null);
      assert.equal((await h.ack()).status,409);
      assert.deepEqual((await h.command()).result,before.result);
    } finally {await h.db.close();}
  }
});

for(const state of ['pending','succeeded','failed'])test(`${state} cannot be revived by processing ACK`,async()=>{
  const h=await fixture({status:state});
  try {
    const before=await h.command();assert.equal((await h.ack()).status,409);
    const after=await h.command();assert.equal(after.status,state);
    assert.equal(after.claim_expires_at.toISOString(),before.claim_expires_at.toISOString());
    assert.deepEqual(after.result,before.result);assert.equal(h.progressCalls.length,0);
  } finally {await h.db.close();}
});

test('a different authenticated device cannot renew an expired claim',async()=>{
  const h=await fixture();
  try {
    const before=await h.command();h.asOtherDevice();assert.equal((await h.ack()).status,409);
    const after=await h.command();assert.equal(after.claimed_by_device_id,h.ids.device);
    assert.equal(after.claim_expires_at.toISOString(),before.claim_expires_at.toISOString());
  } finally {await h.db.close();}
});

for(const ackStatus of ['processing','succeeded','failed'])test(`${ackStatus} ACK CAS rejects a same-device reclaim after ownership was read`,async()=>{
  const h=await fixture({type:'capture_competitor_menu_snapshot',authoritative:false});
  try {
    let changed=false;
    h.beforeQuery(async text=>{
      if(changed||!/update local_bridge_commands\s+set/.test(text))return;
      changed=true;
      await h.db.exec("update local_bridge_commands set claimed_at=now(),attempts=attempts+1,claim_expires_at=now()+interval '30 minutes',result='{}'");
    });
    assert.equal((await h.ack(ackStatus)).status,409);assert.equal(changed,true);
    const after=await h.command();assert.equal(after.status,'processing');assert.equal(after.attempts,2);
    assert.deepEqual(after.result,{});assert.ok(Number(after.lease_seconds)>1790);assert.equal(h.events.length,0);
  } finally {await h.db.close();}
});

test('claim attempt CAS rejects ABA even if a reclaimed timestamp was accidentally reused',async()=>{
  const h=await fixture();
  try {
    let changed=false;
    h.beforeQuery(async text=>{
      if(changed||!/update local_bridge_commands\s+set/.test(text))return;
      changed=true;await h.db.exec("update local_bridge_commands set attempts=attempts+1,result='{}'");
    });
    assert.equal((await h.ack()).status,409);
    const row=await h.command();assert.equal(row.attempts,2);assert.deepEqual(row.result,{});
    assert.ok(Number(row.lease_seconds)<0);
  } finally {await h.db.close();}
});

for(const options of [
  {type:'set_inventory_availability',platform:'uber_eats',devicePlatform:'desktop',seconds:900},
  {type:'set_inventory_availability',platform:'rocket_now',devicePlatform:'rocket_now',seconds:900},
  {type:'mark_order_ready',platform:'uber_eats',devicePlatform:'uber_eats',seconds:120}
])test(`${options.type}/${options.devicePlatform} preserves its existing lease duration`,async()=>{
  const h=await fixture({...options,authoritative:false});
  try {
    assert.equal((await h.ack()).status,200);
    const row=await h.command();
    assert.ok(Number(row.lease_seconds)>options.seconds-10&&Number(row.lease_seconds)<=options.seconds);
  } finally {await h.db.close();}
});
