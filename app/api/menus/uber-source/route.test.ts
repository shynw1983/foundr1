import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {menuSyncIssue,menuSyncIssueContext,nextMenuCheck} from '../../../../lib/menu-sync-status.ts';

// Execute the real handlers with isolated dependency boundaries. No Next
// session, database connection, Bridge command or AI provider is contacted.
const source=await readFile(new URL('./route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const currentSource={id:'source-id',store_id:'store-id',revision:38};
class AdaptationConflict extends Error {}
type Query={text:string;values:unknown[]};
type Options={
  authorized?:boolean;
  sources?:Record<string,unknown>[];
  failures?:Record<string,unknown>[];
  adapt?:(input:Record<string,unknown>)=>Promise<unknown>;
  reconcile?:(input:Record<string,unknown>)=>Promise<unknown>;
  publish?:()=>Promise<void>;
  readQuery?:(text:string,values:unknown[])=>Promise<Record<string,unknown>[]>;
};

function handlers(options:Options={}) {
  const queries:Query[]=[],adaptations:Record<string,unknown>[]=[],reconciliations:Record<string,unknown>[]=[],signals:string[]=[];
  const sql=async(strings:TemplateStringsArray,...values:unknown[])=>{
    const text=strings.map((part,index)=>part+(index<values.length?`$${index+1}`:'')).join('').replace(/\s+/g,' ').trim();
    queries.push({text,values});
    assert.doesNotMatch(text,/^(?:update|insert|delete)/i,'route must delegate mutations to the safe shared services');
    if(options.readQuery)return options.readQuery(text,values);
    if(text.startsWith('select id::text,store_id::text,revision from menu_uber_sources'))return options.sources??[currentSource];
    if(text.startsWith('select c.platform,c.last_error'))return options.failures??[];
    throw new Error(`Unexpected test query: ${text}`);
  };
  const dependencies:Record<string,unknown>={
    '../../../../lib/api-auth':{requireMasterOsSession:async()=>options.authorized===false?null:{role:'owner'}},
    '../../../../lib/db':{sql},
    '../../../../lib/uber-menu-source-sync':{scheduleUberSourceScans:async(storeId:string)=>{signals.push(`scan:${storeId}`);return {queued:1};}},
    '../../../../lib/menu-sync-status':{menuSyncIssue,menuSyncIssueContext,nextMenuCheck},
    '../../../../lib/uber-menu-publication-reconcile':{reconcileUberPublications:async(input:Record<string,unknown>)=>{
      reconciliations.push(input);
      return options.reconcile?options.reconcile(input):{queued:1,blocked:[],jobs:[{id:'same-command-id',platform:'rocket_now'}]};
    }},
    '../../../../lib/local-bridge-realtime':{publishBridgeCommandAvailable:async(storeId:string)=>{
      signals.push(`available:${storeId}`);await options.publish?.();
    }},
    '../../../../lib/uber-menu-name-adaptation-store':{MenuNameAdaptationConflict:AdaptationConflict,
      adaptRejectedUberMenuName:async(input:Record<string,unknown>)=>{adaptations.push(input);return options.adapt?options.adapt(input):false;}}
  };
  const exported:Record<string,unknown>={};
  new Function('require','exports','module',compiled)((name:string)=>{
    assert.ok(Object.hasOwn(dependencies,name),`unexpected dependency ${name}`);
    return dependencies[name];
  },exported,{exports:exported});
  return {get:exported.GET as (request:Request)=>Promise<Response>,post:exported.POST as (request:Request)=>Promise<Response>,queries,adaptations,reconciliations,signals};
}

const request=(body:unknown)=>new Request('https://example.test/api/menus/uber-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const retry=(patch:Record<string,unknown>={})=>request({action:'retry',brandId:'brand-id',jobId:'same-command-id',language:'zh',...patch});

test('master authorization fails before any menu lookup, AI preparation or command recovery',async()=>{
  const h=handlers({authorized:false});
  const response=await h.post(retry());
  assert.equal(response.status,403);
  assert.equal(h.queries.length,0);
  assert.equal(h.adaptations.length,0);
  assert.equal(h.reconciliations.length,0);
  assert.equal(h.signals.length,0);
});

test('a manual scan delegates to the source scan flow instead of replaying publication commands directly',async()=>{
  const h=handlers();
  const response=await h.post(request({action:'scan',brandId:'brand-id'}));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{queued:1});
  assert.deepEqual(h.signals,['scan:store-id']);
  assert.equal(h.adaptations.length,0);
  assert.equal(h.reconciliations.length,0);
});

test('manual replay preserves the exact failed job and uses one shared guarded reconciler',async()=>{
  const h=handlers({failures:[{platform:'rocket_now',last_error:'network timeout',hasNameDiagnostic:false}]});
  const response=await h.post(retry());
  assert.equal(response.status,200);
  assert.deepEqual(h.reconciliations,[{sourceId:'source-id',storeId:'store-id',revision:38,mode:'manual',jobId:'same-command-id'}]);
  assert.equal(h.adaptations.length,0);
  assert.deepEqual(h.signals,['available:store-id']);
  const query=h.queries.find(row=>row.text.startsWith('select c.platform'))!;
  for(const guard of ["c.status='failed'",'s.auto_publish=true','s.enabled=true',"c.payload->>'revision'=s.revision::text",
    's.store_id=c.store_id',"newer.status in ('pending','processing')",'newer.created_at=c.created_at and newer.id>c.id',"c.payload->'pendingRemovals'"])
    assert.ok(query.text.includes(guard),`missing AI preparation guard ${guard}`);
});

test('an old AI-only error without saved native diagnostics gets a fresh native replay, never an invented AI target',async()=>{
  const h=handlers({failures:[{platform:'rocket_now',last_error:'menu_name_ai_invalid:{"name":"お願い：商品合計1,600円〜で"}',hasNameDiagnostic:false}]});
  const response=await h.post(retry());
  assert.equal(response.status,200);
  assert.equal(h.adaptations.length,0);
  assert.equal(h.reconciliations.length,1);
  assert.equal(h.reconciliations[0].jobId,'same-command-id');
});

test('a real saved native diagnostic uses exact guarded AI recovery before requeueing the same command',async()=>{
  const last_error='menu_name_ai_invalid:{"stage":"output_json"}';
  const h=handlers({failures:[{platform:'rocket_now',last_error,hasNameDiagnostic:true}],adapt:async()=>({sourceKey:'option_group:exact',name:'original'})});
  const response=await h.post(retry());
  assert.equal(response.status,200);
  assert.deepEqual(h.adaptations,[{commandId:'same-command-id',storeId:'store-id',platform:'rocket_now',error:last_error,status:'failed'}]);
  assert.equal(h.reconciliations[0].jobId,'same-command-id');
});

test('a current raw native name rejection is revalidated by the existing exact-target adaptation service',async()=>{
  const last_error='uber_authority_content_failed:option_group:source-key:original:merchant_menu_request_failed:200:10036';
  const h=handlers({failures:[{platform:'rocket_now',last_error,hasNameDiagnostic:false}]});
  assert.equal((await h.post(retry())).status,200);
  assert.equal(h.adaptations[0].error,last_error);
  assert.equal(h.reconciliations.length,1);
});

test('an AI safety failure remains human-readable and never proceeds to queue mutation',async()=>{
  const h=handlers({failures:[{platform:'rocket_now',last_error:'menu_name_ai_invalid',hasNameDiagnostic:true}],adapt:async()=>{
    throw new Error('menu_name_ai_invalid:{"name":"豚肉50g","stage":"candidate_quantities","payload":"private"}');
  }});
  const response=await h.post(retry());
  const body=await response.json();
  assert.equal(response.status,409);
  assert.match(body.error,/数量、单位或价格条件/);
  assert.match(body.error,/豚肉50g/);
  assert.doesNotMatch(JSON.stringify(body),/menu_name_ai_invalid|candidate_quantities|payload|private/);
  assert.equal(h.reconciliations.length,0);
  assert.equal(h.signals.length,0);
});

test('scope conflicts while preparing a candidate stop safely without raw technical errors',async()=>{
  const h=handlers({failures:[{platform:'demae_can',last_error:'menu_name_ai_invalid',hasNameDiagnostic:true}],adapt:async()=>{throw new AdaptationConflict('private claim details');}});
  const response=await h.post(retry());
  const body=await response.json();
  assert.equal(response.status,409);
  assert.equal(body.queued,0);
  assert.match(body.error,/版本或对应关系已变化/);
  assert.doesNotMatch(JSON.stringify(body),/private|claim|uber_publication/);
  assert.equal(h.reconciliations.length,0);
});

test('inactive, newer or changed publications receive bounded human blocked reasons and no payload',async()=>{
  for(const code of ['uber_publication_reconcile_disabled','uber_publication_reconcile_active','uber_publication_reconcile_identity_changed','uber_publication_reconcile_pending_removal']) {
    const h=handlers({reconcile:async()=>({queued:0,blocked:[{platform:'rocket_now',code,payload:{secret:'never expose'}}],jobs:[]})});
    const response=await h.post(retry());
    const body=await response.json();
    assert.equal(response.status,409);
    assert.equal(body.queued,0);
    assert.ok(body.error.length>0&&body.error.length<=800);
    assert.deepEqual(Object.keys(body.blocked[0]).sort(),['platform','reason','retry']);
    assert.doesNotMatch(JSON.stringify(body),/uber_publication_reconcile|payload|secret/);
    assert.equal(h.adaptations.length,0);
    assert.equal(h.signals.length,0);
  }
});

test('new queue notifications are best-effort and cannot reverse a successful guarded enqueue',async()=>{
  const h=handlers({publish:async()=>{throw new Error('Bridge push unavailable');}});
  const response=await h.post(retry());
  assert.equal(response.status,200);
  assert.equal((await response.json()).queued,1);
  assert.deepEqual(h.signals,['available:store-id']);
});

test('unexpected service errors and missing job IDs do not leak data or trigger AI',async()=>{
  const failed=handlers({reconcile:async()=>{throw new Error('DATABASE_URL=private query');}});
  const response=await failed.post(retry());
  assert.equal(response.status,409);
  assert.doesNotMatch(JSON.stringify(await response.json()),/DATABASE_URL|private query/);
  const invalid=handlers();
  assert.equal((await invalid.post(retry({jobId:''}))).status,409);
  assert.equal(invalid.adaptations.length,0);
  assert.equal(invalid.reconciliations.length,0);
  assert.equal((await invalid.post(request(null))).status,400);
});

const getRequest=()=>new Request('https://example.test/api/menus/uber-source?brandId=brand-id');

test('GET requires master authorization before any query or command service',async()=>{
  const h=handlers({authorized:false});
  const response=await h.get(getRequest());
  assert.equal(response.status,403);assert.equal(h.queries.length,0);
  assert.equal(h.adaptations.length,0);assert.equal(h.reconciliations.length,0);assert.equal(h.signals.length,0);
});

// Execute the real GET SELECTs against an isolated in-memory PostgreSQL engine,
// not a second implementation of their filtering. No credentials/env files or
// production database are loaded. The shared SQL test runtime is opt-in.
const sqlTestOptions={skip:!process.env.PGLITE_MODULE&&'set PGLITE_MODULE for isolated real-SQL GET checks'};
async function getFixture() {
  const {PGlite}=await import(process.env.PGLITE_MODULE!);
  const db=new PGlite();
  await db.exec(`
    create table menu_uber_sources(id text primary key,brand_id text,store_id text,uber_store_uuid text,enabled boolean,auto_publish boolean,revision integer,last_checked_at timestamptz,last_error text);
    create table menu_uber_sync_runs(id text,source_id text,command_id text,revision integer,summary jsonb,created_at timestamptz);
    create table local_bridge_commands(id text primary key,store_id text,platform text,command_type text,status text,payload jsonb,result jsonb,created_at timestamptz,updated_at timestamptz,completed_at timestamptz,last_error text default '',attempts integer default 0,available_at timestamptz default now());
    create table local_bridge_devices(store_id text,platform text,last_seen_at timestamptz,is_enabled boolean);
    create table menu_uber_objects(source_id text,target_id text,kind text,price_mode text,last_uber_price numeric,archived boolean);
    create table menu_catalog_items(id text,name text,base_price numeric);
    create table menu_options(id text,name text,price_delta numeric);
  `);
  await db.query('insert into menu_uber_sources values($1,$2,$3,\'uber-store\',true,true,39,now(),\'\')',[currentSource.id,'brand-id',currentSource.store_id]);
  const h=handlers({readQuery:async(text,values)=>(await db.query(text,values)).rows});
  const add=async(patch:Record<string,unknown>)=>{
    const row={id:'menu-rocket',storeId:currentSource.store_id,platform:'rocket_now',type:'publish_menu_changes',status:'succeeded',
      payload:{sourceId:currentSource.id,revision:38,authoritativePublication:true},createdAt:'2026-10-06T00:00:00Z',completedAt:'2026-10-06T00:01:00Z',
      result:{progress:{phase:'relationships',targetName:'Synthetic menu target'}},...patch};
    await db.query('insert into local_bridge_commands(id,store_id,platform,command_type,status,payload,result,created_at,updated_at,completed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)',
      [row.id,row.storeId,row.platform,row.type,row.status,JSON.stringify(row.payload),JSON.stringify(row.result),row.createdAt,row.completedAt]);
  };
  return {db,h,add,async state(){const response=await h.get(getRequest());assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');return response.json();}};
}

test('newer inventory audits cannot replace menu successes or the currently processing menu heads',sqlTestOptions,async()=>{
  const f=await getFixture();try {
    await f.add({id:'menu-rocket'});await f.add({id:'menu-demae',platform:'demae_can',completedAt:'2026-10-06T00:02:00Z'});
    await f.add({id:'capture-uber',platform:'uber_eats',type:'capture_menu_snapshot',payload:{sourceId:currentSource.id,authoritativeSource:true,revision:38}});
    for(const platform of ['rocket_now','demae_can']) {
      await f.add({id:`audit-${platform}`,platform,type:'audit_inventory',createdAt:'2026-10-06T04:40:00Z',completedAt:'2026-10-06T04:40:24Z',
        payload:{sourceId:currentSource.id,creationHoldAuditForCommandId:'stock-command',authoritativePublication:true}});
      await f.add({id:`current-${platform}`,platform,status:'processing',createdAt:'2026-10-06T04:41:00Z',completedAt:null,
        payload:{sourceId:currentSource.id,revision:39,authoritativePublication:true}});
    }
    const body=await f.state();
    assert.equal(body.successes.find((row:Record<string,unknown>)=>row.platform==='rocket_now').revision,'38');
    assert.equal(Date.parse(body.successes.find((row:Record<string,unknown>)=>row.platform==='rocket_now').completed_at),Date.parse('2026-10-06T00:01:00Z'));
    assert.equal(Date.parse(body.successes.find((row:Record<string,unknown>)=>row.platform==='demae_can').completed_at),Date.parse('2026-10-06T00:02:00Z'));
    assert.deepEqual(body.jobHistory.map((row:Record<string,unknown>)=>row.id).sort(),['capture-uber','current-demae_can','current-rocket_now','menu-demae','menu-rocket']);
    for(const platform of ['rocket_now','demae_can'])assert.equal(body.jobs.find((row:Record<string,unknown>)=>row.platform===platform).status,'processing');
    assert.equal(f.h.signals.length,0);assert.equal(f.h.reconciliations.length,0);
  }finally {await f.db.close();}
});

test('GET excludes wrong command/authority/platform and foreign scopes from both menu data sets',sqlTestOptions,async()=>{
  const f=await getFixture();try {
    await f.add({id:'valid-menu'});
    const sourceId=currentSource.id;
    const invalid=[
      {type:'audit_inventory'}, {type:'set_inventory_availability'},
      {payload:{sourceId,authoritativePublication:false}}, {payload:{sourceId}},
      {payload:{sourceId,authoritativePublication:'true'}}, {payload:{sourceId,authoritativePublication:1}},
      {payload:{sourceId,authoritativeSource:true}},
      {platform:'uber_eats'}, {platform:'unknown-platform'},
      {platform:'rocket_now',type:'capture_menu_snapshot',payload:{sourceId,authoritativeSource:true}},
      {platform:'uber_eats',type:'capture_menu_snapshot',payload:{sourceId,authoritativePublication:true}},
      {storeId:'different-store'}, {payload:{sourceId:'different-source',authoritativePublication:true}}
    ];
    for(const [index,patch] of invalid.entries())await f.add({id:`invalid-${index}`,createdAt:'2026-10-06T04:40:00Z',completedAt:'2026-10-06T04:40:24Z',...patch});
    await f.add({id:'valid-failure',status:'failed',createdAt:'2026-10-06T04:41:00Z'});
    await f.add({id:'incomplete-success',completedAt:null,createdAt:'2026-10-06T04:42:00Z'});
    const body=await f.state();
    assert.deepEqual(body.successes.map((row:Record<string,unknown>)=>[row.platform,row.revision]),[['rocket_now','38']]);
    assert.deepEqual(body.jobHistory.map((row:Record<string,unknown>)=>row.id),['incomplete-success','valid-failure','valid-menu']);
    assert.equal(body.jobs.length,1);
  }finally {await f.db.close();}
});

test('actual menu completion wins over audits and has deterministic completion/creation/ID ordering',sqlTestOptions,async()=>{
  const f=await getFixture();try {
    await f.add({id:'old-menu'});
    await f.add({id:'audit-later',type:'audit_inventory',createdAt:'2026-10-06T04:40:00Z',completedAt:'2026-10-06T04:40:24Z'});
    for(const platform of ['rocket_now','demae_can','uber_eats']) {
      const isCapture=platform==='uber_eats';
      for(const [suffix,revision] of [['a',39],['b',40]] as const)await f.add({id:`real-${platform}-${suffix}`,platform,
        type:isCapture?'capture_menu_snapshot':'publish_menu_changes',createdAt:'2026-10-06T04:30:00Z',completedAt:'2026-10-06T04:35:00Z',
        payload:{sourceId:currentSource.id,revision,...(isCapture?{authoritativeSource:true}:{authoritativePublication:true})}});
    }
    let body=await f.state();
    assert.equal(body.successes.length,3);assert.ok(body.successes.every((row:Record<string,unknown>)=>row.revision==='40'));
    assert.ok(body.jobs.every((row:Record<string,unknown>)=>String(row.id).endsWith('-b')));
    // Same-revision replay can reuse an older command ID/creation timestamp.
    // Its fresh native completion, not its original creation, is last success.
    await f.add({id:'older-command-fresh-completion',createdAt:'2026-10-05T00:00:00Z',completedAt:'2026-10-06T04:39:00Z',
      payload:{sourceId:currentSource.id,revision:41,authoritativePublication:true}});
    body=await f.state();assert.equal(body.successes.find((row:Record<string,unknown>)=>row.platform==='rocket_now').revision,'41');
    assert.equal(f.h.adaptations.length,0);assert.equal(f.h.reconciliations.length,0);assert.equal(f.h.signals.length,0);
  }finally {await f.db.close();}
});
