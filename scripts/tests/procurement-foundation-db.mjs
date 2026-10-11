// Run against an isolated PostgreSQL engine, never DATABASE_URL.
// FOUNDR1_PGLITE_MODULE can point to a temporary installation of @electric-sql/pglite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const db = new PGlite();
const ids = Object.fromEntries(['store','otherStore','product','employee','order','item','location','stock','check'].map((key, i) => [key, `00000000-0000-4000-8000-${String(i + 1).padStart(12,'0')}`]));
let allowed = true;
let beforeTransaction = null;
const session = { id: ids.employee, role: 'owner' };
const sql = Object.assign((parts, ...values) => ({
  text: parts.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), ''), values,
  then(resolve, reject) { return db.query(this.text, this.values).then(result => result.rows).then(resolve, reject); }
}), {
  transaction: async statements => {
    if (beforeTransaction) { const hook = beforeTransaction; beforeTransaction = null; await hook(statements); }
    return db.transaction(async transaction => {
    const results = [];
    for (const statement of statements) results.push((await transaction.query(statement.text, statement.values)).rows);
    return results;
    });
  }
});
function load(path, modules = {}) {
  if(path==='app/api/inventory/route.ts') {
    const sharedModules=Object.fromEntries(Object.entries(modules).map(([name,value])=>[name.replace('../../../lib/','./'),value]));
    modules={...modules,'../../../lib/inventory-execution-data':load('lib/inventory-execution-data.ts',sharedModules)};
  }

  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(source, { exports, Response, Request, URL, console, require: name => {
    if (name.endsWith('/api-auth')) return {
      requireOsSession: async () => session, requireWritableOsSession: async () => session,
      requireOwnerOsSession: async () => session, canAccessStore: async (_, storeId) => allowed && storeId === ids.store,
      getSessionStoreScope: async () => ({ allStores: false, storeIds: [ids.store] })
    };
    if (name.endsWith('/db')) return { sql };
    if (name.endsWith('/role-permissions')) return { roleHasPermission: async () => true };
    if (name.endsWith('/notification-realtime')) return { publishOsNotificationEvent: async () => undefined };
    if (name.endsWith('/order-realtime')) return { publishStoreOperationalEvent: async () => undefined };
    if (name in modules) return modules[name];
    throw new Error(`Unmocked isolated dependency: ${name}`);
  } });
  return exports;
}
const post = (route, body) => route.POST(new Request('https://example.test/api/inventory', { method: 'POST', body: JSON.stringify({ storeId: ids.store, itemId: ids.stock, ...body }) }));
const patch = (route, body) => route.PATCH(new Request('https://example.test/api/procurement/items', { method: 'PATCH', body: JSON.stringify({ itemId: ids.item, ...body }) }));
try {
  await db.exec(`
    create table stores(id uuid primary key, name text, status text default 'active');
    create table employees(id uuid primary key, name text);
    create table suppliers(id uuid primary key default gen_random_uuid(),name text unique,channel_type text default '実店舗',updated_at timestamptz default now());
    create table products(id uuid primary key, name text, category text, unit text, storage_type text, brand_scope text default 'common', reference_price numeric, package_quantity numeric, package_quantity_unit text);
    create table brands(id uuid primary key, name text);
    create table store_brands(store_id uuid, brand_id uuid);
    create table product_brand_usages(product_id uuid, brand_id uuid, is_orderable boolean default true);
    create table purchase_orders(id uuid primary key, order_no text, store_id uuid, brand_id uuid);
    create table purchase_order_items(id uuid primary key, purchase_order_id uuid, product_id uuid, brand_id uuid, requested_quantity numeric, requested_unit text, actual_quantity numeric, actual_price numeric, status text, temporary_product_name text default '', temporary_product_unit text default '', selected_supplier_id uuid, procurement_note text default '', price_exception_note text default '', note text default '', store_feedback_confirmed_at timestamptz, store_feedback_confirmed_by uuid);
    create table purchase_actuals(id uuid primary key default gen_random_uuid(), purchase_order_item_id uuid, actual_quantity numeric, actual_price numeric, supplier_id uuid, supplier_location_id uuid, actual_unit text, price_is_exception boolean, note text, recorded_by uuid, recorded_at timestamptz default now());
    create table price_records(id uuid primary key default gen_random_uuid(), product_id uuid, price numeric, supplier_id uuid, unit text, source text, receipt_note text, recorded_by uuid);
    create table delivery_batches(id uuid primary key default gen_random_uuid(), purchase_order_id uuid, batch_no integer, status text, created_at timestamptz default now(), delivered_at timestamptz, store_confirmed_at timestamptz, store_confirmed_by uuid);
    create table delivery_batch_items(delivery_batch_id uuid,purchase_order_item_id uuid,primary key(delivery_batch_id,purchase_order_item_id));
    create table purchase_exceptions(id uuid primary key default gen_random_uuid(), purchase_order_id uuid, purchase_order_item_id uuid, exception_type text, message text, resolution_note text, needs_store_confirmation boolean, affects_operation boolean, status text, resolved_by uuid, resolved_at timestamptz, updated_at timestamptz);
    create table inventory_locations(id uuid primary key, store_id uuid, name text, status text default 'active');
    create table inventory_items(id uuid primary key, store_id uuid, product_id uuid, location_id uuid, count_unit text, safety_stock numeric, current_quantity numeric, exception_code text default '', exception_note text default '', last_counted_at timestamptz, last_counted_by uuid, updated_at timestamptz default now(), status text default 'active', unique(store_id,product_id,location_id));
    create table inventory_checks(id uuid primary key default gen_random_uuid(), inventory_item_id uuid, store_id uuid, product_id uuid, quantity numeric, record_type text, exception_code text, note text, recorded_by uuid, created_at timestamptz default now());
    insert into stores values('${ids.store}','A'),('${ids.otherStore}','B');
    insert into employees values('${ids.employee}','Tester');
    insert into products(id,name,unit,reference_price) values('${ids.product}','SKU','袋',100);
    insert into purchase_orders values('${ids.order}','PO-TEST','${ids.store}',null);
    insert into purchase_order_items(id,purchase_order_id,product_id,requested_quantity,requested_unit,actual_quantity,actual_price,status) values('${ids.item}','${ids.order}','${ids.product}',10,'袋',6,125,'delivered');
    insert into price_records(product_id,price) values('${ids.product}',125);
    insert into inventory_locations values('${ids.location}','${ids.store}','Cold storage');
    insert into inventory_items(id,store_id,product_id,location_id,count_unit,safety_stock,current_quantity,last_counted_at,last_counted_by) values('${ids.stock}','${ids.store}','${ids.product}','${ids.location}','袋',1,6,'2026-10-01','${ids.employee}');
    insert into inventory_checks(id,inventory_item_id,store_id,product_id,quantity,record_type) values('${ids.check}','${ids.stock}','${ids.store}','${ids.product}',4,'count');
  `);
  const migration = readFileSync(new URL('db/migrations/20261008_procurement_foundation.sql', root), 'utf8');
  await db.exec(migration); await db.exec(migration);
  await db.exec(readFileSync(new URL('db/migrations/20261008_product_unit_conversions.sql', root), 'utf8'));
  await db.exec(readFileSync(new URL('db/migrations/20261009_inventory_receipts.sql', root), 'utf8'));
  await db.exec(readFileSync(new URL('db/migrations/20261009_inventory_quick_checks.sql', root), 'utf8'));
  await db.exec(readFileSync(new URL('db/migrations/20261009_inventory_receipt_unknown_balance.sql', root), 'utf8'));
  await db.exec(readFileSync(new URL('db/migrations/20261011_product_packaging.sql',root),'utf8'));
  await db.exec(readFileSync(new URL('db/migrations/20261011_inventory_order_usage.sql',root),'utf8').match(/create table if not exists inventory_movements[\s\S]+?\n\);/)[0]);
  await db.exec(readFileSync(new URL('db/migrations/20261011_inventory_usage_reconciliation.sql',root),'utf8'));
  await db.exec(`create table inventory_order_usage_issues(id uuid primary key default gen_random_uuid(),order_id uuid,store_id uuid,created_at timestamptz default now(),resolved_at timestamptz);`);
  assert.equal((await db.query('select catalog_visibility from products')).rows[0].catalog_visibility, 'internal');
  assert.equal((await db.query('select count_unit from inventory_checks')).rows[0].count_unit, '');
  await assert.rejects(db.query("update products set catalog_visibility='invalid'"));
  console.log('PASS: migration repeat, defaults, constraint and unknown historical unit');

  const unitConversions = load('lib/product-unit-conversions.ts');
  const countInput=load('lib/inventory-count-input-policy.ts',{'./product-unit-conversions':unitConversions});
  const packaging=load('lib/product-packaging-policy.ts',{'./product-unit-conversions':unitConversions});
  const catalogPolicy = load('lib/product-catalog-policy.ts', { './product-unit-conversions.ts': unitConversions });
  const catalogAccess = load('lib/product-catalog-access.ts', { './product-catalog-policy': catalogPolicy });
  session.role = 'store_manager';
  assert.equal((await catalogAccess.getVisibleProductIdsForStore(session, ids.store)).length, 0);
  await db.query("update products set catalog_visibility='selected_stores'");
  await db.query('insert into product_catalog_store_grants(product_id,store_id) values($1,$2)', [ids.product, ids.store]);
  assert.equal((await catalogAccess.assertProductViewableAtStore(session, ids.store, ids.product)).ok, true);
  assert.equal((await catalogAccess.assertProductViewableAtStore(session, ids.otherStore, ids.product)).ok, false);
  await db.query('update products set is_orderable=false');
  assert.equal((await catalogAccess.assertProductViewableAtStore(session, ids.store, ids.product)).ok, true);
  assert.equal((await catalogAccess.assertProductsOrderable(session, ids.store, [ids.product])).ok, false);
  await db.query('update products set is_orderable=true');
  session.role = 'owner';
  console.log('PASS: real catalog grants, exact store scope, stopped SKU remains identifiable');
  const inventory = load('app/api/inventory/route.ts', {
    '../../../lib/inventory-observation-policy': load('lib/inventory-observation-policy.ts'),
    '../../../lib/product-unit-conversions': unitConversions,
    '../../../lib/inventory-count-input-policy':countInput,
    '../../../lib/inventory-quick-policy': load('lib/inventory-quick-policy.ts'),
    '../../../lib/product-catalog-access': catalogAccess
  });
  const beforeCount = (await db.query('select last_counted_at from inventory_items')).rows[0].last_counted_at;
  assert.equal((await post(inventory, { action: 'exception', exceptionCode: 'low' })).status, 200);
  assert.equal(+new Date((await db.query('select last_counted_at from inventory_items')).rows[0].last_counted_at), +new Date(beforeCount));
  assert.equal((await post(inventory, { action: 'count', quantity: 6.25, countUnit: '箱' })).status, 409);
  assert.equal((await post(inventory, { action: 'count', quantity: 6.25, countUnit: '袋' })).status, 200);
  assert.equal(Number((await db.query('select current_quantity from inventory_items')).rows[0].current_quantity), 6.25);
  assert.equal((await db.query("select count_unit from inventory_checks where record_type='count' and id<>$1", [ids.check])).rows[0].count_unit, '袋');
  console.log('PASS: atomic count/history, stale unit rejection, observation freshness');

  const procurement = load('app/api/procurement/items/route.ts', {
    '../../../../lib/product-packaging-policy':packaging,
    '../../../../lib/replenishment-order-locks': load('lib/replenishment-order-locks.ts'),
    '../../../../lib/procurement-confirmation-policy': load('lib/procurement-confirmation-policy.ts'),
    '../../../../lib/product-catalog-access': catalogAccess,
    '../../../../lib/product-catalog-policy': catalogPolicy
  });
  const quantitySnapshot = { actualQuantity: 6, requestedQuantity: 10, productId: ids.product, unit: '袋' };
  const confirmation = { confirmFeedbackKind: 'quantity', expectedConfirmation: quantitySnapshot };
  assert.equal((await patch(procurement, confirmation)).status, 200);
  assert.equal((await patch(procurement, confirmation)).status, 200);
  assert.equal(Number((await db.query('select count(*) as count from purchase_exceptions')).rows[0].count), 1);
  assert.equal((await patch(procurement, { confirmFeedbackKind: 'price', expectedConfirmation: { actualPrice: 125, referencePrice: 100, productId: ids.product, unit: '袋' } })).status, 200);
  const facts = (await db.query('select requested_quantity,actual_quantity,actual_price from purchase_order_items')).rows[0];
  assert.deepEqual(Object.values(facts).map(Number), [10,6,125]);
  assert.equal(Number((await db.query('select count(*) as count from price_records')).rows[0].count), 1);
  await db.query('update purchase_order_items set actual_quantity=7');
  assert.equal((await patch(procurement, confirmation)).status, 409);
  assert.equal((await patch(procurement, { actualQuantity: 10 })).status, 200);
  assert.equal(Number((await db.query('select actual_quantity from purchase_order_items')).rows[0].actual_quantity), 7);
  await db.query('update purchase_order_items set requested_quantity=8');
  const beforeLegacyStale = (await db.query('select requested_quantity,actual_quantity,actual_price,quantity_feedback_confirmation from purchase_order_items')).rows[0];
  const exceptionsBeforeLegacyStale = Number((await db.query('select count(*) as count from purchase_exceptions')).rows[0].count);
  const pricesBeforeLegacyStale = (await db.query('select id,price from price_records order by id')).rows;
  assert.equal((await patch(procurement, { actualQuantity: 10 })).status, 409);
  assert.deepEqual((await db.query('select requested_quantity,actual_quantity,actual_price,quantity_feedback_confirmation from purchase_order_items')).rows[0], beforeLegacyStale);
  assert.equal(Number((await db.query('select count(*) as count from purchase_exceptions')).rows[0].count), exceptionsBeforeLegacyStale);
  assert.deepEqual((await db.query('select id,price from price_records order by id')).rows, pricesBeforeLegacyStale);
  await db.query('update purchase_order_items set requested_quantity=10');
  console.log('PASS: previous-client quantity confirmation rejects changed demand without rewriting facts or audit');
  await db.query("update purchase_order_items set status='requested',actual_quantity=null,actual_price=null");
  const beforeLegacyWorkbench = (await db.query('select requested_quantity,actual_quantity,actual_price,procurement_note from purchase_order_items')).rows[0];
  assert.equal((await patch(procurement, { purchased: true, actualQuantity: 10, note: 'legacy demand fallback' })).status, 409);
  assert.deepEqual((await db.query('select requested_quantity,actual_quantity,actual_price,procurement_note from purchase_order_items')).rows[0], beforeLegacyWorkbench);
  assert.equal(Number((await db.query('select count(*) as count from purchase_actuals')).rows[0].count), 0);
  await db.query('update purchase_order_items set requested_quantity=8');
  assert.equal((await patch(procurement, { purchased: true, actualQuantity: 10, note: 'stale pending demand fallback' })).status, 409);
  assert.equal((await db.query('select actual_quantity from purchase_order_items')).rows[0].actual_quantity, null);
  assert.equal(Number((await db.query('select requested_quantity from purchase_order_items')).rows[0].requested_quantity), 8);
  assert.equal(Number((await db.query('select count(*) as count from purchase_actuals')).rows[0].count), 0);
  await db.query('update purchase_order_items set requested_quantity=10');
  assert.equal((await patch(procurement, { purchased: true, actualQuantity: 10, actualQuantityRecordedExplicitly: true })).status, 200);
  assert.equal(Number((await db.query('select actual_quantity from purchase_order_items')).rows[0].actual_quantity), 10);
  assert.equal(Number((await db.query('select actual_quantity from purchase_actuals')).rows[0].actual_quantity), 10);
  await db.query("update purchase_order_items set status='requested',actual_quantity=null,actual_price=null");
  await db.query('delete from purchase_actuals');
  assert.equal((await patch(procurement, { purchased: true })).status, 400);
  assert.equal(Number((await db.query('select count(*) as count from purchase_actuals')).rows[0].count), 0);
  await db.query("update purchase_order_items set status='purchased'");
  await db.query('insert into purchase_actuals(purchase_order_item_id,actual_quantity,actual_price) values($1,6.25,150)', [ids.item]);
  assert.equal((await patch(procurement, { purchased: true, note: 'metadata only' })).status, 200);
  let actual = (await db.query('select actual_quantity,actual_price,note from purchase_actuals')).rows[0];
  assert.equal(Number(actual.actual_quantity), 6.25);
  assert.equal(Number(actual.actual_price), 150);
  assert.equal(actual.note, 'metadata only');
  await db.query("update purchase_order_items set status='delivered',actual_quantity=null,actual_price=null");
  await db.query('update purchase_actuals set actual_quantity=null,actual_price=null');
  assert.equal((await patch(procurement, { purchased: true, note: 'unknown retained' })).status, 200);
  actual = (await db.query('select actual_quantity,actual_price from purchase_actuals')).rows[0];
  assert.equal(actual.actual_quantity, null);
  assert.equal(actual.actual_price, null);
  const beforeLegacyMetadata = (await db.query('select actual_quantity,actual_price,procurement_note from purchase_order_items')).rows[0];
  assert.equal((await patch(procurement, { purchased: true, actualQuantity: 10, note: 'legacy metadata fallback' })).status, 409);
  assert.deepEqual((await db.query('select actual_quantity,actual_price,procurement_note from purchase_order_items')).rows[0], beforeLegacyMetadata);
  assert.equal((await db.query('select actual_quantity from purchase_actuals')).rows[0].actual_quantity, null);
  console.log('PASS: legacy workbench demand fallback is rejected; explicit current quantity and existing unknown metadata are preserved');
  await db.query("update purchase_order_items set status='requested'");
  assert.equal((await patch(procurement, { purchased: true, note: 'existing actual record' })).status, 200);
  assert.equal((await db.query('select actual_quantity from purchase_actuals')).rows[0].actual_quantity, null);
  assert.equal(Number((await db.query('select requested_quantity from purchase_order_items')).rows[0].requested_quantity), 10);
  console.log('PASS: purchase metadata preserves recorded fractions and unknowns; new purchase requires actual quantity');
  assert.equal((await patch(procurement, { deliveryStatus: 'received', note: 'unknown receiving retained' })).status, 200);
  assert.equal((await db.query('select actual_quantity from purchase_order_items')).rows[0].actual_quantity, null);
  assert.equal((await db.query('select actual_quantity from purchase_actuals')).rows[0].actual_quantity, null);
  const purchaseFacts = async () => ({
    items: (await db.query('select id,product_id,requested_quantity,actual_quantity,actual_price,status,procurement_note from purchase_order_items order by id')).rows,
    actuals: (await db.query('select id,actual_quantity,actual_price,note from purchase_actuals order by id')).rows,
    prices: (await db.query('select id,product_id,price from price_records order by id')).rows
  });
  const beforeFailure = await purchaseFacts();
  await db.exec(`create function reject_purchase_actual_for_test() returns trigger language plpgsql as $$
    begin raise exception 'expected test purchase write failure' using errcode='23514'; end; $$;
    create trigger reject_purchase_actual_for_test before insert on purchase_actuals for each row execute function reject_purchase_actual_for_test();`);
  await assert.rejects(patch(procurement, { purchased: true, actualQuantity: 6, actualQuantityRecordedExplicitly: true, actualPrice: '200', note: 'must roll back' }), error => error.code === '23514');
  assert.deepEqual(await purchaseFacts(), beforeFailure);
  await db.exec('drop trigger reject_purchase_actual_for_test on purchase_actuals; drop function reject_purchase_actual_for_test();');
  beforeTransaction = () => db.query('update purchase_order_items set product_id=null where id=$1', [ids.item]);
  assert.equal((await patch(procurement, { note: 'stale SKU must not change facts' })).status, 409);
  assert.equal((await db.query('select procurement_note from purchase_order_items where id=$1', [ids.item])).rows[0].procurement_note, 'unknown receiving retained');
  await db.query('update purchase_order_items set product_id=$1 where id=$2', [ids.product, ids.item]);
  console.log('PASS: real purchase transaction rollback, unknown receiving and stale SKU guard');

  await db.exec(`
    alter table purchase_orders alter column id set default gen_random_uuid();
    alter table purchase_orders add column deadline_label text, add column deadline_at timestamptz,
      add column requested_item_count integer default 1, add column priority text, add column status text,
      add column note text, add column requested_by uuid, add column assigned_to uuid,
      add column updated_at timestamptz default now(), add column replenishment_source jsonb;
    alter table purchase_order_items alter column id set default gen_random_uuid();
    alter table employees add column status text default 'active', add column lark_open_id text, add column lark_user_id text;
    create table employee_scopes(employee_id uuid,scope_type text,store_id uuid);
    create table product_supplier_options(product_id uuid,supplier_id uuid,role text,is_active boolean);
    create table os_notifications(id uuid primary key default gen_random_uuid(),recipient_employee_id uuid,notification_type text,title text,message text,href text,lark_sent_at timestamptz,lark_error text);
  `);
  const orderIntent = load('lib/replenishment-order-intent.ts');
  const orderLocks = load('lib/replenishment-order-locks.ts');
  const orders = load('app/api/orders/route.ts', {
    '../../../lib/product-catalog-access': catalogAccess,
    '../../../lib/replenishment-order-intent': orderIntent,
    '../../../lib/replenishment-order-locks': orderLocks,
    '../../../lib/lark': { sendPurchaseOrderLarkNotification: async () => ({ok:true,delivered:false}) }
  });
  const readOpen = async () => (await (await orders.GET(new Request(`https://example.test/api/orders?replenishStoreId=${ids.store}&replenishProductId=${ids.product}`))).json()).openItems;
  const makeForm = (quantity, orderNo) => {
    const form = new FormData();
    form.set('store','A'); form.set('deadline','2026-10-10T10:00'); form.set('productId',ids.product);
    form.set('productName','SKU'); form.set('requestedQuantity',String(quantity)); form.set('requestedUnit','袋');
    if (orderNo) form.set('orderId',orderNo);
    return form;
  };
  const sourceContext = { storeId:ids.store, productIds:[ids.product], expectedOpenItemIds:(await readOpen()).map(item=>item.itemId), additionalOrderConfirmed:true };
  const appendResponse = await procurement.POST(new Request('https://example.test/api/procurement/items', {method:'POST',body:JSON.stringify({orderId:'PO-TEST',productId:ids.product,requestedQuantity:3})}));
  assert.equal(appendResponse.status,200);
  const appendedId = (await appendResponse.json()).itemId;
  assert.ok((await readOpen()).some(item=>item.itemId===appendedId));
  const staleForm = makeForm(2); staleForm.set('replenishContext',JSON.stringify(sourceContext));
  const orderCount = Number((await db.query('select count(*) n from purchase_orders')).rows[0].n);
  assert.equal((await orders.POST(new Request('https://example.test/api/orders',{method:'POST',body:staleForm}))).status,409);
  assert.equal(Number((await db.query('select count(*) n from purchase_orders')).rows[0].n),orderCount);
  beforeTransaction = () => db.query('update purchase_orders set store_id=$1 where id=$2', [ids.otherStore,ids.order]);
  assert.equal((await procurement.POST(new Request('https://example.test/api/procurement/items', {method:'POST',body:JSON.stringify({orderId:'PO-TEST',productId:ids.product,requestedQuantity:3})}))).status,409);
  await db.query('update purchase_orders set store_id=$1 where id=$2',[ids.store,ids.order]);
  console.log('PASS: append participates in source open IDs and rejects moved-store identity');

  const freshForm = makeForm(2); freshForm.set('replenishContext',JSON.stringify({...sourceContext,expectedOpenItemIds:(await readOpen()).map(item=>item.itemId)}));
  const freshResponse = await orders.POST(new Request('https://example.test/api/orders',{method:'POST',body:freshForm}));
  assert.equal(freshResponse.status,200);
  const freshOrderNo = (await freshResponse.json()).orderId;
  const freshOrderId = (await db.query('select id from purchase_orders where order_no=$1',[freshOrderNo])).rows[0].id;
  const pendingFacts = async () => ({
    order:(await db.query('select store_id,requested_item_count,note from purchase_orders where id=$1',[freshOrderId])).rows,
    items:(await db.query('select id,product_id,requested_quantity,requested_unit,status from purchase_order_items where purchase_order_id=$1 order by id',[freshOrderId])).rows
  });
  const beforeEditFailure = await pendingFacts();
  await db.exec(`create function reject_order_item_for_test() returns trigger language plpgsql as $$
    begin if NEW.requested_quantity=13 then raise exception 'expected test order write failure' using errcode='23514'; end if; return NEW; end; $$;
    create trigger reject_order_item_for_test before insert on purchase_order_items for each row execute function reject_order_item_for_test();`);
  await assert.rejects(orders.PUT(new Request('https://example.test/api/orders',{method:'PUT',body:makeForm(13,freshOrderNo)})),error=>error.code==='23514');
  assert.deepEqual(await pendingFacts(),beforeEditFailure);
  await db.exec('drop trigger reject_order_item_for_test on purchase_order_items; drop function reject_order_item_for_test();');
  beforeTransaction = () => db.query("insert into purchase_order_items(purchase_order_id,product_id,requested_quantity,requested_unit,status) values($1,$2,1,'袋','requested')",[freshOrderId,ids.product]);
  assert.equal((await orders.PUT(new Request('https://example.test/api/orders',{method:'PUT',body:makeForm(5,freshOrderNo)}))).status,409);
  assert.equal((await pendingFacts()).items.length,2);
  assert.equal(Number((await pendingFacts()).items.find(item=>item.id===beforeEditFailure.items[0].id).requested_quantity),2);
  assert.equal((await orders.PUT(new Request('https://example.test/api/orders',{method:'PUT',body:makeForm(5,freshOrderNo)}))).status,200);
  assert.equal((await pendingFacts()).items.length,1);
  assert.equal(Number((await pendingFacts()).items[0].requested_quantity),5);
  console.log('PASS: order edit rollback and stale appended-row protection, then successful rebuild');
  assert.equal((await orders.PUT(new Request('https://example.test/api/orders',{method:'PUT',body:makeForm(10,freshOrderNo)}))).status,200);
  const splitItemId = (await pendingFacts()).items[0].id;
  const beforeSplit = await pendingFacts();
  const beforeSplitOpenIds = (await readOpen()).map(item=>item.itemId);
  const splitBody = { itemId:splitItemId, purchased:true, splitRemaining:true, actualQuantity:4, actualQuantityRecordedExplicitly:true };
  const splitRequest = () => procurement.PATCH(new Request('https://example.test/api/procurement/items',{method:'PATCH',body:JSON.stringify(splitBody)}));
  await db.exec(`create function reject_split_actual_for_test() returns trigger language plpgsql as $$
    begin raise exception 'expected split purchase write failure' using errcode='23514'; end; $$;
    create trigger reject_split_actual_for_test before insert on purchase_actuals for each row execute function reject_split_actual_for_test();`);
  await assert.rejects(splitRequest(),error=>error.code==='23514');
  assert.deepEqual(await pendingFacts(),beforeSplit);
  assert.deepEqual((await readOpen()).map(item=>item.itemId),beforeSplitOpenIds);
  await db.exec('drop trigger reject_split_actual_for_test on purchase_actuals; drop function reject_split_actual_for_test();');
  beforeTransaction = async () => { assert.equal((await splitRequest()).status,200); };
  assert.equal((await splitRequest()).status,409);
  const splitFacts = await pendingFacts();
  assert.equal(splitFacts.items.length,2);
  assert.equal(Number(splitFacts.items.find(item=>item.id===splitItemId).requested_quantity),4);
  const remainder = splitFacts.items.find(item=>item.id!==splitItemId);
  assert.equal(Number(remainder.requested_quantity),6);
  assert.equal(remainder.status,'requested');
  const beforeSplitForm = makeForm(2); beforeSplitForm.set('replenishContext',JSON.stringify({...sourceContext,expectedOpenItemIds:beforeSplitOpenIds}));
  assert.equal((await orders.POST(new Request('https://example.test/api/orders',{method:'POST',body:beforeSplitForm}))).status,409);
  const replacementId='00000000-0000-4000-8000-000000000999';
  await db.query("insert into products(id,name,unit) values($1,'Replacement SKU','袋')",[replacementId]);
  const beforeReplacementIds=(await readOpen()).map(item=>item.itemId);
  let replacementLockKeys;
  beforeTransaction=statements=>{ replacementLockKeys=statements.filter(query=>query.text.includes('pg_advisory_xact_lock')).map(query=>query.values[0]); };
  assert.equal((await procurement.PATCH(new Request('https://example.test/api/procurement/items',{method:'PATCH',body:JSON.stringify({itemId:remainder.id,productId:replacementId})}))).status,200);
  assert.deepEqual([...replacementLockKeys],[`purchase-order-items:${freshOrderId}`,...[`purchase-order:${ids.store}:${ids.product}`,`purchase-order:${ids.store}:${replacementId}`].sort()]);
  assert.ok(!(await readOpen()).some(item=>item.itemId===remainder.id));
  const beforeReplacementForm=makeForm(2); beforeReplacementForm.set('replenishContext',JSON.stringify({...sourceContext,expectedOpenItemIds:beforeReplacementIds}));
  assert.equal((await orders.POST(new Request('https://example.test/api/orders',{method:'POST',body:beforeReplacementForm}))).status,409);
  console.log('PASS: split rollback and success, old/new SKU replacement locks, stale source IDs rejected');
  // A request read before another operation delivered the same item must not reopen it,
  // remove the delivery relation or erase actuals/confirmation snapshots after waiting.
  await db.query("update purchase_order_items set status='purchased',actual_quantity=4,actual_price=123 where id=$1",[splitItemId]);
  const lateBatchId='00000000-0000-4000-8000-000000000998';
  beforeTransaction=async () => {
    await db.query("update purchase_order_items set status='delivered',store_feedback_confirmed_at=now(),quantity_feedback_confirmation='{\"confirmed\":true}'::jsonb where id=$1",[splitItemId]);
    await db.query("insert into delivery_batches(id,purchase_order_id,batch_no,status) values($1,$2,1,'delivered')",[lateBatchId,freshOrderId]);
    await db.query('insert into delivery_batch_items values($1,$2)',[lateBatchId,splitItemId]);
  };
  const beforeRollbackActuals=(await db.query('select id,actual_quantity,actual_price,note from purchase_actuals order by id')).rows;
  const beforeRollbackPrices=(await db.query('select id,product_id,price from price_records order by id')).rows;
  assert.equal((await procurement.PATCH(new Request('https://example.test/api/procurement/items',{method:'PATCH',body:JSON.stringify({itemId:splitItemId,purchased:false})}))).status,409);
  const deliveredFacts=(await db.query('select status,actual_quantity,actual_price,quantity_feedback_confirmation,store_feedback_confirmed_at from purchase_order_items where id=$1',[splitItemId])).rows[0];
  assert.equal(deliveredFacts.status,'delivered');
  assert.equal(Number(deliveredFacts.actual_quantity),4); assert.equal(Number(deliveredFacts.actual_price),123);
  assert.deepEqual(deliveredFacts.quantity_feedback_confirmation,{confirmed:true}); assert.ok(deliveredFacts.store_feedback_confirmed_at);
  assert.equal(Number((await db.query('select count(*) n from delivery_batch_items where purchase_order_item_id=$1',[splitItemId])).rows[0].n),1);
  assert.deepEqual((await db.query('select id,actual_quantity,actual_price,note from purchase_actuals order by id')).rows,beforeRollbackActuals);
  assert.deepEqual((await db.query('select id,product_id,price from price_records order by id')).rows,beforeRollbackPrices);
  // Actual-only and delivery-identity changes also invalidate an otherwise unchanged item.
  beforeTransaction=()=>db.query('update purchase_actuals set actual_quantity=3 where purchase_order_item_id=$1',[splitItemId]);
  assert.equal((await procurement.PATCH(new Request('https://example.test/api/procurement/items',{method:'PATCH',body:JSON.stringify({itemId:splitItemId,note:'stale actual must not save'})}))).status,409);
  beforeTransaction=()=>db.query("update delivery_batches set status='received',store_confirmed_at=now() where id=$1",[lateBatchId]);
  assert.equal((await procurement.PATCH(new Request('https://example.test/api/procurement/items',{method:'PATCH',body:JSON.stringify({itemId:splitItemId,note:'stale batch must not save'})}))).status,409);
  console.log('PASS: stale second split rejected; delivered rollback, actual-only and batch changes preserve all facts');
  allowed = false;
  assert.equal((await patch(procurement, { clearActualPrice: true })).status, 403);
  console.log('PASS: real confirmation CTE, facts retained, retry idempotence, stale snapshot and access denied');
  allowed = true;
  const receiptId='00000000-0000-4000-8000-000000000997';
  const insertPostedReceipt=()=>db.query(`insert into inventory_stock_receipts(
    id,request_id,purchase_order_item_id,purchase_order_id,store_id,product_id,inventory_item_id,
    purchase_quantity,purchase_unit,count_quantity,count_unit,mode,before_stock_quantity,after_stock_quantity,
    conversion_snapshot,source_snapshot,request_payload,recorded_by,recorded_by_name
  ) values($1,$1,$2,$3,$4,$5,$6,1,'袋',1,'袋','add',6,7,
    '{"purchaseUnit":"袋","countUnit":"袋","unitsPerPurchase":1}'::jsonb,'{}'::jsonb,'{}'::jsonb,$7,'Tester')`,
    [receiptId,splitItemId,freshOrderId,ids.store,ids.product,ids.stock,ids.employee]);
  // Receipt posted after mutation preflight must still block a source rewrite after the shared lock.
  beforeTransaction=insertPostedReceipt;
  assert.equal((await procurement.PATCH(new Request('https://example.test/api/procurement/items',{method:'PATCH',body:JSON.stringify({itemId:splitItemId,historyCorrection:true,actualQuantity:2})}))).status,409);
  assert.equal((await procurement.PATCH(new Request('https://example.test/api/procurement/items',{method:'PATCH',body:JSON.stringify({itemId:splitItemId,historyCorrection:true,productId:replacementId})}))).status,409);
  assert.equal((await procurement.DELETE(new Request('https://example.test/api/procurement/items',{method:'DELETE',body:JSON.stringify({itemId:splitItemId})}))).status,409);
  assert.equal((await orders.DELETE(new Request('https://example.test/api/orders',{method:'DELETE',body:JSON.stringify({orderId:freshOrderNo})}))).status,409);
  assert.equal((await procurement.PATCH(new Request('https://example.test/api/procurement/items',{method:'PATCH',body:JSON.stringify({itemId:splitItemId,deliveryStatus:'received'})}))).status,200);
  assert.equal((await db.query('select mode,purchase_quantity from inventory_stock_receipts where id=$1',[receiptId])).rows[0].mode,'add');
  assert.equal(Number((await db.query('select actual_quantity from purchase_order_items where id=$1',[splitItemId])).rows[0].actual_quantity),4);
  console.log('PASS: posted stock receipts block late source quantity/SKU rewrite and history deletion, while store confirmation remains available');

} catch (error) {
  console.error(`FAIL: ${error.message}${error.code ? ` (${error.code})` : ''}`);
  process.exitCode = 1;

} finally { await db.close(); }
