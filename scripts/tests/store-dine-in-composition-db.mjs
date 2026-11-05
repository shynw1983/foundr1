// Real OS menu handlers -> isolated PostgreSQL -> real POS/order/immutable-print handlers.
// This harness never reads production credentials, opens HTTP, or calls native devices.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createDineInMenuFixture,fixtureUuid as uuid} from './store-dine-in-menu-fixture.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-composition-db');
await mkdir(output,{recursive:true});
const results=[];let nextOperation=24000,nextSale=26000;const operation=()=>uuid(nextOperation++);
const json=async(response,status=200)=>{response=await response;assert.equal(response.status,status,await response.clone().text());return response.json();};
const clone=value=>JSON.parse(JSON.stringify(value));
const itemBySource=(menu,id)=>menu.catalog.items.find(item=>item.sourceItemId===id);
const groupBySource=(menu,id)=>menu.catalog.optionGroups.find(group=>group.sourceGroupId===id);
const optionsOf=(menu,item)=>menu.catalog.optionGroups.filter(group=>item.optionGroupIds.includes(group.id)).flatMap(group=>group.options);
async function check(name,fn){await fn();results.push({name,passed:true});console.log(`PASS ${name}`);}

async function harness(){
  const f=await createDineInMenuFixture(source);await f.installMigration();
  const {ids,db}=f;
  // Keep genuine FK enforcement for the critical new-canonical-ID order write.
  await db.exec('alter table store_customer_order_items add constraint composition_menu_fk foreign key(menu_catalog_item_id) references menu_catalog_items(id)');
  // Both compatibility readers are exercised, with a real, separate nanacha catalog.
  await db.query("update brands set name='nanacha' where id=$1",[ids.secondBrand]);
  await db.query('insert into store_brands(store_id,brand_id) values($1,$2)',[ids.other,ids.brand]);
  await db.query("insert into menu_catalog_items(id,brand_id,name,item_kind,base_price) values($1,$2,'既存nanacha茶','drink',420)",[uuid(24100),ids.secondBrand]);
  const pos=f.reloadPos();
  const menu=()=>json(f.getMenu());
  const edit=(current,change,status=200)=>json(f.mutateMenu({revision:current.revision,operationId:operation(),...change}),status);
  const getPos=()=>json(pos.GET(f.request(`/api/store/pos?storeId=${ids.store}`)));
  const count=async table=>Number((await db.query(`select count(*)::int n from ${table}`)).rows[0].n);
  const sourceMasters=async()=>{
    const value=await f.masterSnapshot();value.menu_catalog_items=value.menu_catalog_items.filter(row=>!row.variable_schema?.storeDineInOnly);return value;
  };
  const publicMenus=async()=>{
    const out={};
    for(const [label,path] of [
      ['standard-brand',`/api/public/menus?brand=${ids.brand}`],['standard-store',`/api/public/menus?brand=${ids.brand}&store=${ids.store}`],
      ['standard-other-store',`/api/public/menus?brand=${ids.brand}&store=${ids.other}`],
      ['maamaa-compat-brand','/api/public/menus/maamaa-compatible'],['maamaa-compat-store',`/api/public/menus/maamaa-compatible?store=${ids.store}`],
      ['nanacha-compat-brand','/api/public/menus/nanacha-compatible'],['nanacha-compat-store',`/api/public/menus/nanacha-compatible?store=${ids.store}`]
    ]){
      const route=path.startsWith('/api/public/menus?')?'app/api/public/menus/route.ts':`app${path.split('?')[0]}/route.ts`;
      const body=await json(await f.load(route).GET(f.request(path)));delete body.generatedAt;out[label]=body;
    }
    return out;
  };
  let lastBody;
  async function checkout(items,patch={},status=200){
    const current=await getPos();lastBody={...f.baseBody,discountPresetKey:'',orderType:'eat_in',cashTenderedAmount:10000,receiptRequested:true,
      offlineClientOrderId:uuid(nextSale++),posMenuRevision:current.posMenuRevision,dineInMenuRevision:current.dineInMenuRevision,items,...patch};
    return json(await pos.POST(f.request('/api/store/pos',lastBody)),status);
  }
  const docs=async id=>(await db.query('select kind,state,payload from pos_print_documents where order_id=$1 order by sequence',[id])).rows;
  const orderItems=async id=>(await db.query('select id::text,menu_catalog_item_id::text,item_name,quantity::int,measured_quantity::float,amount::int,customizations from store_customer_order_items where order_id=$1 order by sort_order',[id])).rows;
  return {...f,menu,edit,getPos,count,sourceMasters,publicMenus,checkout,docs,orderItems,lastBody:()=>clone(lastBody)};
}

try{
  const f=await harness();
  try{
    const {ids,db}=f,before=await f.sourceMasters(),publicBefore=await f.publicMenus(),counterBefore=await f.getPos();
    let menu;
    await check('empty-initialize-is-explicit-idempotent-and-copies-no-brand-items-groups-or-categories',async()=>{
      const command={action:'initialize',mode:'empty',revision:'',operationId:operation()};
      menu=await json(await f.mutateMenu(command));assert.equal(menu.enabled,false);assert.equal(menu.revision,'1');
      assert.equal(menu.catalog.items.length,0);assert.equal(menu.catalog.optionGroups.length,0);assert.equal(menu.catalog.categories.length,0);
      assert.ok(menu.source.items.some(item=>item.id===ids.menu));assert.equal(await f.count('store_dine_in_menus'),1);
      const replay=await json(await f.mutateMenu(command));assert.deepEqual(replay.catalog,menu.catalog);assert.equal(await f.count('store_dine_in_menu_operations'),1);
      await json(await f.mutateMenu({...command,mode:'source'}),409);
      await f.edit(menu,{action:'initialize',mode:'source'},409);
      assert.deepEqual(await f.sourceMasters(),before);
    });
    let category,drink,fixed,bowl,soup;
    await check('create-and-rename-store-category-propagates-only-local-product-placement',async()=>{
      menu=await f.edit(menu,{action:'createCategory',name:'店内ドリンク'});category=menu.catalog.categories.find(x=>x.name==='店内ドリンク');assert.ok(category);
      assert.notEqual(category.id,ids.categoryDrink);assert.equal(category.brandId,ids.brand);
      await f.edit(menu,{action:'createCategory',name:'店内ドリンク'},400);
      const command={action:'createItem',name:'手作りレモン水',categoryId:category.id,itemKind:'drink',price:350,revision:menu.revision,operationId:operation()};
      menu=await json(await f.mutateMenu(command));drink=menu.catalog.items.find(item=>item.name===command.name);assert.ok(drink);
      const replay=await json(await f.mutateMenu(command));assert.equal(replay.catalog.items.filter(item=>item.name===command.name).length,1);
      menu=await f.edit(menu,{action:'rename',kind:'category',targetId:category.id,name:'店内の飲みもの'});
      drink=menu.catalog.items.find(item=>item.id===drink.id);assert.equal(drink.category,'店内の飲みもの');assert.equal(menu.catalog.categories[0].name,'店内の飲みもの');
      assert.deepEqual(await f.sourceMasters(),before);
    });
    await check('new-drink-and-fixed-product-have-real-store-owned-canonical-fks-fixed-prices-and-explicit-nonbowl-production',async()=>{
      menu=await f.edit(menu,{action:'createItem',name:'店内デザート',categoryId:category.id,itemKind:'fixed_product',price:280});fixed=menu.catalog.items.find(item=>item.name==='店内デザート');
      for(const item of [drink,fixed]){
        const row=(await db.query('select id::text,brand_id::text,store_id::text,name,item_kind,base_price::int,variable_schema from menu_catalog_items where id=$1',[item.sourceItemId])).rows[0];
        assert.ok(row);assert.equal(row.store_id,ids.store);assert.equal(row.brand_id,ids.brand);assert.equal(row.variable_schema.storeDineInOnly,true);
        assert.equal(row.base_price,item.price);assert.equal(item.posPricingMode,'fixed');assert.equal(item.posWeightUnitPrice,null);assert.equal(item.optionGroupIds.length,0);
        assert.equal(f.load('lib/pos-serving-policy.ts').isPosBowl(item),false);
      }
      assert.equal(drink.productionType,'drink');assert.equal(fixed.productionType,'item');assert.equal(await f.count('menu_catalog_items'),before.menu_catalog_items.length+2);
    });
    await check('new-create-and-import-payloads-reject-price-rule-source-scope-and-input-tampering-without-writing',async()=>{
      const counts=[await f.count('menu_catalog_items'),await f.count('store_dine_in_menu_operations')];
      for(const change of [
        {action:'createItem',name:'bad',categoryId:category.id,itemKind:'drink',price:-1},
        {action:'createItem',name:'bad',categoryId:category.id,itemKind:'drink',price:1.2},
        {action:'createItem',name:'bad',categoryId:ids.category,itemKind:'drink',price:1},
        {action:'createItem',name:'bad',categoryId:category.id,itemKind:'information',price:1},
        {action:'createItem',name:'bad',categoryId:category.id,itemKind:'drink',price:1,sourceItemId:ids.menu},
        {action:'createItem',name:'bad',categoryId:category.id,itemKind:'drink',price:1,storeId:ids.other},
        {action:'importItem',sourceItemId:ids.otherItem},
        {action:'importItem',sourceItemId:ids.menu,price:1},
        {action:'importItem',sourceItemId:ids.menu,variableSchema:{posWeightPricing:{unitPrice:1}}}
      ]){
        const response=await f.mutateMenu({revision:menu.revision,operationId:operation(),...change});assert.ok([400,403,404].includes(response.status),`${JSON.stringify(change)}: ${response.status} ${await response.text()}`);
      }
      assert.deepEqual([await f.count('menu_catalog_items'),await f.count('store_dine_in_menu_operations')],counts);assert.deepEqual((await f.menu()).catalog,menu.catalog);
      const session=f.state.session;f.state.session=null;await f.edit(menu,{action:'createCategory',name:'unauth'},401);f.state.session=session;
      f.state.permitted=false;await f.edit(menu,{action:'createItem',name:'denied',categoryId:category.id,itemKind:'drink',price:10},403);f.state.permitted=true;
      await json(await f.mutateMenu({revision:menu.revision,operationId:operation(),action:'createCategory',name:'csrf'},{origin:'https://foreign.invalid'}),403);
    });
    await check('failed-catalog-write-rolls-back-new-canonical-item-and-stale-creation-cannot-leave-orphan-source-record',async()=>{
      const counts=[await f.count('menu_catalog_items'),await f.count('store_dine_in_menu_operations')],snapshot=clone(menu.catalog);
      f.state.failPattern=/update store_dine_in_menus set catalog/;
      try{await f.edit(menu,{action:'createItem',name:'rollback drink',categoryId:category.id,itemKind:'drink',price:199},500);}finally{f.state.failPattern=null;}
      assert.deepEqual([await f.count('menu_catalog_items'),await f.count('store_dine_in_menu_operations')],counts);assert.deepEqual((await f.menu()).catalog,snapshot);
      const original=f.sql.transaction;
      f.sql.transaction=async statements=>{
        f.sql.transaction=original;await db.query('update store_dine_in_menus set revision=revision+1 where store_id=$1 and brand_id=$2',[ids.store,ids.brand]);return original(statements);
      };
      try{await f.edit(menu,{action:'createItem',name:'racing drink',categoryId:category.id,itemKind:'drink',price:199},409);}finally{f.sql.transaction=original;}
      assert.deepEqual([await f.count('menu_catalog_items'),await f.count('store_dine_in_menu_operations')],counts);menu=await f.menu();assert.deepEqual(menu.catalog,snapshot);
    });
    await check('on-demand-source-import-copies-only-selected-item-and-preserves-price-four-yen-weight-and-fifty-gram-rules',async()=>{
      const canonicalCount=await f.count('menu_catalog_items');menu=await f.edit(menu,{action:'importItem',sourceItemId:ids.menu,name:'店内マーラータン'});
      bowl=itemBySource(menu,ids.menu);soup=menu.catalog.optionGroups.find(group=>group.menuCatalogItemId===bowl.id&&group.sourceGroupId===ids.optionGroup);
      assert.equal(bowl.name,'店内マーラータン');assert.equal(bowl.price,600);assert.equal(bowl.posPricingMode,'weight');assert.equal(bowl.posWeightUnitPrice,4);assert.equal(bowl.productionType,'bowl');
      assert.ok(soup);assert.ok(!menu.catalog.items.some(item=>item.sourceItemId===ids.drink));assert.equal(menu.catalog.items.length,3);assert.equal(await f.count('menu_catalog_items'),canonicalCount);
      const premium=menu.catalog.optionGroups.find(group=>bowl.optionGroupIds.includes(group.id)&&group.sourceGroupId===ids.premiumGroup);
      assert.equal(premium.ruleJson.portionGrams,50);assert.equal(premium.options.find(option=>option.sourceOptionId===ids.beef).priceDelta,650);
      assert.deepEqual(await f.sourceMasters(),before);
      assert.equal(menu.enabled,false);const paused=await f.getPos();assert.ok(!paused.dineInMenu?.items?.some(item=>item.id===drink.id));
      menu=await f.edit(menu,{action:'setEnabled',enabled:true});assert.equal(menu.enabled,true);
    });
    await check('public-standard-both-compatibility-readers-counter-and-other-store-cannot-see-store-only-canonicals',async()=>{
      assert.deepEqual(await f.publicMenus(),publicBefore);const current=await f.getPos();
      assert.deepEqual(current.items,counterBefore.items);assert.deepEqual(current.optionGroups,counterBefore.optionGroups);
      for(const item of [drink,fixed]){
        assert.ok(current.dineInMenu.items.some(x=>x.id===item.id));assert.ok(!current.items.some(x=>x.id===item.sourceItemId||x.id===item.id));
        assert.ok(!JSON.stringify(await f.publicMenus()).includes(item.sourceItemId));assert.ok(!JSON.stringify(await f.publicMenus()).includes(item.name));
      }
      assert.equal((await db.query('select count(*)::int n from store_dine_in_menus where store_id<>$1',[ids.store])).rows[0].n,0);
    });
    await check('ordinary-brand-menu-write-delete-and-sort-cannot-edit-store-only-canonical-records',async()=>{
      // These unrelated imports are deliberately unavailable to prove that the
      // dedicated ownership guard returns before any brand publishing operation.
      f.modules.headers={cookies:async()=>({get:()=>undefined})};
      f.modules['menu-progress']={readMenuProgress(){throw new Error('Unexpected brand progress read');}};
      f.modules['delivery-menu-publishing']={deliveryPlatformRules:[]};
      const ordinary=f.load('app/api/menus/route.ts'),snapshot=await f.masterSnapshot();
      const paid=await f.checkout([{menuCatalogItemId:drink.id,quantity:1,selectedOptions:[]}]);
      const orderBefore=await f.orderItems(paid.orderId),documentsBefore=await f.docs(paid.orderId);
      for(const body of [
        {kind:'item',id:drink.sourceItemId,name:'override',basePrice:1},
        {kind:['item'],id:drink.sourceItemId,name:'array kind override',basePrice:1,brandId:ids.brand,storeId:'',itemKind:'drink',variableSchema:{}},
        {kind:'sortOrder',itemIds:[ids.menu,drink.sourceItemId]},
        {kind:'sortOrder',itemIds:[` ${drink.sourceItemId} `]},
        {kind:['sortOrder'],itemIds:[` ${drink.sourceItemId} `]},
        {kind:'item',name:'injected',variableSchema:{storeDineInOnly:true}}
      ]){
        await json(await ordinary.POST(f.request('/api/menus',body)),409);
      }
      await json(await ordinary.DELETE(new Request('http://isolated.test/api/menus',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'item',id:drink.sourceItemId})})),409);
      await json(await ordinary.DELETE(new Request('http://isolated.test/api/menus',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({kind:['item'],id:` ${drink.sourceItemId} `})})),409);
      assert.deepEqual(await f.masterSnapshot(),snapshot);assert.deepEqual((await f.menu()).catalog,menu.catalog);
      assert.deepEqual(await f.orderItems(paid.orderId),orderBefore);assert.deepEqual(await f.docs(paid.orderId),documentsBefore);
      const canonical=(await db.query('select store_id::text,variable_schema from menu_catalog_items where id=$1',[drink.sourceItemId])).rows[0];
      assert.equal(canonical.store_id,ids.store);assert.equal(canonical.variable_schema.storeDineInOnly,true);
    });
    const bowlLine=()=>({menuCatalogItemId:bowl.id,quantity:1,measuredQuantity:250,weightMeasurement:{mode:'manual_net'},selectedOptions:[{groupId:soup.id,optionIds:[soup.options[0].id]}]});
    let sale,savedDocs;
    await check('existing-maamaa-drink-only-policy-stays-fixed-without-bowl-codes-while-counter-and-canonical-id-bypasses-reject',async()=>{
      const drinkSale=await f.checkout([{menuCatalogItemId:drink.id,quantity:1,selectedOptions:[]}]);assert.equal(drinkSale.amount,350);assert.equal(drinkSale.servingTickets.length,0);
      const count=await f.count('store_customer_orders');
      await f.checkout([bowlLine(),{menuCatalogItemId:drink.id,quantity:1,selectedOptions:[]}],{orderType:'takeout'},400);
      await f.checkout([bowlLine(),{menuCatalogItemId:drink.sourceItemId,quantity:1,selectedOptions:[]}],{},400);
      await f.checkout([{menuCatalogItemId:uuid(24100),quantity:1,selectedOptions:[]}],{},400);
      assert.equal(await f.count('store_customer_orders'),count);
    });
    await check('mixed-bowl-new-drink-fixed-item-checkout-persists-valid-canonical-ids-and-only-one-bowl-ticket-set',async()=>{
      sale=await f.checkout([bowlLine(),{menuCatalogItemId:drink.id,quantity:2,selectedOptions:[]},{menuCatalogItemId:fixed.id,quantity:1,selectedOptions:[]}]);
      assert.equal(sale.amount,1980);assert.equal(sale.servingTickets.length,1);
      const rows=await f.orderItems(sale.orderId);assert.equal(rows.length,3);assert.equal(rows.find(x=>x.menu_catalog_item_id===drink.sourceItemId).quantity,2);assert.equal(rows.find(x=>x.menu_catalog_item_id===drink.sourceItemId).measured_quantity,null);
      assert.equal(rows.find(x=>x.menu_catalog_item_id===fixed.sourceItemId).amount,280);
      const summary=(await db.query('select customer_summary from store_customer_orders where id=$1',[sale.orderId])).rows[0].customer_summary;
      assert.equal(summary.items.find(x=>x.menuCatalogItemId===drink.sourceItemId).productionType,'drink');assert.equal(summary.items.find(x=>x.menuCatalogItemId===fixed.sourceItemId).productionType,'item');
      savedDocs=await f.docs(sale.orderId);assert.equal(savedDocs.filter(x=>x.kind==='pickup').length,1);assert.equal(savedDocs.filter(x=>x.kind==='finishing').length,1);
      const receipt=savedDocs.find(x=>x.kind==='receipt');assert.equal(receipt.payload.order.totalAmount,1980);assert.ok(JSON.stringify(receipt).includes(drink.name));assert.ok(JSON.stringify(receipt).includes(fixed.name));
    });
    await check('later-name-change-and-disable-leave-paid-order-and-reprint-snapshots-unchanged',async()=>{
      const oldRevision=menu.revision;menu=await f.edit(menu,{action:'rename',kind:'item',targetId:drink.id,name:'明日からのレモン水'});
      await f.edit({revision:oldRevision},{action:'createCategory',name:'stale'},409);
      assert.deepEqual(await f.docs(sale.orderId),savedDocs);assert.equal((await f.orderItems(sale.orderId)).find(row=>row.menu_catalog_item_id===drink.sourceItemId).item_name,drink.name);
      menu=await f.edit(menu,{action:'setEnabled',enabled:false});assert.ok(!(await f.getPos()).dineInMenu?.items?.some(x=>x.id===drink.id));
      await f.checkout([bowlLine(),{menuCatalogItemId:drink.id,quantity:1,selectedOptions:[]}],{},400);assert.deepEqual(await f.docs(sale.orderId),savedDocs);
      assert.deepEqual(await f.sourceMasters(),before);assert.deepEqual(await f.publicMenus(),publicBefore);
    });
    assert.equal(f.state.externalCalls,0);
  }finally{await f.db.close();}

  const f2=await harness();
  try{
    const {ids,db}=f2,extraGroup=uuid(24200),extraOption=uuid(24201),extraRemaining=uuid(24202),heatGroup=uuid(24203),heatOption=uuid(24204),numbGroup=uuid(24205),numbOption=uuid(24206),noodleGroup=uuid(24207),noodleOption=uuid(24208),requiredGroup=uuid(24209),requiredOption=uuid(24210),foreignGroup=uuid(24211),foreignOption=uuid(24212);
    for(const [id,key,name,min] of [[extraGroup,'counter-ingredient','追加きのこ',0],[heatGroup,'heat','辛さ',0],[numbGroup,'numb','しびれ',0],[noodleGroup,'noodle-replacement','麺の選択',0],[requiredGroup,'required-topping','必須食材',1]]){
      await db.query('insert into menu_option_groups(id,brand_id,group_key,name,selection_type,rule_json) values($1,$2,$3,$4,$5,$6::jsonb)',[id,ids.brand,key,name,min?'single':'multiple',JSON.stringify({minSelections:min,maxSelections:min?1:9,portionGrams:50})]);
    }
    await db.query('insert into menu_option_groups(id,brand_id,group_key,name,selection_type) values($1,$2,$3,$4,$5)',[foreignGroup,ids.otherBrand,'foreign-topping','他店追加','multiple']);
    for(const [id,group,key,name,price] of [[extraOption,extraGroup,'mushroom','きくらげ 50g',120],[extraRemaining,extraGroup,'tofu','豆腐 50g',90],[heatOption,heatGroup,'hot','辛口',0],[numbOption,numbGroup,'numb','しびれ普通',0],[noodleOption,noodleGroup,'noodle','春雨 50g',200],[requiredOption,requiredGroup,'must','必須の具 50g',10],[foreignOption,foreignGroup,'foreign','他店高級具 50g',999]]){
      await db.query('insert into menu_options(id,option_group_id,option_key,name,price_delta) values($1,$2,$3,$4,$5)',[id,group,key,name,price]);
    }
    await db.query('insert into menu_pos_settings(store_id,brand_id,group_id,visible) values($1,$2,$3,true)',[ids.store,ids.brand,requiredGroup]);
    const before=await f2.sourceMasters(),publicBefore=await f2.publicMenus();let menu=await f2.edit({revision:''},{action:'initialize',mode:'source'});
    let bowl=itemBySource(menu,ids.menu),premium=groupBySource(menu,ids.premiumGroup),extra=groupBySource(menu,extraGroup),soup=groupBySource(menu,ids.optionGroup),required=groupBySource(menu,requiredGroup),addon,other;
    const beef=premium.options.find(x=>x.sourceOptionId===ids.beef),mushroom=extra.options.find(x=>x.sourceOptionId===extraOption);
    await check('source-initialize-remains-compatible-and-derived-item-keeps-independent-required-options',async()=>{
      assert.equal(bowl.posWeightUnitPrice,4);assert.equal(premium.ruleJson.portionGrams,50);
      menu=await f2.edit(menu,{action:'duplicate',kind:'item',targetId:bowl.id,name:'もう一つの店内碗'});other=menu.catalog.items.find(x=>x.name==='もう一つの店内碗');
      assert.ok(other.optionGroupIds.includes(premium.id));assert.ok(other.optionGroupIds.includes(extra.id));
      const otherSoup=menu.catalog.optionGroups.find(x=>x.menuCatalogItemId===other.id&&x.sourceGroupId===ids.optionGroup);assert.ok(otherSoup);assert.notEqual(otherSoup.id,soup.id);
    });
    const otherGraph=()=>{const item=menu.catalog.items.find(x=>x.id===other.id);return clone({item,groups:menu.catalog.optionGroups.filter(x=>item.optionGroupIds.includes(x.id))});};
    const originalOther=otherGraph();
    await check('cross-source-optional-ingredients-move-to-new-unified-group-preserving-canonical-option-group-lineage-price-and-fifty-gram-labels',async()=>{
      const command={action:'createAddonGroup',name:'追加食材',itemId:bowl.id,optionIds:[beef.id,mushroom.id],revision:menu.revision,operationId:operation()};
      menu=await json(await f2.mutateMenu(command));addon=menu.catalog.optionGroups.find(x=>x.localKind==='addon');bowl=menu.catalog.items.find(x=>x.id===bowl.id);
      assert.ok(addon);assert.equal(addon.menuCatalogItemId,bowl.id);assert.equal(addon.sourceGroupId,'');assert.equal(addon.selectionType,'quantity');assert.equal(addon.ruleJson.minSelections,0);assert.equal(addon.ruleJson.maxSelections,99);assert.equal(addon.ruleJson.allowRepeat,true);assert.equal(addon.ruleJson.perOptionMax,99);assert.equal(addon.posEnabled,true);
      assert.deepEqual(addon.options.map(x=>x.sourceOptionId).sort(),[ids.beef,extraOption].sort());assert.deepEqual(addon.options.map(x=>x.sourceGroupId).sort(),[ids.premiumGroup,extraGroup].sort());
      assert.equal(addon.options.find(x=>x.sourceOptionId===ids.beef).priceDelta,650);assert.equal(addon.options.find(x=>x.sourceOptionId===extraOption).priceDelta,120);assert.ok(addon.options.every(x=>x.name.endsWith('50g')));
      assert.ok(addon.options.every(option=>option.sourceGroupRuleJson.portionGrams===50));
      assert.ok(addon.options.every(x=>x.id!==beef.id&&x.id!==mushroom.id));
      assert.equal(optionsOf(menu,bowl).filter(x=>x.sourceOptionId===ids.beef).length,1);assert.equal(optionsOf(menu,bowl).filter(x=>x.sourceOptionId===extraOption).length,1);
      assert.deepEqual(otherGraph(),originalOther);assert.deepEqual(await f2.sourceMasters(),before);assert.deepEqual(await f2.publicMenus(),publicBefore);
      const replay=await json(await f2.mutateMenu(command));assert.deepEqual(replay.catalog,menu.catalog);await json(await f2.mutateMenu({...command,name:'changed'}),409);
    });
    await check('remaining-original-ingredients-stay-on-target-product-and-other-product-keeps-unchanged-full-groups',async()=>{
      const item=menu.catalog.items.find(x=>x.id===bowl.id),opts=optionsOf(menu,item);
      assert.ok(opts.some(x=>x.sourceOptionId===ids.pork));assert.ok(opts.some(x=>x.sourceOptionId===extraRemaining));
      assert.ok(!item.optionGroupIds.includes(premium.id));assert.ok(!item.optionGroupIds.includes(extra.id));
      const remainders=menu.catalog.optionGroups.filter(x=>item.optionGroupIds.includes(x.id)&&x.id!==addon.id&&[ids.premiumGroup,extraGroup].includes(x.sourceGroupId));
      assert.equal(remainders.length,2);assert.ok(remainders.every(x=>x.menuCatalogItemId===item.id));assert.deepEqual(otherGraph(),originalOther);
    });
    await check('required-flavor-heat-numb-noodle-and-foreign-options-cannot-enter-unified-ingredients-even-after-group-rename',async()=>{
      const heat=groupBySource(menu,heatGroup);menu=await f2.edit(menu,{action:'rename',kind:'group',targetId:heat.id,name:'任意の追加'});
      const illegal=[soup.options[0].id,groupBySource(menu,heatGroup).options[0].id,groupBySource(menu,numbGroup).options[0].id,groupBySource(menu,noodleGroup).options[0].id,required.options[0].id,foreignOption];
      const snapshot=clone(menu.catalog),count=await f2.count('store_dine_in_menu_operations');
      for(const id of illegal)await f2.edit(menu,{action:'importAddonOptions',targetId:addon.id,optionIds:[id]},400);
      await f2.edit(menu,{action:'importAddonOptions',targetId:addon.id,optionIds:[ids.beef]},400);
      await f2.edit(menu,{action:'importAddonOptions',targetId:addon.id,optionIds:[beef.id]},400);
      await f2.edit(menu,{action:'importAddonOptions',targetId:addon.id,optionIds:[uuid(24299)]},400);
      await f2.edit(menu,{action:'importAddonOptions',targetId:addon.id,optionIds:[mushroom.id],priceDelta:1},400);
      assert.deepEqual((await f2.menu()).catalog,snapshot);assert.equal(await f2.count('store_dine_in_menu_operations'),count);
      menu=await f2.edit(menu,{action:'rename',kind:'group',targetId:heat.id,name:'辛さ'});
    });
    await check('adding-more-from-remainders-is-idempotent-and-conflicting-catalog-writer-cannot-overwrite-newer-menu',async()=>{
      const item=menu.catalog.items.find(x=>x.id===bowl.id),pork=optionsOf(menu,item).find(x=>x.sourceOptionId===ids.pork);
      const command={action:'importAddonOptions',targetId:addon.id,optionIds:[pork.id],revision:menu.revision,operationId:operation()};
      const stale=clone(menu);menu=await json(await f2.mutateMenu(command));addon=menu.catalog.optionGroups.find(x=>x.id===addon.id);
      assert.equal(addon.options.filter(x=>x.sourceOptionId===ids.pork).length,1);assert.equal(addon.options.find(x=>x.sourceOptionId===ids.pork).priceDelta,550);
      const replay=await json(await f2.mutateMenu(command));assert.deepEqual(replay.catalog,menu.catalog);
      await f2.edit(stale,{action:'createAddonGroup',name:'stale',itemId:bowl.id,optionIds:[]},409);assert.deepEqual(otherGraph(),originalOther);
      const rev=menu.revision,responses=await Promise.all(['同時A','同時B'].map(name=>f2.mutateMenu({revision:rev,operationId:operation(),action:'createAddonGroup',name,itemId:bowl.id,optionIds:[]})));
      assert.deepEqual(responses.map(x=>x.status).sort(),[200,409]);menu=await f2.menu();
    });
    await check('unified-addons-reorder-persists-exact-local-permutation-preserves-source-specs-and-is-idempotent-with-cas',async()=>{
      addon=menu.catalog.optionGroups.find(group=>group.id===addon.id);
      const previous=clone(menu),beforeById=new Map(addon.options.map(({sortOrder,...option})=>[option.id,clone(option)]));
      const orderedIds=addon.options.map(option=>option.id).reverse(),command={action:'reorderAddonOptions',targetId:addon.id,optionIds:orderedIds,revision:menu.revision,operationId:operation()};
      menu=await json(await f2.mutateMenu(command));addon=menu.catalog.optionGroups.find(group=>group.id===addon.id);
      assert.deepEqual(addon.options.map(option=>option.id),orderedIds);assert.deepEqual(addon.options.map(option=>option.sortOrder),[0,1,2]);
      for(const {sortOrder,...option} of addon.options)assert.deepEqual(option,beforeById.get(option.id));
      assert.deepEqual((await f2.menu()).catalog,menu.catalog);assert.deepEqual((await f2.getPos()).dineInMenu.optionGroups.find(group=>group.id===addon.id).options.map(option=>option.id),orderedIds);
      const replay=await json(await f2.mutateMenu(command));assert.deepEqual(replay.catalog,menu.catalog);
      await json(await f2.mutateMenu({...command,optionIds:[...orderedIds].reverse()}),409);
      await f2.edit(previous,{action:'reorderAddonOptions',targetId:addon.id,optionIds:orderedIds},409);
      const empty=menu.catalog.optionGroups.find(group=>group.localKind==='addon'&&group.options.length===0);
      menu=await f2.edit(menu,{action:'reorderAddonOptions',targetId:empty.id,optionIds:[]});assert.equal(menu.catalog.optionGroups.find(group=>group.id===empty.id).options.length,0);
      assert.deepEqual(otherGraph(),originalOther);assert.deepEqual(await f2.sourceMasters(),before);
    });
    await check('unified-addons-reorder-rejects-missing-duplicate-foreign-and-source-group-permutations-with-no-write',async()=>{
      addon=menu.catalog.optionGroups.find(group=>group.id===addon.id);const optionIds=addon.options.map(option=>option.id),snapshot=clone(menu.catalog),operations=await f2.count('store_dine_in_menu_operations');
      for(const invalidIds of [optionIds.slice(1),[optionIds[0],optionIds[0],optionIds[2]],[optionIds[0],optionIds[1],soup.options[0].id],[]]){
        await f2.edit(menu,{action:'reorderAddonOptions',targetId:addon.id,optionIds:invalidIds},400);
      }
      await f2.edit(menu,{action:'reorderAddonOptions',targetId:premium.id,optionIds:premium.options.map(option=>option.id)},404);
      await f2.edit(menu,{action:'reorderAddonOptions',targetId:addon.id,optionIds,priceDelta:1},400);
      assert.deepEqual((await f2.menu()).catalog,snapshot);assert.equal(await f2.count('store_dine_in_menu_operations'),operations);
    });
    const selections=()=>{
      const requiredGroups=menu.catalog.optionGroups.filter(x=>bowl.optionGroupIds.includes(x.id)&&Number(x.ruleJson.minSelections)>0&&x.options.length);
      return [...requiredGroups.map(group=>({groupId:group.id,optionIds:[group.options[0].id]})),{groupId:addon.id,optionIds:addon.options.filter(x=>[ids.beef,extraOption].includes(x.sourceOptionId)).map(x=>x.id)}];
    };
    const line=()=>({menuCatalogItemId:bowl.id,quantity:1,measuredQuantity:250,weightMeasurement:{mode:'manual_net'},selectedOptions:selections()});
    let sale,storedDocs;
    await check('unified-addons-actual-pos-checkout-charge-preserved-prices-and-save-per-source-canonical-customizations-for-inventory-and-print',async()=>{
      bowl=menu.catalog.items.find(x=>x.id===bowl.id);addon=menu.catalog.optionGroups.find(x=>x.id===addon.id);const runtime=await f2.getPos();
      assert.ok(runtime.dineInMenu.optionGroups.some(x=>x.id===addon.id&&x.options.length===3));
      sale=await f2.checkout([line()]);assert.equal(sale.amount,1780);assert.equal(sale.servingTickets.length,1);
      const rows=await f2.orderItems(sale.orderId),custom=rows[0].customizations;assert.equal(rows[0].menu_catalog_item_id,ids.menu);
      const canonicalOptionIds=custom.flatMap(group=>group.optionIds||[]);assert.ok(canonicalOptionIds.includes(ids.beef));assert.ok(canonicalOptionIds.includes(extraOption));
      const beefGroup=custom.find(group=>(group.optionIds||[]).includes(ids.beef)),mushroomGroup=custom.find(group=>(group.optionIds||[]).includes(extraOption));
      assert.equal(beefGroup.groupId,ids.premiumGroup);assert.equal(mushroomGroup.groupId,extraGroup);assert.equal(beefGroup.storeMenuGroupId,addon.id);assert.equal(mushroomGroup.storeMenuGroupId,addon.id);
      const inventory=f2.load('lib/inventory-order-usage-policy.ts').normalizeInventoryOrderSource(rows.map(row=>({sourceItemId:row.id,menuCatalogItemId:row.menu_catalog_item_id,quantity:row.quantity,measuredQuantity:row.measured_quantity,measuredUnit:'g',customizations:row.customizations})),'store_pos');
      assert.equal(inventory.identityConfidence,'exact');assert.equal(inventory.items[0].options.find(x=>x.id===ids.beef).quantity,1);assert.equal(inventory.items[0].options.find(x=>x.id===extraOption).quantity,1);
      storedDocs=await f2.docs(sale.orderId);assert.ok(JSON.stringify(storedDocs).includes('追加食材'));assert.ok(JSON.stringify(storedDocs).includes('牛筋 50g'));assert.ok(JSON.stringify(storedDocs).includes('きくらげ 50g'));assert.equal(storedDocs.find(x=>x.kind==='receipt').payload.order.totalAmount,1780);
    });
    await check('unified-addons-two-portions-charge-two-source-prices-print-x2-and-normalize-two-fifty-gram-inventory-portions',async()=>{
      const beef=addon.options.find(option=>option.sourceOptionId===ids.beef),twoPortions=line();
      twoPortions.selectedOptions=twoPortions.selectedOptions.map(group=>group.groupId===addon.id?{...group,optionIds:[...group.optionIds,beef.id]}:group);
      const doubled=await f2.checkout([twoPortions]);assert.equal(doubled.amount,2430);assert.equal(doubled.servingTickets.length,1);
      const rows=await f2.orderItems(doubled.orderId),beefSelection=rows[0].customizations.find(group=>group.groupId===ids.premiumGroup);
      assert.deepEqual(beefSelection.optionIds,[ids.beef,ids.beef]);assert.deepEqual(beefSelection.storeMenuOptionIds,[beef.id,beef.id]);assert.equal(rows[0].amount,2430);
      const inventory=f2.load('lib/inventory-order-usage-policy.ts').normalizeInventoryOrderSource(rows.map(row=>({sourceItemId:row.id,menuCatalogItemId:row.menu_catalog_item_id,quantity:row.quantity,measuredQuantity:row.measured_quantity,measuredUnit:'g',customizations:row.customizations})),'store_pos');
      const ingredient=inventory.items[0].options.find(option=>option.id===ids.beef);assert.equal(inventory.identityConfidence,'exact');assert.equal(ingredient.quantity,2);
      assert.equal(beef.priceDelta,650);assert.equal(beef.sourceGroupRuleJson.portionGrams,50);assert.equal(ingredient.quantity*beef.sourceGroupRuleJson.portionGrams,100);
      const docs=await f2.docs(doubled.orderId);assert.deepEqual(docs.map(doc=>doc.kind),['kitchen','finishing','pickup','receipt']);
      for(const doc of docs)assert.ok(doc.payload.order.items.flatMap(item=>item.options).some(label=>label==='追加食材: 牛筋 50g x2'),`${doc.kind} does not show two portions`);
      assert.equal(docs.find(doc=>doc.kind==='receipt').payload.order.totalAmount,2430);assert.deepEqual(await f2.docs(sale.orderId),storedDocs);
    });
    await check('unified-options-retain-source-stockout-and-active-status-gates-and-required-choices-are-still-required',async()=>{
      const beforeOrders=await f2.count('store_customer_orders');
      await db.query('insert into menu_option_store_settings(brand_id,store_id,menu_option_id,is_available) values($1,$2,$3,false)',[ids.brand,ids.store,ids.beef]);
      let current=await f2.getPos();assert.ok(!current.dineInMenu.optionGroups.find(x=>x.id===addon.id).options.some(x=>x.sourceOptionId===ids.beef));await f2.checkout([line()],{},400);
      await db.query('delete from menu_option_store_settings where menu_option_id=$1',[ids.beef]);
      await db.query('update menu_option_groups set is_active=false where id=$1',[extraGroup]);current=await f2.getPos();assert.ok(!current.dineInMenu.optionGroups.find(x=>x.id===addon.id).options.some(x=>x.sourceOptionId===extraOption));await f2.checkout([line()],{},400);
      await db.query('update menu_option_groups set is_active=true where id=$1',[extraGroup]);await f2.checkout([{...line(),selectedOptions:[{groupId:addon.id,optionIds:[addon.options[0].id]}]}],{},400);
      assert.equal(await f2.count('store_customer_orders'),beforeOrders);assert.deepEqual(await f2.docs(sale.orderId),storedDocs);
    });
    await check('composition-never-mutates-brand-stock-rule-or-public-output-and-other-stores-stay-off',async()=>{
      assert.deepEqual(await f2.sourceMasters(),before);assert.deepEqual(await f2.publicMenus(),publicBefore);
      assert.equal((await db.query('select count(*)::int n from store_dine_in_menus where store_id<>$1',[ids.store])).rows[0].n,0);assert.equal(f2.state.externalCalls,0);
    });
  }finally{await f2.db.close();}
  const paths=['lib/store-dine-in-menu-policy.ts','lib/store-dine-in-menu.ts','lib/store-dine-in-runtime.ts','app/api/os/menus/dine-in/route.ts','app/api/store/pos/route.ts','app/api/menus/route.ts','app/api/public/menus/route.ts','lib/maamaa-compatible-menu.ts','lib/nanacha-compatible-menu.ts','scripts/tests/store-dine-in-composition-db.mjs'];
  const hashes=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(resolve(source,path))).digest('hex')])));
  const report={passed:results.length,results,source,sourceHashes:hashes,isolatedDatabase:'PGlite',actualApi:true,actualPos:true,actualImmutablePrints:true,canonicalOrderForeignKeyEnforced:true,liveDatabaseAccess:false,externalCalls:0,limitation:'PGlite has one serialized connection; cross-connection production lock scheduling and physical devices are outside this test.'};
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,output},null,2));
}catch(error){
  await writeFile(resolve(output,'failure.json'),JSON.stringify({passed:results.length,results,error:error.stack,source},null,2)+'\n');throw error;
}
