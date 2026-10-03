const {test}=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript'),fs=require('fs');
const source=fs.readFileSync('app/api/analytics/menu-ranking/route.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness({session={role:'manager'},permission=true,stores=[{storeId:'source',storeName:'Test'}],scope={allStores:true,storeIds:[]}}={}){
 let dataReads=0,queries=0;const module={exports:{}};
 const load=id=>{if(id.endsWith('/menu-ranking-snapshot'))return {readMenuRankingSnapshot:async()=>{dataReads++;return {options:Array(3).fill({}),month:'2026-09'};}};if(id.endsWith('/api-auth'))return {requireOsSession:async()=>session,getSessionStoreScope:async()=>scope};if(id.endsWith('/role-permissions'))return {roleHasPermission:async()=>permission};if(id.endsWith('/menu-ranking'))return {canReadRankingScope:(p,a,ids,s)=>p&&(a||ids.includes(s))};if(id.endsWith('/db'))return {sql:async()=>{queries++;return stores;}};if(id.endsWith('.json')){dataReads++;return JSON.parse(fs.readFileSync('data/menu-ranking/september-2026.json','utf8'));}throw Error(id);};
 new Function('require','exports','module',compiled)(load,module.exports,module);
 return {get:month=>module.exports.GET(new Request('https://foundr1.jp/api/analytics/menu-ranking'+(month?'?month='+month:''))),reads:()=>dataReads,queries:()=>queries};
}
test('Unauthenticated and disabled-module requests reject before source or snapshot loading',async()=>{
 for(const config of [{session:null},{permission:false}]){const h=harness(config),r=await h.get();assert.equal(r.status,config.session===null?401:403);assert.equal(h.reads(),0);assert.equal(h.queries(),0);assert.equal(r.headers.get('Cache-Control'),'private, no-store');}
});
test('Scoped other-store and ambiguous-source access fail closed without data',async()=>{
 for(const config of [{scope:{allStores:false,storeIds:['other']}},{stores:[]},{stores:[{storeId:'a'},{storeId:'b'}]}]){const h=harness(config),r=await h.get();assert.equal(r.status,config.scope?403:409);assert.equal(h.reads(),0);}
});
test('Valid source-store access serves verified month with private caching; future month is unavailable',async()=>{
 const h=harness({scope:{allStores:false,storeIds:['source']}}),r=await h.get();assert.equal(r.status,200);assert.equal(r.headers.get('Vary'),'Cookie');const p=await r.json();assert.equal(p.options.length,3);assert.equal(p.store.id,'source');assert.equal((await h.get('2026-10')).status,404);
});
