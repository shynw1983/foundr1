// Recipe SQL in isolated PostgreSQL; never reads DATABASE_URL or contacts production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript');
const {PGlite}=await import(process.env.FOUNDR1_PGLITE_MODULE||'@electric-sql/pglite');
const root=new URL('../../',import.meta.url),db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(900+n).padStart(12,'0')}`;
const ids=Object.fromEntries(['store','otherStore','brand','otherBrand','employee','sku','secret','wrongSku','output','menu','secretMenu','wrongMenu','inactiveMenu'].map((key,i)=>[key,id(i+1)]));
let session={id:ids.employee,name:'Tester',role:'owner'},permission=true,queries=0;
let createPreflightBarrier=null;
const sql=Object.assign((parts,...values)=>({text:parts.reduce((text,part,i)=>text+part+(i<values.length?`$${i+1}`:''),''),values,then(resolve,reject){queries++;return db.query(this.text,this.values).then(async result=>{
 const barrier=createPreflightBarrier;if(barrier && this.text.includes('as "createRequestMatches"')){barrier.arrived++;if(barrier.arrived===2){createPreflightBarrier=null;barrier.release();}await barrier.ready;}return result.rows;
}).then(resolve,reject);}}),{transaction:statements=>db.transaction(async tx=>{const result=[];for(const statement of statements){queries++;result.push((await tx.query(statement.text,statement.values)).rows);}return result;})});
function load(path,modules={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,Request,URL,console,require:name=>{
 if(name==='node:crypto')return require(name);if(name.endsWith('/db')||name==='./db')return{sql};
 if(name.endsWith('/api-auth'))return{requireOsSession:async()=>session,canAccessStore:async(_,storeId)=>session.role==='owner'||storeId===ids.store,getSessionStoreScope:async()=>({allStores:session.role==='owner',storeIds:[ids.store]})};
 if(name.endsWith('/role-permissions'))return{roleHasPermission:async()=>permission};if(name in modules)return modules[name];throw Error(`Unmocked ${name}`);
}});return exports;}
let route;
const post=body=>route.POST(new Request('https://example.test/api/inventory/recipes',{method:'POST',body:JSON.stringify(body)}));
const get=()=>route.GET(new Request(`https://example.test/api/inventory/recipes?storeId=${ids.store}`));
const base=overrides=>({action:'save',requestId:randomUUID(),name:'Public recipe',brandId:ids.brand,kind:'menu',targetType:'item',targetId:ids.menu,outputProductId:null,expectedVersionId:null,snapshot:{basis:'serving',inputs:[{productId:ids.sku,quantity:1,unit:'g',mode:'estimate'}]},...overrides});
async function state(){const result={};for(const table of ['inventory_recipes','inventory_recipe_versions','inventory_recipe_version_products'])result[table]=(await db.query(`select * from ${table} order by ${table==='inventory_recipe_version_products'?'recipe_version_id,product_id':'id'}`)).rows;return result;}
async function reject(body,status,label){const before=await state(),response=await post(body);assert.equal(response.status,status,`${label}: ${await response.text()}`);assert.deepEqual(await state(),before,label);}
try{
 await db.exec(`create table stores(id uuid primary key,name text,status text default 'active');create table brands(id uuid primary key,name text);create table employees(id uuid primary key,name text);create table store_brands(store_id uuid,brand_id uuid);
 create table products(id uuid primary key,name text,unit text,package_quantity numeric,package_quantity_unit text,inventory_unit_conversions jsonb default '[]',brand_scope text default 'common',catalog_visibility text default 'brand_stores',is_orderable boolean default true);
 create table product_brand_usages(product_id uuid,brand_id uuid,is_orderable boolean);create table product_catalog_store_grants(product_id uuid,store_id uuid);
 create table menu_catalog_items(id uuid primary key,brand_id uuid,store_id uuid,name text,is_active boolean default true);create table menu_option_groups(id uuid primary key,brand_id uuid,menu_catalog_item_id uuid,is_active boolean default true);create table menu_options(id uuid primary key,option_group_id uuid,name text,is_active boolean default true);
 insert into stores(id,name) values('${ids.store}','A'),('${ids.otherStore}','B');insert into brands values('${ids.brand}','Brand'),('${ids.otherBrand}','Other');insert into employees values('${ids.employee}','Tester');insert into store_brands values('${ids.store}','${ids.brand}'),('${ids.otherStore}','${ids.otherBrand}');
 insert into products(id,name,unit,brand_scope,catalog_visibility) values('${ids.sku}','Ingredient','g','common','brand_stores'),('${ids.secret}','Secret ingredient','g','common','internal'),('${ids.wrongSku}','Other brand ingredient','g','specific','brand_stores'),('${ids.output}','Prepared output','g','common','brand_stores');
 insert into product_brand_usages values('${ids.wrongSku}','${ids.otherBrand}',true);
 insert into menu_catalog_items(id,brand_id,name,is_active) values('${ids.menu}','${ids.brand}','Menu',true),('${ids.secretMenu}','${ids.brand}','Second menu',true),('${ids.wrongMenu}','${ids.otherBrand}','Other menu',true),('${ids.inactiveMenu}','${ids.brand}','Inactive',false);`);
 const migration=readFileSync(new URL('db/migrations/20261011_inventory_recipes.sql',root),'utf8');await db.exec(migration);await db.exec(migration);
 const units=load('lib/product-unit-conversions.ts'),catalogPolicy=load('lib/product-catalog-policy.ts',{'./product-unit-conversions.ts':units}),catalog=load('lib/product-catalog-access.ts',{'./product-catalog-policy':catalogPolicy});
 const policy=load('lib/inventory-recipe-policy.ts',{'./product-unit-conversions':units}),data=load('lib/inventory-recipe-data.ts',{'./product-catalog-access':catalog,'./inventory-recipe-policy':policy});
 route=load('app/api/inventory/recipes/route.ts',{'../../../../lib/inventory-recipe-policy':policy,'../../../../lib/inventory-recipe-data':data});
 await reject(base({requestId:undefined}),400,'new creation requires stable request ID');
 const firstPayload=base();let response=await post(firstPayload);assert.equal(response.status,200,await response.clone().text());const first=(await response.json()).recipe;assert.equal(first.version,1);assert.equal(first.id,firstPayload.requestId);
 const createdState=await state();response=await post({...firstPayload,name:'  Public recipe  ',snapshot:{basis:'serving',inputs:[{productId:ids.sku,quantity:'1',unit:' g ',mode:'estimate'}]}});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).recipe.id,first.id);assert.deepEqual(await state(),createdState);
 await reject({...firstPayload,name:'Changed create'},409,'same request with changed creation facts');
 response=await post(base({id:first.id,expectedVersionId:first.currentVersionId,snapshot:{basis:'serving',inputs:[{productId:ids.sku,quantity:2,unit:'g',mode:'estimate'}]}}));assert.equal(response.status,200,await response.clone().text());const second=(await response.json()).recipe;assert.equal(second.version,2);assert.notEqual(second.currentVersionId,first.currentVersionId);
 await reject(base({id:first.id,expectedVersionId:first.currentVersionId}),409,'stale save');
 response=await post({action:'inactivate',id:first.id,expectedVersionId:second.currentVersionId});assert.equal(response.status,200);const inactive=(await response.json()).recipe;assert.equal(inactive.version,3);assert.equal(inactive.status,'inactive');await reject(base({id:first.id,expectedVersionId:second.currentVersionId}),409,'stale reactivation');
 const laterState=await state();response=await post(firstPayload);assert.equal(response.status,200,await response.clone().text());const replayed=(await response.json()).recipe;assert.equal(replayed.id,first.id);assert.equal(replayed.version,3);assert.equal(replayed.status,'inactive');assert.deepEqual(await state(),laterState,'create replay never restores old version or status');
 console.log('PASS: repeated migration, create/new immutable versions, stale save and stale post-inactivation editor reject without writes');
 const productionPayload=base({name:'Idempotent production',kind:'production',targetType:null,targetId:null,outputProductId:ids.output,snapshot:{basis:'measured',measuredUnit:'g',inputs:[{productId:ids.sku,quantity:2,unit:'g',mode:'exact'}],output:{productId:ids.output,quantity:1,unit:'g'}}});
 let release;const ready=new Promise(resolve=>{release=resolve;});createPreflightBarrier={arrived:0,ready,release};
 const raced=await Promise.all([post(productionPayload),post(productionPayload)]);assert.deepEqual(raced.map(response=>response.status),[200,200]);const racedBodies=await Promise.all(raced.map(response=>response.json()));assert.equal(racedBodies[0].recipe.id,productionPayload.requestId);assert.equal(racedBodies[1].recipe.id,productionPayload.requestId);
 assert.equal((await db.query('select count(*)::int as count from inventory_recipes where id=$1',[productionPayload.requestId])).rows[0].count,1);assert.equal((await db.query('select count(*)::int as count from inventory_recipe_versions where recipe_id=$1',[productionPayload.requestId])).rows[0].count,1);
 assert.equal((await db.query('select count(*)::int as count from inventory_recipe_version_products where recipe_version_id=$1',[racedBodies[0].recipe.currentVersionId])).rows[0].count,2);
 const conflictPayload=base({...productionPayload,requestId:randomUUID()});let releaseConflict;const conflictReady=new Promise(resolve=>{releaseConflict=resolve;});createPreflightBarrier={arrived:0,ready:conflictReady,release:releaseConflict};
 const conflicts=await Promise.all([post(conflictPayload),post({...conflictPayload,name:'Different frozen request'})]);assert.deepEqual(conflicts.map(response=>response.status).sort(),[200,409]);assert.equal((await db.query('select count(*)::int as count from inventory_recipe_versions where recipe_id=$1',[conflictPayload.requestId])).rows[0].count,1);
 console.log('PASS: normalized create retries and stale-preflight create/create guards keep one recipe/version; changed same nonce rejects and later revision remains untouched');
 const immutableState=await state();await assert.rejects(db.query('update inventory_recipe_versions set snapshot=$1::jsonb where id=$2',[JSON.stringify({basis:'serving',inputs:[]}),first.currentVersionId]),error=>error.code==='23000');await assert.rejects(db.query('delete from inventory_recipe_versions where id=$1',[first.currentVersionId]),error=>error.code==='23000');await assert.rejects(db.query('delete from products where id=$1',[ids.sku]),error=>['23001','23503'].includes(error.code));assert.deepEqual(await state(),immutableState);
 console.log('PASS: published version UPDATE/DELETE and used-SKU deletion are blocked with history preserved');
 await reject(base({name:'Wrong SKU',targetId:ids.secretMenu,snapshot:{basis:'serving',inputs:[{productId:ids.wrongSku,quantity:1,unit:'g',mode:'exact'}]}}),409,'cross-brand SKU');await reject(base({targetId:ids.wrongMenu}),409,'cross-brand target');await reject(base({targetId:ids.inactiveMenu}),409,'inactive target');
 await reject(base({kind:'production',targetType:null,targetId:null,outputProductId:ids.output,snapshot:{basis:'measured',measuredUnit:'g',inputs:[],output:{productId:ids.output,quantity:1,unit:'g'}}}),400,'production requires inputs');
 response=await post(base({name:'No own consumption',targetId:ids.menu,snapshot:{basis:'serving',inputs:[]}}));assert.equal(response.status,200,await response.clone().text());
 console.log('PASS: exact brand/active target validation and explicit empty menu consumption, with manufacturing inputs required');
 response=await post(base({name:'Secret formula',targetId:ids.secretMenu,snapshot:{basis:'serving',inputs:[{productId:ids.secret,quantity:1,unit:'g',mode:'exact'}]}}));assert.equal(response.status,200,await response.clone().text());
 session={...session,role:'store_manager'};const scoped=await (await get()).json();assert.equal(scoped.canManage,false);assert.ok(!JSON.stringify(scoped).includes(ids.secret));assert.ok(!JSON.stringify(scoped).includes('Secret formula'));assert.ok(!JSON.stringify(scoped).includes('Other brand ingredient'));assert.ok(scoped.recipes.some(recipe=>recipe.name==='No own consumption'));
 const beforeDenied=queries;assert.equal((await post(base())).status,403);assert.equal(queries,beforeDenied);permission=false;assert.equal((await get()).status,403);assert.equal(queries,beforeDenied);
 console.log('PASS: hidden formulas/SKUs and foreign brands redacted; non-HQ edits and revoked module access deny before SQL');
}finally{await db.close();}
