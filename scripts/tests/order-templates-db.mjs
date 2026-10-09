// Run production template/catalog SQL against isolated PostgreSQL, never DATABASE_URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require(process.env.FOUNDR1_TYPESCRIPT_MODULE || 'typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const db = new PGlite();
const ids = Object.fromEntries(['store','otherStore','employee','brand','otherBrand','sku','hidden','stopped','changed','replacement','granted','wrongBrand','brandStopped','order','line','otherTemplate','archived'].map((key,i)=>[key,`00000000-0000-4000-8000-${String(750+i).padStart(12,'0')}`]));
let session = {id:ids.employee,name:'Tester',role:'store_manager'};
let ordersPermission = true;
let scope = {allStores:false,storeIds:[ids.store]};
let allowStore = true;
let beforeTransaction = null;
let failTemplateRead = false;
let writableOverride = undefined;
const statements=[];
async function execute(statement,connection=db) {
  statements.push(statement.text);
  if(failTemplateRead && statement.text.includes('select id::text, name, items from procurement_order_templates'))throw new Error('simulated unavailable database');
  return (await connection.query(statement.text,statement.values)).rows;
}
const sql=Object.assign((parts,...values)=>({
  text:parts.reduce((text,part,i)=>text+part+(i<values.length?`$${i+1}`:''),''),values,
  then(resolve,reject){return execute(this).then(resolve,reject);}
}),{transaction:async queries=>{
  if(beforeTransaction){const hook=beforeTransaction;beforeTransaction=null;await hook();}
  return db.transaction(async transaction=>{const results=[];for(const query of queries)results.push(await execute(query,transaction));return results;});
}});
function load(path,modules={}) {
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,Response,Request,URL,console,require:name=>{
    if(name.endsWith('/api-auth'))return {
      requireOsSession:async()=>session,
      requireWritableOsSession:async()=>writableOverride!==undefined?writableOverride:session&&['owner','manager','store_owner','store_manager','staff'].includes(session.role)?session:null,
      canAccessStore:async(_,storeId)=>allowStore&&(scope.allStores||scope.storeIds.includes(storeId)),
      getSessionStoreScope:async()=>scope
    };
    if(name.endsWith('/db'))return {sql};
    if(name.endsWith('/role-permissions'))return {roleHasPermission:async(_,key)=>key==='module.orders'&&ordersPermission};
    if(name in modules)return modules[name];
    throw new Error(`Unmocked isolated dependency: ${name}`);
  }});return exports;
}
try {
  await db.exec(`
    create table stores(id uuid primary key,name text,status text default 'active');
    create table employees(id uuid primary key,name text);
    create table store_brands(store_id uuid,brand_id uuid);
    create table products(id uuid primary key,name text,unit text,brand_scope text default 'common',catalog_visibility text default 'brand_stores',is_orderable boolean default true);
    create table product_brand_usages(product_id uuid,brand_id uuid,is_orderable boolean);
    create table product_catalog_store_grants(product_id uuid,store_id uuid);
    create table purchase_orders(id uuid primary key,order_no text,store_id uuid,status text);
    create table purchase_order_items(id uuid primary key,purchase_order_id uuid,product_id uuid,requested_quantity numeric,requested_unit text,status text);
    insert into stores(id,name)values('${ids.store}','A'),('${ids.otherStore}','B');
    insert into employees values('${ids.employee}','Tester');
    insert into store_brands values('${ids.store}','${ids.brand}'),('${ids.otherStore}','${ids.otherBrand}');
    insert into products(id,name,unit)values
      ('${ids.sku}','Normal SKU','袋'),('${ids.hidden}','Hidden SKU','袋'),('${ids.stopped}','Stopped SKU','袋'),
      ('${ids.changed}','Same name','袋'),('${ids.replacement}','Same name','袋'),('${ids.granted}','Granted SKU','袋'),
      ('${ids.wrongBrand}','Other brand','袋'),('${ids.brandStopped}','Brand stopped','袋');
    update products set catalog_visibility='selected_stores' where id='${ids.granted}';
    insert into product_catalog_store_grants values('${ids.granted}','${ids.store}');
    update products set brand_scope='specific' where id in('${ids.wrongBrand}','${ids.brandStopped}');
    insert into product_brand_usages values('${ids.wrongBrand}','${ids.otherBrand}',true),('${ids.brandStopped}','${ids.brand}',false);
    insert into purchase_orders values('${ids.order}','PO-EXISTING','${ids.store}','requested');
    insert into purchase_order_items values('${ids.line}','${ids.order}','${ids.sku}',7,'袋','requested');
  `);
  const originalOrders=(await db.query('select * from purchase_orders')).rows;
  const originalLines=(await db.query('select * from purchase_order_items')).rows;
  const migration=readFileSync(new URL('db/migrations/20261009_procurement_order_templates.sql',root),'utf8');
  await db.exec(migration);await db.exec(migration);
  assert.deepEqual((await db.query('select * from purchase_orders')).rows,originalOrders);
  assert.deepEqual((await db.query('select * from purchase_order_items')).rows,originalLines);
  const units=load('lib/product-unit-conversions.ts');
  const catalogPolicy=load('lib/product-catalog-policy.ts',{'./product-unit-conversions.ts':units});
  const catalogAccess=load('lib/product-catalog-access.ts',{'./product-catalog-policy':catalogPolicy});
  const templatePolicy=load('lib/order-template-policy.ts');
  const route=load('app/api/orders/templates/route.ts',{'../../../../lib/product-catalog-access':catalogAccess,'../../../../lib/order-template-policy':templatePolicy});
  const item=(productId,quantity=2,purchaseUnit='袋')=>({productId,quantity,purchaseUnit});
  const post=body=>route.POST(new Request('https://example.test/api/orders/templates',{method:'POST',body:JSON.stringify({storeId:ids.store,...body})}));
  const get=(storeId=ids.store)=>route.GET(new Request(`https://example.test/api/orders/templates?storeId=${storeId}`));
  const templateCount=async()=>Number((await db.query('select count(*) from procurement_order_templates')).rows[0].count);
  let response=await post({name:' 常用 ',items:[item(ids.sku),item(ids.hidden,3),item(ids.stopped,4),item(ids.changed,5),item(ids.granted,6)]});
  assert.equal(response.status,200);const templateId=(await response.json()).templateId;
  const first=(await db.query('select name,items,created_by,created_at from procurement_order_templates where id=$1',[templateId])).rows[0];
  assert.equal(first.name,'常用');assert.equal(first.items.length,5);assert.equal(first.created_by,ids.employee);
  response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store, max-age=0');
  let state=await response.json();assert.equal(state.canManage,true);assert.equal(state.templates.length,1);assert.equal(state.templates[0].unavailableItemCount,0);
  assert.deepEqual(state.templates[0].items,first.items);
  assert.ok(statements.some(text=>text.includes('from product_brand_usages')));
  assert.ok(statements.some(text=>text.includes('for share')));
  console.log('PASS: additive repeat migration preserves existing orders; real route/catalog SQL saves explicit SKU IDs and whole purchase-unit draft quantities');

  for(const payload of [
    {name:'',items:[item(ids.sku)]},{name:'Bad fraction',items:[item(ids.sku,1.5)]},{name:'Bad string',items:[item(ids.sku,'2')]},
    {name:'Duplicate SKU',items:[item(ids.sku),item(ids.sku)]},{name:'Wrong store',storeId:'A',items:[item(ids.sku)]},
    {name:'Missing SKU',items:[item('00000000-0000-4000-8000-000000009999')]}
  ])assert.equal((await post(payload)).status,400);
  assert.equal((await post({name:'Wrong brand',items:[item(ids.wrongBrand)]})).status,403);
  assert.equal((await post({name:'Stopped brand usage',items:[item(ids.brandStopped)]})).status,400);
  assert.equal((await post({name:'Wrong literal unit',items:[item(ids.sku,1,'箱')]})).status,409);
  assert.equal(await templateCount(),1);
  response=await post({name:'常用',items:[item(ids.sku,99)]});assert.equal(response.status,409);
  assert.deepEqual((await db.query('select name,items,created_by,created_at from procurement_order_templates where id=$1',[templateId])).rows[0],first);
  await db.query('insert into procurement_order_templates(id,store_id,name,items)values($1,$2,$3,$4::jsonb)',[ids.otherTemplate,ids.otherStore,'常用',JSON.stringify([item(ids.sku,20)])]);
  await db.query("insert into procurement_order_templates(id,store_id,name,items,status)values($1,$2,'Archived',$3::jsonb,'archived')",[ids.archived,ids.store,JSON.stringify([item(ids.sku,20)])]);
  assert.equal((await(await get()).json()).templates.length,1);
  console.log('PASS: invalid quantities/SKUs and brand access reject; literal units match exactly; repeated names return409 without overwrite; store/archive scopes remain separate');

  await db.query("update products set catalog_visibility='internal' where id=$1",[ids.hidden]);
  await db.query('update products set is_orderable=false where id=$1',[ids.stopped]);
  await db.query("update products set unit='箱' where id=$1",[ids.changed]);
  await db.query('delete from product_catalog_store_grants where product_id=$1',[ids.granted]);
  state=await(await get()).json();const visible=state.templates[0];
  assert.deepEqual(visible.items,[item(ids.sku)]);assert.equal(visible.unavailableItemCount,4);
  for(const key of ['hidden','stopped','changed','granted','replacement'])assert.ok(!JSON.stringify(state).includes(ids[key]));
  assert.equal((await post({name:'Hidden rejected',items:[item(ids.hidden)]})).status,403);
  assert.equal((await post({name:'Stopped rejected',items:[item(ids.stopped)]})).status,400);
  assert.equal((await post({name:'Revoked grant rejected',items:[item(ids.granted)]})).status,403);
  session.role='owner';state=await(await get()).json();
  assert.ok(state.templates[0].items.some(row=>row.productId===ids.hidden));
  assert.ok(!state.templates[0].items.some(row=>row.productId===ids.stopped||row.productId===ids.changed||row.productId===ids.replacement));
  session.role='store_manager';
  console.log('PASS: current hidden/stopped/changed-unit/revoked-grant entries are redacted by exact ID; same-name replacement is never borrowed; HQ visibility does not bypass stop/unit guards');

  beforeTransaction=async()=>db.query("update products set unit='箱' where id=$1",[ids.sku]);
  response=await post({name:'Race unit',items:[item(ids.sku)]});assert.equal(response.status,409);
  assert.equal(await templateCount(),3);
  await db.query("update products set unit='袋' where id=$1",[ids.sku]);
  beforeTransaction=async()=>db.query('update products set is_orderable=false where id=$1',[ids.sku]);
  response=await post({name:'Race stopped',items:[item(ids.sku)]});assert.equal(response.status,409);
  assert.equal(await templateCount(),3);
  await db.query('update products set is_orderable=true where id=$1',[ids.sku]);
  const lastLock=statements.findLastIndex(text=>text.includes('order by id for share'));
  assert.ok(lastLock>=0&&statements[lastLock+1].includes('insert into procurement_order_templates'));
  assert.deepEqual((await db.query('select * from purchase_orders')).rows,originalOrders);
  assert.deepEqual((await db.query('select * from purchase_order_items')).rows,originalLines);
  console.log('PASS: product unit/stop changes between preflight and insert reject under ordered SHARE lock; template operations never create or mutate purchase orders');

  const beforeDenied=statements.length;
  assert.equal((await get(ids.otherStore)).status,403);
  assert.equal((await post({storeId:ids.otherStore,name:'Forbidden',items:[item(ids.sku)]})).status,403);
  assert.equal(statements.length,beforeDenied);
  const validSession=session;session=null;
  assert.equal((await get()).status,403);assert.equal((await post({name:'No session',items:[item(ids.sku)]})).status,403);
  session=validSession;ordersPermission=false;
  assert.equal((await get()).status,403);assert.equal((await post({name:'No module',items:[item(ids.sku)]})).status,403);
  ordersPermission=true;session.role='store_terminal';
  state=await(await get()).json();assert.equal(state.canManage,false);assert.equal(state.templates.length,1);
  const beforeTerminalWrite=statements.length;
  assert.equal((await post({name:'Terminal write',items:[item(ids.sku)]})).status,403);assert.equal(statements.length,beforeTerminalWrite);
  session.role='staff';assert.equal((await(await get()).json()).canManage,true);
  writableOverride={...session,id:'00000000-0000-4000-8000-000000009998'};
  assert.equal((await(await get()).json()).canManage,false);writableOverride=undefined;
  assert.equal((await get('')).status,400);
  failTemplateRead=true;response=await get();assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store, max-age=0');
  assert.equal((await response.json()).templates,undefined);failTemplateRead=false;
  assert.equal((await(await get()).json()).templates.length,1);
  assert.equal(await templateCount(),3);
  console.log('PASS: real route validates session/module/store/write scopes, terminal reads and account identity; no-store failed reads never return stale templates');
}finally{await db.close();}
