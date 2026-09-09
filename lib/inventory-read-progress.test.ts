import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
test('read progress distinguishes waiting, active, success with differences, and failure',()=>{
  const exports:Record<string,React.ComponentType<any>>={};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../app/store/menu/InventoryReadProgress.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require});
  const reads=['queued','processing','succeeded','failed'].map((status,i)=>({id:String(i),platform:i===2?'rocket_now':'uber_eats',status,count:238,error:'401'}));
  for(const language of ['ja','zh-Hans','zh-Hant']) {
    const html=renderToStaticMarkup(createElement(exports.InventoryReadProgress,{reads,language,counts:{rocket_now:8},unknownByPlatform:{rocket_now:2},onRetry:()=>{},disabled:true}));
    for(const text of ['is-neutral','is-info','is-success','is-error','is-warning','1/4','236','disabled=""'])assert.ok(html.includes(text),text);
    if(language==='zh-Hans')for(const text of ['等待中','读取中','读取完成','读取失败','项差异','项无法判断','请检查平台登录和授权','重新读取该平台'])assert.ok(html.includes(text),text);
  }
});
test('read retry uses scoped, locked, read-only command and rejects stale/applied/busy runs',async()=>{
  const queries:string[]=[];let wakes=0;
  const modules:Record<string,unknown>={
    '../../../../../lib/api-auth':{requireOsSession:async()=>({})},
    '../../../../../lib/store-order-access':{getStoreOrderAccess:async()=>({stores:[{id:'store'}]}),getScopedStoreFilter:()=> 'store'},
    '../../../../../lib/db':{sql:async(parts:TemplateStringsArray)=>{queries.push(parts.join('?'));return [{id:'command'}];}},
    '../../../../../lib/inventory-operation-lock':{withInventoryOperationLock:async(store:string,fn:()=>unknown)=>{assert.equal(store,'store');return fn();}},
    '../../../../../lib/local-bridge-realtime':{publishBridgeCommandAvailable:async()=>{wakes++;}}
  };
  const exports:Record<string,(r:Request)=>Promise<Response>>={};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../app/api/store/menu-sync-runs/retry/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,require:(name:string)=>modules[name]});
  const response=await exports.POST(new Request('https://example.test',{method:'POST',body:JSON.stringify({action:'retry_read',storeId:'store',commandId:'command'})}));
  assert.equal(response.status,200);assert.equal(wakes,1);assert.equal(queries.length,1);
  for(const text of ["c.command_type='audit_inventory'","c.status='failed'","c.store_id::text=",'osApplied','previewAt','10 minutes','newer.created_at>r.created_at',"busy.status in ('pending','processing')"] )assert.ok(queries[0].includes(text),text);
  assert.ok(!queries[0].includes('update menu_store_settings'));
});
