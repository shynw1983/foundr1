// Actual menu/POS/print handlers with isolated PostgreSQL. No live credentials,
// network, native device, or production data is read or written.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { createDineInMenuFixture, fixtureUuid as uuid } from './store-dine-in-menu-fixture.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-ordering-db');
await mkdir(output,{recursive:true});
const files=['lib/store-dine-in-menu-policy.ts','lib/store-dine-in-menu.ts','lib/store-dine-in-source-review.ts','app/api/os/menus/dine-in/route.ts','app/api/store/pos/route.ts','lib/inventory-order-usage-policy.ts','lib/inventory-order-usage.ts','lib/store-dine-in-runtime.ts','lib/store-order-shortages.ts','lib/dine-in-option-selection.ts','lib/pos-print-document-builder.ts','lib/pos-print-document-ledger.ts','scripts/tests/store-dine-in-ordering-db.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(join(source,file))).digest('hex')])));
const inputHashes=await hashes(),results=[];
const f=await createDineInMenuFixture(source);await f.installMigration();
const {db,ids}=f;let operation=72000,sale=73000,menu;
const clone=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{response=await response;assert.equal(response.status,status,await response.clone().text());return response.json();};
const refresh=async()=>menu=await json(f.getMenu());
const edit=async(change,status=200)=>{const result=await json(f.mutateMenu({revision:menu?.revision||'',operationId:uuid(operation++),...change}),status);if(status===200)menu=result;return result;};
const itemFrom=id=>menu.catalog.items.find(item=>item.sourceItemId===id);
const groupFrom=(item,id)=>menu.catalog.optionGroups.find(group=>item.optionGroupIds.includes(group.id)&&group.sourceGroupId===id);
const sourceSnapshot=async()=>{const data=await f.masterSnapshot();data.menu_catalog_items=data.menu_catalog_items.filter(row=>!row.variable_schema?.storeDineInOnly);return data;};
const publicSnapshot=async()=>{const value=await json(f.load('app/api/public/menus/route.ts').GET(f.request(`/api/public/menus?brand=${ids.brand}&store=${ids.store}`)));delete value.generatedAt;return value;};
const record=async(name,run)=>{await run();results.push({name,passed:true});console.log('PASS '+name);};
const count=async table=>Number((await db.query(`select count(*)::int n from ${table}`)).rows[0].n);
const docs=async orderId=>(await db.query('select kind,state,payload from pos_print_documents where order_id=$1 order by sequence',[orderId])).rows;
const orderItems=async orderId=>(await db.query('select id::text,menu_catalog_item_id::text,item_name,quantity::int,amount::int,customizations from store_customer_order_items where order_id=$1 order by sort_order',[orderId])).rows;
let checkout,lastCheckout;
try{
  Object.assign(ids,{noodleGroup:uuid(71001),noodle:uuid(71002),secondNoodle:uuid(71003),flavorGroup:uuid(71004),flavor:uuid(71005),otherFlavor:uuid(71006)});
  await db.exec(`insert into menu_option_groups(id,brand_id,menu_catalog_item_id,group_key,name,selection_type,rule_json,sort_order) values
    ('${ids.noodleGroup}','${ids.brand}','${ids.menu}','noodle','麺','multiple','{"minSelections":0,"maxSelections":3,"portionGrams":50}',30),
    ('${ids.flavorGroup}','${ids.brand}','${ids.menu}','flavor','味付け','single','{"minSelections":1,"maxSelections":1}',40);
    insert into menu_options(id,option_group_id,option_key,name,price_delta,sort_order) values
    ('${ids.noodle}','${ids.noodleGroup}','knife','刀削麺 50g',200,1),('${ids.secondNoodle}','${ids.noodleGroup}','rice','米麺 50g',150,2),
    ('${ids.flavor}','${ids.flavorGroup}','sesame','胡麻味',50,1),('${ids.otherFlavor}','${ids.flavorGroup}','tomato','トマト味',100,2);`);
  const mastersBefore=await sourceSnapshot(),publicBefore=await publicSnapshot();
  await edit({action:'initialize',mode:'source',enabled:true});
  let bowl=itemFrom(ids.menu),drink=itemFrom(ids.drink),noodle=groupFrom(bowl,ids.noodleGroup);
  await record('category-and-product-full-order-save-survives-reload-and-runtime-keeps-manual-refresh-revision',async()=>{
    const categoryIds=menu.catalog.categories.map(x=>x.id).reverse();await edit({action:'reorder',kind:'category',ids:categoryIds});
    const itemIds=menu.catalog.items.map(x=>x.id).reverse();const revision=menu.revision;await edit({action:'reorder',kind:'item',ids:itemIds});
    await refresh();assert.deepEqual(menu.catalog.categories.map(x=>x.id),categoryIds);assert.deepEqual(menu.catalog.items.map(x=>x.id),itemIds);assert.notEqual(menu.revision,revision);
    const current=await json(f.reloadPos().GET(f.request(`/api/store/pos?storeId=${ids.store}`)));
    const runtimeIds=new Set(current.dineInMenu.items.map(x=>x.id));assert.deepEqual(current.dineInMenu.items.map(x=>x.id),menu.catalog.items.filter(x=>runtimeIds.has(x.id)).map(x=>x.id));assert.ok(current.dineInMenuRevision);
  });
  await record('group-and-option-orders-are-per-parent-and-reject-incomplete-duplicate-or-cross-parent-ids',async()=>{
    bowl=itemFrom(ids.menu);const groupIds=[...bowl.optionGroupIds].reverse();await edit({action:'reorder',kind:'group',targetId:bowl.id,ids:groupIds});
    noodle=groupFrom(itemFrom(ids.menu),ids.noodleGroup);const optionIds=noodle.options.map(x=>x.id).reverse();await edit({action:'reorder',kind:'option',targetId:noodle.id,ids:optionIds});
    assert.deepEqual(itemFrom(ids.menu).optionGroupIds,groupIds);assert.deepEqual(menu.catalog.optionGroups.find(x=>x.id===noodle.id).options.map(x=>x.id),optionIds);
    for(const bad of[
      {action:'reorder',kind:'item',ids:menu.catalog.items.map(x=>x.id).slice(1)},
      {action:'reorder',kind:'category',ids:[menu.catalog.categories[0].id,menu.catalog.categories[0].id]},
      {action:'reorder',kind:'group',targetId:bowl.id,ids:[uuid(71111)]},
      {action:'reorder',kind:'option',targetId:noodle.id,ids:[ids.beef]},
      {action:'reorder',kind:'item',ids:menu.catalog.items.map(x=>x.id),targetId:bowl.id}
    ]){const before=clone(menu.catalog);await edit(bad,400);assert.deepEqual((await json(f.getMenu())).catalog,before);}
  });
  await record('hide-unhide-keeps-product-and-source-lineage-without-deleting-or-changing-stock-availability',async()=>{
    drink=itemFrom(ids.drink);const original=clone(drink);await edit({action:'setVisibility',kind:'item',targetId:drink.id,visible:false});
    let current=await json(f.reloadPos().GET(f.request(`/api/store/pos?storeId=${ids.store}`)));assert.ok(!current.dineInMenu.items.some(x=>x.id===drink.id));assert.ok(menu.catalog.items.some(x=>x.id===drink.id));
    await edit({action:'setVisibility',kind:'item',targetId:drink.id,visible:true});drink=itemFrom(ids.drink);assert.deepEqual(drink,original);
    assert.deepEqual(await sourceSnapshot(),mastersBefore);
  });
  await record('delete-product-is-reversible-with-identical-id-label-prices-options-and-replay-safe-restore',async()=>{
    bowl=itemFrom(ids.menu);const original=clone(bowl),groups=clone(menu.catalog.optionGroups.filter(x=>bowl.optionGroupIds.includes(x.id)));
    const command={action:'delete',kind:'item',targetId:bowl.id,revision:menu.revision,operationId:uuid(operation++)};menu=await json(f.mutateMenu(command));
    assert.ok(!menu.catalog.items.some(x=>x.id===bowl.id));const entry=menu.catalog.trash.find(x=>x.kind==='item'&&x.targetId===bowl.id);assert.ok(entry);assert.equal(entry.name,bowl.name);
    const replay=await json(f.mutateMenu(command));assert.equal(replay.catalog.trash.filter(x=>x.id===entry.id).length,1);
    const restore={action:'restore',targetId:entry.id,revision:menu.revision,operationId:uuid(operation++)};menu=await json(f.mutateMenu(restore));assert.deepEqual(itemFrom(ids.menu),original);
    for(const group of groups)assert.deepEqual(menu.catalog.optionGroups.find(x=>x.id===group.id),group);
    const restoredReplay=await json(f.mutateMenu(restore));assert.equal(restoredReplay.catalog.items.filter(x=>x.id===bowl.id).length,1);assert.ok(!restoredReplay.catalog.trash.some(x=>x.id===entry.id));
  });
  await record('whole-flavor-group-import-retains-single-required-rule-and-stock-identities-on-new-product',async()=>{
    await edit({action:'createItem',categoryId:menu.catalog.categories[0].id,itemKind:'buildable_product',name:'新しい味選択の碗',price:0});
    const next=menu.catalog.items.find(x=>x.name==='新しい味選択の碗');await edit({action:'importOptionGroup',itemId:next.id,sourceGroupId:ids.flavorGroup,origin:'brand'});
    const group=menu.catalog.optionGroups.find(x=>menu.catalog.items.find(i=>i.id===next.id).optionGroupIds.includes(x.id)&&x.sourceGroupId===ids.flavorGroup);
    assert.ok(group);assert.equal(group.selectionType,'single');assert.equal(group.ruleJson.minSelections,1);assert.equal(group.ruleJson.maxSelections,1);assert.deepEqual(group.options.map(x=>x.sourceOptionId),[ids.flavor,ids.otherFlavor]);assert.deepEqual(group.options.map(x=>x.priceDelta),[50,100]);
    const before=clone(menu.catalog);await edit({action:'importOptionGroup',itemId:next.id,sourceGroupId:ids.flavorGroup,origin:'brand',optionIds:[]},400);assert.deepEqual((await json(f.getMenu())).catalog,before);
    await edit({action:'importOptionGroup',itemId:next.id,sourceGroupId:ids.otherItem,origin:'brand'},404);
  });
  await record('noodles-support-distinct-choices-and-three-portions-with-bounded-repeat-rule',async()=>{
    bowl=itemFrom(ids.menu);noodle=groupFrom(bowl,ids.noodleGroup);await edit({action:'setGroupSelection',targetId:noodle.id,selectionType:'quantity',minSelections:0,maxSelections:5,perOptionMax:3});
    noodle=groupFrom(itemFrom(ids.menu),ids.noodleGroup);assert.equal(noodle.selectionType,'quantity');assert.equal(noodle.ruleJson.maxSelections,5);assert.equal(noodle.ruleJson.perOptionMax,3);assert.equal(noodle.ruleJson.portionGrams,50);
    await edit({action:'setGroupSelection',targetId:noodle.id,selectionType:'quantity',minSelections:4,maxSelections:2,perOptionMax:3},400);
  });
  let linkedGroup,beer;
  await record('standalone-drink-can-also-link-inside-one-bowl-and-follows-local-name-price-without-forking-option-stock-id',async()=>{
    bowl=itemFrom(ids.menu);drink=itemFrom(ids.drink);await edit({action:'createItem',categoryId:menu.catalog.categories[0].id,itemKind:'drink',name:'店内生ビール',price:650});beer=menu.catalog.items.find(x=>x.name==='店内生ビール');await edit({action:'createOptionGroup',itemId:bowl.id,name:'この碗の飲みもの',selectionType:'quantity'});
    linkedGroup=menu.catalog.optionGroups.find(x=>x.name==='この碗の飲みもの');await edit({action:'linkItemOptions',targetId:linkedGroup.id,itemIds:[drink.id]});
    linkedGroup=menu.catalog.optionGroups.find(x=>x.id===linkedGroup.id);assert.equal(linkedGroup.options.length,1);assert.equal(linkedGroup.options[0].linkedItemId,drink.id);assert.equal(linkedGroup.options[0].sourceOptionId,'');
    await edit({action:'rename',kind:'item',targetId:drink.id,name:'店内緑茶'});await edit({action:'setItemPrice',targetId:drink.id,price:450});
    linkedGroup=menu.catalog.optionGroups.find(x=>x.id===linkedGroup.id);assert.equal(linkedGroup.options[0].name,'店内緑茶');assert.equal(linkedGroup.options[0].priceDelta,450);
    const prior=clone(menu.catalog);await edit({action:'linkItemOptions',targetId:linkedGroup.id,itemIds:[bowl.id]},400);assert.deepEqual((await json(f.getMenu())).catalog,prior);
    await edit({action:'linkItemOptions',targetId:linkedGroup.id,itemIds:[ids.otherItem]},400);
  });
  await record('alcohol-home-product-can-also-be-linked-and-hidden-home-list-does-not-remove-available-bowl-choice',async()=>{
    await edit({action:'linkItemOptions',targetId:linkedGroup.id,itemIds:[beer.id]});await edit({action:'setVisibility',kind:'item',targetId:beer.id,visible:false});
    const current=await json(f.reloadPos().GET(f.request(`/api/store/pos?storeId=${ids.store}`)));assert.ok(!current.dineInMenu.items.some(x=>x.id===beer.id));const group=current.dineInMenu.optionGroups.find(x=>x.id===linkedGroup.id);assert.ok(group.options.some(x=>x.linkedItemId===beer.id&&x.priceDelta===650));
    await edit({action:'setVisibility',kind:'item',targetId:beer.id,visible:true});assert.ok((await json(f.reloadPos().GET(f.request(`/api/store/pos?storeId=${ids.store}`)))).dineInMenu.items.some(x=>x.id===beer.id));
  });
  const pos=f.reloadPos();checkout=async(items,patch={},status=200)=>{
    const current=await json(pos.GET(f.request(`/api/store/pos?storeId=${ids.store}`)));
    lastCheckout={...f.baseBody,discountPresetKey:'',orderType:'eat_in',cashTenderedAmount:10000,receiptRequested:true,offlineClientOrderId:uuid(sale++),posMenuRevision:current.posMenuRevision,dineInMenuRevision:current.dineInMenuRevision,items,...patch};
    return json(pos.POST(f.request('/api/store/pos',lastCheckout)),status);
  };
  const makeLine=()=>{
    bowl=itemFrom(ids.menu);noodle=groupFrom(bowl,ids.noodleGroup);linkedGroup=menu.catalog.optionGroups.find(x=>x.id===linkedGroup.id);
    const required=menu.catalog.optionGroups.filter(x=>bowl.optionGroupIds.includes(x.id)&&Number(x.ruleJson.minSelections)>0&&x.options.some(o=>o.visible)).map(x=>({groupId:x.id,optionIds:[x.options.find(o=>o.visible).id]}));
    return {menuCatalogItemId:bowl.id,quantity:1,measuredQuantity:200,weightMeasurement:{mode:'manual_net'},preparationNote:'このお客様の碗',selectedOptions:[...required,{groupId:noodle.id,optionIds:[noodle.options[0].id,noodle.options[0].id,noodle.options[0].id,noodle.options[1].id]},{groupId:linkedGroup.id,optionIds:[linkedGroup.options[0].id,linkedGroup.options[0].id]}]};
  };
  let paid,oldOrder,oldDocs;
  await record('actual-checkout-persists-linked-products-and-repeated-noodles-under-correct-bowl-with-canonical-identities',async()=>{
    const line=makeLine(),requiredPrice=line.selectedOptions.slice(0,-2).flatMap(x=>x.optionIds.map(id=>menu.catalog.optionGroups.find(g=>g.id===x.groupId).options.find(o=>o.id===id).priceDelta)).reduce((a,b)=>a+b,0);
    const noodlePrice=3*noodle.options[0].priceDelta+noodle.options[1].priceDelta;const expected=800+requiredPrice+noodlePrice+900;
    paid=await checkout([line]);assert.equal(paid.amount,expected);oldOrder=await orderItems(paid.orderId);oldDocs=await docs(paid.orderId);assert.equal(oldOrder.length,1);assert.equal(oldOrder[0].menu_catalog_item_id,ids.menu);assert.equal(oldOrder[0].amount,expected);
    const customizations=oldOrder[0].customizations;assert.ok(customizations.some(x=>(x.optionIds||[]).includes(ids.noodle)));assert.ok(!customizations.some(x=>(x.optionIds||[]).includes(linkedGroup.options[0].id)));assert.ok(!customizations.some(x=>(x.optionIds||[]).includes(drink.sourceItemId)));
    const linkedGroups=customizations.filter(x=>x.linkedItems?.length);assert.equal(linkedGroups.length,1);assert.equal(linkedGroups[0].storeMenuGroupId,linkedGroup.id);assert.deepEqual(linkedGroups[0].storeMenuOptionIds,[linkedGroup.options[0].id,linkedGroup.options[0].id]);assert.deepEqual(linkedGroups[0].optionIds,[]);const linked=customizations.flatMap(x=>x.linkedItems||[]);assert.equal(linked.length,2);for(const item of linked){assert.equal(item.menuCatalogItemId,drink.sourceItemId);assert.equal(item.storeMenuItemId,drink.id);assert.equal(item.quantity,1);assert.equal(item.unitPrice,450);}assert.ok(JSON.stringify(customizations).includes(drink.sourceItemId),'Linked product is structured as a product identity');assert.equal(oldDocs.find(x=>x.kind==='receipt').payload.order.totalAmount,expected);assert.ok(JSON.stringify(oldDocs).includes('店内緑茶'));assert.ok(JSON.stringify(oldDocs).includes('このお客様の碗'));for(const kind of ['kitchen','finishing','pickup','receipt']){const document=oldDocs.find(x=>x.kind===kind);assert.ok(document,kind);const options=document.payload.order.items[0].options;assert.equal(options.filter(x=>x.includes('店内緑茶')).length,1);assert.ok(options.some(x=>x.includes('店内緑茶 x2')));assert.ok(options.some(x=>x.includes(noodle.options[0].name+' x3')));}assert.ok(!JSON.stringify(oldDocs.find(x=>x.kind==='pickup')).includes('このお客様の碗'));
    const saleCount=await count('store_customer_orders');const replay=await json(pos.POST(f.request('/api/store/pos',lastCheckout)));assert.equal(replay.orderId,paid.orderId);assert.equal(await count('store_customer_orders'),saleCount);
  });
  await record('linked-product-stockout-and-foreign-stale-quantity-payloads-reject-atomically',async()=>{
    const before=await count('store_customer_orders'),line=makeLine();
    const tooMany=clone(line);tooMany.selectedOptions.find(x=>x.groupId===noodle.id).optionIds=Array(4).fill(noodle.options[0].id);await checkout([tooMany],{},400);
    const forged=clone(line);forged.selectedOptions.find(x=>x.groupId===linkedGroup.id).optionIds=[ids.otherItem];await checkout([forged],{},400);
    await db.query('insert into menu_store_settings(brand_id,store_id,menu_catalog_item_id,is_available) values($1,$2,$3,false) on conflict(store_id,menu_catalog_item_id) do update set is_available=false',[ids.brand,ids.store,drink.sourceItemId]);
    await checkout([line],{},400);await db.query('delete from menu_store_settings where store_id=$1 and menu_catalog_item_id=$2',[ids.store,drink.sourceItemId]);
    await checkout([line],{dineInMenuRevision:'stale'},409);assert.equal(await count('store_customer_orders'),before);
  });
  await record('later-local-menu-edits-trash-restore-and-source-import-do-not-rewrite-paid-order-or-immutable-print-snapshots',async()=>{
    await edit({action:'rename',kind:'item',targetId:drink.id,name:'明日の緑茶'});await edit({action:'setItemPrice',targetId:drink.id,price:990});
    await edit({action:'delete',kind:'item',targetId:drink.id});const entry=menu.catalog.trash.find(x=>x.targetId===drink.id);await edit({action:'restore',targetId:entry.id});
    assert.deepEqual(await orderItems(paid.orderId),oldOrder);assert.deepEqual(await docs(paid.orderId),oldDocs);
  });
  await record('unauthorized-csrf-invalid-stale-menu-commands-leave-catalog-operation-count-and-source-masters-unchanged',async()=>{
    const snapshot=clone(menu.catalog),operations=await count('store_dine_in_menu_operations'),session=f.state.session;
    f.state.session=null;await edit({action:'setVisibility',kind:'item',targetId:bowl.id,visible:false},401);f.state.session=session;
    f.state.permitted=false;await edit({action:'reorder',kind:'item',ids:menu.catalog.items.map(x=>x.id)},403);f.state.permitted=true;
    await json(f.mutateMenu({action:'restore',targetId:uuid(79999),revision:menu.revision,operationId:uuid(operation++)},{origin:'https://foreign.invalid'}),403);
    await edit({action:'reorder',kind:'item',ids:menu.catalog.items.map(x=>x.id),revision:'1'},409);
    await edit({action:'restore',targetId:uuid(79999)},404);assert.deepEqual((await json(f.getMenu())).catalog,snapshot);assert.equal(await count('store_dine_in_menu_operations'),operations);
    assert.deepEqual(await sourceSnapshot(),mastersBefore);assert.deepEqual(await publicSnapshot(),publicBefore);assert.equal(Number((await db.query('select count(*)::int n from store_dine_in_menus where store_id<>$1',[ids.store])).rows[0].n),0);
  });
  const sourceHashes=await hashes();assert.deepEqual(sourceHashes,inputHashes);
  await writeFile(join(output,'report.json'),JSON.stringify({passed:results.length,results,sourceHashes,inputHashes,noSourceDrift:true,actualApi:true,actualPosPersistence:true,actualPrintSnapshots:true,isolatedPostgreSQL:true,liveWrites:0,externalCalls:f.state.externalCalls,inventoryVerification:'Checkout callback stubs only; actual inventory engine verified separately by root.'},null,2)+'\n');
  console.log(JSON.stringify({passed:results.length,output}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,results,lastCheckout,catalog:menu?.catalog},null,2)+'\n');throw error;}
finally{await db.close();await writeFile(join(output,'cleanup-result.json'),JSON.stringify({completed:true,isolatedPostgreSQLClosed:true,externalProcesses:0})+'\n');}
