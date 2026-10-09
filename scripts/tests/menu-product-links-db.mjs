// Isolated PostgreSQL verification. Never reads DATABASE_URL or calls a production API.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { employee: id(1), brand: id(2), otherBrand: id(3), store: id(4), item: id(5), otherItem: id(6), scopedItem: id(7), inactiveItem: id(8), group: id(9), option: id(10), common: id(11), specific: id(12), wrongBrand: id(13) };
let session = { id: ids.employee, role: 'owner' };
let permission = true;
let queries = 0;
const sql = Object.assign((parts, ...values) => ({
  text: parts.reduce((text, part, i) => text + part + (i < values.length ? `$${i + 1}` : ''), ''), values,
  then(resolve, reject) { queries++; return db.query(this.text, this.values).then(result => result.rows).then(resolve, reject); }
}), {
  transaction: statements => db.transaction(async tx => {
    const rows = [];
    for (const statement of statements) { queries++; rows.push((await tx.query(statement.text, statement.values)).rows); }
    return rows;
  })
});
function load(path, modules) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, Response, URL, require: name => {
    if (name === './db') return { sql };
    if (!(name in modules)) throw new Error(`Unmocked dependency: ${name}`);
    return modules[name];
  } });
  return exports;
}
const rows = () => db.query('select menu_catalog_item_id::text as item,menu_option_id::text as option,product_id::text as product from menu_product_links order by item,option,product').then(result => result.rows);
try {
  await db.exec(`
    create table employees(id uuid primary key);
    create table purchase_orders(id uuid primary key);
    create table brands(id uuid primary key);
    create table stores(id uuid primary key);
    create table products(id uuid primary key,name text,unit text,brand_scope text,catalog_visibility text default 'internal',is_orderable boolean default false);
    create table product_brand_usages(product_id uuid,brand_id uuid,is_orderable boolean default false);
    create table menu_catalog_items(id uuid primary key,brand_id uuid,store_id uuid,name text,is_active boolean);
    create table menu_option_groups(id uuid primary key,brand_id uuid,menu_catalog_item_id uuid,is_active boolean);
    create table menu_options(id uuid primary key,option_group_id uuid,name text,is_active boolean);
    insert into employees values('${ids.employee}');
    insert into brands values('${ids.brand}'),('${ids.otherBrand}');
    insert into stores values('${ids.store}');
    insert into products(id,name,unit,brand_scope) values('${ids.common}','同名 SKU','袋','common'),('${ids.specific}','同名 SKU','箱','specific'),('${ids.wrongBrand}','別ブランド','個','specific');
    insert into product_brand_usages(product_id,brand_id) values('${ids.specific}','${ids.brand}'),('${ids.wrongBrand}','${ids.otherBrand}');
    insert into menu_catalog_items values('${ids.item}','${ids.brand}',null,'Item',true),('${ids.otherItem}','${ids.brand}',null,'Other item',true),('${ids.scopedItem}','${ids.brand}','${ids.store}','Store item',true),('${ids.inactiveItem}','${ids.brand}',null,'Inactive',false);
    insert into menu_option_groups values('${ids.group}','${ids.brand}',null,true);
    insert into menu_options values('${ids.option}','${ids.group}','Option',true);
  `);
  const migration = readFileSync(new URL('db/migrations/20261008_menu_product_links.sql', root), 'utf8');
  await db.exec(migration); await db.exec(migration);
  await assert.rejects(db.query('insert into menu_product_links(product_id) values($1)', [ids.common]));
  await assert.rejects(db.query('insert into menu_product_links(menu_catalog_item_id,menu_option_id,product_id) values($1,$2,$3)', [ids.item, ids.option, ids.common]));
  console.log('PASS: repeatable migration and exactly-one-target foreign-key structure');

  const policy = load('lib/menu-product-link-policy.ts', {});
  const links = load('lib/menu-product-links.ts', { './menu-product-link-policy': policy });
  const route = load('app/api/menu-product-links/route.ts', {
    '../../../lib/api-auth': { requireOsSession: async () => session },
    '../../../lib/role-permissions': { roleHasPermission: async () => permission },
    '../../../lib/menu-product-link-policy': policy,
    '../../../lib/menu-product-links': links
  });
  const get = (kind = 'item', targetId = ids.item) => route.GET(new Request(`https://example.test/api/menu-product-links?kind=${kind}&targetId=${targetId}`));
  const put = body => route.PUT(new Request('https://example.test/api/menu-product-links', { method: 'PUT', body: JSON.stringify(body) }));
  let response = await put({ kind: 'item', targetId: ids.item, productIds: [ids.specific, ids.common], expectedProductIds: [] });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.deepEqual(saved.productIds, [ids.common, ids.specific].sort());
  assert.equal(saved.products.length, 2);
  assert.equal(saved.availableProducts.length, 2);
  assert.equal(saved.products[0].name, saved.products[1].name);
  assert.ok(!('catalogVisibility' in saved.products[0]));
  console.log('PASS: explicit duplicate-name IDs, multi-SKU associations, internal/stopped HQ candidates');

  const before = await rows();
  response = await put({ kind: 'item', targetId: ids.item, productIds: [ids.wrongBrand], expectedProductIds: saved.productIds });
  assert.equal(response.status, 400);
  assert.deepEqual(await rows(), before);
  response = await put({ kind: 'item', targetId: ids.item, productIds: [], expectedProductIds: [] });
  assert.equal(response.status, 409);
  assert.deepEqual(await rows(), before);
  assert.equal((await put({ kind: 'item', targetId: ids.item, productIds: [] })).status, 400);
  console.log('PASS: cross-brand SKU and stale/missing expected sets reject without replacing links');

  await put({ kind: 'item', targetId: ids.otherItem, productIds: [ids.common], expectedProductIds: [] });
  await put({ kind: 'option', targetId: ids.option, productIds: [ids.specific], expectedProductIds: [] });
  await put({ kind: 'item', targetId: ids.item, productIds: [], expectedProductIds: saved.productIds });
  assert.deepEqual((await rows()).map(row => row.product).sort(), [ids.common, ids.specific].sort());
  await assert.rejects(db.query('delete from products where id=$1', [ids.specific]));
  console.log('PASS: item/option isolation, target-only replacement and linked-SKU delete restriction');

  assert.equal((await get('item', ids.scopedItem)).status, 400);
  assert.equal((await get('item', ids.inactiveItem)).status, 200);
  assert.equal((await put({ kind: 'item', targetId: ids.inactiveItem, productIds: [ids.common], expectedProductIds: [] })).status, 409);
  console.log('PASS: canonical global targets only; inactive targets remain readable but cannot change');

  const beforeDenied = queries;
  for (const role of ['store_owner', 'store_manager', 'staff', 'store_terminal']) {
    session.role = role;
    assert.equal((await get()).status, 403);
    assert.equal((await put({ kind: 'item', targetId: ids.item, productIds: [ids.common], expectedProductIds: [] })).status, 403);
  }
  session.role = 'manager'; permission = false;
  assert.equal((await get()).status, 403);
  assert.equal(queries, beforeDenied);
  console.log('PASS: non-HQ and revoked menu permission denied before database access');
} finally { await db.close(); }
