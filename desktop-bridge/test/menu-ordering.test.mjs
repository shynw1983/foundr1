import test from 'node:test';
import assert from 'node:assert/strict';
import {RocketMenuClient} from '../src/rocket-menu-client.mjs';
import {DemaeMenuClient} from '../src/demae-menu-client.mjs';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';

function rocket(mode='ok',{menus:initialMenus,groups:initialGroups}={}) {
  const menus=structuredClone(initialMenus??[{menuId:1,menuName:'a',exposeOrder:0,dishes:[
    {dishId:4,exposeOrder:0,displayStatus:'NOT_EXPOSE',salePrice:100},
    {dishId:5,exposeOrder:1,displayStatus:'ON_SALE',salePrice:200}]},
  {menuId:2,menuName:'b',exposeOrder:1,dishes:[{dishId:6,exposeOrder:0,displayStatus:'SOLD_OUT_TODAY',salePrice:300}]}]);
  const groups=structuredClone(initialGroups??[{optionId:11,optionName:'group',optionItems:[{optionItemId:12,displayStatus:'SOLD_OUT_TODAY',salePrice:50}]}]);
  const writes=[];
  const client=new RocketMenuClient({request:async(path,method,body)=>{
    if(method==='POST') {
      // The real transport JSON serializer omits undefined but retains null.
      const saved=JSON.parse(JSON.stringify(body));
      writes.push({path,body:saved});assert.match(path,/menus\/update-expose-order$/);
      if(mode==='ignored')return {};
      for(const dto of saved) {
        const menu=menus.find(row=>row.menuId===dto.menuId);
        if(Object.hasOwn(dto,'exposeOrder'))menu.exposeOrder=dto.exposeOrder;
        for(const dish of dto.dishOrders??[])menu.dishes.find(row=>row.dishId===dish.dishId).exposeOrder=dish.exposeOrder;
      }
      if(mode==='stock')menus[0].dishes[0].displayStatus='ON_SALE';
      if(mode==='content')menus[0].description='changed';
      if(mode==='groups')groups[0].optionItems[0].displayStatus='ON_SALE';
      if(mode==='newId')menus.push({menuId:99,menuName:'new',exposeOrder:99,dishes:[]});
      if(mode==='otherOrder')menus[1].dishes.forEach((dish,index)=>{dish.exposeOrder=menus[1].dishes.length-index-1;});
      if(mode==='otherCategoryOrder')menus.forEach((menu,index)=>{menu.exposeOrder=menus.length-index-1;});
      return {};
    }
    return path.includes('all-menu-dishes')?{menus:structuredClone(menus)}:structuredClone(groups);
  }},'1');
  return {client,menus,groups,writes};
}

test('Rocket uses the official menu ordering DTO for item order and rereads display fields',async()=>{
  const f=rocket();await f.client.reorderCategoryItems('1',['5','4']);
  assert.deepEqual(f.writes[0].body,[{menuId:1,exposeOrder:0,dishOrders:[{dishId:5,exposeOrder:0},{dishId:4,exposeOrder:1}]}]);
  assert.deepEqual(f.menus[0].dishes.map(row=>row.dishId),[4,5]); // native creation array is unchanged
  assert.deepEqual((await f.client.catalog()).menus[0].dishes.map(row=>row.dishId),[5,4]);
  assert.equal(f.menus[0].dishes[0].displayStatus,'NOT_EXPOSE');
});

test('Rocket category and item ordering reject ignored saves, content/stock/group changes and new IDs',async()=>{
  for(const method of ['reorderCategoryItems','reorderCategories'])for(const mode of ['ignored','stock','content','groups','newId']) {
    const f=rocket(mode);
    await assert.rejects(()=>method==='reorderCategoryItems'?f.client[method]('1',['5','4']):f.client[method](['2','1']),/order_verification_failed/);
    assert.equal(f.writes.length,1);
  }
  const f=rocket();
  await assert.rejects(()=>f.client.reorderCategoryItems('1',['5','unknown']),/members_require_migration/);
  await assert.rejects(()=>f.client.reorderCategories(['1','unknown']),/scope_invalid/);
  assert.equal(f.writes.length,0);
});

test('Rocket menu/dish display order matches the official ID tie-break, not API creation order',async()=>{
  const f=rocket('ok',{menus:[
    {menuId:40,exposeOrder:null,dishes:[]},
    {menuId:20,exposeOrder:1,dishes:[]},
    {menuId:30,dishes:[]},
    {menuId:10,exposeOrder:1,dishes:[{dishId:9,exposeOrder:null},{dishId:7,exposeOrder:0},{dishId:8},{dishId:6,exposeOrder:0}]},
    {menuId:50,exposeOrder:null,dishes:[]}
  ]});
  const catalog=await f.client.catalog();
  assert.deepEqual(catalog.menus.map(row=>row.menuId),[10,20,30,40,50]);
  assert.deepEqual(catalog.menus[0].dishes.map(row=>row.dishId),[6,7,8,9]);
  assert.deepEqual(f.menus.map(row=>row.menuId),[40,20,30,10,50]);
  assert.deepEqual(f.menus[3].dishes.map(row=>row.dishId),[9,7,8,6]);
  assert.equal(f.writes.length,0);
});

test('Rocket single-category sort preserves null/omitted category metadata through official JSON DTO',async()=>{
  for(const present of [true,false]) {
    const f=rocket();
    if(present)f.menus[0].exposeOrder=null;else delete f.menus[0].exposeOrder;
    const before=await f.client.catalog();
    await f.client.reorderCategoryItems('1',['5','4']);
    assert.deepEqual(f.writes[0].body,[{menuId:1,...(present?{exposeOrder:null}:{}),dishOrders:[{dishId:5,exposeOrder:0},{dishId:4,exposeOrder:1}]}]);
    const after=await f.client.catalog();
    assert.deepEqual(after.menus.map(row=>row.menuId),before.menus.map(row=>row.menuId));
    assert.deepEqual(after.menus.find(row=>row.menuId===1).dishes.map(row=>row.dishId),[5,4]);
    assert.equal(Object.hasOwn(f.menus[0],'exposeOrder'),present);
    if(present)assert.equal(f.menus[0].exposeOrder,null);
    assert.equal(f.menus[0].dishes[0].displayStatus,'NOT_EXPOSE');
  }
});

test('Rocket missing-position no-op does not write, while non-native positions fail before a real change',async()=>{
  for(const exposeOrder of [null,undefined,'1',-1,0.5,Infinity,NaN]) {
    const f=rocket();f.menus[0].exposeOrder=exposeOrder;
    await f.client.reorderCategoryItems('1',['4','5']);
    assert.equal(f.writes.length,0);
    if(exposeOrder!==null&&exposeOrder!==undefined) {
      await assert.rejects(()=>f.client.reorderCategoryItems('1',['5','4']),/category_order_metadata_missing/);
      assert.equal(f.writes.length,0);
    }
  }
});

test('Rocket item sorting rejects changed category slots and unrelated item display order',async()=>{
  for(const mode of ['otherCategoryOrder','otherOrder']) {
    const f=rocket(mode);
    f.menus[1].dishes.push({dishId:7,exposeOrder:1,displayStatus:'NOT_EXPOSE',salePrice:400});
    await assert.rejects(()=>f.client.reorderCategoryItems('1',['5','4']),/order_verification_failed/);
    assert.equal(f.writes.length,1);
  }
  const f=rocket('otherOrder');
  f.menus[1].dishes.push({dishId:7,exposeOrder:1,displayStatus:'NOT_EXPOSE',salePrice:400});
  await assert.rejects(()=>f.client.reorderCategories(['2','1']),/order_verification_failed/);
});

test('Rocket full category ordering handles the observed 3 numeric/12 null catalog and preserves unmanaged slots',async()=>{
  // Bounded 2026-10-06 native GET: these category positions are genuinely
  // nullable. API dish creation arrays also differ from the official ID tie.
  const rawIds=[1625484,1625481,1625483,1652416,1652417,1652418,1652419,1652420,1761001,1761002,1761003,1761018,1761068,1761069,1821035];
  const menus=rawIds.map((menuId,index)=>({menuId,menuName:`category ${menuId}`,description:'preserved',exposeStatus:'EXPOSE',menuType:null,
    exposeOrder:index<3?index:null,dishes:index===0?[
      {dishId:11027839,exposeOrder:null,displayStatus:'NOT_EXPOSE',salePrice:2380},
      {dishId:9987919,exposeOrder:null,displayStatus:'SOLD_OUT_TODAY',salePrice:2280}
    ]:[]}));
  const f=rocket('ok',{menus});
  const before=await f.client.catalog();
  const expected=['1761018','1652417','1625481','1625483','1625484','1652419','1761068','1652420'];
  const driver=new AuthorityNativeDriver({}, {platformKey:'rocket_now',merchantId:'1',targets:expected.map((id,sortOrder)=>({
    kind:'category',targetId:id,sourceKey:`category:${id}`,sortOrder,name:id,mappings:[{externalId:id}]
  }))});
  driver.client=f.client;
  await driver.updateCategoryOrder();
  const after=await f.client.catalog();
  assert.deepEqual(after.menus.filter(row=>expected.includes(String(row.menuId))).map(row=>String(row.menuId)),expected);
  for(const [index,menu] of before.menus.entries())if(!expected.includes(String(menu.menuId)))assert.equal(after.menus[index].menuId,menu.menuId);
  assert.deepEqual(f.writes[0].body,after.menus.map((row,index)=>({menuId:row.menuId,exposeOrder:index})));
  assert.ok(after.menus.every((row,index)=>row.exposeOrder===index));
  for(const menu of before.menus) {
    const actual=after.menus.find(row=>row.menuId===menu.menuId);
    assert.deepEqual({...actual,exposeOrder:menu.exposeOrder},menu);
  }
  assert.deepEqual(f.groups,[{optionId:11,optionName:'group',optionItems:[{optionItemId:12,displayStatus:'SOLD_OUT_TODAY',salePrice:50}]}]);
  await driver.updateCategoryOrder();assert.equal(f.writes.length,1);
});

test('Rocket category-only sorting preserves every item sequence and content',async()=>{
  const f=rocket();await f.client.reorderCategories(['2','1']);
  assert.deepEqual(f.writes[0].body,[{menuId:2,exposeOrder:0},{menuId:1,exposeOrder:1}]);
  const after=await f.client.catalog();assert.deepEqual(after.menus.map(row=>row.menuId),[2,1]);
  assert.deepEqual(after.menus[1].dishes.map(row=>row.dishId),[4,5]);
  assert.equal(after.menus[0].dishes[0].displayStatus,'SOLD_OUT_TODAY');
});

test('driver sorts only mapped category slots and final verification checks their actual relative order',async()=>{
  const target=(id,sortOrder)=>({kind:'category',targetId:id,sourceKey:`category:${id}`,sortOrder,name:id,mappings:[{externalId:id}]});
  const first=target('1',1),second=target('2',0);
  const driver=new AuthorityNativeDriver({}, {platformKey:'rocket_now',merchantId:'1',targets:[first,second]});
  let ids=['1','99','2'];let writes=0;
  driver.client.catalog=async()=>({menus:ids.map(menuId=>({menuId}))});
  driver.client.reorderCategories=async expected=>{writes++;assert.deepEqual(expected,['2','99','1']);ids=expected;};
  const rows=()=>ids.map(id=>({kind:'category',id,childIds:[]}));
  assert.ok(driver.structureIssues(first,rows()).some(row=>row.code==='category_order_migration_required'));
  await driver.updateCategoryOrder();assert.equal(writes,1);assert.equal(ids.indexOf('99'),1);
  assert.deepEqual(driver.structureIssues(first,rows()),[]);assert.deepEqual(driver.structureIssues(second,rows()),[]);
  await driver.updateCategoryOrder();assert.equal(writes,1);
  ids=['1','99'];await assert.rejects(()=>driver.updateCategoryOrder(),/identity_mismatch/);assert.equal(writes,1);
});

function demae(mode='ok') {
  let ids=['a','b'];let stockout=true;
  const writes=[];
  const client=new DemaeMenuClient({request:async(path,method,body)=>{
    if(method==='PUT') {
      writes.push(structuredClone(body));assert.deepEqual(body.categoryItemLinkList,[{itemCode:'b',dispOrder:1},{itemCode:'a',dispOrder:2}]);
      assert.deepEqual(body.menuPatternCategoryLinkList,[{menuPatternCode:'live'}]);
      assert.equal(Object.keys(body).some(key=>/stock|image|price/i.test(key)),false);
      if(mode!=='ignored')ids=body.categoryItemLinkList.map(row=>row.itemCode);
      if(mode==='stock')stockout=false;
      return {};
    }
    if(path.endsWith('/menu-pattern-list'))return [{chainId:1,menuPatternCode:'live'}];
    return {chainId:1,categoryCode:'c',categoryName:'category',categoryItemLinkList:ids.map(itemCode=>({itemCode}))};
  }},'1','live');
  client.catalog=async()=>({items:{categoryList:[{categoryCode:'c',categoryName:'category',applyStartDate:'2020/01/01',applyEndDate:'9999/12/31',itemList:ids.map(itemCode=>({itemCode}))}]}});
  client.stockCatalog=async()=>({itemList:[{chainId:1,itemCode:'a',linkedShopList:[{shopId:2}],stockoutItemList:[{isEndSale:stockout}]}],optionList:[]});
  return {client,writes};
}

test('Demae category item sorting keeps exact members/pattern and confirms stock independently',async()=>{
  for(const mode of ['ok','ignored','stock']) {
    const f=demae(mode);
    if(mode==='ok')await f.client.updateCategory('c',{itemCodes:['b','a']});
    else await assert.rejects(()=>f.client.updateCategory('c',{itemCodes:['b','a']}),mode==='stock'?/availability_changed/:/verification_failed/);
    assert.equal(f.writes.length,1);
  }
  const f=demae();await assert.rejects(()=>f.client.updateCategory('c',{itemCodes:['b','unknown']}),/members_require_migration/);assert.equal(f.writes.length,0);
});

function demaeCategories(mode='ok',{recommendation=true}={}) {
  let ids=['c1','c2'];
  const writes=[];
  const pattern={chainId:1,menuPatternCode:'live',menuPatternName:'merchant menu',isAvailable:true};
  const recommend={chainId:1,categoryCode:'a',categoryName:'おすすめメニュー管理用',adminCategoryName:'recommendation',type:'RECOMMEND_CATEGORY',applyStartDate:'2020/01/01',applyEndDate:'9999/12/31'};
  const rows=[{chainId:1,categoryCode:'c1',categoryName:'first',adminCategoryName:'first',type:'NORMAL_CATEGORY',applyStartDate:'2020/01/01',applyEndDate:'9999/12/31',itemList:[{itemCode:'i1',stockoutType:'END_SALE'},{itemCode:'i2',stockoutType:'NONE'}]},
    {chainId:1,categoryCode:'c2',categoryName:'second',adminCategoryName:'second',type:'NORMAL_CATEGORY',applyStartDate:'2020/01/01',applyEndDate:'9999/12/31',itemList:[{itemCode:'i3',stockoutType:'TODAY'}]}];
  const groups=[{chainId:1,optionGroupCode:'g1',optionGroupName:'group'}];
  const stock={itemList:[{chainId:1,itemCode:'i1',linkedShopList:[{shopId:2}],stockoutItemList:[{isEndSale:true}]}],optionList:[{chainId:1,optionCode:'o1',linkedShopList:[{shopId:2}],stockoutOptionList:[{isEndSale:true}]}]};
  const list=()=>ids.map(id=>structuredClone(rows.find(row=>row.categoryCode===id)));
  const client=new DemaeMenuClient({request:async(path,method,body)=>{
    if(method==='PATCH') {
      assert.equal(path,'/merchant-admin/api/v1/product/chain/1/menu-pattern/live/category-list-order');
      writes.push(structuredClone(body));
      if(mode!=='ignored')ids=body.menuPatternCategoryLinkList.filter(row=>row.categoryCode!=='a').map(row=>row.categoryCode);
      if(mode==='patternRename')pattern.menuPatternName='changed';
      if(mode==='availability')pattern.isAvailable=false;
      if(mode==='recommend')recommend.categoryName='changed';
      if(mode==='itemStock')stock.itemList[0].stockoutItemList=[];
      if(mode==='optionStock')stock.optionList[0].stockoutOptionList=[];
      if(mode==='itemOrder')rows[0].itemList.reverse();
      if(mode==='groups')groups[0].optionGroupName='changed';
      return {};
    }
    if(path.endsWith('/linked-category-list'))return {
      recommendCategory:recommendation?{...recommend,...(mode==='recommendScope'?{chainId:99}:{})}:null,
      categoryList:list().map(({itemList,...row})=>({...row,...(mode==='linkedScope'?{chainId:99}:{})}))
    };
    assert.equal(path,'/merchant-admin/api/v1/product/chain/1/menu-pattern/live');
    return {...pattern,...(mode==='patternScope'?{menuPatternCode:'draft'}:{})};
  }},'1','live');
  client.catalog=async()=>({items:{categoryList:list()},groups:structuredClone(groups)});
  client.stockCatalog=async()=>structuredClone(stock);
  return {client,writes,pattern,recommend,rows};
}

test('Demae global category sorting uses only the official PATCH order DTO, recommendation last',async()=>{
  const f=demaeCategories();const result=await f.client.reorderCategories(['c2','c1']);
  assert.deepEqual(f.writes,[{menuPatternCategoryLinkList:[{categoryCode:'c2',dispOrder:1},{categoryCode:'c1',dispOrder:2},{categoryCode:'a',dispOrder:3}]}]);
  assert.deepEqual(result.items.categoryList.map(row=>row.categoryCode),['c2','c1']);
  assert.deepEqual(result.items.categoryList[1].itemList.map(row=>row.itemCode),['i1','i2']);
  assert.equal(result.items.categoryList[1].itemList[0].stockoutType,'END_SALE');
  assert.equal(f.pattern.isAvailable,true);assert.equal(f.pattern.menuPatternName,'merchant menu');
  await f.client.reorderCategories(['c2','c1']);assert.equal(f.writes.length,1);
  const withoutRecommendation=demaeCategories('ok',{recommendation:false});
  await withoutRecommendation.client.reorderCategories(['c2','c1']);
  assert.deepEqual(withoutRecommendation.writes[0],{menuPatternCategoryLinkList:[{categoryCode:'c2',dispOrder:1},{categoryCode:'c1',dispOrder:2}]});
});

test('Demae category order fails closed on ignored save or changed content, stock, recommendation and pattern',async()=>{
  for(const mode of ['ignored','patternRename','availability','recommend','itemStock','optionStock','itemOrder','groups']) {
    const f=demaeCategories(mode);
    await assert.rejects(()=>f.client.reorderCategories(['c2','c1']),/order_verification_failed/,mode);
    assert.equal(f.writes.length,1,mode);
  }
});

test('Demae category order does not write with foreign IDs, duplicates or mismatched native scope',async()=>{
  const f=demaeCategories();
  for(const ids of [['c1','foreign'],['c1','c1'],['c1'],['c1','c2','a']])await assert.rejects(()=>f.client.reorderCategories(ids),/order_scope_invalid/);
  assert.equal(f.writes.length,0);
  for(const mode of ['linkedScope','recommendScope','patternScope']) {
    const f=demaeCategories(mode);
    await assert.rejects(()=>f.client.reorderCategories(['c2','c1']),/order_scope_invalid/,mode);
    assert.equal(f.writes.length,0,mode);
  }
});
