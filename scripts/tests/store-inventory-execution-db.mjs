// Actual Store handlers and shared stock SQL. Identity proof itself is exercised in store-inventory-identity-db.mjs.
// This fixture supplies a verified actor, never loads production credentials.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const {PGlite}=await import(process.env.FOUNDR1_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite(),root=new URL('../../',import.meta.url);
const id=n=>`00000000-0000-4000-8000-${String(2000+n).padStart(12,'0')}`;
const store=id(1),product=id(2),loc=id(3),stock=id(4),employee=id(5),brand=id(6);
let session={id:employee,name:'Tester',role:'owner'},allowed=true,afterStockRead=null;
const sql=Object.assign((parts,...values)=>({text:parts.reduce((s,p,i)=>s+p+(i<values.length?`$${i+1}`:''),''),values,then(resolve,reject){return db.query(this.text,this.values).then(async r=>{if(afterStockRead&&/select items\.id, items\.store_id::text/.test(this.text)){const hook=afterStockRead;afterStockRead=null;await hook();}return r.rows;}).then(resolve,reject);}}),{transaction:queries=>db.transaction(async tx=>{const rows=[];for(const q of queries)rows.push((await tx.query(q.text,q.values)).rows);return rows;})});
function load(path,modules={}){
  if(path==='app/api/inventory/route.ts') {
    const sharedModules=Object.fromEntries(Object.entries(modules).map(([name,value])=>[name.replace('../../../lib/','./'),value]));
    modules={...modules,'../../../lib/inventory-execution-data':load('lib/inventory-execution-data.ts',sharedModules)};
  }
const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,Request,URL,Date,console,require:name=>{
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
 const count=async (quantity,inputUnit='個')=>{const row=(await db.query('select stock_revision from inventory_items where id=$1',[stock])).rows[0];const r=await route.POST(new Request('https://example.invalid/api/inventory',{method:'POST',body:JSON.stringify({action:'count',storeId:store,itemId:stock,quantity,inputUnit,countUnit:'個',expectedInputConversion:units.resolveProductUnitConversion({unit:'袋',packageQuantity:20,packageQuantityUnit:'個'},inputUnit),expectedStockRevision:row.stock_revision,expectedConversion:{purchaseUnit:'袋',countUnit:'個',unitsPerPurchase:20}})}));assert.equal(r.status,200,await r.clone().text());return(await r.json()).count;};

 await db.exec("alter table inventory_locations add column equipment_brand text default '',add column equipment_name text default '',add column position_name text default '',add column location_type text default 'freezer';");
 const shared=load('lib/inventory-execution-data.ts',{'./inventory-count-input-policy':countInputs,'./product-unit-conversions':units,'./inventory-quick-policy':quick});
 const identityPolicy=load('lib/store-inventory-policy.ts');
 const authority=load('lib/store-inventory-access.ts',{'next/headers':{cookies:async()=>({get:()=>null})},'./store-inventory-policy':identityPolicy,'./store-inventory-operator-token':{readStoreInventoryOperatorToken:()=>({value:null,expired:false}),storeInventoryOperatorCookieName:'test-operator'}});
 const base={id:employee,name:'Terminal',role:'store_terminal',sessionId:id(77)};
 let actor={id:employee,name:'Tester',role:'staff'},permitted=true;
 const storeRoute=load('app/api/store/inventory/route.ts',{'../../../../lib/inventory-execution-data':shared,'../../../../lib/store-inventory-access':{
  ...authority,requireStoreInventoryAccess:async(storeId,action)=>{
   if(!permitted||storeId!==store)return authority.storeInventoryFailure('scope denied',403,'store_scope');
   if(!actor&&action!=='read')return authority.storeInventoryFailure('verify actor',401,'operator_required');
   return{ok:true,baseSession:base,actor,storeId,operator:actor?{id:actor.id,name:actor.name,role:actor.role,expiresAt:null}:null};
  }
 }});
 const payload=async(quantity)=>({action:'count',storeId:store,itemId:stock,quantity,inputUnit:'袋',countUnit:'個',expectedInputConversion:{purchaseUnit:'袋',countUnit:'袋',unitsPerPurchase:1},expectedConversion:{purchaseUnit:'袋',countUnit:'個',unitsPerPurchase:20},expectedStockRevision:(await db.query('select stock_revision from inventory_items where id=$1',[stock])).rows[0].stock_revision,expectedOperatorId:employee});
 const post=(body,origin='https://example.invalid')=>storeRoute.POST(new Request('https://example.invalid/api/store/inventory',{method:'POST',headers:origin?{origin}:undefined,body:JSON.stringify(body)}));
 const get=()=>storeRoute.GET(new Request(`https://example.invalid/api/store/inventory?storeId=${store}`));
 const facts=async()=>({stock:(await db.query('select * from inventory_items order by id')).rows,checks:(await db.query('select * from inventory_checks order by id')).rows,movements:(await db.query('select * from inventory_movements order by id')).rows});
 actor=null;let response=await get();assert.equal(response.status,200);let view=await response.json();assert.equal(view.canOperate,false);assert.equal('products'in view,false);assert.equal('stores'in view,false);
 let before=await facts();assert.equal((await post(await payload(0.5))).status,401);assert.deepEqual(await facts(),before);
 actor={id:employee,name:'Tester',role:'staff'};
 assert.equal((await post(await payload(0.5),'https://foreign.invalid')).status,403);assert.equal((await post(await payload(0.5),null)).status,403);
 assert.equal((await post({...await payload(0.5),expectedOperatorId:id(66)})).status,409);permitted=false;assert.equal((await post(await payload(0.5))).status,403);permitted=true;assert.deepEqual(await facts(),before);
 console.log('PASS: shared terminal reads only operational facts; missing/changed actor, Origin and scope reject before writes');
 for(const action of ['configure','save_location','archive_location','batch_low_stock'])assert.equal((await post({...await payload(0.5),action})).status,403);
 assert.equal((await post({...await payload(0.5),action:'exception',exceptionCode:''})).status,403);
 const omitted=await payload(0.5);delete omitted.expectedConversion;assert.equal((await post(omitted)).status,409);assert.deepEqual(await facts(),before);
 session={id:employee,role:'staff'};assert.equal((await route.POST(new Request('https://example.invalid/api/inventory',{method:'POST',body:JSON.stringify(await payload(0.5))}))).status,403);
 session={id:employee,role:'store_terminal'};assert.equal((await route.POST(new Request('https://example.invalid/api/inventory',{method:'POST',body:JSON.stringify(await payload(0.5))}))).status,403);session={id:employee,role:'owner'};
 console.log('PASS: Store execution grants do not enable OS or master writes and counts require explicit current facts');
 const draft=await payload(0.5);response=await post(draft);assert.equal(response.status,200,await response.clone().text());let saved=(await db.query('select * from inventory_items where id=$1',[stock])).rows[0];assert.equal(Number(saved.stock_quantity),10);assert.equal(Number(saved.current_quantity),10);assert.equal(saved.last_counted_by,employee);assert.equal(saved.exception_code,'quality');
 assert.equal((await post(draft)).status,409);assert.equal((await db.query('select count(*) n from inventory_checks')).rows[0].n,1);
 const movement=(await db.query('select * from inventory_movements')).rows[0];assert.equal(movement.metadata.countQuantity,10);
 console.log('PASS: staff half-bag actual count atomically records actor, physical origin, book and history; duplicate stale count is rejected');
 view=await(await get()).json();let item=view.items[0];before=await facts();response=await post({action:'batch_quick_check',storeId:store,expectedOperatorId:employee,checks:[{itemId:stock,status:'enough',expectedBasis:item.quickCheckBasis}]});assert.equal(response.status,200,await response.clone().text());saved=(await db.query('select * from inventory_items where id=$1',[stock])).rows[0];assert.equal(saved.current_quantity,before.stock[0].current_quantity);assert.equal(saved.stock_quantity,before.stock[0].stock_quantity);assert.deepEqual(saved.last_counted_at,before.stock[0].last_counted_at);assert.equal(saved.quick_checked_by,employee);assert.equal(saved.exception_code,'quality');
 console.log('PASS: employee rough observations do not change physical count, exact book or outstanding quality');
 view=await(await get()).json();item=view.items[0];const report={action:'exception',storeId:store,itemId:stock,expectedOperatorId:employee,expectedStockRevision:item.stockRevision,expectedQuickRevision:item.quickCheckBasis.quickRevision,exceptionCode:'quality',note:'new actual finding'};response=await post(report);assert.equal(response.status,200,await response.clone().text());const last=(await db.query("select * from inventory_checks where record_type='exception'")).rows[0];assert.equal(last.recorded_by,employee);assert.equal(last.note,'new actual finding');
 assert.equal((await post(report)).status,409);view=await(await get()).json();item=view.items[0];assert.equal((await post({...report,expectedQuickRevision:item.quickCheckBasis.quickRevision,exceptionCode:'too_much'})).status,409);
 console.log('PASS: reports retain real employee identity; stale findings and replacement of quality flags require review');
 before=await facts();await db.exec("create function fail_stock_report()returns trigger language plpgsql as $$begin if new.note='forced failure' then raise exception 'deliberate report failure';end if;return new;end$$;create trigger reject_stock_report before insert on inventory_checks for each row execute function fail_stock_report();");
 response=await post({...report,expectedQuickRevision:item.quickCheckBasis.quickRevision,note:'forced failure'});assert.equal(response.status,503);assert.deepEqual(await facts(),before);await db.exec('drop trigger reject_stock_report on inventory_checks;drop function fail_stock_report();');
 console.log('PASS: a persistence failure rolls back flag/history and returns a retryable service response');
 await db.query('update products set inventory_unit_conversions=$1::jsonb where id=$2',[JSON.stringify([{unit:'箱',unitsPerPurchase:0.5}]),product]);
 view=await(await get()).json();const auxiliaryDraft={...await payload(1),inputUnit:'箱',expectedInputConversion:view.items[0].unitChoices.find(choice=>choice.countUnit==='箱')};
 assert.equal(auxiliaryDraft.expectedInputConversion.unitsPerPurchase,0.5);
 await db.query('update products set inventory_unit_conversions=$1::jsonb where id=$2',[JSON.stringify([{unit:'箱',unitsPerPurchase:0.25}]),product]);before=await facts();
 response=await post(auxiliaryDraft);assert.equal(response.status,409,'A stale auxiliary input unit must not be reinterpreted with a new factor');assert.deepEqual(await facts(),before);
 const freshAuxiliary={...await payload(1),inputUnit:'箱',expectedInputConversion:{purchaseUnit:'袋',countUnit:'箱',unitsPerPurchase:0.25}};
 const missingAuxiliary={...freshAuxiliary};delete missingAuxiliary.expectedInputConversion;assert.equal((await post(missingAuxiliary)).status,409);assert.deepEqual(await facts(),before);
 response=await post(freshAuxiliary);assert.equal(response.status,200,await response.clone().text());assert.equal(Number((await db.query('select current_quantity from inventory_items where id=$1',[stock])).rows[0].current_quantity),80);
 console.log('PASS: changing only an auxiliary input-unit factor rejects the original draft without reinterpreting the physical quantity');
 await db.query('update products set inventory_unit_conversions=$1::jsonb where id=$2',[JSON.stringify([{unit:'箱',unitsPerPurchase:0.5}]),product]);
 const duringRead={...await payload(1),inputUnit:'箱',expectedInputConversion:{purchaseUnit:'袋',countUnit:'箱',unitsPerPurchase:0.5}};before=await facts();
 afterStockRead=()=>db.query('update products set inventory_unit_conversions=$1::jsonb where id=$2',[JSON.stringify([{unit:'箱',unitsPerPurchase:0.25}]),product]);
 response=await post(duringRead);assert.equal(response.status,409);assert.equal(afterStockRead,null);assert.deepEqual(await facts(),before);
 const literal={...await payload(5),inputUnit:'個'};delete literal.expectedInputConversion;
 response=await route.POST(new Request('https://example.invalid/api/inventory',{method:'POST',body:JSON.stringify(literal)}));assert.equal(response.status,200,await response.clone().text());
 console.log('PASS: unit changes after preflight also conflict inside the stock transaction; existing literal-unit OS clients remain compatible');
 console.log('Store inventory execution database: 8 groups passed');
}catch(error){console.error(error.message);process.exitCode=1;}finally{await db.close();}
