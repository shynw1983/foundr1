// Actual scoped POS route and PostgreSQL queries. All data is isolated in PGlite.
// This suite never loads production lib/db, credentials, or an external endpoint.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { createDineInMenuFixture, fixtureUuid as uuid } from './store-dine-in-menu-fixture.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/pos-debug-mode-api');
await mkdir(output,{recursive:true});
const f=await createDineInMenuFixture(source),{db,ids,state}=f;
const results=[],queries=[];
const realQuery=db.query.bind(db);
let authCalls=0;
const json=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
function record(name,detail={}){results.push({name,passed:true,...detail});console.log('PASS '+name);}
async function snapshot(){const tables=(await realQuery("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(x=>x.tablename);const data={};for(const table of tables)data[table]=(await realQuery(`select to_jsonb(t) as row from "${table}" t order by to_jsonb(t)::text`)).rows;return JSON.parse(JSON.stringify(data));}
try{
 await f.installMigration();
 await json(await f.mutateMenu({action:'initialize',revision:'',operationId:uuid(9100)}));
 // Existing real-shaped paid and pending data must survive every debug action.
 await realQuery(`insert into store_customer_orders(id,store_id,order_source,pickup_code,pickup_date,pickup_time,status,payment_status,amount) values($1,$2,'store_pos','D001',current_date,'12:00','ready','paid',815)`,[uuid(9101),ids.store]);
 await realQuery(`insert into store_customer_order_items(order_id,item_name,quantity,amount) values($1,'既存の会計',1,815)`,[uuid(9101)]);
 await realQuery('delete from pos_cash_sessions where store_id=$1',[ids.store]);
 f.modules['api-auth']={requireOsSession:async()=>{authCalls++;return state.session;}};
 const route=f.reloadPos();
 db.query=async(text,values,...rest)=>{queries.push(String(text));return realQuery(text,values,...rest);};
 const before=await snapshot();
 const debugResponse=await route.GET(f.request(`/api/store/pos?storeId=${ids.store}&debug=1`));
 assert.equal(debugResponse.headers.get('cache-control'),'no-store');
 const debug=await json(debugResponse);
 assert.equal(debug.debugMode,true);assert.equal(debug.selectedStoreId,ids.store);
 assert.deepEqual(debug.todaySummary,{orderCount:0,total:0,average:0,latestOrders:[]});assert.deepEqual(debug.tableCheckoutRequests,[]);
 assert.ok(debug.items.length>0);assert.ok(debug.dineInMenu.items.length>0);assert.ok(debug.optionGroups.length>0);
 assert.ok(queries.length>0);assert.ok(queries.every(x=>/^\s*select\b/i.test(x)),queries.join('\n'));
 assert.ok(!queries.some(x=>/\b(store_customer_orders|store_customer_order_items|pos_cash_sessions|pos_cash_movements|pos_print_documents|store_relay_print_jobs|order_production_tasks)\b/i.test(x)),queries.join('\n'));
 assert.deepEqual(await snapshot(),before);record('debug-get-loads-scoped-current-menus-and-settings-without-orders-cash-tables-or-persistence',{queries:queries.length});
 const debugQueryCount=queries.length;queries.length=0;
 const normal=await json(await route.GET(f.request(`/api/store/pos?storeId=${ids.store}`)));
 for(const key of ['items','categories','optionGroups','dineInMenu','posMenuRevision','dineInMenuRevision','posSettings'])assert.deepEqual(debug[key],normal[key],key);
 assert.equal(normal.debugMode,undefined);assert.ok(queries.some(x=>/store_customer_orders/i.test(x)));
 assert.deepEqual(await snapshot(),before);record('debug-catalog-prices-and-options-equal-normal-pos-while-normal-operational-reads-remain');
 for(const [name,path,headers] of[
  ['query','/api/store/pos?debug=1',{}],
  ['header','/api/store/pos',{'x-foundr1-pos-debug':'1'}],
  ['referrer','/api/store/pos',{referer:'http://isolated.test/store/pos/debug'}],
  ['referrer-trailing-slash','/api/store/pos',{referer:'http://isolated.test/store/pos/debug/?storeId='+ids.store}]
 ]){
  for(const method of ['POST','PATCH']){
   queries.length=0;const previousAuth=authCalls;
   const request=new Request('http://isolated.test'+path,{method,headers:{'content-type':'application/json',origin:'http://isolated.test',...headers},body:JSON.stringify({...f.baseBody,storeId:ids.store,action:'cancel_order',orderId:uuid(9101),tableSessionKey:'table-test'})});
   const body=await json(await route[method](request),409);assert.equal(body.code,'POS_DEBUG_WRITE_BLOCKED');assert.equal(authCalls,previousAuth);assert.deepEqual(queries,[]);assert.deepEqual(await snapshot(),before);
   record('debug-'+method.toLowerCase()+'-'+name+'-blocked-before-auth-sql-or-side-effects');
  }
 }
 for(const method of ['POST','PATCH']){
  const previousAuth=authCalls;state.session=null;queries.length=0;
  const response=await route[method](new Request('http://isolated.test/api/store/pos?debug=0',{method,headers:{'content-type':'application/json',referer:'https://untrusted.example/store/pos/debug'},body:'{}'}));
  await json(response,401);assert.equal(authCalls,previousAuth+1);assert.deepEqual(queries,[]);record('normal-'+method.toLowerCase()+'-still-requires-auth-with-untrusted-referrer');
 }
 queries.length=0;await json(await route.GET(f.request(`/api/store/pos?storeId=${ids.store}&debug=1`)),401);assert.deepEqual(queries,[]);record('debug-get-requires-authentication');
 state.session={id:ids.employee,name:'Tester',role:'store_manager',sessionId:uuid(20)};
 queries.length=0;await json(await route.GET(f.request(`/api/store/pos?storeId=${ids.other}&debug=1`)),403);assert.deepEqual(queries,[]);record('debug-get-rejects-another-store-before-catalog-query');
 queries.length=0;
 const normalCheckout=await route.POST(f.request('/api/store/pos',{...f.baseBody,discountPresetKey:'',posMenuRevision:normal.posMenuRevision,dineInMenuRevision:normal.dineInMenuRevision}));
 assert.ok([400,409].includes(normalCheckout.status));const normalError=await normalCheckout.json();assert.match(normalError.error,/開店|レジ|開始/);assert.notEqual(normalError.code,'POS_DEBUG_WRITE_BLOCKED');assert.ok(queries.length>0);assert.deepEqual(await snapshot(),before);record('ordinary-pos-checkout-cannot-bypass-opening-cash-session');
 assert.equal(state.externalCalls,0);assert.deepEqual(state.inventoryCalls,[]);
 const hashes={};for(const path of ['app/api/store/pos/route.ts','scripts/tests/pos-debug-mode-api.mjs'])hashes[path]=createHash('sha256').update(await readFile(join(source,path))).digest('hex');
 await writeFile(join(output,'report.json'),JSON.stringify({passed:results.length,results,hashes,actualRoute:true,isolatedDatabase:'PGlite',debugQueryCount,allDatabaseTablesUnchanged:true,liveWrites:0,externalCalls:0,limitation:'Authentication identity is injected; actual role/store scope routing, SQL reads, and write guards execute against isolated PostgreSQL.'},null,2)+'\n');
 console.log(JSON.stringify({passed:results.length,output}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,results,queries,errors:state.errors},null,2)+'\n');throw error;}finally{await db.close();}
