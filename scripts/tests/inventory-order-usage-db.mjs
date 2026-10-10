// Real order-usage SQL in isolated PostgreSQL; never reads DATABASE_URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const db = new PGlite();
const uuid = n => `00000000-0000-4000-8000-${String(1000 + n).padStart(12, '0')}`;
const ids = Object.fromEntries(['store','otherStore','employee','brand','product','estimatedProduct','unmeasuredProduct','location','stock','estimatedStock','unmeasuredStock','menu','estimatedMenu','unmeasuredMenu','emptyMenu','group','option','historicOrder'].map((key,index) => [key, uuid(index + 1)]));
const now = Date.now(), occurredAt = new Date(now - 60 * 60 * 1000).toISOString();
const cutoff = new Date(now - 2 * 60 * 60 * 1000).toISOString(), countedAt = new Date(now - 24 * 60 * 60 * 1000).toISOString();
const statements = [], failures = [];
let session = {id: ids.employee, name: 'Tester', role: 'store_manager'};
let permission = true, storeAllowed = true, visibleProducts = [ids.product, ids.estimatedProduct, ids.unmeasuredProduct];
let beforeCommit = null, beforeMapping = null;
async function execute(statement, connection = db) {
  statements.push(statement.text);
  try { return (await connection.query(statement.text, statement.values)).rows; }
  catch (error) { failures.push({code: error.code, message: error.message, position: error.position, text: statement.text}); throw error; }
}
const sql = Object.assign((parts, ...values) => ({
  text: parts.reduce((text,part,index) => text + part + (index < values.length ? `$${index + 1}` : ''), ''), values,
  then(resolve,reject) { return execute(this).then(resolve,reject); }
}), { transaction: async queries => {
  if (beforeCommit && queries.some(query => query.text.includes('insert into inventory_order_usage_events'))) {
    const hook = beforeCommit; beforeCommit = null; await hook();
  }
  if (beforeMapping && queries.some(query => query.text.includes('with mappings as materialized'))) {
    const hook = beforeMapping; beforeMapping = null; await hook();
  }
  return db.transaction(async transaction => {
    const rows = []; for (const query of queries) rows.push(await execute(query,transaction)); return rows;
  });
} });
function load(path, modules = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path,root),'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText, {exports,Response,Request,URL,console,require: name => {
    if (name.endsWith('/db') || name === './db') return {sql};
    if (name.endsWith('/api-auth')) return {
      requireOsSession: async () => session,
      requireWritableOsSession: async () => session && session.role !== 'store_terminal' ? session : null,
      canAccessStore: async (_,storeId) => storeAllowed && storeId === ids.store
    };
    if (name.endsWith('/role-permissions')) return {roleHasPermission: async () => permission};
    if (name.endsWith('/product-catalog-access')) return {
      getVisibleProductIdsForStore: async () => visibleProducts,
      assertProductViewableAtStore: async (_,storeId,productId) => storeId === ids.store && visibleProducts.includes(productId)
        ? {ok: true} : {ok: false,status: 403,error: 'hidden product'}
    };
    if (name in modules) return modules[name];
    throw new Error(`Unmocked isolated usage dependency ${name}`);
  }});
  return exports;
}
const units = load('lib/product-unit-conversions.ts');
const policy = load('lib/inventory-order-usage-policy.ts', {'./product-unit-conversions': units});
const engine = load('lib/inventory-order-usage.ts', {'./inventory-order-usage-policy': policy});
const production = load('lib/order-production.ts', {
  './maamaa-production-rules': {}, './maamaa-production-summary': {},
  './production-estimate': {calculateProductionEstimateMinutes: () => 10},
  './sales-orders': {syncWebReservationToSalesOrder: id => engine.safeSyncInventoryOrderUsage(id)},
  './store-dining-sessions': {syncDiningSessionFromProduction: async () => undefined}
});
const api = load('app/api/inventory/order-usage/route.ts', {
  '../../../../lib/inventory-order-usage': engine, '../../../../lib/inventory-order-usage-policy': policy
});
const post = body => api.POST(new Request('https://example.test/api/inventory/order-usage', {method:'POST',body:JSON.stringify({storeId:ids.store,...body})}));
const get = (storeId = ids.store) => api.GET(new Request(`https://example.test/api/inventory/order-usage?storeId=${storeId}`));
const rows = async (query, params = []) => (await db.query(query,params)).rows;
const count = async (table, orderId) => Number((await rows(`select count(*) as count from ${table} where ${table === 'inventory_movements' ? 'source_order_id' : 'order_id'}=$1`,[orderId]))[0].count);
let orderSequence = 100;
async function createOrder(options = {}) {
  const id = uuid(orderSequence++), itemId = uuid(orderSequence++);
  const sourceExternalId=options.source&&!['store_pos','table_qr','nanacha_web','maamaa_web'].includes(options.source)
    ? `bridge:${options.storeId ?? ids.store}:2026-10-11:TEST-${orderSequence}` : null;
  await db.query(`insert into store_customer_orders(id,store_id,brand_id,pickup_code,order_source,status,payment_status,paid_at,created_at,source_external_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,options.storeId ?? ids.store,ids.brand,`TEST-${orderSequence}`,options.source ?? 'store_pos',options.status ?? 'new',options.payment ?? 'paid',options.paidAt ?? occurredAt,
      options.createdAt ?? new Date(now-90*60*1000).toISOString(),sourceExternalId]);
  await db.query(`insert into store_customer_order_items(id,order_id,menu_catalog_item_id,item_name,quantity,customizations)
    values($1,$2,$3,$4,$5,$6::jsonb)`,[itemId,id,options.menu === null ? null : options.menu ?? ids.menu,'Tea',options.quantity ?? 3,
    JSON.stringify(options.options ? [{groupId:ids.group,optionIds:options.options}] : [])]);
  return {id,itemId};
}
async function prepare(order, at = occurredAt) {
  await db.query(`update store_customer_orders set status='preparing',preparing_at=$2,inventory_first_prepared_at=$2,
    inventory_preparation_source_snapshot=inventory_source_snapshot where id=$1`,[order.id,at]);
}
async function readyThenPrepare(options = {}) {
  const order = await createOrder(options);
  assert.equal(await engine.markInventoryOrderReady(order.id),true);
  await prepare(order,options.occurredAt ?? occurredAt);
  return order;
}
async function settings(enabled = true, trigger = 'preparation', from = cutoff) {
  await db.query(`insert into inventory_usage_settings(store_id,enabled,enabled_from,trigger_mode,revision)
    values($1,$2,$3,$4,1) on conflict(store_id) do update set enabled=excluded.enabled,enabled_from=excluded.enabled_from,
    trigger_mode=excluded.trigger_mode,revision=inventory_usage_settings.revision+1`,[ids.store,enabled,from,trigger]);
}
async function stockFacts(id = ids.stock) {
  return (await rows(`select current_quantity::float as physical,stock_quantity::float as book,last_counted_at::text as counted,
    last_counted_by::text as actor,exception_code,exception_note,stock_revision from inventory_items where id=$1`,[id]))[0];
}

try {
  await db.exec(`
    create table stores(id uuid primary key,name text,status text default 'active');
    create table employees(id uuid primary key,name text);
    create table brands(id uuid primary key,name text);
    create table store_brands(store_id uuid references stores(id),brand_id uuid references brands(id));
    create table products(id uuid primary key,name text,unit text,package_quantity numeric,package_quantity_unit text,
      inventory_unit_conversions jsonb not null default '[]',brand_scope text not null default 'common');
    create table product_brand_usages(product_id uuid references products(id),brand_id uuid references brands(id));
    create table menu_catalog_items(id uuid primary key,brand_id uuid references brands(id),name text,category text default 'Tea',
      is_active boolean default true,store_id uuid references stores(id));
    create table menu_option_groups(id uuid primary key,brand_id uuid references brands(id),name text,is_active boolean default true,
      menu_catalog_item_id uuid references menu_catalog_items(id),applicable_categories text[] default '{}');
    create table menu_options(id uuid primary key,option_group_id uuid references menu_option_groups(id),name text,
      is_active boolean default true,applicable_categories text[] default '{}');
    create table inventory_locations(id uuid primary key,store_id uuid references stores(id),name text,status text default 'active');
    create table inventory_items(id uuid primary key,store_id uuid references stores(id),product_id uuid references products(id),
      location_id uuid references inventory_locations(id),count_unit text,stock_quantity numeric(18,6),current_quantity numeric(18,6),
      stock_revision integer default 0,stock_conversion_snapshot jsonb,last_counted_at timestamptz,last_counted_by uuid references employees(id),
      exception_code text default '',exception_note text default '',status text default 'active',updated_at timestamptz default now());
    create table inventory_checks(id uuid primary key,inventory_item_id uuid references inventory_items(id),quantity numeric(18,6),created_at timestamptz);
    create table inventory_stock_receipts(id uuid primary key default gen_random_uuid(),inventory_item_id uuid references inventory_items(id),batch_packaging_snapshot jsonb);
    create table store_customer_orders(id uuid primary key,store_id uuid references stores(id),brand_id uuid references brands(id),pickup_code text,
      order_source text,status text,payment_status text,paid_at timestamptz,preparing_at timestamptz,ready_at timestamptz,completed_at timestamptz,
      source_external_id text,estimated_prep_minutes integer,estimated_ready_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table store_customer_order_items(id uuid primary key,order_id uuid references store_customer_orders(id),menu_catalog_item_id uuid references menu_catalog_items(id),
      item_name text,quantity integer default 1,measured_quantity numeric,measured_unit text default '',size_key text default '',size_label text default '',
      temperature text default '',sweetness text default '',ice text default '',option_key text default '',option_label text default '',
      topping_keys text[] default '{}',topping_labels text[] default '{}',customizations jsonb default '[]',refund_status text default '',sort_order integer default 0);
    create table order_production_tasks(id uuid primary key,order_id uuid references store_customer_orders(id),started_at timestamptz,
      store_id uuid references stores(id),brand_id uuid references brands(id),production_area text default 'general',production_area_label text default 'Kitchen',
      status text default 'new',print_status text default 'unprinted',item_summary text default '',ready_at timestamptz,
      completed_by uuid references employees(id),created_at timestamptz default now(),updated_at timestamptz default now());
    insert into stores(id,name) values('${ids.store}','A'),('${ids.otherStore}','B');
    insert into employees values('${ids.employee}','Tester');
    insert into brands values('${ids.brand}','Brand');
    insert into store_brands values('${ids.store}','${ids.brand}');
    insert into products(id,name,unit,package_quantity,package_quantity_unit) values
      ('${ids.product}','Exact SKU','袋',100,'g'),('${ids.estimatedProduct}','Hidden estimate SKU','袋',100,'g'),('${ids.unmeasuredProduct}','Unmeasured SKU','袋',100,'g');
    insert into product_brand_usages values('${ids.product}','${ids.brand}'),('${ids.estimatedProduct}','${ids.brand}'),('${ids.unmeasuredProduct}','${ids.brand}');
    insert into inventory_locations(id,store_id,name) values('${ids.location}','${ids.store}','Shelf');
    insert into inventory_items(id,store_id,product_id,location_id,count_unit,current_quantity,stock_quantity,last_counted_at,last_counted_by,exception_code,exception_note,stock_conversion_snapshot) values
      ('${ids.stock}','${ids.store}','${ids.product}','${ids.location}','g',100,100,'${countedAt}','${ids.employee}','quality','Preserve actual inspection','{"purchaseUnit":"袋","countUnit":"g","unitsPerPurchase":100}'),
      ('${ids.estimatedStock}','${ids.store}','${ids.estimatedProduct}','${ids.location}','g',100,100,'${countedAt}','${ids.employee}','','','{"purchaseUnit":"袋","countUnit":"g","unitsPerPurchase":100}'),
      ('${ids.unmeasuredStock}','${ids.store}','${ids.unmeasuredProduct}','${ids.location}','g',100,100,'${countedAt}','${ids.employee}','','','{"purchaseUnit":"袋","countUnit":"g","unitsPerPurchase":100}');
    insert into inventory_checks values('${uuid(30)}','${ids.stock}',100,'${countedAt}');
    insert into menu_catalog_items(id,brand_id,name) values('${ids.menu}','${ids.brand}','Tea'),('${ids.estimatedMenu}','${ids.brand}','Estimate'),
      ('${ids.unmeasuredMenu}','${ids.brand}','Unmeasured'),('${ids.emptyMenu}','${ids.brand}','No consumables');
    insert into menu_option_groups(id,brand_id,name) values('${ids.group}','${ids.brand}','Extras');
    insert into menu_options(id,option_group_id,name) values('${ids.option}','${ids.group}','Extra');
    insert into store_customer_orders(id,store_id,brand_id,pickup_code,order_source,status,payment_status,preparing_at,created_at)
      values('${ids.historicOrder}','${ids.store}','${ids.brand}','HISTORIC','store_pos','preparing','paid','${new Date(now-3*60*60*1000).toISOString()}',now());
  `);
  const physicalBefore = await stockFacts();
  for (const migration of ['20261011_inventory_recipes.sql','20261011_inventory_order_usage.sql']) {
    await db.exec(readFileSync(new URL(`db/migrations/${migration}`,root),'utf8'));
  }
  assert.deepEqual(await stockFacts(),physicalBefore);
  assert.equal((await rows('select inventory_items_ready_at from store_customer_orders where id=$1',[ids.historicOrder]))[0].inventory_items_ready_at,null);
  assert.ok((await rows('select inventory_first_prepared_at from store_customer_orders where id=$1',[ids.historicOrder]))[0].inventory_first_prepared_at);
  for (const [index,targetType,targetId,productId,quantity,mode] of [
    [40,'item',ids.menu,ids.product,2,'exact'],[42,'option',ids.option,ids.product,0.5,'exact'],
    [44,'item',ids.estimatedMenu,ids.estimatedProduct,2,'estimate'],[46,'item',ids.unmeasuredMenu,ids.unmeasuredProduct,null,'unmeasured'],
    [48,'item',ids.emptyMenu,null,null,'unmeasured']
  ]) {
    await db.query(`insert into inventory_recipes(id,brand_id,name,kind,target_type,target_id) values($1,$2,$3,'menu',$4,$5)`,[uuid(index),ids.brand,`Recipe-${index}`,targetType,targetId]);
    await db.query(`insert into inventory_recipe_versions(id,recipe_id,version,snapshot) values($1,$2,1,$3::jsonb)`,[uuid(index+1),uuid(index),JSON.stringify({basis:'serving',inputs:productId?[{productId,quantity,unit:'g',mode}]:[]})]);
    await db.query('update inventory_recipes set current_version_id=$2 where id=$1',[uuid(index),uuid(index+1)]);
  }
  console.log('PASS: actual additive migrations retain physical stock and historical preparation without inventing ready sources');

  await settings();
  const exact = await readyThenPrepare({options:[ids.option,ids.option]});
  assert.equal(await engine.safeSyncInventoryOrderUsage(exact.id),'applied');
  assert.equal((await stockFacts()).book,91);
  assert.equal(await count('inventory_movements',exact.id),2);
  assert.deepEqual((await rows('select quantity::float as qty,exposure::float as exposure from inventory_movements where source_order_id=$1 order by id',[exact.id])).map(row=>[row.qty,row.exposure]),[[-6,3],[-3,6]]);
  for (let retry=0;retry<3;retry++) assert.equal(await engine.safeSyncInventoryOrderUsage(exact.id),'already');
  assert.equal(await engine.markInventoryOrderReady(exact.id),true);
  assert.equal(await count('inventory_order_usage_events',exact.id),1);
  assert.equal((await stockFacts()).book,91);
  const afterExact=await stockFacts();
  for (const field of ['physical','counted','actor','exception_code','exception_note']) assert.equal(afterExact[field],physicalBefore[field]);
  assert.equal(Number((await rows('select count(*) as count from inventory_checks'))[0].count),1);
  const lockStatements=statements.filter(text=>/for share|for update/.test(text));
  const productLock=lockStatements.findIndex(text=>text.includes('from products')&&text.includes('for share'));
  const itemLock=lockStatements.findIndex(text=>text.includes('from inventory_items')&&text.includes('for update'));
  assert.ok(productLock>=0&&itemLock>productLock);
  console.log('PASS: one actual usage event atomically writes exact option/serving movements, deduplicates repeats and preserves physical/quality facts');

  const pending=await createOrder();
  await engine.markInventoryOrderReady(pending.id);
  assert.equal(await engine.safeSyncInventoryOrderUsage(pending.id),'ineligible');
  await settings(false);
  const disabled=await readyThenPrepare();
  assert.equal(await engine.safeSyncInventoryOrderUsage(disabled.id),'ineligible');
  await settings();
  const old=await readyThenPrepare({occurredAt:new Date(now-3*60*60*1000).toISOString()});
  assert.equal(await engine.safeSyncInventoryOrderUsage(old.id),'ineligible');
  assert.equal(await engine.safeSyncInventoryOrderUsage(ids.historicOrder),'ineligible');
  const missingPrepared=await createOrder();
  await prepare(missingPrepared);
  assert.equal(await engine.safeSyncInventoryOrderUsage(missingPrepared.id),'blocked');
  assert.ok((await rows('select code from inventory_order_usage_issues where order_id=$1',[missingPrepared.id])).some(row=>row.code==='prepared_source_missing'));
  await settings(true,'confirmed_sale');
  const incomplete=await createOrder();
  assert.equal(await engine.safeSyncInventoryOrderUsage(incomplete.id),'blocked');
  assert.equal(await count('inventory_order_usage_events',incomplete.id),0);
  await engine.markInventoryOrderReady(incomplete.id);
  assert.equal(await count('inventory_order_usage_events',incomplete.id),1);
  await settings();
  const table=await readyThenPrepare({source:'table_qr',payment:'unpaid'});
  assert.equal(await engine.safeSyncInventoryOrderUsage(table.id),'applied');
  const bridge=await readyThenPrepare({source:'uber_eats'});
  assert.equal(await engine.safeSyncInventoryOrderUsage(bridge.id),'blocked');
  assert.equal(await count('inventory_order_usage_events',bridge.id),0);
  assert.ok((await rows('select code from inventory_order_usage_issues where order_id=$1',[bridge.id])).some(row=>row.code==='unsupported_bridge_identity'));
  console.log('PASS: readiness, explicit activation, prior-source freeze, historical cutoff, paid-new projection and unpaid-table preparation gates');

  await db.query('update inventory_items set stock_quantity=1 where id=$1',[ids.stock]);
  const negative=await readyThenPrepare();
  assert.equal(await engine.safeSyncInventoryOrderUsage(negative.id),'applied');
  assert.equal((await stockFacts()).book,-5);
  await db.query('update inventory_items set stock_quantity=null where id=$1',[ids.stock]);
  const unknown=await readyThenPrepare();
  assert.equal(await engine.safeSyncInventoryOrderUsage(unknown.id),'applied');
  assert.equal((await stockFacts()).book,null);
  const unknownMovement=(await rows('select quantity::float as quantity,changes_stock,before_quantity,after_quantity from inventory_movements where source_order_id=$1',[unknown.id]))[0];
  assert.deepEqual(unknownMovement,{quantity:-6,changes_stock:false,before_quantity:null,after_quantity:null});
  const estimate=await readyThenPrepare({menu:ids.estimatedMenu}), unmeasured=await readyThenPrepare({menu:ids.unmeasuredMenu});
  assert.equal(await engine.safeSyncInventoryOrderUsage(estimate.id),'applied');
  assert.equal(await engine.safeSyncInventoryOrderUsage(unmeasured.id),'applied');
  assert.equal((await stockFacts(ids.estimatedStock)).book,100);
  assert.equal((await stockFacts(ids.unmeasuredStock)).book,100);
  assert.equal((await rows('select confidence,quantity::float as quantity,changes_stock from inventory_movements where source_order_id=$1',[estimate.id]))[0].confidence,'estimate');
  assert.deepEqual((await rows('select confidence,quantity,changes_stock from inventory_movements where source_order_id=$1',[unmeasured.id]))[0],{confidence:'unmeasured',quantity:null,changes_stock:false});
  const noUsage=await readyThenPrepare({menu:ids.emptyMenu});
  assert.equal(await engine.safeSyncInventoryOrderUsage(noUsage.id),'applied');
  assert.equal(await count('inventory_order_usage_events',noUsage.id),1);
  assert.equal(await count('inventory_movements',noUsage.id),0);
  console.log('PASS: exact deficits stay negative; unknown stock and estimate/unmeasured exposure never fabricate book or physical quantities');

  await db.query('update inventory_items set stock_quantity=100,last_counted_at=$2 where id=$1',[ids.stock,new Date(now-30*60*1000).toISOString()]);
  const anchorFacts=await stockFacts();
  const late=await readyThenPrepare();
  assert.equal(await engine.safeSyncInventoryOrderUsage(late.id),'applied');
  assert.deepEqual(await stockFacts(),anchorFacts);
  assert.equal((await rows('select changes_stock,metadata from inventory_movements where source_order_id=$1',[late.id]))[0].changes_stock,false);
  await db.query('update inventory_items set last_counted_at=$2 where id=$1',[ids.stock,countedAt]);
  const refunded=await readyThenPrepare();
  await db.query(`update store_customer_order_items set refund_status='refunded',quantity=1,item_name='Replacement' where id=$1`,[refunded.itemId]);
  await db.query(`update store_customer_orders set status='cancelled',payment_status='refunded',inventory_items_ready_at=null where id=$1`,[refunded.id]);
  assert.equal(await engine.markInventoryOrderReady(refunded.id),true);
  assert.equal(await count('inventory_order_usage_events',refunded.id),1);
  assert.equal((await stockFacts()).book,94);
  const frozenEvent=(await rows('select source_snapshot from inventory_order_usage_events where order_id=$1',[refunded.id]))[0].source_snapshot;
  assert.equal(frozenEvent.items[0].quantity,3);assert.equal(frozenEvent.items[0].refundStatus,'');
  assert.equal(await engine.safeSyncInventoryOrderUsage(refunded.id),'already');
  assert.equal((await stockFacts()).book,94);
  console.log('PASS: late actual-count anchors do not double deduct; first prepared sources remain original through later cancellation/refund and retry');

  const race=await readyThenPrepare();
  beforeCommit=()=>db.query('update inventory_items set stock_revision=stock_revision+1 where id=$1',[ids.stock]);
  assert.equal(await engine.safeSyncInventoryOrderUsage(race.id),'blocked');
  assert.equal(await count('inventory_order_usage_events',race.id),0);
  assert.equal((await stockFacts()).book,94);
  assert.equal(await engine.safeSyncInventoryOrderUsage(race.id),'applied');
  assert.equal((await stockFacts()).book,88);
  const failureOrder=await readyThenPrepare();
  await db.exec("alter table inventory_movements add constraint simulated_usage_failure check(kind<>'order_use') not valid;");
  assert.equal(await engine.safeSyncInventoryOrderUsage(failureOrder.id),'failed');
  assert.equal(await count('inventory_order_usage_events',failureOrder.id),0);
  assert.equal((await stockFacts()).book,88);
  assert.ok((await rows('select code from inventory_order_usage_issues where order_id=$1',[failureOrder.id])).some(row=>row.code==='usage_sync_failed'));
  await db.exec('alter table inventory_movements drop constraint simulated_usage_failure;');
  assert.equal(await engine.safeSyncInventoryOrderUsage(failureOrder.id),'applied');
  assert.equal((await stockFacts()).book,82);
  assert.equal(await engine.safeSyncInventoryOrderUsage(failureOrder.id),'already');
  console.log('PASS: changing stock revisions blocks stale CAS; movement failure rolls back event and book together and retries once');

  const privateMenu=uuid(500),inactiveOption=uuid(501),wrongBrand=uuid(502),wrongMenu=uuid(503),boundGroup=uuid(504),boundOption=uuid(505);
  await db.query('insert into menu_catalog_items(id,brand_id,name,store_id) values($1,$2,$3,$4)',[privateMenu,ids.brand,'Private menu',ids.store]);
  await db.query('insert into menu_options(id,option_group_id,name,is_active) values($1,$2,$3,false)',[inactiveOption,ids.group,'Inactive option']);
  await db.query('insert into brands values($1,$2)',[wrongBrand,'Other brand']);
  await db.query('insert into menu_catalog_items(id,brand_id,name) values($1,$2,$3)',[wrongMenu,wrongBrand,'Other brand menu']);
  await db.query('insert into menu_option_groups(id,brand_id,name,menu_catalog_item_id) values($1,$2,$3,$4)',[boundGroup,ids.brand,'Bound options',ids.estimatedMenu]);
  await db.query('insert into menu_options(id,option_group_id,name) values($1,$2,$3)',[boundOption,boundGroup,'Different item option']);
  let mappingState=await (await get()).json();
  const pendingBridge=mappingState.pendingSources.find(item=>item.orderId===bridge.id);
  assert.ok(pendingBridge);assert.ok(pendingBridge.identityWarnings.includes('verify_original_quantities'));
  assert.equal(pendingBridge.requiresPreparationTime,true);
  assert.equal(pendingBridge.orderedAt,pendingBridge.expectedSourceSnapshot.orderIdentity.createdAt);
  assert.equal(pendingBridge.expectedSourceSnapshot.orderIdentity.orderId,bridge.id);
  assert.ok(pendingBridge.expectedSourceSnapshot.orderIdentity.sourceExternalId.startsWith('bridge:'));
  const mapping={action:'map_source',orderId:bridge.id,expectedSourceSnapshot:pendingBridge.expectedSourceSnapshot,
    mappedItems:[{sourceItemId:bridge.itemId,menuCatalogItemId:ids.menu,quantity:4,options:[{id:ids.option,quantity:2}]}],confirmOriginalOrder:true,confirmedPreparedAt:occurredAt};
  assert.equal((await post({...mapping,confirmOriginalOrder:false})).status,400);
  assert.equal((await post({...mapping,confirmedPreparedAt:undefined})).status,400);
  assert.equal((await post({...mapping,confirmedPreparedAt:new Date(now+24*60*60*1000).toISOString()})).status,400);
  assert.equal((await post({...mapping,storeId:ids.otherStore})).status,403);
  for(const patch of [
    {menuCatalogItemId:privateMenu},{menuCatalogItemId:wrongMenu},
    {options:[{id:inactiveOption,quantity:1}]},{options:[{id:boundOption,quantity:1}]}
  ]) assert.equal((await post({...mapping,mappedItems:[{...mapping.mappedItems[0],...patch}]})).status,409);
  assert.equal(await count('inventory_order_usage_events',bridge.id),0);
  assert.equal((await stockFacts()).book,82);
  const mappedResponse=await post(mapping);assert.equal(mappedResponse.status,200);
  assert.equal((await mappedResponse.json()).result,'applied');
  assert.equal((await stockFacts()).book,70);
  const mappedEvent=(await rows('select source_snapshot from inventory_order_usage_events where order_id=$1',[bridge.id]))[0].source_snapshot;
  assert.equal(mappedEvent.items[0].quantity,4);assert.equal(mappedEvent.items[0].options[0].quantity,2);
  assert.equal((await rows('select quantity from store_customer_order_items where id=$1',[bridge.itemId]))[0].quantity,3);
  assert.equal((await post(mapping)).status,409);
  assert.equal((await post({...mapping,confirmedPreparedAt:new Date(now-50*60*1000).toISOString()})).status,409);
  assert.equal((await stockFacts()).book,70);
  const beforePreparedMapping=await createOrder({source:'uber_eats',menu:null});
  await engine.markInventoryOrderReady(beforePreparedMapping.id,{reliableIdentity:false,issueCodes:['unsupported_bridge_identity']});
  mappingState=await (await get()).json();
  const current=mappingState.pendingSources.find(item=>item.orderId===beforePreparedMapping.id);
  const raceMapping={...mapping,orderId:beforePreparedMapping.id,expectedSourceSnapshot:current.expectedSourceSnapshot,
    mappedItems:[{sourceItemId:beforePreparedMapping.itemId,menuCatalogItemId:ids.menu,quantity:3,options:[]}]};
  beforeMapping=()=>db.query("update store_customer_orders set inventory_source_snapshot=inventory_source_snapshot||'{\"race\":true}'::jsonb where id=$1",[beforePreparedMapping.id]);
  assert.equal((await post(raceMapping)).status,409);
  assert.equal(await count('inventory_order_usage_events',beforePreparedMapping.id),0);
  assert.equal((await stockFacts()).book,70);
  const otherStoreSource=await createOrder({source:'uber_eats',storeId:ids.otherStore,menu:null});
  await engine.markInventoryOrderReady(otherStoreSource.id,{reliableIdentity:false});
  assert.equal((await post({...raceMapping,orderId:otherStoreSource.id})).status,404);
  const repairedHeader=await createOrder({source:'uber_eats',menu:null});
  await engine.markInventoryOrderReady(repairedHeader.id,{reliableIdentity:false});
  const headerSource=(await (await get()).json()).pendingSources.find(item=>item.orderId===repairedHeader.id);
  const headerMapping={...mapping,orderId:repairedHeader.id,expectedSourceSnapshot:headerSource.expectedSourceSnapshot,
    mappedItems:[{sourceItemId:repairedHeader.itemId,menuCatalogItemId:ids.menu,quantity:3,options:[]}]};
  beforeMapping=()=>db.query("update store_customer_orders set created_at=created_at+interval '1 day',source_external_id=source_external_id||':repair',pickup_code=pickup_code||'-repair' where id=$1",[repairedHeader.id]);
  assert.equal((await post(headerMapping)).status,409);
  assert.equal(await count('inventory_order_usage_events',repairedHeader.id),0);
  assert.equal((await rows('select inventory_first_prepared_at from store_customer_orders where id=$1',[repairedHeader.id]))[0].inventory_first_prepared_at,null);
  console.log('PASS: map_source requires complete observed snapshot and explicit original-order confirmation, checks canonical brand/option scope, rejects mapper races and preserves consumed history');

  const fenced=await readyThenPrepare();
  await db.query(`insert into inventory_order_usage_issues(order_id,store_id,code) values($1,$2,'source_deletion_pending')`,[fenced.id,ids.store]);
  assert.equal(await engine.safeSyncInventoryOrderUsage(fenced.id),'ineligible');
  assert.equal(await count('inventory_order_usage_events',fenced.id),0);
  assert.equal(await count('inventory_movements',fenced.id),0);
  assert.equal((await stockFacts()).book,70);
  const kitchenOrder=await createOrder();
  await engine.markInventoryOrderReady(kitchenOrder.id);
  const taskId=uuid(600);
  await db.query('insert into order_production_tasks(id,order_id,store_id,brand_id) values($1,$2,$3,$4)',[taskId,kitchenOrder.id,ids.store,ids.brand]);
  assert.equal(await production.setProductionTaskStatus(taskId,'preparing',ids.employee),kitchenOrder.id);
  assert.equal(await count('inventory_order_usage_events',kitchenOrder.id),1);
  assert.equal((await stockFacts()).book,64);
  const firstKitchen=(await rows('select inventory_first_prepared_at::text as first,inventory_preparation_source_snapshot as source from store_customer_orders where id=$1',[kitchenOrder.id]))[0];
  assert.ok(firstKitchen.first);assert.equal(firstKitchen.source.items[0].quantity,3);
  assert.equal(firstKitchen.source.preparationEvidence.kind,'internal_preparation');
  assert.equal(await production.setProductionTaskStatus(taskId,'new',ids.employee),kitchenOrder.id);
  assert.equal((await rows('select inventory_first_prepared_at::text as first,preparing_at from store_customer_orders where id=$1',[kitchenOrder.id]))[0].first,firstKitchen.first);
  assert.equal((await rows('select preparing_at from store_customer_orders where id=$1',[kitchenOrder.id]))[0].preparing_at,null);
  assert.equal(await production.setProductionTaskStatus(taskId,'ready',ids.employee),kitchenOrder.id);
  assert.equal((await stockFacts()).book,64);
  assert.equal(await count('inventory_order_usage_events',kitchenOrder.id),1);
  assert.equal((await rows('select inventory_first_prepared_at::text as first from store_customer_orders where id=$1',[kitchenOrder.id]))[0].first,firstKitchen.first);
  console.log('PASS: source deletion fences stop event/ledger writes; real kitchen preparation SQL freezes first source and stays monotonic through New/Ready resets');

  const captureCompletedAt=new Date(now-5*60*1000).toISOString();
  const simulatedCountAt=new Date(now-30*60*1000).toISOString();
  await db.query('update inventory_items set current_quantity=64,stock_quantity=64,last_counted_at=$2,stock_revision=stock_revision+1 where id=$1',[ids.stock,simulatedCountAt]);
  const earlyExternal=await createOrder({source:'uber_eats',status:'completed'});
  await db.query('update store_customer_orders set completed_at=$2 where id=$1',[earlyExternal.id,captureCompletedAt]);
  await engine.markInventoryOrderReady(earlyExternal.id,{reliableIdentity:true,mappedItems:[{sourceItemId:earlyExternal.itemId,menuCatalogItemId:ids.menu,options:[]}]});
  assert.equal(await engine.safeSyncInventoryOrderUsage(earlyExternal.id),'blocked');
  assert.equal(await count('inventory_order_usage_events',earlyExternal.id),0);
  assert.equal((await stockFacts()).book,64);
  let earlyPending=(await (await get()).json()).pendingSources.find(item=>item.orderId===earlyExternal.id);
  assert.equal(earlyPending.requiresPreparationTime,true);
  const earlyMapping={...mapping,orderId:earlyExternal.id,expectedSourceSnapshot:earlyPending.expectedSourceSnapshot,
    mappedItems:[{sourceItemId:earlyExternal.itemId,menuCatalogItemId:ids.menu,quantity:3,options:[]}],confirmedPreparedAt:occurredAt};
  assert.equal((await post({...earlyMapping,confirmedPreparedAt:'not-a-date'})).status,400);
  assert.equal((await post({...earlyMapping,confirmedPreparedAt:undefined})).status,400);
  const earlyReply=await post(earlyMapping);assert.equal(earlyReply.status,200);assert.equal((await earlyReply.json()).result,'applied');
  assert.equal((await stockFacts()).book,64);
  assert.equal((await rows('select changes_stock from inventory_movements where source_order_id=$1',[earlyExternal.id]))[0].changes_stock,false);
  const earlySource=(await rows('select inventory_first_prepared_at::text as prepared,inventory_preparation_source_snapshot as source from store_customer_orders where id=$1',[earlyExternal.id]))[0];
  assert.equal(Date.parse(earlySource.prepared),Date.parse(occurredAt));
  assert.equal(earlySource.source.preparationEvidence.kind,'operator_confirmed');
  assert.equal(Date.parse(earlySource.source.preparationEvidence.occurredAt),Date.parse(occurredAt));
  const lateExternal=await createOrder({source:'uber_eats',status:'completed'});
  await db.query('update store_customer_orders set completed_at=$2 where id=$1',[lateExternal.id,captureCompletedAt]);
  await engine.markInventoryOrderReady(lateExternal.id,{reliableIdentity:false});
  const latePending=(await (await get()).json()).pendingSources.find(item=>item.orderId===lateExternal.id);
  const confirmedLate=new Date(now-10*60*1000).toISOString();
  const lateMapping={...mapping,orderId:lateExternal.id,expectedSourceSnapshot:latePending.expectedSourceSnapshot,
    mappedItems:[{sourceItemId:lateExternal.itemId,menuCatalogItemId:ids.menu,quantity:3,options:[]}],confirmedPreparedAt:confirmedLate};
  assert.equal((await post(lateMapping)).status,200);
  assert.equal((await stockFacts()).book,58);
  assert.equal((await rows('select changes_stock from inventory_movements where source_order_id=$1',[lateExternal.id]))[0].changes_stock,true);
  const consumedLate=(await rows('select source_snapshot from inventory_order_usage_events where order_id=$1',[lateExternal.id]))[0].source_snapshot;
  const latestLateExpected={...consumedLate,orderIdentity:latePending.expectedSourceSnapshot.orderIdentity};
  assert.equal((await post({...lateMapping,expectedSourceSnapshot:latestLateExpected,confirmedPreparedAt:occurredAt})).status,409);
  assert.equal((await stockFacts()).book,58);
  const internalBridge=await createOrder({source:'uber_eats',status:'completed'});
  await db.query('update store_customer_orders set completed_at=$2 where id=$1',[internalBridge.id,captureCompletedAt]);
  await engine.markInventoryOrderReady(internalBridge.id,{reliableIdentity:false});
  const internalTaskId=uuid(601);
  await db.query('insert into order_production_tasks(id,order_id,store_id,brand_id) values($1,$2,$3,$4)',[internalTaskId,internalBridge.id,ids.store,ids.brand]);
  await production.setProductionTaskStatus(internalTaskId,'preparing',ids.employee);
  const internalBridgeFacts=(await rows('select inventory_first_prepared_at::text as prepared,inventory_preparation_source_snapshot as source from store_customer_orders where id=$1',[internalBridge.id]))[0];
  const actualTaskStart=(await rows('select started_at::text as started from order_production_tasks where id=$1',[internalTaskId]))[0].started;
  assert.equal(Date.parse(internalBridgeFacts.prepared),Date.parse(actualTaskStart));
  assert.notEqual(Date.parse(internalBridgeFacts.prepared),Date.parse(captureCompletedAt));
  assert.equal(internalBridgeFacts.source.preparationEvidence.kind,'internal_preparation');
  const internalPending=(await (await get()).json()).pendingSources.find(item=>item.orderId===internalBridge.id);
  assert.equal(internalPending.requiresPreparationTime,false);
  const internalMapping={...mapping,orderId:internalBridge.id,expectedSourceSnapshot:internalPending.expectedSourceSnapshot,
    mappedItems:[{sourceItemId:internalBridge.itemId,menuCatalogItemId:ids.menu,quantity:3,options:[]}],confirmedPreparedAt:undefined};
  assert.equal((await post({...internalMapping,confirmedPreparedAt:occurredAt})).status,409);
  assert.equal((await post(internalMapping)).status,200);
  assert.equal((await stockFacts()).book,52);
  console.log('PASS: external completed capture is not preparation evidence; confirmed time before/after actual counts controls stock change; header and trusted/consumed times reject edits');

  visibleProducts=[ids.product];
  const response=await get();assert.equal(response.status,200);
  const state=await response.json();
  assert.ok(state.locations.every(item=>item.productId===ids.product));
  assert.ok(state.recentUsage.some(event=>event.restrictedItemCount===1));
  assert.ok(!JSON.stringify(state).includes(ids.estimatedProduct));assert.ok(!JSON.stringify(state).includes('Hidden estimate SKU'));
  assert.ok(state.issues.every(issue=>Object.keys(issue.details).length===0));
  assert.equal((await get(ids.otherStore)).status,403);
  assert.equal((await post({action:'location',productId:ids.estimatedProduct,inventoryItemId:ids.estimatedStock,expectedInventoryItemId:null})).status,403);
  session={...session,role:'store_terminal'};
  assert.equal((await get()).status,200);assert.equal((await (await get()).json()).canManage,false);
  assert.equal((await post({action:'retry'})).status,403);
  session={...session,role:'store_manager'};permission=false;
  assert.equal((await get()).status,403);assert.equal((await post({action:'retry'})).status,403);
  permission=true;storeAllowed=false;
  assert.equal((await get()).status,403);assert.equal((await post({action:'retry'})).status,403);
  console.log('PASS: current API store scope, inventory permission, terminal read-only and hidden SKU redaction');
  console.log('PASS: isolated order usage PostgreSQL integration completed without production access');
} catch (error) {
  const last=failures.at(-1);
  if(last) console.error('Last production SQL error:',JSON.stringify({code:last.code,message:last.message,position:last.position,text:last.text}));
  throw error;
} finally { await db.close(); }
