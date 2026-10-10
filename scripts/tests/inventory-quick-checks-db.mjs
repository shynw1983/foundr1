// Exercise production rough-check SQL in isolated PostgreSQL, never DATABASE_URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const db = new PGlite();
const ids = Object.fromEntries(['store','otherStore','employee','product','location','otherLocation','stock','unknown','otherStock'].map((key,i) => [key,`00000000-0000-4000-8000-${String(600+i).padStart(12,'0')}`]));
let session = { id: ids.employee, name: 'Tester', role: 'store_manager' };
let permission = true;
const statements = [];
async function execute(statement, connection = db) {
  statements.push(statement.text);
  return (await connection.query(statement.text, statement.values)).rows;
}
const sql = Object.assign((parts,...values) => ({
  text: parts.reduce((text,part,i) => text+part+(i<values.length?`$${i+1}`:''),''), values,
  then(resolve,reject) { return execute(this).then(resolve,reject); }
}), { transaction: queries => db.transaction(async transaction => {
  const results = []; for (const query of queries) results.push(await execute(query,transaction)); return results;
}) });
function load(path,modules={}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,Response,Request,URL,console,require:name => {
    if(name.endsWith('/api-auth')) return {
      requireOsSession:async()=>session,
      canAccessStore:async(_,storeId)=>storeId===ids.store,
      getSessionStoreScope:async()=>({allStores:false,storeIds:[ids.store]})
    };
    if(name.endsWith('/db'))return {sql};
    if(name.endsWith('/role-permissions'))return {roleHasPermission:async()=>permission};
    if(name in modules)return modules[name];
    throw new Error(`Unmocked dependency: ${name}`);
  }}); return exports;
}
try {
  await db.exec(`
    create table stores(id uuid primary key,name text,status text default 'active');
    create table employees(id uuid primary key,name text);
    create table products(id uuid primary key,name text,category text default '',unit text,package_quantity numeric,package_quantity_unit text,inventory_unit_conversions jsonb default '[]',storage_type text default '');
    create table inventory_locations(id uuid primary key,store_id uuid,name text,equipment_brand text default '',equipment_name text default '',position_name text default '',location_type text default 'ambient',sort_order int default 0,status text default 'active');
    create table inventory_items(id uuid primary key default gen_random_uuid(),store_id uuid,product_id uuid,location_id uuid,count_unit text,safety_stock numeric(18,6),current_quantity numeric(18,6),count_conversion_snapshot jsonb,stock_quantity numeric(18,6),stock_conversion_snapshot jsonb,stock_revision int default 0,last_received_at timestamptz,exception_code text default '',exception_note text default '',last_counted_at timestamptz,last_counted_by uuid,status text default 'active',updated_at timestamptz default now(),unique(store_id,product_id,location_id));
    create table inventory_checks(id uuid primary key default gen_random_uuid(),inventory_item_id uuid,store_id uuid,product_id uuid,quantity numeric(18,6),count_unit text,record_type text,exception_code text,note text,recorded_by uuid,unit_conversion_snapshot jsonb,created_at timestamptz default now());
    insert into stores(id,name)values('${ids.store}','A'),('${ids.otherStore}','B');
    insert into employees values('${ids.employee}','Tester');
    insert into products(id,name,unit,package_quantity,package_quantity_unit)values('${ids.product}','SKU','袋',0,null);
    insert into inventory_locations(id,store_id,name)values('${ids.location}','${ids.store}','Shelf'),('${ids.otherLocation}','${ids.store}','Fridge');
    insert into inventory_items(id,store_id,product_id,location_id,count_unit,safety_stock,current_quantity,stock_quantity,last_counted_at,last_counted_by,exception_code,exception_note)values
      ('${ids.stock}','${ids.store}','${ids.product}','${ids.location}','袋',2,1,1,'2026-09-01','${ids.employee}','low','original note'),
      ('${ids.unknown}','${ids.store}','${ids.product}','${ids.otherLocation}','custom scoop',2,null,null,null,null,'damaged','damage note'),
      ('${ids.otherStock}','${ids.otherStore}','${ids.product}','${ids.otherLocation}','袋',2,1,1,'2026-09-01',null,'','');
  `);
  const beforeMigration=(await db.query('select current_quantity,stock_quantity,last_counted_at,count_conversion_snapshot,stock_conversion_snapshot from inventory_items order by id')).rows;
  const migration=readFileSync(new URL('db/migrations/20261009_inventory_quick_checks.sql',root),'utf8');
  await db.exec(migration);await db.exec(migration);
  const movementSchema=readFileSync(new URL('db/migrations/20261011_inventory_order_usage.sql',root),'utf8').match(/create table if not exists inventory_movements[\s\S]+?\n\);/)[0];
  await db.exec(movementSchema);
  await db.exec(readFileSync(new URL('db/migrations/20261011_inventory_usage_reconciliation.sql',root),'utf8'));
  await db.exec(`create table inventory_order_usage_issues(id uuid primary key default gen_random_uuid(),order_id uuid,store_id uuid,created_at timestamptz default now(),resolved_at timestamptz);
    create table inventory_stock_receipts(id uuid primary key,inventory_item_id uuid,mode text,conversion_snapshot jsonb,batch_packaging_snapshot jsonb);`);
  assert.deepEqual((await db.query('select current_quantity,stock_quantity,last_counted_at,count_conversion_snapshot,stock_conversion_snapshot from inventory_items order by id')).rows,beforeMigration);
  const policy=load('lib/inventory-quick-policy.ts');
  const units=load('lib/product-unit-conversions.ts');
  const countInput=load('lib/inventory-count-input-policy.ts',{'./product-unit-conversions':units});
  const route=load('app/api/inventory/route.ts',{
    '../../../lib/inventory-quick-policy':policy,'../../../lib/product-unit-conversions':units,
    '../../../lib/inventory-count-input-policy':countInput,
    '../../../lib/product-catalog-access':{getVisibleProductIdsForStore:async()=>[ids.product],assertProductViewableAtStore:async()=>({ok:true})}
  });
  const get=async()=>(await route.GET(new Request(`https://example.test/api/inventory?storeId=${ids.store}`))).json();
  const post=body=>route.POST(new Request('https://example.test/api/inventory',{method:'POST',body:JSON.stringify({storeId:ids.store,...body})}));
  const submit=(item,status,estimate=null)=>({itemId:item.id,status,expectedBasis:item.quickCheckBasis,estimate});
  let state=await get();
  assert.equal(state.canQuickCheck,true);
  assert.equal(state.items.length,2);
  assert.equal(state.items[0].quickCheck,null);
  assert.equal(state.items[0].quickCheckBasis.unitConfiguration.packageQuantity,0);
  assert.equal(state.items[0].quickCheckBasis.unitConfiguration.packageQuantityUnit,null);
  assert.equal(state.items.find(item=>item.id===ids.stock).effectiveStockStatus,'low_stock');
  const original=(await db.query('select current_quantity,stock_quantity,last_counted_at,last_counted_by,count_conversion_snapshot,stock_conversion_snapshot,stock_revision,last_received_at from inventory_items where store_id=$1 order by id',[ids.store])).rows;
  const initial=state.items;
  let response=await post({action:'batch_quick_check',checks:initial.map(item=>submit(item,'enough',item.id===ids.stock?{kind:'quantity',quantity:2.5,purchaseUnit:'袋'}:{kind:'small',purchaseUnit:null}))});
  assert.equal(response.status,200);assert.equal((await response.json()).updatedCount,2);
  assert.deepEqual((await db.query('select current_quantity,stock_quantity,last_counted_at,last_counted_by,count_conversion_snapshot,stock_conversion_snapshot,stock_revision,last_received_at from inventory_items where store_id=$1 order by id',[ids.store])).rows,original);
  let rows=(await db.query('select exception_code,exception_note from inventory_items where store_id=$1 order by id',[ids.store])).rows;
  assert.deepEqual(rows,[{exception_code:'',exception_note:'original note'},{exception_code:'damaged',exception_note:'damage note'}]);
  let history=(await db.query("select quantity,unit_conversion_snapshot,record_type,quick_check_snapshot from inventory_checks where record_type='quick_check' order by inventory_item_id")).rows;
  assert.equal(history.length,2);assert.ok(history.every(row=>row.quantity===null&&row.unit_conversion_snapshot===null));
  assert.equal(history[0].quick_check_snapshot.checkedBy,'Tester');
  state=await get();assert.ok(state.items.every(item=>item.quickCheck.state==='fresh'&&item.effectiveStockStatus==='available'));
  assert.equal(state.items.find(item=>item.id===ids.stock).quickCheck.estimate.quantity,2.5);
  assert.equal(state.recentChecks[0].recordType,'quick_check');assert.equal(state.recentChecks[0].quantity,null);assert.equal(state.recentChecks[0].quickStatus,'enough');
  const quickStatement=statements.find(text=>text.includes('with requested as materialized'));
  assert.ok(quickStatement.indexOf('for share of products')<quickStatement.indexOf('for update of items'));
  console.log('PASS: additive migration and quick Enough preserve physical/book facts, quality, notes and immutable rough-only history');

  const savedHistory=Number((await db.query('select count(*) from inventory_checks')).rows[0].count);
  assert.equal((await post({action:'batch_quick_check',checks:[submit(initial[0],'out'),submit(state.items[1],'low')]})).status,409);
  assert.equal(Number((await db.query('select count(*) from inventory_checks')).rows[0].count),savedHistory);
  assert.ok((await get()).items.every(item=>item.quickCheck.status==='enough'));
  assert.equal((await post({action:'batch_quick_check',checks:[submit(state.items[0],'low'),submit(state.items[0],'out')]})).status,400);
  assert.equal((await post({action:'batch_quick_check',checks:[submit(state.items[0],'low'),{...submit(state.items[1],'out'),itemId:ids.otherStock}]})).status,409);
  assert.equal((await post({action:'batch_quick_check',storeId:ids.otherStore,checks:[submit(state.items[0],'low')]})).status,403);
  assert.equal((await post({action:'batch_quick_check',checks:[submit(state.items[0],'low',{kind:'quantity',quantity:1,purchaseUnit:'箱'})]})).status,400);
  assert.equal((await post({action:'batch_quick_check',checks:[submit(state.items[0],'low',{kind:'quantity',quantity:-1,purchaseUnit:'袋'})]})).status,400);
  await db.exec(`alter table inventory_checks add constraint simulated_quick_history_failure check(record_type<>'quick_check') not valid;`);
  await assert.rejects(post({action:'batch_quick_check',checks:[submit(state.items[0],'low')]}));
  assert.equal((await get()).items[0].quickCheck.status,'enough');
  await db.exec('alter table inventory_checks drop constraint simulated_quick_history_failure;');
  console.log('PASS: explicit batch IDs, stale observation revision, scope and estimate units validate atomically; history failure rolls back observations');

  await db.query("update inventory_items set quick_checked_at=now()-interval '25 hours' where id=$1",[ids.stock]);
  state=await get();let item=state.items.find(item=>item.id===ids.stock);
  assert.equal(item.quickCheck.state,'recheck');assert.equal(item.effectiveStockStatus,'low_stock');
  assert.equal((await post({action:'batch_quick_check',checks:[submit(item,'enough')]})).status,200);
  await db.query('update inventory_items set stock_revision=stock_revision+1 where id=$1',[ids.stock]);
  state=await get();item=state.items.find(item=>item.id===ids.stock);assert.equal(item.quickCheck.state,'recheck');assert.equal(item.effectiveStockStatus,'low_stock');
  assert.equal((await post({action:'batch_quick_check',checks:state.items.map(row=>submit(row,row.id===ids.stock?'low':'out'))})).status,200);
  await db.query('update inventory_items set stock_quantity=12,stock_revision=stock_revision+1,last_received_at=now() where id=$1',[ids.stock]);
  state=await get();item=state.items.find(item=>item.id===ids.stock);assert.equal(item.quickCheck.state,'recheck');assert.equal(item.effectiveStockStatus,'low_stock');
  const unknown=state.items.find(item=>item.id===ids.unknown);assert.equal(unknown.currentQuantity,null);assert.equal(unknown.effectiveStockStatus,'unavailable');assert.equal(unknown.exceptionCode,'damaged');
  await db.query('update inventory_items set quick_checked_at=now()-interval \'25 hours\' where id=$1',[ids.unknown]);
  assert.equal((await get()).items.find(item=>item.id===ids.unknown).effectiveStockStatus,'unavailable');
  response=await post({action:'count',itemId:ids.stock,quantity:12,countUnit:'袋',expectedConversion:{purchaseUnit:'袋',countUnit:'袋',unitsPerPurchase:1},expectedStockRevision:item.stockRevision});
  assert.equal(response.status,200);state=await get();item=state.items.find(item=>item.id===ids.stock);assert.equal(item.quickCheck.state,'superseded');assert.equal(item.effectiveStockStatus,'available');
  assert.equal((await post({action:'batch_quick_check',checks:[submit(item,'enough')]})).status,200);
  assert.equal((await post({action:'exception',itemId:ids.stock,exceptionCode:'low',note:'new shortage'})).status,200);
  item=(await get()).items.find(item=>item.id===ids.stock);assert.equal(item.quickCheck.state,'superseded');assert.equal(item.effectiveStockStatus,'low_stock');
  console.log('PASS: Enough expiry/revision changes stop suppression; negative unknown quantities stay actionable after receipt; physical count and later manual shortages supersede old visual state');

  state=await get();const basis=state.items.find(item=>item.id===ids.unknown).quickCheckBasis;
  await db.query('update products set package_quantity=null where id=$1',[ids.product]);
  assert.equal((await post({action:'batch_quick_check',checks:[{itemId:ids.unknown,status:'enough',expectedBasis:basis}]})).status,409);
  item=(await get()).items.find(item=>item.id===ids.unknown);
  assert.equal((await post({action:'batch_quick_check',checks:[submit(item,'low')]})).status,200);
  await db.query('update inventory_items set safety_stock=3 where id=$1',[ids.unknown]);
  item=(await get()).items.find(item=>item.id===ids.unknown);assert.equal(item.quickCheck.state,'recheck');assert.equal(item.effectiveStockStatus,'low_stock');
  await db.query("update inventory_locations set status='inactive' where id=$1",[ids.otherLocation]);
  assert.equal((await post({action:'batch_quick_check',checks:[submit(item,'enough')]})).status,409);
  session={...session,role:'store_terminal'};
  state=await get();assert.equal(state.canQuickCheck,false);assert.ok(state.items.every(item=>item.canQuickCheck===false));
  const beforeDenied=statements.length;
  assert.equal((await post({action:'batch_quick_check',checks:[submit(item,'out')]})).status,403);
  assert.equal(statements.length,beforeDenied);
  permission=false;assert.equal((await route.GET(new Request(`https://example.test/api/inventory?storeId=${ids.store}`))).status,403);
  console.log('PASS: raw zero/null config, safety-stock and active-location guards invalidate stale drafts; terminals remain read-only and module permission is enforced');
} finally { await db.close(); }
