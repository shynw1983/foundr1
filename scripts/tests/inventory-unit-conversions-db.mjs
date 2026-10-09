// Real migration and route SQL in isolated PostgreSQL. Never reads DATABASE_URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const db = new PGlite();
const ids = Object.fromEntries(['store', 'otherStore', 'employee', 'product', 'hidden', 'location', 'stock', 'oldCheck'].map((key, i) => [key, `00000000-0000-4000-8000-${String(300 + i).padStart(12, '0')}`]));
let session = { id: ids.employee, role: 'store_manager' };
let allowed = true;
let inventoryPermission = true;
let beforeCount = null;
const statements = [];
async function execute(statement, connection = db) {
  statements.push(statement.text);
  if (statement.text.includes('), counted as (') && beforeCount) {
    const hook = beforeCount; beforeCount = null;
    await hook();
  }
  return (await connection.query(statement.text, statement.values)).rows;
}
const sql = Object.assign((parts, ...values) => ({
  text: parts.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), ''), values,
  then(resolve, reject) { return execute(this).then(resolve, reject); }
}), {
  transaction: statements => db.transaction(async transaction => {
    const results = [];
    for (const statement of statements) results.push(await execute(statement, transaction));
    return results;
  })
});
function load(path, modules = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(source, { exports, Response, Request, URL, console, require: name => {
    if (name.endsWith('/api-auth')) return {
      requireOsSession: async () => session,
      canAccessStore: async (_, storeId) => allowed && storeId === ids.store,
      getSessionStoreScope: async () => ({ allStores: false, storeIds: allowed ? [ids.store] : [] })
    };
    if (name.endsWith('/db')) return { sql };
    if (name.endsWith('/role-permissions')) return { roleHasPermission: async () => inventoryPermission };
    if (name in modules) return modules[name];
    throw new Error(`Unmocked isolated dependency: ${name}`);
  } });
  return exports;
}
const fractionUnits = [
  { unit: '1/4袋', unitsPerPurchase: 4, fractionalDenominator: 4 },
  { unit: '1/3袋', unitsPerPurchase: 3, fractionalDenominator: 3 }
];
const snapshot = { purchaseUnit: '袋', countUnit: '1/4袋', unitsPerPurchase: 4 };
try {
  await db.exec(`
    create table stores(id uuid primary key, name text, status text default 'active');
    create table store_brands(store_id uuid, brand_id uuid);
    create table employees(id uuid primary key, name text);
    create table products(id uuid primary key, name text, category text default '', unit text, storage_type text default '', package_quantity numeric, package_quantity_unit text, brand_scope text default 'common', catalog_visibility text default 'brand_stores', is_orderable boolean default true);
    create table product_brand_usages(product_id uuid, brand_id uuid, is_orderable boolean);
    create table product_catalog_store_grants(product_id uuid, store_id uuid);
    create table purchase_orders(id uuid primary key, store_id uuid);
    create table purchase_order_items(id uuid primary key, purchase_order_id uuid, product_id uuid);
    create table delivery_batches(id uuid primary key);
    create table purchase_actuals(id uuid primary key);
    create table inventory_locations(id uuid primary key, store_id uuid, name text, equipment_brand text default '', equipment_name text default '', position_name text default '', location_type text default 'ambient', sort_order integer default 0, status text default 'active');
    create table inventory_items(id uuid primary key default gen_random_uuid(), store_id uuid, product_id uuid, location_id uuid, count_unit text, safety_stock numeric(12,2), current_quantity numeric(12,2), exception_code text default '', exception_note text default '', last_counted_at timestamptz, last_counted_by uuid, status text default 'active', updated_at timestamptz default now(), unique(store_id,product_id,location_id));
    create table inventory_checks(id uuid primary key default gen_random_uuid(), inventory_item_id uuid, store_id uuid, product_id uuid, quantity numeric(12,2), count_unit text default '', record_type text, exception_code text, note text default '', recorded_by uuid, created_at timestamptz default now());
    insert into stores(id,name) values('${ids.store}','A'),('${ids.otherStore}','B');
    insert into employees values('${ids.employee}','Tester');
    insert into products(id,name,unit,package_quantity,package_quantity_unit) values('${ids.product}','SKU','袋',12,'個');
    insert into products(id,name,unit,catalog_visibility) values('${ids.hidden}','Hidden','箱','internal');
    insert into inventory_locations(id,store_id,name) values('${ids.location}','${ids.store}','Shelf');
    insert into inventory_items(id,store_id,product_id,location_id,count_unit,safety_stock,current_quantity,last_counted_at,last_counted_by) values('${ids.stock}','${ids.store}','${ids.product}','${ids.location}','1/4袋',1.25,2.50,'2026-10-01','${ids.employee}');
    insert into inventory_checks(id,inventory_item_id,store_id,product_id,quantity,count_unit,record_type) values('${ids.oldCheck}','${ids.stock}','${ids.store}','${ids.product}',2.50,'1/4袋','count');
  `);
  const migration = readFileSync(new URL('db/migrations/20261008_product_unit_conversions.sql', root), 'utf8');
  await db.exec(migration); await db.exec(migration);
  const stockMigration = readFileSync(new URL('db/migrations/20261009_inventory_receipts.sql', root), 'utf8');
  await db.exec(stockMigration); await db.exec(stockMigration);
  await db.exec(readFileSync(new URL('db/migrations/20261009_inventory_quick_checks.sql', root), 'utf8'));
  const legacy = (await db.query('select current_quantity,safety_stock,count_conversion_snapshot from inventory_items')).rows[0];
  assert.equal(Number(legacy.current_quantity), 2.5);
  assert.equal(Number(legacy.safety_stock), 1.25);
  assert.equal(legacy.count_conversion_snapshot, null);
  const legacyStock = (await db.query('select stock_quantity,stock_conversion_snapshot,stock_revision,last_received_at from inventory_items')).rows[0];
  assert.equal(Number(legacyStock.stock_quantity), 2.5);
  assert.equal(legacyStock.stock_conversion_snapshot, null);
  assert.equal(Number(legacyStock.stock_revision), 0);
  assert.equal(legacyStock.last_received_at, null);
  assert.equal((await db.query('select unit_conversion_snapshot from inventory_checks')).rows[0].unit_conversion_snapshot, null);
  assert.equal(Number((await db.query("select numeric_scale from information_schema.columns where table_name='inventory_items' and column_name='current_quantity'")).rows[0].numeric_scale), 6);
  await db.query('update products set inventory_unit_conversions=$1::jsonb where id=$2', [JSON.stringify(fractionUnits), ids.product]);
  console.log('PASS: idempotent migration preserves values and leaves historical conversion snapshots unknown');

  const units = load('lib/product-unit-conversions.ts');
  const quickPolicy = load('lib/inventory-quick-policy.ts');
  const catalogPolicy = load('lib/product-catalog-policy.ts', { './product-unit-conversions.ts': units });
  const catalog = load('lib/product-catalog-access.ts', { './product-catalog-policy': catalogPolicy });
  const route = load('app/api/inventory/route.ts', {
    '../../../lib/product-unit-conversions': units,
    '../../../lib/inventory-quick-policy': quickPolicy,
    '../../../lib/product-catalog-access': catalog
  });
  const post = body => route.POST(new Request('https://example.test/api/inventory', { method: 'POST', body: JSON.stringify({ storeId: ids.store, itemId: ids.stock, ...body }) }));
  const get = () => route.GET(new Request(`https://example.test/api/inventory?storeId=${ids.store}`));
  let state = await (await get()).json();
  assert.equal(state.items[0].purchaseEquivalent, null);
  assert.equal(state.items[0].conversionChanged, false);
  assert.deepEqual(state.items[0].currentConversion, snapshot);
  assert.ok(state.products[0].inventoryUnitChoices.some(choice => choice.countUnit === '個' && choice.unitsPerPurchase === 12));
  assert.ok(!state.products.some(product => product.id === ids.hidden));
  assert.equal(state.recentChecks[0].purchaseEquivalent, null);
  assert.equal(state.items[0].currentQuantity, 2.5);
  assert.equal(state.items[0].lastCountedQuantity, 2.5);
  assert.equal(state.items[0].stockRevision, 0);

  let response = await post({ action: 'count', quantity: '1/8', countUnit: '1/4袋', expectedConversion: snapshot });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count.quantity, 0.125);
  let fact = (await db.query('select current_quantity,count_conversion_snapshot from inventory_items')).rows[0];
  assert.equal(Number(fact.current_quantity), 0.125);
  assert.deepEqual(fact.count_conversion_snapshot, snapshot);
  const firstHistory = (await db.query("select quantity,unit_conversion_snapshot from inventory_checks where id<>$1 order by created_at desc", [ids.oldCheck])).rows[0];
  assert.equal(Number(firstHistory.quantity), 0.125);
  assert.deepEqual(firstHistory.unit_conversion_snapshot, snapshot);
  const countStatement = statements.find(text => text.includes('), counted as ('));
  assert.ok(countStatement.indexOf('for share of products') < countStatement.indexOf('for update of items'));
  assert.ok(countStatement.includes('from locked_product join inventory_items'));
  assert.equal((await post({ action: 'count', quantity: '1/3', countUnit: '1/4袋', expectedConversion: snapshot })).status, 400);
  console.log('PASS: fractional input persists six-digit physical quantities atomically with snapshots, and non-terminating input is rejected');

  assert.equal((await post({ action: 'configure', productId: ids.product, locationId: ids.location, countUnit: '1/3袋', safetyStock: 1 })).status, 200);
  assert.equal((await post({ action: 'count', quantity: 1, countUnit: '1/3袋', expectedConversion: { purchaseUnit: '袋', countUnit: '1/3袋', unitsPerPurchase: 3 } })).status, 200);
  fact = (await db.query('select current_quantity,count_conversion_snapshot from inventory_items')).rows[0];
  assert.equal(Number(fact.current_quantity), 1);
  assert.equal(fact.count_conversion_snapshot.unitsPerPurchase, 3);
  assert.equal((await post({ action: 'configure', productId: ids.product, locationId: ids.location, countUnit: '個', safetyStock: 1 })).status, 200);
  assert.equal((await post({ action: 'count', quantity: 6, countUnit: '個', expectedConversion: { purchaseUnit: '袋', countUnit: '個', unitsPerPurchase: 12 } })).status, 200);
  await db.query('update products set package_quantity=24 where id=$1', [ids.product]);
  state = await (await get()).json();
  assert.equal(state.items[0].conversionChanged, true);
  assert.deepEqual(state.items[0].purchaseEquivalent, { quantity: 0.5, unit: '袋' });
  assert.equal(state.items[0].currentConversion.unitsPerPurchase, 24);
  console.log('PASS: named 1/3 unit records a literal one, and packaging changes retain the historical conversion');

  const changed = [{ unit: '1/4袋', unitsPerPurchase: 4, fractionalDenominator: 4 }, { unit: 'portion', unitsPerPurchase: 8 }];
  await db.query('update products set unit=$1,inventory_unit_conversions=$2::jsonb where id=$3', ['袋', JSON.stringify(changed), ids.product]);
  // A named unit has an explicit factor. Changing that factor cannot rewrite old counts.
  await post({ action: 'configure', productId: ids.product, locationId: ids.location, countUnit: 'portion', safetyStock: 1 });
  const portionSnapshot = { purchaseUnit: '袋', countUnit: 'portion', unitsPerPurchase: 8 };
  assert.equal((await post({ action: 'count', quantity: 2, countUnit: 'portion', expectedConversion: portionSnapshot })).status, 200);
  await db.query('update products set inventory_unit_conversions=$1::jsonb where id=$2', [JSON.stringify([{ unit: 'portion', unitsPerPurchase: 16 }]), ids.product]);
  state = await (await get()).json();
  assert.equal(state.items[0].currentQuantity, 2);
  assert.equal(state.items[0].conversionChanged, true);
  assert.deepEqual(state.items[0].purchaseEquivalent, { quantity: 0.25, unit: '袋' });
  assert.deepEqual(state.items[0].currentConversion, { ...portionSnapshot, unitsPerPurchase: 16 });
  assert.equal((await post({ action: 'count', quantity: 3, countUnit: 'portion', expectedConversion: portionSnapshot })).status, 409);
  const beforeConfigure = (await db.query('select current_quantity,last_counted_at,count_conversion_snapshot from inventory_items')).rows[0];
  await post({ action: 'configure', productId: ids.product, locationId: ids.location, countUnit: 'portion', safetyStock: 2 });
  const afterConfigure = (await db.query('select current_quantity,last_counted_at,count_conversion_snapshot from inventory_items')).rows[0];
  assert.deepEqual(afterConfigure, beforeConfigure);
  console.log('PASS: factor-only changes preserve the recorded count and old equivalent, flag mismatch, and reject stale web snapshots');

  const refreshed = { ...portionSnapshot, unitsPerPurchase: 16 };
  const historyBeforeRace = Number((await db.query('select count(*) from inventory_checks')).rows[0].count);
  beforeCount = async () => db.query('update products set inventory_unit_conversions=$1::jsonb where id=$2', [JSON.stringify([{ unit: 'portion', unitsPerPurchase: 32 }]), ids.product]);
  assert.equal((await post({ action: 'count', quantity: 5, countUnit: 'portion', expectedConversion: refreshed })).status, 409);
  assert.equal(Number((await db.query('select current_quantity from inventory_items')).rows[0].current_quantity), 2);
  assert.equal(Number((await db.query('select count(*) from inventory_checks')).rows[0].count), historyBeforeRace);
  // Deployed native clients omit expectedConversion; their literal unit count is retained.
  response = await post({ action: 'count', quantity: 3.25, countUnit: 'portion' });
  assert.equal(response.status, 200);
  fact = (await db.query('select current_quantity,count_conversion_snapshot from inventory_items')).rows[0];
  assert.equal(Number(fact.current_quantity), 3.25);
  assert.equal(fact.count_conversion_snapshot.unitsPerPurchase, 32);
  assert.equal((await db.query('select unit_conversion_snapshot from inventory_checks where id=$1', [ids.oldCheck])).rows[0].unit_conversion_snapshot, null);
  console.log('PASS: configuration change after the initial read rejects without count/history writes; legacy clients retain literal-unit semantics');

  await post({ action: 'configure', productId: ids.product, locationId: ids.location, countUnit: 'custom scoop', safetyStock: '0.125' });
  fact = (await db.query('select current_quantity,last_counted_at,count_conversion_snapshot,safety_stock from inventory_items')).rows[0];
  assert.equal(fact.current_quantity, null);
  assert.equal(fact.last_counted_at, null);
  assert.equal(fact.count_conversion_snapshot, null);
  assert.equal(Number(fact.safety_stock), 0.125);
  assert.equal((await post({ action: 'count', quantity: 1, countUnit: 'custom scoop', expectedConversion: null })).status, 200);
  state = await (await get()).json();
  assert.equal(state.items[0].currentConversion, null);
  assert.equal(state.items[0].countConversionSnapshot, null);
  assert.equal(state.items[0].purchaseEquivalent, null);
  const initialPhysical = (await db.query('select current_quantity,last_counted_at from inventory_items')).rows[0];
  assert.equal((await post({ action: 'exception', exceptionCode: 'out' })).status, 200);
  const exceptionFacts = (await db.query('select current_quantity,stock_quantity,last_counted_at from inventory_items')).rows[0];
  assert.equal(Number(exceptionFacts.current_quantity), 1);
  assert.equal(Number(exceptionFacts.stock_quantity), 1);
  assert.equal(+new Date(exceptionFacts.last_counted_at), +new Date(initialPhysical.last_counted_at));
  await post({ action: 'exception', exceptionCode: '' });

  const revision = Number((await db.query('select stock_revision from inventory_items')).rows[0].stock_revision);
  beforeCount = async () => db.exec(`update inventory_items set stock_quantity=stock_quantity+2, stock_revision=stock_revision+1,last_received_at=now() where id='${ids.stock}';`);
  const historyBeforeReceiptRace = Number((await db.query('select count(*) from inventory_checks')).rows[0].count);
  assert.equal((await post({ action: 'count', quantity: 9, countUnit: 'custom scoop', expectedConversion: null, expectedStockRevision: revision })).status, 409);
  const afterReceipt = (await db.query('select current_quantity,stock_quantity,stock_revision,last_counted_at,last_received_at from inventory_items')).rows[0];
  assert.equal(Number(afterReceipt.current_quantity), 1);
  assert.equal(Number(afterReceipt.stock_quantity), 3);
  assert.equal(+new Date(afterReceipt.last_counted_at), +new Date(initialPhysical.last_counted_at));
  assert.equal(Number((await db.query('select count(*) from inventory_checks')).rows[0].count), historyBeforeReceiptRace);
  assert.equal((await post({ action: 'count', quantity: 9, countUnit: 'custom scoop' })).status, 409);
  state = await (await get()).json();
  assert.equal(state.items[0].currentQuantity, 3);
  assert.equal(state.items[0].lastCountedQuantity, 1);
  assert.ok(state.items[0].lastReceivedAt);
  assert.equal((await post({ action: 'count', quantity: 3, countUnit: 'custom scoop', expectedConversion: null, expectedStockRevision: Number(afterReceipt.stock_revision) })).status, 200);
  const refreshedStock = (await db.query('select stock_quantity,current_quantity,stock_revision from inventory_items')).rows[0];
  assert.equal(Number(refreshedStock.stock_quantity), 3);
  assert.equal(Number(refreshedStock.current_quantity), 3);
  assert.equal(Number(refreshedStock.stock_revision), Number(afterReceipt.stock_revision) + 1);
  console.log('PASS: out is an observation; receipt during counting preserves physical facts, updates book stock, and requires revision-aware recount');
  await db.exec('alter table inventory_checks add constraint simulated_history_failure check(quantity<>7);');
  await assert.rejects(post({ action: 'count', quantity: 7, countUnit: 'custom scoop', expectedConversion: null, expectedStockRevision: Number(refreshedStock.stock_revision) }));
  assert.equal(Number((await db.query('select current_quantity from inventory_items')).rows[0].current_quantity), 3);
  await db.exec('alter table inventory_checks drop constraint simulated_history_failure;');
  const beforeDenied = statements.length;
  assert.equal((await post({ action: 'count', storeId: ids.otherStore, quantity: 9, countUnit: 'custom scoop' })).status, 403);
  assert.equal(statements.length, beforeDenied);
  assert.equal((await post({ action: 'configure', productId: ids.hidden, locationId: ids.location, countUnit: '箱' })).status, 403);
  inventoryPermission = false;
  assert.equal((await post({ action: 'count', quantity: 9, countUnit: 'custom scoop' })).status, 403);
  console.log('PASS: custom unknown units stay unknown, a unit change clears the count snapshot, exact thresholds survive, and scope/catalog permissions apply');
} finally {
  await db.close();
}
