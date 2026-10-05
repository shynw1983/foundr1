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
};

function handlers(options:Options={}) {
  const queries:Query[]=[],adaptations:Record<string,unknown>[]=[],reconciliations:Record<string,unknown>[]=[],signals:string[]=[];
  const sql=async(strings:TemplateStringsArray,...values:unknown[])=>{
    const text=strings.join('?').replace(/\s+/g,' ').trim();
    queries.push({text,values});
    assert.doesNotMatch(text,/^(?:update|insert|delete)/i,'route must delegate mutations to the safe shared services');
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
  return {post:exported.POST as (request:Request)=>Promise<Response>,queries,adaptations,reconciliations,signals};
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
