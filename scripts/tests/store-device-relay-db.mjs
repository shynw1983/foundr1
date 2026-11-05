// Actual POS/production SQL against isolated PostgreSQL; no DATABASE_URL or live writes.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = new URL('../../', import.meta.url);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { store: uuid(1), other: uuid(2), brand: uuid(3), employee: uuid(4), menu: uuid(5), register: uuid(6) };
let session = { id: ids.employee, name: 'Tester', role: 'store_manager',sessionId:uuid(7),sessionVersion:1 };
let failItems = false;
let readingDelayMs=0,adoptionDelayMs=0,pairingDelayMs=0,relayGetDelayMs=0,resumeDelayMs=0;
let failRefundCancel=false,refundBarrier=null,tareRevisionRace=null,filterBeforeTransactionRace=null;
let resumeBeforeTransactionRace=null;
const stripRefs = s => s.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi, '');
const schema = readFileSync(new URL('db/schema.sql', root), 'utf8');
const tables = ['stores','employees','brands','store_brands','pos_store_settings','pos_cash_sessions','store_customer_orders','store_customer_order_items','order_production_tasks','pos_cash_movements','module_settings','menu_catalog_items','menu_option_groups','menu_options','menu_store_settings','menu_option_store_settings','sales_orders','store_tables','local_bridge_devices','member_coupons'];
for (const table of tables) {
  const create = schema.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`));
  assert.ok(create, table);
  await db.exec(stripRefs(create[0]).replace(/encode\(gen_random_bytes\(24\), 'hex'\)/g, "gen_random_uuid()::text"));
  for (const alter of schema.matchAll(new RegExp(`alter table ${table} add column[^;]*;`, 'g'))) {
    if (!/pickup_code|preparation_note|order_item_id|handed_off_at/.test(alter[0])) await db.exec(stripRefs(alter[0]));
  }
}
await db.exec(`create unique index idx_test_offline on store_customer_orders(offline_client_order_id) where offline_client_order_id is not null;
  create unique index idx_test_task on order_production_tasks(order_id,production_area,production_area_label);`);
const migration = readFileSync(new URL('db/migrations/20261015_pos_bowl_tickets.sql', root), 'utf8');
const historical=uuid(999);
await db.query(`insert into store_customer_orders(id,pickup_code,pickup_date,pickup_time,status,payment_status) values($1,'07',current_date,'12:00','ready','paid')`,[historical]);
await db.query(`insert into store_customer_order_items(order_id,item_name,quantity) values($1,'歴史注文',1)`,[historical]);
await db.exec(migration);
await db.exec(migration);
assert.equal((await db.query('select pickup_code from store_customer_orders where id=$1',[historical])).rows[0].pickup_code,'07');
assert.equal((await db.query('select pickup_code,preparation_note from store_customer_order_items where order_id=$1',[historical])).rows[0].pickup_code,'');
await db.query('delete from store_customer_order_items where order_id=$1',[historical]);
await db.query('delete from store_customer_orders where id=$1',[historical]);
await db.exec(`insert into stores(id,name) values('${ids.store}','桜並木 test'),('${ids.other}','Other');
insert into employees(id,name,role) values('${ids.employee}','Tester','store_manager');
insert into brands(id,name,brand_type) values('${ids.brand}','まぁ麻','restaurant');
insert into store_brands(store_id,brand_id,pos_pricing_mode,pos_weight_unit_price) values('${ids.store}','${ids.brand}','weight',4);
insert into menu_catalog_items(id,brand_id,name,item_kind,base_price) values('${ids.menu}','${ids.brand}','自選マーラータン','buildable_product',0);
insert into pos_cash_sessions(id,store_id,business_date,status) values('${ids.register}','${ids.store}',current_date,'open');`);
function query(parts, ...values) {
  const parameters=[];
  const text=parts.reduce((text,part,index)=>{
    text+=part;if(index===values.length)return text;
    const value=values[index];
    if(value&&typeof value.unsafeSql==='string')return text+value.unsafeSql;
    parameters.push(value);return text+`$${parameters.length}`;
  },'');
  return { text, values:parameters,
    then(resolve, reject) { return execute(this, db).then(resolve, reject); } };
}
async function execute(statement, connection) {
  if(failRefundCancel&&/j.state='pending'/.test(statement.text)&&/返金・キャンセルにより/.test(statement.text))throw new Error('simulated refund cancellation failure');
  if (failItems && /insert into store_customer_order_items/.test(statement.text)) throw new Error('simulated item persistence failure');
  if(relayGetDelayMs&&/select j.id,j.station_id,j.order_id,j.kind,j.sequence,/.test(statement.text)){
    const delay=relayGetDelayMs;relayGetDelayMs=0;await new Promise(resolve=>setTimeout(resolve,delay));
  }
  if(pairingDelayMs&&/select s.id from store_relay_stations s join store_relay_devices/.test(statement.text)){
    const delay=pairingDelayMs;pairingDelayMs=0;await new Promise(resolve=>setTimeout(resolve,delay));
  }
  if(resumeDelayMs&&/with candidate as materialized/.test(statement.text)){
    const delay=resumeDelayMs;resumeDelayMs=0;await new Promise(resolve=>setTimeout(resolve,delay));
  }
  // Delay inside the real transaction to distinguish wall clock from its frozen now().
  if(readingDelayMs&&/update store_relay_stations set scale_reading=/.test(statement.text)){
    const delay=readingDelayMs;readingDelayMs=0;await new Promise(resolve=>setTimeout(resolve,delay));
  }
  if(adoptionDelayMs&&/insert into store_relay_scale_captures/.test(statement.text)){
    const delay=adoptionDelayMs;adoptionDelayMs=0;await new Promise(resolve=>setTimeout(resolve,delay));
  }
  return (await connection.query(statement.text, statement.values)).rows;
}
const sql = Object.assign(query, { unsafe:unsafeSql=>({unsafeSql}),transaction: async statements => {
  if(refundBarrier&&statements.some(statement=>/as refund_allowed/.test(statement.text))){
    const barrier=refundBarrier;if(++barrier.waiting===2)barrier.resolve();await barrier.promise;
  }
  if(tareRevisionRace&&statements.some(statement=>/as tare_settings_current/.test(statement.text))){const race=tareRevisionRace;tareRevisionRace=null;await race();}
  if(filterBeforeTransactionRace&&statements.some(statement=>/update store_relay_stations set scale_reading=/.test(statement.text))){const race=filterBeforeTransactionRace;filterBeforeTransactionRace=null;await race();}
  if(resumeBeforeTransactionRace&&statements.some(statement=>/with candidate as materialized/.test(statement.text))){const race=resumeBeforeTransactionRace;resumeBeforeTransactionRace=null;await race();}
  return db.transaction(async connection => {
  const results = [];
  for (const statement of statements) results.push(await execute(statement, connection));
  return results;
});} });
const modules = {};
function load(path) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, root),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Request, Response, URL, console, performance, require: name => {
      if (name === 'node:crypto') return require(name);
      if (name === 'next/server') return { after() {} };
      const key = name.split('/').at(-1);
      if (key === 'db') return { sql };
      if (modules[key]) return modules[key];
      throw new Error(`Missing test dependency ${name}`);
    } });
  return exports;
}
modules['api-auth'] = { requireOsSession: async () => session };
modules['store-order-access'] = { getStoreOrderAccess: async () => ({ stores: [{ id: ids.store }] }), getScopedStoreFilter: (_, id) => !id || id === ids.store ? ids.store : '__forbidden__' };
modules['customer-orders'] = { createPickupCode: () => `D${Math.random().toString(16).slice(2,8)}`, findCustomerOrderById: async () => null };
modules.loyalty = { resolveMemberForOrder: async () => null, awardLoyaltyForPaidOrder: async () => null,
  reverseLoyaltyForRefundedOrder:async()=>{},reverseLoyaltyForRefundedOrderItem:async()=>{} };
modules['order-realtime'] = { publishCustomerOrderEvent: async () => {} };
modules['sales-orders'] = { syncWebReservationToSalesOrder: async () => {} };
modules['store-dining-sessions'] = { syncDiningSessionFromProduction: async () => {}, markDiningOrdersPaid: async () => {} };
modules['inventory-order-usage'] = { markInventoryOrderReady: async () => {}, safeSyncInventoryOrderUsage: async () => {} };
modules['production-estimate'] = { calculateProductionEstimateMinutes: () => 10 };
modules['maamaa-production-rules'] = { normalizeMaamaaProductionReferenceSettings: () => ({}), localizeMaamaaProductionSummary: text => text, localizeMaamaaCustomerLabel: text => text };
modules['maamaa-production-summary'] = { buildMaamaaProductionItemLines: () => [] };
modules['pos-scale-filter'] = load('lib/pos-scale-filter.ts');
modules['pos-scale-tare'] = load('lib/pos-scale-tare.ts');
modules['pos-printer'] = load('lib/pos-printer.ts');
modules['pos-catalog-policy'] = load('lib/pos-catalog-policy.ts');
modules['pos-menu-policy'] = load('lib/pos-menu-policy.ts');
modules['pos-menu-settings'] = load('lib/pos-menu-settings.ts');
modules['pos-serving-policy'] = load('lib/pos-serving-policy.ts');
modules['pos-bowl-data'] = load('lib/pos-bowl-data.ts');
modules['order-production'] = load('lib/order-production.ts');
modules['store-relay-policy'] = load('lib/store-relay-policy.ts');
modules['store-relay-print-policy'] = load('lib/store-relay-print-policy.ts');
modules['store-relay'] = load('lib/store-relay.ts');
modules['pos-pickup-ticket-copy'] = load('lib/pos-pickup-ticket-copy.ts');
modules['store-relay-documents'] = load('lib/store-relay-documents.ts');
modules['role-permissions']={roleHasPermission:async role=>role==='store_manager'};
const pos = load('app/api/store/pos/route.ts');
const admin=load('app/api/os/stores/device-relay/route.ts');
const relay=load('app/api/store/device-relay/route.ts');
const agent=load('app/api/store/device-relay/agent/route.ts');
const refunds=load('app/api/store/pos/transactions/route.ts');
const posSettingsAdmin=load('app/api/os/pos/settings/route.ts');
const relayMigration=readFileSync(new URL('db/migrations/20261016_store_device_relay.sql',root),'utf8');
await db.exec(relayMigration);await db.exec(relayMigration);
const tareMigration=readFileSync(new URL('db/migrations/20261018_pos_scale_tare.sql',root),'utf8');
await db.exec(tareMigration);await db.exec(tareMigration);
const filterMigration=readFileSync(new URL('db/migrations/20261018_pos_scale_filter.sql',root),'utf8');
// Simulate the preceding production schema: old settings survive the additive rollout.
await db.exec('alter table pos_store_settings drop column scale_filter_settings');
await db.query('insert into pos_store_settings(store_id,printer_settings) values($1,$2::jsonb)',[ids.other,JSON.stringify({sentinel:'keep-existing-printer'})]);
await db.exec(filterMigration);await db.exec(filterMigration);
const migratedFilterSettings=(await db.query('select printer_settings,scale_filter_settings from pos_store_settings where store_id=$1',[ids.other])).rows[0];
assert.deepEqual(migratedFilterSettings.printer_settings,{sentinel:'keep-existing-printer'});
assert.deepEqual(migratedFilterSettings.scale_filter_settings,{enabled:false,revision:'',toleranceGrams:2,settleMs:2000});
await db.query('delete from pos_store_settings where store_id=$1',[ids.other]);
assert.equal((await modules['store-relay'].relayStations(ids.store)).length,0);
const request=(api,body,token)=>api.POST(new Request('http://test/api',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://test',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)}));
const adminPost=b=>request(admin,{storeId:ids.store,...b});
const stationId=uuid(20);
assert.equal((await adminPost({action:'save',stationId,name:'レジ A',enabled:true,printEnabled:true,scaleEnabled:true})).status,200);
let config=(await modules['store-relay'].relayStations(ids.store))[0];assert.equal(config.device_online,null);
const pairCode=await (await adminPost({action:'pair',stationId})).json();assert.match(pairCode.pairingCode,/^[0-9]{6}$/);
// A code for another register cannot be consumed by a guided connection to this target.
assert.equal((await request(relay,{action:'pair',storeId:ids.store,stationId:uuid(21),code:pairCode.pairingCode})).status,409);
const unconsumed=(await db.query('select token_hash,pairing_hash from store_relay_devices where station_id=$1',[stationId])).rows[0];
assert.equal(unconsumed.token_hash,'');assert.ok(unconsumed.pairing_hash);
const paired=await (await request(relay,{action:'pair',storeId:ids.store,stationId,code:pairCode.pairingCode})).json();assert.match(paired.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(paired.stationId,stationId);
const token=paired.token;
assert.equal((await request(relay,{action:'pair',storeId:ids.store,stationId,code:pairCode.pairingCode})).status,409);
const callAgent=b=>request(agent,b,token);
assert.equal((await callAgent({action:'heartbeat'})).status,200);
let owned=await (await request(relay,{action:'claim',storeId:ids.store,stationId,epoch:0})).json();assert.ok(owned.owner);let owner=owned.owner;
const operator=b=>request(relay,{storeId:ids.store,owner,...b});
// Two same-epoch takeovers: precisely one gets operation rights.
const takeovers=await Promise.all([request(relay,{action:'takeover',storeId:ids.store,stationId,epoch:owner.epoch}),request(relay,{action:'takeover',storeId:ids.store,stationId,epoch:owner.epoch})]);
assert.deepEqual(takeovers.map(r=>r.status).sort(),[200,409]);
const nextOwner=await takeovers.find(r=>r.status===200).json();
assert.equal((await operator({action:'heartbeat'})).status,409);owner=nextOwner.owner;
const printer={enabled:true,receiptEnabled:true,kitchenEnabled:false,receiptPrinter:{deviceType:'escpos_network',connectionType:'lan',host:'192.168.0.33',identifier:'192.168.0.33',port:9100,paperWidth:'80mm',cutPaper:true,openCashDrawer:false}};
await db.query('insert into pos_store_settings(store_id,printer_settings) values($1,$2::jsonb)',[ids.store,JSON.stringify(printer)]);
const checkout=patch=>request(pos,{storeId:ids.store,relayOwner:owner,bowlTicketVersion:1,orderType:'eat_in',paymentMethod:'cash',cashTenderedAmount:5000,offlineClientOrderId:uuid(100),items:[{menuCatalogItemId:ids.menu,quantity:2,measuredQuantity:300}],...patch});
let response=await checkout({});let sale=await response.json();assert.equal(response.status,200,JSON.stringify(sale));assert.equal(sale.relayPrinting,true);
assert.equal((await db.query('select count(*)::int as n from store_relay_print_jobs')).rows[0].n,7);
const documents=(await db.query('select kind,payload from store_relay_print_jobs order by sequence')).rows;
assert.deepEqual(documents.map(d=>d.payload.order.pickupCode),[...Array(3).fill(sale.servingTickets[0].pickupCode),...Array(3).fill(sale.servingTickets[1].pickupCode),sale.pickupCode]);
assert.deepEqual(documents.slice(0,3).map(d=>d.payload.kitchenTicketTemplate.title),['厨房伝票','出品伝票','お客様番号札']);
assert.ok(documents.slice(0,-1).every(d=>d.payload.printer.openCashDrawer===false));
const snapshot=(await db.query("select payload from store_relay_print_jobs where kind='receipt'")).rows[0].payload;
assert.equal(snapshot.order.paymentLabel,'現金');assert.equal(snapshot.order.totalAmount,2400);assert.equal(snapshot.order.items.length,2);
assert.equal((await checkout({})).status,200);assert.equal((await db.query('select count(*)::int as n from store_relay_print_jobs')).rows[0].n,7);
assert.equal((await checkout({relayOwner:undefined,offlineClientOrderId:uuid(101)})).status,409);
failItems=true;await assert.rejects(()=>checkout({offlineClientOrderId:uuid(102)}));failItems=false;
assert.equal((await db.query('select count(*)::int as n from store_relay_print_jobs')).rows[0].n,7);
let first=await (await callAgent({action:'claim'})).json();assert.ok(first.job);
assert.equal((await (await callAgent({action:'claim'})).json()).job,null);
assert.equal((await callAgent({action:'ack',jobId:first.job.id,claimToken:uuid(999),result:'sent'})).status,409);
await db.exec("update store_relay_print_jobs set claimed_at=now()-interval '3 minutes' where state='sending'");
const clockGetStarted=Date.now();relayGetDelayMs=150;
const offlineJobsResponse=await relay.GET(new Request(`http://test/api?storeId=${ids.store}`));
const offlineJobs=await offlineJobsResponse.json();
assert.equal(offlineJobsResponse.headers.get('cache-control'),'no-store');
assert.ok(Number.isFinite(Date.parse(offlineJobs.serverNow)));
assert.ok(Date.parse(offlineJobs.serverNow)>=clockGetStarted+125,'The authoritative clock is sampled after the delayed final status read.');
assert.ok(Date.parse(offlineJobs.serverNow)<=Date.now());
assert.ok(Number.isSafeInteger(offlineJobs.serverElapsedMs)&&offlineJobs.serverElapsedMs>=125);
assert.ok(offlineJobs.serverElapsedMs<=Date.now()-clockGetStarted+20);
console.log('PASS relay status includes a no-store server clock sampled after all database reads');
assert.equal(offlineJobs.jobs.find(j=>j.id===first.job.id).state,'uncertain');
assert.equal((await operator({action:'confirmSent',jobId:first.job.id})).status,200);
assert.equal((await callAgent({action:'ack',jobId:first.job.id,claimToken:first.job.claim_token,result:'sent'})).status,409);
let second=(await (await callAgent({action:'claim'})).json()).job;assert.ok(second);
assert.equal((await callAgent({action:'ack',jobId:second.id,claimToken:second.claim_token,result:'sent'})).status,200);
assert.equal((await operator({action:'reprint',jobId:second.id})).status,200);
const reprint=(await db.query('select payload from store_relay_print_jobs where reprint_of=$1',[second.id])).rows[0];assert.equal(reprint.payload.printer.openCashDrawer,false);
// Scale: official flags, measured time, one active session, stable-only adoption and immutable capture.
const started=await (await operator({action:'scaleStart'})).json();assert.ok(started.scaleSession);
const scaleHeartbeat=await (await callAgent({action:'heartbeat',storeId:ids.other,stationId:uuid(99),status:{scale:'connected'}})).json();
assert.equal(scaleHeartbeat.station.id,stationId);assert.equal(scaleHeartbeat.station.store_id,ids.store);
assert.equal(scaleHeartbeat.station.scale_session,started.scaleSession);
const reading={action:'reading',scaleSession:started.scaleSession,epoch:owner.epoch,sequence:1,line:'US,+000300.0  g\r\n'};
const sendReading=patch=>callAgent({...reading,measuredAt:Date.now(),...patch});
for(const measuredAt of [undefined,null,'not-a-time',Date.now()+0.5,Date.now()-60000,Date.now()+60000]){
  assert.equal((await sendReading({measuredAt,sequence:0})).status,409,'Missing, invalid, old or future measurement time is rejected.');
}
readingDelayMs=1000;
assert.equal((await sendReading({measuredAt:Date.now()-4500,sequence:0})).status,409,'A sample that expires after application validation cannot persist as fresh during a delayed transaction.');
let scaleRow=(await db.query('select scale_sequence,scale_reading,scale_received_at from store_relay_stations where id=$1',[stationId])).rows[0];
assert.equal(Number(scaleRow.scale_sequence),-1);assert.equal(scaleRow.scale_reading,null);assert.equal(scaleRow.scale_received_at,null);
assert.equal((await sendReading({})).status,200);
assert.equal((await operator({action:'scaleAdopt',scaleSession:started.scaleSession})).status,409);
const measuredAt=Date.now()-2000;
assert.equal((await sendReading({sequence:2,line:'ST,+000300.0  g\r\n',measuredAt})).status,200);
const persistedTime=Number((await db.query('select extract(epoch from scale_received_at)*1000 as measured_ms from store_relay_stations where id=$1',[stationId])).rows[0].measured_ms);
assert.ok(Math.abs(persistedTime-measuredAt)<1,'Persistence uses the actual measurement time, not upload/SQL time.');
const beforeClockRead=(await db.query('select scale_received_at,owner_until from store_relay_stations where id=$1',[stationId])).rows[0];
const clockRead=await (await relay.GET(new Request(`http://test/api?storeId=${ids.store}`))).json();
assert.equal(Date.parse(clockRead.stations.find(station=>station.id===stationId).scale_received_at),Math.round(persistedTime));
assert.ok(Date.parse(clockRead.serverNow)-persistedTime>=1900,'An updated server clock still includes the original reading age.');
assert.deepEqual((await db.query('select scale_received_at,owner_until from store_relay_stations where id=$1',[stationId])).rows[0],beforeClockRead,'A status clock never renews a measurement or cashier lease.');
console.log('PASS relay status clock preserves original measurement timestamps and cashier leases');
const recoveryHeartbeat=await (await callAgent({action:'heartbeat',status:{scale:'connected'}})).json();
const recoverySequence=Number(recoveryHeartbeat.station.scale_sequence);
assert.equal(recoveryHeartbeat.station.scale_session,started.scaleSession);
assert.equal(recoverySequence,2,'Restarted native workers can seed the active session cursor from its persisted server sequence.');
assert.equal((await sendReading({sequence:1})).status,409);
await db.query("update store_relay_stations set scale_received_at=now()-interval '4500 milliseconds' where id=$1",[stationId]);
adoptionDelayMs=1000;
assert.equal((await operator({action:'scaleAdopt',scaleSession:started.scaleSession})).status,409,'Adoption uses wall clock after transaction delay, not transaction-start now().');
await db.exec("update store_relay_stations set scale_received_at=now()-interval '6 seconds'");
assert.equal((await operator({action:'scaleAdopt',scaleSession:started.scaleSession})).status,409);
assert.equal((await sendReading({sequence:recoverySequence+1,line:'OL,+9999.999 kg\r\n'})).status,200);
assert.equal((await operator({action:'scaleAdopt',scaleSession:started.scaleSession})).status,409);
const capturedMeasuredAt=Date.now()-1500;
assert.equal((await sendReading({sequence:4,line:'ST,+000300.0  g\r\n',measuredAt:capturedMeasuredAt})).status,200);
const adopted=await (await operator({action:'scaleAdopt',scaleSession:started.scaleSession})).json();assert.equal(Number(adopted.capture.grams),300);
const captureTime=Number((await db.query('select extract(epoch from received_at)*1000 as measured_ms from store_relay_scale_captures where id=$1',[adopted.capture.id])).rows[0].measured_ms);
assert.ok(Math.abs(captureTime-capturedMeasuredAt)<1,'The immutable capture preserves the measurement timestamp.');
assert.equal((await sendReading({sequence:5})).status,409);
response=await checkout({offlineClientOrderId:uuid(104),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:300,scaleCaptureId:adopted.capture.id}]});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
assert.equal((await db.query('select count(*)::int as n from store_relay_scale_captures where order_id is not null')).rows[0].n,1);
response=await checkout({offlineClientOrderId:uuid(105),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:301,scaleCaptureId:adopted.capture.id}]});assert.equal(response.status,409);
// Automatic weighing: each client-owned session has one immutable capture; retries never close its successor.
const cancelledScale=uuid(301),automaticScale=uuid(302),blockedScale=uuid(303),successorScale=uuid(304);
assert.equal((await operator({action:'scaleEnd'})).status,400,'Ending a session requires its identity; old cleanup must not clear a newer bowl.');
assert.equal((await operator({action:'scaleStart',scaleSession:'not-a-session'})).status,400);
assert.equal((await operator({action:'scaleStart',scaleSession:automaticScale,expectedScaleSession:'not-a-session'})).status,400);
assert.equal((await operator({action:'scaleEnd',scaleSession:cancelledScale})).status,200);
assert.equal((await operator({action:'scaleStart',scaleSession:cancelledScale})).status,409,'Cleanup arriving before start prevents a late request from reviving the closed bowl.');
response=await operator({action:'scaleStart',scaleSession:automaticScale});
assert.equal(response.status,200);assert.equal((await response.json()).scaleSession,automaticScale);
assert.equal((await operator({action:'scaleStart',scaleSession:blockedScale})).status,409,'An unanticipated session cannot overwrite the current bowl.');
assert.equal((await sendReading({scaleSession:automaticScale,sequence:31,line:'ST,+000300.0  g\r\n'})).status,200);
const beforeStartRetry=(await db.query('select scale_session,scale_sequence,scale_reading,scale_received_at from store_relay_stations where id=$1',[stationId])).rows[0];
assert.equal((await operator({action:'scaleStart',scaleSession:automaticScale})).status,200);
const afterStartRetry=(await db.query('select scale_session,scale_sequence,scale_reading,scale_received_at from store_relay_stations where id=$1',[stationId])).rows[0];
assert.deepEqual(afterStartRetry,beforeStartRetry,'Retrying the same start preserves an existing measurement and cursor.');
for(const scaleSequence of [null,-1,'31',1.5])assert.equal((await operator({action:'scaleAdopt',scaleSession:automaticScale,scaleSequence})).status,400);
assert.equal((await operator({action:'scaleAdopt',scaleSession:automaticScale,scaleSequence:30})).status,409,'An automatic capture must match the exact reading shown by POS.');
response=await operator({action:'scaleAdopt',scaleSession:automaticScale,scaleSequence:31});assert.equal(response.status,200);
const automaticCapture=await response.json();assert.equal(automaticCapture.scaleSequence,31);assert.equal(Number(automaticCapture.capture.grams),300);
const immutableCapture=(await db.query('select * from store_relay_scale_captures where id=$1',[automaticCapture.capture.id])).rows[0];
assert.equal(immutableCapture.session_id,automaticScale);assert.equal(immutableCapture.reading.scaleSequence,31);
assert.equal((await operator({action:'scaleStart',scaleSession:successorScale})).status,200);
assert.equal((await sendReading({scaleSession:successorScale,sequence:1,line:'ST,+000320.0  g\r\n'})).status,200);
response=await operator({action:'scaleAdopt',scaleSession:automaticScale,scaleSequence:31});assert.equal(response.status,200);
assert.deepEqual((await response.json()).capture,automaticCapture.capture,'A lost capture response can be retried without creating a second capture.');
assert.deepEqual((await db.query('select * from store_relay_scale_captures where id=$1',[automaticCapture.capture.id])).rows[0],immutableCapture,'Capture retries cannot change its weight or timestamp.');
assert.equal((await operator({action:'scaleAdopt',scaleSession:automaticScale,scaleSequence:32})).status,409);
assert.equal((await operator({action:'scaleStart',scaleSession:automaticScale})).status,409,'A captured session cannot be revived.');
response=await operator({action:'scaleEnd',scaleSession:automaticScale});assert.equal(response.status,200);assert.equal((await response.json()).ended,false);
assert.equal((await db.query('select scale_session from store_relay_stations where id=$1',[stationId])).rows[0].scale_session,successorScale,'Late adoption retries and cleanup cannot stop the newer bowl.');
// Expected-session replacement is explicit and rejects an obsolete expectation.
const replacementScale=uuid(305);
assert.equal((await operator({action:'scaleStart',scaleSession:replacementScale,expectedScaleSession:automaticScale})).status,409);
assert.equal((await operator({action:'scaleStart',scaleSession:replacementScale,expectedScaleSession:successorScale})).status,200);
assert.equal((await operator({action:'scaleStart',scaleSession:successorScale,expectedScaleSession:replacementScale})).status,409,'A replaced session cannot be revived by an old retry.');
assert.equal((await operator({action:'scaleEnd',scaleSession:replacementScale})).status,200);
assert.equal((await operator({action:'scaleStart',scaleSession:replacementScale})).status,409);
const concurrentScales=[uuid(306),uuid(307)];
const scaleStarts=await Promise.all(concurrentScales.map(scaleSession=>operator({action:'scaleStart',scaleSession})));
assert.deepEqual(scaleStarts.map(r=>r.status).sort(),[200,409],'Two different automatic starts cannot both acquire a session.');
const activeAutomatic=(await db.query('select scale_session from store_relay_stations where id=$1',[stationId])).rows[0].scale_session;
const originalSession=session;session={...session,sessionId:uuid(308)};
assert.equal((await operator({action:'scaleEnd',scaleSession:activeAutomatic})).status,409);
assert.equal((await operator({action:'scaleAdopt',scaleSession:automaticScale,scaleSequence:31})).status,409,'A capture retry still requires the original cashier browser session.');
session=originalSession;
assert.equal((await request(relay,{action:'scaleStart',storeId:ids.other,owner,scaleSession:uuid(309)})).status,403);
assert.equal((await operator({action:'scaleEnd',scaleSession:activeAutomatic})).status,200);
// Loss of the real scale connection clears the previous candidate and independently gates adoption.
const nextScale=await (await operator({action:'scaleStart'})).json();assert.ok(nextScale.scaleSession);
const nextReading=patch=>sendReading({scaleSession:nextScale.scaleSession,epoch:owner.epoch,...patch});
assert.equal((await callAgent({action:'heartbeat',status:{scale:'connected'}})).status,200);
assert.equal((await nextReading({sequence:10,line:'ST,+000300.0  g\r\n'})).status,200);
for(const scale of ['disconnected','connecting','not_configured','specification_required','error']){
  // A cached stable candidate must not survive a device-authenticated non-connected heartbeat.
  await db.query(`update store_relay_stations set scale_reading='{"grams":300,"stable":true,"overload":false}'::jsonb,scale_received_at=now() where id=$1`,[stationId]);
  assert.equal((await callAgent({action:'heartbeat',status:{scale}})).status,200);
  scaleRow=(await db.query('select scale_reading,scale_received_at from store_relay_stations where id=$1',[stationId])).rows[0];
  assert.equal(scaleRow.scale_reading,null);assert.equal(scaleRow.scale_received_at,null);
  assert.equal((await operator({action:'scaleAdopt',scaleSession:nextScale.scaleSession})).status,409);
}
// Even a fresh row cannot bypass the independent authenticated connection-status check.
await db.query(`update store_relay_stations set scale_reading='{"grams":300,"stable":true,"overload":false}'::jsonb,scale_received_at=now() where id=$1`,[stationId]);
assert.equal((await operator({action:'scaleAdopt',scaleSession:nextScale.scaleSession})).status,409);
assert.equal((await callAgent({action:'heartbeat',status:{scale:'connected'}})).status,200);
assert.equal((await nextReading({sequence:20,line:'ST,+000300.0  g\r\n'})).status,200);
// An expired cashier must not expose a scale session to the agent or accept/adopt new measurements.
await db.query("update store_relay_stations set owner_until=now()-interval '1 second' where id=$1",[stationId]);
const expiredHeartbeat=await (await callAgent({action:'heartbeat',status:{scale:'connected'}})).json();
assert.equal(expiredHeartbeat.station.id,stationId);assert.equal(expiredHeartbeat.station.store_id,ids.store);
assert.equal(expiredHeartbeat.station.scale_session,null);
assert.equal((await db.query('select scale_reading from store_relay_stations where id=$1',[stationId])).rows[0].scale_reading,null);
assert.equal((await nextReading({sequence:21,line:'ST,+000300.0  g\r\n'})).status,409);
assert.equal((await operator({action:'scaleAdopt',scaleSession:nextScale.scaleSession})).status,409);
const regained=await request(relay,{action:'takeover',storeId:ids.store,stationId,epoch:owner.epoch});assert.equal(regained.status,200);
owner=(await regained.json()).owner;
const resetHeartbeat=await (await callAgent({action:'heartbeat',status:{scale:'connected'}})).json();assert.equal(resetHeartbeat.station.scale_session,null);
// Remembered cashier rights resume only for the same authenticated credential.
{
  const resumeChecks=[];
  const pass=message=>{resumeChecks.push(message);console.log(`PASS cashier resume: ${message}`);};
  const resumeRow=async()=>(await db.query('select * from store_relay_stations where id=$1',[stationId])).rows[0];
  const savedOwner={...owner};
  const resumeCaptureSession=uuid(91001);
  assert.equal((await operator({action:'scaleStart',scaleSession:resumeCaptureSession})).status,200);
  assert.equal((await callAgent({action:'reading',scaleSession:resumeCaptureSession,epoch:owner.epoch,sequence:1,line:'ST,+000300.0  g\r\n',measuredAt:Date.now()})).status,200);
  const captureResponse=await operator({action:'scaleAdopt',scaleSession:resumeCaptureSession,scaleSequence:1});
  assert.equal(captureResponse.status,200,await captureResponse.clone().text());
  const resumeCapture=(await captureResponse.json()).capture;
  const savedCapture=(await db.query('select * from store_relay_scale_captures where id=$1',[resumeCapture.id])).rows[0];
  let liveCounter=91010;
  const seedLive=async()=>{
    const liveSession=uuid(liveCounter++),previous=(await resumeRow()).scale_session;
    const started=await operator({action:'scaleStart',scaleSession:liveSession,expectedScaleSession:previous});
    assert.equal(started.status,200,await started.clone().text());
    await db.query(`update store_relay_stations set scale_tare_context='{"sentinel":"tare"}'::jsonb,
      scale_filter_state='{"sentinel":"filter"}'::jsonb,scale_sequence=55,
      scale_reading='{"grams":300,"stable":true,"overload":false}'::jsonb,scale_received_at=clock_timestamp() where id=$1`,[stationId]);
    return liveSession;
  };
  const liveFields=row=>({session:row.scale_session,tare:row.scale_tare_context,filter:row.scale_filter_state,
    sequence:row.scale_sequence,reading:row.scale_reading,receivedAt:row.scale_received_at});
  const assertCleared=row=>{
    assert.equal(row.scale_session,null);assert.deepEqual(row.scale_tare_context,{});assert.deepEqual(row.scale_filter_state,{});
    assert.equal(Number(row.scale_sequence),-1);assert.equal(row.scale_reading,null);assert.equal(row.scale_received_at,null);
    assert.equal(row.epoch,savedOwner.epoch);assert.equal(row.owner_hash,modules['store-relay'].relayHash(savedOwner.token));
  };
  const firstLive=await seedLive();
  const activeSnapshot=liveFields(await resumeRow());
  for(const action of ['resume','heartbeat']){
    const renewed=await operator({action});assert.equal(renewed.status,200);
    const result=await renewed.json();assert.equal(result.resumed,false);
    assert.ok(Date.parse(result.ownerUntil)>Date.now()+44000);
    assert.deepEqual(liveFields(await resumeRow()),activeSnapshot);
  }
  pass('active resume and heartbeat renew the lease without changing live weighing evidence');
  await db.query("update store_relay_stations set owner_until=clock_timestamp()-interval '1 second' where id=$1",[stationId]);
  assert.equal((await operator({action:'scaleAdopt',scaleSession:firstLive})).status,409);
  assert.equal((await operator({action:'scaleStart',scaleSession:uuid(91002),expectedScaleSession:firstLive})).status,409);
  const expiredSnapshot=await resumeRow(),login=session;
  for(const badOwner of [{...owner,token:'invalid'},{...owner,epoch:owner.epoch+1},{...owner,stationId:uuid(91999)},
    {...owner,token:null},{...owner,epoch:'1'}]){
    assert.equal((await request(relay,{action:'resume',storeId:ids.store,owner:badOwner})).status,409);
  }
  session={...login,sessionId:uuid(91003)};assert.equal((await operator({action:'resume'})).status,409);
  session={...login,id:uuid(91004)};assert.equal((await operator({action:'resume'})).status,409);
  session={...login,role:'staff'};assert.equal((await operator({action:'resume'})).status,403);
  session=null;assert.equal((await operator({action:'resume'})).status,401);session=login;
  assert.equal((await request(relay,{action:'resume',storeId:ids.other,owner})).status,403);
  const crossOrigin=new Request('http://test/api',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://elsewhere'},
    body:JSON.stringify({action:'resume',storeId:ids.store,owner})});
  assert.equal((await relay.POST(crossOrigin)).status,403);
  assert.deepEqual(await resumeRow(),expiredSnapshot,'Denied resumes never renew or mutate weighing evidence.');
  await db.query('update store_relay_stations set enabled=false where id=$1',[stationId]);
  for(const action of ['resume','heartbeat'])assert.equal((await operator({action})).status,409);
  await db.query('update store_relay_stations set enabled=true where id=$1',[stationId]);
  pass('expired ordinary actions, wrong token/epoch/station/login/employee/store/origin, disabled station and unauthorized accounts remain denied');
  const resumed=await operator({action:'resume'});assert.equal(resumed.status,200);assert.equal((await resumed.json()).resumed,true);
  assertCleared(await resumeRow());
  assert.equal((await callAgent({action:'reading',scaleSession:firstLive,epoch:owner.epoch,sequence:56,line:'ST,+000300.0  g\r\n',measuredAt:Date.now()})).status,409);
  assert.equal((await operator({action:'scaleStart',scaleSession:firstLive})).status,409,'An old start retry cannot revive the retired pre-sleep weighing session.');
  assert.equal((await operator({action:'scaleAdopt',scaleSession:firstLive})).status,409);
  assert.deepEqual((await db.query('select * from store_relay_scale_captures where id=$1',[resumeCapture.id])).rows[0],savedCapture);
  const recoveredSale=await checkout({offlineClientOrderId:uuid(91005),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:300,scaleCaptureId:resumeCapture.id}]});
  assert.equal(recoveredSale.status,200,await recoveredSale.clone().text());
  assert.ok((await db.query('select order_id from store_relay_scale_captures where id=$1',[resumeCapture.id])).rows[0].order_id);
  pass('expired resume clears live sessions and late frames while preserving the epoch and immutable cart capture for checkout');
  await seedLive();
  await db.query("update store_relay_stations set owner_until=clock_timestamp()+interval '100 milliseconds' where id=$1",[stationId]);
  resumeDelayMs=200;
  const delayedResume=await operator({action:'heartbeat'});assert.equal(delayedResume.status,200);assert.equal((await delayedResume.json()).resumed,true);
  assertCleared(await resumeRow());
  pass('lease expiry during transaction delay uses wall clock, clears all live evidence and renews from the actual update time');
  await seedLive();await db.query("update store_relay_stations set owner_until=clock_timestamp()-interval '1 second' where id=$1",[stationId]);
  const replacedOwner={...owner};
  resumeBeforeTransactionRace=async()=>{
    const takeover=await request(relay,{action:'takeover',storeId:ids.store,stationId,epoch:replacedOwner.epoch});
    assert.equal(takeover.status,200);owner=(await takeover.json()).owner;
  };
  assert.equal((await request(relay,{action:'resume',storeId:ids.store,owner:replacedOwner})).status,409);
  assert.equal((await request(relay,{action:'heartbeat',storeId:ids.store,owner:replacedOwner})).status,409);
  assert.equal((await resumeRow()).epoch,owner.epoch);assert.equal((await operator({action:'resume'})).status,200);
  pass('a takeover completed while recovery is pending fences both resume and heartbeat from the replaced device');
  const competingOwner={...owner};
  const race=await Promise.all([request(relay,{action:'resume',storeId:ids.store,owner:competingOwner}),
    request(relay,{action:'takeover',storeId:ids.store,stationId,epoch:competingOwner.epoch})]);
  assert.equal(race[1].status,200);assert.ok([200,409].includes(race[0].status));owner=(await race[1].json()).owner;
  assert.equal((await request(relay,{action:'resume',storeId:ids.store,owner:competingOwner})).status,409);
  assert.equal((await resumeRow()).owner_hash,modules['store-relay'].relayHash(owner.token));
  pass('concurrent resume and takeover leave only the successor credential able to operate');
  const resumeOutput=new URL('outputs/store-cashier-memory-20261018/db/',root);mkdirSync(resumeOutput,{recursive:true});
  writeFileSync(new URL('verification.json',resumeOutput),JSON.stringify({passed:true,groups:resumeChecks.length,checks:resumeChecks,
    productionAccess:false,schemaChanges:false,realMultiConnectionLockTest:false},null,2)+'\n');
}
assert.equal((await relay.GET(new Request(`http://test/api?storeId=${ids.other}`))).status,403);
const beforeClockDenial=session;
session=null;
let deniedClockResponse=await relay.GET(new Request(`http://test/api?storeId=${ids.store}`));assert.equal(deniedClockResponse.status,401);let deniedClock=await deniedClockResponse.json();assert.equal(deniedClock.serverNow,undefined);assert.equal(deniedClock.serverElapsedMs,undefined);
session={...beforeClockDenial,role:'staff'};
deniedClockResponse=await relay.GET(new Request(`http://test/api?storeId=${ids.store}`));assert.equal(deniedClockResponse.status,403);deniedClock=await deniedClockResponse.json();assert.equal(deniedClock.serverNow,undefined);assert.equal(deniedClock.serverElapsedMs,undefined);
session=beforeClockDenial;
console.log('PASS relay server-clock response preserves login, role and store access denial');
assert.equal((await adminPost({action:'testPrint',stationId})).status,200);
assert.equal((await db.query("select payload from store_relay_print_jobs where kind='test'")).rows[0].payload.printer.openCashDrawer,false);
assert.equal((await adminPost({action:'revoke',stationId})).status,200);
assert.equal((await callAgent({action:'heartbeat'})).status,401);
// Numeric pairing preserves leading zeroes and requires an explicit scoped register.
const generateCode=modules['store-relay'].relayPairingCode;
modules['store-relay'].relayPairingCode=()=> '012345';
const issueCode=async()=>{
  const previousRole=session.role;session.role='store_manager';
  try {const response=await adminPost({action:'pair',stationId});assert.equal(response.status,200);return (await response.json()).pairingCode;}
  finally {session.role=previousRole;}
};
const pair=code=>request(relay,{action:'pair',storeId:ids.store,stationId,code});
const failureCount=async()=>Number((await db.query("select count(*) as n from store_relay_events where station_id=$1 and kind='pair_failed'",[stationId])).rows[0].n);
const manualCode=await issueCode();assert.equal(manualCode,'012345');
session.role='store_terminal';
assert.equal((await adminPost({action:'pair',stationId})).status,403);
const attemptsBefore=await failureCount();
for(const code of ['12345','1234567','abcdef',123456])assert.equal((await pair(code)).status,400);
assert.equal((await request(relay,{action:'pair',storeId:ids.store,code:manualCode})).status,400);
assert.equal((await request(relay,{action:'pair',storeId:ids.other,stationId,code:manualCode})).status,403);
assert.equal(await failureCount(),attemptsBefore);
for(let i=0;i<4;i++)assert.equal((await pair('999999')).status,409);
const manualPair=await pair(manualCode);assert.equal(manualPair.status,200);
assert.match((await manualPair.json()).token,/^[A-Za-z0-9_-]{43}$/);
assert.equal((await pair(manualCode)).status,409);
// A newly issued generation resets failures even when random digits repeat.
await issueCode();
const concurrent=await Promise.all([pair('012345'),pair('012345')]);
assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,409]);
await issueCode();
const beforeLockout=await failureCount();
const wrongAttempts=await Promise.all(Array.from({length:10},()=>pair('999999')));
assert.deepEqual(wrongAttempts.map(response=>response.status).sort(),[409,409,409,409,429,429,429,429,429,429]);
assert.equal(await failureCount(),beforeLockout+5);
assert.equal((await pair('012345')).status,429);
assert.equal((await db.query('select token_hash from store_relay_devices where station_id=$1',[stationId])).rows[0].token_hash,'');
// Switching valid accounts does not reset a register's locked generation.
const firstSession=session;
await db.query('insert into employees(id,name,role) values($1,$2,$3)',[uuid(8),'Second manager','store_manager']);
session={...session,id:uuid(8),role:'store_manager'};
assert.equal((await pair('012345')).status,429);
assert.equal(await issueCode(),'012345');
assert.equal((await pair('012345')).status,200);
session=firstSession;
// Expiry is checked against wall time after waiting in the transaction.
await issueCode();
await db.query("update store_relay_devices set pairing_until=clock_timestamp()+interval '100 milliseconds' where station_id=$1",[stationId]);
pairingDelayMs=200;assert.equal((await pair('012345')).status,409);
// Old long codes keep their remaining lifetime and old no-station protocol only.
const legacyCode='L'.repeat(43);await issueCode();
await db.query('update store_relay_devices set pairing_hash=$1 where station_id=$2',[modules['store-relay'].relayHash(legacyCode),stationId]);
const legacy=await request(relay,{action:'pair',storeId:ids.store,code:legacyCode});
assert.equal(legacy.status,200);assert.equal((await legacy.json()).stationId,stationId);
await issueCode();
await db.query("update store_relay_devices set pairing_hash=$1,pairing_until=now()-interval '1 second' where station_id=$2",[modules['store-relay'].relayHash(legacyCode),stationId]);
assert.equal((await request(relay,{action:'pair',storeId:ids.store,code:legacyCode})).status,409);
modules['store-relay'].relayPairingCode=generateCode;
const pairingAudit=(await db.query("select detail from store_relay_events where kind in ('pair','pair_failed')")).rows;
assert.ok(pairingAudit.every(event=>!JSON.stringify(event.detail).includes('012345')));
assert.equal((await (await modules['store-relay'].relayStations(ids.other))).length,0);
session=null;assert.equal((await operator({action:'heartbeat'})).status,401);

// Exercise the actual refund, operator and agent handlers against the same data.
session={id:ids.employee,name:'Tester',role:'store_manager',sessionId:uuid(7),sessionVersion:1};
await adminPost({action:'save',stationId,name:'レジ A',enabled:true,printEnabled:true,scaleEnabled:true});
const refundCode=(await (await adminPost({action:'pair',stationId})).json()).pairingCode;
const refundToken=(await (await request(relay,{action:'pair',storeId:ids.store,stationId,code:refundCode})).json()).token;
const refundAgent=body=>request(agent,body,refundToken);
await refundAgent({action:'heartbeat'});
config=(await modules['store-relay'].relayStations(ids.store))[0];
owner=(await (await request(relay,{action:'claim',storeId:ids.store,stationId,epoch:config.epoch})).json()).owner;
const refundOrder=(orderId,patch={})=>request(refunds,{storeId:ids.store,orderId,...patch});
let refundSaleCounter=22000;
async function newRefundSale(){
  await db.query("update store_relay_print_jobs set state='cancelled',claim_token=null");
  await refundAgent({action:'heartbeat'});
  const response=await checkout({offlineClientOrderId:uuid(refundSaleCounter++)});
  assert.equal(response.status,200);return response.json();
}
const saleJobs=async orderId=>(await db.query('select * from store_relay_print_jobs where order_id=$1 order by sequence',[orderId])).rows;
const jobList=async orderId=>(await (await relay.GET(new Request(`http://test/api?storeId=${ids.store}&orderId=${orderId}`))).json()).jobs;
async function ackJob(job){assert.equal((await refundAgent({action:'ack',jobId:job.id,claimToken:job.claim_token,result:'sent'})).status,200);}
const financialSnapshot=payload=>({total:payload.order.totalAmount,subtotal:payload.order.subtotalAmount,tax:payload.order.taxAmount,
  discount:payload.order.discountAmount,coupon:payload.order.couponDiscountAmount,items:payload.order.items});

const partialSale=await newRefundSale();
const originalJobs=await saleJobs(partialSale.orderId),originalReceipt=originalJobs.at(-1).payload;
assert.equal((await refundOrder(partialSale.orderId,{itemId:partialSale.servingTickets[0].itemId})).status,200);
const afterPartial=await saleJobs(partialSale.orderId);
assert.deepEqual(afterPartial.map(job=>job.state),['cancelled','cancelled','cancelled','pending','pending','pending','pending']);
assert.deepEqual(afterPartial.map(job=>job.payload),originalJobs.map(job=>job.payload),'Refunds never rewrite persisted ticket snapshots.');
let refundList=await jobList(partialSale.orderId);
assert.deepEqual(refundList.slice(0,3).map(job=>job.refundDisposition),['partial_refunded','partial_refunded','partial_refunded']);
assert.ok(refundList.some(job=>job.documentRole==='finishing'));
assert.equal(refundList.find(job=>job.kind==='receipt').receiptHasRefund,true);
assert.equal(refundList.find(job=>job.id===originalJobs[0].id).refundDisposition,'refunded');
const remainingSent=[];
for(let index=0;index<4;index++){
  const job=(await (await refundAgent({action:'claim'})).json()).job;assert.ok(job);remainingSent.push(job);
  if(index<3)assert.equal(job.payload.order.pickupCode,partialSale.servingTickets[1].pickupCode);
  else {
    assert.match(job.payload.order.receiptTitle,/返金前.*一部返金/);
    assert.equal(job.payload.printer.openCashDrawer,false);
    assert.deepEqual(financialSnapshot(job.payload),financialSnapshot(originalReceipt));
  }
  await ackJob(job);
}
assert.equal((await (await refundAgent({action:'claim'})).json()).job,null);
assert.equal((await operator({action:'reprint',jobId:remainingSent[0].id})).status,200,'The unrefunded bowl can be reprinted.');
await db.query("update store_relay_print_jobs set state='sent' where id=$1",[originalJobs[0].id]);
assert.equal((await operator({action:'reprint',jobId:originalJobs[0].id})).status,409,'A previously sent refunded bowl cannot be reprinted.');
assert.deepEqual((await db.query('select payload from store_relay_print_jobs where id=$1',[originalJobs.at(-1).id])).rows[0].payload,originalReceipt);

const voidSale=await newRefundSale();
const inFlight=(await (await refundAgent({action:'claim'})).json()).job;assert.ok(inFlight);
assert.equal((await refundOrder(voidSale.orderId)).status,200);
assert.equal((await saleJobs(voidSale.orderId)).filter(job=>job.state==='cancelled').length,6);
assert.equal((await operator({action:'voidRefunded',jobId:inFlight.id})).status,400);
assert.equal((await operator({action:'voidRefunded',jobId:inFlight.id,confirmed:true})).status,409,'An active sender must finish or time out first.');
const laterSaleResponse=await checkout({offlineClientOrderId:uuid(refundSaleCounter++)});assert.equal(laterSaleResponse.status,200);const laterSale=await laterSaleResponse.json();
assert.equal((await (await refundAgent({action:'claim'})).json()).job,null,'An unresolved physical send still blocks later orders.');
await db.query("update store_relay_print_jobs set claimed_at=clock_timestamp()-interval '3 minutes' where id=$1",[inFlight.id]);
assert.equal((await jobList(voidSale.orderId)).find(job=>job.id===inFlight.id).voidEligible,true);
assert.equal((await request(relay,{storeId:ids.other,owner,action:'voidRefunded',jobId:inFlight.id,confirmed:true})).status,403);
assert.equal((await request(relay,{storeId:ids.store,owner:{...owner,token:'wrong'},action:'voidRefunded',jobId:inFlight.id,confirmed:true})).status,409);
const oldSession=session;session=null;assert.equal((await operator({action:'voidRefunded',jobId:inFlight.id,confirmed:true})).status,401);session=oldSession;
assert.equal((await operator({action:'voidRefunded',jobId:inFlight.id,confirmed:true})).status,200);
assert.equal((await operator({action:'voidRefunded',jobId:inFlight.id,confirmed:true})).status,409);
const voidEvents=(await db.query("select detail from store_relay_events where kind='voidRefunded' and detail->>'jobId'=$1",[inFlight.id])).rows;
assert.equal(voidEvents.length,1);assert.equal(voidEvents[0].detail.confirmed,true);
assert.equal((await refundAgent({action:'ack',jobId:inFlight.id,claimToken:inFlight.claim_token,result:'sent'})).status,409,'Manual void fences late device results.');
const resumed=(await (await refundAgent({action:'claim'})).json()).job;
assert.equal((await db.query('select order_id from store_relay_print_jobs where id=$1',[resumed.id])).rows[0].order_id,laterSale.orderId);
assert.equal((await operator({action:'voidRefunded',jobId:resumed.id,confirmed:true})).status,409,'A live unrefunded job cannot be voided.');

const racedSale=await newRefundSale();
let releaseRefundReads;refundBarrier={waiting:0,promise:new Promise(resolve=>{releaseRefundReads=resolve;}),resolve:()=>releaseRefundReads()};
const duplicateRefunds=await Promise.all([refundOrder(racedSale.orderId,{itemId:racedSale.servingTickets[0].itemId}),refundOrder(racedSale.orderId,{itemId:racedSale.servingTickets[0].itemId})]);
refundBarrier=null;
assert.deepEqual(duplicateRefunds.map(response=>response.status).sort(),[200,409]);
assert.equal((await db.query('select amount from store_customer_orders where id=$1',[racedSale.orderId])).rows[0].amount,1200,'A duplicate refund cannot deduct twice.');

const rollbackSale=await newRefundSale();
failRefundCancel=true;await assert.rejects(()=>refundOrder(rollbackSale.orderId,{itemId:rollbackSale.servingTickets[0].itemId}),/simulated refund cancellation failure/);failRefundCancel=false;
const rolledBack=(await db.query('select amount,payment_status from store_customer_orders where id=$1',[rollbackSale.orderId])).rows[0];
assert.equal(rolledBack.amount,2400);assert.equal(rolledBack.payment_status,'paid');
assert.equal((await db.query("select count(*)::int as n from store_customer_order_items where order_id=$1 and refund_status='refunded'",[rollbackSale.orderId])).rows[0].n,0);
assert.ok((await saleJobs(rollbackSale.orderId)).every(job=>job.state==='pending'));

const claimRaceSale=await newRefundSale();
const [raceClaim,raceRefund]=await Promise.all([refundAgent({action:'claim'}),refundOrder(claimRaceSale.orderId,{itemId:claimRaceSale.servingTickets[0].itemId})]);
assert.equal(raceClaim.status,200);assert.equal(raceRefund.status,200);
const racedJobs=await saleJobs(claimRaceSale.orderId);
assert.ok(racedJobs.filter(job=>job.payload.order.pickupCode===claimRaceSale.servingTickets[0].pickupCode).every(job=>job.state==='cancelled'||job.state==='sending'));
assert.equal(racedJobs.filter(job=>job.payload.order.pickupCode===claimRaceSale.servingTickets[0].pickupCode&&job.state==='sending').length<=1,true);
const orphan=(await raceClaim.json()).job;if(orphan)await ackJob(orphan);
const afterClaimRace=(await (await refundAgent({action:'claim'})).json()).job;
assert.equal(afterClaimRace.payload.order.pickupCode,claimRaceSale.servingTickets[1].pickupCode);

const pendingRefundSale=await newRefundSale();
const pendingRefundJobs=await saleJobs(pendingRefundSale.orderId);
await db.query("update store_customer_orders set status='refund_pending' where id=$1",[pendingRefundSale.orderId]);
await db.query("update store_relay_print_jobs set state='uncertain' where id=$1",[pendingRefundJobs[0].id]);
assert.equal((await (await refundAgent({action:'claim'})).json()).job,null);
assert.equal((await saleJobs(pendingRefundSale.orderId)).filter(job=>job.state==='pending').length,6,'A requested refund is not a completed refund and must not auto-cancel.');
const pendingRefundView=(await jobList(pendingRefundSale.orderId)).find(job=>job.id===pendingRefundJobs[0].id);
assert.equal(pendingRefundView.voidEligible,false);assert.equal(pendingRefundView.reprintEligible,false);
assert.equal((await operator({action:'voidRefunded',jobId:pendingRefundJobs[0].id,confirmed:true})).status,409);

const uncertainRefundSale=await newRefundSale();
const uncertainRefundJob=(await (await refundAgent({action:'claim'})).json()).job;
assert.equal((await refundAgent({action:'ack',jobId:uncertainRefundJob.id,claimToken:uncertainRefundJob.claim_token,result:'uncertain'})).status,200);
assert.equal((await refundOrder(uncertainRefundSale.orderId,{itemId:uncertainRefundSale.servingTickets[0].itemId})).status,200);
assert.equal((await operator({action:'voidRefunded',jobId:uncertainRefundJob.id,confirmed:true})).status,200);
assert.equal((await (await refundAgent({action:'claim'})).json()).job.payload.order.pickupCode,uncertainRefundSale.servingTickets[1].pickupCode);

const reprintRaceSale=await newRefundSale();
const sentBeforeRefund=(await (await refundAgent({action:'claim'})).json()).job;await ackJob(sentBeforeRefund);
const [racedReprint,racedRefund]=await Promise.all([operator({action:'reprint',jobId:sentBeforeRefund.id}),
  refundOrder(reprintRaceSale.orderId,{itemId:reprintRaceSale.servingTickets[0].itemId})]);
assert.ok([200,409].includes(racedReprint.status));assert.equal(racedRefund.status,200);
assert.equal((await saleJobs(reprintRaceSale.orderId)).filter(job=>job.payload.order.pickupCode===reprintRaceSale.servingTickets[0].pickupCode&&job.state==='pending').length,0);
assert.equal((await (await refundAgent({action:'claim'})).json()).job.payload.order.pickupCode,reprintRaceSale.servingTickets[1].pickupCode);

const fullRollbackSale=await newRefundSale();
failRefundCancel=true;await assert.rejects(()=>refundOrder(fullRollbackSale.orderId),/simulated refund cancellation failure/);failRefundCancel=false;
assert.equal((await db.query('select payment_status from store_customer_orders where id=$1',[fullRollbackSale.orderId])).rows[0].payment_status,'paid');
assert.ok((await saleJobs(fullRollbackSale.orderId)).every(job=>job.state==='pending'));
console.log('PASS refund/relay actual handlers: partial refund remaining-bowl prints and reprints; refunded bowls fenced; immutable financial snapshots and labelled original receipt; full-refund pending cancellation; active-send/no-confirm/scope/owner denial; timed-out and sender-acknowledged uncertain explicit audited void; late ACK fenced and next order resumes; duplicate refund guard; partial/full cancellation-failure atomic rollback; claim/refund and reprint/refund ordering; refund_pending is held without cancellation or void. PGlite serializes one connection; cross-connection waits are not claimed.');
// Configured plate tare: real settings, relay and POS handlers; no live services.
const tareHelper=modules['pos-scale-tare'];
assert.deepEqual(JSON.parse(JSON.stringify(tareHelper.defaultPosScaleTareSettings())),{enabled:false,revision:'',presets:[{id:'small',grams:null},{id:'large',grams:null}]});
const tareConfig=(small=100,large=180.5,enabled=true)=>({enabled,presets:[{id:'small',grams:small},{id:'large',grams:large}]});
for(const bad of [0,-1,3000.1,100.01,'100','',NaN,Infinity])assert.ok(tareHelper.validatePosScaleTareSettings(tareConfig(bad)).error);
assert.ok(tareHelper.validatePosScaleTareSettings(tareConfig(null)).error);
assert.ok(!tareHelper.validatePosScaleTareSettings(tareConfig(null,null,false)).error);
assert.equal(tareHelper.normalizePosScaleTareSettings({enabled:true,presets:[]}).enabled,true,'Malformed enabled data must not silently return to gross-as-net.');
const saveTare=(config,patch={})=>request(posSettingsAdmin,{storeId:ids.store,section:'tare',scaleTareSettings:config,...patch});
const oldPrinter=(await db.query('select printer_settings from pos_store_settings where store_id=$1',[ids.store])).rows[0].printer_settings;
response=await saveTare(tareConfig());assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
let tareSaved=(await response.json()).settings.scaleTareSettings;assert.ok(tareSaved.revision);assert.equal(tareSaved.presets[0].grams,100);
assert.deepEqual((await db.query('select printer_settings from pos_store_settings where store_id=$1',[ids.store])).rows[0].printer_settings,oldPrinter,'Tare-only changes preserve printer settings.');
response=await saveTare(tareConfig());assert.equal(response.status,200);assert.equal((await response.json()).settings.scaleTareSettings.revision,tareSaved.revision,'Unchanged tare saves retain revision.');
response=await request(posSettingsAdmin,{storeId:ids.store,printerSettings:oldPrinter});assert.equal(response.status,200);
assert.equal((await response.json()).settings.scaleTareSettings.revision,tareSaved.revision,'Old/unrelated settings clients preserve tare config.');
session.role='store_terminal';assert.equal((await saveTare(tareConfig())).status,403);session.role='store_manager';
assert.equal((await saveTare(tareConfig(),{storeId:ids.other})).status,400);
assert.equal((await saveTare(tareConfig(null))).status,400);
await operator({action:'heartbeat'});
const presetSession=uuid(51000);
await refundAgent({action:'heartbeat',status:{scale:'connected'}});
assert.equal((await operator({action:'scaleStart',scaleSession:presetSession,tarePresetId:'small'})).status,409,'Old native apps cannot provide gross proof.');
await refundAgent({action:'heartbeat',status:{scale:'connected',scaleTareVersion:1}});
assert.equal((await operator({action:'scaleStart',scaleSession:presetSession})).status,409);
assert.equal((await operator({action:'scaleStart',scaleSession:presetSession,tarePresetId:'unknown'})).status,409);
response=await operator({action:'scaleStart',scaleSession:presetSession,tarePresetId:'small'});assert.equal(response.status,200);
const presetContext=(await response.json()).scaleTareContext;assert.equal(presetContext.mode,'preset');assert.equal(presetContext.tareGrams,100);assert.match(presetContext.token,/^[a-f0-9-]{36}$/);
response=await operator({action:'scaleStart',scaleSession:presetSession,tarePresetId:'small'});assert.equal(response.status,200);assert.deepEqual((await response.json()).scaleTareContext,presetContext);
assert.equal((await operator({action:'scaleStart',scaleSession:presetSession,tarePresetId:'large'})).status,409);
const presetReading=patch=>refundAgent({action:'reading',scaleSession:presetSession,epoch:owner.epoch,sequence:1,line:'ST,+000600.0  g\r\n',measuredAt:Date.now(),...patch});
assert.equal((await presetReading({})).status,409);
assert.equal((await presetReading({tareToken:uuid(51001)})).status,409);
assert.equal((await presetReading({tareToken:presetContext.token,tareGrams:999,grams:1})).status,200);
let tareReading=(await db.query('select scale_reading from store_relay_stations where id=$1',[stationId])).rows[0].scale_reading;
assert.equal(tareReading.grams,500);assert.equal(tareReading.grossGrams,600);assert.equal(tareReading.tareGrams,100);assert.equal(tareReading.tarePresetId,'small');
response=await operator({action:'scaleAdopt',scaleSession:presetSession,scaleSequence:1});assert.equal(response.status,200);
const tareCapture=(await response.json()).capture;
assert.equal(Number(tareCapture.grams),500);assert.deepEqual(tareCapture.weightMeasurement,{mode:'preset',grossGrams:600,tareGrams:100,netGrams:500,tarePresetId:'small',settingsRevision:tareSaved.revision});
assert.deepEqual((await db.query('select scale_tare_context from store_relay_stations where id=$1',[stationId])).rows[0].scale_tare_context,{});
const nextPresetSession=uuid(51002);
response=await operator({action:'scaleStart',scaleSession:nextPresetSession,tarePresetId:'large'});assert.equal(response.status,200);const nextPresetContext=(await response.json()).scaleTareContext;assert.notEqual(nextPresetContext.token,presetContext.token);
assert.equal((await presetReading({scaleSession:nextPresetSession,tareToken:presetContext.token})).status,409);
response=await operator({action:'scaleAdopt',scaleSession:presetSession,scaleSequence:1});assert.equal(response.status,200);assert.equal((await response.json()).capture.id,tareCapture.id);
assert.equal((await db.query('select scale_session from store_relay_stations where id=$1',[stationId])).rows[0].scale_session,nextPresetSession,'Immutable adoption retry cannot close successor.');
for(const [i,line] of ['ST,+000180.5  g\r\n','ST,+000100.0  g\r\n','US,+000600.0  g\r\n','OL,+000600.0  g\r\n','ST,+003001.0  g\r\n'].entries()){
 assert.equal((await presetReading({scaleSession:nextPresetSession,tareToken:nextPresetContext.token,sequence:i+1,line})).status,200);
 assert.equal((await operator({action:'scaleAdopt',scaleSession:nextPresetSession,scaleSequence:i+1})).status,409,'Nonpositive net, unstable, overload and gross over capacity never adopt.');
}
await refundAgent({action:'heartbeat',status:{scale:'connected'}});
assert.equal((await presetReading({scaleSession:nextPresetSession,tareToken:nextPresetContext.token,sequence:6})).status,409);
await refundAgent({action:'heartbeat',status:{scale:'connected',scaleTareVersion:1}});
assert.equal((await presetReading({scaleSession:nextPresetSession,tareToken:nextPresetContext.token,sequence:6})).status,200);
response=await saveTare(tareConfig(110,190));assert.equal(response.status,200);const revisedTare=(await response.json()).settings.scaleTareSettings;assert.notEqual(revisedTare.revision,tareSaved.revision);
assert.equal((await operator({action:'scaleAdopt',scaleSession:nextPresetSession,scaleSequence:6})).status,409,'Settings changes invalidate an unadopted reading.');
const visibleStation=(await modules['store-relay'].relayStations(ids.store))[0];assert.equal(visibleStation.scale_tare_settings.revision,revisedTare.revision);
await operator({action:'scaleEnd',scaleSession:nextPresetSession});
assert.equal((await operator({action:'scaleStart',scaleSession:nextPresetSession,tarePresetId:'large'})).status,409);
const tareItem={menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:500,scaleCaptureId:tareCapture.id,weightMeasurement:{mode:'preset',grossGrams:999,tareGrams:499,netGrams:500,tarePresetId:'large',settingsRevision:'forged'}};
response=await checkout({offlineClientOrderId:uuid(51003),items:[tareItem]});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const tareSale=await response.json();assert.equal(tareSale.amount,2000);
const storedTare=(await db.query('select weight_measurement,measured_quantity from store_customer_order_items where order_id=$1',[tareSale.orderId])).rows[0];
assert.deepEqual(storedTare.weight_measurement,tareCapture.weightMeasurement);assert.equal(Number(storedTare.measured_quantity),500);
const storedSummary=(await db.query('select customer_summary from store_customer_orders where id=$1',[tareSale.orderId])).rows[0].customer_summary;
assert.deepEqual(storedSummary.items[0].weightMeasurement,tareCapture.weightMeasurement);
assert.equal((await checkout({offlineClientOrderId:uuid(51003),items:[tareItem]})).status,200,'Same checkout request returns the immutable order.');
assert.equal((await checkout({offlineClientOrderId:uuid(51004),items:[tareItem]})).status,409,'Capture is one-use despite forged metadata.');
assert.equal((await checkout({offlineClientOrderId:uuid(51005),items:[{...tareItem,scaleCaptureId:undefined}]})).status,409);
assert.equal((await checkout({offlineClientOrderId:uuid(51006),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:275}]})).status,409,'Ambiguous old clients must reload when preset mode is enabled.');
response=await checkout({offlineClientOrderId:uuid(51007),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:275,weightMeasurement:{mode:'manual_net',tareGrams:999}}]});assert.equal(response.status,200);const manualTareSale=await response.json();assert.equal(manualTareSale.amount,1100);
assert.deepEqual((await db.query('select weight_measurement from store_customer_order_items where order_id=$1',[manualTareSale.orderId])).rows[0].weight_measurement,{mode:'manual_net'});
// Settings changing after the request reads them must roll back capture/order creation.
const racingSession=uuid(51011);
response=await operator({action:'scaleStart',scaleSession:racingSession,tarePresetId:'small'});assert.equal(response.status,200);
const racingContext=(await response.json()).scaleTareContext;
assert.equal((await presetReading({scaleSession:racingSession,tareToken:racingContext.token,sequence:1,line:'ST,+000610.0  g\r\n'})).status,200);
tareRevisionRace=async()=>{assert.equal((await saveTare(tareConfig(120,200))).status,200);};
assert.equal((await operator({action:'scaleAdopt',scaleSession:racingSession,scaleSequence:1})).status,409);
assert.equal(Number((await db.query('select count(*) as n from store_relay_scale_captures where session_id=$1',[racingSession])).rows[0].n),0);
await operator({action:'scaleEnd',scaleSession:racingSession});
const checkoutRaceSession=uuid(51012);
response=await operator({action:'scaleStart',scaleSession:checkoutRaceSession,tarePresetId:'small'});assert.equal(response.status,200);const checkoutRaceContext=(await response.json()).scaleTareContext;
await presetReading({scaleSession:checkoutRaceSession,tareToken:checkoutRaceContext.token,sequence:1,line:'ST,+000620.0  g\r\n'});
response=await operator({action:'scaleAdopt',scaleSession:checkoutRaceSession,scaleSequence:1});assert.equal(response.status,200);const checkoutRaceCapture=(await response.json()).capture;
const checkoutRaceItem={menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:500,scaleCaptureId:checkoutRaceCapture.id};
tareRevisionRace=async()=>{assert.equal((await saveTare(tareConfig(130,210))).status,200);};
assert.equal((await checkout({offlineClientOrderId:uuid(51013),items:[checkoutRaceItem]})).status,409);
assert.equal(Number((await db.query('select count(*) as n from store_customer_orders where offline_client_order_id=$1',[uuid(51013)])).rows[0].n),0,'A raced configuration cannot leave a paid order.');
assert.equal((await db.query('select order_id from store_relay_scale_captures where id=$1',[checkoutRaceCapture.id])).rows[0].order_id,null,'Rollback leaves the immutable capture unconsumed.');
assert.equal((await checkout({offlineClientOrderId:uuid(51013),items:[checkoutRaceItem]})).status,200,'A deliberate retry uses the saved capture snapshot under the fresh current config.');
await saveTare(tareConfig(null,null,false));
assert.equal((await checkout({offlineClientOrderId:uuid(51008),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:275}]})).status,200,'Disabled stores preserve legacy explicit weighing.');
await db.query("update pos_store_settings set scale_tare_settings='{"+'"enabled":true,"revision":"broken","presets":[]'+"}'::jsonb where store_id=$1",[ids.store]);
assert.equal((await operator({action:'scaleStart',scaleSession:uuid(51009),tarePresetId:'small'})).status,409);
assert.equal((await checkout({offlineClientOrderId:uuid(51010),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:275}]})).status,409,'Malformed enabled storage also fences legacy ambiguous weights.');
console.log('PASS tare actual handlers: strict defaults/validation, scoped settings, tare-only/omitted preservation, stable revisions, capability gate, immutable session/context and idempotency, token-fenced authoritative net calculation, nonpositive/US/OL/overcapacity rejection, current-revision adoption, successor safety, capture authority/persistence, one-use checkout, explicit manual-net, disabled compatibility and corrupt-enabled fail-closed.');

// Software filtering is server-owned; native US frames are deliberately exercised.
await saveTare(tareConfig(null,null,false));
await operator({action:'heartbeat'});
const filterConfig=(enabled=true,toleranceGrams=2,settleMs=2000)=>({enabled,toleranceGrams,settleMs});
const saveFilter=(value,patch={})=>request(posSettingsAdmin,{storeId:ids.store,section:'filter',scaleFilterSettings:value,...patch});
for(const bad of [filterConfig(true,0),filterConfig(true,6),filterConfig(true,1.5),filterConfig(true,2,1000),filterConfig(true,2,2500)])assert.equal((await saveFilter(bad)).status,400);
session.role='store_terminal';assert.equal((await saveFilter(filterConfig())).status,403);session.role='store_manager';
assert.equal((await saveFilter(filterConfig(),{storeId:ids.other})).status,400);
const beforeFilterOther=(await db.query('select printer_settings,scale_tare_settings from pos_store_settings where store_id=$1',[ids.store])).rows[0];
response=await saveFilter(filterConfig());assert.equal(response.status,200);const initialFilter=(await response.json()).settings.scaleFilterSettings;assert.ok(initialFilter.revision);
assert.deepEqual((await db.query('select printer_settings,scale_tare_settings from pos_store_settings where store_id=$1',[ids.store])).rows[0],beforeFilterOther);
response=await saveFilter(filterConfig());assert.equal((await response.json()).settings.scaleFilterSettings.revision,initialFilter.revision,'Identical filter settings retain revision.');
response=await request(posSettingsAdmin,{storeId:ids.store,printerSettings:oldPrinter});assert.equal(response.status,200);assert.equal((await response.json()).settings.scaleFilterSettings.revision,initialFilter.revision,'Older unrelated saves preserve filtering.');
assert.equal((await modules['store-relay'].relayStations(ids.store))[0].scale_filter_settings.revision,initialFilter.revision);
await refundAgent({action:'heartbeat',status:{scale:'connected',scaleTareVersion:1}});
let filterSessionCounter=52000;
let filterCurrent;
async function newFilterSession(presetId){
 if(filterCurrent)await operator({action:'scaleEnd',scaleSession:filterCurrent.id});
 const id=uuid(filterSessionCounter++);const result=await operator({action:'scaleStart',scaleSession:id,...(presetId?{tarePresetId:presetId}:{})});assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
 const payload=await result.json();filterCurrent={id,context:payload.scaleTareContext,sequence:0};return filterCurrent;
}
const filterRow=async()=>(await db.query('select scale_session,scale_sequence,scale_reading,scale_filter_state from store_relay_stations where id=$1',[stationId])).rows[0];
async function filterSample(grams,at,patch={}){
 const sequence=++filterCurrent.sequence;
 return refundAgent({action:'reading',scaleSession:filterCurrent.id,epoch:owner.epoch,sequence,measuredAt:at,
  line:`US,${grams<0?'-':'+'}${Math.abs(grams).toFixed(1)}  g\r\n`,...(filterCurrent.context.mode==='preset'?{tareToken:filterCurrent.context.token}:{}),...patch});
}
async function filterWindow(values=[300.2,300.8,300.4],base=Date.now()-2500){
 for(const [i,grams] of values.entries())assert.equal((await filterSample(grams,base+i*1000)).status,200);
 return (await filterRow()).scale_reading;
}
await newFilterSession();
let filtered=await filterWindow();
const migrationWindowBefore=await filterRow();await db.exec(filterMigration);
assert.deepEqual(await filterRow(),migrationWindowBefore,'Repeated additive migration preserves live sample state.');
assert.equal((await db.query('select scale_filter_settings from pos_store_settings where store_id=$1',[ids.store])).rows[0].scale_filter_settings.revision,initialFilter.revision);
assert.equal(filtered.stable,true);assert.equal(filtered.hardwareStable,false);assert.equal(filtered.grams,300);assert.equal(filtered.rawGrams,300.4);assert.equal(filtered.filter.accepted,true);assert.equal(filtered.filter.sampleCount,3);
response=await operator({action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:filterCurrent.sequence});assert.equal(response.status,200);const acceptedFilterCapture=(await response.json()).capture;assert.equal(acceptedFilterCapture.weightMeasurement.mode,'device_net');assert.equal(acceptedFilterCapture.weightMeasurement.hardwareStable,false);assert.equal(acceptedFilterCapture.weightMeasurement.filter.source,'software_window');
await newFilterSession();
let base=Date.now()-2500;
assert.equal((await filterSample(300.2,base,{line:'ST,+300.2  g\r\n',filter:{accepted:true}})).status,200);assert.equal((await filterRow()).scale_reading.stable,false,'Even hardware ST must fill the configured window.');
assert.equal((await operator({action:'scaleAdopt',scaleSession:filterCurrent.id})).status,409);
await filterSample(300.8,base+1000,{line:'ST,+300.8  g\r\n'});await filterSample(300.4,base+2000,{line:'ST,+300.4  g\r\n'});
filtered=(await filterRow()).scale_reading;assert.equal(filtered.stable,true);assert.equal(filtered.hardwareStable,true);
assert.equal((await filterSample(310,base+2100)).status,200);assert.equal((await filterRow()).scale_reading.stable,false,'A spike invalidates the accepted latch immediately.');
for(const line of ['ST,+0.0  g\r\n','ST,-1.0  g\r\n','OL,+300.0  g\r\n']){
 await newFilterSession();await filterWindow();assert.equal((await filterSample(0,Date.now(),{line})).status,200);const row=await filterRow();assert.equal(row.scale_reading.stable,false);assert.deepEqual(row.scale_filter_state,{});
}
await newFilterSession();await filterWindow();
const beforeDuplicate=await filterRow();
assert.equal((await filterSample(300.2,Date.now(),{sequence:beforeDuplicate.scale_sequence,line:'malformed'})).status,409,'A replayed malformed frame cannot clear a newer window.');
assert.equal((await filterSample(300.2,Date.now(),{scaleSession:uuid(52999),line:'malformed'})).status,409,'An old session cannot clear the current window.');
assert.deepEqual((await filterRow()).scale_filter_state,beforeDuplicate.scale_filter_state);
for(const anomaly of ['duplicate_time','backwards_time','stale','future','malformed']){
 await newFilterSession();base=Date.now()-2500;await filterWindow([300.2,300.8,300.4],base);
 const at=anomaly==='duplicate_time'?base+2000:anomaly==='backwards_time'?base+1000:anomaly==='stale'?Date.now()-6000:anomaly==='future'?Date.now()+5000:Date.now();
 const invalid=await filterSample(300.2,at,anomaly==='malformed'?{line:'malformed'}:{});
 assert.equal(invalid.status,anomaly==='malformed'?400:409);
 const cleared=await filterRow();assert.deepEqual(cleared.scale_filter_state,{});assert.equal(cleared.scale_reading,null,'A fresh authenticated abnormal frame retires accepted evidence.');
 await filterSample(300.2,Date.now()-100);assert.equal((await filterRow()).scale_reading.stable,false);assert.equal((await filterRow()).scale_reading.filter.sampleCount,1);
}
await newFilterSession();base=Date.now()-4800;await filterSample(300,base);
readingDelayMs=1000;assert.equal((await filterSample(300.2,Date.now()-4500)).status,409,'A sample expiring inside its transaction clears its old window.');
assert.deepEqual((await filterRow()).scale_filter_state,{});assert.equal((await filterRow()).scale_reading,null);
await newFilterSession();base=Date.now()-4500;
await filterSample(300,base);await filterSample(300.5,base+3100);await filterSample(300.2,base+4100);assert.equal((await filterRow()).scale_reading.stable,false,'A gap greater than 3s starts a fresh window.');
// A native non-connected heartbeat is an observed connection boundary, not a stale cached proof.
await newFilterSession();await filterWindow();await refundAgent({action:'heartbeat',status:{scale:'disconnected',scaleTareVersion:1}});assert.deepEqual((await filterRow()).scale_filter_state,{});
await refundAgent({action:'heartbeat',status:{scale:'connected',scaleTareVersion:1}});await filterSample(300,Date.now()-500);assert.equal((await filterRow()).scale_reading.stable,false);assert.equal((await filterRow()).scale_reading.filter.sampleCount,1);
const retiredByConfig=filterCurrent.id;
response=await saveFilter(filterConfig(true,3));assert.equal(response.status,200);const secondFilter=(await response.json()).settings.scaleFilterSettings;assert.notEqual(secondFilter.revision,initialFilter.revision);
assert.equal((await filterRow()).scale_session,null);assert.deepEqual((await filterRow()).scale_filter_state,{});
assert.equal((await operator({action:'scaleStart',scaleSession:retiredByConfig})).status,409,'A settings change retires the unfinished session.');
assert.equal((await operator({action:'scaleAdopt',scaleSession:retiredByConfig})).status,409);
// Saved captures are immutable even if the stability policy changes before checkout.
response=await checkout({offlineClientOrderId:uuid(52100),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:300,scaleCaptureId:acceptedFilterCapture.id,weightMeasurement:{mode:'device_net',filter:{source:'software_window',settingsRevision:'forged',rawGrams:999,accepted:true}}}]});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const filterSale=await response.json();
const filteredStored=(await db.query('select weight_measurement from store_customer_order_items where order_id=$1',[filterSale.orderId])).rows[0].weight_measurement;
assert.deepEqual(filteredStored,acceptedFilterCapture.weightMeasurement);assert.equal(filteredStored.filter.settingsRevision,initialFilter.revision);assert.notEqual(filteredStored.filter.rawGrams,999);
// Preset tare is removed after filtering exactly once; net rounds to 1g, raw gross stays evidence.
await saveTare(tareConfig(100.5,180.5));await newFilterSession('small');
filtered=await filterWindow([600.2,600.8,600.4]);assert.equal(filtered.stable,true);assert.equal(filtered.grams,500);assert.equal(filtered.grossGrams,600.5);assert.equal(filtered.rawGrossGrams,600.4);assert.equal(filtered.tareGrams,100.5);
response=await operator({action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:filterCurrent.sequence});assert.equal(response.status,200);const filteredTareCapture=(await response.json()).capture;
assert.equal(filteredTareCapture.weightMeasurement.netGrams,500);assert.equal(filteredTareCapture.weightMeasurement.grossGrams,600.5);assert.equal(filteredTareCapture.weightMeasurement.rawGrossGrams,600.4);assert.equal(filteredTareCapture.weightMeasurement.hardwareStable,false);
response=await checkout({offlineClientOrderId:uuid(52101),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:500,scaleCaptureId:filteredTareCapture.id}]});assert.equal(response.status,200);assert.equal((await response.json()).amount,2000);
await newFilterSession('small');await filterWindow([600,600.5,600.3]);const oldEpochSession=filterCurrent.id;
response=await request(relay,{action:'takeover',storeId:ids.store,stationId,epoch:owner.epoch});assert.equal(response.status,200);owner=(await response.json()).owner;
assert.deepEqual((await filterRow()).scale_filter_state,{});assert.equal((await filterRow()).scale_session,null);assert.equal((await filterSample(600,Date.now(),{scaleSession:oldEpochSession})).status,409);
await newFilterSession('large');filtered=await filterWindow([600,600.5,600.3]);assert.equal(filtered.grams,420,'A fresh tare/session uses its own window and selected empty plate.');
// A policy change after the adoption snapshot cannot persist a new capture.
await saveTare(tareConfig(null,null,false));await newFilterSession();await filterWindow();
const filterAdoptionSession=filterCurrent.id;
tareRevisionRace=async()=>{assert.equal((await saveFilter(filterConfig(true,4))).status,200);};
assert.equal((await operator({action:'scaleAdopt',scaleSession:filterAdoptionSession,scaleSequence:filterCurrent.sequence})).status,409);
assert.equal(Number((await db.query('select count(*) as n from store_relay_scale_captures where session_id=$1',[filterAdoptionSession])).rows[0].n),0);
await saveFilter(filterConfig(true,3));

// Even an empty first-frame snapshot cannot cross an observed disconnect/reconnect heartbeat.
await saveTare(tareConfig(null,null,false));await newFilterSession();
filterBeforeTransactionRace=async()=>{
 await refundAgent({action:'heartbeat',status:{scale:'disconnected',scaleTareVersion:1}});
 await refundAgent({action:'heartbeat',status:{scale:'connected',scaleTareVersion:1}});
};
assert.equal((await filterSample(300,Date.now()-1000)).status,409);
assert.deepEqual((await filterRow()).scale_filter_state,{});assert.equal((await filterRow()).scale_reading,null);
await filterSample(300.2,Date.now()-500);assert.equal((await filterRow()).scale_reading.filter.sampleCount,1);assert.equal((await filterRow()).scale_reading.stable,false);

// Two requests may read the same snapshot; the loser must not overwrite the newer window.
await saveTare(tareConfig(null,null,false));await newFilterSession();base=Date.now()-3000;
await filterSample(300,base);
filterBeforeTransactionRace=async()=>{assert.equal((await filterSample(300.2,base+2000)).status,200);};
assert.equal((await filterSample(300.4,base+1000)).status,409,'Old snapshot CAS loses to a newer authenticated sequence.');
let racedFilterRow=await filterRow();assert.equal(racedFilterRow.scale_reading.filter.sampleCount,2);assert.equal(racedFilterRow.scale_reading.stable,false);assert.equal(racedFilterRow.scale_filter_state.samples.at(-1).at,base+2000);
assert.equal((await filterSample(300.1,base+3000)).status,200);assert.equal((await filterRow()).scale_reading.stable,true);
const completedBeforeSameSave=await filterRow();await saveFilter(filterConfig(true,3));assert.equal((await filterRow()).scale_session,completedBeforeSameSave.scale_session,'Same configuration save does not retire a current weighing.');
await newFilterSession();
filterBeforeTransactionRace=async()=>{assert.equal((await saveFilter(filterConfig(true,4))).status,200);};
assert.equal((await filterSample(300,Date.now()-500)).status,409,'A setting change between snapshot and commit fences the old reading.');
assert.equal((await filterRow()).scale_session,null);assert.deepEqual((await filterRow()).scale_filter_state,{});
await db.query('update pos_store_settings set scale_filter_settings=$1::jsonb where store_id=$2',[JSON.stringify({enabled:true,revision:'broken',toleranceGrams:99,settleMs:0}),ids.store]);
await newFilterSession();filtered=await filterWindow();assert.equal(filtered.stable,false);assert.equal(filtered.filter.accepted,false);
assert.equal((await operator({action:'scaleAdopt',scaleSession:filterCurrent.id})).status,409,'Invalid enabled storage cannot fall back to hardware ST or US acceptance.');
await saveFilter(filterConfig(false));await saveTare(tareConfig(null,null,false));await newFilterSession();
assert.equal((await filterSample(300.4,Date.now(),{line:'US,+300.4  g\r\n'})).status,200);assert.equal((await filterRow()).scale_reading.stable,false);assert.equal((await filterRow()).scale_reading.grams,300.4);assert.equal((await filterRow()).scale_reading.filter,undefined,'Disabled mode preserves raw precision and hardware stability.');
console.log('PASS software filter actual handlers: disabled compatibility and null/defaults; scoped settings/unchanged revisions/preservation; US and ST windows, rounding/latch/spike, zero/negative/overload reset, stale/gap/duplicate/out-of-order rejection, observed reconnect and session/epoch/config/tare isolation; authoritative filter evidence and immutable capture checkout; preset tare once and raw gross preserved.');

// Confirming one bowl must not repeatedly erase its accepted software window.
{
const monitoringChecks=[];
const monitoringPass=label=>{monitoringChecks.push(label);console.log('PASS '+label);};
await operator({action:'heartbeat'});await refundAgent({action:'heartbeat',status:{scale:'connected',scaleTareVersion:1}});
await saveFilter(filterConfig());await newFilterSession();
const monitorBase=Date.now()-4500;
await filterWindow([300.2,300.8,300.4],monitorBase);
const beforeMonitoring=await filterRow(),monitorId=filterCurrent.id,monitorSequence=filterCurrent.sequence;
response=await operator({action:'scaleAdopt',scaleSession:monitorId,scaleSequence:monitorSequence,keepMonitoring:true});
assert.equal(response.status,200);const monitoringCapture=await response.json();assert.equal(monitoringCapture.monitoring,true);
assert.deepEqual(await filterRow(),beforeMonitoring,'Confirmation retains the same session, accepted window, cursor and reading.');
const immutableMonitoring=(await db.query('select * from store_relay_scale_captures where id=$1',[monitoringCapture.capture.id])).rows[0];
for(let index=0;index<15;index++){
 const grams=[300.1,301.5,299.8][index%3];
 assert.equal((await filterSample(grams,monitorBase+2100+index*100,{line:`${index%2?'ST':'US'},+${grams.toFixed(1)}  g\r\n`})).status,200);
 const row=await filterRow();assert.equal(row.scale_session,monitorId);assert.equal(row.scale_reading.stable,true);assert.equal(row.scale_reading.filter.accepted,true);assert.equal(row.scale_reading.grams,300);
}
assert.equal(Number((await db.query('select count(*) as n from store_relay_scale_captures where session_id=$1',[monitorId])).rows[0].n),1);
assert.deepEqual((await db.query('select * from store_relay_scale_captures where id=$1',[monitoringCapture.capture.id])).rows[0],immutableMonitoring);
monitoringPass('one exact capture retains its accepted window through 15 fresh fluctuating ST/US updates without recapture or reset');

response=await operator({action:'scaleAdopt',scaleSession:monitorId,scaleSequence:monitorSequence,keepMonitoring:true});
assert.equal(response.status,200);assert.equal((await response.json()).monitoring,true);
assert.equal((await operator({action:'scaleAdopt',scaleSession:monitorId,scaleSequence:filterCurrent.sequence,keepMonitoring:true})).status,409,'A later sequence cannot rewrite the session\'s original capture.');
assert.equal((await filterSample(700,Date.now()-500)).status,200);assert.equal((await filterRow()).scale_reading.stable,false);
assert.equal((await operator({action:'scaleAdopt',scaleSession:monitorId,scaleSequence:filterCurrent.sequence,keepMonitoring:true})).status,409);
assert.equal((await filterSample(700,Date.now(),{line:'malformed'})).status,400);
assert.equal((await filterRow()).scale_reading,null);assert.deepEqual((await filterRow()).scale_filter_state,{});
assert.equal((await operator({action:'scaleAdopt',scaleSession:monitorId,scaleSequence:filterCurrent.sequence,keepMonitoring:true})).status,409);
assert.equal(Number((await db.query('select count(*) as n from store_relay_scale_captures where session_id=$1',[monitorId])).rows[0].n),1);
assert.deepEqual((await db.query('select * from store_relay_scale_captures where id=$1',[monitoringCapture.capture.id])).rows[0],immutableMonitoring);
monitoringPass('idempotent exact retries preserve immutable evidence; changed sequences, load spikes and authenticated null resets cannot create or overwrite a capture');

const successorMonitor=uuid(filterSessionCounter++);
response=await operator({action:'scaleStart',scaleSession:successorMonitor,expectedScaleSession:monitorId});assert.equal(response.status,200);
filterCurrent={id:successorMonitor,context:(await response.json()).scaleTareContext,sequence:0};await filterWindow([700.1,700.5,700.3]);
const successorBeforeRetry=await filterRow();
for(const keepMonitoring of [true,false]){
 response=await operator({action:'scaleAdopt',scaleSession:monitorId,scaleSequence:monitorSequence,keepMonitoring});
 assert.equal(response.status,200);const retiredRetry=await response.json();assert.equal(retiredRetry.monitoring,false);assert.deepEqual(retiredRetry.capture,monitoringCapture.capture);
 assert.deepEqual(await filterRow(),successorBeforeRetry,'A late retry cannot stop, reset, or replace the successor.');
}
assert.equal((await operator({action:'scaleStart',scaleSession:monitorId,expectedScaleSession:successorMonitor})).status,409);
response=await operator({action:'scaleAdopt',scaleSession:successorMonitor,scaleSequence:filterCurrent.sequence,keepMonitoring:true});assert.equal(response.status,200);const successorCapture=await response.json();assert.equal(successorCapture.monitoring,true);assert.equal(Number(successorCapture.capture.grams),700);
monitoringPass('changed loads acquire a new guarded session; old retries report monitoring false and cannot clear or revive its predecessor');

const monitoringActor=session;
session={...session,sessionId:uuid(53990)};
assert.equal((await operator({action:'scaleAdopt',scaleSession:successorMonitor,scaleSequence:filterCurrent.sequence,keepMonitoring:true})).status,409);
session=monitoringActor;
assert.equal((await request(relay,{action:'scaleAdopt',storeId:ids.other,owner,scaleSession:successorMonitor,scaleSequence:filterCurrent.sequence,keepMonitoring:true})).status,403);
const monitoringSale={offlineClientOrderId:uuid(53991),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:700,scaleCaptureId:successorCapture.capture.id}]};
response=await checkout(monitoringSale);assert.equal(response.status,200,await response.clone().text());
assert.equal((await checkout({...monitoringSale,offlineClientOrderId:uuid(53992)})).status,409,'Continuing monitoring does not make a capture reusable for another checkout.');
assert.equal((await operator({action:'scaleAdopt',scaleSession:successorMonitor,scaleSequence:filterCurrent.sequence,keepMonitoring:true})).status,409,'A consumed capture cannot be returned again.');
monitoringPass('retained monitoring preserves cashier-session and store fencing and one-use checkout consumption');

await newFilterSession();await filterWindow();const beforePolicyCapture=filterCurrent.id;
tareRevisionRace=async()=>{assert.equal((await saveFilter(filterConfig(true,3))).status,200);};
assert.equal((await operator({action:'scaleAdopt',scaleSession:beforePolicyCapture,scaleSequence:filterCurrent.sequence,keepMonitoring:true})).status,409);
assert.equal((await filterRow()).scale_session,null);assert.equal(Number((await db.query('select count(*) as n from store_relay_scale_captures where session_id=$1',[beforePolicyCapture])).rows[0].n),0);
await newFilterSession();await filterWindow();
response=await operator({action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:filterCurrent.sequence});assert.equal(response.status,200);assert.equal((await response.json()).monitoring,false);
assert.equal((await filterRow()).scale_session,null);assert.deepEqual((await filterRow()).scale_filter_state,{});
monitoringPass('configuration races fence monitoring captures and default clients still retire the captured session and filter window');

await saveFilter(filterConfig(false));await newFilterSession();
assert.equal((await filterSample(300.4,Date.now(),{line:'ST,+300.4  g\r\n'})).status,200);
response=await operator({action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:filterCurrent.sequence,keepMonitoring:true});assert.equal(response.status,200);assert.equal((await response.json()).monitoring,false);assert.equal((await filterRow()).scale_session,null);
monitoringPass('keepMonitoring remains opt-in for valid enabled software filtering; hardware-only callers retain their original close semantics');
const monitoringOutput=new URL('outputs/scale-stability-monitor-20261018/backend/',root);mkdirSync(monitoringOutput,{recursive:true});
writeFileSync(new URL('verification.json',monitoringOutput),JSON.stringify({passed:true,groups:monitoringChecks.length,checks:monitoringChecks,productionAccess:false,schemaChanges:false},null,2)+'\n');
}

// Network latency may advance the sequence while the same accepted window is unchanged.
{
const windowProofChecks=[];
const windowProofPass=label=>{windowProofChecks.push(label);console.log('PASS '+label);};
await saveFilter(filterConfig());await newFilterSession();await refundAgent({action:'heartbeat',status:{scale:'connected',scaleTareVersion:1}});await operator({action:'heartbeat'});
const advanceBase=Date.now()-3500;await filterWindow([204.1,204.5,204.2],advanceBase);
const observed=await filterRow(),proofId=observed.scale_reading.filter.windowId,observedSequence=filterCurrent.sequence;
assert.match(proofId,/^[0-9a-f-]{36}$/);assert.equal(observed.scale_filter_state.acceptedWindowId,proofId);
tareRevisionRace=async()=>{assert.equal((await filterSample(204.3,advanceBase+2500)).status,200);};
assert.equal((await operator({action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:observedSequence,keepMonitoring:true})).status,409,'Legacy clients keep exact sequence matching during an in-flight upload.');
const proofRequest={action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:observedSequence,scaleWindowId:proofId,scaleGrams:204,keepMonitoring:true};
tareRevisionRace=async()=>{assert.equal((await filterSample(204.4,advanceBase+3000)).status,200);};
response=await operator(proofRequest);assert.equal(response.status,200,await response.clone().text());const proofCapture=await response.json();
assert.equal(proofCapture.scaleSequence,observedSequence+2);assert.equal(proofCapture.monitoring,true);assert.equal(proofCapture.capture.weightMeasurement.filter.windowId,proofId);
const immutableProof=(await db.query('select * from store_relay_scale_captures where id=$1',[proofCapture.capture.id])).rows[0];
assert.equal(immutableProof.reading.scaleSequence,observedSequence+2);assert.equal(immutableProof.reading.filter.windowId,proofId);
await filterSample(204.6,Date.now()-100);response=await operator(proofRequest);assert.equal(response.status,200);assert.deepEqual(await response.json(),proofCapture);
assert.deepEqual((await db.query('select * from store_relay_scale_captures where id=$1',[proofCapture.capture.id])).rows[0],immutableProof);
windowProofPass('a server window proof accepts advancing uploads despite legacy sequence409s and retries preserve the actual captured sequence and immutable metadata');

for(const patch of [{scaleWindowId:uuid(53900)},{scaleGrams:205},{scaleSequence:filterCurrent.sequence+1}])assert.equal((await operator({...proofRequest,...patch})).status,409);
for(const patch of [{scaleWindowId:undefined},{scaleGrams:undefined},{scaleSequence:undefined},{scaleWindowId:null},{scaleWindowId:'bad'},{scaleGrams:'204'},{scaleGrams:204.5},{scaleGrams:0},{scaleGrams:3001}])
 assert.equal((await operator({...proofRequest,...patch})).status,400);
windowProofPass('window proof requires a valid UUID, paired integer net grams and observed sequence; forged or mismatched evidence never falls back to weaker matching');

await newFilterSession();const resetBase=Date.now()-4500;await filterWindow([204.1,204.5,204.2],resetBase);
const retiredProof={action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:filterCurrent.sequence,scaleWindowId:(await filterRow()).scale_reading.filter.windowId,scaleGrams:204,keepMonitoring:true};
assert.equal((await filterSample(0,resetBase+2200,{line:'malformed'})).status,400);
assert.equal((await filterRow()).scale_reading,null);assert.equal((await operator(retiredProof)).status,409);
await filterSample(204.2,resetBase+2300);await filterSample(204.4,resetBase+3300);await filterSample(204.1,resetBase+4300);
const restartedWindow=await filterRow();assert.equal(restartedWindow.scale_reading.grams,204);assert.notEqual(restartedWindow.scale_reading.filter.windowId,retiredProof.scaleWindowId);
assert.equal((await operator(retiredProof)).status,409,'Identical grams in a new window do not validate the old proof.');
assert.equal(Number((await db.query('select count(*) as n from store_relay_scale_captures where session_id=$1',[filterCurrent.id])).rows[0].n),0);
response=await operator({...retiredProof,scaleSequence:filterCurrent.sequence,scaleWindowId:restartedWindow.scale_reading.filter.windowId});assert.equal(response.status,200);
const resetCapture=await response.json();assert.equal(resetCapture.capture.weightMeasurement.filter.windowId,restartedWindow.scale_reading.filter.windowId);
windowProofPass('an authenticated null reset retires the window; returning to exactly the same grams requires its newly accepted server identity');

await newFilterSession();const collisionBase=Date.now()-4500;await filterWindow([300.1,300.5,300.2],collisionBase);
const firstWindowId=(await filterRow()).scale_reading.filter.windowId,firstWindowSequence=filterCurrent.sequence;
const firstWindowRequest={action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:firstWindowSequence,scaleWindowId:firstWindowId,scaleGrams:300,keepMonitoring:true};
response=await operator(firstWindowRequest);assert.equal(response.status,200);
const firstWindowCapture=await response.json();
assert.equal((await filterSample(0,collisionBase+2200,{line:'malformed'})).status,400);
const clearedMonitor=await filterRow();response=await operator(firstWindowRequest);assert.equal(response.status,200);
let retiredAcknowledgement=await response.json();assert.deepEqual(retiredAcknowledgement.capture,firstWindowCapture.capture);assert.equal(retiredAcknowledgement.monitoring,false);assert.deepEqual(await filterRow(),clearedMonitor,'An immutable retry cannot restart a cleared monitor.');
await filterSample(300.1,collisionBase+2300);await filterSample(300.4,collisionBase+3300);await filterSample(300.2,collisionBase+4300);
const secondWindowId=(await filterRow()).scale_reading.filter.windowId;assert.notEqual(secondWindowId,firstWindowId);
const requalifiedMonitor=await filterRow();response=await operator(firstWindowRequest);assert.equal(response.status,200);
retiredAcknowledgement=await response.json();assert.deepEqual(retiredAcknowledgement.capture,firstWindowCapture.capture);assert.equal(retiredAcknowledgement.monitoring,false);assert.deepEqual(await filterRow(),requalifiedMonitor,'An old immutable proof cannot acknowledge or reset a replacement window in the same session.');
assert.equal((await operator({action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:firstWindowSequence,scaleWindowId:secondWindowId,scaleGrams:300,keepMonitoring:true})).status,409,'Even an older observed sequence cannot let a new window proof return the previous capture.');
assert.equal((await filterRow()).scale_reading.filter.windowId,secondWindowId);assert.equal(Number((await db.query('select count(*) as n from store_relay_scale_captures where session_id=$1',[filterCurrent.id])).rows[0].n),1);
assert.equal((await db.query('select reading from store_relay_scale_captures where id=$1',[firstWindowCapture.capture.id])).rows[0].reading.filter.windowId,firstWindowId);
windowProofPass('same-session resets and new windows make old immutable retries report monitoring false; a same-grams replacement cannot replay the older capture even with a lower observed sequence');

for(const anomaly of ['expired','overload','null','disconnected','state_mismatch','owner_expired']){
 await refundAgent({action:'heartbeat',status:{scale:'connected',scaleTareVersion:1}});await operator({action:'heartbeat'});await newFilterSession();await filterWindow();
 const stable=await filterRow(),proof={action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:filterCurrent.sequence,scaleWindowId:stable.scale_reading.filter.windowId,scaleGrams:300,keepMonitoring:true};
 if(anomaly==='expired')await db.query("update store_relay_stations set scale_received_at=clock_timestamp()-interval '6 seconds' where id=$1",[stationId]);
 if(anomaly==='overload')assert.equal((await filterSample(300,Date.now(),{line:'OL,+300.0  g\r\n'})).status,200);
 if(anomaly==='null')assert.equal((await filterSample(300,Date.now(),{line:'malformed'})).status,400);
 if(anomaly==='disconnected')await refundAgent({action:'heartbeat',status:{scale:'disconnected',scaleTareVersion:1}});
 if(anomaly==='state_mismatch')await db.query("update store_relay_stations set scale_filter_state=jsonb_set(scale_filter_state,'{acceptedWindowId}',to_jsonb($1::text)) where id=$2",[uuid(53901),stationId]);
 if(anomaly==='owner_expired')await db.query("update store_relay_stations set owner_until=clock_timestamp()-interval '1 second' where id=$1",[stationId]);
 assert.equal((await operator(proof)).status,409,`The window proof cannot bypass ${anomaly}.`);
 assert.equal(Number((await db.query('select count(*) as n from store_relay_scale_captures where session_id=$1',[filterCurrent.id])).rows[0].n),0);
 if(anomaly==='owner_expired')await db.query("update store_relay_stations set owner_until=clock_timestamp()+interval '45 seconds' where id=$1",[stationId]);
}
windowProofPass('window adoption preserves stale-reading, overload, authenticated-null, disconnected-device, persisted-state identity and expired-owner guards');

await refundAgent({action:'heartbeat',status:{scale:'connected',scaleTareVersion:1}});await saveTare(tareConfig(100.5,180.5));await newFilterSession('small');
const tareBase=Date.now()-3000;await filterWindow([304.1,304.4,304.6],tareBase);const tareWindow=await filterRow();
const tareProof={action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:filterCurrent.sequence,scaleWindowId:tareWindow.scale_reading.filter.windowId,scaleGrams:204,keepMonitoring:true};
assert.equal((await operator({...tareProof,scaleGrams:304})).status,409,'Window grams always mean net, never gross weight.');
assert.equal((await filterSample(304.2,tareBase+2500)).status,200);
response=await operator(tareProof);assert.equal(response.status,200);const tareProofCapture=await response.json();assert.equal(tareProofCapture.capture.weightMeasurement.netGrams,204);assert.equal(tareProofCapture.capture.weightMeasurement.grossGrams,304.5);assert.equal(tareProofCapture.capture.weightMeasurement.filter.windowId,tareProof.scaleWindowId);
const proofActor=session;session={...session,sessionId:uuid(53902)};assert.equal((await operator(tareProof)).status,409);session=proofActor;
assert.equal((await request(relay,{...tareProof,storeId:ids.other,owner})).status,403);
const proofSale={offlineClientOrderId:uuid(53903),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:204,scaleCaptureId:tareProofCapture.capture.id}]};
response=await checkout(proofSale);assert.equal(response.status,200,await response.clone().text());const proofOrder=await response.json();
assert.equal((await db.query('select weight_measurement from store_customer_order_items where order_id=$1',[proofOrder.orderId])).rows[0].weight_measurement.filter.windowId,tareProof.scaleWindowId);
assert.equal((await checkout({...proofSale,offlineClientOrderId:uuid(53904)})).status,409);
windowProofPass('proof binds integer net weight after fractional tare, retains its identity through capture and checkout, and preserves actor/store/one-use protection');

await newFilterSession('small');await filterWindow([304.1,304.4,304.6]);const racingProof={action:'scaleAdopt',scaleSession:filterCurrent.id,scaleSequence:filterCurrent.sequence,scaleWindowId:(await filterRow()).scale_reading.filter.windowId,scaleGrams:204,keepMonitoring:true};
tareRevisionRace=async()=>{assert.equal((await saveFilter(filterConfig(true,3))).status,200);};
assert.equal((await operator(racingProof)).status,409);assert.equal(Number((await db.query('select count(*) as n from store_relay_scale_captures where session_id=$1',[racingProof.scaleSession])).rows[0].n),0);
await saveFilter(filterConfig(false));assert.equal((await operator(racingProof)).status,409);await saveTare(tareConfig(null,null,false));
windowProofPass('filter revision races and disabled policy reject an otherwise valid window proof without persisting a capture');
const proofOutput=new URL('outputs/scale-stability-monitor-20261018/backend/window-proof-verification.json',root);
writeFileSync(proofOutput,JSON.stringify({passed:true,groups:windowProofChecks.length,checks:windowProofChecks,productionAccess:false,schemaChanges:false},null,2)+'\n');
}

await db.close();console.log('PASS relay: idempotent migration/default off; six-digit numeric pairing/leading zero/register scope; terminal cannot issue codes; format rejects without quota consumption; four mistakes then success; single-use competing requests; five-mistake cross-account lockout and capped audit; repeated digits in new generation reset quota; wall-clock pairing expiry; existing long-code remaining lifetime; takeover fencing; atomic order+7 documents/rollback; exclusive claims; uncertain sends/no auto replay; ACK fencing; reprint drawer safety; required/old/future measurement time and preserved timestamps; non-connected heartbeat clears/gates readings; expired owner session withheld; stable scale/session/sequence/capture; automatic start/cancel idempotency and no revival; exact-sequence immutable capture retries; late cleanup cannot close successor; concurrent automatic starts and cashier/store scope; scope and revocation.');
