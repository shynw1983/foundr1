// Isolated PostgreSQL verification. Never reads DATABASE_URL or calls a production API.
// Set FOUNDR1_PGLITE_MODULE to a temporary @electric-sql/pglite installation if needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const db = new PGlite();
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { product: uuid(1), historicalItem: uuid(2), historicalCheck: uuid(3), store: uuid(4), brand: uuid(5), supplier: uuid(6), employee: uuid(7), stock: uuid(8) };
let session = { id: ids.employee, role: 'owner' };
let permission = true;
let beforeTransaction = null;
let queryCount = 0;

const sql = Object.assign((parts, ...values) => ({
  text: parts.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), ''),
  values,
  then(resolve, reject) {
    queryCount++;
    return db.query(this.text, this.values).then(result => result.rows).then(resolve, reject);
  }
}), {
  transaction: async statements => {
    if (beforeTransaction) {
      const hook = beforeTransaction;
      beforeTransaction = null;
      await hook();
    }
    return db.transaction(async transaction => {
      const results = [];
      for (const statement of statements) {
        queryCount++;
        results.push((await transaction.query(statement.text, statement.values)).rows);
      }
      return results;
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
      if (name.endsWith('/api-auth')) return { requireMasterOsSession: async () => session };
      if (name.endsWith('/role-permissions')) return { roleHasPermission: async () => permission };
      if (name === 'node:crypto' || name === 'crypto') return require(name);
      if (name in modules) return modules[name];
      throw new Error(`Unmocked isolated dependency: ${name}`);
    }
  });
  return exports;
}

async function createOldDatabase() {
  await db.exec(`
    create table products (
      id uuid primary key default gen_random_uuid(), name text not null,
      product_brand_name text, manufacturer text, category text not null,
      subcategory text, unit text not null, reference_price numeric(12,2),
      origin_countries text[] not null default '{}', package_quantity numeric(12,3),
      package_quantity_unit text, product_family_name text, variant_name text,
      is_default_variant boolean not null default false, variant_sort_order integer not null default 0,
      spec_note text, japanese_note text, photo_url text, brand_scope text not null default 'unset',
      is_imported boolean not null default false, import_origin_country text,
      import_currency text not null default 'CNY', import_original_price numeric(12,2),
      import_exchange_rate numeric(12,6) not null default 1, import_price_jpy numeric(12,2),
      import_freight_rate_original_per_kg numeric(12,2) not null default 20,
      import_freight_rate_jpy_per_kg numeric(12,2) not null default 0,
      import_weight_strategy text not null default 'standard_1kg',
      import_weight_kg numeric(12,3) not null default 1,
      import_freight_cost_jpy numeric(12,2) not null default 0,
      import_tax_cost_jpy numeric(12,2) not null default 0,
      import_other_cost_jpy numeric(12,2) not null default 0,
      storage_type text, usage_type text not null default 'ingredient',
      catalog_visibility text not null default 'internal', is_orderable boolean not null default true,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table stores(id uuid primary key, name text);
    create table brands(id uuid primary key, name text);
    create table suppliers(id uuid primary key, name text);
    create table product_brand_usages(product_id uuid references products(id), brand_id uuid references brands(id),
      is_orderable boolean not null default true, usage_note text, primary key(product_id,brand_id));
    create table product_catalog_store_grants(product_id uuid references products(id), store_id uuid references stores(id), primary key(product_id,store_id));
    create table product_supplier_options(product_id uuid references products(id), supplier_id uuid references suppliers(id),
      role text, reference_price numeric, purchase_url text, is_active boolean, primary key(product_id,supplier_id,role));
    create table purchase_order_items(id uuid primary key, product_id uuid references products(id), requested_quantity numeric, requested_unit text);
    create table inventory_items(id uuid primary key, product_id uuid references products(id),
      current_quantity numeric(12,2), safety_stock numeric(12,2));
    create table inventory_checks(id uuid primary key, product_id uuid references products(id), quantity numeric(12,2), count_unit text);
    create table menu_product_links(product_id uuid references products(id));
    insert into stores values('${ids.store}','Store');
    insert into brands values('${ids.brand}','Brand');
    insert into suppliers values('${ids.supplier}','Supplier');
    insert into products(id,name,category,unit,package_quantity,package_quantity_unit,brand_scope,catalog_visibility)
      values('${ids.product}','既存 SKU','食品','箱',12,'袋','specific','selected_stores');
    insert into product_brand_usages values('${ids.product}','${ids.brand}',true,'Preserve this note');
    insert into product_catalog_store_grants values('${ids.product}','${ids.store}');
    insert into product_supplier_options values('${ids.product}','${ids.supplier}','メイン',1200,'https://example.test/buy',true);
    insert into purchase_order_items values('${ids.historicalItem}','${ids.product}',2,'箱');
    insert into inventory_items values('${ids.stock}','${ids.product}',0.12,0.34);
    insert into inventory_checks values('${ids.historicalCheck}','${ids.product}',0.12,'袋');
  `);
}

const productRow = async productId => (await db.query('select * from products where id=$1', [productId])).rows[0];
const persistedState = async () => {
  const state = {};
  for (const [table, order] of [['products', 'id'], ['product_brand_usages', 'product_id,brand_id'],
    ['product_catalog_store_grants', 'product_id,store_id'], ['product_supplier_options', 'product_id,supplier_id,role'],
    ['purchase_order_items', 'id'], ['inventory_items', 'id'], ['inventory_checks', 'id']]) {
    state[table] = (await db.query(`select * from ${table} order by ${order}`)).rows;
  }
  return state;
};

const relations = [
  { unit: '袋', unitsPerPurchase: 12 },
  { unit: 'g', unitsPerPurchase: 1200 },
  { unit: '1/4箱', unitsPerPurchase: 4, fractionalDenominator: 4 }
];
const configuration = row => ({
  unit: row.unit,
  packageQuantity: row.package_quantity === null ? null : Number(row.package_quantity),
  packageQuantityUnit: row.package_quantity_unit || '',
  inventoryUnitConversions: row.inventory_unit_conversions
});
const payload = overrides => ({
  id: ids.product, name: '既存 SKU', category: '食品', unit: '箱',
  packageQuantity: 12, packageQuantityUnit: '袋', brand: 'Brand',
  referencePrice: 1200, mainSupplier: 'Supplier', mainPurchaseUrl: 'https://example.test/buy',
  ...overrides
});
let route;
const put = body => route.PUT(new Request('https://example.test/api/products', {
  method: 'PUT', body: JSON.stringify(body)
}));
async function rejectsWithoutChanges(body, status, label) {
  const before = await persistedState();
  const response = await put(body);
  assert.equal(response.status, status, `${label}: ${await response.text()}`);
  assert.deepEqual(await persistedState(), before, `${label}: no persisted changes`);
}

try {
  await createOldDatabase();
  const oldItems = (await db.query('select * from purchase_order_items')).rows;
  const oldCheck = (await db.query('select * from inventory_checks')).rows[0];
  const oldStock = (await db.query('select current_quantity,safety_stock from inventory_items')).rows[0];
  const migration = readFileSync(new URL('db/migrations/20261008_product_unit_conversions.sql', root), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await productRow(ids.product)).inventory_unit_conversions, []);
  assert.equal((await db.query('select count_conversion_snapshot from inventory_items')).rows[0].count_conversion_snapshot, null);
  const migratedCheck = (await db.query('select * from inventory_checks')).rows[0];
  assert.equal(migratedCheck.unit_conversion_snapshot, null);
  const { unit_conversion_snapshot: _, ...retainedCheck } = migratedCheck;
  assert.deepEqual({ ...retainedCheck, quantity: Number(retainedCheck.quantity) }, { ...oldCheck, quantity: Number(oldCheck.quantity) });
  const migratedStock = (await db.query('select current_quantity,safety_stock from inventory_items')).rows[0];
  assert.deepEqual(Object.values(migratedStock).map(Number), Object.values(oldStock).map(Number));
  const quantityColumns = (await db.query(`select table_name,column_name,numeric_precision,numeric_scale
    from information_schema.columns
    where (table_name='inventory_items' and column_name in ('current_quantity','safety_stock'))
       or (table_name='inventory_checks' and column_name='quantity')`)).rows;
  assert.equal(quantityColumns.length, 3);
  assert.ok(quantityColumns.every(column => column.numeric_precision === 18 && column.numeric_scale === 6));
  await db.query('update inventory_items set current_quantity=$1,safety_stock=$2 where id=$3', [0.000001, 0.125, ids.stock]);
  const preciseStock = (await db.query('select current_quantity,safety_stock from inventory_items where id=$1', [ids.stock])).rows[0];
  assert.deepEqual(Object.values(preciseStock).map(Number), [0.000001, 0.125]);
  await db.query('update inventory_items set current_quantity=$1,safety_stock=$2 where id=$3', [oldStock.current_quantity, oldStock.safety_stock, ids.stock]);
  assert.deepEqual((await db.query('select * from purchase_order_items')).rows, oldItems);
  const snapshots = (await db.query(`select table_name,column_name,is_nullable,column_default
    from information_schema.columns
    where (table_name='inventory_items' and column_name='count_conversion_snapshot')
       or (table_name='inventory_checks' and column_name='unit_conversion_snapshot')
    order by table_name`)).rows;
  assert.equal(snapshots.length, 2);
  assert.ok(snapshots.every(column => column.is_nullable === 'YES' && column.column_default === null));
  console.log('PASS: repeatable additive migration, historical values retained, six-decimal quantities and unknown snapshots stay unfilled');

  const unitConversions = load('lib/product-unit-conversions.ts');
  const catalogPolicy = load('lib/product-catalog-policy.ts', {
    './product-unit-conversions.ts': unitConversions
  });
  route = load('app/api/products/route.ts', {
    '../../../lib/product-catalog-policy': catalogPolicy,
    '../../../lib/product-unit-conversions': unitConversions
  });

  const initial = configuration(await productRow(ids.product));
  assert.equal((await put(payload({
    inventoryUnitConversions: relations, expectedUnitConfiguration: initial
  }))).status, 200);
  const configured = configuration(await productRow(ids.product));
  assert.equal(configured.inventoryUnitConversions.length, 3);
  assert.equal(configured.inventoryUnitConversions.find(entry => entry.unit === '袋').unitsPerPurchase, 12);
  assert.equal(configured.inventoryUnitConversions.find(entry => entry.unit === 'g').unitsPerPurchase, 1200);
  assert.equal(configured.inventoryUnitConversions.find(entry => entry.unit === '1/4箱').fractionalDenominator, 4);
  console.log('PASS: exact existing SKU accepts explicit purchase-to-inventory relations with an expected configuration');

  const beforeChildFailure = await persistedState();
  await db.exec(`create function reject_test_supplier_write() returns trigger language plpgsql as $$
    begin if NEW.reference_price=12345 then raise exception 'expected isolated supplier write failure' using errcode='23514'; end if; return NEW; end; $$;
    create trigger reject_test_supplier_write before insert or update on product_supplier_options
      for each row execute function reject_test_supplier_write();`);
  await assert.rejects(put(payload({
    name: '失敗する編集', referencePrice: 12345,
    inventoryUnitConversions: relations, expectedUnitConfiguration: configured
  })), error => error.code === '23514');
  assert.deepEqual(await persistedState(), beforeChildFailure);
  await db.exec('drop trigger reject_test_supplier_write on product_supplier_options; drop function reject_test_supplier_write();');
  console.log('PASS: a downstream supplier write failure rolls back product data and every child relation together');

  const legacy = payload({ name: '旧画面からの名称編集' });
  delete legacy.unit;
  delete legacy.packageQuantity;
  delete legacy.packageQuantityUnit;
  assert.equal((await put(legacy)).status, 200);
  assert.deepEqual(configuration(await productRow(ids.product)), configured);
  console.log('PASS: legacy metadata edits preserve omitted purchase unit, packaging and conversion JSON');

  await rejectsWithoutChanges(payload({ unit: '袋' }), 409, 'legacy purchase unit change');
  await rejectsWithoutChanges(payload({ inventoryUnitConversions: relations }), 409, 'missing expected configuration');
  for (const [label, stale] of [
    ['purchase unit', { ...configured, unit: '袋' }],
    ['package quantity', { ...configured, packageQuantity: 13 }],
    ['package unit', { ...configured, packageQuantityUnit: '個' }],
    ['relation factor', { ...configured, inventoryUnitConversions: configured.inventoryUnitConversions.map(entry => entry.unit === 'g' ? { ...entry, unitsPerPurchase: 1199 } : entry) }],
    ['relation set', { ...configured, inventoryUnitConversions: [] }]
  ]) {
    await rejectsWithoutChanges(payload({
      inventoryUnitConversions: relations, expectedUnitConfiguration: stale
    }), 409, `stale ${label}`);
  }
  console.log('PASS: legacy changes, missing expectations and every stale unit-configuration field reject without partial writes');

  let concurrentState;
  beforeTransaction = async () => {
    await db.query('update products set package_quantity=13 where id=$1', [ids.product]);
    concurrentState = await persistedState();
  };
  const staleWhileSaving = await put(payload({
    inventoryUnitConversions: relations, expectedUnitConfiguration: configured
  }));
  assert.equal(staleWhileSaving.status, 409);
  assert.deepEqual(await persistedState(), concurrentState);
  await db.query('update products set package_quantity=12 where id=$1', [ids.product]);
  console.log('PASS: a unit configuration changed after the API read is rejected atomically at the product write');

  const invalid = [
    ['duplicate target', [{ unit: '袋', unitsPerPurchase: 12 }, { unit: '袋', unitsPerPurchase: 12 }]],
    ['purchase unit with nonidentity factor', [{ unit: '箱', unitsPerPurchase: 2 }]],
    ['empty target', [{ unit: '', unitsPerPurchase: 2 }]],
    ['long target', [{ unit: 'u'.repeat(65), unitsPerPurchase: 2 }]],
    ['zero factor', [{ unit: 'g', unitsPerPurchase: 0 }]],
    ['negative factor', [{ unit: 'g', unitsPerPurchase: -1 }]],
    ['under-limit factor', [{ unit: 'g', unitsPerPurchase: 1e-10 }]],
    ['nonfinite factor', [{ unit: 'g', unitsPerPurchase: 'not-a-number' }]],
    ['over-limit factor', [{ unit: 'g', unitsPerPurchase: 1_000_000_001 }]],
    ['over-limit relation count', Array.from({ length: 21 }, (_, index) => ({ unit: `u${index}`, unitsPerPurchase: 2 }))],
    ['invalid fractional denominator', [{ unit: 'g', unitsPerPurchase: 12, fractionalDenominator: 1 }]],
    ['noninteger fractional denominator', [{ unit: 'g', unitsPerPurchase: 12, fractionalDenominator: 2.5 }]],
    ['over-limit fractional denominator', [{ unit: 'g', unitsPerPurchase: 12, fractionalDenominator: 1_000_001 }]],
    ['fractional label without denominator', [{ unit: '1/4箱', unitsPerPurchase: 4 }]],
    ['fractional label mismatch', [{ unit: '1/3箱', unitsPerPurchase: 4, fractionalDenominator: 4 }]],
    ['fractional factor mismatch', [{ unit: '1/4箱', unitsPerPurchase: 3, fractionalDenominator: 4 }]],
    ['packaging conflict', [{ unit: '袋', unitsPerPurchase: 13 }]],
    ['nonarray relations', { unit: '袋', unitsPerPurchase: 12 }],
    ['null relations', null]
  ];
  for (const [label, inventoryUnitConversions] of invalid) {
    await rejectsWithoutChanges(payload({
      inventoryUnitConversions, expectedUnitConfiguration: configured
    }), 400, label);
  }
  for (const [label, packageQuantity] of [
    ['package quantity beyond three decimal places', 12.0001],
    ['package quantity beyond storage maximum', 1_000_000_000]
  ]) {
    await rejectsWithoutChanges(payload({
      packageQuantity, inventoryUnitConversions: [], expectedUnitConfiguration: configured
    }), 400, label);
  }
  console.log('PASS: invalid and packaging-conflicting relations reject before any persistent product or child-relation changes');

  const source = await productRow(ids.product);
  const copiedPayload = JSON.parse(JSON.stringify(payload({
    id: undefined, name: '複製した SKU', inventoryUnitConversions: source.inventory_unit_conversions,
    catalogVisibility: 'selected_stores', catalogStoreIds: [ids.store], isOrderable: true
  })));
  assert.equal((await put(copiedPayload)).status, 200);
  const copy = (await db.query('select * from products where name=$1', ['複製した SKU'])).rows[0];
  assert.notEqual(copy.id, ids.product);
  assert.deepEqual(configuration(copy), configuration(source));
  const copyGrants = (await db.query('select store_id from product_catalog_store_grants where product_id=$1', [copy.id])).rows;
  assert.deepEqual(copyGrants, [{ store_id: ids.store }]);
  console.log('PASS: creating a copied SKU preserves conversion JSON without an edit expectation');

  assert.equal((await put(payload({
    unit: '袋', packageQuantity: null, packageQuantityUnit: '',
    inventoryUnitConversions: [{ unit: 'g', unitsPerPurchase: 100 }, { unit: '1/3袋', unitsPerPurchase: 3, fractionalDenominator: 3 }],
    expectedUnitConfiguration: configured
  }))).status, 200);
  const changed = configuration(await productRow(ids.product));
  assert.equal(changed.unit, '袋');
  assert.equal(changed.packageQuantity, null);
  assert.equal(changed.packageQuantityUnit, '');
  assert.equal(changed.inventoryUnitConversions.find(entry => entry.unit === '1/3袋').fractionalDenominator, 3);
  assert.deepEqual(configuration(await productRow(copy.id)), configuration(copy));
  assert.equal((await db.query('select count_conversion_snapshot from inventory_items where id=$1', [ids.stock])).rows[0].count_conversion_snapshot, null);
  assert.equal((await db.query('select unit_conversion_snapshot from inventory_checks where id=$1', [ids.historicalCheck])).rows[0].unit_conversion_snapshot, null);
  console.log('PASS: explicit fresh reconfiguration can change the purchase unit and leave copied SKU configuration independent');

  const beforeDenied = queryCount;
  permission = false;
  assert.equal((await put(payload({ inventoryUnitConversions: relations, expectedUnitConfiguration: configured }))).status, 403);
  assert.equal(queryCount, beforeDenied);
  permission = true;
  session = null;
  assert.equal((await put(payload({ inventoryUnitConversions: relations, expectedUnitConfiguration: configured }))).status, 403);
  assert.equal(queryCount, beforeDenied);
  console.log('PASS: absent session and revoked product permission reject before database access');
} finally {
  await db.close();
}
