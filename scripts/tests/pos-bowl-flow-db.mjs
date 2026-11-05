// Actual POS/production SQL against isolated PostgreSQL; no DATABASE_URL or live writes.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = new URL('../../', import.meta.url);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { store: uuid(1), other: uuid(2), brand: uuid(3), employee: uuid(4), menu: uuid(5), register: uuid(6) };
let session = { id: ids.employee, name: 'Tester', role: 'store_manager' };
let failItems = false;
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
modules['kitchen-business-day'] = { getKitchenBusinessDayWindow: () => ({ businessDate:'2026-10-15', startAt:'2000-01-01T00:00', endAt:'2100-01-01T23:59' }) };
modules['kitchen-display-groups'] = load('lib/kitchen-display-groups.ts');
modules['kitchen-display-pricing'] = load('lib/kitchen-display-pricing.ts');
modules['menu-display-name-matcher'] = load('lib/menu-display-name-matcher.ts');
modules['local-bridge-commands'] = { reconcileUberReadyCommand: async () => {} };
const kitchen = load('app/api/store/display/kitchen/route.ts');
const kitchenPatch = patch => kitchen.PATCH(new Request('http://test/api/store/display/kitchen', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ storeId:ids.store, ...patch })}));

const checkout = patch => pos.POST(new Request('http://test/api/store/pos', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
  storeId: ids.store, bowlTicketVersion:1, orderType:'eat_in', paymentMethod:'cash', cashTenderedAmount:5000,
  offlineClientOrderId: uuid(100), note:'共通メモ', items: [300,300,350].map((weight,index) => ({ menuCatalogItemId:ids.menu, quantity:1, measuredQuantity:weight, preparationNote:index===0?'この杯のみ':'別の杯' })), ...patch
}) }));
let response = await checkout({});
assert.equal(response.status,200, await response.clone().text());
const sale = await response.json();
assert.equal(sale.amount,3800);
assert.equal(sale.taxRate,10);
assert.equal(sale.servingTickets.length,3);
assert.deepEqual(sale.servingTickets.map(t => t.pickupCode), ['001','002','003']);
assert.equal((await db.query('select count(*)::int as n from store_customer_order_items')).rows[0].n,3);
assert.equal((await db.query('select count(*)::int as n from order_production_tasks')).rows[0].n,3);
assert.ok((await db.query('select print_status from order_production_tasks')).rows.every(t => t.print_status === 'pos_managed'));
const kitchenInitial = await (await kitchen.GET(new Request(`http://test/api/store/display/kitchen?storeId=${ids.store}`))).json();
assert.equal(kitchenInitial.tasks.length,3);
assert.ok(kitchenInitial.tasks.every(t=>t.itemGroups.length===1 && t.itemCount===1));
assert.equal(kitchenInitial.tasks[0].pickupCode,'001');
assert.equal(kitchenInitial.tasks[0].amount,1200);
assert.ok(kitchenInitial.tasks[0].note.includes('この杯のみ'));
assert.ok(!kitchenInitial.tasks[1].note.includes('この杯のみ'));
const duplicate = await (await checkout({})).json();
assert.equal(duplicate.orderId,sale.orderId);
assert.deepEqual(duplicate.servingTickets,sale.servingTickets);
assert.equal((await checkout({ note:'changed' })).status,409);
assert.equal((await db.query('select count(*)::int as n from store_customer_orders')).rows[0].n,1);
assert.equal(await modules['pos-bowl-data'].handoffPosBowl(sale.servingTickets[0].taskId,ids.store),'');
await modules['order-production'].setProductionTaskStatus(sale.servingTickets[0].taskId,'ready',ids.employee);
let queue = await (await pickup.GET(new Request(`http://test/api/store/display/pickup?storeId=${ids.store}`))).json();
assert.deepEqual(queue.ready.map(t => t.pickupCode),['001']);
assert.equal(queue.preparing.length,2);
assert.equal(await modules['pos-bowl-data'].handoffPosBowl(sale.servingTickets[0].taskId,ids.other),'');
assert.equal((await kitchenPatch({ taskId:sale.servingTickets[0].taskId, status:'completed' })).status,200);
assert.equal((await kitchenPatch({ orderId:sale.orderId, status:'completed' })).status,409);
assert.equal(await modules['pos-bowl-data'].handoffPosBowl(sale.servingTickets[0].taskId,ids.store),'');
await modules['order-production'].setProductionTaskStatus(sale.servingTickets[0].taskId,'new',ids.employee);
assert.equal((await db.query('select status from order_production_tasks where id=$1',[sale.servingTickets[0].taskId])).rows[0].status,'ready');
assert.notEqual((await db.query('select status from store_customer_orders where id=$1',[sale.orderId])).rows[0].status,'completed');
for (const ticket of sale.servingTickets.slice(1)) {
  await modules['order-production'].setProductionTaskStatus(ticket.taskId,'ready',ids.employee);
  await modules['pos-bowl-data'].handoffPosBowl(ticket.taskId,ids.store);
}
assert.equal((await db.query('select status from store_customer_orders where id=$1',[sale.orderId])).rows[0].status,'completed');
queue = await (await pickup.GET(new Request(`http://test/api/store/display/pickup?storeId=${ids.store}`))).json();
assert.equal(queue.ready.length+queue.preparing.length,0);
// Same-weight quantity from an older client is expanded rather than silently charged once.
response = await checkout({ offlineClientOrderId:uuid(101), items:[{menuCatalogItemId:ids.menu,quantity:3,measuredQuantity:300}] });
const expanded = await response.json();
assert.equal(expanded.amount,3600);
assert.equal(expanded.servingTickets.length,3);
// Partial cancellation does not block remaining bowls, and cancelled bowls cannot be handed off.
await db.query("update store_customer_order_items set refund_status='refunded' where id=$1",[expanded.servingTickets[2].itemId]);
for (const ticket of expanded.servingTickets.slice(0,2)) {
  await modules['order-production'].setProductionTaskStatus(ticket.taskId,'ready',ids.employee);
  await modules['pos-bowl-data'].handoffPosBowl(ticket.taskId,ids.store);
}
assert.equal((await db.query('select status from store_customer_orders where id=$1',[expanded.orderId])).rows[0].status,'completed');
// Genuine offline orders retain already printed codes when synchronized.
const offline = await (await checkout({ offlineClientOrderId:uuid(102), offlineQueued:true, offlinePickupCode:'OABCDEF12' })).json();
assert.deepEqual(offline.servingTickets.map(t=>t.pickupCode),['OABCDEF12-1','OABCDEF12-2','OABCDEF12-3']);
// Order and all items roll back together on a persistence failure.
const before = (await db.query('select count(*)::int as n from store_customer_orders')).rows[0].n;
failItems = true;
await assert.rejects(checkout({ offlineClientOrderId:uuid(103) }), /simulated/);
failItems = false;
assert.equal((await db.query('select count(*)::int as n from store_customer_orders')).rows[0].n,before);
assert.equal((await checkout({storeId:ids.other})).status,403);
// History/web orders have no bowl code and retain one ordinary production task and pickup row.
const legacyId=uuid(110);
await db.query(`insert into store_customer_orders(id,store_id,brand_id,order_source,pickup_code,status,payment_status,pickup_date,pickup_time) values($1,$2,$3,'maamaa_web','M-LEGACY','new','paid',current_date,'12:00')`,[legacyId,ids.store,ids.brand]);
await db.query(`insert into store_customer_order_items(order_id,menu_catalog_item_id,item_name,quantity) values($1,$2,'旧注文',2)`,[legacyId,ids.menu]);
await db.query(`insert into order_production_tasks(order_id,store_id,brand_id,production_area,production_area_label) values($1,$2,$3,'general','まぁ麻')`,[legacyId,ids.store,ids.brand]);
await modules['order-production'].ensureProductionTasksForOrder(legacyId);
assert.equal((await db.query('select count(*)::int as n from order_production_tasks where order_id=$1',[legacyId])).rows[0].n,1);
queue=await (await pickup.GET(new Request(`http://test/api/store/display/pickup?storeId=${ids.store}`))).json();
assert.ok(queue.preparing.some(t=>t.pickupCode==='M-LEGACY'));
// A coupon raced after price validation cannot leave a paid order or line behind.
const couponId=uuid(120), memberId=uuid(121);
await db.query(`insert into member_coupons(id,member_id,name,discount_value,status) values($1,$2,'Coupon',200,'used')`,[couponId,memberId]);
modules.loyalty.resolveMemberForOrder=async()=>({id:memberId});
modules.loyalty.getUsableMemberCoupon=async()=>({id:couponId,name:'Coupon',discountType:'amount',discountValue:200});
modules.loyalty.calculateCouponDiscount=()=>200;
modules.loyalty.isMemberExchangeCoupon=()=>false;
const beforeCoupon=(await db.query('select count(*)::int as n from store_customer_orders')).rows[0].n;
assert.equal((await checkout({offlineClientOrderId:uuid(122),memberId,couponId})).status,409);
assert.equal((await db.query('select count(*)::int as n from store_customer_orders')).rows[0].n,beforeCoupon);
await db.query("update member_coupons set status='available' where id=$1",[couponId]);
const withCoupon=await (await checkout({offlineClientOrderId:uuid(123),memberId,couponId})).json();
assert.equal(withCoupon.amount,3600);
assert.equal((await db.query('select used_order_id::text as id from member_coupons where id=$1',[couponId])).rows[0].id,withCoupon.orderId);
const couponDuplicate=await (await checkout({offlineClientOrderId:uuid(123),memberId,couponId})).json();
assert.equal(couponDuplicate.orderId,withCoupon.orderId);
assert.equal((await checkout({bowlTicketVersion:0,offlineClientOrderId:uuid(124)})).status,409);
const legacyOffline=await (await checkout({bowlTicketVersion:0,offlineQueued:true,bowlNumber:'7',offlinePickupCode:'07',offlineClientOrderId:uuid(125)})).json();
assert.equal(legacyOffline.pickupCode,'07');assert.equal(legacyOffline.servingTickets.length,0);
const allocation=await Promise.all([modules['pos-bowl-data'].allocatePosBowlCodes(ids.store,2,ids.register),modules['pos-bowl-data'].allocatePosBowlCodes(ids.store,3,ids.register)]);
assert.equal(new Set(allocation.flat()).size,5);
const abandonedId=uuid(130);
assert.equal(await modules['pos-bowl-data'].abandonUnrecordedPosCheckout(ids.store,abandonedId,ids.employee),true);
assert.equal((await checkout({offlineClientOrderId:abandonedId})).status,409);
assert.equal((await db.query('select count(*)::int as n from store_customer_orders where offline_client_order_id=$1',[abandonedId])).rows[0].n,0);
assert.equal(await modules['pos-bowl-data'].abandonUnrecordedPosCheckout(ids.store,uuid(100),ids.employee),false);
const abandonRoute=load('app/api/store/pos/checkout-recovery/route.ts');
const abandonRequest=storeId=>abandonRoute.POST(new Request('http://test/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId,requestId:uuid(131)})}));
assert.equal((await abandonRequest(ids.other)).status,403);
assert.equal((await abandonRequest(ids.store)).status,200);

// A mixed-brand sale keeps the ordinary drink task/transaction pickup code as well as bowl codes.
await db.query(`insert into brands(id,name,brand_type) values($1,'nanacha','drink')`,[uuid(140)]);
await db.query(`insert into store_brands(store_id,brand_id) values($1,$2)`,[ids.store,uuid(140)]);
await db.query(`insert into menu_catalog_items(id,brand_id,name,item_kind,base_price) values($1,$2,'ミルクティー','fixed_product',500)`,[uuid(141),uuid(140)]);
modules.loyalty.resolveMemberForOrder=async()=>null;
// Drink-only dine-in is rejected before any sale/cash/production persistence.
// The brand in the request is untrusted; the handler must use the catalog join.
await db.query(`insert into menu_catalog_items(id,brand_id,name,item_kind,base_price) values($1,$2,'黒糖タピオカミルク','fixed_product',590)`,[uuid(143),uuid(140)]);
const checkoutCounts=async()=> (await db.query(`select
  (select count(*)::int from store_customer_orders) as orders,
  (select count(*)::int from store_customer_order_items) as items,
  (select count(*)::int from pos_cash_movements) as movements,
  (select count(*)::int from order_production_tasks) as tasks`)).rows[0];
const beforeDrinkOnly=await checkoutCounts();
const drinkOnly={offlineClientOrderId:uuid(144),cashTenderedAmount:1000,items:[{menuCatalogItemId:uuid(143),quantity:1,brandName:'まぁ麻'}]};
response=await checkout(drinkOnly);
assert.equal(response.status,400,await response.clone().text());
assert.equal((await response.json()).error,'ドリンクのみのご注文はお持ち帰りです。店内利用にはマーラータンのご注文が必要です。');
assert.deepEqual(await checkoutCounts(),beforeDrinkOnly);
assert.equal((await db.query('select count(*)::int as n from store_customer_orders where offline_client_order_id=$1',[uuid(144)])).rows[0].n,0);
response=await checkout({...drinkOnly,offlineClientOrderId:uuid(145),storeId:ids.other,orderType:'takeout'});
assert.equal(response.status,403);
assert.deepEqual(await checkoutCounts(),beforeDrinkOnly);
// Explicitly correcting the same unsaved request to takeout charges once at 8%.
response=await checkout({...drinkOnly,orderType:'takeout'});
assert.equal(response.status,200,await response.clone().text());
const drinkSale=await response.json();
assert.equal(drinkSale.amount,590);assert.equal(drinkSale.taxRate,8);assert.equal(drinkSale.taxAmount,44);
assert.equal(drinkSale.cashTenderedAmount,1000);assert.equal(drinkSale.cashChangeAmount,410);
assert.deepEqual(drinkSale.servingTickets,[]);
const storedDrink=(await db.query('select customer_summary as summary,amount,payment_provider from store_customer_orders where id=$1',[drinkSale.orderId])).rows[0];
assert.equal(storedDrink.summary.orderType,'takeout');assert.equal(storedDrink.summary.taxRate,8);assert.equal(storedDrink.summary.taxAmount,44);
assert.equal(storedDrink.summary.cashTenderedAmount,1000);assert.equal(storedDrink.summary.cashChangeAmount,410);
assert.equal(Number(storedDrink.amount),590);assert.equal(storedDrink.payment_provider,'cash');
assert.equal((await db.query('select count(*)::int as n from store_customer_order_items where order_id=$1',[drinkSale.orderId])).rows[0].n,1);
assert.equal((await checkoutCounts()).orders,beforeDrinkOnly.orders+1);
assert.equal((await checkoutCounts()).movements,beforeDrinkOnly.movements);
response=await checkout({...drinkOnly,orderType:'takeout'});
assert.equal(response.status,200);assert.equal((await response.json()).orderId,drinkSale.orderId);
assert.equal((await checkoutCounts()).orders,beforeDrinkOnly.orders+1);
console.log('PASS POS checkout: drink-only dine-in and spoofed brand rejected without writes; store scope denied without writes; explicit takeout saves one cash sale with 8% tax and stable retry.');
const mixed=await (await checkout({offlineClientOrderId:uuid(142),items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:300},{menuCatalogItemId:uuid(141),quantity:2}]})).json();
assert.equal(mixed.amount,2200);assert.equal(mixed.servingTickets.length,1);
assert.equal(mixed.taxRate,10);
queue=await (await pickup.GET(new Request(`http://test/api/store/display/pickup?storeId=${ids.store}`))).json();
assert.ok(queue.preparing.some(row=>row.pickupCode===mixed.pickupCode));
assert.ok(queue.preparing.some(row=>row.pickupCode===mixed.servingTickets[0].pickupCode));

// POS-only menu configuration: actual admin routes, pricing SQL and order persistence.
await db.exec(readFileSync(new URL('db/migrations/20261016_pos_menu_settings.sql',root),'utf8'));
await db.exec(readFileSync(new URL('db/migrations/20261016_pos_menu_settings.sql',root),'utf8'));
let allowMenus=true;
modules['role-permissions']={roleHasPermission:async()=>allowMenus};
const posAdmin=load('app/api/os/menus/pos-settings/route.ts');
const posConfig=()=>modules['pos-menu-settings'].readPosMenuConfig(ids.store);
const adminRead=()=>posAdmin.GET(new Request(`http://test/api/os/menus/pos-settings?storeId=${ids.store}&brandId=${ids.brand}`));
const adminSave=async patch=>posAdmin.POST(new Request('http://test/api/os/menus/pos-settings',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://test'},body:JSON.stringify({storeId:ids.store,brandId:ids.brand,kind:'group',targetId:uuid(160),visible:true,price:null,revision:(await posConfig()).revision,...patch})}));
assert.equal((await posConfig()).settings.length,0);
await db.query(`insert into menu_option_groups(id,brand_id,group_key,name,rule_json) values($1,$2,'premium','Premium', '{"minSelections":1}')`,[uuid(160),ids.brand]);
await db.query(`insert into menu_options(id,option_group_id,option_key,name,price_delta) values($1,$2,'tendon','牛すじ50g',699)`,[uuid(161),uuid(160)]);
assert.equal((await adminRead()).status,200);
assert.equal((await adminSave({storeId:ids.other})).status,403);
assert.equal((await adminSave({brandId:uuid(140)})).status,404);
allowMenus=false;assert.equal((await adminSave({})).status,403);allowMenus=true;
assert.equal((await adminSave({visible:'false'})).status,400);
assert.equal((await adminSave({kind:'option',targetId:uuid(161),visible:false})).status,409);
const posRevisionBefore=(await posConfig()).revision;
assert.equal((await adminSave({})).status,200);
assert.equal((await adminSave({revision:posRevisionBefore})).status,409);
assert.equal((await adminSave({kind:'option',targetId:uuid(161),visible:null,price:250})).status,200);
const newRequest=()=>({offlineClientOrderId:uuid(170),posMenuRevision:'',items:[{menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:300,selectedOptions:[{groupId:uuid(160),optionIds:[uuid(161)]}]}]});
assert.equal((await checkout(newRequest())).status,409);
const localRevision=(await posConfig()).revision;
response=await checkout({...newRequest(),posMenuRevision:localRevision});assert.equal(response.status,200,await response.clone().text());
const localSale=await response.json();assert.equal(localSale.amount,1450);
assert.equal((await db.query('select price_delta from menu_options where id=$1',[uuid(161)])).rows[0].price_delta,'699.00');
await db.query('update menu_options set price_delta=799 where id=$1',[uuid(161)]);
assert.equal((await db.query('select price_override from menu_pos_settings where option_id=$1',[uuid(161)])).rows[0].price_override,'250.00');
assert.equal((await adminSave({visible:false})).status,200);
assert.equal((await checkout({...newRequest(),offlineClientOrderId:uuid(171),posMenuRevision:(await posConfig()).revision})).status,400);
// A saved sale remains recoverable after the POS menu changes, without repricing or new orders.
response=await checkout({...newRequest(),posMenuRevision:localRevision});assert.equal(response.status,200);assert.equal((await response.json()).orderId,localSale.orderId);
assert.equal((await adminSave({kind:'item',targetId:ids.menu,visible:false})).status,200);
assert.equal((await checkout({...newRequest(),offlineClientOrderId:uuid(172),posMenuRevision:(await posConfig()).revision})).status,400);
assert.equal((await db.query('select count(*)::int as n from menu_store_settings')).rows[0].n,0);

// An explicit POS item price can expose a legacy-hidden fixed item without touching shared Web prices.
await db.query(`insert into menu_store_settings(brand_id,store_id,menu_catalog_item_id,pos_enabled,price_override) values($1,$2,$3,false,650)`,[uuid(140),ids.store,uuid(141)]);
assert.equal((await adminSave({kind:'item',targetId:uuid(141),brandId:uuid(140),visible:true,price:400})).status,200);
response=await checkout({offlineClientOrderId:uuid(173),orderType:'takeout',posMenuRevision:(await posConfig()).revision,items:[{menuCatalogItemId:uuid(141),quantity:1}]});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).amount,400);
assert.equal((await db.query('select price_override from menu_store_settings where menu_catalog_item_id=$1',[uuid(141)])).rows[0].price_override,'650.00');
const guardRevision=(await posConfig()).revision;
assert.equal((await adminSave({kind:'item',targetId:uuid(141),brandId:uuid(140),visible:true,price:null})).status,200);
response=await checkout({offlineClientOrderId:uuid(174),orderType:'takeout',posMenuRevision:(await posConfig()).revision,items:[{menuCatalogItemId:uuid(141),quantity:1}]});assert.equal(response.status,200);assert.equal((await response.json()).amount,500);
await assert.rejects(()=>sql.transaction([modules['pos-menu-settings'].posMenuLock(ids.store),modules['pos-menu-settings'].posMenuGuard(ids.store,guardRevision)]),e=>e.code==='22012');
assert.equal((await db.query('select count(*)::int as n from menu_pos_settings where store_id=$1',[ids.other])).rows[0].n,0);

console.log('PASS POS menu: idempotent empty migration, scoped permissions, invalid inputs, required-group protection, stale saves, 50g option override, brand sync isolation, hidden group/item rejection, atomic sale, duplicate recovery.');

session = null;
assert.equal((await checkout({})).status,401);
assert.equal((await pickup.GET(new Request('http://test'))).status,401);
await db.close();
console.log('PASS: migration twice; three bowls/one payment; same-weight expansion; stable retry; changed retry denied; per-bowl ready/pickup/handoff; scope denial; partial cancellation; offline identity; atomic rollback; authentication.');
