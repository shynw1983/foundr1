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
const session = { id: ids.employee, role: 'owner' };
const sql = Object.assign((parts, ...values) => ({
  text: parts.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), ''), values,
  then(resolve, reject) { return db.query(this.text, this.values).then(result => result.rows).then(resolve, reject); }
}), {
  transaction: statements => db.transaction(async transaction => {
    const results = [];
    for (const statement of statements) results.push((await transaction.query(statement.text, statement.values)).rows);
    return results;
  })
});
function load(path, modules = {}) {
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
    create table products(id uuid primary key, name text, category text, unit text, storage_type text, brand_scope text default 'common', reference_price numeric);
    create table brands(id uuid primary key, name text);
    create table store_brands(store_id uuid, brand_id uuid);
    create table product_brand_usages(product_id uuid, brand_id uuid, is_orderable boolean default true);
    create table purchase_orders(id uuid primary key, order_no text, store_id uuid, brand_id uuid);
    create table purchase_order_items(id uuid primary key, purchase_order_id uuid, product_id uuid, brand_id uuid, requested_quantity numeric, requested_unit text, actual_quantity numeric, actual_price numeric, status text, temporary_product_name text default '', temporary_product_unit text default '', selected_supplier_id uuid, procurement_note text default '', price_exception_note text default '', note text default '', store_feedback_confirmed_at timestamptz, store_feedback_confirmed_by uuid);
    create table purchase_actuals(id uuid primary key default gen_random_uuid(), purchase_order_item_id uuid, actual_quantity numeric, actual_price numeric, supplier_id uuid, supplier_location_id uuid, actual_unit text, price_is_exception boolean, note text, recorded_by uuid, recorded_at timestamptz default now());
    create table price_records(id uuid primary key default gen_random_uuid(), product_id uuid, price numeric, supplier_id uuid, unit text, source text, receipt_note text, recorded_by uuid);
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
  assert.equal((await db.query('select catalog_visibility from products')).rows[0].catalog_visibility, 'internal');
  assert.equal((await db.query('select count_unit from inventory_checks')).rows[0].count_unit, '');
  await assert.rejects(db.query("update products set catalog_visibility='invalid'"));
  console.log('PASS: migration repeat, defaults, constraint and unknown historical unit');

  const catalogPolicy = load('lib/product-catalog-policy.ts');
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
  allowed = false;
  assert.equal((await patch(procurement, { clearActualPrice: true })).status, 403);
  console.log('PASS: real confirmation CTE, facts retained, retry idempotence, stale snapshot and access denied');
} catch (error) {
  console.error(`FAIL: ${error.message}${error.code ? ` (${error.code})` : ''}`);
  process.exitCode = 1;
} finally { await db.close(); }
