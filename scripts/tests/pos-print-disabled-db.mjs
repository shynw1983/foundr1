// Actual POS/production SQL against isolated PostgreSQL; no DATABASE_URL or live writes.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
// Deliberately instantiate a fresh in-memory PostgreSQL engine; never load lib/db or DATABASE_URL.
const db = new PGlite();
const output = resolve(process.env.FOUNDR1_API_TEST_OUTPUT || 'outputs/shimizu-pos-checkout-20261020/api');
mkdirSync(output, { recursive: true });
const root = new URL('../../', import.meta.url);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { store: uuid(1), other: uuid(2), brand: uuid(3), employee: uuid(4), menu: uuid(5), register: uuid(6) };
let session = { id: ids.employee, name: 'Tester', role: 'store_manager' };
let failItems = false;
const stripRefs = s => s.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi, '');
const schema = readFileSync(new URL('db/schema.sql', root), 'utf8');
const tables = ['stores','employees','brands','store_brands','pos_store_settings','pos_cash_sessions','store_customer_orders','store_customer_order_items','order_production_tasks','pos_cash_movements','module_settings','menu_catalog_items','menu_option_groups','menu_options','menu_store_settings','menu_option_store_settings','sales_orders','store_tables','local_bridge_devices','member_coupons','store_relay_stations','store_relay_devices','store_relay_print_jobs','employee_scopes','timecard_punches','timecard_shifts','pos_order_corrections'];
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
await db.exec(`insert into stores(id,name) values('${ids.store}','清水 isolated test'),('${ids.other}','Other');
insert into employees(id,name,role) values('${ids.employee}','Tester','store_manager');
insert into brands(id,name,brand_type) values('${ids.brand}','まぁ麻','restaurant');
insert into store_brands(store_id,brand_id,pos_pricing_mode,pos_weight_unit_price) values('${ids.store}','${ids.brand}','fixed',4);
insert into menu_catalog_items(id,brand_id,name,item_kind,base_price) values('${ids.menu}','${ids.brand}','自選マーラータン','buildable_product',815);
insert into pos_cash_sessions(id,store_id,business_date,status,opening_amount) values('${ids.register}','${ids.store}',current_date,'open',10000);
insert into pos_store_settings(store_id,printer_settings) values('${ids.store}','{"enabled":false,"receiptEnabled":false}'::jsonb);`);
function query(parts, ...values) {
  return { text: parts.reduce((s, p, i) => s + p + (i < values.length ? `$${i+1}` : ''), ''), values,
    then(resolve, reject) { return execute(this, db).then(resolve, reject); } };
}
async function execute(statement, connection) {
  if (failItems && /insert into store_customer_order_items/.test(statement.text)) throw new Error('simulated item persistence failure');
  return (await connection.query(statement.text, statement.values)).rows;
}
const sql = Object.assign(query, { transaction: statements => db.transaction(async connection => {
  const results = [];
  for (const statement of statements) results.push(await execute(statement, connection));
  return results;
}) });
const modules = {};
function load(path) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, root),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Request, Response, URL, console, require: name => {
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
modules['store-order-access'] = { getStoreOrderAccess: async () => ({ stores: [{ id: ids.store }], canCancelOrders:true }), getScopedStoreFilter: (_, id) => !id || id === ids.store ? ids.store : '__forbidden__' };
modules['customer-orders'] = { createPickupCode: () => `D${Math.random().toString(16).slice(2,8)}`, findCustomerOrderById: async () => null };
modules.loyalty = { resolveMemberForOrder: async () => null, awardLoyaltyForPaidOrder: async () => null };
modules['order-realtime'] = { publishCustomerOrderEvent: async () => {} };
modules['sales-orders'] = { syncWebReservationToSalesOrder: async () => {} };
modules['store-dining-sessions'] = { syncDiningSessionFromProduction: async () => {}, markDiningOrdersPaid: async () => {} };
modules['inventory-order-usage'] = { markInventoryOrderReady: async () => {}, safeSyncInventoryOrderUsage: async () => {} };
modules['production-estimate'] = { calculateProductionEstimateMinutes: () => 10 };
modules['maamaa-production-rules'] = { normalizeMaamaaProductionReferenceSettings: () => ({}), localizeMaamaaProductionSummary: text => text, localizeMaamaaCustomerLabel: text => text };
modules['maamaa-production-summary'] = { buildMaamaaProductionItemLines: () => [] };
// The cash-only published runtime predates the optional customer-display editor module.
// Its actual POS route does not import it; development checkouts still exercise it when present.
if (existsSync(new URL('lib/pos-customer-display.ts', root))) modules['pos-customer-display'] = load('lib/pos-customer-display.ts');
modules['pos-scale-filter'] = load('lib/pos-scale-filter.ts');
modules['pos-scale-tare'] = load('lib/pos-scale-tare.ts');
modules['pos-pickup-ticket-copy'] = load('lib/pos-pickup-ticket-copy.ts');
modules['pos-printer'] = load('lib/pos-printer.ts');
modules['pos-catalog-policy'] = load('lib/pos-catalog-policy.ts');
modules['pos-menu-policy'] = load('lib/pos-menu-policy.ts');
modules['pos-menu-settings'] = load('lib/pos-menu-settings.ts');
modules['pos-serving-policy'] = load('lib/pos-serving-policy.ts');
modules['pos-fulfillment-settings'] = load('lib/pos-fulfillment-settings.ts');
modules['pos-bowl-data'] = load('lib/pos-bowl-data.ts');
modules['order-production'] = load('lib/order-production.ts');
modules['store-relay-policy'] = load('lib/store-relay-policy.ts');
modules['store-relay'] = load('lib/store-relay.ts');
modules['store-relay-documents'] = load('lib/store-relay-documents.ts');
// This legacy regression intentionally keeps the new feature disabled. Its
// enabled credential/transaction behavior is covered by pos-operator-*-db.mjs.
modules['pos-operator-access']={requirePosOperatorForWrite:async base=>({ok:true,enabled:false,actor:base,operatorSessionId:null,approver:null,writeGuards:[]})};
modules['pos-operator-credentials']={assertPosOperatorSameOrigin:()=>null,posOperatorDatabaseFailure:()=>null};
modules['pos-operator-policy']=load('lib/pos-operator-policy.ts');

const pos = load('app/api/store/pos/route.ts');
const pickup = load('app/api/store/display/pickup/route.ts');
modules['pos-cash-denominations'] = load('lib/pos-cash-denominations.ts');
modules['store-business-hours'] = load('lib/store-business-hours.ts');
const reconciliation = load('app/api/store/pos/reconciliation/route.ts');
const requestBody = {
  storeId:ids.store, bowlTicketVersion:1, orderType:'takeout', paymentMethod:'cash',
  cashTenderedAmount:2000, offlineClientOrderId:uuid(100), discountPresetKey:'student_20',
  receiptRequested:false, items:[{menuCatalogItemId:ids.menu,quantity:1}]
};
const checkout = patch => pos.POST(new Request('http://isolated.test/api/store/pos', {
  method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...requestBody,...patch})
}));
const counts = async () => (await db.query(`select
  (select count(*)::int from store_customer_orders) as orders,
  (select count(*)::int from store_customer_order_items) as items,
  (select count(*)::int from order_production_tasks) as tasks,
  (select count(*)::int from store_relay_print_jobs) as print_jobs,
  (select count(*)::int from pos_cash_movements) as cash_movements`)).rows[0];
const groups=[];
const before=await counts();
assert.deepEqual(before,{orders:0,items:0,tasks:0,print_jobs:0,cash_movements:0});
assert.deepEqual(await modules['store-relay'].relayStations(ids.store),[]);
const settings=(await db.query('select printer_settings from pos_store_settings where store_id=$1',[ids.store])).rows[0].printer_settings;
assert.equal(modules['pos-printer'].normalizePosPrinterSettings(settings).enabled,false);
assert.equal(modules['pos-printer'].normalizePosPrinterSettings(settings).receiptEnabled,false);
let response=await checkout({});
assert.equal(response.status,200,await response.clone().text());
const sale=await response.json();
assert.equal(sale.ok,true);
assert.equal(sale.subtotalAmount,815);
assert.equal(sale.discountAmount,163);
assert.equal(sale.amount,652);
assert.equal(sale.taxRate,8);
assert.equal(sale.taxAmount,49);
assert.equal(sale.cashTenderedAmount,2000);
assert.equal(sale.cashChangeAmount,1348);
assert.equal(sale.relayPrinting,false);
assert.equal(sale.receiptRequested,false);
assert.equal(sale.servingTickets.length,1);
assert.equal(sale.servingTickets[0].pickupCode,'001');
assert.deepEqual(await counts(),{orders:1,items:1,tasks:1,print_jobs:0,cash_movements:0});
const stored=(await db.query('select *,customer_summary as summary from store_customer_orders where id=$1',[sale.orderId])).rows[0];
assert.equal(stored.store_id,ids.store);
assert.equal(stored.payment_status,'paid');
assert.equal(stored.payment_provider,'cash');
assert.equal(Number(stored.amount),652);
assert.equal(stored.pos_cash_session_id,ids.register);
for (const [key,value] of Object.entries({orderType:'takeout',subtotalAmount:815,discountAmount:163,
  taxRate:8,taxAmount:49,cashTenderedAmount:2000,cashChangeAmount:1348,relayPrinting:false,receiptRequested:false})) assert.equal(stored.summary[key],value,key);
const item=(await db.query('select * from store_customer_order_items where order_id=$1',[sale.orderId])).rows[0];
assert.equal(Number(item.amount),815);assert.equal(Number(item.gross_amount),815);
assert.equal(Number(item.discount_amount),163);assert.equal(Number(item.paid_amount),652);
assert.equal(item.pickup_code,'001');
const tasks=(await db.query('select * from order_production_tasks where order_id=$1',[sale.orderId])).rows;
assert.equal(tasks.length,1);assert.equal(tasks[0].order_item_id,item.id);
assert.equal(tasks[0].status,'new');assert.equal(tasks[0].print_status,'pos_managed');
let queue=await (await pickup.GET(new Request(`http://isolated.test/api/store/display/pickup?storeId=${ids.store}`))).json();
assert.equal(queue.preparing.length,1);assert.equal(queue.preparing[0].pickupCode,'001');
assert.equal(queue.ready.length,0);
response=await reconciliation.GET(new Request(`http://isolated.test/api/store/pos/reconciliation?storeId=${ids.store}`));
assert.equal(response.status,200,await response.clone().text());
const cash=await response.json();
assert.equal(cash.activeSession.id,ids.register);
assert.equal(cash.activeSession.openingAmount,10000);
assert.equal(cash.activeSession.cashSales,652);
assert.equal(cash.activeSession.expectedCashAmount,10652);
assert.equal(cash.activeSession.cashIn,0);assert.equal(cash.activeSession.cashOut,0);
assert.equal(cash.orders.length,1);assert.equal(cash.orders[0].id,sale.orderId);
assert.deepEqual(cash.paymentTotals,[{paymentMethod:'cash',count:1,amount:652}]);
groups.push('actual checkout, persisted paid order and item discount, one production task and pickup code, cash reconciliation, zero print jobs');
const saved=await counts();
response=await checkout({});
assert.equal(response.status,200,await response.clone().text());
const retry=await response.json();
assert.equal(retry.duplicate,true);assert.equal(retry.orderId,sale.orderId);
assert.deepEqual(retry.servingTickets,sale.servingTickets);assert.deepEqual(await counts(),saved);
groups.push('same request is idempotent: no duplicate sale, item, task, cash or print job');
response=await checkout({note:'changed'});assert.equal(response.status,409);assert.deepEqual(await counts(),saved);
groups.push('changed same-id request is rejected with no financial or production writes');
for (const [patch,status] of [
  [{storeId:ids.other,offlineClientOrderId:uuid(101)},403],
  [{cashTenderedAmount:651,offlineClientOrderId:uuid(102)},400],
  [{cashTenderedAmount:null,offlineClientOrderId:uuid(103)},400]
]) {response=await checkout(patch);assert.equal(response.status,status,await response.clone().text());assert.deepEqual(await counts(),saved);}
groups.push('cross-store scope and invalid/missing tender reject without sale, item, task, cash or print writes');
const logged=session;session=null;
response=await checkout({offlineClientOrderId:uuid(104)});assert.equal(response.status,401);assert.deepEqual(await counts(),saved);
session=logged;
groups.push('unauthenticated checkout rejected without writes');
await db.query("update pos_cash_sessions set status='closed' where id=$1",[ids.register]);
response=await checkout({offlineClientOrderId:uuid(105)});assert.equal(response.status,400);assert.match((await response.json()).error,/開店前/);assert.deepEqual(await counts(),saved);
await db.query("update pos_cash_sessions set status='open' where id=$1",[ids.register]);
groups.push('closed cash session rejects new checkout without writes');
failItems=true;
await assert.rejects(checkout({offlineClientOrderId:uuid(106)}),/simulated item persistence failure/);
failItems=false;assert.deepEqual(await counts(),saved);
groups.push('item persistence failure atomically rolls back paid-order insert');
response=await reconciliation.GET(new Request(`http://isolated.test/api/store/pos/reconciliation?storeId=${ids.store}`));
assert.equal((await response.json()).activeSession.cashSales,652);
const files=['app/api/store/pos/route.ts','app/api/store/display/pickup/route.ts','app/api/store/pos/reconciliation/route.ts','lib/order-production.ts','lib/pos-bowl-data.ts','lib/store-relay.ts','lib/pos-printer.ts'];
const sourceHashes=Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(new URL(file,root))).digest('hex')]));
const evidence={passed:true,isolatedInMemoryPGlite:true,networkCalls:0,productionDatabaseAccess:false,
  runtimeHandlers:['POST /api/store/pos','GET /api/store/display/pickup','GET /api/store/pos/reconciliation'],
  fixture:{store:'synthetic 清水',printerSettings:settings,relayStations:0,openCashSession:true,...requestBody},
  observed:{orderId:sale.orderId,subtotalAmount:sale.subtotalAmount,discountAmount:sale.discountAmount,amount:sale.amount,
    taxRate:sale.taxRate,taxAmount:sale.taxAmount,cashTenderedAmount:sale.cashTenderedAmount,cashChangeAmount:sale.cashChangeAmount,
    cashSales:cash.activeSession.cashSales,expectedCashAmount:cash.activeSession.expectedCashAmount,pickupCode:item.pickup_code,...await counts()},
  groups,sourceHashes,limits:['PGlite uses one connection; true cross-connection concurrency is not claimed.',
    'Authentication and cross-store scope are synthetic; inventory, loyalty, sales mirror, realtime notifications and production-estimate integrations are stubbed.',
    'This validates unchanged server behavior; browser click dispatch and native printing are covered separately.']};
writeFileSync(resolve(output,'results.json'),JSON.stringify(evidence,null,2)+'\n');
console.log('PASS printer-disabled POS persistence: 815 - 163 = 652, cash 2000 / change 1348; cash reconciliation 10652; single order/item/task/pickup; zero print jobs; retries, access denial, invalid tender, closed session, transaction rollback.');
console.log(JSON.stringify({passed:true,groups:groups.length,output},null,2));
await db.close();
