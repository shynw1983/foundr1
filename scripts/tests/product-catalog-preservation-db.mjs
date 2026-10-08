// Isolated PostgreSQL verification only. This test never reads DATABASE_URL.
// FOUNDR1_PGLITE_MODULE may point to a temporary @electric-sql/pglite installation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const preservation = readFileSync(new URL('db/migrations/20261008_preserve_existing_product_catalog.sql', root), 'utf8');
const foundation = readFileSync(new URL('db/migrations/20261008_procurement_foundation.sql', root), 'utf8');
const transactionBody = migration => migration.replace(/^\s*(?:begin|commit);\s*$/gim, '');
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const ids = { storeA: id(1), storeB: id(2), storeNoBrand: id(3), brandA: id(11), brandB: id(12), unusedBrand: id(13), common: id(21), specific: id(22), legacyUsage: id(23), unset: id(24), noUsage: id(25), stoppedUnused: id(26), futureStore: id(31), newProduct: id(32) };

const oldPairs = `select distinct products.id::text as product_id, stores.id::text as store_id
  from products cross join stores
  where coalesce(products.brand_scope, 'unset') = 'common' or exists (
    select 1 from product_brand_usages usage join store_brands on store_brands.brand_id = usage.brand_id
    where usage.product_id = products.id and store_brands.store_id = stores.id
  ) order by product_id, store_id`;
const newPairs = `select distinct products.id::text as product_id, stores.id::text as store_id
  from products cross join stores
  where products.catalog_visibility = 'selected_stores'
    and exists(select 1 from product_catalog_store_grants grants where grants.product_id = products.id and grants.store_id = stores.id)
    and (products.brand_scope = 'common' or (products.brand_scope = 'specific' and exists (
      select 1 from product_brand_usages usage join store_brands on store_brands.brand_id = usage.brand_id
      where usage.product_id = products.id and store_brands.store_id = stores.id
    ))) order by product_id, store_id`;

async function oldDatabase(blocked = false) {
  const db = new PGlite();
  await db.exec(`
    create table stores(id uuid primary key, name text, status text default 'active');
    create table brands(id uuid primary key, name text);
    create table products(id uuid primary key, name text, brand_scope text default 'unset');
    create table store_brands(store_id uuid, brand_id uuid);
    create table product_brand_usages(product_id uuid, brand_id uuid, is_orderable boolean not null default true,
      usage_note text, default_order_quantity text, spec_note text, priority text, sort_order integer);
    create table purchase_order_items(id uuid primary key);
    create table inventory_checks(id uuid primary key);
  `);
  for (const [storeId, name, status] of [[ids.storeA, 'A', 'active'], [ids.storeB, 'B', 'active'], [ids.storeNoBrand, 'No brand', 'inactive']]) {
    await db.query('insert into stores values($1,$2,$3)', [storeId, name, status]);
  }
  for (const [brandId, name] of [[ids.brandA, 'Brand A'], [ids.brandB, 'Brand B'], [ids.unusedBrand, 'Unused']]) {
    await db.query('insert into brands values($1,$2)', [brandId, name]);
  }
  await db.query('insert into store_brands values($1,$2),($3,$4)', [ids.storeA, ids.brandA, ids.storeB, ids.brandB]);
  for (const [productId, name, scope] of [[ids.common, 'Common', 'common'], [ids.specific, 'Specific', 'specific'], [ids.legacyUsage, 'Legacy usage', 'unset'], [ids.unset, 'Unconfigured', 'unset'], [ids.noUsage, 'Specific without usage', 'specific'], [ids.stoppedUnused, 'Unassigned stopped', 'specific']]) {
    await db.query('insert into products values($1,$2,$3)', [productId, name, scope]);
  }
  for (const [productId, brandId, isOrderable] of [[ids.specific, ids.brandA, !blocked], [ids.legacyUsage, ids.brandB, true], [ids.stoppedUnused, ids.unusedBrand, false]]) {
    await db.query('insert into product_brand_usages values($1,$2,$3,$4,$5,$6,$7,$8)', [productId, brandId, isOrderable, 'retained note', '12 bags', 'retained spec', 'high', 5]);
  }
  return db;
}

const db = await oldDatabase();
try {
  const previousPairs = (await db.query(oldPairs)).rows;
  const previousUsages = (await db.query('select * from product_brand_usages order by product_id,brand_id')).rows;
  assert.equal(previousPairs.length, 5);
  await db.exec(`begin;\n${transactionBody(preservation)}\n${transactionBody(foundation)}\ncommit;`);
  await db.exec(foundation);
  assert.deepEqual((await db.query(newPairs)).rows, previousPairs);
  assert.equal((await db.query('select count(*)::int as count from products where catalog_visibility = $1', ['brand_stores'])).rows[0].count, 0);
  assert.deepEqual((await db.query('select * from product_brand_usages order by product_id,brand_id')).rows, previousUsages);
  console.log('PASS: exact previous store/SKU visibility, retained usage fields and stop flags, repeatable foundation');

  const scopes = (await db.query('select id::text, brand_scope, catalog_visibility from products order by id')).rows;
  assert.equal(scopes.find(product => product.id === ids.legacyUsage).brand_scope, 'specific');
  for (const productId of [ids.unset, ids.noUsage, ids.stoppedUnused]) {
    assert.equal(scopes.find(product => product.id === productId).catalog_visibility, 'internal');
  }
  assert.equal(scopes.find(product => product.id === ids.unset).brand_scope, 'unset');
  console.log('PASS: only existing explicit brand usage normalizes scope; unassociated SKUs remain internal');

  await db.query('insert into stores(id,name) values($1,$2)', [ids.futureStore, 'New store']);
  await db.query('insert into store_brands values($1,$2)', [ids.futureStore, ids.brandA]);
  await db.query('insert into products(id,name,brand_scope) values($1,$2,$3)', [ids.newProduct, 'New SKU', 'common']);
  assert.equal((await db.query('select catalog_visibility from products where id=$1', [ids.newProduct])).rows[0].catalog_visibility, 'internal');
  const afterNewEntities = (await db.query(newPairs)).rows;
  assert.deepEqual(afterNewEntities, previousPairs);
  assert.ok(afterNewEntities.every(pair => pair.store_id !== ids.futureStore && pair.product_id !== ids.newProduct));
  console.log('PASS: new stores inherit no grants and new SKUs stay internal');

  await db.query("update products set catalog_visibility='internal' where id=$1", [ids.specific]);
  await db.query('delete from product_catalog_store_grants where product_id=$1', [ids.specific]);
  const priorAdminState = (await db.query(newPairs)).rows;
  await assert.rejects(db.exec(preservation), /catalog_visibility already exists/);
  await db.exec('rollback');
  assert.deepEqual((await db.query(newPairs)).rows, priorAdminState);
  assert.equal((await db.query('select catalog_visibility from products where id=$1', [ids.specific])).rows[0].catalog_visibility, 'internal');
  console.log('PASS: rerunning preservation refuses to overwrite later HQ publication choices');
} finally {
  await db.close();
}

const blockedDb = await oldDatabase(true);
try {
  await assert.rejects(blockedDb.exec(preservation), /dormant is_orderable=false/);
  await blockedDb.exec('rollback');
  assert.equal((await blockedDb.query("select count(*)::int as count from information_schema.columns where table_name='products' and column_name='catalog_visibility'")).rows[0].count, 0);
  assert.equal((await blockedDb.query('select brand_scope from products where id=$1', [ids.legacyUsage])).rows[0].brand_scope, 'unset');
  assert.equal((await blockedDb.query('select is_orderable from product_brand_usages where product_id=$1', [ids.specific])).rows[0].is_orderable, false);
  console.log('PASS: dormant matching stop flags abort atomically without clearing flags or changing legacy scope');
} finally {
  await blockedDb.close();
}
