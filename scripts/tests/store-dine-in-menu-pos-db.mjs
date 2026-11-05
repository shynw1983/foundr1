// Actual POS GET/checkout and immutable ticket persistence against isolated PostgreSQL.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createDineInMenuFixture,fixtureUuid as uuid} from './store-dine-in-menu-fixture.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-menu-pos-db');await mkdir(output,{recursive:true});
const f=await createDineInMenuFixture(source),{db,ids,state}=f;await f.installMigration();
const hiddenGroup=uuid(8100),hiddenGroupOption=uuid(8101),emptyLegacyGroup=uuid(8102);
await db.query(`insert into menu_option_groups(id,brand_id,group_key,name,selection_type,rule_json) values($1,$2,'custom-hidden-extra','厨房受付','multiple','{"minSelections":0,"maxSelections":3}')`,[hiddenGroup,ids.brand]);
await db.query(`insert into menu_options(id,option_group_id,option_key,name,price_delta) values($1,$2,'hidden-extra','厨房追加 50g',100)`,[hiddenGroupOption,hiddenGroup]);
await db.query(`insert into menu_pos_settings(store_id,brand_id,group_id,visible) values($1,$2,$3,false)`,[ids.store,ids.brand,hiddenGroup]);
// The live Sakura graph retains this active, required legacy group with no
// original choices. Existing POS ignores it; copying the graph must preserve that.
await db.query(`insert into menu_option_groups(id,brand_id,group_key,name,selection_type,rule_json) values($1,$2,'heat-level','辛さレベル','single','{"minSelections":1,"maxSelections":1}')`,[emptyLegacyGroup,ids.brand]);
let op=6000,order=7000;const groups=[];
const json=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
const pos=f.reloadPos();
const getPos=async()=>json(await pos.GET(f.request(`/api/store/pos?storeId=${ids.store}`)));
const getMenu=async()=>json(await f.getMenu());
const edit=async(menu,change)=>json(await f.mutateMenu({revision:menu.revision,operationId:uuid(op++),...change}));
const counts=async()=>Number((await db.query('select count(*)::int as n from store_customer_orders')).rows[0].n);
let lastRequest;
async function checkout(item,patch={},status=200){
  const current=await getPos();
  const body={...f.baseBody,discountPresetKey:'',orderType:'eat_in',cashTenderedAmount:10000,receiptRequested:true,offlineClientOrderId:uuid(order++),posMenuRevision:current.posMenuRevision,dineInMenuRevision:current.dineInMenuRevision,items:[item],...patch};
  lastRequest=body;return json(await pos.POST(f.request('/api/store/pos',body)),status);
}
const documents=async id=>(await db.query('select kind,state,payload from pos_print_documents where order_id=$1 order by sequence',[id])).rows;
const orderRows=async id=>(await db.query(`select id::text,menu_catalog_item_id::text,item_name,quantity::int,measured_quantity::float,measured_unit,measured_unit_price::float,amount::int,customizations from store_customer_order_items where order_id=$1 order by sort_order`,[id])).rows;
try{
  let current=await getPos();const originalItems=structuredClone(current.items),originalOptions=structuredClone(current.optionGroups);
  let menu=await edit({revision:''},{action:'initialize'});
  const item=menu.catalog.items.find(x=>x.sourceItemId===ids.menu),soup=menu.catalog.optionGroups.find(x=>x.sourceGroupId===ids.optionGroup),premium=menu.catalog.optionGroups.find(x=>x.sourceGroupId===ids.premiumGroup),beef=premium.options.find(x=>x.sourceOptionId===ids.beef),legacy=menu.catalog.optionGroups.find(x=>x.sourceGroupId===ids.legacyGroup);
  menu=await edit(menu,{action:'rename',kind:'item',targetId:item.id,name:'店内の一杯'});
  menu=await edit(menu,{action:'rename',kind:'group',targetId:soup.id,name:'店内の味'});
  menu=await edit(menu,{action:'rename',kind:'option',targetId:beef.id,name:'厨房牛筋 50g'});
  menu=await edit(menu,{action:'rename',kind:'group',targetId:legacy.id,name:'新しい店内食材名'});
  current=await getPos();
  assert.deepEqual(current.items,originalItems);assert.deepEqual(current.optionGroups,originalOptions);
  const dine=current.dineInMenu;assert.ok(dine);assert.equal(dine.items.find(x=>x.id===item.id).name,'店内の一杯');
  assert.ok(!dine.items.some(x=>x.sourceItemId===ids.hiddenItem||x.sourceItemId===ids.unavailableItem));
  assert.ok(!dine.optionGroups.flatMap(x=>x.options).some(x=>x.sourceOptionId===ids.hiddenOption));
  assert.equal(dine.items.find(x=>x.sourceItemId===ids.drink).posPricingMode,'fixed');
  groups.push({name:'actual-pos-get-keeps-counter-catalog-unchanged-and-resolves-only-available-local-dine-in',passed:true});
  const emptyLegacy=menu.catalog.optionGroups.find(x=>x.sourceGroupId===emptyLegacyGroup);
  assert.equal(emptyLegacy.ruleJson.minSelections,1);assert.equal(emptyLegacy.options.length,0);assert.equal(emptyLegacy.visible,true);
  assert.ok(dine.items.some(x=>x.id===item.id));assert.ok(dine.optionGroups.some(x=>x.id===emptyLegacy.id));
  groups.push({name:'structurally-empty-legacy-required-group-preserves-the-original-pos-item-and-snapshot-graph',passed:true});

  const selected=[{groupId:soup.id,optionIds:[soup.options[0].id]},{groupId:premium.id,optionIds:[beef.id]}];
  const bowl={menuCatalogItemId:item.id,quantity:1,measuredQuantity:250,weightMeasurement:{mode:'manual_net'},selectedOptions:selected,preparationNote:'この杯の指示'};
  const before=await counts();
  await checkout(bowl,{dineInMenuRevision:undefined},409);
  await checkout({...bowl,menuCatalogItemId:ids.menu},{},400);
  await checkout(bowl,{orderType:'takeout'},400);
  await checkout({...bowl,measuredQuantity:undefined},{},400);
  assert.equal(await counts(),before);
  groups.push({name:'missing-revision-canonical-bypass-counter-takeout-local-id-and-missing-weight-reject-no-sale',passed:true});

  const sale=await checkout(bowl);const firstRequest=structuredClone(lastRequest);assert.equal(sale.amount,1650);assert.equal(sale.servingTickets.length,1);
  const rows=await orderRows(sale.orderId);assert.equal(rows.length,1);assert.equal(rows[0].menu_catalog_item_id,ids.menu);assert.equal(rows[0].item_name,'店内の一杯');assert.equal(rows[0].measured_quantity,250);assert.equal(rows[0].measured_unit,'g');assert.equal(rows[0].measured_unit_price,4);
  const sourceSelection=rows[0].customizations.find(x=>x.groupId===ids.premiumGroup);assert.ok(sourceSelection);assert.deepEqual(sourceSelection.optionIds,[ids.beef]);assert.deepEqual(sourceSelection.storeMenuOptionIds,[beef.id]);assert.equal(sourceSelection.storeMenuGroupId,premium.id);assert.deepEqual(sourceSelection.optionLabels,['厨房牛筋 50g']);
  const stored=(await db.query('select customer_summary from store_customer_orders where id=$1',[sale.orderId])).rows[0].customer_summary;
  assert.equal(stored.items[0].menuCatalogItemId,ids.menu);assert.equal(stored.items[0].storeMenuItemId,item.id);assert.equal(stored.items[0].storeMenuRevision,menu.revision);assert.equal(stored.items[0].name,'店内の一杯');assert.equal(stored.items[0].productionType,'bowl');
  const docs=await documents(sale.orderId);assert.deepEqual(docs.map(x=>x.kind),['kitchen','finishing','pickup','receipt']);assert.ok(JSON.stringify(docs).includes('厨房牛筋 50g'));assert.ok(JSON.stringify(docs).includes('店内の一杯'));assert.equal(docs.at(-1).payload.order.totalAmount,1650);
  groups.push({name:'weighed-checkout-persists-canonical-inventory-ids-local-version-labels-and-four-correct-price-snapshots',passed:true});

  menu=await edit(menu,{action:'rename',kind:'item',targetId:item.id,name:'後日の店内名'});menu=await edit(menu,{action:'rename',kind:'option',targetId:beef.id,name:'後日の牛筋名 50g'});
  assert.deepEqual(await documents(sale.orderId),docs);assert.equal((await orderRows(sale.orderId))[0].item_name,'店内の一杯');
  const replay=await json(await pos.POST(f.request('/api/store/pos',firstRequest)));assert.equal(replay.duplicate,true);assert.equal(replay.orderId,sale.orderId);assert.deepEqual(await documents(sale.orderId),docs);
  await checkout(bowl,{dineInMenuRevision:firstRequest.dineInMenuRevision},409);
  const renamed=await checkout(bowl);assert.equal((await orderRows(renamed.orderId))[0].item_name,'後日の店内名');assert.equal(renamed.amount,1650);
  groups.push({name:'later-rename-keeps-paid-order-and-reprint-snapshots-old-recovery-succeeds-new-stale-sale-rejects',passed:true});

  const withLegacy=await checkout({...bowl,selectedOptions:[...selected,{groupId:legacy.id,optionIds:[legacy.options[0].id]}]});assert.equal(withLegacy.amount,1750);
  const legacyRows=await orderRows(withLegacy.orderId);assert.ok(legacyRows[0].customizations.some(x=>x.groupId===ids.legacyGroup&&x.groupName==='新しい店内食材名'));
  groups.push({name:'weighed-option-eligibility-survives-renaming-legacy-name-authorized-group',passed:true});

  const extra=menu.catalog.optionGroups.find(x=>x.sourceGroupId===hiddenGroup),oldVisibilityRevision=(await getPos()).dineInMenuRevision;
  assert.equal(extra.visible,false);assert.equal(extra.posEnabled,false);
  menu=await edit(menu,{action:'setVisibility',kind:'group',targetId:extra.id,visible:true});
  assert.equal(menu.catalog.optionGroups.find(x=>x.id===extra.id).posEnabled,true);
  await checkout({...bowl,selectedOptions:[...selected,{groupId:extra.id,optionIds:[extra.options[0].id]}]},{dineInMenuRevision:oldVisibilityRevision},409);
  const shownExtra=await checkout({...bowl,selectedOptions:[...selected,{groupId:extra.id,optionIds:[extra.options[0].id]}]});assert.equal(shownExtra.amount,1750);
  assert.ok((await getPos()).dineInMenu.optionGroups.some(x=>x.id===extra.id&&x.posEnabled));
  menu=await edit(menu,{action:'setVisibility',kind:'group',targetId:extra.id,visible:false});assert.ok(!(await getPos()).dineInMenu.optionGroups.some(x=>x.id===extra.id));
  groups.push({name:'showing-hidden-nonlegacy-group-enables-weighed-choice-new-revision-and-hiding-removes-it',passed:true});

  menu=await edit(menu,{action:'duplicate',kind:'item',targetId:item.id,name:'別の一杯'});const copy=menu.catalog.items.find(x=>x.name==='別の一杯'),copySoup=menu.catalog.optionGroups.find(x=>x.menuCatalogItemId===copy.id&&x.sourceGroupId===ids.optionGroup);
  const beforeBad=await counts();await checkout({...bowl,selectedOptions:[{groupId:copySoup.id,optionIds:[copySoup.options[0].id]}]},{},400);assert.equal(await counts(),beforeBad);
  const copySale=await checkout({...bowl,menuCatalogItemId:copy.id,selectedOptions:[{groupId:copySoup.id,optionIds:[copySoup.options[0].id]},{groupId:premium.id,optionIds:[beef.id]}]});assert.equal(copySale.amount,1650);assert.equal((await orderRows(copySale.orderId))[0].menu_catalog_item_id,ids.menu);
  groups.push({name:'derived-item-direct-option-groups-have-independent-local-scope-and-shared-canonical-lineage',passed:true});

  menu=await edit(menu,{action:'duplicate',kind:'option',targetId:beef.id,name:'別盛り牛筋 50g'});const copiedBeef=menu.catalog.optionGroups.flatMap(x=>x.options).find(x=>x.name==='別盛り牛筋 50g');
  const double=await checkout({...bowl,selectedOptions:[selected[0],{groupId:premium.id,optionIds:[beef.id,copiedBeef.id]}]});assert.equal(double.amount,2300);
  const doubleRows=await orderRows(double.orderId),doublePremium=doubleRows[0].customizations.find(x=>x.groupId===ids.premiumGroup);assert.deepEqual(doublePremium.optionIds,[ids.beef,ids.beef]);assert.deepEqual(doublePremium.storeMenuOptionIds,[beef.id,copiedBeef.id]);
  const inventory=f.load('lib/inventory-order-usage-policy.ts').normalizeInventoryOrderSource(doubleRows.map(row=>({sourceItemId:row.id,menuCatalogItemId:row.menu_catalog_item_id,quantity:row.quantity,measuredQuantity:row.measured_quantity,measuredUnit:row.measured_unit,customizations:row.customizations})), 'store_pos');
  assert.equal(inventory.identityConfidence,'exact');assert.equal(inventory.items[0].options.find(x=>x.id===ids.beef).quantity,2);assert.equal(inventory.items[0].menuCatalogItemId,ids.menu);
  groups.push({name:'original-and-derived-options-charge-two-portions-and-existing-inventory-normalizer-counts-two-canonical-portions',passed:true});

  const drink=current.dineInMenu.items.find(x=>x.sourceItemId===ids.drink);const drinkSale=await checkout({menuCatalogItemId:drink.id,quantity:2,selectedOptions:[]});assert.equal(drinkSale.amount,800);assert.equal(drinkSale.servingTickets.length,0);const drinkRows=await orderRows(drinkSale.orderId);assert.equal(drinkRows.length,1);assert.equal(drinkRows[0].quantity,2);assert.equal(drinkRows[0].measured_quantity,null);
  const policy=f.load('lib/pos-serving-policy.ts');assert.equal(policy.isPosBowl({brandName:'まぁ麻',itemKind:'fixed_product',productionType:'item'}),false);assert.equal(policy.isPosBowl({brandName:'まぁ麻',itemKind:'drink',productionType:'drink'}),false);assert.equal(policy.isPosBowl({brandName:'まぁ麻',itemKind:'buildable_product',productionType:'bowl'}),true);
  groups.push({name:'derived-drink-remains-fixed-price-without-bowl-codes-explicit-production-types-override-brand-heuristic',passed:true});

  menu=await getMenu();const beforeHidden=structuredClone(menu.catalog),beforeHiddenSales=await counts();
  await json(await f.mutateMenu({revision:menu.revision,operationId:uuid(op++),action:'setVisibility',kind:'option',targetId:soup.options[0].id,visible:false}),400);
  assert.deepEqual((await getMenu()).catalog,beforeHidden);
  // A malformed/pre-existing all-hidden configuration must also fail closed at
  // runtime. Its original option array is nonempty, unlike the historical ghost.
  const allHidden=structuredClone(beforeHidden);allHidden.optionGroups.find(x=>x.id===soup.id).options.forEach(option=>{option.visible=false;});
  await db.query('update store_dine_in_menus set catalog=$3::jsonb where store_id=$1 and brand_id=$2',[ids.store,ids.brand,JSON.stringify(allHidden)]);
  current=await getPos();assert.ok(!current.dineInMenu.items.some(x=>x.id===item.id));await checkout(bowl,{},400);assert.equal(await counts(),beforeHiddenSales);
  await db.query('update store_dine_in_menus set catalog=$3::jsonb where store_id=$1 and brand_id=$2',[ids.store,ids.brand,JSON.stringify(beforeHidden)]);
  assert.ok((await getPos()).dineInMenu.items.some(x=>x.id===item.id));
  groups.push({name:'hiding-every-original-required-choice-remains-blocked-by-editor-and-runtime',passed:true});

  await db.query(`insert into menu_option_store_settings(brand_id,store_id,menu_option_id,is_available) values($1,$2,$3,false)`,[ids.brand,ids.store,ids.option]);
  current=await getPos();assert.ok(!current.dineInMenu.items.some(x=>x.id===item.id||x.id===copy.id));await checkout(bowl,{},400);
  await db.query('delete from menu_option_store_settings where menu_option_id=$1',[ids.option]);
  await db.query('update menu_catalog_items set is_active=false where id=$1',[ids.menu]);current=await getPos();assert.ok(!current.dineInMenu.items.some(x=>x.id===item.id||x.id===copy.id));await checkout(bowl,{},400);await db.query('update menu_catalog_items set is_active=true where id=$1',[ids.menu]);
  groups.push({name:'source-stockout-of-required-option-or-retired-item-blocks-local-and-derived-sales',passed:true});

  current=await getPos();const beforeRace=await counts(),oldTransaction=f.sql.transaction;
  // POS revisions intentionally ignore review-only administrative revision bumps.
  // Inject an actual catalog display-order change at the transaction boundary.
  f.sql.transaction=async statements=>{if(statements.some(s=>s.text.includes('insert into store_customer_orders'))){await db.query("update store_dine_in_menus set revision=revision+1,catalog=jsonb_set(catalog,'{items,0,sortOrder}',to_jsonb(coalesce((catalog->'items'->0->>'sortOrder')::int,0)+1)) where store_id=$1",[ids.store]);f.sql.transaction=oldTransaction;}return oldTransaction(statements);};
  await checkout(bowl,{},409);f.sql.transaction=oldTransaction;assert.equal(await counts(),beforeRace);
  menu=await getMenu();menu=await edit(menu,{action:'setEnabled',enabled:false});await checkout(bowl,{},400);
  const fallback=await checkout({...bowl,menuCatalogItemId:ids.menu,selectedOptions:[{groupId:ids.optionGroup,optionIds:[ids.option]},{groupId:ids.premiumGroup,optionIds:[ids.beef]}]});assert.equal(fallback.amount,1650);
  groups.push({name:'transaction-catalog-change-rolls-back-sale-disable-rejects-local-ids-and-restores-existing-catalog',passed:true});

  const minimum=await createDineInMenuFixture(source);
  try{
    await minimum.installMigration();
    await minimum.db.query(`update menu_option_groups set selection_type='multiple',rule_json='{"minSelections":2,"maxSelections":3}' where id=$1`,[minimum.ids.optionGroup]);
    await minimum.db.query(`insert into menu_options(id,option_group_id,option_key,name,price_delta) values($1,$2,'second','第二の味',0)`,[uuid(8990),minimum.ids.optionGroup]);
    const imported=await json(await minimum.mutateMenu({action:'initialize',revision:'',operationId:uuid(op++)}));
    const localItem=imported.catalog.items.find(x=>x.sourceItemId===minimum.ids.menu),runtime=minimum.load('lib/store-dine-in-runtime.ts');
    const resolveLocal=async()=>runtime.resolveDineInCatalog(minimum.ids.store,await minimum.load('lib/store-dine-in-menu.ts').readDineInMenus(minimum.ids.store));
    assert.ok((await resolveLocal()).items.some(x=>x.id===localItem.id));
    await minimum.db.query(`insert into menu_option_store_settings(brand_id,store_id,menu_option_id,is_available) values($1,$2,$3,false)`,[minimum.ids.brand,minimum.ids.store,uuid(8990)]);
    assert.ok(!(await resolveLocal()).items.some(x=>x.id===localItem.id));
    // Quantity groups can satisfy a minimum using repeated portions of one available option.
    await minimum.db.query(`update store_dine_in_menus set catalog=jsonb_set(catalog,'{optionGroups}',(select jsonb_agg(case when g->>'sourceGroupId'=$1 then jsonb_set(g,'{selectionType}','"quantity"') else g end) from jsonb_array_elements(catalog->'optionGroups') g)) where store_id=$2`,[minimum.ids.optionGroup,minimum.ids.store]);
    assert.ok((await resolveLocal()).items.some(x=>x.id===localItem.id));
    groups.push({name:'required-multiple-minimum-two-needs-two-available-choices-quantity-groups-may-repeat-one',passed:true});
  }finally{await minimum.db.close();}

  assert.equal(state.externalCalls,0);const report={passed:groups.length,groups,source,isolatedDatabase:'PGlite',liveDatabaseAccess:false,externalCalls:0,inventoryCallbackCount:state.inventoryCalls.length};await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await db.close();}
