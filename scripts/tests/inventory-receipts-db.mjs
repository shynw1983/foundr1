// Production receipt SQL in isolated PostgreSQL. Never reads DATABASE_URL or contacts production.
// FOUNDR1_PGLITE_MODULE may point to a temporary @electric-sql/pglite installation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const db = new PGlite();
const uuid = n => `00000000-0000-4000-8000-${String(600 + n).padStart(12, '0')}`;
const ids = Object.fromEntries([
  'store', 'otherStore', 'employee', 'product', 'privateProduct', 'unrelatedPrivateProduct',
  'location', 'secondLocation', 'thirdLocation', 'otherLocation', 'stock', 'legacyStock', 'privateStock',
  'unknownStock', 'wrongLocationStock', 'order', 'otherOrder', 'line', 'privateLine', 'otherLine',
  'requestedLine', 'unknownQuantityLine', 'unknownUnitLine', 'mismatchedActualLine',
  'actual', 'privateActual', 'otherActual', 'mismatchedActual', 'check', 'deliveryBatch', 'otherBatch', 'actualOnlyLine', 'actualOnlyActual'
].map((key, index) => [key, uuid(index + 1)]));
const conversion = { purchaseUnit: '箱', countUnit: '袋', unitsPerPurchase: 12 };
let session = { id: ids.employee, name: 'Tester', role: 'store_manager' };
let storeAllowed = true;
let scopedStoreId = ids.store;
let inventoryAllowed = true;
let beforeWrite = null;
const statements = [];

async function runHook() {
  if (!beforeWrite) return;
  const hook = beforeWrite;
  beforeWrite = null;
  await hook();
}
async function execute(statement, connection = db) {
  statements.push(statement.text);
  if (connection === db && /insert\s+into\s+inventory_stock_receipts/i.test(statement.text)) await runHook();
  return (await connection.query(statement.text, statement.values)).rows;
}
const sql = Object.assign((parts, ...values) => ({
  text: parts.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), ''),
  values,
  then(resolve, reject) { return execute(this).then(resolve, reject); }
}), {
  transaction: async queries => {
    await runHook();
    return db.transaction(async transaction => {
      const rows = [];
      for (const statement of queries) rows.push(await execute(statement, transaction));
      return rows;
    });
  }
});

function load(path, modules = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports, Response, Request, URL, console,
    require: name => {
      if (name.endsWith('/db') || name === './db') return { sql };
      if (name.endsWith('/api-auth')) return {
        requireOsSession: async () => session,
        requireWritableOsSession: async () => session && session.role !== 'store_terminal' ? session : null,
        canAccessStore: async (_, storeId) => storeAllowed && storeId === scopedStoreId,
        getSessionStoreScope: async () => ({ allStores: false, storeIds: storeAllowed ? [scopedStoreId] : [] })
      };
      if (name.endsWith('/role-permissions')) return { roleHasPermission: async () => inventoryAllowed };
      if (name === 'node:crypto' || name === 'crypto') return require(name);
      if (name.endsWith('/order-realtime') || name.endsWith('/notification-realtime')) return {
        publishStoreOperationalEvent: async () => undefined, publishOsNotificationEvent: async () => undefined
      };
      if (name in modules) return modules[name];
      throw new Error(`Unmocked isolated receipt dependency: ${name}`);
    }
  });
  return exports;
}

async function createOldDatabase() {
  await db.exec(`
    create table stores(id uuid primary key,name text,status text not null default 'active');
    create table employees(id uuid primary key,name text);
    create table suppliers(id uuid primary key,name text);
    create table store_brands(store_id uuid,brand_id uuid);
    create table products(id uuid primary key,name text,unit text,category text default '',storage_type text default '',
      package_quantity numeric(12,3),package_quantity_unit text,inventory_unit_conversions jsonb not null default '[]'::jsonb,
      brand_scope text not null default 'common',catalog_visibility text not null default 'brand_stores',is_orderable boolean not null default true);
    create table product_brand_usages(product_id uuid,brand_id uuid,is_orderable boolean);
    create table product_catalog_store_grants(product_id uuid,store_id uuid);
    create table inventory_locations(id uuid primary key,store_id uuid references stores(id),name text,
      status text default 'active',sort_order integer default 0);
    create table inventory_items(id uuid primary key default gen_random_uuid(),store_id uuid references stores(id) on delete cascade,
      product_id uuid references products(id) on delete cascade,location_id uuid references inventory_locations(id) on delete cascade,
      count_unit text,safety_stock numeric(18,6),current_quantity numeric(18,6),count_conversion_snapshot jsonb,
      exception_code text default '',exception_note text default '',last_counted_at timestamptz,last_counted_by uuid references employees(id),
      status text default 'active',created_at timestamptz default now(),updated_at timestamptz default now(),
      unique(store_id,product_id,location_id));
    create table inventory_checks(id uuid primary key default gen_random_uuid(),inventory_item_id uuid references inventory_items(id) on delete cascade,
      store_id uuid references stores(id) on delete cascade,product_id uuid references products(id) on delete cascade,quantity numeric(18,6),count_unit text,
      unit_conversion_snapshot jsonb,record_type text default 'count',exception_code text default '',note text default '',
      recorded_by uuid references employees(id),created_at timestamptz default now());
    create table purchase_orders(id uuid primary key,order_no text unique,store_id uuid references stores(id),
      status text default 'submitted',created_at timestamptz default now(),updated_at timestamptz default now());
    create table purchase_order_items(id uuid primary key,purchase_order_id uuid references purchase_orders(id) on delete cascade,
      product_id uuid references products(id),requested_quantity numeric(12,2),requested_unit text,
      actual_quantity numeric(12,2),status text,temporary_product_name text default '',temporary_product_unit text default '個');
    create table purchase_actuals(id uuid primary key default gen_random_uuid(),purchase_order_item_id uuid references purchase_order_items(id) on delete cascade,
      actual_quantity numeric(12,2),actual_unit text,recorded_at timestamptz not null default now());
    create table price_records(id uuid primary key default gen_random_uuid(),product_id uuid references products(id),supplier_id uuid references suppliers(id),
      price numeric(12,2),unit text,recorded_at timestamptz default now());
    create table product_supplier_options(id uuid primary key default gen_random_uuid(),product_id uuid references products(id),supplier_id uuid references suppliers(id),reference_price numeric(12,2));
    create table delivery_batches(id uuid primary key,purchase_order_id uuid references purchase_orders(id) on delete cascade,batch_no integer,
      status text,created_at timestamptz default now(),delivered_at timestamptz,store_confirmed_at timestamptz,store_confirmed_by uuid);
    create table delivery_batch_items(delivery_batch_id uuid references delivery_batches(id) on delete cascade,purchase_order_item_id uuid references purchase_order_items(id) on delete cascade,
      primary key(delivery_batch_id,purchase_order_item_id));
    insert into stores(id,name) values('${ids.store}','A'),('${ids.otherStore}','B');
    insert into employees values('${ids.employee}','Tester');
    insert into products(id,name,unit,package_quantity,package_quantity_unit) values('${ids.product}','SKU','箱',12,'袋');
    insert into products(id,name,unit,package_quantity,package_quantity_unit,catalog_visibility,is_orderable) values
      ('${ids.privateProduct}','Stopped private historical SKU','箱',12,'袋','internal',false),
      ('${ids.unrelatedPrivateProduct}','Unrelated private SKU','箱',12,'袋','internal',false);
    insert into inventory_locations(id,store_id,name) values
      ('${ids.location}','${ids.store}','Shelf'),('${ids.secondLocation}','${ids.store}','Second shelf'),
      ('${ids.thirdLocation}','${ids.store}','Unknown shelf'),
      ('${ids.otherLocation}','${ids.otherStore}','Other store shelf');
    insert into inventory_items(id,store_id,product_id,location_id,count_unit,safety_stock,current_quantity,
      count_conversion_snapshot,exception_code,exception_note,last_counted_at,last_counted_by) values
      ('${ids.stock}','${ids.store}','${ids.product}','${ids.location}','袋',1,6,
        '${JSON.stringify(conversion)}','quality','Preserve quality evidence','2026-10-08T12:00:00Z','${ids.employee}'),
      ('${ids.legacyStock}','${ids.store}','${ids.product}','${ids.secondLocation}','袋',1,2,null,
        'damaged','Preserve damaged evidence','2026-10-08T12:00:00Z','${ids.employee}'),
      ('${ids.privateStock}','${ids.store}','${ids.privateProduct}','${ids.location}','袋',1,6,
        '${JSON.stringify(conversion)}','','','2026-10-08T12:00:00Z','${ids.employee}'),
      ('${ids.unknownStock}','${ids.store}','${ids.product}','${ids.thirdLocation}','袋',1,null,null,
        'low','Unknown initial quantity',null,null),
      ('${ids.wrongLocationStock}','${ids.store}','${ids.product}','${ids.otherLocation}','袋',1,6,
        '${JSON.stringify(conversion)}','','','2026-10-08T12:00:00Z','${ids.employee}');
    insert into inventory_checks(id,inventory_item_id,store_id,product_id,quantity,count_unit,unit_conversion_snapshot,recorded_by)
      values('${ids.check}','${ids.stock}','${ids.store}','${ids.product}',6,'袋','${JSON.stringify(conversion)}','${ids.employee}');
    insert into purchase_orders(id,order_no,store_id) values('${ids.order}','PO-RECEIPT','${ids.store}'),('${ids.otherOrder}','PO-OTHER','${ids.otherStore}');
    insert into purchase_order_items(id,purchase_order_id,product_id,requested_quantity,requested_unit,actual_quantity,status) values
      ('${ids.line}','${ids.order}','${ids.product}',4,'箱',4,'delivered'),
      ('${ids.privateLine}','${ids.order}','${ids.privateProduct}',4,'箱',4,'received'),
      ('${ids.otherLine}','${ids.otherOrder}','${ids.product}',4,'箱',4,'delivered'),
      ('${ids.requestedLine}','${ids.order}','${ids.product}',4,'箱',4,'purchased'),
      ('${ids.unknownQuantityLine}','${ids.order}','${ids.product}',4,'箱',null,'delivered'),
      ('${ids.unknownUnitLine}','${ids.order}','${ids.product}',4,'箱',4,'delivered'),
      ('${ids.mismatchedActualLine}','${ids.order}','${ids.product}',4,'箱',4,'delivered'),
      ('${ids.actualOnlyLine}','${ids.order}','${ids.product}',4,'箱',null,'delivered');
    insert into purchase_actuals(id,purchase_order_item_id,actual_quantity,actual_unit,recorded_at) values
      ('${ids.actual}','${ids.line}',4,'箱','2026-10-08T10:00:00Z'),
      ('${ids.privateActual}','${ids.privateLine}',4,'箱','2026-10-08T10:00:00Z'),
      ('${ids.otherActual}','${ids.otherLine}',4,'箱','2026-10-08T10:00:00Z'),
      ('${ids.mismatchedActual}','${ids.mismatchedActualLine}',3,'箱','2026-10-08T10:00:00Z'),
      ('${ids.actualOnlyActual}','${ids.actualOnlyLine}',2,'箱','2026-10-08T10:00:00Z');
    insert into delivery_batches(id,purchase_order_id,batch_no,status,delivered_at) values
      ('${ids.deliveryBatch}','${ids.order}',1,'delivered','2026-10-08T11:00:00Z'),
      ('${ids.otherBatch}','${ids.otherOrder}',1,'delivered','2026-10-08T11:00:00Z');
    insert into delivery_batch_items values('${ids.deliveryBatch}','${ids.line}'),('${ids.otherBatch}','${ids.otherLine}');
  `);
}

const stock = async stockId => (await db.query('select * from inventory_items where id=$1', [stockId])).rows[0];
async function persistedState() {
  const state = {};
  for (const [table, order] of [
    ['products', 'id'], ['purchase_orders', 'id'], ['purchase_order_items', 'id'], ['purchase_actuals', 'id'],
    ['delivery_batches', 'id'], ['delivery_batch_items', 'delivery_batch_id,purchase_order_item_id'],
    ['inventory_locations', 'id'], ['inventory_items', 'id'], ['inventory_checks', 'id'], ['inventory_stock_receipts', 'id'], ['inventory_movements','id']
  ]) state[table] = (await db.query(`select * from ${table} order by ${order}`)).rows;
  return state;
}

let route;
let requestSequence = 200;
const requestId = () => uuid(requestSequence++);
const get = (storeId = ids.store) => route.GET(new Request(`https://example.test/api/inventory/receipts?storeId=${storeId}`));
const post = body => route.POST(new Request('https://example.test/api/inventory/receipts', {
  method: 'POST', body: JSON.stringify(body)
}));
async function read() {
  const response = await get(scopedStoreId);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function receiptBody(overrides = {}) {
  const purchaseOrderItemId = overrides.purchaseOrderItemId ?? ids.line;
  const inventoryItemId = overrides.inventoryItemId ?? ids.stock;
  const source = overrides.expectedSource ? { expectedSource: overrides.expectedSource }
    : (await read()).sources.find(item => item.purchaseOrderItemId === purchaseOrderItemId);
  assert.ok(source, `Source ${purchaseOrderItemId} is present in the scoped reader`);
  const target = await stock(inventoryItemId);
  assert.ok(target);
  return {
    requestId: requestId(), purchaseOrderItemId, inventoryItemId,
    purchaseQuantity: 0.125, mode: 'add', expectedSource: source.expectedSource,
    expectedStockRevision: target.stock_revision, expectedConversion: conversion,
    ...overrides
  };
}
async function rejectsWithoutChanges(body, status, label) {
  const before = await persistedState();
  const response = await post(body);
  assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${label}: ${response.status} ${await response.text()}`);
  assert.deepEqual(await persistedState(), before, `${label}: no persisted changes`);
}
const physicalFact = row => ({
  quantity: row.current_quantity, snapshot: row.count_conversion_snapshot,
  countedAt: row.last_counted_at, countedBy: row.last_counted_by
});

try {
  await createOldDatabase();
  const beforeMigration = (await db.query('select * from inventory_items order by id')).rows;
  const migration = readFileSync(new URL('db/migrations/20261009_inventory_receipts.sql', root), 'utf8');
  await db.exec(migration);
  for (const before of beforeMigration) {
    const after = await stock(before.id);
    assert.equal(Number(after.stock_quantity), Number(before.current_quantity));
    if (before.current_quantity === null) assert.equal(after.stock_quantity, null);
    assert.deepEqual(after.stock_conversion_snapshot, before.count_conversion_snapshot);
    assert.deepEqual(physicalFact(after), physicalFact(before));
    assert.equal(after.stock_revision, 0);
  }
  await db.query('update inventory_items set stock_quantity=8,stock_revision=1 where id=$1', [ids.stock]);
  const changedBook = await stock(ids.stock);
  await db.exec(migration);
  assert.deepEqual(await stock(ids.stock), changedBook);
  await db.query('update inventory_items set stock_quantity=6,stock_revision=0 where id=$1', [ids.stock]);
  console.log('PASS: one-time book initialization retains physical facts, unknown historical snapshots and later book/revision changes');

  const packagingMigration=readFileSync(new URL('db/migrations/20261011_product_packaging.sql',root),'utf8');
  await db.exec(packagingMigration);
  await db.exec(packagingMigration);
  const movementMigration=readFileSync(new URL('db/migrations/20261011_inventory_order_usage.sql',root),'utf8');
  await db.exec(movementMigration.match(/create table if not exists inventory_movements[\s\S]+?\n\);/)[0]);
  await db.exec(readFileSync(new URL('db/migrations/20261009_inventory_quick_checks.sql',root),'utf8'));
  await db.exec(readFileSync(new URL('db/migrations/20261011_inventory_usage_reconciliation.sql',root),'utf8'));
  await db.exec(`create table inventory_order_usage_issues(id uuid primary key default gen_random_uuid(),order_id uuid,store_id uuid,code text,details jsonb default '{}',created_at timestamptz default now(),resolved_at timestamptz);`);
  assert.equal((await db.query('select count(*)::int as n from purchase_order_items where actual_packaging_snapshot is not null')).rows[0].n,0);

  const units = load('lib/product-unit-conversions.ts');
  const packaging=load('lib/product-packaging-policy.ts',{'./product-unit-conversions':units});
  const packagingData=load('lib/product-packaging-data.ts',{'./product-packaging-policy':packaging,'./product-catalog-access':{
    assertProductViewable:async()=>({ok:true}),assertProductViewableAtStore:async()=>({ok:true})
  }});
  const policy = load('lib/inventory-receipt-policy.ts', { './product-unit-conversions': units,'./product-packaging-policy':packaging });
  const locks = load('lib/replenishment-order-locks.ts');
  const data = load('lib/inventory-receipt-data.ts', {
    './product-unit-conversions': units, './inventory-receipt-policy': policy, './replenishment-order-locks': locks,
    './product-packaging-policy':packaging,'./product-packaging-data':packagingData
  });
  route = load('app/api/inventory/receipts/route.ts', {
    '../../../../lib/product-unit-conversions': units,
    '../../../../lib/inventory-receipt-policy': policy,
    '../../../../lib/inventory-receipt-data': data
  });
  const initial = await read();
  assert.ok(initial.sources.some(item => item.purchaseOrderItemId === ids.line));
  assert.ok(initial.sources.some(item => item.purchaseOrderItemId === ids.privateLine));
  assert.ok(!JSON.stringify(initial).includes('PO-OTHER'));
  assert.ok(!JSON.stringify(initial).includes('Unrelated private SKU'));
  const physicalBeforeAdd = physicalFact(await stock(ids.stock));
  const first = await receiptBody();
  const added = await post(first);
  assert.equal(added.status, 200, await added.clone().text());
  let target = await stock(ids.stock);
  assert.equal(Number(target.stock_quantity), 7.5);
  assert.equal(target.stock_revision, 1);
  assert.deepEqual(target.stock_conversion_snapshot, conversion);
  assert.deepEqual(physicalFact(target), physicalBeforeAdd);
  assert.equal(target.exception_code, 'quality');
  assert.equal(target.exception_note, 'Preserve quality evidence');
  const firstLedger = (await db.query('select * from inventory_stock_receipts where request_id=$1', [first.requestId])).rows[0];
  assert.equal(Number(firstLedger.purchase_quantity), 0.125);
  assert.equal(Number(firstLedger.count_quantity), 1.5);
  assert.equal(Number(firstLedger.before_stock_quantity), 6);
  assert.equal(Number(firstLedger.after_stock_quantity), 7.5);
  assert.deepEqual(firstLedger.conversion_snapshot, conversion);
  assert.equal(firstLedger.purchase_order_item_id, ids.line);
  assert.equal(firstLedger.inventory_item_id, ids.stock);
  assert.equal(firstLedger.recorded_by_name, 'Tester');
  console.log('PASS: exact delivered source adds a six-decimal partial purchase through the explicit conversion and preserves physical/quality evidence');

  const beforeReplay = await persistedState();
  assert.equal((await post(first)).status, 200);
  assert.deepEqual(await persistedState(), beforeReplay);
  await rejectsWithoutChanges({ ...first, purchaseQuantity: 0.25 }, 409, 'same nonce with different quantity');
  await rejectsWithoutChanges({ ...first, mode: 'included' }, 409, 'same nonce with different mode');
  console.log('PASS: identical nonce replay adds no ledger or stock write, while changed payloads reject');

  const beforeIncluded = await stock(ids.stock);
  const included = await receiptBody({ purchaseQuantity: 0.5, mode: 'included' });
  assert.equal((await post(included)).status, 200);
  target = await stock(ids.stock);
  assert.equal(target.stock_quantity, beforeIncluded.stock_quantity);
  assert.equal(target.stock_revision, beforeIncluded.stock_revision + 1);
  assert.deepEqual(physicalFact(target), physicalFact(beforeIncluded));
  const includedLedger = (await db.query('select * from inventory_stock_receipts where request_id=$1', [included.requestId])).rows[0];
  assert.equal(includedLedger.mode, 'included');
  assert.equal(includedLedger.before_stock_quantity, includedLedger.after_stock_quantity);

  await db.query('update inventory_items set stock_conversion_snapshot=$1::jsonb where id=$2', [JSON.stringify(conversion), ids.legacyStock]);
  await rejectsWithoutChanges(await receiptBody({ inventoryItemId: ids.legacyStock, mode: 'included' }), 409, 'unknown physical conversion with known book');
  await db.query('update inventory_items set stock_quantity=6,stock_conversion_snapshot=$1::jsonb where id=$2', [JSON.stringify(conversion), ids.unknownStock]);
  await rejectsWithoutChanges(await receiptBody({ inventoryItemId: ids.unknownStock, mode: 'included' }), 409, 'unknown physical count with known book');
  const unknownPhysicalBefore = physicalFact(await stock(ids.unknownStock));
  assert.equal((await post(await receiptBody({ inventoryItemId: ids.unknownStock }))).status, 200);
  assert.equal(Number((await stock(ids.unknownStock)).stock_quantity), 7.5);
  assert.deepEqual(physicalFact(await stock(ids.unknownStock)), unknownPhysicalBefore);
  await db.query('update inventory_items set stock_quantity=null,stock_conversion_snapshot=null where id=$1', [ids.unknownStock]);
  await db.query('update inventory_items set stock_quantity=null,count_conversion_snapshot=$1::jsonb where id=$2', [JSON.stringify(conversion), ids.legacyStock]);
  await rejectsWithoutChanges(await receiptBody({ inventoryItemId: ids.legacyStock, mode: 'included', purchaseQuantity: 0.25 }), 409, 'included without known book');
  await db.query('update inventory_items set stock_quantity=2,stock_conversion_snapshot=$1::jsonb where id=$2', [JSON.stringify(conversion), ids.legacyStock]);
  const damagedBefore = await stock(ids.legacyStock);
  assert.equal((await post(await receiptBody({ inventoryItemId: ids.legacyStock, purchaseQuantity: 0.25 }))).status, 200);
  const damagedAfter = await stock(ids.legacyStock);
  assert.equal(Number(damagedAfter.stock_quantity), 5);
  assert.deepEqual(physicalFact(damagedAfter), physicalFact(damagedBefore));
  assert.equal(damagedAfter.exception_code, 'damaged');
  assert.equal(damagedAfter.exception_note, 'Preserve damaged evidence');
  console.log('PASS: included receipts require known matching book/count facts, leave physical facts unchanged, and successful additions preserve damage evidence');

  await rejectsWithoutChanges(await receiptBody({ purchaseQuantity: 4 }), 409, 'cumulative source quantity exceeded');
  assert.equal(Number((await db.query('select sum(purchase_quantity) total from inventory_stock_receipts where purchase_order_item_id=$1', [ids.line])).rows[0].total), 1);
  await rejectsWithoutChanges(await receiptBody({ inventoryItemId: ids.unknownStock }), 409, 'add without known book');
  await db.query('update inventory_items set stock_conversion_snapshot=null where id=$1', [ids.legacyStock]);
  await rejectsWithoutChanges(await receiptBody({ inventoryItemId: ids.legacyStock }), 409, 'add without matching book snapshot');
  console.log('PASS: cumulative receipts across locations are capped by stable actual quantity and additions require a known matching book basis');

  const unavailable = (await read()).sources;
  for (const [lineId, reason] of [
    [ids.unknownQuantityLine, 'actual_quantity_unknown'],
    [ids.unknownUnitLine, 'actual_unit_unknown'],
    [ids.mismatchedActualLine, 'actual_unit_unknown']
  ]) {
    const source = unavailable.find(item => item.purchaseOrderItemId === lineId);
    assert.ok(source);
    assert.equal(source.blockedReason, reason);
    await rejectsWithoutChanges(await receiptBody({ purchaseOrderItemId: lineId }), 409, reason);
  }
  const activeSource = unavailable.find(item => item.purchaseOrderItemId === ids.line);
  await rejectsWithoutChanges(await receiptBody({
    purchaseOrderItemId: ids.requestedLine,
    expectedSource: { ...activeSource.expectedSource, purchaseOrderItemId: ids.requestedLine, status: 'purchased', latestActualId: null,
      latestActualQuantity: null, latestActualUnit: null, latestActualRecordedAt: null, actualUnit: null,
      deliveryBatchId: null, deliveryBatchStatus: null }
  }), [404, 409], 'undelivered source');
  await rejectsWithoutChanges(await receiptBody({ inventoryItemId: ids.privateStock }), 409, 'SKU identity mismatch');
  await rejectsWithoutChanges(await receiptBody({ inventoryItemId: ids.wrongLocationStock }), [404, 409], 'location store identity mismatch');
  const privateBefore = await stock(ids.privateStock);
  assert.equal((await post(await receiptBody({ purchaseOrderItemId: ids.privateLine, inventoryItemId: ids.privateStock }))).status, 200);
  assert.equal(Number((await stock(ids.privateStock)).stock_quantity), Number(privateBefore.stock_quantity) + 1.5);
  assert.deepEqual(physicalFact(await stock(ids.privateStock)), physicalFact(privateBefore));
  const actualOnly = (await read()).sources.find(item => item.purchaseOrderItemId === ids.actualOnlyLine);
  assert.equal(actualOnly.actualQuantity, 2);
  assert.equal(actualOnly.actualUnit, '箱');
  assert.equal(actualOnly.blockedReason, null);
  assert.equal((await post(await receiptBody({ purchaseOrderItemId: ids.actualOnlyLine }))).status, 200);
  console.log('PASS: exact source/SKU/location matching, unknown latest actual facts blocked, and stopped/private historical sources remain receivable');

  const foreignSource = (() => {
    scopedStoreId = ids.otherStore;
    return read();
  })();
  const otherSnapshot = (await foreignSource).sources.find(item => item.purchaseOrderItemId === ids.otherLine).expectedSource;
  scopedStoreId = ids.store;
  await rejectsWithoutChanges({
    ...(await receiptBody()), purchaseOrderItemId: ids.otherLine, expectedSource: otherSnapshot
  }, 403, 'other source store scope');
  const beforeDenied = statements.length;
  storeAllowed = false;
  assert.equal((await get()).status, 403);
  assert.equal(statements.length, beforeDenied);
  storeAllowed = true;
  const deniedBody = await receiptBody();
  const beforePermissionDenied = statements.length;
  inventoryAllowed = false;
  assert.equal((await post(deniedBody)).status, 403);
  assert.equal(statements.length, beforePermissionDenied);
  inventoryAllowed = true;
  session = { id: ids.employee, name: 'Tester', role: 'store_terminal' };
  assert.equal((await post(deniedBody)).status, 403);
  assert.equal(statements.length, beforePermissionDenied);
  session = null;
  assert.equal((await get()).status, 403);
  assert.equal((await post(first)).status, 403);
  session = { id: ids.employee, name: 'Tester', role: 'store_manager' };
  assert.equal(statements.length, beforePermissionDenied);
  console.log('PASS: source store scope, inventory permission, writable role and session gates protect receipt operations');

  for (const [label, purchaseQuantity] of [
    ['zero', 0], ['negative', -1], ['seventh decimal', 0.0000001],
    ['nonterminating fraction', '1/3'], ['blank', ''], ['nonnumeric', 'invalid']
  ]) await rejectsWithoutChanges(await receiptBody({ purchaseQuantity }), 400, `invalid purchase quantity ${label}`);
  const preciseBefore = await stock(ids.stock);
  assert.equal((await post(await receiptBody({ purchaseQuantity: 0.000001 }))).status, 200);
  assert.equal(Number((await stock(ids.stock)).stock_quantity), Number(preciseBefore.stock_quantity) + 0.000012);
  const masterBeforePrecision = (await db.query('select package_quantity,package_quantity_unit,inventory_unit_conversions from products where id=$1', [ids.product])).rows[0];
  const stockBeforePrecision = await stock(ids.stock);
  const tinyConversion = { ...conversion, unitsPerPurchase: 0.1 };
  await db.query('update products set package_quantity=null,package_quantity_unit=$1,inventory_unit_conversions=$2::jsonb where id=$3', ['', JSON.stringify([{ unit: '袋', unitsPerPurchase: 0.1 }]), ids.product]);
  await db.query('update inventory_items set stock_conversion_snapshot=$1::jsonb where id=$2', [JSON.stringify(tinyConversion), ids.stock]);
  await rejectsWithoutChanges(await receiptBody({ purchaseQuantity: 0.000001, expectedConversion: tinyConversion }), 400, 'factor multiplication beyond six decimals');
  await db.query('update products set package_quantity=$1,package_quantity_unit=$2,inventory_unit_conversions=$3::jsonb where id=$4', [masterBeforePrecision.package_quantity, masterBeforePrecision.package_quantity_unit, JSON.stringify(masterBeforePrecision.inventory_unit_conversions), ids.product]);
  await db.query('update inventory_items set stock_conversion_snapshot=$1::jsonb,stock_quantity=$2 where id=$3', [JSON.stringify(stockBeforePrecision.stock_conversion_snapshot), '999999999999.999999', ids.stock]);
  await rejectsWithoutChanges(await receiptBody({ purchaseQuantity: 0.125 }), 400, 'book storage overflow');
  await db.query('update inventory_items set stock_quantity=$1 where id=$2', [stockBeforePrecision.stock_quantity, ids.stock]);
  console.log('PASS: purchase/count arithmetic preserves exact six-decimal steps and rejects nonterminating, overprecision and overflowing quantities without writes');

  const oldRevision = await receiptBody();
  await db.query('update inventory_items set stock_revision=stock_revision+1 where id=$1', [ids.stock]);
  await rejectsWithoutChanges(oldRevision, 409, 'stale stock revision before save');
  const staleConversion = await receiptBody({ expectedConversion: { ...conversion, unitsPerPurchase: 24 } });
  await rejectsWithoutChanges(staleConversion, 409, 'stale requested conversion');
  for (const [label, mutate, restore] of [
    ['stock revision',
      () => db.query('update inventory_items set stock_revision=stock_revision+1 where id=$1', [ids.stock]),
      async () => undefined],
    ['product configuration',
      () => db.query('update products set package_quantity=24 where id=$1', [ids.product]),
      () => db.query('update products set package_quantity=12 where id=$1', [ids.product])],
    ['source quantity',
      () => db.query('update purchase_order_items set actual_quantity=3 where id=$1', [ids.line]),
      () => db.query('update purchase_order_items set actual_quantity=4 where id=$1', [ids.line])],
    ['source store',
      () => db.query('update purchase_orders set store_id=$1 where id=$2', [ids.otherStore, ids.order]),
      () => db.query('update purchase_orders set store_id=$1 where id=$2', [ids.store, ids.order])],
    ['source SKU',
      () => db.query('update purchase_order_items set product_id=$1 where id=$2', [ids.privateProduct, ids.line]),
      () => db.query('update purchase_order_items set product_id=$1 where id=$2', [ids.product, ids.line])],
    ['latest actual',
      () => db.query('update purchase_actuals set actual_unit=$1 where id=$2', ['袋', ids.actual]),
      () => db.query('update purchase_actuals set actual_unit=$1 where id=$2', ['箱', ids.actual])],
    ['delivery batch',
      () => db.query('update delivery_batches set status=$1 where id=$2', ['in_delivery', ids.deliveryBatch]),
      () => db.query('update delivery_batches set status=$1 where id=$2', ['delivered', ids.deliveryBatch])]
  ]) {
    const body = await receiptBody();
    let concurrentState;
    beforeWrite = async () => { await mutate(); concurrentState = await persistedState(); };
    const response = await post(body);
    assert.equal(response.status, 409, `${label}: ${await response.text()}`);
    assert.deepEqual(await persistedState(), concurrentState, `${label}: concurrent change preserved with no receipt writes`);
    await restore();
  }
  console.log('PASS: revision, conversion, product, source/latest-actual and delivery CAS races reject atomically while preserving the concurrent change');

  const failedBody = await receiptBody({ purchaseQuantity: 0.75 });
  const beforeLedgerFailure = await persistedState();
  await db.exec(`create function reject_test_inventory_receipt() returns trigger language plpgsql as $$
    begin if NEW.purchase_quantity=0.75 then raise exception 'expected isolated ledger insert failure' using errcode='23514'; end if; return NEW; end; $$;
    create trigger reject_test_inventory_receipt before insert on inventory_stock_receipts
      for each row execute function reject_test_inventory_receipt();`);
  const failedSource = await data.readInventoryReceiptSource(ids.line);
  await assert.rejects(data.recordInventoryReceipt(session, policy.normalizeInventoryReceiptPayload(failedBody), failedSource), error => error.code === '23514');
  assert.deepEqual(await persistedState(), beforeLedgerFailure);
  await db.exec('drop trigger reject_test_inventory_receipt on inventory_stock_receipts; drop function reject_test_inventory_receipt();');
  console.log('PASS: failed ledger persistence rolls back book quantity, revision, receipt time and every related row');

  const beforeDeletes = await persistedState();
  const protectedTables = (await db.query(`select foreign_table.relname as table_name,constraint_row.confdeltype as delete_action
    from pg_constraint constraint_row join pg_class foreign_table on foreign_table.oid=constraint_row.confrelid
    where constraint_row.conrelid='inventory_stock_receipts'::regclass and constraint_row.contype='f'`)).rows;
  for (const tableName of ['purchase_order_items', 'purchase_orders', 'products', 'inventory_items']) {
    assert.ok(protectedTables.some(row => row.table_name === tableName && row.delete_action === 'r'), `${tableName}: explicit RESTRICT receipt foreign key`);
  }
  for (const [table, value] of [
    ['purchase_order_items', ids.line], ['purchase_orders', ids.order],
    ['products', ids.product], ['inventory_items', ids.stock]
  ]) {
    await assert.rejects(db.query(`delete from ${table} where id=$1`, [value]), error => ['23001', '23503'].includes(error.code), table);
    assert.deepEqual(await persistedState(), beforeDeletes);
  }
  const finalRead = await read();
  assert.ok(finalRead.recentReceipts.some(receipt => receipt.requestId === first.requestId));
  assert.ok(finalRead.recentReceipts.some(receipt => receipt.purchaseOrderItemId === ids.privateLine));
  assert.equal(Number((await db.query('select sum(purchase_quantity) total from inventory_stock_receipts where purchase_order_item_id=$1', [ids.line])).rows[0].total), 1.000001);
  assert.equal(Number((await db.query('select count(*) total from inventory_checks')).rows[0].total), 1);
  console.log('PASS: receipt foreign keys preserve source/product/target history and the scoped reader exposes the recorded ledger');

  const originalReceived = Number((await db.query('select sum(purchase_quantity) total from inventory_stock_receipts where purchase_order_item_id=$1', [ids.line])).rows[0].total);
  const historicalUnits = [{ quantity: originalReceived, purchaseUnit: '箱' }];
  await db.query('update products set unit=$1 where id=$2', ['袋', ids.product]);
  let changedUnitSource = (await read()).sources.find(source => source.purchaseOrderItemId === ids.line);
  assert.equal(changedUnitSource.actualUnit, '箱');
  assert.equal(changedUnitSource.remainingPurchaseQuantity, null);
  assert.equal(changedUnitSource.receivedPurchaseQuantity, originalReceived);
  assert.deepEqual(changedUnitSource.receivedPurchaseUnits, historicalUnits);

  await db.query('update purchase_actuals set actual_unit=null where id=$1', [ids.actual]);
  changedUnitSource = (await read()).sources.find(source => source.purchaseOrderItemId === ids.line);
  assert.equal(changedUnitSource.actualUnit, null);
  assert.equal(changedUnitSource.remainingPurchaseQuantity, null);
  assert.deepEqual(changedUnitSource.receivedPurchaseUnits, historicalUnits);

  await db.query('update purchase_actuals set actual_unit=$1 where id=$2', ['袋', ids.actual]);
  changedUnitSource = (await read()).sources.find(source => source.purchaseOrderItemId === ids.line);
  assert.equal(changedUnitSource.actualUnit, '袋');
  assert.equal(changedUnitSource.remainingPurchaseQuantity, null);
  assert.equal(changedUnitSource.blockedReason, 'purchase_unit_changed');
  assert.equal(changedUnitSource.receivedPurchaseQuantity, originalReceived);
  assert.deepEqual(changedUnitSource.receivedPurchaseUnits, historicalUnits);
  await rejectsWithoutChanges(await receiptBody(), 409, 'historical receipt unit differs from corrected actual/master unit');
  await db.query('update products set unit=$1 where id=$2', ['箱', ids.product]);
  await db.query('update purchase_actuals set actual_unit=$1 where id=$2', ['箱', ids.actual]);
  console.log('PASS: historical ledger unit groups survive changed/unknown actual or master units and prevent mixing units into remaining receipt quantities');

  const beforeUnknownBalanceMigration = await persistedState();
  const unknownBalanceMigration = readFileSync(new URL('db/migrations/20261009_inventory_receipt_unknown_balance.sql', root), 'utf8');
  await db.exec(unknownBalanceMigration);
  await db.exec(unknownBalanceMigration);
  assert.deepEqual(await persistedState(), beforeUnknownBalanceMigration);
  for (const [savedRequestId, field, value] of [
    [first.requestId, 'count_quantity', null], [first.requestId, 'conversion_snapshot', null],
    [first.requestId, 'count_quantity', 0], [included.requestId, 'count_quantity', null],
    [included.requestId, 'conversion_snapshot', null], [included.requestId, 'count_quantity', 0]
  ]) {
    await assert.rejects(db.query(`update inventory_stock_receipts set ${field}=$1 where request_id=$2`, [value, savedRequestId]), error => error.code === '23514');
    assert.deepEqual(await persistedState(), beforeUnknownBalanceMigration);
  }
  console.log('PASS: repeatable rough-arrival migration preserves all records and keeps precise add/included count quantities and conversions mandatory');

  await db.query('update inventory_items set count_unit=$1 where id=$2', ['custom scoop', ids.unknownStock]);
  const unknownBeforeRough = await stock(ids.unknownStock);
  const roughUnknown = await receiptBody({ inventoryItemId: ids.unknownStock, mode: 'unverified', expectedConversion: null, purchaseQuantity: 0.25 });
  const roughUnknownResponse = await post(roughUnknown);
  assert.equal(roughUnknownResponse.status, 200, await roughUnknownResponse.clone().text());
  const roughUnknownRecord = (await roughUnknownResponse.json()).receipt;
  assert.equal(roughUnknownRecord.mode, 'unverified');
  assert.equal(roughUnknownRecord.countQuantity, null);
  const unknownAfterRough = await stock(ids.unknownStock);
  assert.equal(unknownAfterRough.stock_quantity, null);
  assert.equal(unknownAfterRough.stock_conversion_snapshot, null);
  assert.equal(unknownAfterRough.stock_revision, unknownBeforeRough.stock_revision + 1);
  assert.deepEqual(physicalFact(unknownAfterRough), physicalFact(unknownBeforeRough));
  const roughUnknownLedger = (await db.query('select * from inventory_stock_receipts where request_id=$1', [roughUnknown.requestId])).rows[0];
  assert.equal(Number(roughUnknownLedger.purchase_quantity), 0.25);
  assert.equal(roughUnknownLedger.purchase_unit, '箱');
  assert.equal(roughUnknownLedger.count_quantity, null);
  assert.equal(roughUnknownLedger.conversion_snapshot, null);
  assert.equal(roughUnknownLedger.before_stock_quantity, null);
  assert.equal(roughUnknownLedger.after_stock_quantity, null);
  const unknownTarget = (await read()).inventoryItems.find(item => item.id === ids.unknownStock);
  assert.equal(unknownTarget.currentConversion, null);
  assert.equal(unknownTarget.unverifiedBlockedReason, null);
  const beforeRoughReplay = await persistedState();
  assert.equal((await post(roughUnknown)).status, 200);
  assert.deepEqual(await persistedState(), beforeRoughReplay);
  await rejectsWithoutChanges({ ...roughUnknown, purchaseQuantity: 0.5 }, 409, 'rough nonce reused with a different quantity');
  console.log('PASS: rough arrivals accept unknown book/custom conversion, retain literal purchase evidence, and replay without duplicate stock or ledger writes');

  const oldCountRevision = await stock(ids.stock);
  const oldPreciseRequest = await receiptBody();
  const roughKnown = await receiptBody({ mode: 'unverified', expectedConversion: null, purchaseQuantity: 0.5 });
  assert.equal((await post(roughKnown)).status, 200);
  const knownAfterRough = await stock(ids.stock);
  assert.notEqual(oldCountRevision.stock_quantity, null);
  assert.equal(knownAfterRough.stock_quantity, null);
  assert.equal(knownAfterRough.stock_conversion_snapshot, null);
  assert.equal(knownAfterRough.stock_revision, oldCountRevision.stock_revision + 1);
  assert.deepEqual(physicalFact(knownAfterRough), physicalFact(oldCountRevision));
  assert.equal(knownAfterRough.exception_code, oldCountRevision.exception_code);
  assert.equal(knownAfterRough.exception_note, oldCountRevision.exception_note);
  const roughKnownLedger = (await db.query('select * from inventory_stock_receipts where request_id=$1', [roughKnown.requestId])).rows[0];
  assert.equal(roughKnownLedger.before_stock_quantity, oldCountRevision.stock_quantity);
  assert.equal(roughKnownLedger.after_stock_quantity, null);
  await rejectsWithoutChanges(oldPreciseRequest, 409, 'precise request predating rough stock revision');
  await db.query(`update inventory_items set current_quantity=9,stock_quantity=9,
    count_conversion_snapshot=$1::jsonb,stock_conversion_snapshot=$1::jsonb,
    last_counted_at='2026-10-09T15:00:00Z',stock_revision=stock_revision+1 where id=$2`, [JSON.stringify(conversion), ids.stock]);
  const truthfulCount = await persistedState();
  assert.equal((await post(roughKnown)).status, 200);
  assert.deepEqual(await persistedState(), truthfulCount);
  console.log('PASS: rough arrival clears a known book to unknown without rewriting physical facts, invalidates old revisions, and replay preserves a later truthful count');

  await db.query('update products set unit=$1 where id=$2', ['袋', ids.product]);
  const historicalRoughSource = (await read()).sources.find(source => source.purchaseOrderItemId === ids.line);
  assert.equal(historicalRoughSource.actualUnit, '箱');
  assert.equal(historicalRoughSource.remainingPurchaseQuantity, null);
  assert.equal(historicalRoughSource.unverifiedBlockedReason, null);
  assert.equal(historicalRoughSource.unverifiedRemainingPurchaseQuantity, 2.249999);
  const historicalPhysical = physicalFact(await stock(ids.stock));
  const historicalRough = await receiptBody({ mode: 'unverified', expectedConversion: null, purchaseQuantity: 0.25 });
  assert.equal((await post(historicalRough)).status, 200);
  const historicalRoughLedger = (await db.query('select * from inventory_stock_receipts where request_id=$1', [historicalRough.requestId])).rows[0];
  assert.equal(historicalRoughLedger.purchase_unit, '箱');
  assert.equal(Number(historicalRoughLedger.purchase_quantity), 0.25);
  assert.equal(historicalRoughLedger.count_quantity, null);
  assert.equal(historicalRoughLedger.conversion_snapshot, null);
  assert.equal(historicalRoughLedger.after_stock_quantity, null);
  assert.deepEqual(physicalFact(await stock(ids.stock)), historicalPhysical);
  const mappedRough = (await read()).recentReceipts.find(receipt => receipt.requestId === historicalRough.requestId);
  assert.equal(mappedRough.mode, 'unverified');
  assert.equal(mappedRough.countQuantity, null);
  assert.equal(mappedRough.purchaseUnit, '箱');
  console.log('PASS: rough arrivals use the stable historical actual purchase unit even when today\'s master unit differs, without applying today\'s conversion');

  for (const lineId of [ids.unknownQuantityLine, ids.unknownUnitLine, ids.mismatchedActualLine]) {
    await rejectsWithoutChanges(await receiptBody({ purchaseOrderItemId: lineId, mode: 'unverified', expectedConversion: null }), 409, 'rough arrival requires known stable actual quantity/unit');
  }
  await rejectsWithoutChanges(await receiptBody({ mode: 'unverified', expectedConversion: null, purchaseQuantity: 2 }), 409, 'rough cumulative source cap');
  await db.query('update purchase_actuals set actual_unit=$1 where id=$2', ['袋', ids.actual]);
  const mixedUnitRoughSource = (await read()).sources.find(source => source.purchaseOrderItemId === ids.line);
  assert.equal(mixedUnitRoughSource.unverifiedRemainingPurchaseQuantity, null);
  await rejectsWithoutChanges(await receiptBody({ mode: 'unverified', expectedConversion: null }), 409, 'rough arrival cannot mix a corrected actual unit with historical ledger units');
  await db.query('update products set unit=$1 where id=$2', ['箱', ids.product]);
  await db.query('update purchase_actuals set actual_unit=$1 where id=$2', ['箱', ids.actual]);
  console.log('PASS: rough mode still enforces source quantity/unit certainty, historical unit consistency and cumulative purchase limits');

  const batchProduct=uuid(950),batchStock=uuid(951),batchLine=uuid(952),batchActual=uuid(953);
  await db.query('insert into products(id,name,unit,package_quantity,package_quantity_unit) values($1,$2,$3,$4,$5)',[batchProduct,'Stable ingredient','箱',12000,'g']);
  await db.query(`insert into inventory_items(id,store_id,product_id,location_id,count_unit,safety_stock,current_quantity,stock_quantity,stock_revision,last_counted_at)
    values($1,$2,$3,$4,'g',100,1000,1000,0,'2026-10-08T12:00:00Z')`,[batchStock,ids.store,batchProduct,ids.location]);
  await db.query(`insert into purchase_order_items(id,purchase_order_id,product_id,requested_quantity,requested_unit,actual_quantity,status)
    values($1,$2,$3,2,'袋',2,'delivered')`,[batchLine,ids.order,batchProduct]);
  await db.query('insert into purchase_actuals(id,purchase_order_item_id,actual_quantity,actual_unit) values($1,$2,2,$3)',[batchActual,batchLine,'袋']);
  const actualBatch={purchaseUnit:'袋',contentQuantity:800,contentUnit:'g',countUnit:'g',stockQuantityPerPurchase:800};
  const physicalBeforeBatch=physicalFact(await stock(batchStock));
  const firstBatchBody=await receiptBody({purchaseOrderItemId:batchLine,inventoryItemId:batchStock,purchaseQuantity:0.5,expectedConversion:null,batchPackaging:actualBatch});
  let firstBatch=await post(firstBatchBody);
  assert.equal(firstBatch.status,200,await firstBatch.clone().text());
  assert.equal(Number((await stock(batchStock)).stock_quantity),1400);
  assert.deepEqual(physicalFact(await stock(batchStock)),physicalBeforeBatch);
  assert.equal((await stock(batchStock)).stock_conversion_snapshot,null);
  assert.deepEqual((await db.query('select actual_packaging_snapshot from purchase_order_items where id=$1',[batchLine])).rows[0].actual_packaging_snapshot,actualBatch);
  assert.equal((await db.query('select count(*)::int as n from inventory_movements movements join inventory_stock_receipts receipts on movements.operation_key=\'receipt:\'||receipts.id::text where receipts.request_id=$1',[firstBatchBody.requestId])).rows[0].n,1);
  const beforeBatchReplay=await persistedState();
  assert.equal((await post(firstBatchBody)).status,200);
  assert.deepEqual(await persistedState(),beforeBatchReplay);
  console.log('PASS: batch packaging adds actual 800g/bag to literal g stock despite today\'s different master unit, preserves physical count and old conversion, and replays once');

  await db.query('update products set package_quantity=24000 where id=$1',[batchProduct]);
  const secondBatchBody=await receiptBody({purchaseOrderItemId:batchLine,inventoryItemId:batchStock,purchaseQuantity:0.5,expectedConversion:null});
  assert.equal((await post(secondBatchBody)).status,200);
  assert.equal(Number((await stock(batchStock)).stock_quantity),1800);
  await rejectsWithoutChanges(await receiptBody({purchaseOrderItemId:batchLine,inventoryItemId:batchStock,purchaseQuantity:0.25,expectedConversion:null,batchPackaging:{...actualBatch,contentQuantity:1000,stockQuantityPerPurchase:1000}}),409,'frozen batch cannot be reinterpreted from new master/template');
  const savedBatchState=await persistedState();
  await db.exec(packagingMigration);
  assert.deepEqual(await persistedState(),savedBatchState);
  console.log('PASS: remaining arrivals use frozen batch factor after master changes; conflicting batch and migration replay preserve old purchase/receipt/movement facts');

  const thirdBatchBody=await receiptBody({purchaseOrderItemId:batchLine,inventoryItemId:batchStock,purchaseQuantity:0.5,expectedConversion:null});
  beforeWrite=async()=>{await db.query('update purchase_order_items set actual_packaging_snapshot=$1::jsonb where id=$2',[JSON.stringify({...actualBatch,contentQuantity:900,stockQuantityPerPurchase:900}),batchLine]);};
  const staleBatch=await post(thirdBatchBody);
  assert.equal(staleBatch.status,409,await staleBatch.text());
  assert.equal(Number((await stock(batchStock)).stock_quantity),1800);
  await db.query('update purchase_order_items set actual_packaging_snapshot=$1::jsonb where id=$2',[JSON.stringify(actualBatch),batchLine]);
  await db.query('update inventory_items set stock_quantity=-200 where id=$1',[batchStock]);
  assert.equal((await post(await receiptBody({purchaseOrderItemId:batchLine,inventoryItemId:batchStock,purchaseQuantity:0.25,expectedConversion:null}))).status,200);
  assert.equal(Number((await stock(batchStock)).stock_quantity),0);
  assert.deepEqual(physicalFact(await stock(batchStock)),physicalBeforeBatch);
  console.log('PASS: packaging CAS rejects stale source while preserving changed fact; batch receipt can reconcile signed theoretical deficit without changing physical count');

  const templateRequest=uuid(970),templateSupplier=uuid(971);
  await db.query('insert into suppliers(id,name) values($1,$2)',[templateSupplier,'HQ upstream supplier']);
  const templatePayload={action:'save',requestId:templateRequest,productId:batchProduct,name:'800g bags',supplierId:templateSupplier,packaging:actualBatch};
  assert.equal((await packagingData.saveProductPackagingTemplate(session,templatePayload)).replayed,false);
  assert.equal((await packagingData.saveProductPackagingTemplate(session,templatePayload)).replayed,true);
  assert.equal((await db.query('select count(*)::int as n from product_packaging_templates')).rows[0].n,1);
  await assert.rejects(packagingData.saveProductPackagingTemplate(session,{...templatePayload,name:'changed payload'}),error=>error.status===409 && error.code==='request_conflict');
  await assert.rejects(packagingData.saveProductPackagingTemplate(session,{...templatePayload,requestId:uuid(972)}),error=>error.status===409 && error.code==='template_exists');
  console.log('PASS: packaging creation nonce replays once, rejects changed payload and distinguishes same-product duplicate names');
  const originalTemplate=(await packagingData.readProductPackagingTemplates([batchProduct],true))[0];
  assert.equal(originalTemplate.supplierId,templateSupplier);
  assert.equal((await packagingData.readProductPackagingTemplates([batchProduct],false))[0].supplierId,null);
  await packagingData.saveProductPackagingTemplate(session,{action:'save',id:originalTemplate.id,expectedUpdatedAt:originalTemplate.updatedAt,productId:batchProduct,name:originalTemplate.name,supplierId:templateSupplier,packaging:{...actualBatch,contentQuantity:900,stockQuantityPerPurchase:900}});
  await assert.rejects(packagingData.saveProductPackagingTemplate(session,{action:'inactivate',id:originalTemplate.id,expectedUpdatedAt:originalTemplate.updatedAt,productId:batchProduct}),error=>error.status===409 && error.code==='template_changed');
  assert.equal((await packagingData.saveProductPackagingTemplate(session,templatePayload)).replayed,true);
  assert.equal((await packagingData.readProductPackagingTemplates([batchProduct],true))[0].contentQuantity,900);
  assert.equal((await data.readInventoryReceiptSource(batchLine)).actualPackaging.contentQuantity,800);
  console.log('PASS: template CAS and HQ supplier redaction; editing a template never rewrites old actual/receipt batch snapshots, even on retried original creation');

  const priceSource=readFileSync(new URL('lib/procurement-data.ts',root),'utf8');
  const priceQuery=priceSource.slice(priceSource.indexOf('with ranked_prices as (')).split('`')[0];
  assert.ok(!priceQuery.includes('${'),'price signal query is independently executable without customer/session inputs');
  await db.query('insert into product_supplier_options(product_id,supplier_id,reference_price) values($1,$2,1000)',[batchProduct,templateSupplier]);
  const changedPack={...actualBatch,contentQuantity:900,stockQuantityPerPurchase:900};
  await db.query('insert into price_records(product_id,supplier_id,price,unit,packaging_snapshot,recorded_at) values($1,$2,1000,$3,$4::jsonb,now()-interval \'2 days\')',[batchProduct,templateSupplier,'袋',JSON.stringify(actualBatch)]);
  await db.query('insert into price_records(product_id,supplier_id,price,unit,packaging_snapshot,recorded_at) values($1,$2,900,$3,$4::jsonb,now()-interval \'1 day\')',[batchProduct,templateSupplier,'袋',JSON.stringify(changedPack)]);
  assert.equal((await db.query(priceQuery)).rows.length,0,'changed package cannot create a raw per-bag price alert or use today\'s default reference price');
  await db.query('insert into price_records(product_id,supplier_id,price,unit,packaging_snapshot) values($1,$2,1000,$3,$4::jsonb)',[batchProduct,templateSupplier,'袋',JSON.stringify({...changedPack,templateId:templateRequest})]);
  const comparablePrices=(await db.query(priceQuery)).rows;
  assert.equal(comparablePrices.length,1);assert.equal(comparablePrices[0].changeRate,11.1);
  console.log('PASS: purchase price signals compare only matching literal units and frozen package contents; template identity does not alter package comparability');

  const quickPolicy=load('lib/inventory-quick-policy.ts',{'./product-unit-conversions':units});
  const countInput=load('lib/inventory-count-input-policy.ts',{'./product-unit-conversions':units});
  const inventoryRoute=load('app/api/inventory/route.ts',{
    '../../../lib/product-unit-conversions':units,'../../../lib/inventory-quick-policy':quickPolicy,
    '../../../lib/inventory-count-input-policy':countInput,
    '../../../lib/product-catalog-access':{assertProductViewableAtStore:async()=>({ok:true}),getVisibleProductIdsForStore:async()=>[batchProduct]}
  });
  async function countBatch(quantity) {
    const current=await stock(batchStock);
    const currentProduct=(await db.query('select * from products where id=$1',[batchProduct])).rows[0];
    const expectedConversion=units.resolveProductUnitConversion({unit:currentProduct.unit,packageQuantity:Number(currentProduct.package_quantity),packageQuantityUnit:currentProduct.package_quantity_unit,inventoryUnitConversions:currentProduct.inventory_unit_conversions},'g');
    const response=await inventoryRoute.POST(new Request('https://example.test/api/inventory',{method:'POST',body:JSON.stringify({action:'count',storeId:ids.store,itemId:batchStock,countUnit:'g',quantity,expectedStockRevision:current.stock_revision,expectedConversion})}));
    assert.equal(response.status,200,await response.clone().text());
    return (await db.query('select * from inventory_checks where id=(select usage_anchor_check_id from inventory_items where id=$1)',[batchStock])).rows[0];
  }
  await countBatch(1200);
  assert.equal((await post(await receiptBody({purchaseOrderItemId:batchLine,inventoryItemId:batchStock,purchaseQuantity:0.25,expectedConversion:null}))).status,200);
  await db.transaction(async tx=>{
    await tx.query('update inventory_items set stock_quantity=stock_quantity-100,stock_revision=stock_revision+1 where id=$1',[batchStock]);
    await tx.query(`insert into inventory_movements(operation_key,store_id,product_id,inventory_item_id,kind,quantity,count_unit,confidence,occurred_at,before_quantity,after_quantity,changes_stock)
      values('isolated-known-usage',$1,$2,$3,'order_use',-100,'g','exact',clock_timestamp(),1400,1300,true)`,[ids.store,batchProduct,batchStock]);
  });
  const reconciledCount=await countBatch(1250),period=reconciledCount.reconciliation_snapshot;
  assert.equal(Number(period.expectedQuantity),1300);assert.equal(Number(period.difference),-50);
  assert.equal(Number(period.receivedQuantity),200);assert.equal(Number(period.orderDeductedQuantity),100);
  assert.equal(period.confidence,'confirmed');assert.equal(Number((await stock(batchStock)).current_quantity),1250);
  console.log('PASS: real count API anchors base units, then frozen receipt plus one known usage produces a preserved -50g reconciliation rather than rewriting prior count');

  await rejectsWithoutChanges(await receiptBody({purchaseOrderItemId:batchLine,inventoryItemId:batchStock,mode:'unverified',purchaseQuantity:0.125,expectedConversion:null,batchPackaging:{...actualBatch,purchaseUnit:'箱'}}),409,'rough cannot freeze wrong batch purchase identity');
  const unverifiedBatchBody=await receiptBody({purchaseOrderItemId:batchLine,inventoryItemId:batchStock,mode:'unverified',purchaseQuantity:0.125,expectedConversion:null});
  assert.equal((await post(unverifiedBatchBody)).status,200);
  const unknownPeriod=(await countBatch(1300)).reconciliation_snapshot;
  assert.equal(unknownPeriod.expectedQuantity,null);assert.equal(unknownPeriod.difference,null);assert.equal(unknownPeriod.confidence,'unknown');
  assert.ok(unknownPeriod.issueReasons.includes('movement_unknown'));
  const countedAfterRough=await persistedState();
  assert.equal((await post(unverifiedBatchBody)).status,200);
  assert.deepEqual(await persistedState(),countedAfterRough);
  console.log('PASS: unverified receipt invalidates precise interval via movement metadata; next count preserves unknown difference and old receipt retry cannot overwrite new count');
} finally {
  await db.close();
}
