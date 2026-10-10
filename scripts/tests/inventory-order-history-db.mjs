// Actual history-deletion SQL against isolated PostgreSQL; never DATABASE_URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const {PGlite}=await import(process.env.FOUNDR1_PGLITE_MODULE||'@electric-sql/pglite');
const root=new URL('../../',import.meta.url),db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const store=id(1),employee=id(2),order=id(3),sales=id(4),otherOrder=id(5),otherSales=id(6);
let reverseCalls=0,auditCalls=0,hook=null,failDelete=false;
const sql=Object.assign((parts,...values)=>({text:parts.reduce((s,p,i)=>s+p+(i<values.length?`$${i+1}`:''),''),values,
  then(resolve,reject){if(failDelete&&this.text.includes('delete from store_customer_orders'))return Promise.reject(new Error('simulated failure')).then(resolve,reject);return db.query(this.text,this.values).then(result=>result.rows).then(resolve,reject);}}),{
  transaction:async statements=>{if(hook){const once=hook;hook=null;await once();}return db.transaction(async transaction=>{const rows=[];for(const query of statements)rows.push((await transaction.query(query.text,query.values)).rows);return rows;});}
});
const exports={};
const compiled=ts.transpileModule(readFileSync(new URL('app/api/sales/test-orders/route.ts',root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
runInNewContext(compiled,{exports,Response,Request,Date,console,require:name=>{
  if(name==='crypto')return require('crypto');
  if(name.endsWith('/db'))return{sql};
  if(name.endsWith('/api-auth'))return{requireOsSession:async()=>({id:employee,role:'owner'}),canAccessStore:async(_,selected)=>selected===store};
  if(name.endsWith('/loyalty'))return{reverseLoyaltyForRefundedOrder:async()=>reverseCalls++,reconcileMemberAccountFromLoyaltyLedger:async()=>{}};
  if(name.endsWith('/audit-log'))return{writeAuditLog:async()=>auditCalls++};
  throw new Error(`Unexpected dependency ${name}`);
}});
const request=()=>new Request('https://example.test/api/sales/test-orders',{method:'DELETE',body:JSON.stringify({storeId:store,startDate:'2026-10-11',endDate:'2026-10-11',salesOrderIds:[sales],confirmation:'DELETE'})});
try {
  await db.exec(`create table stores(id uuid primary key);create table employees(id uuid primary key);create table products(id uuid primary key);
    create table inventory_items(id uuid primary key);create table order_production_tasks(order_id uuid,started_at timestamptz);
    create table store_customer_orders(id uuid primary key,store_id uuid references stores,member_id uuid,preparing_at timestamptz,ready_at timestamptz,completed_at timestamptz);
    create table sales_orders(id uuid primary key,source_order_id uuid,store_id uuid,ordered_at timestamptz);
    create table loyalty_settlement_entries(order_id uuid);create table loyalty_point_ledger(order_id uuid);create table loyalty_stamp_ledger(order_id uuid);
    create table member_coupons(status text,used_order_id uuid,used_store_id uuid,used_at timestamptz,metadata jsonb default '{}');
    insert into stores values('${store}');insert into employees values('${employee}');
    insert into store_customer_orders(id,store_id)values('${order}','${store}'),('${otherOrder}','${store}');
    insert into sales_orders values('${sales}','${order}','${store}','2026-10-11 12:00:00+09'),('${otherSales}','${otherOrder}','${store}','2026-10-11 12:00:00+09');`);
  await db.exec(readFileSync(new URL('db/migrations/20261011_inventory_order_usage.sql',root),'utf8'));
  const event=()=>db.query(`insert into inventory_order_usage_events(order_id,store_id,occurred_at,source_snapshot,plan_snapshot)values($1,$2,now(),'{}','{}')`,[order,store]);
  await event();
  let response=await exports.DELETE(request());assert.equal(response.status,409);assert.equal(reverseCalls,0);assert.equal(auditCalls,0);
  assert.equal((await db.query('select count(*) from sales_orders')).rows[0].count,2);
  assert.equal((await db.query('select count(*) from store_customer_orders')).rows[0].count,2);
  assert.equal((await db.query('select count(*) from inventory_order_usage_events')).rows[0].count,1);
  await db.query('delete from inventory_order_usage_events where order_id=$1',[order]);
  hook=event;
  response=await exports.DELETE(request());assert.equal(response.status,409);assert.equal(reverseCalls,0);
  assert.equal((await db.query('select count(*) from sales_orders')).rows[0].count,2);
  console.log('PASS: existing and between-preflight/lock usage events return409 before any loyalty or sales/source deletion; ledger facts retained');
  await db.query('delete from inventory_order_usage_events where order_id=$1',[order]);
  await db.query(`insert into inventory_order_usage_issues(order_id,store_id,code,details)values($1,$2,'source_deletion_pending','{"claimId":"other"}')`,[order,store]);
  response=await exports.DELETE(request());assert.equal(response.status,409);assert.equal(reverseCalls,0);
  assert.equal((await db.query("select details->>'claimId' as claim from inventory_order_usage_issues")).rows[0].claim,'other');
  await db.query('delete from inventory_order_usage_issues');
  failDelete=true;response=await exports.DELETE(request());assert.equal(response.status,503);failDelete=false;
  assert.equal((await db.query('select count(*) from inventory_order_usage_issues')).rows[0].count,0);
  assert.equal((await db.query('select count(*) from store_customer_orders where id=$1',[order])).rows[0].count,1);
  await db.query('insert into sales_orders values($1,$2,$3,$4)',[sales,order,store,'2026-10-11T03:00:00Z']);
  response=await exports.DELETE(request());assert.equal(response.status,200);
  assert.equal((await db.query('select count(*) from store_customer_orders where id=$1',[order])).rows[0].count,0);
  assert.equal((await db.query('select count(*) from store_customer_orders where id=$1',[otherOrder])).rows[0].count,1);
  assert.equal((await db.query('select count(*) from inventory_order_usage_issues')).rows[0].count,0);
  console.log('PASS: concurrent deletion claim cannot be overwritten; failed delete releases own fence and preserves source; ordinary authorized deletion and unrelated orders still work');
}finally{await db.close();}
