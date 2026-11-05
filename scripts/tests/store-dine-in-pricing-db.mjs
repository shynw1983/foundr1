// Mixed item pricing through the real OS/POS handlers and isolated PostgreSQL.
// No live credentials, external HTTP, payments, printers, or scales are accessed.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createDineInMenuFixture,fixtureUuid as uuid} from './store-dine-in-menu-fixture.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-pricing-db');await mkdir(output,{recursive:true});
const results=[];let nextOperation=36000,nextOrder=38000;const operation=()=>uuid(nextOperation++);
const json=async(response,status=200)=>{response=await response;assert.equal(response.status,status,await response.clone().text());return response.json();};
const clone=value=>JSON.parse(JSON.stringify(value));
const bySource=(menu,id)=>menu.catalog.items.find(item=>item.sourceItemId===id);
async function check(name,fn){await fn();results.push({name,passed:true});console.log(`PASS ${name}`);}
const f=await createDineInMenuFixture(source),{db,ids,state}=f;await f.installMigration();
const noodle=uuid(36100),premiumItem=uuid(36101);
await db.exec('alter table store_customer_order_items add constraint mixed_pricing_menu_fk foreign key(menu_catalog_item_id) references menu_catalog_items(id)');
await db.query("update menu_catalog_items set variable_schema=jsonb_set(variable_schema,'{posWeightPricing,mode}','\"weight\"') where id=$1",[ids.menu]);
await db.query('update menu_catalog_items set base_price=350 where id=$1',[ids.drink]);
for(const [id,name,price] of [[noodle,'春雨 50g',200],[premiumItem,'牛筋 50g',650]]){
  await db.query("insert into menu_catalog_items(id,brand_id,name,item_kind,category,base_price) values($1,$2,$3,'fixed_product','麻辣湯',$4)",[id,ids.brand,name,price]);
}
const pos=f.reloadPos(),getPos=()=>json(pos.GET(f.request(`/api/store/pos?storeId=${ids.store}`))),getMenu=()=>json(f.getMenu());
const edit=(menu,change,status=200)=>json(f.mutateMenu({revision:menu.revision,operationId:operation(),...change}),status);
const count=async table=>Number((await db.query(`select count(*)::int n from ${table}`)).rows[0].n);
const docs=async id=>(await db.query('select kind,state,payload from pos_print_documents where order_id=$1 order by sequence',[id])).rows;
const rows=async id=>(await db.query('select id::text,menu_catalog_item_id::text,item_name,quantity::int,amount::int,measured_quantity::float,measured_unit,measured_unit_price::float,customizations from store_customer_order_items where order_id=$1 order by sort_order',[id])).rows;
let lastBody;
async function checkout(items,patch={},status=200){
  const current=await getPos();lastBody={...f.baseBody,discountPresetKey:'',orderType:'eat_in',cashTenderedAmount:10000,receiptRequested:true,
    offlineClientOrderId:uuid(nextOrder++),posMenuRevision:current.posMenuRevision,dineInMenuRevision:current.dineInMenuRevision,items,...patch};
  return json(pos.POST(f.request('/api/store/pos',lastBody)),status);
}
async function publicMenus(){
  const out={};for(const [name,path,route] of [
    ['standard-brand',`/api/public/menus?brand=${ids.brand}`,'app/api/public/menus/route.ts'],
    ['standard-store',`/api/public/menus?brand=${ids.brand}&store=${ids.store}`,'app/api/public/menus/route.ts'],
    ['maamaa-compat',`/api/public/menus/maamaa-compatible?store=${ids.store}`,'app/api/public/menus/maamaa-compatible/route.ts']
  ]){const body=await json(f.load(route).GET(f.request(path)));delete body.generatedAt;out[name]=body;}return out;
}
const sourceMasters=async()=>{const value=await f.masterSnapshot();value.menu_catalog_items=value.menu_catalog_items.filter(row=>!row.variable_schema?.storeDineInOnly);return value;};
try{
  const masterBefore=await sourceMasters(),publicBefore=await publicMenus();
  const legacyLines=()=>[
    {menuCatalogItemId:ids.menu,quantity:1,measuredQuantity:200,weightMeasurement:{mode:'manual_net'},selectedOptions:[{groupId:ids.optionGroup,optionIds:[ids.option]}]},
    {menuCatalogItemId:noodle,quantity:2,selectedOptions:[]},{menuCatalogItemId:premiumItem,quantity:2,selectedOptions:[]},{menuCatalogItemId:ids.drink,quantity:1,selectedOptions:[]}
  ];
  let legacySale,legacyDocuments;
  await check('legacy-pos-and-source-preview-resolve-only-base-weight-under-store-global-weight-setting',async()=>{
    const current=await getPos(),preview=await getMenu();
    for(const catalog of [current,preview.source]){
      assert.equal(catalog.items.find(item=>item.id===ids.menu).posPricingMode,'weight');
      for(const id of [noodle,premiumItem,ids.drink])assert.equal(catalog.items.find(item=>item.id===id).posPricingMode,'fixed');
    }
    assert.equal(preview.source.items.find(item=>item.id===noodle).price,200);assert.equal(preview.source.items.find(item=>item.id===premiumItem).price,650);
  });
  await check('legacy-checkout-mixes-two-fixed-portions-with-200g-base-and-persists-real-measurements-only-on-base',async()=>{
    legacySale=await checkout(legacyLines());assert.equal(legacySale.amount,2850);
    const saved=await rows(legacySale.orderId),base=saved.find(item=>item.menu_catalog_item_id===ids.menu);
    assert.equal(base.amount,800);assert.equal(base.measured_quantity,200);assert.equal(base.measured_unit,'g');assert.equal(base.measured_unit_price,4);
    for(const [id,quantity,total] of [[noodle,2,400],[premiumItem,2,1300],[ids.drink,1,350]]){
      const matching=saved.filter(item=>item.menu_catalog_item_id===id);assert.equal(matching.reduce((n,item)=>n+item.quantity,0),quantity);assert.equal(matching.reduce((n,item)=>n+item.amount,0),total);
      assert.ok(matching.every(item=>item.measured_quantity===null&&item.measured_unit_price===null));
    }
    // Existing source fixed-food kitchen/bowl classification is intentionally retained.
    legacyDocuments=await docs(legacySale.orderId);assert.equal(legacyDocuments.find(doc=>doc.kind==='receipt').payload.order.totalAmount,2850);
  });
  await check('client-cannot-turn-fixed-items-into-weight-or-override-source-price-by-injecting-weight-fields',async()=>{
    const items=legacyLines().map((item,index)=>index?{...item,measuredQuantity:999,weightMeasurement:{mode:'manual_net'},posPricingMode:'weight',posWeightUnitPrice:1,price:1,unitPrice:1,amount:1}:item);
    const sale=await checkout(items);assert.equal(sale.amount,2850);
    assert.ok((await rows(sale.orderId)).filter(item=>item.menu_catalog_item_id!==ids.menu).every(item=>item.measured_quantity===null));
    const before=await count('store_customer_orders');await checkout(legacyLines().map((item,index)=>index?item:{...item,measuredQuantity:undefined}),{},400);assert.equal(await count('store_customer_orders'),before);
  });
  await check('trusted-source-explicit-mode-wins-over-brand-setting-without-client-price-or-production-changes',async()=>{
    await db.query("update menu_catalog_items set variable_schema=jsonb_set(variable_schema,'{posWeightPricing,mode}','\"fixed\"') where id=$1",[ids.menu]);
    assert.equal((await getPos()).items.find(item=>item.id===ids.menu).posPricingMode,'fixed');
    const sale=await checkout(legacyLines().map((item,index)=>index?item:{...item,measuredQuantity:undefined}));assert.equal(sale.amount,2650);
    assert.equal((await rows(sale.orderId)).find(item=>item.menu_catalog_item_id===ids.menu).measured_quantity,null);
    await db.query("update menu_catalog_items set variable_schema=jsonb_set(variable_schema,'{posWeightPricing,mode}','\"weight\"') where id=$1",[ids.menu]);
    await db.query("update store_brands set pos_pricing_mode='fixed' where store_id=$1 and brand_id=$2",[ids.store,ids.brand]);
    assert.equal((await getPos()).items.find(item=>item.id===ids.menu).posPricingMode,'weight');assert.equal((await checkout(legacyLines())).amount,2850);
    await db.query("update store_brands set pos_pricing_mode='weight' where store_id=$1 and brand_id=$2",[ids.store,ids.brand]);
    assert.deepEqual(await sourceMasters(),masterBefore);
  });

  let menu=await edit({revision:''},{action:'initialize',mode:'source'});
  let localBase=bySource(menu,ids.menu),localNoodle=bySource(menu,noodle),localPremium=bySource(menu,premiumItem),localDrink=bySource(menu,ids.drink);
  await check('source-copy-and-on-demand-import-preserve-fixed-portion-prices-and-explicit-weighed-base',async()=>{
    assert.equal(localBase.posPricingMode,'weight');assert.equal(localBase.posWeightUnitPrice,4);assert.equal(localNoodle.posPricingMode,'fixed');assert.equal(localPremium.posPricingMode,'fixed');assert.equal(localDrink.posPricingMode,'fixed');
    assert.equal(localNoodle.price,200);assert.equal(localPremium.price,650);
    menu=await edit(menu,{action:'importItem',sourceItemId:noodle,name:'追加の春雨 50g'});const imported=menu.catalog.items.find(item=>item.name==='追加の春雨 50g');
    assert.equal(imported.posPricingMode,'fixed');assert.equal(imported.price,200);assert.equal(imported.sourceItemId,noodle);
    assert.deepEqual(await sourceMasters(),masterBefore);assert.deepEqual(await publicMenus(),publicBefore);
  });
  await check('previously-copied-json-weight-mode-on-fixed-food-is-normalized-in-editor-and-pos-without-updating-shared-menu',async()=>{
    const old=clone(menu.catalog);for(const item of old.items.filter(item=>[noodle,premiumItem,ids.drink].includes(item.sourceItemId))){item.posPricingMode='weight';delete item.posPricingOverride;}
    await db.query('update store_dine_in_menus set catalog=$3::jsonb where store_id=$1 and brand_id=$2',[ids.store,ids.brand,JSON.stringify(old)]);
    menu=await getMenu();const runtime=(await getPos()).dineInMenu;
    for(const id of [localNoodle.id,localPremium.id,localDrink.id]){assert.equal(menu.catalog.items.find(item=>item.id===id).posPricingMode,'fixed');assert.equal(runtime.items.find(item=>item.id===id).posPricingMode,'fixed');}
    const soup=menu.catalog.optionGroups.find(group=>group.menuCatalogItemId===localBase.id&&group.sourceGroupId===ids.optionGroup);
    const sale=await checkout([{menuCatalogItemId:localBase.id,quantity:1,measuredQuantity:200,weightMeasurement:{mode:'manual_net'},selectedOptions:[{groupId:soup.id,optionIds:[soup.options[0].id]}]},
      ...[[localNoodle,2],[localPremium,2],[localDrink,1]].map(([item,quantity])=>({menuCatalogItemId:item.id,quantity,selectedOptions:[]}))]);
    assert.equal(sale.amount,2850);assert.deepEqual(await sourceMasters(),masterBefore);
  });
  await check('store-owned-explicit-fixed-mode-wins-over-imported-weight-schema-without-changing-source-rule-or-production',async()=>{
    menu=await edit(menu,{action:'setItemPricing',targetId:localBase.id,pricingMode:'fixed'});localBase=menu.catalog.items.find(item=>item.id===localBase.id);
    assert.equal(localBase.variableSchema.posWeightPricing.mode,'weight');assert.equal(localBase.posPricingOverride,'fixed');assert.equal(localBase.posPricingMode,'fixed');assert.equal(localBase.productionType,'bowl');assert.equal(localBase.price,600);
    const current=await getPos();assert.equal(current.dineInMenu.items.find(item=>item.id===localBase.id).posPricingMode,'fixed');assert.equal(menu.source.items.find(item=>item.id===ids.menu).posPricingMode,'weight');
    menu=await edit(menu,{action:'setItemPricing',targetId:localBase.id,pricingMode:'weight'});assert.deepEqual(await sourceMasters(),masterBefore);
  });

  let category,newBase,newNoodle,newPremium,newDrink;
  await check('new-base-can-explicitly-use-trusted-store-weight-while-new-noodles-addons-and-drinks-default-to-fixed',async()=>{
    menu=await edit(menu,{action:'createCategory',name:'店内の単品'});category=menu.catalog.categories.find(item=>item.name==='店内の単品');
    for(const [name,itemKind,price,pricingMode] of [['新しい量り売りベース','buildable_product',0,'weight'],['店内春雨 50g','fixed_product',200,undefined],['店内牛筋 50g','fixed_product',650,'fixed'],['店内レモン茶','drink',350,undefined]]){
      menu=await edit(menu,{action:'createItem',name,categoryId:category.id,itemKind,price,...(pricingMode?{pricingMode}:{})});
    }
    [newBase,newNoodle,newPremium,newDrink]=['新しい量り売りベース','店内春雨 50g','店内牛筋 50g','店内レモン茶'].map(name=>menu.catalog.items.find(item=>item.name===name));
    assert.equal(newBase.posPricingMode,'weight');assert.equal(newBase.posWeightUnitPrice,4);assert.equal(newBase.posWeightUnit,'g');assert.equal(newBase.productionType,'bowl');
    for(const item of [newNoodle,newPremium,newDrink])assert.equal(item.posPricingMode,'fixed');assert.equal(newNoodle.productionType,'item');assert.equal(newPremium.productionType,'item');assert.equal(newDrink.productionType,'drink');
    const canonical=(await db.query('select store_id::text,variable_schema from menu_catalog_items where id=$1',[newBase.sourceItemId])).rows[0];assert.equal(canonical.store_id,ids.store);assert.equal(canonical.variable_schema.storeDineInOnly,true);
  });
  const newLines=()=>[
    {menuCatalogItemId:newBase.id,quantity:1,measuredQuantity:200,weightMeasurement:{mode:'manual_net'},selectedOptions:[]},
    {menuCatalogItemId:newNoodle.id,quantity:2,selectedOptions:[]},{menuCatalogItemId:newPremium.id,quantity:2,selectedOptions:[]},{menuCatalogItemId:newDrink.id,quantity:1,selectedOptions:[]}
  ];
  let mixedSale,mixedDocuments;
  await check('new-mixed-menu-checkout-is-2850-with-one-weighed-bowl-and-two-unweighed-fifty-gram-portions',async()=>{
    mixedSale=await checkout(newLines());assert.equal(mixedSale.amount,2850);assert.equal(mixedSale.servingTickets.length,1);
    const saved=await rows(mixedSale.orderId);assert.equal(saved.length,4);
    for(const [item,quantity,amount] of [[newBase,1,800],[newNoodle,2,400],[newPremium,2,1300],[newDrink,1,350]]){
      const row=saved.find(row=>row.menu_catalog_item_id===item.sourceItemId);assert.ok(row);assert.equal(row.quantity,quantity);assert.equal(row.amount,amount);assert.equal(row.measured_quantity,item.id===newBase.id?200:null);
    }
    mixedDocuments=await docs(mixedSale.orderId);assert.equal(mixedDocuments.filter(doc=>doc.kind==='pickup').length,1);assert.equal(mixedDocuments.filter(doc=>doc.kind==='finishing').length,1);
    // Non-bowl food retains its separate ordinary kitchen document, without
    // borrowing or multiplying the weighed base's bowl pickup codes.
    assert.ok(mixedDocuments.some(doc=>doc.kind==='kitchen'));assert.equal(mixedDocuments.filter(doc=>doc.kind==='receipt').length,1);
    const receipt=mixedDocuments.find(doc=>doc.kind==='receipt').payload.order;assert.equal(receipt.totalAmount,2850);assert.equal(receipt.items.find(item=>item.name===newNoodle.name).quantity,2);assert.equal(receipt.items.find(item=>item.name===newPremium.name).quantity,2);
  });
  await check('local-fixed-food-cannot-be-forced-to-weight-and-new-base-still-requires-weight-on-server',async()=>{
    const sale=await checkout(newLines().map((line,index)=>index?{...line,measuredQuantity:999,posPricingMode:'weight',posWeightUnitPrice:0.01,weightMeasurement:{mode:'manual_net'}}:line));assert.equal(sale.amount,2850);
    const saved=await rows(sale.orderId);assert.ok(saved.filter(item=>item.menu_catalog_item_id!==newBase.sourceItemId).every(item=>item.measured_quantity===null));
    const before=await count('store_customer_orders');await checkout(newLines().map((line,index)=>index?line:{...line,measuredQuantity:undefined}),{},400);assert.equal(await count('store_customer_orders'),before);
  });
  await check('pre-pricing-policy-client-catalog-revision-is-rejected-before-any-new-order-or-document-is-written',async()=>{
    const old=(await db.query("select md5(coalesce(string_agg(brand_id::text||':'||revision::text||':'||enabled::text||':'||md5(catalog::text),',' order by brand_id),'')) as revision from store_dine_in_menus where store_id=$1",[ids.store])).rows[0].revision;
    assert.notEqual(old,(await getPos()).dineInMenuRevision);const before=[await count('store_customer_orders'),await count('pos_print_documents')];
    await checkout(newLines(),{dineInMenuRevision:old},409);assert.deepEqual([await count('store_customer_orders'),await count('pos_print_documents')],before);
  });
  await check('per-item-pricing-edit-preserves-zero-fixed-price-source-rate-and-production-independent-of-mode',async()=>{
    const oldPos=await getPos(),command={action:'setItemPricing',targetId:newBase.id,pricingMode:'fixed',revision:menu.revision,operationId:operation()};
    menu=await json(f.mutateMenu(command));newBase=menu.catalog.items.find(item=>item.id===newBase.id);assert.equal(newBase.posPricingMode,'fixed');assert.equal(newBase.posPricingOverride,'fixed');assert.equal(newBase.price,0);assert.equal(newBase.productionType,'bowl');
    const replay=await json(f.mutateMenu(command));assert.deepEqual(replay.catalog,menu.catalog);await json(f.mutateMenu({...command,pricingMode:'weight'}),409);
    await checkout(newLines(),{dineInMenuRevision:oldPos.dineInMenuRevision},409);
    const fixedSale=await checkout(newLines().map((line,index)=>index?line:{...line,measuredQuantity:undefined}));assert.equal(fixedSale.amount,2050);assert.equal(fixedSale.servingTickets.length,1);
    assert.equal((await rows(fixedSale.orderId)).find(item=>item.menu_catalog_item_id===newBase.sourceItemId).measured_quantity,null);
    assert.deepEqual(await docs(mixedSale.orderId),mixedDocuments);assert.deepEqual(await docs(legacySale.orderId),legacyDocuments);
  });
  await check('pricing-action-rejects-client-unit-rate-price-foreign-scope-and-drink-weight-without-writing',async()=>{
    const snapshot=clone(menu.catalog),operations=await count('store_dine_in_menu_operations');
    for(const change of [
      {targetId:newBase.id,pricingMode:'weight',posWeightUnitPrice:0.01},{targetId:newBase.id,pricingMode:'weight',unitPrice:0.01},
      {targetId:newBase.id,pricingMode:'weight',price:1},{targetId:newBase.id,pricingMode:'weight',posWeightUnit:'kg'},
      {targetId:newBase.id,pricingMode:'other'},{targetId:newDrink.id,pricingMode:'weight'},
      {targetId:ids.otherItem,pricingMode:'weight'},{targetId:newBase.id,pricingMode:'weight',storeId:ids.other}
    ]){const response=await f.mutateMenu({action:'setItemPricing',revision:menu.revision,operationId:operation(),...change});assert.ok([400,403,404].includes(response.status),`${JSON.stringify(change)}: ${response.status} ${await response.text()}`);}
    await edit(menu,{action:'createItem',name:'wrong weighed drink',categoryId:category.id,itemKind:'drink',price:350,pricingMode:'weight'},400);
    assert.deepEqual((await getMenu()).catalog,snapshot);assert.equal(await count('store_dine_in_menu_operations'),operations);
    const session=state.session;state.session=null;await edit(menu,{action:'setItemPricing',targetId:newBase.id,pricingMode:'weight'},401);state.session=session;
    state.permitted=false;await edit(menu,{action:'setItemPricing',targetId:newBase.id,pricingMode:'weight'},403);state.permitted=true;
  });
  await check('setting-weight-requires-positive-trusted-store-rate-and-rejects-rate-race-at-transaction-boundary',async()=>{
    const snapshot=clone(menu.catalog),before=await count('store_dine_in_menu_operations');
    await db.query('update store_brands set pos_weight_unit_price=0 where store_id=$1 and brand_id=$2',[ids.store,ids.brand]);
    await edit(menu,{action:'setItemPricing',targetId:newBase.id,pricingMode:'weight'},400);
    await db.query('update store_brands set pos_weight_unit_price=4 where store_id=$1 and brand_id=$2',[ids.store,ids.brand]);
    const original=f.sql.transaction;
    f.sql.transaction=async statements=>{f.sql.transaction=original;await db.query('update store_brands set pos_weight_unit_price=5 where store_id=$1 and brand_id=$2',[ids.store,ids.brand]);return original(statements);};
    try{await edit(menu,{action:'setItemPricing',targetId:newBase.id,pricingMode:'weight'},409);}finally{f.sql.transaction=original;await db.query('update store_brands set pos_weight_unit_price=4 where store_id=$1 and brand_id=$2',[ids.store,ids.brand]);}
    assert.deepEqual((await getMenu()).catalog,snapshot);assert.equal(await count('store_dine_in_menu_operations'),before);
  });
  await check('weight-reenable-captures-trusted-rate-and-checkout-cas-rejects-old-pricing-before-paid-snapshots-change',async()=>{
    const old=clone(menu);menu=await edit(menu,{action:'setItemPricing',targetId:newBase.id,pricingMode:'weight'});newBase=menu.catalog.items.find(item=>item.id===newBase.id);
    assert.equal(newBase.posPricingMode,'weight');assert.equal(newBase.posPricingOverride,'weight');assert.equal(newBase.posWeightUnitPrice,4);assert.equal(newBase.posWeightUnit,'g');
    await edit(old,{action:'setItemPricing',targetId:newNoodle.id,pricingMode:'weight'},409);
    const sale=await checkout(newLines());assert.equal(sale.amount,2850);assert.deepEqual(await docs(mixedSale.orderId),mixedDocuments);
  });
  await check('pricing-edits-and-new-store-canonicals-leave-public-web-delivery-source-prices-and-other-stores-unchanged',async()=>{
    assert.deepEqual(await sourceMasters(),masterBefore);assert.deepEqual(await publicMenus(),publicBefore);
    assert.equal((await db.query('select count(*)::int n from store_dine_in_menus where store_id<>$1',[ids.store])).rows[0].n,0);
    assert.equal(state.externalCalls,0);assert.deepEqual(await docs(legacySale.orderId),legacyDocuments);assert.deepEqual(await docs(mixedSale.orderId),mixedDocuments);
  });
  const files=['lib/pos-item-pricing.ts','lib/store-dine-in-menu-policy.ts','lib/store-dine-in-menu.ts','lib/store-dine-in-runtime.ts','app/api/os/menus/dine-in/route.ts','app/api/store/pos/route.ts','scripts/tests/store-dine-in-pricing-db.mjs'];
  const sourceHashes=Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(resolve(source,path))).digest('hex')])));
  const report={passed:results.length,results,source,sourceHashes,actualApi:true,actualPos:true,actualOrderForeignKey:true,actualImmutablePrints:true,isolatedDatabase:'PGlite',liveDatabaseAccess:false,externalCalls:0,mixedTotal:2850,limitation:'One-connection PGlite does not reproduce production multi-connection lock scheduling or physical device behavior.'};
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,output},null,2));
}catch(error){await writeFile(resolve(output,'failure.json'),JSON.stringify({passed:results.length,results,error:error.stack,source},null,2)+'\n');throw error;}finally{await db.close();}
