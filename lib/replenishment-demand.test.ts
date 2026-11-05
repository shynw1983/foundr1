import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as locks from "./replenishment-order-locks.ts";
import * as intent from "./replenishment-order-intent.ts";
import * as policy from "./replenishment-demand-policy.ts";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const store=id(1),product=id(2),employee=id(3),otherStore=id(4),otherProduct=id(5);
const actor={id:employee,name:'Manager',role:'owner',sessionId:id(6),sessionVersion:1};
function load(path:string,modules:Record<string,unknown>) {
  const exports:Record<string,any>={};
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:(key:string)=>{if(!(key in modules))throw Error(`Missing ${key}`);return modules[key];},Response,Request,URL,console,Date,Set,Map},{filename:path});
  return exports;
}
async function database() {
  const {PGlite}=await import(process.env.FOUNDR1_PGLITE_MODULE!);
  const db=new PGlite();
  const query=Object.assign((parts:TemplateStringsArray,...values:unknown[])=>({
    text:parts.reduce((result,part,index)=>result+part+(index<values.length?`$${index+1}`:''),''),values,
    then(resolve:(rows:unknown[])=>void,reject:(error:unknown)=>void){return db.query(this.text,this.values).then((result:any)=>result.rows).then(resolve,reject);}
  }),{transaction:(statements:Array<{text:string;values:unknown[]}>)=>db.transaction(async(tx:any)=>{
    const results=[];for(const statement of statements)results.push((await tx.query(statement.text,statement.values)).rows);return results;
  })});
  await db.exec(`
    create table stores(id uuid primary key,name text,status text default 'active');
    create table employees(id uuid primary key,name text,role text,status text default 'active');
    create table employee_scopes(employee_id uuid,scope_type text,store_id uuid);
    create table role_permissions(role text,permission_key text,is_enabled boolean);
    create table products(id uuid primary key,name text,unit text,brand_scope text default 'common',is_orderable boolean default true,catalog_visibility text default 'brand_stores');
    create table store_brands(store_id uuid,brand_id uuid);
    create table product_brand_usages(product_id uuid,brand_id uuid,is_orderable boolean);
    create table product_catalog_store_grants(product_id uuid,store_id uuid);
    create table purchase_orders(id uuid primary key default gen_random_uuid(),order_no text unique,store_id uuid,requested_by uuid,assigned_to uuid,deadline_label text,deadline_at timestamptz,
      requested_item_count integer,priority text,status text,note text,replenishment_source jsonb,created_at timestamptz default now());
    create table purchase_order_items(id uuid primary key default gen_random_uuid(),purchase_order_id uuid,product_id uuid,requested_quantity numeric,requested_unit text,status text,actual_quantity numeric);
    create table os_notifications(id uuid primary key default gen_random_uuid(),recipient_employee_id uuid,notification_type text,title text,message text,href text);
    create table purchase_actuals(id uuid primary key default gen_random_uuid(),purchase_order_item_id uuid,actual_unit text,recorded_at timestamptz default now());
    create table inventory_locations(id uuid primary key,store_id uuid,name text,status text default 'active');
    create table inventory_items(id uuid primary key,product_id uuid,store_id uuid,location_id uuid,status text default 'active',stock_quantity numeric,count_unit text,safety_stock numeric,
      last_counted_at timestamptz,quick_status text,quick_checked_at timestamptz);
    create table inventory_stock_receipts(id uuid primary key default gen_random_uuid(),purchase_order_item_id uuid,store_id uuid,product_id uuid,purchase_quantity numeric,purchase_unit text);
    insert into stores(id,name) values('${store}','A'),('${otherStore}','B');
    insert into employees(id,name,role) values('${employee}','Manager','owner');
    insert into products(id,name,unit) values('${product}','Same name','袋'),('${otherProduct}','Same name','箱');
  `);
  const migration=readFileSync(new URL('../db/migrations/20261018_replenishment_demands.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  const crypto=await import('node:crypto');
  const data=load('./replenishment-demand-data.ts',{
    'node:crypto':crypto,'./db':{sql:query},'./product-catalog-access':{getVisibleProductIdsForStore:async()=>[product]},
    './replenishment-data':{},'./replenishment-order-locks':locks,'./replenishment-order-intent':intent,'./replenishment-demand-policy':policy
  });
  return {db,query,data};
}
const report=(requestId=id(10),extras={})=>({action:'report',storeId:store,productId:product,requestId,quantity:3,unit:'袋',note:'Shelf is low',shortageStatus:'low_stock',...extras});
const pool=(data:any,query:any)=>data.readDemandPool(actor,[{id:store,name:'A'}],query);
const now=async(db:any)=>String((await db.query('select clock_timestamp()::text at')).rows[0].at);
const counts=async(db:any)=>(await db.query('select (select count(*)::int from purchase_orders) orders,(select count(*)::int from purchase_order_items) items,(select count(*)::int from os_notifications) notifications')).rows[0];

test('quantity, source confidence and purchased/received progress remain distinct',()=>{
  for(const value of [undefined,'2','',0,-1,1.2,1000,NaN])assert.equal(policy.validDemandQuantity(value),false);
  assert.equal(policy.validDemandQuantity(null,true),true);
  assert.equal(policy.demandDateAt('2026-10-18'),'2026-10-18T00:00:00+09:00');
  assert.equal(policy.demandDateAt('2026-02-31'),null);
  assert.equal(policy.demandDateAt('2026-10-18T12:00'),'2026-10-18T12:00+09:00');
  const order={orderId:id(20),orderNo:'PO',itemId:id(21),status:'purchased',requestedQuantity:3,unit:'袋',actualQuantity:3,actualUnit:'袋',receivedQuantity:0};
  assert.equal(policy.demandProgress('ordered',[order]),'purchasing');
  assert.equal(policy.demandProgress('ordered',[{...order,status:'received'}]),'awaiting_receipt');
  assert.equal(policy.demandProgress('ordered',[{...order,receivedQuantity:1}]),'partial_received');
  assert.equal(policy.demandProgress('ordered',[{...order,receivedQuantity:3}]),'received');
  assert.equal(policy.demandProgress('ordered',[{...order,actualUnit:'箱'}]),'needs_review');
  const source:any={id:product,kind:'inventory',stockStatus:'low_stock',countConfidence:'confirmed',quantity:0,quickCheck:{status:'low',checkedAt:'2026-10-18',estimate:null,state:'fresh'}};
  assert.deepEqual(policy.demandSignalBasis([source]),policy.demandSignalBasis([{...source,countConfidence:'stale',quickCheck:{...source.quickCheck,state:'recheck'}}]));
});

test('real PostgreSQL reports merge exact pair, replay once, preserve review and unit snapshots',{skip:!process.env.FOUNDR1_PGLITE_MODULE},async()=>{
  const {db,query,data}=await database();
  try {
    const first=await data.reportReplenishmentDemand(actor,report(),query);assert.ok(first.demandId);
    assert.equal((await data.reportReplenishmentDemand(actor,report(),query)).demandId,first.demandId);
    assert.equal((await data.reportReplenishmentDemand(actor,report(id(10),{quantity:4}),query)).sameRequest,false);
    let rows=await pool(data,query);assert.equal(rows.length,1);assert.equal(rows[0].quantity,3);assert.equal(rows[0].events.length,1);assert.equal(rows[0].events[0].unit,'袋');
    assert.ok(await data.reviewReplenishmentDemand(actor,{action:'review',storeId:store,demandId:first.demandId,expectedVersion:rows[0].version,status:'reviewing',quantity:5,unit:'袋',note:'Manager added two'},query));
    await data.reportReplenishmentDemand({...actor,id:employee,name:'Second employee'},report(id(11),{quantity:9}),query);
    rows=await pool(data,query);assert.equal(rows[0].quantity,5);assert.equal(rows[0].note,'Manager added two');assert.equal(rows[0].status,'reviewing');assert.equal(rows[0].events.length,3);
    assert.equal(await data.reviewReplenishmentDemand(actor,{storeId:store,demandId:first.demandId,expectedVersion:1,status:'dismissed',quantity:null,unit:'袋',note:'stale'},query),null);
    await db.query("update products set catalog_visibility='internal' where id=$1",[product]);
    assert.equal(await data.reviewReplenishmentDemand({...actor,role:'store_manager'},{storeId:store,demandId:first.demandId,expectedVersion:rows[0].version,status:'dismissed',quantity:null,unit:'袋',note:'hidden'},query),null);
    assert.equal((await pool(data,query))[0].status,'reviewing');
    assert.equal((await data.reportReplenishmentDemand(actor,report(),query)).demandId,first.demandId);
    assert.equal((await data.reportReplenishmentDemand({...actor,role:'store_manager'},report(id(15)),query)).demandId,null);
    await db.query("update products set catalog_visibility='brand_stores' where id=$1",[product]);
    const wrongUnit=await data.reportReplenishmentDemand(actor,report(id(12),{unit:'箱'}),query);assert.equal(wrongUnit.demandId,null);
    await data.reportReplenishmentDemand(actor,report(id(13),{productId:otherProduct,unit:'箱'}),query);
    assert.equal(Number((await db.query('select count(*) n from replenishment_demands')).rows[0].n),2);
    assert.deepEqual(await counts(db),{orders:0,items:0,notifications:0});
  } finally {await db.close();}
});

test('real PostgreSQL automatic signals suppress unchanged dismissed risk and reject delayed observations',{skip:!process.env.FOUNDR1_PGLITE_MODULE},async()=>{
  const {db,query,data}=await database();
  try {
    const neverExistingObservation='2000-01-01T00:00:00Z';
    await data.syncReplenishmentDemandSignals(otherStore,[],await now(db),query);
    assert.equal((await data.syncReplenishmentDemandSignals(otherStore,[{productId:otherProduct,unit:'箱',sources:[],fingerprint:'obsolete-new-pair'}],neverExistingObservation,query)).changed,0);
    assert.equal(Number((await db.query('select count(*) n from replenishment_demands where store_id=$1',[otherStore])).rows[0].n),0);
    const signals=[{productId:product,unit:'袋',sources:[{kind:'inventory',id:id(30),stockStatus:'low_stock'}],fingerprint:'risk-1'}];
    const oldAt=await now(db);
    assert.equal((await data.syncReplenishmentDemandSignals(store,signals,oldAt,query)).changed,1);
    let row=(await pool(data,query))[0];
    let duringManualTransaction='';
    const delayedQuery=Object.assign((parts:TemplateStringsArray,...values:unknown[])=>query(parts,...values),{transaction:(statements:Array<{text:string;values:unknown[]}>)=>db.transaction(async(tx:any)=>{
      // PostgreSQL now() is transaction-start time. This observation is later than that start but earlier than the actual decision.
      await new Promise(resolve=>setTimeout(resolve,5));
      duringManualTransaction=String((await tx.query('select clock_timestamp()::text at')).rows[0].at);
      await new Promise(resolve=>setTimeout(resolve,5));
      const results=[];for(const statement of statements)results.push((await tx.query(statement.text,statement.values)).rows);return results;
    })});
    await data.reviewReplenishmentDemand(actor,{storeId:store,demandId:row.id,expectedVersion:row.version,status:'dismissed',quantity:null,unit:'袋',note:'No purchase needed'},delayedQuery);
    assert.equal((await data.syncReplenishmentDemandSignals(store,[{...signals[0],fingerprint:'captured-before-decision'}],duringManualTransaction,query)).changed,0);
    assert.equal((await data.syncReplenishmentDemandSignals(store,signals,await now(db),query)).changed,0);
    row=(await pool(data,query))[0];assert.equal(row.status,'dismissed');assert.equal(row.note,'No purchase needed');
    assert.equal((await data.syncReplenishmentDemandSignals(store,[{...signals[0],fingerprint:'obsolete'}],oldAt,query)).changed,0);
    assert.equal((await data.syncReplenishmentDemandSignals(store,[{...signals[0],fingerprint:'risk-2'}],await now(db),query)).changed,1);
    row=(await pool(data,query))[0];assert.equal(row.status,'open');assert.equal(row.quantity,null);
    await data.reviewReplenishmentDemand(actor,{storeId:store,demandId:row.id,expectedVersion:row.version,status:'resolved',quantity:null,unit:'袋',note:'Transferred stock'},query);
    await data.syncReplenishmentDemandSignals(store,[],await now(db),query);
    await data.syncReplenishmentDemandSignals(store,[{...signals[0],fingerprint:'risk-2'}],await now(db),query);
    assert.equal((await pool(data,query))[0].status,'open');
    assert.deepEqual(await counts(db),{orders:0,items:0,notifications:0});
  } finally {await db.close();}
});

test('real PostgreSQL atomic issue checks version, exact units, open orders, scoped buyers, permission, receipts and replay',{skip:!process.env.FOUNDR1_PGLITE_MODULE},async()=>{
  const {db,query,data}=await database();
  try {
    await data.reportReplenishmentDemand(actor,report(),query);
    let row=(await pool(data,query))[0];
    const issue:any={action:'create_order',storeId:store,requestId:id(40),buyerId:employee,additionalOrderConfirmed:false,items:[{demandId:row.id,expectedVersion:row.version,quantity:3,unit:'袋',expectedOpenItemIds:[]}]};
    const attempt=async(extras={})=>data.issueReplenishmentDemandOrder(actor,{...issue,...extras},query);
    assert.equal((await attempt({items:[{...issue.items[0],unit:'箱'}]})).orderId,null);
    assert.equal((await attempt({items:[{...issue.items[0],expectedVersion:99}]})).orderId,null);
    await db.query('update employees set role=$1 where id=$2',['staff',employee]);
    assert.equal((await attempt()).orderId,null);
    await db.query('update employees set role=$1 where id=$2',['manager',employee]);
    await db.query("insert into role_permissions values('manager','module.orders',false)");
    assert.equal((await attempt()).orderId,null);
    await db.query("update role_permissions set is_enabled=true");
    await db.query('update products set is_orderable=false where id=$1',[product]);
    assert.equal((await attempt()).orderId,null);
    await db.query('update products set is_orderable=true where id=$1',[product]);
    assert.deepEqual(await counts(db),{orders:0,items:0,notifications:0});
    const first=await attempt();assert.ok(first.orderId);assert.equal(first.changedCount,1);assert.equal(first.notificationCount,1);
    assert.equal((await attempt()).orderId,first.orderId);assert.equal((await attempt({note:'changed'})).sameRequest,false);
    assert.deepEqual(await counts(db),{orders:1,items:1,notifications:1});
    row=(await pool(data,query))[0];assert.equal(row.status,'ordered');assert.equal(row.orders.length,1);assert.equal(row.openOrders.length,1);assert.equal(row.progress,'purchasing');
    const itemId=row.orders[0].itemId;
    await db.query('update purchase_order_items set requested_quantity=1 where id=$1',[itemId]);
    assert.equal((await pool(data,query))[0].progress,'needs_review');
    await db.query('update purchase_order_items set requested_quantity=3 where id=$1',[itemId]);
    await db.query("update purchase_order_items set status='received',actual_quantity=3 where id=$1",[itemId]);
    await db.query('insert into purchase_actuals(purchase_order_item_id,actual_unit) values($1,$2)',[itemId,'袋']);
    row=(await pool(data,query))[0];assert.equal(row.progress,'awaiting_receipt');assert.equal(row.status,'ordered');
    await db.query('insert into inventory_stock_receipts(purchase_order_item_id,store_id,product_id,purchase_quantity,purchase_unit) values($1,$2,$3,1,$4)',[itemId,store,product,'袋']);
    assert.equal((await pool(data,query))[0].progress,'partial_received');
    await db.query('insert into inventory_stock_receipts(purchase_order_item_id,store_id,product_id,purchase_quantity,purchase_unit) values($1,$2,$3,2,$4)',[itemId,store,product,'袋']);
    row=(await pool(data,query))[0];assert.equal(row.progress,'received');assert.equal(row.status,'ordered');
    // A distinct ordinary order is included in the same SKU snapshot and must be acknowledged before any addition.
    await db.query("insert into purchase_orders(id,order_no,store_id) values($1,'PO-ORDINARY',$2)",[id(41),store]);
    await db.query("insert into purchase_order_items(id,purchase_order_id,product_id,requested_quantity,requested_unit,status) values($1,$2,$3,2,'袋','requested')",[id(42),id(41),product]);
    const stale={...issue,requestId:id(43),items:[{...issue.items[0],expectedVersion:row.version}]};
    assert.equal((await data.issueReplenishmentDemandOrder(actor,stale,query)).orderId,null);
    const extra={...stale,additionalOrderConfirmed:true,items:[{...stale.items[0],expectedOpenItemIds:[id(42)]}]};
    assert.ok((await data.issueReplenishmentDemandOrder(actor,extra,query)).orderId);
    assert.equal(Number((await db.query('select count(*) n from os_notifications')).rows[0].n),2);
    // Both location units remain separate; a quick low observation never replaces a count/book quantity.
    await db.query("insert into inventory_locations(id,store_id,name) values($1,$2,'Cold'),($3,$2,'Dry')",[id(50),store,id(51)]);
    await db.query("insert into inventory_items(id,product_id,store_id,location_id,stock_quantity,count_unit,quick_status) values($1,$2,$3,$4,7,'袋','low'),($5,$2,$3,$6,null,'g',null)",[id(52),product,store,id(50),id(53),id(51)]);
    row=(await pool(data,query))[0];assert.equal(row.inventory.length,2);assert.equal(row.inventory.find((item:any)=>item.countUnit==='袋').quantity,7);assert.equal(row.inventory.find((item:any)=>item.countUnit==='g').quantity,null);
    assert.equal(JSON.stringify(row).includes('price'),false);
  } finally {await db.close();}
});

test('API role, store and verified-operator gates reject spoofed identities without demand/order writes',async()=>{
  let session:any={...actor,role:'staff'};
  let storeAllowed=true,productAllowed=true;
  let verifiedActor:any={...actor,role:'staff'};
  let writes=0;let issued=0;let delivered=0;let capturedActor:any=null;
  const terminal={...actor,id:id(70),role:'store_terminal'};
  const api=load('./replenishment-demand-api.ts',{
    './api-auth':{requireWritableOsSession:async()=>session,canAccessStore:async()=>storeAllowed},
    './role-permissions':{roleHasPermission:async()=>true},
    './store-order-access':{getStoreOrderAccess:async()=>({stores:[{id:store,name:'A'}]})},
    './product-catalog-access':{assertProductViewableAtStore:async()=>productAllowed?{ok:true}:{ok:false,status:403,error:'hidden'}},
    './replenishment-demand-policy':policy,'./replenishment-demand-notification':{dispatchReplenishmentDemandNotification:async()=>{delivered++;}},
    './replenishment-demand-data':{
      readDemandBuyers:async()=>[],readDemandPool:async()=>[],readDemandProducts:async()=>[],syncInventoryReplenishmentDemands:async()=>({changed:0}),
      reportReplenishmentDemand:async(who:any)=>{if(!productAllowed)return {demandId:null,sameRequest:true};writes++;capturedActor=who;return {demandId:id(71),sameRequest:true};},
      reviewReplenishmentDemand:async()=>{writes++;return id(71);},
      issueReplenishmentDemandOrder:async()=>{issued++;return {orderId:'PO-1',sameRequest:true,notificationId:issued===1?id(74):null};}
    },
    './store-inventory-access':{
      storeInventoryHeaders:{'Cache-Control':'no-store'},assertStoreInventorySameOrigin:(request:Request)=>request.headers.get('origin')===new URL(request.url).origin?null:Response.json({error:'origin'},{status:403}),
      requireStoreInventoryAccess:async()=>verifiedActor?{ok:true,baseSession:terminal,actor:verifiedActor,operator:{id:verifiedActor.id,name:verifiedActor.name}}:{ok:false,response:Response.json({code:'operator_required'},{status:401})},
      assertExpectedStoreInventoryOperator:(access:any,expected:unknown)=>expected===access.actor.id?null:Response.json({code:'operator_changed'},{status:409})
    }
  });
  const request=(body:any,withOrigin=true)=>new Request('https://example.test/api/replenishment',{method:'POST',headers:{'Content-Type':'application/json',...(withOrigin?{Origin:'https://example.test'}:{})},body:JSON.stringify(body)});
  assert.equal((await api.mutateDemandApi(request(report()),false)).status,403);assert.equal(writes,0);
  session={...actor,role:'store_manager'};storeAllowed=false;
  assert.equal((await api.mutateDemandApi(request(report()),false)).status,403);assert.equal(writes,0);
  storeAllowed=true;
  assert.equal((await api.mutateDemandApi(request(report()),false)).status,200);assert.equal(writes,1);
  assert.equal((await api.mutateDemandApi(request(report(),false),false)).status,403);assert.equal(writes,1);
  assert.equal((await api.mutateDemandApi(request({...report(),expectedOperatorId:terminal.id}),true)).status,409);assert.equal(writes,1);
  assert.equal((await api.mutateDemandApi(request({...report(),expectedOperatorId:employee}),true)).status,200);assert.equal(writes,2);
  assert.equal(capturedActor.id,employee);assert.equal(capturedActor.role,'store_terminal');
  verifiedActor=null;
  assert.equal((await api.mutateDemandApi(request({...report(),expectedOperatorId:employee}),true)).status,401);assert.equal(writes,2);
  verifiedActor={...actor,role:'staff'};productAllowed=false;
  assert.equal((await api.mutateDemandApi(request({...report(),expectedOperatorId:employee}),true)).status,409);assert.equal(writes,2);
  const order={action:'create_order',storeId:store,requestId:id(72),buyerId:employee,expectedActorId:id(73),additionalOrderConfirmed:false,items:[{demandId:id(71),expectedVersion:1,quantity:2,unit:'袋',expectedOpenItemIds:[]}]};
  assert.equal((await api.mutateDemandApi(request(order),false)).status,409);assert.equal(issued,0);
  assert.equal((await api.mutateDemandApi(request({...order,expectedActorId:session.id}),false)).status,200);assert.equal(issued,1);assert.equal(delivered,1);
  assert.equal((await api.mutateDemandApi(request({...order,expectedActorId:session.id}),false)).status,200);assert.equal(issued,2);assert.equal(delivered,1);
  assert.equal((await api.mutateDemandApi(request({...order,expectedActorId:session.id,items:[{...order.items[0],quantity:1.2}]}),false)).status,400);assert.equal(issued,2);
});
