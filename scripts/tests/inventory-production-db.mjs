// Real PostgreSQL policy/API regression; never reads DATABASE_URL or calls production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url), db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = Object.fromEntries(['store','destination','otherStore','brand','otherBrand','employee','a','b','c','output','private','location','destLocation','otherLocation','aStock','bStock','cStock','outputStock','destStock','otherStock','recipe','version','privateRecipe','privateVersion'].map((key,i)=>[key,id(i+1)]));
let session = { id:ids.employee,name:'Tester',role:'owner' }, allowed = true, permission = true, hook = null;
const statements=[];
const sql=Object.assign((parts,...values)=>({text:parts.reduce((text,part,i)=>text+part+(i<values.length?`$${i+1}`:''),''),values,then(resolve,reject){statements.push(this.text);return db.query(this.text,this.values).then(result=>result.rows).then(resolve,reject);}}),{transaction:async queries=>{if(hook){const next=hook;hook=null;await next();}return db.transaction(async tx=>{const results=[];for(const query of queries){statements.push(query.text);results.push((await tx.query(query.text,query.values)).rows);}return results;});}});
function load(path,modules={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,Request,URL,console,require:name=>{
  if(name==='node:crypto')return require(name);
  if(name.endsWith('/db')||name==='./db')return{sql};
  if(name.endsWith('/api-auth'))return{requireOsSession:async()=>session,requireWritableOsSession:async()=>session&&session.role!=='store_terminal'?session:null,canAccessStore:async(_,storeId)=>allowed&&(session.role==='owner'||session.role==='manager'||storeId===ids.destination),getSessionStoreScope:async()=>({allStores:session.role==='owner'||session.role==='manager',storeIds:[ids.destination]})};
  if(name.endsWith('/role-permissions'))return{roleHasPermission:async()=>permission};
  if(name in modules)return modules[name];throw Error(`Unmocked ${name}`);
}});return exports;}
const snapshot={basis:'measured',measuredUnit:'g',inputs:[{productId:ids.a,quantity:2,unit:'g',mode:'exact'},{productId:ids.b,quantity:3,unit:'g',mode:'estimate'},{productId:ids.c,quantity:null,unit:'g',mode:'unmeasured'}],output:{productId:ids.output,quantity:2,unit:'g'}};
let nonce=100;
const state=async()=>{const result={};for(const table of ['inventory_items','inventory_checks','inventory_production_operations','inventory_transfers','inventory_movements'])result[table]=(await db.query(`select * from ${table} order by id`)).rows;return result;};
const stock=async stockId=>(await db.query('select * from inventory_items where id=$1',[stockId])).rows[0];
let route;
const get=storeId=>route.GET(new Request(`https://example.test/api/inventory/production?storeId=${storeId}`));
const post=body=>route.POST(new Request('https://example.test/api/inventory/production',{method:'POST',body:JSON.stringify(body)}));
async function body(outputQuantity=4){return{requestId:id(nonce++),storeId:ids.store,recipeVersionId:ids.version,outputInventoryItemId:ids.outputStock,outputQuantity,expectedOutputStockRevision:(await stock(ids.outputStock)).stock_revision,inputs:[
  {productId:ids.a,inventoryItemId:ids.aStock,quantity:outputQuantity,unit:'g',mode:'exact',expectedStockRevision:(await stock(ids.aStock)).stock_revision},
  {productId:ids.b,inventoryItemId:ids.bStock,quantity:outputQuantity*1.5,unit:'g',mode:'estimate',expectedStockRevision:(await stock(ids.bStock)).stock_revision},
  {productId:ids.c,inventoryItemId:ids.cStock,quantity:null,unit:'g',mode:'unmeasured',expectedStockRevision:(await stock(ids.cStock)).stock_revision} ]};}
async function reject(body,status,label){const before=await state(),response=await post(body);assert.equal(response.status,status,`${label}: ${await response.text()}`);assert.deepEqual(await state(),before,label);}
try{
await db.exec(`create table stores(id uuid primary key,name text,status text default 'active');create table brands(id uuid primary key,name text);create table employees(id uuid primary key,name text);
create table store_brands(store_id uuid,brand_id uuid);create table products(id uuid primary key,name text,unit text,package_quantity numeric,package_quantity_unit text,inventory_unit_conversions jsonb default '[]',brand_scope text default 'common',catalog_visibility text default 'brand_stores',is_orderable boolean default true);
create table product_brand_usages(product_id uuid,brand_id uuid,is_orderable boolean);create table product_catalog_store_grants(product_id uuid,store_id uuid);
create table inventory_locations(id uuid primary key,store_id uuid,name text,status text default 'active');create table inventory_items(id uuid primary key,store_id uuid,product_id uuid,location_id uuid,count_unit text,safety_stock numeric(18,6) default 0,stock_quantity numeric(18,6),stock_revision integer default 0,stock_conversion_snapshot jsonb,current_quantity numeric(18,6),count_conversion_snapshot jsonb,last_counted_at timestamptz,last_counted_by uuid,last_received_at timestamptz,exception_code text default '',exception_note text default '',status text default 'active',updated_at timestamptz default now());
create table inventory_checks(id uuid primary key default gen_random_uuid(),inventory_item_id uuid,store_id uuid,product_id uuid,quantity numeric(18,6),count_unit text,record_type text,exception_code text,note text,recorded_by uuid,unit_conversion_snapshot jsonb,created_at timestamptz default now());
create table inventory_stock_receipts(id uuid primary key default gen_random_uuid(),inventory_item_id uuid,batch_packaging_snapshot jsonb);
create table store_customer_orders(id uuid primary key,preparing_at timestamptz,ready_at timestamptz,completed_at timestamptz);create table order_production_tasks(id uuid primary key,order_id uuid,started_at timestamptz);
insert into stores values('${ids.store}','Factory','active'),('${ids.destination}','Store','active'),('${ids.otherStore}','Other','active');insert into brands values('${ids.brand}','Brand'),('${ids.otherBrand}','Other');insert into employees values('${ids.employee}','Tester');
insert into store_brands values('${ids.store}','${ids.brand}'),('${ids.destination}','${ids.brand}'),('${ids.otherStore}','${ids.otherBrand}');
insert into inventory_locations values('${ids.location}','${ids.store}','Warehouse','active'),('${ids.destLocation}','${ids.destination}','Shelf','active'),('${ids.otherLocation}','${ids.otherStore}','Other','active');`);
for(const [key,name] of [['a','Raw A'],['b','Raw B'],['c','Raw C'],['output','Prepared'],['private','Secret']])await db.query('insert into products(id,name,unit,catalog_visibility) values($1,$2,$3,$4)',[ids[key],name,'g',key==='private'?'internal':'brand_stores']);
for(const [stockKey,productKey,qty,storeKey,locationKey] of [['aStock','a',10,'store','location'],['bStock','b',20,'store','location'],['cStock','c',30,'store','location'],['outputStock','output',5,'store','location'],['destStock','output',null,'destination','destLocation'],['otherStock','output',5,'otherStore','otherLocation']])await db.query(`insert into inventory_items(id,store_id,product_id,location_id,count_unit,stock_quantity,stock_conversion_snapshot,current_quantity,count_conversion_snapshot,last_counted_at,last_counted_by) values($1,$2,$3,$4,'g',$5,$6::jsonb,$5,$6::jsonb,'2026-10-10',$7)`,[ids[stockKey],ids[storeKey],ids[productKey],ids[locationKey],qty,qty===null?null:JSON.stringify({purchaseUnit:'g',countUnit:'g',unitsPerPurchase:1}),ids.employee]);
for(const file of ['db/migrations/20261009_inventory_quick_checks.sql','db/migrations/20261011_inventory_recipes.sql','db/migrations/20261011_inventory_order_usage.sql','db/migrations/20261011_inventory_usage_reconciliation.sql','db/migrations/20261011_inventory_production.sql'])await db.exec(readFileSync(new URL(file,root),'utf8'));
await db.exec(readFileSync(new URL('db/migrations/20261011_inventory_production.sql',root),'utf8'));
await db.query(`insert into inventory_recipes(id,brand_id,name,kind,output_product_id) values($1,$2,'Preparation','production',$3)`,[ids.recipe,ids.brand,ids.output]);
await db.query('insert into inventory_recipe_versions(id,recipe_id,version,snapshot) values($1,$2,1,$3::jsonb)',[ids.version,ids.recipe,JSON.stringify(snapshot)]);await db.query('update inventory_recipes set current_version_id=$1 where id=$2',[ids.version,ids.recipe]);
await db.query(`insert into inventory_recipes(id,brand_id,name,kind,output_product_id) values($1,$2,'Secret formula','production',$3)`,[ids.privateRecipe,ids.brand,ids.output]);
await db.query('insert into inventory_recipe_versions(id,recipe_id,version,snapshot) values($1,$2,1,$3::jsonb)',[ids.privateVersion,ids.privateRecipe,JSON.stringify({...snapshot,inputs:[{productId:ids.private,quantity:1,unit:'g',mode:'exact'}]})]);await db.query('update inventory_recipes set current_version_id=$1 where id=$2',[ids.privateVersion,ids.privateRecipe]);
const units=load('lib/product-unit-conversions.ts'),catalogPolicy=load('lib/product-catalog-policy.ts',{'./product-unit-conversions.ts':units}),catalog=load('lib/product-catalog-access.ts',{'./product-catalog-policy':catalogPolicy});
const policy=load('lib/inventory-production-policy.ts',{'./product-unit-conversions':units}),data=load('lib/inventory-production-data.ts',{'./product-unit-conversions':units,'./product-catalog-policy':catalogPolicy,'./product-catalog-access':catalog,'./inventory-production-policy':policy});
route=load('app/api/inventory/production/route.ts',{'../../../../lib/product-catalog-policy':catalogPolicy,'../../../../lib/inventory-production-policy':policy,'../../../../lib/inventory-production-data':data});
const quick=load('lib/inventory-quick-policy.ts'),countInput=load('lib/inventory-count-input-policy.ts',{'./product-unit-conversions':units});
const inventoryRoute=load('app/api/inventory/route.ts',{'../../../lib/product-unit-conversions':units,'../../../lib/inventory-quick-policy':quick,'../../../lib/inventory-count-input-policy':countInput,'../../../lib/product-catalog-access':catalog});
const count=payload=>inventoryRoute.POST(new Request('https://example.test/api/inventory',{method:'POST',body:JSON.stringify(payload)}));
const first=await body(),physical=(await stock(ids.aStock)).current_quantity;
const nonExactBefore=new Map(await Promise.all([ids.bStock,ids.cStock].map(async itemId=>[itemId,await stock(itemId)])));
const countDrafts=[ids.bStock,ids.cStock].map((itemId,index)=>({action:'count',storeId:ids.store,itemId,quantity:23+index,countUnit:'g',expectedStockRevision:nonExactBefore.get(itemId).stock_revision,expectedConversion:{purchaseUnit:'g',countUnit:'g',unitsPerPurchase:1}}));
await db.query('insert into inventory_stock_receipts(inventory_item_id,batch_packaging_snapshot) values($1,$2::jsonb)',[ids.aStock,JSON.stringify({purchaseUnit:'袋',stockQuantityPerPurchase:1000,countUnit:'g'})]);
let response=await post(first);assert.equal(response.status,200,await response.clone().text());
assert.equal(Number((await stock(ids.aStock)).stock_quantity),6);assert.equal(Number((await stock(ids.bStock)).stock_quantity),20);assert.equal(Number((await stock(ids.cStock)).stock_quantity),30);assert.equal(Number((await stock(ids.outputStock)).stock_quantity),9);assert.equal((await stock(ids.aStock)).current_quantity,physical);
const movements=(await db.query('select kind,quantity,confidence,changes_stock from inventory_movements order by id')).rows;assert.equal(movements.length,4);assert.equal(movements.filter(line=>line.changes_stock).length,2);assert.equal(movements.find(line=>line.confidence==='unmeasured').quantity,null);
const saved=await state();assert.equal((await post(first)).status,200);assert.deepEqual(await state(),saved);await reject({...first,outputQuantity:3},409,'changed nonce');
const alternateVersion=id(500),alternateSnapshot={...snapshot,inputs:snapshot.inputs.map(input=>input.productId===ids.a?{...input,unit:'kg'}:input)};
await db.query('insert into inventory_recipe_versions(id,recipe_id,version,snapshot) values($1,$2,2,$3::jsonb)',[alternateVersion,ids.recipe,JSON.stringify(alternateSnapshot)]);await db.query('update inventory_recipes set current_version_id=$1 where id=$2',[alternateVersion,ids.recipe]);
response=await post(first);assert.equal(response.status,200);assert.equal((await response.json()).operation.recipeVersionId,ids.version);assert.deepEqual(await state(),saved);
const crossBatch=await body();crossBatch.recipeVersionId=alternateVersion;crossBatch.inputs[0].unit='kg';await reject(crossBatch,409,'batch history prohibits current master cross-unit factor');
await db.query('update inventory_recipes set current_version_id=$1 where id=$2',[ids.version,ids.recipe]);
console.log('PASS: immutable version actual inputs/output, estimates/unmeasured do not change exact book, physical untouched, nonce replay');
for(const draft of countDrafts){
  const previous=nonExactBefore.get(draft.itemId),current=await stock(draft.itemId);
  assert.equal(current.stock_revision,previous.stock_revision+1,'non-exact input invalidates prior count revision');
  assert.notDeepEqual(current.updated_at,previous.updated_at);
  for(const field of ['stock_quantity','stock_conversion_snapshot','current_quantity','count_conversion_snapshot','last_counted_at','last_counted_by'])assert.deepEqual(current[field],previous[field],`${field} preserved for non-exact input`);
  const before=await state();response=await count(draft);assert.equal(response.status,409,await response.clone().text());assert.equal((await response.json()).code,'stock_revision_changed');assert.deepEqual(await state(),before,'stale draft cannot write count, history, or movement');
  response=await count({...draft,expectedStockRevision:current.stock_revision});assert.equal(response.status,200,await response.clone().text());const recorded=(await response.json()).count;
  const after=await state(),counted=await stock(draft.itemId);assert.equal(after.inventory_checks.length,before.inventory_checks.length+1);assert.equal(after.inventory_movements.length,before.inventory_movements.length+1);
  assert.equal(Number(counted.stock_quantity),draft.quantity);assert.equal(Number(counted.current_quantity),draft.quantity);assert.equal(counted.stock_revision,current.stock_revision+1);assert.equal(counted.usage_anchor_check_id,recorded.checkId);
  assert.equal(after.inventory_checks.find(check=>check.id===recorded.checkId).record_type,'count');
}
const afterFreshCounts=await state();assert.equal((await post(first)).status,200);assert.deepEqual(await state(),afterFreshCounts,'manufacturing replay preserves later fresh physical counts');
console.log('PASS: estimate/unmeasured input revisions reject stale real-count drafts with no writes; refreshed counts save once');
await reject({...await body(),inputs:[]},400,'missing inputs');const mismatch=await body();mismatch.inputs[0].inventoryItemId=ids.bStock;await reject(mismatch,409,'wrong SKU');await reject({...await body(),outputInventoryItemId:ids.otherStock},409,'other-store target');
const stale=await body();await db.query('update inventory_items set stock_revision=stock_revision+1 where id=$1',[ids.aStock]);await reject(stale,409,'old revision');
const racing=await body();let concurrent;hook=async()=>{await db.query('update inventory_items set stock_revision=stock_revision+1 where id=$1',[ids.outputStock]);concurrent=await state();};response=await post(racing);assert.equal(response.status,409);assert.deepEqual(await state(),concurrent);
console.log('PASS: exact SKU/store/input coverage and stock CAS races reject atomically');
await db.exec(`create function fail_production_output_for_test() returns trigger language plpgsql as $$ begin if NEW.kind='production_output' then raise exception 'expected test movement failure' using errcode='23514'; end if; return NEW; end $$;create trigger fail_production_output_for_test before insert on inventory_movements for each row execute function fail_production_output_for_test();`);
await reject(await body(),503,'movement failure rolls back every book/operation/movement');await db.exec('drop trigger fail_production_output_for_test on inventory_movements;drop function fail_production_output_for_test();');
await db.query('update inventory_items set stock_quantity=null,stock_conversion_snapshot=null where id=$1',[ids.outputStock]);response=await post(await body(1));assert.equal(response.status,200,await response.clone().text());assert.equal((await stock(ids.outputStock)).stock_quantity,null);
console.log('PASS: actual output records quantities without inventing an unknown starting book');
await db.query('update inventory_items set stock_quantity=6,stock_conversion_snapshot=$1::jsonb where id=$2',[JSON.stringify({purchaseUnit:'g',countUnit:'g',unitsPerPurchase:1}),ids.outputStock]);
const dispatch={action:'transfer_dispatch',requestId:id(nonce++),sourceStoreId:ids.store,targetStoreId:ids.destination,productId:ids.output,sourceInventoryItemId:ids.outputStock,targetInventoryItemId:ids.destStock,quantity:3,unit:'g',expectedSourceStockRevision:(await stock(ids.outputStock)).stock_revision,costPriceJpy:12,supplyPriceJpy:20};
response=await post(dispatch);assert.equal(response.status,200,await response.clone().text());const transferId=(await response.json()).operation.snapshot.transferId;assert.equal(Number((await stock(ids.outputStock)).stock_quantity),3);assert.equal((await stock(ids.destStock)).stock_quantity,null);assert.equal((await db.query('select status from inventory_transfers where id=$1',[transferId])).rows[0].status,'in_transit');
session={...session,role:'store_manager'};const storeRead=await (await get(ids.destination)).json();assert.equal(storeRead.canTransfer,false);assert.equal(storeRead.canReceive,true);assert.ok(!JSON.stringify(storeRead).includes('costPriceJpy'));assert.ok(!JSON.stringify(storeRead).includes('Secret formula'));assert.ok(!('transferInventoryItems'in storeRead));
let receive={action:'transfer_receive',requestId:id(nonce++),transferId,quantity:1,expectedTargetStockRevision:(await stock(ids.destStock)).stock_revision};response=await post(receive);assert.equal(response.status,200,await response.clone().text());assert.equal((await stock(ids.destStock)).stock_quantity,null);const receivedState=await state();assert.equal((await post(receive)).status,200);assert.deepEqual(await state(),receivedState);
await reject({...receive,requestId:id(nonce++),quantity:3,expectedTargetStockRevision:(await stock(ids.destStock)).stock_revision},409,'over transfer');await reject({...dispatch,requestId:id(nonce++)},403,'store cannot dispatch');
await db.query('update inventory_items set stock_quantity=2,stock_conversion_snapshot=$1::jsonb,stock_revision=stock_revision+1 where id=$2',[JSON.stringify({purchaseUnit:'g',countUnit:'g',unitsPerPurchase:1}),ids.destStock]);
receive={...receive,requestId:id(nonce++),quantity:2,expectedTargetStockRevision:(await stock(ids.destStock)).stock_revision};response=await post(receive);assert.equal(response.status,200,await response.clone().text());assert.equal(Number((await stock(ids.destStock)).stock_quantity),4);assert.equal((await db.query('select status from inventory_transfers where id=$1',[transferId])).rows[0].status,'received');
assert.equal((await db.query("select count(*) n from inventory_movements where kind='transfer_out'")).rows[0].n,1);assert.equal((await db.query("select count(*) n from inventory_movements where kind='transfer_in'")).rows[0].n,2);
console.log('PASS: HQ dispatch does not credit destination, scoped partial receipt caps quantities, hides cost, replays once, preserves unknown');
permission=false;const before=statements.length;assert.equal((await get(ids.destination)).status,403);assert.equal((await post(receive)).status,403);assert.equal(statements.length,before);permission=true;session={...session,role:'store_terminal'};assert.equal((await post(receive)).status,403);
console.log('PASS: inventory module and writable-role gates apply before stock writes');
}finally{await db.close();}
