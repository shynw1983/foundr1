import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';

const clone=value=>structuredClone(value);
const period={applyStartDate:'2000/01/01',applyEndDate:'9999/12/31'};

/** The real runner, native driver and platform serializers run against this
 * bounded merchant transport. Query POSTs are kept distinct from saves. */
function merchantFixture(platform,{changed=false,sharedOption=false,secondItem=false}={}) {
  const node=(kind,id,name,parentId,extra={})=>({kind,targetId:id,sourceKey:`${kind}:${id}`,name,parentId,
    price:['item','option'].includes(kind)?100:null,description:'',sortOrder:0,
    marker:'FS0123456789abcd',mappings:[{externalId:id}],source:{},...extra});
  const targets=[node('category','11','Foods'),node('option_group','21','Toppings'),
    node('option','31','Corn','21'),node('option','32','Egg','21',{sortOrder:1}),
    node('item','41','Noodles','11',{source:{groupIds:['21']}})];
  if(changed)targets[2].name='Sweet corn';
  if(secondItem)targets.push(node('item','42','Rice','11',{sortOrder:1,source:{groupIds:[]}}));
  if(sharedOption) {
    targets.push(node('option_group','22','Extra toppings'));
    // The database constrains exact external text, while the manifest accepts
    // both merchant UI and plain ID forms for the same native option.
    targets.push(node('option','31-shared',targets[2].name,'22',{mappings:[{externalId:'itemList_131true'}]}));
    targets.find(target=>target.kind==='item').source.groupIds.push('22');
  }
  const payload={authoritativePublication:true,sourceId:'source',storeId:'store',platformKey:platform,
    merchantId:'1',menuPatternCode:'live',revision:1,newItemsHidden:true,imagePolicy:'read_only',targets};
  const calls=[],writes=[],progress=[],controls={};
  const options=[{id:'31',name:'Corn',price:100,hidden:true},{id:'32',name:'Egg',price:100,hidden:false}];
  const stock={hasOverOptionLimitChain:false,
    itemList:[{chainId:1,itemCode:'41',linkedShopList:[{shopId:7,orderType:'DELIVERY'}],
      stockoutItemList:[{shopId:7,orderType:'DELIVERY',isEndSale:false,isCurrentApplying:true}],itemSizeList:[]}],
    optionList:options.map(option=>({chainId:1,optionCode:option.id,
      linkedShopList:[{shopId:7,orderType:'DELIVERY'}],
      stockoutOptionList:[{shopId:7,orderType:'DELIVERY',isEndSale:option.hidden,isCurrentApplying:true}]}))};
  if(secondItem)stock.itemList.push({...clone(stock.itemList[0]),itemCode:'42'});
  const initialStock=clone(stock);
  const demaeOptions=()=>options.map(option=>({chainId:1,optionCode:option.id,optionName:option.name,
    price:option.price,...(option.period??period),itemType:'REDUCED_RATE_NORMAL_ITEM',linkageItemCode:'',linkageItemName:''}));
  const rocketGroup=()=>({optionId:21,optionName:'Toppings',minSelect:0,maxSelect:2,isMultiSelect:true,
    isMandatory:false,mappingDishCount:1,mappingDishes:[{dishId:41}],
    optionItems:options.map((option,index)=>({optionItemId:Number(option.id),optionItemName:option.name,
      salePrice:option.price,displayStatus:option.hidden?'NOT_EXPOSE':'ON_SALE',exposeOrder:index}))});
  const demaeGroupIds=sharedOption?['21','22']:['21'];
  const groupOrders=new Map([['21',['31','32']],['22',['31']]]);
  const categoryOrder=secondItem?['41','42']:['41'];
  const demaeGroupName=id=>id==='21'?'Toppings':'Extra toppings';
  const demaeItem={chainId:1,itemCode:'41',itemName:'Noodles',itemDescription:'',
    categoryItemLinkList:[{categoryCode:'11'}],sizeInfoList:[{sizeCode:'001',...period,price:100,
      sizeOptionGroupLinkList:demaeGroupIds.map((id,index)=>({chainId:1,optionGroupCode:id,
        optionGroupName:demaeGroupName(id),dispOrder:index+1}))}]};
  const demaeItems=new Map([['41',demaeItem]]);
  if(secondItem)demaeItems.set('42',{...clone(demaeItem),itemCode:'42',itemName:'Rice',
    sizeInfoList:[{...clone(demaeItem.sizeInfoList[0]),sizeOptionGroupLinkList:[]}]});
  const transport={request:async(path,method='GET',body)=>{
    calls.push({path,method,body:clone(body)});
    const query=platform==='demae_can'&&path.endsWith('/stock/stockout/target-list')&&method==='POST';
    if(method!=='GET'&&!query) {
      writes.push({path,method,body:clone(body)});
      if(platform==='rocket_now'&&method==='POST'&&path.endsWith('/option-items/31/update')) {
        Object.assign(options[0],{name:body.optionItemName,price:body.salePrice,
          hidden:body.displayStatus==='NOT_EXPOSE'});return {};
      }
      if(platform==='demae_can'&&method==='PUT'&&path.endsWith('/option-item/31/2000-01-01/9999-12-31')) {
        Object.assign(options[0],{name:body.optionName,price:body.price});return {};
      }
      const writtenGroup=platform==='demae_can'&&method==='PUT'&&path.match(/\/option-group\/(21|22)$/)?.[1];
      if(writtenGroup) {
        groupOrders.set(writtenGroup,body.optionGroupItemLinkList.map(row=>String(row.optionCode)));
        if(controls.changeStockOnGroupWrite)stock.optionList[0].stockoutOptionList[0].isEndSale=false;
        return {};
      }
      if(platform==='demae_can'&&method==='PUT'&&path.endsWith('/category/11/2000-01-01/9999-12-31')) {
        categoryOrder.splice(0,categoryOrder.length,...body.categoryItemLinkList.map(row=>String(row.itemCode)));
        return {};
      }
      throw Error(`Unexpected mutation ${method} ${path}`);
    }
    if(platform==='rocket_now') {
      if(path.endsWith('/all-menu-dishes'))return {menus:[{menuId:11,menuName:'Foods',exposeOrder:0,
        dishes:[{dishId:41,dishName:'Noodles',exposeOrder:0}]}]};
      if(path.endsWith('/all-options?fetchDish=true'))return [rocketGroup()];
      if(path.endsWith('/dishes/41/detail'))return {dishId:41,dishName:'Noodles',salePrice:100,description:'',
        displayStatus:'ON_SALE',mappingMenus:[{menuId:11}],options:[rocketGroup()]};
    } else {
      if(path.endsWith('/search/chain-menu-pattern'))return [{chain:{chainId:1},menuPatternList:[{menuPatternCode:'live'}]}];
      if(path.endsWith('/menu-pattern/live/item-list'))return {categoryList:[{chainId:1,categoryCode:'11',
        categoryName:'Foods',dispOrder:1,...period,itemList:categoryOrder.map((id,index)=>({chainId:1,
          itemCode:id,itemName:demaeItems.get(id)?.itemName,dispOrder:index+1}))}]};
      if(path.endsWith('/linked-option-group-list'))return demaeGroupIds.map(id=>({chainId:1,optionGroupCode:id,optionGroupName:demaeGroupName(id)}));
      if(path.endsWith('/stock/stockout/shop-list'))return {shopList:[{chainId:1,shopId:7,orderType:'DELIVERY'}]};
      if(path.endsWith('/stock/stockout/target-list'))return clone(stock);
      const itemId=path.match(/\/item\/(41|42)$/)?.[1];
      if(itemId) {
        if(itemId==='41'&&controls.failItemReadAt===calls.filter(row=>row.path.endsWith('/item/41')).length)
          throw Error('simulated full graph proof failure');
        return clone(demaeItems.get(itemId));
      }
      if(path.endsWith('/category/11/2000-01-01/9999-12-31'))return {chainId:1,categoryCode:'11',
        categoryName:'Foods',adminCategoryName:'Foods',...period,type:'NORMAL_CATEGORY',categoryType:'NORMAL_CATEGORY',
        businessType:'NORMAL',isSideOrderCategory:false,categoryDescription:''};
      if(path.endsWith('/category/11/menu-pattern-list'))return [{chainId:1,menuPatternCode:'live'}];
      const groupId=path.match(/\/option-group\/(21|22)(?:\/|$)/)?.[1];
      if(groupId&&path.endsWith(`/option-group/${groupId}`)) {
        if(controls.failGroupReadback&&writes.some(row=>row.path.endsWith(`/option-group/${groupId}`))) {
          controls.failGroupReadback=false;throw Error('simulated native group readback failure');
        }
        return {chainId:1,optionGroupCode:groupId,optionGroupName:demaeGroupName(groupId),
          adminOptionGroupName:demaeGroupName(groupId),optionGroupDescription:'',optionButtonType:'CHECKBOX'};
      }
      if(groupId&&path.endsWith('/linked-item-list'))return [{chainId:1,itemCode:'41',sizeList:[{sizeCode:'001'}]}];
      if(groupId&&path.endsWith('/option-item-list'))return groupOrders.get(groupId)
        .flatMap(id=>demaeOptions().filter(option=>String(option.optionCode)===id));
      if(path.endsWith('/menu-pattern/live/option-item-list'))return demaeOptions();
    }
    throw Error(`Unexpected query ${method} ${path}`);
  }};
  return {payload,driver:new AuthorityNativeDriver(transport,payload),calls,writes,progress,stock,initialStock,options,
    groupOrders,categoryOrder,demaeItems,controls,
    run:(onProgress=()=>{})=>runUberAuthorityPublication(payload,new AuthorityNativeDriver(transport,payload),async row=>{
      progress.push(clone(row));await onProgress(row);
    })};
}

test('Demae unchanged relationships reuse one phase read without repeating full graphs or group triplets',async()=>{
  const fixture=merchantFixture('demae_can');
  await fixture.run();
  const count=suffix=>fixture.calls.filter(row=>row.path.endsWith(suffix)).length;
  // Preflight, the independent relationship boundary, and final verification
  // each read the complete native graph. Category no-ops borrow no write proof.
  assert.equal(count('/menu-pattern/live/item-list'),3);
  assert.equal(count('/item/41'),3);
  assert.equal(count('/option-group/21'),3);
  assert.equal(count('/option-group/21/linked-item-list'),3);
  assert.equal(count('/option-group/21/option-item-list'),3);
  assert.equal(count('/stock/stockout/target-list'),3);
  assert.deepEqual(fixture.writes,[]);
  assert.deepEqual(fixture.stock,fixture.initialStock);
});

test('Demae cached membership checks retain all periods and reject an unowned future option',async()=>{
  const fixture=merchantFixture('demae_can');
  fixture.options.push({id:'999',name:'Future unowned',price:100,hidden:true,
    period:{applyStartDate:'2999/01/01',applyEndDate:'9999/12/31'}});
  fixture.groupOrders.get('21').push('999');
  await assert.rejects(()=>fixture.run(),/unowned_group_member/);
  assert.deepEqual(fixture.writes,[]);
});

test('Demae final native reads reject future-period drift after a cached group no-op',async()=>{
  const fixture=merchantFixture('demae_can');
  let injected=false;
  await assert.rejects(()=>fixture.run(row=>{
    if(!injected&&row.phase==='relationships'&&row.sourceKey==='option_group:21') {
      injected=true;
      fixture.options.push({id:'999',name:'Concurrent future unowned',price:100,hidden:true,
        period:{applyStartDate:'2999/01/01',applyEndDate:'9999/12/31'}});
      fixture.groupOrders.get('21').push('999');
    }
  }),/unowned_group_member|content_unverified/);
  assert.equal(injected,true);
  assert.deepEqual(fixture.writes,[]);
});

test('Demae relationship writes keep independent stock guards and refresh the later category boundary',async()=>{
  const fixture=merchantFixture('demae_can');
  fixture.groupOrders.get('21').reverse();
  const result=await fixture.run();
  assert.equal(result.outcome,'applied');
  assert.equal(fixture.writes.length,1);
  assert.match(fixture.writes[0].path,/\/option-group\/21$/);
  assert.deepEqual(fixture.groupOrders.get('21'),['31','32']);
  const saveAt=fixture.calls.findIndex(row=>row.method==='PUT');
  const before=fixture.calls.slice(0,saveAt),after=fixture.calls.slice(saveAt+1);
  assert.ok(before.some(row=>row.path.endsWith('/stock/stockout/target-list')));
  assert.ok(after.filter(row=>row.path.endsWith('/stock/stockout/target-list')).length>=3,
    'native write readback, category boundary and final verification retain independent stock reads');
  assert.ok(after.filter(row=>row.path.endsWith('/item/41')).length>=2,
    'a changed relationship cannot lend its earlier full graph to the category phase');
  assert.deepEqual(fixture.stock,fixture.initialStock);
});

test('Demae a group save that changes stock still fails the unchanged availability rule',async()=>{
  const fixture=merchantFixture('demae_can');
  fixture.groupOrders.get('21').reverse();
  fixture.controls.changeStockOnGroupWrite=true;
  await assert.rejects(()=>fixture.run(),/demae_menu_availability_changed/);
  assert.equal(fixture.writes.length,1);
});

test('Demae a real relationship write must first succeed at the fresh complete graph barrier',async()=>{
  const fixture=merchantFixture('demae_can');
  fixture.groupOrders.get('21').reverse();
  // The first two reads are preflight and the reusable relationship snapshot.
  // A real write must retain the old independent second relationship proof.
  fixture.controls.failItemReadAt=3;
  await assert.rejects(()=>fixture.run(),/simulated full graph proof failure/);
  assert.deepEqual(fixture.writes,[],
    'a failed full private-graph barrier must stop before saving the group');
});

test('Demae a failed mutation readback invalidates no-op reuse before any later phase',async()=>{
  const fixture=merchantFixture('demae_can');
  fixture.groupOrders.get('21').reverse();
  assert.deepEqual((await fixture.driver.preflight(fixture.payload)).issues,[]);
  await fixture.driver.beginPhase('relationships');
  fixture.controls.failGroupReadback=true;
  await assert.rejects(()=>fixture.driver.updateRelationships(fixture.payload.targets[1]),/simulated native group readback failure/);
  const before=fixture.calls.filter(row=>row.path.endsWith('/item/41')).length;
  await fixture.driver.beginPhase('categories');
  const after=fixture.calls.filter(row=>row.path.endsWith('/item/41')).length;
  assert.equal(after,before+1,'even an unsuccessful mutation attempt invalidates the earlier category reuse');
});

test('Demae category sorting rereads the full graph before a real write and preserves stock',async()=>{
  const fixture=merchantFixture('demae_can',{secondItem:true});
  fixture.categoryOrder.reverse();
  const result=await fixture.run();
  assert.equal(result.outcome,'applied');
  assert.equal(fixture.writes.length,1);
  assert.match(fixture.writes[0].path,/\/category\/11\//);
  assert.deepEqual(fixture.categoryOrder,['41','42']);
  const saveAt=fixture.calls.findIndex(row=>row.method==='PUT');
  const before=fixture.calls.slice(0,saveAt);
  assert.equal(before.filter(row=>row.path.endsWith('/item/41')).length,3,
    'preflight, relationship phase and a fresh complete proof precede the category mutation');
  assert.equal(fixture.calls.filter(row=>row.path.endsWith('/item/41')).length,4,
    'the final full graph remains independent after category readback');
  assert.deepEqual(fixture.stock,fixture.initialStock);
});

test('demae_can: one shared native option changed in two source groups is saved only once',async()=>{
  const fixture=merchantFixture('demae_can',{changed:true,sharedOption:true});
  const result=await fixture.run();
  assert.equal(result.observations.length,7);
  const observed=result.observations.filter(row=>['option:31','option:31-shared'].includes(row.sourceKey));
  assert.equal(observed.length,2);
  assert.ok(observed.every(row=>row.name==='Sweet corn'&&row.hidden===true&&row.structureVerified===true));
  assert.equal(fixture.writes.length,1,'shared logical occurrences must not repeat the same native content save');
  assert.deepEqual(fixture.stock,fixture.initialStock);
});

for(const platform of ['rocket_now','demae_can']) {
  test(`${platform}: an unchanged full graph performs zero native saves`,async()=>{
    const fixture=merchantFixture(platform);
    const result=await fixture.run();
    assert.equal(result.observations.length,5);
    assert.deepEqual(fixture.writes,[]);
    assert.deepEqual(fixture.stock,fixture.initialStock);
    assert.equal(result.observations.find(row=>row.sourceKey==='option:31').hidden,true);
    if(platform==='demae_can')assert.ok(fixture.calls.some(row=>row.method==='POST'&&row.path.endsWith('/stock/stockout/target-list')),
      'the native stock query POST must not be counted as a save');
    const savingTargets=new Set(fixture.progress.filter(row=>row.phase==='content'&&row.sourceKey).map(row=>row.sourceKey));
    assert.equal(savingTargets.size,0,'unchanged targets must not be shown as content writes');
    const summary=fixture.progress.find(row=>row.phase==='content'&&row.checkedTargets!==undefined);
    assert.equal(summary.checkedTargets,5);
    assert.equal(summary.contentChanges,0);
    assert.equal(summary.skippedTargets,5);
  });

  test(`${platform}: one changed option saves that exact native ID once and retains stock and periods`,async()=>{
    const fixture=merchantFixture(platform,{changed:true});
    const result=await fixture.run();
    assert.equal(fixture.writes.length,1);
    assert.match(fixture.writes[0].path,platform==='rocket_now'?/\/option-items\/31\/update$/:/\/option-item\/31\/2000-01-01\/9999-12-31$/);
    assert.equal(fixture.options[0].name,'Sweet corn');
    assert.equal(fixture.options[0].hidden,true);
    assert.equal(fixture.options[1].name,'Egg');
    assert.deepEqual(fixture.stock,fixture.initialStock);
    assert.equal(result.observations.find(row=>row.sourceKey==='option:31').name,'Sweet corn');
    const savingTargets=new Set(fixture.progress.filter(row=>row.phase==='content'&&row.sourceKey).map(row=>row.sourceKey));
    assert.deepEqual([...savingTargets],['option:31']);
    const summary=fixture.progress.find(row=>row.phase==='content'&&row.checkedTargets!==undefined);
    assert.equal(summary.checkedTargets,5);
    assert.equal(summary.contentChanges,1);
    assert.equal(summary.skippedTargets,4);
    if(platform==='demae_can') {
      assert.equal(fixture.writes[0].body.applyStartDate,period.applyStartDate);
      assert.equal(fixture.writes[0].body.applyEndDate,period.applyEndDate);
    }
  });

  test(`${platform}: skipping unchanged writes still independently rejects a newly exposed created option`,async()=>{
    const fixture=merchantFixture(platform);
    fixture.payload.targets.find(target=>target.sourceKey==='option:31').mappings[0].created=true;
    await assert.rejects(()=>fixture.run(row=>{
      if(row.phase==='verifying') {
        fixture.options[0].hidden=false;
        fixture.stock.optionList[0].stockoutOptionList[0].isEndSale=false;
      }
    }),/uber_authority_draft_exposed:option:31/);
    assert.deepEqual(fixture.writes,[]);
  });
}
