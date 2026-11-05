// Real handlers + isolated PostgreSQL. No production credentials or physical device access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const {PGlite}=await import(process.env.FOUNDR1_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite(),root=resolve('.'),schema=readFileSync('db/schema.sql','utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const store=id(1),other=id(2),employee=id(3),station=id(4),device=id(5),cash=id(6);
const token='a'.repeat(43),ownerToken='b'.repeat(43),session={id:employee,role:'store_terminal',sessionId:'test-session'};
for(const table of ['stores','employees','brands','order_production_tasks','pos_cash_sessions','pos_store_settings','store_customer_orders','store_customer_order_items']){
 const match=schema.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`));assert.ok(match,table);
 await db.exec(match[0].replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi,''));
 for(const alter of schema.matchAll(new RegExp(`alter table ${table} add column[^;]*;`,'g')))await db.exec(alter[0].replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi,''));
}
await db.exec(readFileSync('db/migrations/20261016_store_device_relay.sql','utf8'));
await db.exec(readFileSync('db/migrations/20261018_pos_scale_tare.sql','utf8'));
await db.exec(readFileSync('db/migrations/20261018_pos_scale_filter.sql','utf8'));
await db.exec(readFileSync('db/migrations/20261020_pos_print_documents.sql','utf8'));
function sql(parts,...values){
 const parameters=[];const text=parts.reduce((text,part,i)=>text+part+(i===values.length?'':values[i]?.unsafeSql??(parameters.push(values[i]),`$${parameters.length}`)),'');
 return {text,values:parameters,then(ok,fail){return db.query(text,parameters).then(r=>r.rows).then(ok,fail);}};
}
sql.unsafe=unsafeSql=>({unsafeSql});sql.transaction=async statements=>db.transaction(async tx=>{const result=[];for(const q of statements)result.push((await tx.query(q.text,q.values)).rows);return result;});
const cache=new Map();
function load(path){
 const filename=resolve(root,path);if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 runInNewContext(ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Request,Response,URL,console,performance,require:name=>{
  if(name==='node:crypto')return require(name);
  if(name.endsWith('/db'))return {sql};
  if(name.endsWith('/api-auth'))return {requireOsSession:async()=>session};
  if(name.endsWith('/store-order-access'))return {getStoreOrderAccess:async()=>({stores:[{id:store}]}),getScopedStoreFilter:(_,value)=>value===store?store:'__forbidden__'};
  if(name.startsWith('.'))return load(resolve(dirname(filename),name)+'.ts');
  throw Error(`Unexpected dependency ${name}`);
 }});return exports;
}
const helpers=load('lib/store-relay.ts'),relay=load('app/api/store/device-relay/route.ts'),agent=load('app/api/store/device-relay/agent/route.ts');
await db.query('insert into stores(id,name) values($1,$2),($3,$4)',[store,'test',other,'other']);
await db.query('insert into employees(id,name,role) values($1,$2,$3)',[employee,'Tester','store_terminal']);
await db.query(`insert into store_relay_stations(id,store_id,name,enabled,print_enabled,scale_enabled,owner_hash,owner_employee_id,owner_session_id,owner_until,epoch)
 values($1,$2,'test',true,true,true,$3,$4,'test-session',now()+interval '45 seconds',1)`,[station,store,helpers.relayHash(ownerToken),employee]);
await db.query('insert into store_relay_devices(id,station_id,token_hash) values($1,$2,$3)',[device,station,helpers.relayHash(token)]);
const owner={stationId:station,epoch:1,token:ownerToken};
const call=async(handler,body,bearer)=>handler.POST(new Request('https://fixture.invalid/api/store/device-relay',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body)}));
const beat=()=>call(agent,{action:'heartbeat',status:{scale:'connected',scaleTareVersion:1}},token);
const action=b=>call(relay,{storeId:store,owner,...b});
const checks=[];const pass=value=>checks.push(value);
try{
 let response=await beat();assert.equal(response.status,200,await response.clone().text());let state=(await response.json()).station;
 assert.equal(state.register_open,false);assert.equal(state.scale_enabled,false);assert.equal(state.heartbeat_interval_ms,15000);assert.equal(state.print_interval_ms,15000);pass('closed server duty disables BLE and lowers idle network cadence');
 assert.equal((await action({action:'scaleStart',scaleSession:id(10)})).status,409);
 assert.equal((await action({action:'scaleAdopt',scaleSession:id(10)})).status,409);
 assert.equal((await call(agent,{action:'reading',scaleSession:id(10),epoch:1,sequence:0,measuredAt:Date.now(),line:'ST,+000300.0  g\r\n'},token)).status,409);pass('closed register rejects starts, readings and adoption');
 assert.equal((await db.query('select scale_enabled from store_relay_stations where id=$1',[station])).rows[0].scale_enabled,true);pass('sleep does not alter saved scale configuration');
 await db.query("insert into pos_cash_sessions(id,store_id,business_date,status) values($1,$2,current_date,'open')",[id(7),other]);
 state=(await(await beat()).json()).station;assert.equal(state.register_open,false);pass('another store opening cannot wake this scale');
 await db.query("insert into pos_cash_sessions(id,store_id,business_date,status) values($1,$2,current_date,'open')",[cash,store]);
 state=(await(await beat()).json()).station;assert.equal(state.scale_enabled,true);assert.equal(state.heartbeat_interval_ms,1000);
 response=await action({action:'scaleStart',scaleSession:id(10)});assert.equal(response.status,200,await response.clone().text());
 state=(await(await beat()).json()).station;assert.equal(state.scale_session,id(10));assert.equal(state.heartbeat_interval_ms,3000);pass('reopening preserves owner and starts a fresh weighing session');
 const reading={action:'reading',scaleSession:id(10),epoch:1,sequence:0,measuredAt:Date.now(),line:'ST,+000300.0  g\r\n'};
 response=await call(agent,reading,token);assert.equal(response.status,200,await response.clone().text());
 response=await action({action:'scaleAdopt',scaleSession:id(10),scaleSequence:0});assert.equal(response.status,200,await response.clone().text());
 const capture=(await response.json()).capture;assert.equal(Number(capture.grams),300);pass('fresh authenticated scale reading is still adoptable');
 // Exercise the exact retirement query saved in the closing transaction.
 const source=readFileSync('app/api/store/pos/reconciliation/route.ts','utf8');const fragment=source.match(/sql`update store_relay_stations set scale_session=null,scale_tare_context='\{\}'::jsonb,[\s\S]*?c.status='open'\)`/);assert.ok(fragment);
 const q=runInNewContext(fragment[0],{sql,storeFilter:store});
 response=await action({action:'scaleStart',scaleSession:id(11)});assert.equal(response.status,200);
 await assert.rejects(db.transaction(async tx=>{
   await tx.query("update pos_cash_sessions set status='closed' where id=$1",[cash]);await tx.query(q.text,q.values);throw Error('simulated close rollback');
 }),/simulated close rollback/);
 assert.equal((await db.query('select status from pos_cash_sessions where id=$1',[cash])).rows[0].status,'open');
 assert.equal((await db.query('select scale_session from store_relay_stations where id=$1',[station])).rows[0].scale_session,id(11));
 pass('failed close transaction preserves open register and live scale session');
 await db.transaction(async tx=>{await tx.query("update pos_cash_sessions set status='closed' where id=$1",[cash]);await tx.query(q.text,q.values);});
 state=(await(await beat()).json()).station;assert.equal(state.scale_session,null);assert.equal(state.scale_enabled,false);
 assert.equal((await db.query('select count(*)::int as n from store_relay_scale_captures where id=$1',[capture.id])).rows[0].n,1);pass('closing retires only live measurements and preserves immutable captures');
 const rows=await helpers.relayStations(store);assert.equal(rows[0].register_open,false);assert.equal(rows[0].scale_operating,false);pass('POS receives explicit closed state instead of a connection failure');
 // Closed stores still serve printing work; transport outcomes retain their original safety rules.
 const order=id(20),job=id(21);
 await db.query("insert into store_customer_orders(id,store_id,pickup_code,pickup_date,pickup_time,status,payment_status) values($1,$2,'01',current_date,'12:00','ready','paid')",[order,store]);
 await db.query("insert into store_relay_print_jobs(id,station_id,store_id,order_id,document_key,sequence,kind,payload) values($1,$2,$3,$4,'idle-test',1,'receipt','{}')",[job,station,store,order]);
 state=(await(await beat()).json()).station;assert.equal(state.print_interval_ms,3000);
 response=await call(agent,{action:'claim'},token);assert.equal(response.status,200,await response.clone().text());const claimed=(await response.json()).job;assert.equal(claimed.id,job);
 response=await call(agent,{action:'ack',jobId:job,claimToken:claimed.claim_token,result:'sent'},token);assert.equal(response.status,200);
 assert.equal((await(await call(agent,{action:'claim'},token)).json()).job,null);pass('closed printing drains queued tasks once without auto-replaying sent jobs');
 assert.equal((await call(agent,{action:'heartbeat'},'x'.repeat(43))).status,401);
 const denied=await relay.GET(new Request(`https://fixture.invalid/api/store/device-relay?storeId=${other}`));assert.equal(denied.status,403);pass('device credential and store scope checks remain enforced');
 console.log(JSON.stringify({passed:checks.length,checks,productionAccess:false},null,2));
}finally{await db.close();}
