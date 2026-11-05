// Actual OS menu/public catalog handlers + real SQL on isolated in-memory PostgreSQL.
// No production credentials, HTTP requests, printer or inventory side effects.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDineInMenuFixture, fixtureUuid as uuid } from './store-dine-in-menu-fixture.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs,value,i,values)=>{if(value.startsWith('--'))pairs.push([value.slice(2),values[i+1]]);return pairs;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-menu-db');
await mkdir(output,{recursive:true});
const f=await createDineInMenuFixture(source), {db,ids,state,getMenu,mutateMenu,masterSnapshot}=f;
const groups=[]; let nextOperation=4000;
const op=()=>uuid(nextOperation++);
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const itemBySource=(menu,id)=>menu.catalog.items.find(item=>item.sourceItemId===id);
const groupBySource=(menu,id)=>menu.catalog.optionGroups.find(group=>group.sourceGroupId===id);
const optionBySource=(menu,id)=>menu.catalog.optionGroups.flatMap(group=>group.options).find(option=>option.sourceOptionId===id);
const mutate=async(menu,change,status=200)=>json(await mutateMenu({revision:menu.revision,operationId:op(),...change}),status);
const publicRoute=f.load('app/api/public/menus/route.ts');
const publicMenu=async(store=false)=>{const data=await json(await publicRoute.GET(f.request(`/api/public/menus?brand=${ids.brand}${store?`&store=${ids.store}`:''}`)));delete data.generatedAt;return data;};
const menuCount=async()=>Number((await db.query('select count(*)::int as n from store_dine_in_menus')).rows[0].n);
const operationCount=async()=>Number((await db.query('select count(*)::int as n from store_dine_in_menu_operations')).rows[0].n);
try {
  const before=await masterSnapshot(), publicBefore=await publicMenu(), publicStoreBefore=await publicMenu(true);
  const missing=await json(await getMenu()); assert.equal(missing.ready,false);assert.equal(missing.exists,false);
  await json(await mutateMenu({action:'initialize',operationId:op(),revision:''}),503);
  groups.push({name:'absent-schema-management-reports-unavailable-and-cannot-initialize',passed:true});

  await db.query(`insert into store_customer_orders(id,pickup_code,pickup_date,pickup_time,status,payment_status,amount) values($1,'HIST',current_date,'12:00','completed','paid',1234)`,[uuid(3990)]);
  await f.installMigration();
  assert.equal((await db.query('select amount::int as amount from store_customer_orders where id=$1',[uuid(3990)])).rows[0].amount,1234);
  assert.equal(await menuCount(),0);assert.equal(await operationCount(),0);assert.deepEqual(await masterSnapshot(),before);
  groups.push({name:'additive-migration-applies-twice-preserves-paid-order-and-initializes-no-store',passed:true});

  const session=state.session;
  state.session=null;await json(await getMenu(),401);await json(await mutateMenu({action:'initialize',operationId:op(),revision:''}),401);state.session=session;
  state.permitted=false;await json(await getMenu(),403);state.permitted=true;
  await json(await getMenu(ids.other),403);await json(await getMenu(ids.store,ids.otherBrand),403);
  await json(await mutateMenu({storeId:ids.other,action:'initialize',operationId:op(),revision:''}),403);
  await json(await mutateMenu({brandId:ids.otherBrand,action:'initialize',operationId:op(),revision:''}),403);
  await json(await mutateMenu({action:'initialize',operationId:op(),revision:''},{origin:'https://foreign.invalid'}),403);
  await json(await mutateMenu({action:'initialize',operationId:op(),revision:''},{'sec-fetch-site':'cross-site'}),403);
  assert.equal(await menuCount(),0);
  groups.push({name:'authentication-permission-store-brand-and-csrf-denials-never-write',passed:true});

  const preview=await json(await getMenu());assert.equal(preview.exists,false);assert.equal(preview.revision,'');assert.equal(preview.enabled,false);
  const sourceItem=preview.source.items.find(item=>item.id===ids.menu);assert.ok(sourceItem);assert.equal(sourceItem.price,600);assert.equal(sourceItem.posWeightUnitPrice,4);assert.equal(sourceItem.posWeightUnit,'g');
  assert.equal(preview.source.items.find(item=>item.id===ids.hiddenItem).visible,false);assert.ok(!preview.source.items.some(item=>item.id===ids.pseudoItem));
  const sourcePremium=preview.source.optionGroups.find(group=>group.id===ids.premiumGroup);assert.equal(sourcePremium.posEnabled,true);assert.equal(sourcePremium.ruleJson.portionGrams,50);
  assert.equal(sourcePremium.options.find(option=>option.id===ids.beef).priceDelta,650);assert.equal(sourcePremium.options.find(option=>option.id===ids.hiddenOption).visible,false);
  assert.equal(await menuCount(),0);
  groups.push({name:'read-only-preview-preserves-effective-pos-overrides-hidden-targets-and-50g-rules',passed:true});

  // Mutate the source after the handler reads it but before its write transaction.
  const originalTransaction=f.sql.transaction;
  f.sql.transaction=async statements=>{await db.query('update menu_catalog_items set base_price=base_price+1 where id=$1',[ids.menu]);return originalTransaction(statements);};
  await json(await mutateMenu({action:'initialize',operationId:op(),revision:''}),409);
  f.sql.transaction=originalTransaction;await db.query('update menu_catalog_items set base_price=base_price-1 where id=$1',[ids.menu]);
  assert.equal(await menuCount(),0);assert.equal(await operationCount(),0);
  groups.push({name:'source-change-between-copy-and-transaction-rejects-without-partial-catalog',passed:true});

  const initialization={action:'initialize',operationId:op(),revision:''};
  let menu=await json(await mutateMenu(initialization));assert.equal(menu.exists,true);assert.equal(menu.enabled,true);assert.equal(menu.revision,'1');assert.equal(await menuCount(),1);
  const item=itemBySource(menu,ids.menu),soup=groupBySource(menu,ids.optionGroup),premium=groupBySource(menu,ids.premiumGroup),beef=optionBySource(menu,ids.beef);
  assert.notEqual(item.id,ids.menu);assert.notEqual(soup.id,ids.optionGroup);assert.notEqual(beef.id,ids.beef);assert.equal(soup.menuCatalogItemId,item.id);assert.ok(item.optionGroupIds.includes(soup.id));assert.ok(item.optionGroupIds.includes(premium.id));
  assert.equal(item.price,600);assert.equal(beef.priceDelta,650);assert.equal(premium.ruleJson.portionGrams,50);assert.equal(itemBySource(menu,ids.hiddenItem).visible,false);
  assert.deepEqual(item.displayNames,{en:'Original bowl',zh:'原名'});assert.deepEqual(await masterSnapshot(),before);assert.deepEqual(await publicMenu(),publicBefore);assert.deepEqual(await publicMenu(true),publicStoreBefore);
  const replay=await json(await mutateMenu(initialization));assert.equal(replay.revision,menu.revision);assert.deepEqual(replay.catalog,menu.catalog);assert.equal(await operationCount(),1);
  await json(await mutateMenu({...initialization,enabled:false}),409);
  await json(await mutateMenu({action:'initialize',operationId:op(),revision:''}),409);
  groups.push({name:'one-time-local-identities-and-idempotent-initialization-leave-public-and-source-catalogs-identical',passed:true});

  const initialCatalog=structuredClone(menu.catalog);
  menu=await mutate(menu,{action:'rename',kind:'item',targetId:item.id,name:'店内専用 麻辣湯'});
  menu=await mutate(menu,{action:'rename',kind:'group',targetId:soup.id,name:'店内の味'});
  menu=await mutate(menu,{action:'rename',kind:'option',targetId:beef.id,name:'店内牛筋 50g'});
  assert.equal(itemBySource(menu,ids.menu).name,'店内専用 麻辣湯');assert.deepEqual(itemBySource(menu,ids.menu).displayNames,{});
  assert.equal(groupBySource(menu,ids.optionGroup).name,'店内の味');assert.deepEqual(groupBySource(menu,ids.optionGroup).displayNames,{});
  assert.equal(optionBySource(menu,ids.beef).name,'店内牛筋 50g');assert.deepEqual(optionBySource(menu,ids.beef).displayNames,{});
  assert.equal(itemBySource(menu,ids.menu).price,initialCatalog.items.find(x=>x.id===item.id).price);assert.equal(optionBySource(menu,ids.beef).priceDelta,650);
  assert.deepEqual(await masterSnapshot(),before);assert.deepEqual(await publicMenu(),publicBefore);assert.deepEqual(await publicMenu(true),publicStoreBefore);
  groups.push({name:'item-group-option-renames-clear-stale-translations-and-preserve-price-spec-and-public-output',passed:true});

  const previous=menu;menu=await mutate(menu,{action:'duplicate',kind:'item',targetId:item.id,name:'店内限定 二杯目'});
  const copy=menu.catalog.items.find(x=>x.name==='店内限定 二杯目');assert.ok(copy);assert.notEqual(copy.id,item.id);assert.equal(copy.sourceItemId,ids.menu);assert.equal(copy.price,item.price);assert.equal(copy.posWeightUnitPrice,4);assert.deepEqual(copy.variableSchema,item.variableSchema);
  const copiedSoup=menu.catalog.optionGroups.find(x=>x.menuCatalogItemId===copy.id&&x.sourceGroupId===ids.optionGroup);assert.ok(copiedSoup);assert.notEqual(copiedSoup.id,soup.id);assert.notEqual(copiedSoup.options[0].id,soup.options[0].id);assert.equal(copiedSoup.options[0].sourceOptionId,ids.option);assert.ok(copy.optionGroupIds.includes(copiedSoup.id));assert.ok(copy.optionGroupIds.includes(premium.id));
  assert.equal(previous.catalog.items.length+1,menu.catalog.items.length);assert.equal(menu.catalog.optionGroups.length,previous.catalog.optionGroups.length+1);
  menu=await mutate(menu,{action:'rename',kind:'group',targetId:copiedSoup.id,name:'派生商品の味'});assert.equal(groupBySource(menu,ids.optionGroup).name,'店内の味');
  const optionCopiesBefore=menu.catalog.optionGroups.flatMap(x=>x.options).length;
  const duplication={action:'duplicate',kind:'option',targetId:beef.id,name:'店内追加 牛筋 50g',revision:menu.revision,operationId:op()};
  menu=await json(await mutateMenu(duplication));const added=menu.catalog.optionGroups.flatMap(x=>x.options).find(x=>x.name===duplication.name);assert.ok(added);assert.notEqual(added.id,beef.id);assert.equal(added.sourceOptionId,ids.beef);assert.equal(added.priceDelta,650);assert.equal(added.visible,true);
  const replayCopy=await json(await mutateMenu(duplication));assert.equal(replayCopy.catalog.optionGroups.flatMap(x=>x.options).length,optionCopiesBefore+1);assert.equal(replayCopy.revision,menu.revision);
  groups.push({name:'derived-item-clones-direct-groups-shares-explicit-global-groups-option-copy-retry-creates-once',passed:true});

  const beforeInvalid=menu;
  for(const patch of [
    {price:1},{priceDelta:1},{variableSchema:{}},{sourceItemId:ids.otherItem},{ruleJson:{}},{name:''},{name:'a\nb'},{name:'a'.repeat(121)},{kind:'unknown-kind'},
  ]) await mutate(menu,{action:'rename',kind:'item',targetId:item.id,name:'拒否',...patch},400);
  await mutate(menu,{action:'duplicate',kind:'group',targetId:soup.id,name:'拒否'},400);
  await mutate(menu,{action:'rename',kind:'item',targetId:ids.otherItem,name:'拒否'},404);
  assert.deepEqual((await json(await getMenu())).catalog,beforeInvalid.catalog);
  groups.push({name:'untrusted-prices-source-ids-rules-invalid-names-and-foreign-local-targets-reject',passed:true});

  const currentSoup=menu.catalog.optionGroups.find(x=>x.id===soup.id);
  await mutate(menu,{action:'setVisibility',kind:'option',targetId:currentSoup.options[0].id,visible:false},400);
  menu=await mutate(menu,{action:'setVisibility',kind:'group',targetId:soup.id,visible:false});
  menu=await mutate(menu,{action:'setVisibility',kind:'option',targetId:currentSoup.options[0].id,visible:false});
  await mutate(menu,{action:'setVisibility',kind:'group',targetId:soup.id,visible:true},400);
  menu=await mutate(menu,{action:'setVisibility',kind:'option',targetId:currentSoup.options[0].id,visible:true});
  menu=await mutate(menu,{action:'setVisibility',kind:'group',targetId:soup.id,visible:true});
  menu=await mutate(menu,{action:'setVisibility',kind:'item',targetId:item.id,visible:false});assert.equal(menu.catalog.items.find(x=>x.id===item.id).visible,false);
  menu=await mutate(menu,{action:'setVisibility',kind:'item',targetId:item.id,visible:true});
  groups.push({name:'visibility-edit-cannot-empty-visible-required-group-and-does-not-touch-availability',passed:true});

  const stale=structuredClone(menu);menu=await mutate(menu,{action:'rename',kind:'item',targetId:copy.id,name:'新しい店内版'});
  await mutate(stale,{action:'rename',kind:'item',targetId:item.id,name:'古い編集'},409);
  const revision=menu.revision;
  const racing=await Promise.all(['同時編集A','同時編集B'].map(name=>mutateMenu({action:'rename',kind:'item',targetId:copy.id,name,revision,operationId:op()})));
  assert.deepEqual(racing.map(r=>r.status).sort(),[200,409]);menu=await json(await getMenu());
  groups.push({name:'stale-and-overlapping-edit-reject-one-writer-without-lost-update',passed:true,limitation:'PGlite serializes a single connection; PostgreSQL advisory scheduling across connections is not reproduced.'});

  const snapshot=structuredClone(menu.catalog);
  await db.query(`update menu_catalog_items set name='同期後のブランド名',base_price=9999 where id=$1`,[ids.menu]);
  await db.query(`update menu_options set name='同期後の牛筋',price_delta=9999 where id=$1`,[ids.beef]);
  menu=await json(await getMenu());assert.deepEqual(menu.catalog,snapshot);
  await db.query(`update menu_catalog_items set name='量り売り麻辣湯',base_price=815 where id=$1`,[ids.menu]);
  await db.query(`update menu_options set name='牛筋 50g',price_delta=500 where id=$1`,[ids.beef]);
  assert.deepEqual(await masterSnapshot(),before);assert.deepEqual(await publicMenu(),publicBefore);assert.deepEqual(await publicMenu(true),publicStoreBefore);
  groups.push({name:'later-authoritative-source-name-and-price-sync-cannot-overwrite-local-catalog',passed:true});

  const enabledRevision=menu.aggregateRevision;menu=await mutate(menu,{action:'setEnabled',enabled:false});assert.equal(menu.enabled,false);assert.notEqual(menu.aggregateRevision,enabledRevision);assert.deepEqual(menu.catalog,snapshot);
  menu=await mutate(menu,{action:'setEnabled',enabled:true});assert.equal(menu.enabled,true);
  const second=await json(await getMenu(ids.store,ids.secondBrand));assert.equal(second.exists,false);assert.equal(await menuCount(),1);
  state.failPattern=/from store_dine_in_menus/;await json(await getMenu(),500);state.failPattern=null;
  groups.push({name:'disable-retains-catalog-other-brand-stays-uninitialized-and-database-errors-never-fallback',passed:true});

  // A separate source proves yen rounding does not round away a gram unit price.
  const rounded=await createDineInMenuFixture(source);
  try{
    await rounded.installMigration();
    await rounded.db.query('update menu_catalog_items set base_price=815.5 where id=$1',[rounded.ids.drink]);
    await rounded.db.query('update menu_options set price_delta=100.5 where id=$1',[rounded.ids.pork]);
    await rounded.db.query('update store_brands set pos_weight_unit_price=4.12 where store_id=$1 and brand_id=$2',[rounded.ids.store,rounded.ids.brand]);
    const imported=await json(await rounded.mutateMenu({action:'initialize',operationId:op(),revision:''}));
    const drink=itemBySource(imported,rounded.ids.drink),bowl=itemBySource(imported,rounded.ids.menu);
    assert.equal(drink.basePrice,815.5);assert.equal(drink.price,816);assert.equal(drink.posPricingMode,'fixed');assert.equal(drink.productionType,'drink');
    assert.equal(optionBySource(imported,rounded.ids.pork).priceDelta,101);assert.equal(bowl.posWeightUnitPrice,4.12);assert.equal(bowl.price,600);
    assert.equal((await rounded.db.query('select base_price::float as price from menu_catalog_items where id=$1',[rounded.ids.drink])).rows[0].price,815.5);
    assert.equal((await rounded.db.query('select price_delta::float as price from menu_options where id=$1',[rounded.ids.pork])).rows[0].price,100.5);
    groups.push({name:'copied-yen-prices-match-existing-pos-rounding-raw-source-and-fractional-gram-rate-preserved',passed:true});
  }finally{await rounded.db.close();}

  assert.deepEqual(await masterSnapshot(),before);assert.equal(state.externalCalls,0);
  const report={passed:groups.length,groups,source,isolatedDatabase:'PGlite',liveDatabaseAccess:false,externalCalls:0,createdStores:await menuCount(),operations:await operationCount()};
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await db.close();}
