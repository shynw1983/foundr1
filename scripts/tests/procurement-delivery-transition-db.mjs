// Real batch transitions in isolated PostgreSQL; never reads DATABASE_URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = new URL('../../', import.meta.url);
const ids = Object.fromEntries(['store','otherStore','order','otherOrder','batch','item','employee'].map((key,i) => [key,`00000000-0000-4000-8000-${String(i+800).padStart(12,'0')}`]));
const exports = {};
runInNewContext(ts.transpileModule(readFileSync(new URL('lib/procurement-delivery-transition.ts', root), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
}).outputText, {exports});
const sql = (parts,...values) => db.query(parts.reduce((text,part,i) => text+part+(i<values.length?`$${i+1}`:''),''),values).then(result=>result.rows);
const transition = status => exports.createDeliveryBatchTransitionQuery(sql,{batchId:ids.batch,storeId:ids.store,status,employeeId:ids.employee});
const facts = async () => ({
  batch:(await db.query('select status,delivered_at,store_confirmed_at,store_confirmed_by from delivery_batches')).rows[0],
  item:(await db.query('select status from purchase_order_items')).rows[0]
});
try {
  await db.exec(`
    create table purchase_orders(id uuid primary key,store_id uuid);
    create table purchase_order_items(id uuid primary key,purchase_order_id uuid,status text);
    create table delivery_batches(id uuid primary key,purchase_order_id uuid,status text,delivered_at timestamptz,store_confirmed_at timestamptz,store_confirmed_by uuid);
    create table delivery_batch_items(delivery_batch_id uuid,purchase_order_item_id uuid);
    insert into purchase_orders values('${ids.order}','${ids.store}'),('${ids.otherOrder}','${ids.otherStore}');
    insert into purchase_order_items values('${ids.item}','${ids.order}','in_delivery');
    insert into delivery_batches(id,purchase_order_id,status) values('${ids.batch}','${ids.order}','in_delivery');
    insert into delivery_batch_items values('${ids.batch}','${ids.item}');
  `);
  const initial = await facts();
  assert.deepEqual(await transition('received'), []);
  assert.deepEqual(await facts(), initial);
  assert.deepEqual(await exports.createDeliveryBatchTransitionQuery(sql,{batchId:ids.batch,storeId:ids.otherStore,status:'delivered',employeeId:ids.employee}), []);
  assert.deepEqual(await facts(), initial);
  console.log('PASS: receiving before arrival and changed store cannot alter batch or item');
  assert.equal((await transition('delivered'))[0].changed, true);
  assert.equal((await facts()).batch.status, 'delivered');
  assert.equal((await facts()).item.status, 'delivered');
  const arrived = await facts();
  assert.equal((await transition('delivered'))[0].changed, false);
  assert.deepEqual(await facts(), arrived);
  assert.equal((await transition('received'))[0].changed, true);
  assert.equal((await facts()).batch.status,'received');
  assert.equal((await facts()).item.status,'received');
  const confirmed = await facts();
  assert.equal((await transition('received'))[0].changed,false);
  assert.equal((await transition('delivered'))[0].changed,false);
  assert.deepEqual(await facts(),confirmed);
  console.log('PASS: complete batch and item transitions, duplicate arrival/confirmation retain received status and timestamps');
  await db.query("update delivery_batches set status='delivered'");
  await db.query('update purchase_order_items set purchase_order_id=$1',[ids.otherOrder]);
  const mismatched = await facts();
  assert.deepEqual(await transition('received'), []);
  assert.deepEqual(await facts(), mismatched);
  await db.query("update purchase_order_items set purchase_order_id=$1,status='in_delivery'",[ids.order]);
  await db.query("update delivery_batches set status='in_delivery'");
  await db.exec(`create function reject_delivery_for_test() returns trigger language plpgsql as $$
    begin raise exception 'expected failure' using errcode='23514'; end; $$;
    create trigger reject_delivery_for_test before update on purchase_order_items for each row execute function reject_delivery_for_test();`);
  const beforeFailure = await facts();
  await assert.rejects(transition('delivered'),error=>error.code==='23514');
  assert.deepEqual(await facts(),beforeFailure);
  console.log('PASS: foreign-order link rejects and a failed item write rolls back the batch transition');
} finally { await db.close(); }
