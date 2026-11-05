// Actual scoped menu API and runtime projection against isolated PostgreSQL; no live writes.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createDineInMenuFixture,fixtureUuid as uuid} from './store-dine-in-menu-fixture.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-fulfillment-db');await mkdir(output,{recursive:true});
const f=await createDineInMenuFixture(source);await f.installMigration();const {db,ids}=f,results=[];let nextOp=96000;
const json=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,await r.clone().text());return r.json();};
const read=()=>json(f.getMenu());
const edit=(menu,change,status=200)=>json(f.mutateMenu({revision:menu.revision,operationId:uuid(nextOp++),...change}),status);
const check=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
const policy=f.load('lib/store-dine-in-menu-policy.ts'),runtime=f.load('lib/store-dine-in-runtime.ts');
const mode=(menu,itemId)=>policy.resolveDineInItemFulfillmentMode(menu.catalog,menu.catalog.items.find(x=>x.id===itemId));
const clone=x=>JSON.parse(JSON.stringify(x));
try{
 let menu=await edit({revision:''},{action:'initialize',mode:'empty'});
 for(const name of ['調味料','飲料','麻辣湯'])menu=await edit(menu,{action:'createCategory',name});
 const cat=name=>menu.catalog.categories.find(x=>x.name===name);
 menu=await edit(menu,{action:'createItem',name:'香味だれ',categoryId:cat('調味料').id,itemKind:'fixed_product',price:100});const seasoningId=menu.catalog.items.at(-1).id;
 menu=await edit(menu,{action:'createItem',name:'缶のお茶',categoryId:cat('飲料').id,itemKind:'drink',price:250});const drinkId=menu.catalog.items.at(-1).id;
 menu=await edit(menu,{action:'createItem',name:'麻辣湯',categoryId:cat('麻辣湯').id,itemKind:'buildable_product',price:0,pricingMode:'weight'});const bowlId=menu.catalog.items.at(-1).id;
 menu=await edit(menu,{action:'setEnabled',enabled:true});
 const mastersBefore=await f.masterSnapshot(),groupsBefore=clone(menu.catalog.optionGroups);
 await check('old-missing-fields-default-to-preparation-without-writing-defaults',async()=>{
  for(const item of menu.catalog.items){assert.equal(mode(menu,item.id),'prepare');assert(!Object.hasOwn(item,'fulfillmentMode'));}
  for(const category of menu.catalog.categories)assert(!Object.hasOwn(category,'fulfillmentMode'));
 });
 await check('category-mode-inherits-live-and-fixed-items-can-override-then-inherit-again',async()=>{
  menu=await edit(menu,{action:'setFulfillmentMode',kind:'category',targetId:cat('調味料').id,fulfillmentMode:'immediate'});assert.equal(mode(menu,seasoningId),'immediate');assert.equal(mode(menu,drinkId),'prepare');
  menu=await edit(menu,{action:'setFulfillmentMode',kind:'item',targetId:seasoningId,fulfillmentMode:'prepare'});assert.equal(mode(menu,seasoningId),'prepare');
  menu=await edit(menu,{action:'setFulfillmentMode',kind:'item',targetId:seasoningId,fulfillmentMode:'inherit'});assert.equal(mode(menu,seasoningId),'immediate');assert(!Object.hasOwn(menu.catalog.items.find(x=>x.id===seasoningId),'fulfillmentMode'));
  menu=await edit(menu,{action:'setFulfillmentMode',kind:'category',targetId:cat('調味料').id,fulfillmentMode:'inherit'});assert.equal(mode(menu,seasoningId),'prepare');assert(!Object.hasOwn(cat('調味料'),'fulfillmentMode'));
 });
 await check('new-items-and-category-moves-inherit-the-category-with-explicit-item-override-precedence',async()=>{
  menu=await edit(menu,{action:'setFulfillmentMode',kind:'category',targetId:cat('飲料').id,fulfillmentMode:'immediate'});
  menu=await edit(menu,{action:'createItem',name:'瓶の水',categoryId:cat('飲料').id,itemKind:'drink',price:180});assert.equal(mode(menu,menu.catalog.items.at(-1).id),'immediate');
  menu=await edit(menu,{action:'setItemCategory',targetId:seasoningId,categoryId:cat('飲料').id});assert.equal(mode(menu,seasoningId),'immediate');
  menu=await edit(menu,{action:'setFulfillmentMode',kind:'item',targetId:seasoningId,fulfillmentMode:'prepare'});assert.equal(mode(menu,seasoningId),'prepare');
 });
 await check('bowls-reject-explicit-immediate-and-category-immediate-but-read-malformed-legacy-data-safely',async()=>{
  const snapshot=clone(menu);await edit(menu,{action:'setFulfillmentMode',kind:'item',targetId:bowlId,fulfillmentMode:'immediate'},400);
  await edit(menu,{action:'setFulfillmentMode',kind:'category',targetId:cat('麻辣湯').id,fulfillmentMode:'immediate'},400);assert.deepEqual((await read()).catalog,snapshot.catalog);
  const corrupt=clone(menu.catalog);corrupt.items.find(x=>x.id===bowlId).fulfillmentMode='immediate';corrupt.categories.find(x=>x.name==='麻辣湯').fulfillmentMode='immediate';assert.equal(policy.resolveDineInItemFulfillmentMode(corrupt,corrupt.items.find(x=>x.id===bowlId)),'prepare');
 });
 await check('same-category-name-in-other-brand-cannot-affect-inheritance',async()=>{
  const catalog=clone(menu.catalog);catalog.categories.unshift({id:uuid(98001),brandId:ids.secondBrand,name:'麻辣湯',sortOrder:0,fulfillmentMode:'immediate'});
  const item={...catalog.items.find(x=>x.id===seasoningId),category:'麻辣湯',fulfillmentMode:undefined};assert.equal(policy.resolveDineInItemFulfillmentMode(catalog,item),'prepare');
 });
 await check('mode-saves-are-idempotent-revision-guarded-and-strictly-field-scoped',async()=>{
  const command={action:'setFulfillmentMode',kind:'item',targetId:drinkId,fulfillmentMode:'prepare',revision:menu.revision,operationId:uuid(nextOp++)};
  const previous=clone(menu);menu=await json(f.mutateMenu(command));const replay=await json(f.mutateMenu(command));assert.deepEqual(replay.catalog,menu.catalog);
  await json(f.mutateMenu({...command,fulfillmentMode:'immediate'}),409);await edit(previous,{action:'setFulfillmentMode',kind:'item',targetId:drinkId,fulfillmentMode:'immediate'},409);
  for(const patch of[{kind:'group'},{fulfillmentMode:'skip'},{fulfillmentMode:true},{price:0},{enabled:false}])await edit(menu,{action:'setFulfillmentMode',kind:'item',targetId:drinkId,fulfillmentMode:'prepare',...patch},400);
  const current=await read();assert.deepEqual(current.catalog,menu.catalog);
 });
 await check('unauthorized-and-cross-store-writes-do-not-change-menu',async()=>{
  const command={action:'setFulfillmentMode',kind:'item',targetId:drinkId,fulfillmentMode:'immediate'};
  f.state.permitted=false;await edit(menu,command,403);f.state.permitted=true;
  await edit(menu,{...command,storeId:ids.other},403);await json(f.mutateMenu({revision:menu.revision,operationId:uuid(nextOp++),...command},{origin:'https://foreign.invalid'}),403);assert.deepEqual((await read()).catalog,menu.catalog);
 }).catch(async error=>{throw error;});
 await check('duplicate-archive-restore-and-category-rename-retain-store-fulfillment-definitions',async()=>{
  menu=await edit(menu,{action:'duplicate',kind:'item',targetId:seasoningId,name:'香味だれ別版'});const copied=menu.catalog.items.find(x=>x.name==='香味だれ別版');assert.equal(copied.fulfillmentMode,'prepare');
  menu=await edit(menu,{action:'delete',kind:'item',targetId:copied.id});const entry=menu.catalog.trash.find(x=>x.targetId===copied.id);
  menu=await edit(menu,{action:'restore',targetId:entry.id});assert.equal(menu.catalog.items.find(x=>x.id===copied.id).fulfillmentMode,'prepare');
  const category=cat('飲料');menu=await edit(menu,{action:'rename',kind:'category',targetId:category.id,name:'飲料・酒'});assert.equal(menu.catalog.categories.find(x=>x.id===category.id).fulfillmentMode,'immediate');assert.equal(menu.catalog.items.find(x=>x.id===drinkId).category,'飲料・酒');
 });
 await check('runtime-exposes-effective-item-and-linked-option-mode-with-raw-inheritance-preserved',async()=>{
  menu=await edit(menu,{action:'setFulfillmentMode',kind:'item',targetId:drinkId,fulfillmentMode:'inherit'});
  menu=await edit(menu,{action:'createOptionGroup',itemId:bowlId,name:'一緒に選ぶ飲料',selectionType:'quantity'});const group=menu.catalog.optionGroups.at(-1);
  menu=await edit(menu,{action:'linkItemOptions',targetId:group.id,itemIds:[drinkId]});
  const config=await f.load('lib/store-dine-in-menu.ts').readDineInMenus(ids.store),view=await runtime.resolveDineInCatalog(ids.store,config);
  assert.equal(view.items.find(x=>x.id===drinkId).fulfillmentMode,'immediate');assert.equal(view.items.find(x=>x.id===bowlId).fulfillmentMode,'prepare');
  const option=runtime.flattenDineInOptions(view).find(x=>x.linkedItemId===drinkId);assert.equal(option.fulfillmentMode,'immediate');assert.equal(option.priceDelta,250);
  assert(!Object.hasOwn(menu.catalog.items.find(x=>x.id===drinkId),'fulfillmentMode'));
 });
 await check('menu-mode-edit-preserves-prices-options-and-shared-website-delivery-masters',async()=>{
  assert.equal(menu.catalog.items.find(x=>x.id===seasoningId).price,100);assert.equal(menu.catalog.items.find(x=>x.id===drinkId).price,250);
  const after=await f.masterSnapshot();for(const table of Object.keys(mastersBefore)){
   if(table==='menu_catalog_items'){const before=mastersBefore[table],byId=new Map(after[table].map(x=>[x.id,x]));for(const row of before)assert.deepEqual(byId.get(row.id),row);}
   else assert.deepEqual(after[table],mastersBefore[table]);
  }
  assert.deepEqual(groupsBefore,[]);
 });
 await writeFile(join(output,'report.json'),JSON.stringify({passed:results.length,results,isolatedPostgreSQL:true,actualMenuApi:true,actualRuntimeProjection:true,productionWrites:0},null,2)+'\n');console.log(JSON.stringify({passed:results.length}));
}finally{await db.close();}
