// Real OS menu handlers -> isolated PostgreSQL -> real POS/order/immutable-print handlers.
// This harness never reads production credentials, opens HTTP, or calls native devices.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createDineInMenuFixture,fixtureUuid as uuid} from './store-dine-in-menu-fixture.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-crud-db');
await mkdir(output,{recursive:true});
const verifiedFiles=['lib/store-dine-in-menu-policy.ts','lib/store-dine-in-menu.ts','lib/store-dine-in-runtime.ts','app/api/os/menus/dine-in/route.ts','app/api/store/pos/route.ts','app/api/public/menus/route.ts','scripts/tests/store-dine-in-crud-db.mjs'];
const hashSources=async()=>Object.fromEntries(await Promise.all(verifiedFiles.map(async file=>[file,createHash('sha256').update(await readFile(resolve(source,file))).digest('hex')])));
const compiledInputHashes=await hashSources();await writeFile(resolve(output,'compiled-input-hashes.json'),JSON.stringify({recordedAt:new Date().toISOString(),source,sourceHashes:compiledInputHashes},null,2)+'\n');
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
    const {ids,db}=f;
    Object.assign(ids,{heatGroup:uuid(45001),heatOption:uuid(45002),numbGroup:uuid(45003),numbOption:uuid(45004)});
    for(const [group,key,name,option] of [[ids.heatGroup,'heat','辛さ',ids.heatOption],[ids.numbGroup,'numb','しびれ',ids.numbOption]]){
      await db.query('insert into menu_option_groups(id,brand_id,group_key,name,selection_type,rule_json) values($1,$2,$3,$4,$5,$6::jsonb)',[group,ids.brand,key,name,'single',JSON.stringify({minSelections:0,maxSelections:1})]);
      await db.query('insert into menu_options(id,option_group_id,option_key,name,price_delta) values($1,$2,$3,$4,0)',[option,group,key+'-one',name+'1']);
    }
    const masterBefore=await f.sourceMasters(),publicBefore=await f.publicMenus(),counterBefore=await f.getPos();
    let menu=await f.edit({revision:''},{action:'initialize',mode:'empty'}),category,secondCategory,base,unified,single;
    const byId=id=>menu.catalog.items.find(x=>x.id===id);
    const group=id=>menu.catalog.optionGroups.find(x=>x.id===id);
    const candidates=(itemId,except)=>f.load('lib/store-dine-in-menu-policy.ts').getDineInAddonCandidates(menu.catalog,itemId,except,menu.source);
    await check('new-product-category-and-weight-base-can-be-created-from-zero-with-no-source-item-import',async()=>{
      menu=await f.edit(menu,{action:'createCategory',name:'新店内分類'});category=menu.catalog.categories.find(x=>x.name==='新店内分類');
      menu=await f.edit(menu,{action:'createCategory',name:'移動先分類'});secondCategory=menu.catalog.categories.find(x=>x.name==='移動先分類');
      menu=await f.edit(menu,{action:'createItem',name:'新しい店内碗',categoryId:category.id,itemKind:'buildable_product',price:0,pricingMode:'weight'});base=menu.catalog.items.find(x=>x.name==='新しい店内碗');
      assert.deepEqual(base.optionGroupIds,[]);assert.equal(base.posWeightUnitPrice,4);assert.equal(base.productionType,'bowl');assert.equal(menu.enabled,false);
    });
    await check('create-quantity-and-single-empty-option-groups-is-item-scoped-and-does-not-rewrite-brand',async()=>{
      menu=await f.edit(menu,{action:'createOptionGroup',itemId:base.id,name:'選べる加料',selectionType:'quantity'});unified=menu.catalog.optionGroups.find(x=>x.name==='選べる加料');
      menu=await f.edit(menu,{action:'createOptionGroup',itemId:base.id,name:'一つ選ぶ加料',selectionType:'single'});single=menu.catalog.optionGroups.find(x=>x.name==='一つ選ぶ加料');
      for(const local of [unified,single]){assert.equal(local.menuCatalogItemId,base.id);assert.deepEqual(local.options,[]);assert.equal(local.ruleJson.minSelections,0);assert.ok(byId(base.id).optionGroupIds.includes(local.id));}
      assert.equal(unified.selectionType,'quantity');assert.equal(single.selectionType,'single');assert.equal(single.ruleJson.maxSelections,1);assert.deepEqual(await f.sourceMasters(),masterBefore);
    });
    await check('trusted-brand-options-from-multiple-groups-are-available-for-a-new-product-without-importing-whole-products',async()=>{
      const list=candidates(base.id,unified.id);assert.ok(list.some(x=>x.option.sourceOptionId===ids.beef));assert.ok(list.some(x=>x.option.sourceOptionId===ids.legacyOption));
      for(const protectedId of [ids.option,ids.heatOption,ids.numbOption])assert.ok(!list.some(x=>x.option.sourceOptionId===protectedId),'protected choices stay independent');
      const chosen=[ids.beef,ids.legacyOption].map(id=>list.find(x=>x.option.sourceOptionId===id).option.id);
      menu=await f.edit(menu,{action:'importAddonOptions',targetId:unified.id,optionIds:chosen});unified=group(unified.id);
      assert.deepEqual(unified.options.map(x=>x.sourceOptionId).sort(),[ids.beef,ids.legacyOption].sort());
      assert.equal(unified.options.find(x=>x.sourceOptionId===ids.beef).priceDelta,650);assert.equal(unified.options.find(x=>x.sourceOptionId===ids.legacyOption).priceDelta,100);
      const beef=unified.options.find(x=>x.sourceOptionId===ids.beef);assert.equal(beef.sourceGroupId,ids.premiumGroup);assert.equal(beef.sourceGroupRuleJson.portionGrams,50);assert.ok(beef.name.endsWith('50g'));
      assert.equal(menu.catalog.items.length,1);assert.equal(menu.catalog.optionGroups.filter(x=>x.sourceGroupId===ids.premiumGroup).length,0);assert.deepEqual(await f.sourceMasters(),masterBefore);
    });
    await check('existing-single-group-can-import-source-option-without-losing-single-selection-rule',async()=>{
      const option=candidates(base.id,single.id).find(x=>x.option.sourceOptionId===ids.pork).option;
      menu=await f.edit(menu,{action:'importAddonOptions',targetId:single.id,optionIds:[option.id]});single=group(single.id);assert.equal(single.options.length,1);assert.equal(single.options[0].priceDelta,550);assert.equal(single.selectionType,'single');assert.equal(single.ruleJson.maxSelections,1);
    });
    let imported,otherGraph;
    await check('copy-options-from-another-local-product-keeps-other-product-price-and-option-graph-unchanged',async()=>{
      menu=await f.edit(menu,{action:'importItem',sourceItemId:ids.menu,name:'元の商品'});imported=menu.catalog.items.find(x=>x.name==='元の商品');
      otherGraph=clone({item:imported,groups:menu.catalog.optionGroups.filter(x=>imported.optionGroupIds.includes(x.id))});
      menu=await f.edit(menu,{action:'createOptionGroup',itemId:base.id,name:'別の商品から',selectionType:'quantity'});const target=menu.catalog.optionGroups.find(x=>x.name==='別の商品から');
      const option=candidates(base.id,target.id).find(x=>x.option.sourceOptionId===ids.pork).option;
      menu=await f.edit(menu,{action:'importAddonOptions',targetId:target.id,optionIds:[option.id]});
      assert.deepEqual({item:byId(imported.id),groups:menu.catalog.optionGroups.filter(x=>imported.optionGroupIds.includes(x.id))},otherGraph);assert.equal(group(target.id).options[0].priceDelta,550);
    });
    let sale,oldDocs,oldRows,oldSummary;
    await check('new-base-with-cross-group-options-checkout-persists-source-ids-and-immutable-print-snapshots',async()=>{
      menu=await f.edit(menu,{action:'setEnabled',enabled:true});
      sale=await f.checkout([{menuCatalogItemId:base.id,quantity:1,measuredQuantity:250,weightMeasurement:{mode:'manual_net'},selectedOptions:[{groupId:unified.id,optionIds:[unified.options.find(x=>x.sourceOptionId===ids.beef).id]}]}]);
      assert.equal(sale.amount,1650);assert.equal(sale.servingTickets.length,1);oldRows=await f.orderItems(sale.orderId);oldDocs=await f.docs(sale.orderId);oldSummary=(await db.query('select customer_summary from store_customer_orders where id=$1',[sale.orderId])).rows[0].customer_summary;
      assert.equal(oldRows[0].menu_catalog_item_id,base.sourceItemId);assert.ok(JSON.stringify(oldRows).includes(ids.beef));assert.ok(JSON.stringify(oldDocs).includes('牛筋 50g'));
    });
    await check('local-option-price-change-is-idempotent-and-does-not-change-label-fifty-grams-or-another-copy',async()=>{
      const beef=group(unified.id).options.find(x=>x.sourceOptionId===ids.beef),before=clone(beef),other=clone(menu.catalog.optionGroups.filter(x=>imported.optionGroupIds.includes(x.id)));
      const command={action:'setOptionPrice',targetId:beef.id,price:500,revision:menu.revision,operationId:operation()};menu=await json(await f.mutateMenu(command));
      assert.deepEqual({...group(unified.id).options.find(x=>x.id===beef.id),priceDelta:before.priceDelta},before);assert.equal(group(unified.id).options.find(x=>x.id===beef.id).priceDelta,500);
      assert.deepEqual(menu.catalog.optionGroups.filter(x=>imported.optionGroupIds.includes(x.id)),other);assert.deepEqual((await json(await f.mutateMenu(command))).catalog,menu.catalog);await json(await f.mutateMenu({...command,price:499}),409);
      assert.deepEqual(await f.sourceMasters(),masterBefore);assert.deepEqual(await f.publicMenus(),publicBefore);assert.deepEqual(await f.docs(sale.orderId),oldDocs);
    });
    await check('changed-local-option-price-times-two-portions-is-charged-and-snapshotted-by-real-pos',async()=>{
      const beef=group(unified.id).options.find(x=>x.sourceOptionId===ids.beef);
      const changed=await f.checkout([{menuCatalogItemId:base.id,quantity:1,measuredQuantity:200,weightMeasurement:{mode:'manual_net'},selectedOptions:[{groupId:unified.id,optionIds:[beef.id,beef.id]}]}]);
      assert.equal(changed.amount,1800);const rows=await f.orderItems(changed.orderId);assert.equal(rows[0].amount,1800);
      const selected=rows[0].customizations.find(x=>(x.optionIds||[]).includes(ids.beef));assert.deepEqual(selected.optionIds,[ids.beef,ids.beef]);assert.deepEqual(selected.storeMenuOptionIds,[beef.id,beef.id]);
      const docs=await f.docs(changed.orderId);assert.equal(docs.find(x=>x.kind==='receipt').payload.order.totalAmount,1800);assert.ok(JSON.stringify(docs).includes('牛筋 50g'));assert.deepEqual(await f.docs(sale.orderId),oldDocs);
    });
    await check('option-price-rejects-invalid-values-injected-lineage-and-stale-revision-without-saving',async()=>{
      const beef=group(unified.id).options.find(x=>x.sourceOptionId===ids.beef),before=clone(menu.catalog),ops=await f.count('store_dine_in_menu_operations');
      for(const price of [-1,0.1,10000000,'500',null])await f.edit(menu,{action:'setOptionPrice',targetId:beef.id,price},400);
      await f.edit(menu,{action:'setOptionPrice',targetId:beef.id,price:500,sourceOptionId:ids.pork},400);
      await f.edit(menu,{action:'setOptionPrice',targetId:ids.beef,price:500},404);
      await f.edit({revision:'1'},{action:'setOptionPrice',targetId:beef.id,price:500},409);
      assert.deepEqual((await f.menu()).catalog,before);assert.equal(await f.count('store_dine_in_menu_operations'),ops);
      menu=await f.edit(menu,{action:'setOptionPrice',targetId:beef.id,price:0});assert.equal(group(unified.id).options.find(x=>x.id===beef.id).priceDelta,0);menu=await f.edit(menu,{action:'setOptionPrice',targetId:beef.id,price:500});
    });
    await check('nonempty-category-delete-requires-an-existing-different-destination-and-does-not-write-on-error',async()=>{
      const before=clone(menu.catalog),revision=menu.revision,ops=await f.count('store_dine_in_menu_operations');
      await f.edit(menu,{action:'delete',kind:'category',targetId:category.id},400);
      await f.edit(menu,{action:'delete',kind:'category',targetId:category.id,replacementCategoryId:category.id},400);
      await f.edit(menu,{action:'delete',kind:'category',targetId:category.id,replacementCategoryId:ids.categoryDrink},400);
      assert.deepEqual((await f.menu()).catalog,before);assert.equal((await f.menu()).revision,revision);assert.equal(await f.count('store_dine_in_menu_operations'),ops);
    });
    await check('nonempty-category-delete-moves-only-affected-local-products-and-preserves-source-price-and-options',async()=>{
      const previous=clone(byId(base.id));menu=await f.edit(menu,{action:'delete',kind:'category',targetId:category.id,replacementCategoryId:secondCategory.id});
      assert.ok(!menu.catalog.categories.some(x=>x.id===category.id));assert.equal(byId(base.id).category,secondCategory.name);
      assert.deepEqual({...byId(base.id),category:previous.category},previous);assert.deepEqual({item:byId(imported.id),groups:menu.catalog.optionGroups.filter(x=>imported.optionGroupIds.includes(x.id))},otherGraph);
    });
    await check('option-deletion-does-not-delete-canonical-option-or-change-other-products-copy',async()=>{
      const target=group(unified.id).options.find(x=>x.sourceOptionId===ids.beef),count=await f.count('menu_options');
      menu=await f.edit(menu,{action:'delete',kind:'option',targetId:target.id});assert.ok(!group(unified.id).options.some(x=>x.id===target.id));assert.equal(await f.count('menu_options'),count);
      assert.ok(menu.catalog.optionGroups.filter(x=>imported.optionGroupIds.includes(x.id)).flatMap(x=>x.options).some(x=>x.sourceOptionId===ids.beef));
    });
    await check('deleting-last-visible-required-choice-is-blocked-but-explicit-whole-group-delete-cleans-all-item-references',async()=>{
      const soup=menu.catalog.optionGroups.find(x=>imported.optionGroupIds.includes(x.id)&&x.sourceGroupId===ids.optionGroup),snapshot=clone(menu.catalog);
      assert.equal(soup.ruleJson.minSelections,1);await f.edit(menu,{action:'delete',kind:'option',targetId:soup.options[0].id},400);assert.deepEqual((await f.menu()).catalog,snapshot);
      menu=await f.edit(menu,{action:'delete',kind:'group',targetId:soup.id});assert.ok(!group(soup.id));assert.ok(menu.catalog.items.every(x=>!x.optionGroupIds.includes(soup.id)));assert.equal((await db.query('select count(*)::int n from menu_option_groups where id=$1',[ids.optionGroup])).rows[0].n,1);
    });
    await check('deleting-shared-group-removes-every-local-reference-without-removing-source-group',async()=>{
      const shared=menu.catalog.optionGroups.find(x=>x.sourceGroupId===ids.premiumGroup);assert.ok(shared);
      menu=await f.edit(menu,{action:'duplicate',kind:'item',targetId:imported.id,name:'共有元の複製'});assert.ok(menu.catalog.items.filter(x=>x.optionGroupIds.includes(shared.id)).length>=2);
      menu=await f.edit(menu,{action:'delete',kind:'group',targetId:shared.id});assert.ok(!group(shared.id));assert.ok(menu.catalog.items.every(x=>!x.optionGroupIds.includes(shared.id)));assert.equal((await db.query('select count(*)::int n from menu_option_groups where id=$1',[ids.premiumGroup])).rows[0].n,1);
    });
    await check('required-choice-deletion-checks-each-consuming-product-category-not-only-global-option-count',async()=>{
      const scoped=clone(group(unified.id)),legacy=clone(menu.catalog);scoped.id=uuid(45100);scoped.menuCatalogItemId='';scoped.ruleJson={minSelections:1,maxSelections:1};scoped.selectionType='single';scoped.localKind='choice';scoped.name='分類別の必須選択';
      const first=clone(group(unified.id).options[0]),second=clone(menu.catalog.optionGroups.find(x=>x.name==='別の商品から').options[0]);first.id=uuid(45101);first.applicableCategories=[byId(base.id).category];second.id=uuid(45102);second.applicableCategories=[byId(imported.id).category];scoped.options=[first,second];legacy.optionGroups.push(scoped);
      for(const id of [base.id,imported.id])legacy.items.find(x=>x.id===id).optionGroupIds.push(scoped.id);
      await db.query('update store_dine_in_menus set catalog=$1::jsonb where store_id=$2 and brand_id=$3',[JSON.stringify(legacy),ids.store,ids.brand]);menu=await f.menu();
      await f.edit(menu,{action:'delete',kind:'option',targetId:first.id},400);await f.edit(menu,{action:'delete',kind:'option',targetId:second.id},400);assert.equal(group(scoped.id).options.length,2);
      menu=await f.edit(menu,{action:'delete',kind:'group',targetId:scoped.id});assert.ok(menu.catalog.items.every(x=>!x.optionGroupIds.includes(scoped.id)));
    });
    await check('item-delete-removes-private-groups-retains-shared-groups-and-canonical-order-foreign-keys',async()=>{
      // An identified historical graph may share a group whose stored owner is
      // about to be deleted. A surviving product must receive an equivalent copy.
      const legacyPrivate=clone(menu.catalog.optionGroups.find(x=>x.menuCatalogItemId===base.id&&x.name==='別の商品から'));assert.ok(legacyPrivate);const legacyCatalog=clone(menu.catalog);legacyCatalog.items.find(x=>x.id===imported.id).optionGroupIds.push(legacyPrivate.id);
      await db.query('update store_dine_in_menus set catalog=$1::jsonb where store_id=$2 and brand_id=$3',[JSON.stringify(legacyCatalog),ids.store,ids.brand]);menu=await f.menu();
      const canonical=await f.count('menu_catalog_items'),groups=menu.catalog.optionGroups.filter(x=>x.menuCatalogItemId===base.id).map(x=>x.id);
      const command={action:'delete',kind:'item',targetId:base.id,revision:menu.revision,operationId:operation()};menu=await json(await f.mutateMenu(command));
      assert.ok(!byId(base.id));assert.ok(menu.catalog.optionGroups.every(x=>!groups.includes(x.id)));assert.equal(await f.count('menu_catalog_items'),canonical);assert.equal((await db.query('select count(*)::int n from menu_catalog_items where id=$1',[base.sourceItemId])).rows[0].n,1);
      const survivor=byId(imported.id),copy=menu.catalog.optionGroups.find(x=>survivor.optionGroupIds.includes(x.id)&&x.menuCatalogItemId===imported.id&&x.name===legacyPrivate.name);assert.ok(copy);assert.notEqual(copy.id,legacyPrivate.id);assert.notEqual(copy.options[0].id,legacyPrivate.options[0].id);
      assert.deepEqual({...copy,id:legacyPrivate.id,menuCatalogItemId:legacyPrivate.menuCatalogItemId,options:copy.options.map((x,i)=>({...x,id:legacyPrivate.options[i].id}))},legacyPrivate);
      const repeated=await json(await f.mutateMenu(command));assert.deepEqual(repeated.catalog,menu.catalog);await json(await f.mutateMenu({...command,targetId:imported.id}),409);
    });
    await check('empty-category-delete-needs-no-destination-and-stale-or-repeated-new-operation-cannot-delete-another-object',async()=>{
      menu=await f.edit(menu,{action:'createCategory',name:'空の分類'});const empty=menu.catalog.categories.find(x=>x.name==='空の分類'),revision=menu.revision;
      menu=await f.edit(menu,{action:'delete',kind:'category',targetId:empty.id});assert.ok(!menu.catalog.categories.some(x=>x.id===empty.id));
      await f.edit({revision},{action:'delete',kind:'item',targetId:imported.id},409);await f.edit(menu,{action:'delete',kind:'category',targetId:empty.id},404);
    });
    await check('crud-authentication-store-brand-scope-csrf-and-payload-injection-are-enforced',async()=>{
      const before=clone(menu.catalog),ops=await f.count('store_dine_in_menu_operations'),session=f.state.session;
      f.state.session=null;await f.edit(menu,{action:'delete',kind:'item',targetId:imported.id},401);f.state.session=session;
      f.state.permitted=false;await f.edit(menu,{action:'createOptionGroup',itemId:imported.id,name:'権限なし',selectionType:'quantity'},403);f.state.permitted=true;
      await json(await f.mutateMenu({action:'delete',kind:'item',targetId:imported.id,revision:menu.revision,operationId:operation()},{origin:'https://foreign.invalid'}),403);
      for(const change of [{action:'delete',kind:'item',targetId:imported.id,storeId:ids.other},{action:'delete',kind:'item',targetId:imported.id,brandId:ids.otherBrand}])await json(await f.mutateMenu({revision:menu.revision,operationId:operation(),...change}),403);
      for(const change of [{action:'createOptionGroup',itemId:imported.id,name:'bad',selectionType:'arbitrary'},{action:'createOptionGroup',itemId:imported.id,name:'bad',selectionType:'quantity',minSelections:1},{action:'importAddonOptions',targetId:single.id,optionIds:[ids.outsiderOption]},{action:'importAddonOptions',targetId:single.id,optionIds:[ids.heatOption]},{action:'delete',kind:'item',targetId:imported.id,replacementCategoryId:secondCategory.id},{action:'delete',kind:'item',targetId:ids.menu}]){
        const response=await f.mutateMenu({revision:menu.revision,operationId:operation(),...change});assert.ok([400,404].includes(response.status),`${JSON.stringify(change)}: ${response.status} ${await response.text()}`);
      }
      assert.deepEqual((await f.menu()).catalog,before);assert.equal(await f.count('store_dine_in_menu_operations'),ops);
    });
    await check('failed-delete-transaction-rolls-back-revision-catalog-and-operation-receipt',async()=>{
      const snapshot=clone(menu),ops=await f.count('store_dine_in_menu_operations');f.state.failPattern=/update store_dine_in_menus set catalog/;
      try{await f.edit(menu,{action:'delete',kind:'item',targetId:imported.id},500);}finally{f.state.failPattern=null;}
      const after=await f.menu();assert.equal(after.revision,snapshot.revision);assert.deepEqual(after.catalog,snapshot.catalog);assert.equal(await f.count('store_dine_in_menu_operations'),ops);
    });
    await check('trusted-source-import-cas-rejects-source-price-race-without-partial-catalog-write',async()=>{
      menu=await f.edit(menu,{action:'createOptionGroup',itemId:imported.id,name:'競合テスト',selectionType:'quantity'});const target=menu.catalog.optionGroups.find(x=>x.name==='競合テスト'),option=candidates(imported.id,target.id).find(x=>x.option.sourceOptionId===ids.pork).option;
      const before=clone(menu),ops=await f.count('store_dine_in_menu_operations'),transaction=f.sql.transaction;
      f.sql.transaction=async statements=>{f.sql.transaction=transaction;await db.query('update menu_options set price_delta=price_delta+1 where id=$1',[ids.pork]);return transaction(statements);};
      try{await f.edit(menu,{action:'importAddonOptions',targetId:target.id,optionIds:[option.id]},409);}finally{f.sql.transaction=transaction;await db.query('update menu_options set price_delta=550 where id=$1',[ids.pork]);}
      assert.deepEqual((await f.menu()).catalog,before.catalog);assert.equal((await f.menu()).revision,before.revision);assert.equal(await f.count('store_dine_in_menu_operations'),ops);
    });
    await check('deleting-local-records-never-changes-previous-orders-reprint-payloads-public-menus-other-stores-or-brand-masters',async()=>{
      assert.deepEqual(await f.orderItems(sale.orderId),oldRows);assert.deepEqual(await f.docs(sale.orderId),oldDocs);assert.deepEqual((await db.query('select customer_summary from store_customer_orders where id=$1',[sale.orderId])).rows[0].customer_summary,oldSummary);
      assert.deepEqual(await f.sourceMasters(),masterBefore);assert.deepEqual(await f.publicMenus(),publicBefore);const current=await f.getPos();assert.deepEqual(current.items,counterBefore.items);assert.deepEqual(current.optionGroups,counterBefore.optionGroups);
      assert.equal((await db.query('select count(*)::int n from store_dine_in_menus where store_id<>$1',[ids.store])).rows[0].n,0);assert.equal(f.state.externalCalls,0);
    });
    await check('deleting-last-item-keeps-enabled-dine-in-menu-empty-without-falling-back-to-brand-and-rejects-old-unpaid-cart',async()=>{
      const stale=f.lastBody();stale.offlineClientOrderId=uuid(nextSale++);
      for(const item of [...menu.catalog.items])menu=await f.edit(menu,{action:'delete',kind:'item',targetId:item.id});
      assert.equal(menu.enabled,true);assert.equal(menu.catalog.items.length,0);const current=await f.getPos();
      assert.ok(current.dineInMenu,'Enabled empty menu is still present');assert.equal(current.dineInMenu.items.filter(x=>x.brandId===ids.brand).length,0);assert.ok(!current.dineInMenu.items.some(x=>x.id===ids.menu));assert.ok(current.items.some(x=>x.id===ids.menu),'Counter brand catalog remains available separately');
      await json(await f.reloadPos().POST(f.request('/api/store/pos',stale)),409);
      assert.deepEqual(await f.docs(sale.orderId),oldDocs);assert.deepEqual(await f.orderItems(sale.orderId),oldRows);
      assert.equal((await db.query('select is_active from menu_catalog_items where id=$1',[base.sourceItemId])).rows[0].is_active,true);assert.deepEqual(await f.publicMenus(),publicBefore);
    });
  }finally{await f.db.close();}
  const scoped=await harness();
  try{
    await check('category-migration-isolates-moved-product-options-and-existing-destination-product-cannot-buy-migrated-only-ingredient',async()=>{
      const {ids,db}=scoped;
      await db.query('update menu_option_groups set applicable_categories=$1::text[] where id=$2',[['麻辣湯'],ids.optionGroup]);
      await db.query('update menu_options set applicable_categories=$1::text[] where id=$2',[['麻辣湯'],ids.option]);
      await db.query('insert into menu_options(id,option_group_id,option_key,name,price_delta,applicable_categories) values($1,$2,$3,$4,0,$5::text[])',[uuid(45120),ids.optionGroup,'other-soup','別分類専用スープ',['他の分類']]);
      const masterBefore=await scoped.sourceMasters(),publicBefore=await scoped.publicMenus();let menu=await scoped.edit({revision:''},{action:'initialize',mode:'empty'});
      for(const name of ['分類A','分類B'])menu=await scoped.edit(menu,{action:'createCategory',name});
      const categoryA=menu.catalog.categories.find(x=>x.name==='分類A'),categoryB=menu.catalog.categories.find(x=>x.name==='分類B');
      for(const [name,category] of [['Aの商品',categoryA],['Bの商品',categoryB]])menu=await scoped.edit(menu,{action:'createItem',name,categoryId:category.id,itemKind:'buildable_product',price:0,pricingMode:'weight'});
      const itemA=menu.catalog.items.find(x=>x.name==='Aの商品'),itemB=menu.catalog.items.find(x=>x.name==='Bの商品');
      menu=await scoped.edit(menu,{action:'createOptionGroup',itemId:itemA.id,name:'共用の分類別加料',selectionType:'quantity'});let shared=menu.catalog.optionGroups.find(x=>x.name==='共用の分類別加料');
      menu=await scoped.edit(menu,{action:'importAddonOptions',targetId:shared.id,optionIds:[ids.beef]});
      const legacy=clone(menu.catalog);shared=legacy.optionGroups.find(x=>x.id===shared.id);shared.menuCatalogItemId='';shared.options[0].applicableCategories=[categoryA.name];legacy.items.find(x=>x.id===itemB.id).optionGroupIds.push(shared.id);
      await db.query('update store_dine_in_menus set catalog=$1::jsonb where store_id=$2 and brand_id=$3',[JSON.stringify(legacy),ids.store,ids.brand]);menu=await scoped.menu();menu=await scoped.edit(menu,{action:'setEnabled',enabled:true});
      const beforeB=clone(menu.catalog.items.find(x=>x.id===itemB.id)),beforeGroup=clone(menu.catalog.optionGroups.find(x=>x.id===shared.id));
      const line=(item,group,option)=>({menuCatalogItemId:item,quantity:1,measuredQuantity:200,weightMeasurement:{mode:'manual_net'},selectedOptions:[{groupId:group,optionIds:[option]}]});
      await scoped.checkout([line(itemB.id,shared.id,shared.options[0].id)],{},400);const prior=await scoped.checkout([line(itemA.id,shared.id,shared.options[0].id)]);assert.equal(prior.amount,1450);const priorDocs=await scoped.docs(prior.orderId);
      menu=await scoped.edit(menu,{action:'delete',kind:'category',targetId:categoryA.id,replacementCategoryId:categoryB.id});
      assert.deepEqual(menu.catalog.items.find(x=>x.id===itemB.id),beforeB);assert.deepEqual(menu.catalog.optionGroups.find(x=>x.id===shared.id),beforeGroup);
      const moved=menu.catalog.items.find(x=>x.id===itemA.id),copy=menu.catalog.optionGroups.find(x=>moved.optionGroupIds.includes(x.id)&&x.id!==shared.id);assert.ok(copy);assert.equal(moved.category,categoryB.name);assert.equal(copy.menuCatalogItemId,itemA.id);assert.equal(copy.options[0].sourceOptionId,ids.beef);assert.equal(copy.options[0].priceDelta,650);assert.equal(copy.options[0].sourceGroupRuleJson.portionGrams,50);assert.ok(copy.options[0].applicableCategories.includes(categoryB.name));
      await scoped.checkout([line(itemB.id,shared.id,shared.options[0].id)],{},400);await scoped.checkout([line(itemB.id,copy.id,copy.options[0].id)],{},400);const movedSale=await scoped.checkout([line(itemA.id,copy.id,copy.options[0].id)]);assert.equal(movedSale.amount,1450);
      menu=await scoped.edit(menu,{action:'importItem',sourceItemId:ids.menu,name:'分類変更して取り込む碗',categoryId:categoryB.id});const imported=menu.catalog.items.find(x=>x.name==='分類変更して取り込む碗'),owned=menu.catalog.optionGroups.find(x=>imported.optionGroupIds.includes(x.id)&&x.sourceGroupId===ids.optionGroup),valid=owned.options.find(x=>x.sourceOptionId===ids.option);
      assert.equal(owned.menuCatalogItemId,imported.id);assert.equal(owned.ruleJson.minSelections,1);assert.equal(owned.options.length,2);assert.ok(owned.applicableCategories.includes('麻辣湯'));assert.ok(valid.applicableCategories.includes(categoryB.name));
      await scoped.edit(menu,{action:'delete',kind:'option',targetId:valid.id},400);assert.equal((await scoped.menu()).catalog.optionGroups.find(x=>x.id===owned.id).options.length,2);
      assert.deepEqual(await scoped.docs(prior.orderId),priorDocs);assert.deepEqual(await scoped.sourceMasters(),masterBefore);assert.deepEqual(await scoped.publicMenus(),publicBefore);
    });
  }finally{await scoped.db.close();}
  const sourceHashes=await hashSources();assert.deepEqual(sourceHashes,compiledInputHashes,'Exact API/POS sources match before fixture load and after all cases');
  const report={passed:results.length,results,source,sourceHashes,compiledInputHashes,noSourceDrift:true,isolatedDatabase:'PGlite',actualApi:true,actualPos:true,actualImmutablePrints:true,canonicalOrderForeignKeyEnforced:true,liveDatabaseAccess:false,externalCalls:0};
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,output}));
}catch(error){await writeFile(resolve(output,'failure.json'),JSON.stringify({passed:results.length,results,error:error.stack,source},null,2)+'\n');throw error;}
