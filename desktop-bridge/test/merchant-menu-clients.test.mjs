import test from 'node:test';
import assert from 'node:assert/strict';
import {RocketMenuClient,rocketDishUpdate,rocketPhysicalId} from '../src/rocket-menu-client.mjs';
import {DemaeMenuClient,demaeItemUpdate} from '../src/demae-menu-client.mjs';

const dish=()=>({dishId:12,dishName:'old',description:'old description',salePrice:100,displayStatus:'NOT_EXPOSE',mappingMenus:[{menuId:2}],options:[{optionId:3,exposeOrder:0,optionItems:[{optionItemId:4,displayStatus:'NOT_EXPOSE'}]}]});
test('Rocket content edits preserve permanent hidden state and option availability',()=>{
 const payload=rocketDishUpdate(dish(),{name:'new',price:227},'1');
 assert.equal(payload.salePrice,227);assert.equal(payload.displayStatus,'NOT_EXPOSE');assert.equal(payload.soldOutHour,null);
 assert.equal(payload.optionMappingDtos[0].optionItemSaveDtos[0].displayStatus,'NOT_EXPOSE');
 assert.equal(rocketPhysicalId('sub_checkbox_2_12'),'12');
 assert.throws(()=>rocketPhysicalId('unknown:name'),/invalid/);
 assert.throws(()=>rocketDishUpdate(dish(),{price:22.7},'1'),/price_invalid/);
});
test('Rocket writes are checked by a second independent read',async()=>{
 let state=dish();let writes=0;
 const transport={async request(path,method,body){if(method==='POST'){writes++;state={...state,dishName:body.dishName,salePrice:body.salePrice};return {};}return structuredClone(state);}};
 const client=new RocketMenuClient(transport,'1');
 assert.equal((await client.updateDish('12',{name:'new',price:227})).salePrice,227);assert.equal(writes,1);
 transport.request=async(path,method)=>method==='POST'?{}:dish();
 await assert.rejects(()=>client.updateDish('12',{price:227}),/verification_failed/);
});
test('Rocket creations always use a hidden marker and are never blindly retried',async()=>{
 let body,calls=0;
 const client=new RocketMenuClient({request:async(path,method,value)=>{calls++;body=value;throw Error('timeout');}},'1');
 await assert.rejects(()=>client.createHiddenDish({marker:'FS0123456789abcd',price:227,menuId:'2'}),/timeout/);
 assert.equal(calls,1);assert.equal(body.displayStatus,'NOT_EXPOSE');assert.equal(body.dishName,'FS0123456789abcd');
});
const demaeItem=()=>({chainId:1,itemCode:'a',itemName:'old',itemDescription:'desc',itemType:'REDUCED_RATE_NORMAL_ITEM',categoryItemLinkList:[{categoryCode:'c'}],sizeInfoList:[{sizeCode:'1',applyStartDate:'2020/01/01',applyEndDate:'2025/12/31',price:80},{sizeCode:'1',applyStartDate:'2026/01/01',applyEndDate:'9999/12/31',price:180}]});
test('Demae updates only the current price period, preserving photos and links',()=>{
 const body=demaeItemUpdate(demaeItem(),{price:190},'2026-09-07');
 assert.deepEqual(body.sizeInfoList.map(row=>row.price),[80,190]);assert.equal(body.itemImageEditType,'NOT_EDIT');
 assert.deepEqual(body.sizeInfoList.map(row=>[row.originalApplyStartDate,row.originalApplyEndDate]),[['2020/01/01','2025/12/31'],['2026/01/01','9999/12/31']]);
 assert.deepEqual(body.categoryItemLinkList,[{categoryCode:'c'}]);assert.equal('stockoutType' in body,false);
 const ambiguous=demaeItem();ambiguous.sizeInfoList.push({...ambiguous.sizeInfoList[1],sizeCode:'2'});
 assert.throws(()=>demaeItemUpdate(ambiguous,{price:190},'2026-09-07'),/ambiguous/);
});
test('Demae group ordering changes leave historical price periods and old associations intact',()=>{
 const before=demaeItem();before.sizeInfoList[0].sizeOptionGroupLinkList=[{optionGroupCode:'old'}];
 const links=[{chainId:1,optionGroupCode:'new',dispOrder:1}];
 const body=demaeItemUpdate(before,{groupLinks:links},'2026-09-08');
 assert.deepEqual(body.sizeInfoList[0].sizeOptionGroupLinkList,[{optionGroupCode:'old'}]);
 assert.deepEqual(body.sizeInfoList[1].sizeOptionGroupLinkList,links);
 assert.deepEqual(body.sizeInfoList.map(row=>row.price),[80,180]);
});
test('Demae rejects the wrong chain and shared patterns before any write',async()=>{
 let writes=0;
 const transport={request:async(path,method)=>{if(method)writes++;return [{chain:{chainId:1},menuPatternList:[{menuPatternCode:'one'},{menuPatternCode:'two'}]}];}};
 const client=new DemaeMenuClient(transport,'1','one');
 await assert.rejects(()=>client.assertScope(),/shared_chain/);
 await assert.rejects(()=>new DemaeMenuClient(transport,'2','one').assertScope(),/scope_mismatch/);
 assert.equal(writes,0);
});
test('Demae rejects unsupported unclassified main-item creation before any request',async()=>{
 let calls=0;
 const transport={request:async()=>{calls++;}};
 await assert.rejects(()=>new DemaeMenuClient(transport,'1','one').createUnlinkedItem(),/requires_safe_staging_category/);
 assert.equal(calls,0);
});

test('Demae option creation binds its receipt journal to chain and deterministic marker',async()=>{
 let call;
 const client=new DemaeMenuClient({request:async(...args)=>{
  if(args[1]==='POST'){call=args;return {optionCode:'001'};}
  return [{chain:{chainId:1},menuPatternList:[{menuPatternCode:'one'}]}];
 }},'1','one',{today:'2026-09-07'});
 await client.createUnlinkedOption({marker:'FS0123456789abcd',price:800,itemType:'REDUCED_RATE_NORMAL_ITEM'});
 assert.equal(call[3].receiptKey,'demae:1:option:FS0123456789abcd');
 assert.equal(call[2].price,800);assert.equal(call[2].optionName,'FS0123456789abcd');
});

test('Rocket content-only edits omit all image commands, including during pending reviews',async()=>{
 const image={dishImage:{imageId:1,imagePath:'/image',fileName:'photo.jpg',exposeOrder:0},requestDishImage:null};
 const before={...dish(),allDishImages:[image],dishImages:[image.dishImage]};
 assert.equal(Object.keys(rocketDishUpdate(before,{price:300},'1')).some(key=>/image/i.test(key)),false);
 let writes=0;
 let state={...before,allDishImages:[{...image,requestDishImage:{requestId:9}}],allDetailImages:[{requestId:10}]};
 const client=new RocketMenuClient({request:async(path,method,body)=>{
  if(method){writes++;assert.equal(Object.keys(body).some(key=>/image/i.test(key)),false);state={...state,salePrice:body.salePrice};}
  return structuredClone(state);
 }},'1');
 const actual=await client.updateDish('12',{price:300});
 assert.equal(writes,1);assert.equal(actual.allDishImages[0].requestDishImage.requestId,9);
 assert.deepEqual(actual.allDetailImages,[{requestId:10}]);
});
test('Rocket does not trust a successful response with wrong category, associations or image state',async()=>{
 for(const kind of ['category','groups','images']) {
  let state=dish();
  const client=new RocketMenuClient({request:async(path,method,body)=>{
   if(method) {state={...state,dishName:body.dishName};if(kind==='groups')state.options=[];if(kind==='images')state.allDishImages=[];return {};}
   return structuredClone(state);
  }},'1');
  await assert.rejects(()=>client.updateDish('12',kind==='category'?{menuId:'99'}:{name:'new'}),/verification_failed/);
 }
});
test('Rocket group edits cannot reopen an already hidden member',()=>{
 const groups=[{optionId:3,exposeOrder:0,optionItems:[{optionItemId:4,displayStatus:'ON_SALE'}]}];
 assert.equal(rocketDishUpdate(dish(),{groups},'1').optionMappingDtos[0].optionItemSaveDtos[0].displayStatus,'NOT_EXPOSE');
 assert.equal(rocketDishUpdate({...dish(),displayStatus:'ON_SALE',forceNotExpose:true},{name:'new'},'1').displayStatus,'NOT_EXPOSE');
});
test('Demae refuses linking a draft before any merchant request',async()=>{
 let requests=0;
 const client=new DemaeMenuClient({request:async()=>{requests++;}},'1','one');
 await assert.rejects(()=>client.updateItem('a',{categoryLinks:[{categoryCode:'c'}]}),/link_publication_not_supported/);
 assert.equal(requests,0);
});
test('Demae verifies actual price, relationships, photos and availability after an update',async()=>{
 for(const failure of [null,'price','groups','photo','stock']) {
  let state=demaeItem(),stock='PERMANENT';state.itemImageUri='/photo.jpg';
  const client=new DemaeMenuClient({request:async(path,method,body)=>{
   if(method==='PUT') {
    if(failure!=='price')state=structuredClone({...state,...body});
    if(failure==='groups')state.sizeInfoList[1].sizeOptionGroupLinkList=[];
    if(failure==='photo')state.itemImageUri=null;
    if(failure==='stock')stock='AVAILABLE';
    return {};
   }
   if(path.endsWith('/chain-menu-pattern'))return [{chain:{chainId:1},menuPatternList:[{menuPatternCode:'one'}]}];
   if(path.endsWith('/stockout/shop-list'))return {shopList:[{chainId:1,shopId:2,orderType:'DELIVERY'}]};
   if(path.endsWith('/stockout/target-list'))return {hasOverOptionLimitChain:false,itemList:[{chainId:1,itemCode:'a',linkedShopList:[{shopId:2}],stockoutItemList:[{isEndSale:true}],itemSizeList:[]}],optionList:[]};
   if(path.endsWith('/linked-option-group-list'))return [];
   if(path.endsWith('/item-list'))return {categoryList:[{categoryCode:'c',itemList:[{itemCode:'a',stockoutType:stock,sizeInfoList:[]}]}]};
   return structuredClone(state);
  }},'1','one',{today:'2026-09-07'});
  state.sizeInfoList[1].sizeOptionGroupLinkList=[{optionGroupCode:'g'}];
  if(failure)await assert.rejects(()=>client.updateItem('a',{name:'new',price:190}),/verification_failed|availability_changed/);
  else assert.equal((await client.updateItem('a',{name:'new',price:190})).itemName,'new');
 }
});

test('Demae option updates retain and independently verify permanent stockout records',async()=>{
 for(const loseHold of [false,true]) {
  let option={chainId:1,optionCode:'007',applyStartDate:'2026/01/01',applyEndDate:'9999/12/31',optionName:'old',price:100,itemType:'REDUCED_RATE_NORMAL_ITEM'};
  let records=[{shopId:2,isEndSale:true,applyStartType:'NOW',applyEndType:'INDEFINITE'}];
  const client=new DemaeMenuClient({request:async(path,method,body)=>{
   if(method==='PUT') {
    assert.match(path,/\/007\/2026-01-01\/9999-12-31$/);
    option=structuredClone(body);if(loseHold)records=[];return {};
   }
   if(path.endsWith('/chain-menu-pattern'))return [{chain:{chainId:1},menuPatternList:[{menuPatternCode:'one'}]}];
   if(path.endsWith('/stockout/shop-list'))return {shopList:[{chainId:1,shopId:2,orderType:'DELIVERY'}]};
   if(path.endsWith('/stockout/target-list'))return structuredClone({hasOverOptionLimitChain:false,itemList:[],optionList:[{chainId:1,optionCode:'007',linkedShopList:[{shopId:2}],stockoutOptionList:records}]});
   return [structuredClone(option)];
  }},'1','one',{today:'2026-09-07'});
  if(loseHold)await assert.rejects(()=>client.updateOption('007',{name:'new',price:217}),/availability_changed/);
  else assert.equal((await client.updateOption('007',{name:'new',price:217})).price,217);
 }
});
test('Demae refuses truncated stock records and ambiguous physical shops',async()=>{
 for(const ambiguous of [false,true]) {
  let requests=0;
  const client=new DemaeMenuClient({request:async(path)=>{
   requests++;
   if(path.endsWith('/shop-list'))return {shopList:ambiguous?[{chainId:1,shopId:2},{chainId:1,shopId:3}]:[{chainId:1,shopId:2}]};
   return {hasOverOptionLimitChain:true,itemList:[],optionList:[]};
  }},'1','one');
  await assert.rejects(()=>client.stockCatalog(),/scope_ambiguous|snapshot_incomplete/);
  assert.equal(requests,ambiguous?1:2);
 }
});
