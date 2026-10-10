// Real count and forecast SQL in isolated PostgreSQL; never reads production credentials.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const {PGlite}=await import(process.env.FOUNDR1_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite(),root=new URL('../../',import.meta.url);
const id=n=>`00000000-0000-4000-8000-${String(2000+n).padStart(12,'0')}`;
const store=id(1),product=id(2),loc=id(3),stock=id(4),employee=id(5),brand=id(6);
let session={id:employee,name:'Tester',role:'owner'},allowed=true;
const sql=Object.assign((parts,...values)=>({text:parts.reduce((s,p,i)=>s+p+(i<values.length?`$${i+1}`:''),''),values,then(resolve,reject){return db.query(this.text,this.values).then(r=>r.rows).then(resolve,reject);}}),{transaction:queries=>db.transaction(async tx=>{const rows=[];for(const q of queries)rows.push((await tx.query(q.text,q.values)).rows);return rows;})});
function load(path,modules={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,Request,URL,Date,console,require:name=>{
 if(name.endsWith('/db')||name==='./db')return{sql};
 if(name.endsWith('/api-auth'))return{requireOsSession:async()=>session,canAccessStore:async(_,s)=>allowed&&s===store,getSessionStoreScope:async()=>({allStores:false,storeIds:[store]})};
 if(name.endsWith('/role-permissions'))return{roleHasPermission:async()=>true};
 if(name.endsWith('/product-catalog-access'))return{getVisibleProductIdsForStore:async()=>[product],assertProductViewableAtStore:async()=>({ok:true})};
 if(name in modules)return modules[name];throw Error('Unmocked '+name);
}});return exports;}
try{
 await db.exec(`
 create table brands(id uuid primary key,name text);
 create table stores(id uuid primary key,name text,status text default 'active');
 create table employees(id uuid primary key,name text);
 create table store_brands(store_id uuid,brand_id uuid);
 create table products(id uuid primary key,name text,category text default '',unit text,package_quantity numeric,package_quantity_unit text,storage_type text default '');
 create table inventory_locations(id uuid primary key,store_id uuid,name text,status text default 'active',sort_order integer default 0);
 create table inventory_items(id uuid primary key,store_id uuid,product_id uuid,location_id uuid,count_unit text,safety_stock numeric,current_quantity numeric,exception_code text default '',exception_note text default '',last_counted_at timestamptz,last_counted_by uuid,status text default 'active',updated_at timestamptz default now(),unique(store_id,product_id,location_id));
 create table inventory_checks(id uuid primary key default gen_random_uuid(),inventory_item_id uuid,store_id uuid,product_id uuid,quantity numeric,count_unit text,record_type text,exception_code text,note text,recorded_by uuid,created_at timestamptz default now());
 create table suppliers(id uuid primary key);create table purchase_actuals(id uuid primary key);create table price_records(id uuid primary key);
 create table purchase_orders(id uuid primary key);
 create table purchase_order_items(id uuid primary key);
 create table store_customer_orders(id uuid primary key,preparing_at timestamptz,ready_at timestamptz,completed_at timestamptz);
 create table order_production_tasks(id uuid primary key,order_id uuid,started_at timestamptz);
 insert into brands values('${brand}','Brand');insert into stores(id,name)values('${store}','A');insert into store_brands values('${store}','${brand}');insert into employees values('${employee}','Tester');
 insert into products(id,name,unit,package_quantity,package_quantity_unit)values('${product}','Octopus','袋',20,'個');
 insert into inventory_locations(id,store_id,name)values('${loc}','${store}','Freezer');
 insert into inventory_items(id,store_id,product_id,location_id,count_unit,safety_stock,current_quantity,last_counted_at,last_counted_by,exception_code,exception_note)values('${stock}','${store}','${product}','${loc}','個',1,10,'2026-10-01','${employee}','quality','retain');
 `);
 for(const migration of ['20261008_product_unit_conversions.sql','20261009_inventory_receipts.sql','20261009_inventory_quick_checks.sql','20261009_inventory_receipt_unknown_balance.sql','20261011_product_packaging.sql','20261011_inventory_recipes.sql','20261011_inventory_order_usage.sql','20261011_inventory_usage_reconciliation.sql']){const source=readFileSync(new URL('db/migrations/'+migration,root),'utf8');await db.exec(source);await db.exec(source);}
 const units=load('lib/product-unit-conversions.ts'),quick=load('lib/inventory-quick-policy.ts'),policy=load('lib/inventory-usage-policy.ts');
 const countInputs=load('lib/inventory-count-input-policy.ts',{'./product-unit-conversions':units});
 const route=load('app/api/inventory/route.ts',{'../../../lib/inventory-count-input-policy':countInputs,'../../../lib/product-unit-conversions':units,'../../../lib/inventory-quick-policy':quick});
 const usage=load('lib/inventory-usage-data.ts',{'./inventory-usage-policy':policy});
 const count=async (quantity,inputUnit='個')=>{const row=(await db.query('select stock_revision from inventory_items where id=$1',[stock])).rows[0];const r=await route.POST(new Request('https://example.invalid/api/inventory',{method:'POST',body:JSON.stringify({action:'count',storeId:store,itemId:stock,quantity,inputUnit,countUnit:'個',expectedStockRevision:row.stock_revision,expectedConversion:{purchaseUnit:'袋',countUnit:'個',unitsPerPurchase:20}})}));assert.equal(r.status,200,await r.clone().text());return(await r.json()).count;};
 const first=await count(0.5,'袋');assert.equal(first.reconciliation.enteredQuantity,0.5);assert.equal(first.reconciliation.enteredUnit,'袋');assert.ok(first.checkId);assert.equal(first.reconciliation.confidence,'unknown');assert.ok(first.reconciliation.issueReasons.includes('anchor_missing'));
 let saved=(await db.query('select * from inventory_items where id=$1',[stock])).rows[0];assert.equal(saved.usage_anchor_check_id,first.checkId);assert.equal(saved.exception_code,'quality');assert.equal(saved.exception_note,'retain');
 console.log('PASS: migration idempotence, atomic real count origin/history/movement and quality facts');
 await db.exec(`update inventory_checks set created_at=clock_timestamp()-interval '2 days' where id='${first.checkId}';update inventory_items set last_counted_at=(select created_at from inventory_checks where id='${first.checkId}') where id='${stock}';insert into inventory_usage_settings(store_id,enabled,enabled_from)values('${store}',true,clock_timestamp()-interval '2 days');`);
 async function movement(key,kind,quantity,confidence='exact',exposure=0,metadata={}){
  const before=(await db.query('select stock_quantity from inventory_items where id=$1',[stock])).rows[0].stock_quantity;
  await db.query(`insert into inventory_movements(operation_key,store_id,product_id,inventory_item_id,kind,quantity,count_unit,confidence,exposure,occurred_at,before_quantity,after_quantity,changes_stock,metadata)values($1,$2,$3,$4,$5,$6,'個',$7,$8,clock_timestamp(),$9,case when $7='exact' then $9::numeric+$6::numeric else $9::numeric end,$7='exact' and $6::numeric is not null,$10::jsonb)`,[key,store,product,stock,kind,quantity,confidence,exposure,before,JSON.stringify(metadata)]);
  if(confidence==='exact'&&quantity!==null)await db.query('update inventory_items set stock_quantity=stock_quantity+$1::numeric,stock_revision=stock_revision+1 where id=$2',[quantity,stock]);
 }
 await movement('r1','receipt',40);await movement('o1','order_use',-1,'exact',1);
 const view=await usage.getInventoryUsage(store,[product]);assert.equal(view.items[0].receivedQuantity,40);assert.equal(view.items[0].orderDeductedQuantity,1);assert.equal(view.items[0].bookExpectedQuantity,49);assert.equal(view.items[0].forecastQuantity,49);
 const second=await count(48);assert.equal(second.reconciliation.anchorCheckId,first.checkId);assert.equal(second.reconciliation.expectedQuantity,49);assert.equal(second.reconciliation.difference,-1);assert.equal(second.reconciliation.receivedQuantity,40);assert.equal(second.reconciliation.orderDeductedQuantity,1);assert.equal(second.reconciliation.confidence,'confirmed');
 saved=(await db.query('select * from inventory_items where id=$1',[stock])).rows[0];assert.equal(Number(saved.stock_quantity),48);assert.equal(Number(saved.current_quantity),48);
 console.log('PASS: counted half bag plus two bags minus one ordered item, discrepancy saved before next reset');
 const stale=await route.POST(new Request('https://example.invalid/api/inventory',{method:'POST',body:JSON.stringify({action:'count',storeId:store,itemId:stock,quantity:99,countUnit:'個',expectedStockRevision:0})}));assert.equal(stale.status,409);assert.equal(Number((await db.query('select count(*) count from inventory_checks')).rows[0].count),2);
 console.log('PASS: stale concurrent count cannot duplicate history, movement, or overwrite book');
 await movement('e1','order_use',-2,'estimate',4);
 const estimated=await usage.getInventoryUsage(store,[product]);assert.equal(estimated.items[0].bookExpectedQuantity,48);assert.equal(estimated.items[0].forecastQuantity,46);
 const third=await count(46);assert.equal(third.reconciliation.expectedQuantity,46);assert.equal(third.reconciliation.difference,0);assert.equal(third.reconciliation.confidence,'estimated');
 console.log('PASS: estimates remain outside exact book but participate in labelled forecast reconciliation');
 await movement('u1','order_use',null,'unmeasured',10);const noModel=await usage.getInventoryUsage(store,[product]);assert.equal(noModel.items[0].forecastQuantity,null);
 const fourth=await count(44);assert.equal(fourth.reconciliation.expectedQuantity,null);assert.equal(fourth.reconciliation.difference,null);
 await movement('u2','order_use',null,'unmeasured',5);const learned=await usage.getInventoryUsage(store,[product]);assert.equal(learned.items[0].forecastQuantity,43);assert.equal(learned.items[0].forecastSource,'calibrated');
 const fifth=await count(43);assert.equal(fifth.reconciliation.expectedQuantity,43);assert.equal(fifth.reconciliation.difference,0);
 console.log('PASS: unmeasured ingredient learns from paired real counts and related order exposure, without inventing loss');
 await db.query('update inventory_items set stock_quantity=null,stock_revision=stock_revision+1 where id=$1',[stock]);await movement('unknown-receipt','receipt',null,'unmeasured',0,{balanceUnknown:true,quantityUnknown:true});
 const unknown=await usage.getInventoryUsage(store,[product]);assert.equal(unknown.items[0].forecastQuantity,null);const sixth=await count(5);assert.equal(sixth.reconciliation.expectedQuantity,null);assert.equal(sixth.reconciliation.difference,null);assert.equal(sixth.reconciliation.confidence,'unknown');
 console.log('PASS: unknown receiving balance remains unknown until an actual new count; comparison does not fabricate zero');
 await db.query('update inventory_items set current_quantity=7 where id=$1',[stock]);const detached=await usage.getInventoryUsage(store,[product]);assert.equal(detached.items[0].anchor,null);const restored=await count(7);assert.equal(restored.reconciliation.anchorCheckId,null);assert.equal(restored.reconciliation.expectedQuantity,null);
 const hidden=await usage.getInventoryUsage(store,[]);assert.equal(hidden.items.length,0);assert.equal(hidden.recentReconciliations.length,0);
 console.log('PASS: visible SKU filtering applies to forecasts and saved count reconciliations');
 console.log('PASS: a legacy or detached physical count cannot reuse an earlier order reconciliation origin');
 await db.exec(`insert into purchase_orders(id) values('${id(20)}');insert into purchase_order_items(id) values('${id(21)}');insert into inventory_stock_receipts(request_id,purchase_order_item_id,purchase_order_id,store_id,product_id,inventory_item_id,purchase_quantity,purchase_unit,count_quantity,count_unit,mode,conversion_snapshot,source_snapshot,request_payload,batch_packaging_snapshot)values('${id(22)}','${id(21)}','${id(20)}','${store}','${product}','${stock}',1,'袋',30,'個','add','{"purchaseUnit":"袋","countUnit":"個","unitsPerPurchase":30}','{}','{}','{"purchaseUnit":"袋","countUnit":"個","stockQuantityPerPurchase":30}');`);
 const revision=(await db.query('select stock_revision from inventory_items where id=$1',[stock])).rows[0].stock_revision;const mixed=await route.POST(new Request('https://example.invalid/api/inventory',{method:'POST',body:JSON.stringify({action:'count',storeId:store,itemId:stock,quantity:0.5,inputUnit:'袋',countUnit:'個',expectedStockRevision:revision})}));assert.equal(mixed.status,409);assert.equal((await mixed.json()).code,'batch_unit_identity_required');await count(7);
 console.log('PASS: mixed batch bag sizes reject ambiguous bag counting, while exact piece counts remain available');
 session=null;assert.equal((await route.POST(new Request('https://example.invalid/api/inventory',{method:'POST',body:'{}'}))).status,403);session={id:employee,role:'owner'};allowed=false;assert.equal((await route.POST(new Request('https://example.invalid/api/inventory',{method:'POST',body:JSON.stringify({action:'count',storeId:store})}))).status,403);
 console.log('PASS: unauthenticated and out-of-scope real count writes rejected');
}catch(error){console.error(error.message);if(error.params)console.error(JSON.stringify(error.params.map((v,i)=>({parameter:i+1,value:v}))));process.exitCode=1;}finally{await db.close();}
