// Real production/fulfillment/kitchen/pickup SQL in isolated PostgreSQL only.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createPrintDocumentFixture } from './pos-print-document-fixture.mjs';
const f = await createPrintDocumentFixture(resolve(process.cwd()));
const { db, ids, load, modules, state } = f;
modules['local-bridge-commands'] = { reconcileUberReadyCommand: async () => {} };
const production = load('lib/order-production.ts');
const queue = load('lib/pos-fulfillment.ts');
const bowlData = load('lib/pos-bowl-data.ts');
const pickup = load('app/api/store/display/pickup/route.ts');
const kitchen = load('app/api/store/display/kitchen/route.ts');
let serial = 2000, groups = [];
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
async function sale(items, options = {}) {
  const orderId = uuid(serial++), rows = items.map((item, sortOrder) => ({ ...item, id: uuid(serial++), sortOrder }));
  const summary = { orderType: 'eat_in', posItemFulfillment: { version: options.version ?? 1, items: Object.fromEntries(rows.map(item => [item.id, item.mode === 'immediate' ? { mode: 'immediate', handedOffAt: new Date().toISOString() } : { mode: 'prepare' }])) } };
  if (options.legacy) delete summary.posItemFulfillment;
  await db.query(`insert into store_customer_orders(id,store_id,brand_id,order_source,pickup_code,status,payment_status,pickup_date,pickup_time,amount,customer_summary,pos_cash_session_id)
    values($1,$2,$3,$4,$5,$6,'paid',current_date,to_char(now() at time zone 'Asia/Tokyo','HH24:MI'),$7,$8::jsonb,$9)`,
    [orderId, ids.store, options.brandId || ids.brand, options.source || 'store_pos', `D-${serial}`, options.status || 'new', rows.reduce((sum, item) => sum + (item.amount ?? 100), 0), JSON.stringify(summary), ids.register]);
  for (const item of rows) await db.query(`insert into store_customer_order_items(id,order_id,menu_catalog_item_id,item_name,quantity,amount,gross_amount,paid_amount,sort_order,pickup_code,customizations)
    values($1,$2,$3,$4,1,$5,$5,$5,$6,$7,$8::jsonb)`, [item.id, orderId, item.menuId || ids.menu, item.name, item.amount ?? 100, item.sortOrder, item.code || '', JSON.stringify(item.customizations || [])]);
  return { orderId, rows, summary };
}
const taskRows = async orderId => (await db.query('select * from order_production_tasks where order_id=$1 order by id', [orderId])).rows;
const orderState = async orderId => (await db.query('select status,completed_at,customer_summary from store_customer_orders where id=$1', [orderId])).rows[0];
const pickupRows = async () => { const result = await json(await pickup.GET(f.request(`/api/store/display/pickup?storeId=${ids.store}`))); return [...result.preparing, ...result.ready]; };
const kitchenRows = async () => (await json(await kitchen.GET(f.request(`/api/store/display/kitchen?storeId=${ids.store}`)))).tasks;
let mutationId = 5000;
async function action(taskId, name) {
  const task = (await queue.readPosFulfillmentTasks(ids.store)).find(item => item.id === taskId); assert.ok(task, 'preparation task remains actionable');
  const result = await queue.mutatePosFulfillment({ storeId: ids.store, taskId, action: name, expectedVersion: task.version, mutationId: uuid(mutationId++), undoToken: '', actorId: ids.employee, baseSessionId: state.session.sessionId });
  assert.ok(result, `mutation ${name}`); return result;
}
try {
  const immediate = await sale([{ name: '調味料', mode: 'immediate' }, { name: '瓶ドリンク', mode: 'immediate' }]);
  await production.ensureProductionTasksForOrder(immediate.orderId); await production.refreshActiveProductionTasksForStore(ids.store); await production.ensureProductionTasksForOrder(immediate.orderId);
  assert.equal((await taskRows(immediate.orderId)).length, 0);
  assert.equal((await pickupRows()).length, 0, 'new counter-only order never enters legacy order fallback queue');
  assert.equal((await queue.readPosFulfillmentTasks(ids.store)).length, 0); assert.equal((await kitchenRows()).length, 0);
  await bowlData.finishHandedOffPosOrder(immediate.orderId); assert.equal((await orderState(immediate.orderId)).status, 'completed');
  assert.ok((await orderState(immediate.orderId)).completed_at);
  groups.push('counter-only no task or legacy fallback call; replay/rebuild no resurrection; completes without synthetic handoff task');

  const mixed = await sale([{ name: '麻辣湯', mode: 'prepare', code: '101', customizations: [{ groupName: '飲み物', optionLabels: ['缶ウーロン茶'] }] }, { name: '単品ビール', mode: 'immediate' }]);
  await production.ensureProductionTasksForOrder(mixed.orderId); const task = (await taskRows(mixed.orderId))[0]; assert.equal((await taskRows(mixed.orderId)).length, 1);
  assert.equal(task.order_item_id, mixed.rows[0].id); assert.match(task.item_summary, /缶ウーロン茶/); assert.doesNotMatch(task.item_summary, /単品ビール/);
  // Stale/erroneous counter tasks must neither display nor keep a brand-group queue alive.
  await db.query(`insert into order_production_tasks(id,order_id,store_id,brand_id,production_area,production_area_label,order_item_id,item_summary,pickup_code)
    values($1,$2,$3,$4,'counter','counter ghost item',$5,'単品ビール','999'),($6,$2,$3,$4,'counter','counter ghost brand',null,'単品ビール','')`,
    [uuid(serial++), mixed.orderId, ids.store, ids.brand, mixed.rows[1].id, uuid(serial++)]);
  assert.equal((await queue.readPosFulfillmentTasks(ids.store)).filter(item => item.orderId === mixed.orderId).length, 1);
  const displayed = await pickupRows(); assert.ok(displayed.some(item => item.pickupCode === '101')); assert.ok(!displayed.some(item => item.pickupCode === '999' || item.pickupCode.startsWith('D-')));
  const kitchenTask = (await kitchenRows()).find(item => item.id === task.id); assert.ok(kitchenTask); assert.equal(kitchenTask.itemCount, 1); assert.ok(!JSON.stringify(kitchenTask.itemGroups).includes('単品ビール'));
  await production.ensureProductionTasksForOrder(mixed.orderId); await action(task.id, 'ready'); await action(task.id, 'handoff');
  assert.equal((await orderState(mixed.orderId)).status, 'completed');
  groups.push('mixed creates only bowl task; parent bowl choice labels retained; immediate item/group ghosts hidden and do not block completion');

  const refundLast = await sale([{ name: '作る単品', mode: 'prepare' }, { name: '缶ドリンク', mode: 'immediate' }]);
  await production.ensureProductionTasksForOrder(refundLast.orderId);
  await db.query(`update store_customer_order_items set refund_status='refunded' where id=$1`, [refundLast.rows[0].id]);
  await db.query(`update store_customer_orders set payment_status='partial_refunded',amount=100 where id=$1`, [refundLast.orderId]);
  await production.ensureProductionTasksForOrder(refundLast.orderId); await bowlData.finishHandedOffPosOrder(refundLast.orderId);
  assert.equal((await orderState(refundLast.orderId)).status, 'completed');
  assert.ok(!(await queue.readPosFulfillmentTasks(ids.store)).some(item => item.orderId === refundLast.orderId));
  await production.refreshActiveProductionTasksForStore(ids.store); assert.equal((await taskRows(refundLast.orderId)).length, 1, 'refund does not create an immediate task');
  groups.push('refund last preparation line completes remaining immediate goods even without earlier preparation handoff');

  const generic = await sale([{ name: '調理する単品', mode: 'prepare' }, { name: '調味料', mode: 'immediate' }]);
  await production.ensureProductionTasksForOrder(generic.orderId); const genericTask = (await taskRows(generic.orderId))[0];
  assert.equal(genericTask.order_item_id, null); assert.match(genericTask.item_summary, /調理する単品/); assert.doesNotMatch(genericTask.item_summary, /調味料/);
  const genericKitchen = (await kitchenRows()).find(item => item.id === genericTask.id); assert.equal(genericKitchen.itemCount, 1); assert.ok(!JSON.stringify(genericKitchen.itemGroups).includes('調味料'));
  await action(genericTask.id, 'ready'); await action(genericTask.id, 'handoff'); assert.equal((await orderState(generic.orderId)).status, 'completed');
  groups.push('non-numbered prepared group excludes counter item from summary/count/projection and can complete');

  const legacy = await sale([{ name: '旧単品', mode: 'immediate' }], { legacy: true }); await production.ensureProductionTasksForOrder(legacy.orderId); assert.equal((await taskRows(legacy.orderId)).length, 1);
  const unknown = await sale([{ name: '将来形式', mode: 'immediate' }], { version: 2 }); await production.ensureProductionTasksForOrder(unknown.orderId); assert.equal((await taskRows(unknown.orderId)).length, 1);
  const malformedVersion = await sale([{ name: '不正形式', mode: 'immediate' }], { version: '1' }); await production.ensureProductionTasksForOrder(malformedVersion.orderId); assert.equal((await taskRows(malformedVersion.orderId)).length, 1, 'string version is not the server-minted numeric snapshot');
  for (const source of ['nanacha_web', 'maamaa_web', 'uber_eats', 'table_qr']) {
    const web = await sale([{ name: `${source} 現作ドリンク`, mode: 'immediate' }], { source });
    await production.ensureProductionTasksForOrder(web.orderId); assert.equal((await taskRows(web.orderId)).length, 1, `${source} ignores forged POS-only snapshot`);
  }
  groups.push('legacy and unknown snapshots retain prep; websites/delivery/table QR never adopt POS-only immediate flag');

  const direct = await sale([{ name: '直接受渡の碗', mode: 'prepare', code: '202' }, { name: 'カウンター商品', mode: 'immediate' }]);
  await production.ensureProductionTasksForOrder(direct.orderId); const directTask = (await taskRows(direct.orderId))[0];
  const ghostId = uuid(serial++);
  await db.query(`insert into order_production_tasks(id,order_id,store_id,brand_id,order_item_id,production_area,production_area_label,item_summary)
    values($1,$2,$3,$4,$5,'counter','direct ghost','カウンター商品')`, [ghostId, direct.orderId, ids.store, ids.brand, direct.rows[1].id]);
  assert.equal(await production.setProductionTaskStatus(ghostId, 'ready', ids.employee), undefined, 'immediate task cannot be started by kitchen endpoint');
  const ghostVersion = (await db.query(`select md5(concat_ws('|',status,started_at::text,ready_at::text,handed_off_at::text,updated_at::text)) version from order_production_tasks where id=$1`, [ghostId])).rows[0].version;
  assert.equal(await queue.mutatePosFulfillment({ storeId: ids.store, taskId: ghostId, action: 'ready', expectedVersion: ghostVersion, mutationId: uuid(mutationId++), undoToken: '', actorId: ids.employee, baseSessionId: state.session.sessionId }), null);
  await production.setProductionTaskStatus(directTask.id, 'ready', ids.employee);
  assert.equal(await bowlData.handoffPosBowl(directTask.id, ids.store), direct.orderId);
  assert.equal((await orderState(direct.orderId)).status, 'completed');
  groups.push('direct kitchen status and bowl handoff use same snapshot filter; immediate ghost cannot mutate or block completion');

  const frozenPrepare = await sale([{ name: '注文時は制作', mode: 'prepare' }]);
  await db.query(`update menu_catalog_items set variable_schema='{"fulfillmentMode":"immediate"}'::jsonb where id=$1`, [ids.menu]);
  await production.ensureProductionTasksForOrder(frozenPrepare.orderId); assert.equal((await taskRows(frozenPrepare.orderId)).length, 1);
  const frozenImmediate = await sale([{ name: '注文時にお渡し', mode: 'immediate' }]);
  await db.query(`update menu_catalog_items set variable_schema='{"fulfillmentMode":"prepare"}'::jsonb where id=$1`, [ids.menu]);
  await production.ensureProductionTasksForOrder(frozenImmediate.orderId); assert.equal((await taskRows(frozenImmediate.orderId)).length, 0);
  groups.push('later product fulfillment changes cannot reinterpret immutable paid-order line snapshots');

  const cancelled = await sale([{ name: '返金済み', mode: 'immediate' }], { status: 'cancelled' }); await bowlData.finishHandedOffPosOrder(cancelled.orderId); assert.equal((await orderState(cancelled.orderId)).status, 'cancelled');
  const unpaid = await sale([{ name: '未払い', mode: 'immediate' }]); await db.query(`update store_customer_orders set payment_status='unpaid' where id=$1`, [unpaid.orderId]); await bowlData.finishHandedOffPosOrder(unpaid.orderId); assert.equal((await orderState(unpaid.orderId)).status, 'new');
  groups.push('counter completion never overrides cancelled/refunded or unpaid order');

  await json(await pickup.GET(f.request(`/api/store/display/pickup?storeId=${ids.other}`)), 403); await json(await kitchen.GET(f.request(`/api/store/display/kitchen?storeId=${ids.other}`)), 403);
  state.session = null; await json(await pickup.GET(f.request(`/api/store/display/pickup?storeId=${ids.store}`)), 401); await json(await kitchen.GET(f.request(`/api/store/display/kitchen?storeId=${ids.store}`)), 401);
  groups.push('actual pickup/kitchen endpoints preserve authentication and cross-store denial');
  console.log(JSON.stringify({ passed: groups.length, groups, actualProductionAndQueueSql: true, actualKitchenPickupRoutes: true, isolatedDatabase: 'PGlite', liveWrites: 0, hardwareCalls: 0 }, null, 2));
} finally { await db.close(); }
