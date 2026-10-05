import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeMenuClient,demaeItemUpdate} from '../src/demae-menu-client.mjs';

const chainId=410649,nativeId='00000013';
const links=ids=>ids.map((optionGroupCode,index)=>({chainId,optionGroupCode,optionGroupName:`group ${optionGroupCode}`,dispOrder:index+1}));
const requested=links(['g2','g3','g1']);
function item() {
 const size=(sizeCode,start,end,price,index)=>({chainId,itemCode:nativeId,sizeCode,
  applyStartDate:start,applyEndDate:end,originalApplyStartDate:null,originalApplyEndDate:null,
  dispOrder:index,sizeName:`size ${sizeCode}`,price,linkageItemCode:null,linkageItemName:null,
  sizeOptionGroupLinkList:links(sizeCode==='001'?['g1','g2']:['other'])});
 return {chainId,itemCode:nativeId,itemName:'香菜麻辣烫',itemDescription:'description',
  itemType:'REDUCED_RATE_NORMAL_ITEM',comboItemType:'NORMAL_ITEM',appealIconCode:'0',
  categoryItemLinkList:[{chainId,categoryCode:'live',categoryName:'category',isRecommended:false}],
  itemImageUri:'https://cdn.demae-can.com/files/imgix/item720/photo.jpg?v=1',
  itemImageFileName:'photo.jpg',imageTrimmingRange:{x:0,y:0,width:100,height:100},
  sizeInfoList:[
   size('001','2026/08/11','2026/09/17',2300,1),
   size('001','2026/09/18','2026/12/31',2380,2),
   size('001','2027/01/01','9999/12/31',2480,3),
   size('002','2020/01/01','2025/12/31',999,4),
   size('002','2030/01/01','9999/12/31',1999,5)
  ]};
}

function fixture(mutate=()=>{},prepare=()=>{}) {
 const original=item(),writes=[];
 prepare(original);
 let state=structuredClone(original);
 let stock={listed:true,linkedShops:[{shopId:1}],records:[{isEndSale:true}],sizes:[{sizeCode:'001',records:[{isEndSale:true}]}]};
 let occurrences=[{categoryCode:'live',stockoutType:'PERMANENT',sizes:[{sizeCode:'001',stockoutType:'PERMANENT'}]}];
 const client=new DemaeMenuClient({request:async(path,method,body)=>{
  assert.equal(method,'PUT');assert.match(path,/item\/00000013$/);
  writes.push(structuredClone(body));
  state=structuredClone({...state,...body});
  // Native associations are keyed by item+size, not the price period. A
  // conflicting request resolves to one list for every period of that size.
  const bySize=new Map();
  for(const size of state.sizeInfoList)if(!bySize.has(size.sizeCode))bySize.set(size.sizeCode,size.sizeOptionGroupLinkList);
  state.sizeInfoList=state.sizeInfoList.map(size=>({...size,originalApplyStartDate:null,originalApplyEndDate:null,
   sizeOptionGroupLinkList:structuredClone(bySize.get(size.sizeCode))}));
  mutate(state,{stock,occurrences});
  return {};
 }},String(chainId),'live',{today:'2026-10-06'});
 client.assertScope=async()=>{};
 client.item=async()=>structuredClone(state);
 client.itemOccurrences=async()=>structuredClone(occurrences);
 client.stockState=async()=>structuredClone(stock);
 client.stockCatalog=async()=>({optionList:[{chainId,optionCode:'o',linkedShopList:[{shopId:1}]}]});
 client.group=async id=>({detail:{chainId,optionGroupCode:id,optionGroupName:`group ${id}`},
  items:[{chainId,itemCode:nativeId,sizeList:[{sizeCode:'001'}]}],options:[{chainId,optionCode:'o'}]});
 return {client,original,writes};
}

test('same-size expired/current/future periods share links, while other sizes and all period scalars are retained',()=>{
 const before=item(),copy=structuredClone(before);
 const body=demaeItemUpdate(before,{groupLinks:requested,price:2390},'2026-10-06');
 for(let index=0;index<body.sizeInfoList.length;index++) {
  const actual=body.sizeInfoList[index],prior=before.sizeInfoList[index];
  assert.deepEqual(actual.sizeOptionGroupLinkList,index<3?requested:prior.sizeOptionGroupLinkList);
  assert.deepEqual(actual,{...prior,originalApplyStartDate:prior.applyStartDate,originalApplyEndDate:prior.applyEndDate,
   price:index===1?2390:prior.price,sizeOptionGroupLinkList:index<3?requested:prior.sizeOptionGroupLinkList});
 }
 assert.deepEqual(before,copy,'request construction must not mutate the fresh before-state');
 assert.deepEqual(body.categoryItemLinkList,before.categoryItemLinkList);
 assert.equal(body.itemImageEditType,'NOT_EDIT');assert.equal(body.itemImage,null);
});

test('independent native shared-relation readback succeeds without changing permanent stock or unrelated periods',async()=>{
 const f=fixture();
 const actual=await f.client.updateItem(nativeId,{groupLinks:requested,price:2390});
 assert.equal(f.writes.length,1);
 assert.deepEqual(actual.sizeInfoList.map(size=>size.price),[2300,2390,2480,999,1999]);
 assert.deepEqual(actual.sizeInfoList.map(size=>size.sizeOptionGroupLinkList),[requested,requested,requested,links(['other']),links(['other'])]);
 assert.equal(actual.itemImageUri,f.original.itemImageUri);
});

test('same-size identity must be present and safe before a group relationship write',async()=>{
 for(const sizeCode of [undefined,null,'',' ','../001','001:other','001\n']) {
  const before=item();before.sizeInfoList[1].sizeCode=sizeCode;
  assert.throws(()=>demaeItemUpdate(before,{groupLinks:requested},'2026-10-06'),/active_size_identity_invalid/);
  const f=fixture();f.client.item=async()=>structuredClone(before);
  await assert.rejects(()=>f.client.updateItem(nativeId,{groupLinks:requested}),/active_size_identity_invalid/);
  assert.equal(f.writes.length,0);
 }
});

test('missing or ambiguous current periods cannot grant group relationship authority',async()=>{
 for(const prepare of [
  before=>{before.sizeInfoList[1].applyStartDate='2027/09/18';},
  before=>{before.sizeInfoList[4].applyStartDate='2026/01/01';}
 ]) {
  const f=fixture(()=>{},prepare);
  f.client.group=async()=>{throw Error('must not inspect proposed associations without a unique active size');};
  await assert.rejects(()=>f.client.updateItem(nativeId,{groupLinks:requested}),/ambiguous_active_size/);
  assert.equal(f.writes.length,0);
 }
});

test('another size cannot lend prior group authority, while same-size history and independently listed children retain their guards',async t=>{
 for(const mode of ['other-size-unlisted','same-size-history','listed-new','partially-listed','unlinked-draft'])await t.test(mode,async()=>{
  const f=fixture(()=>{},before=>{
   before.sizeInfoList[3].sizeOptionGroupLinkList=links(['g3']);
   before.sizeInfoList[4].sizeOptionGroupLinkList=links(['g3']);
   if(mode==='same-size-history')before.sizeInfoList[0].sizeOptionGroupLinkList=links(['g3','g1','g2']);
  });
  let stockReads=0;
  f.client.stockCatalog=async()=>{
   stockReads++;
   return {optionList:mode==='listed-new'||mode==='partially-listed'
    ?[{chainId,optionCode:'o',linkedShopList:[{shopId:1}]}]:[]};
  };
  f.client.group=async id=>({detail:{chainId,optionGroupCode:id,optionGroupName:`group ${id}`},
   items:mode==='unlinked-draft'&&id==='g3'?[]:[{chainId,itemCode:nativeId,sizeList:[{sizeCode:'001'}]}],
   options:[{chainId,optionCode:'o'},...(mode==='partially-listed'&&id==='g3'?[{chainId,optionCode:'unlisted'}]:[])]});
  if(mode==='same-size-history'||mode==='listed-new') {
   await f.client.updateItem(nativeId,{groupLinks:requested});
   assert.equal(f.writes.length,1);
   assert.equal(stockReads,mode==='same-size-history'?0:1);
  } else {
   await assert.rejects(()=>f.client.updateItem(nativeId,{groupLinks:requested}),
    mode==='unlinked-draft'?/draft_group_requires_release/:/new_group_requires_release/);
   assert.equal(f.writes.length,0);
   assert.equal(stockReads,mode==='unlinked-draft'?0:1);
  }
 });
});

const drift={
 identity:state=>{state.itemCode='other';},
 chain:state=>{state.chainId=999;},
 name:state=>{state.itemName='other';},
 description:state=>{state.itemDescription='other';},
 itemType:state=>{state.itemType='NORMAL_ITEM';},
 comboItemType:state=>{state.comboItemType='SET_ITEM_OPTION';},
 appeal:state=>{state.appealIconCode='1';},
 historicalPrice:state=>{state.sizeInfoList[0].price++;},
 currentPrice:state=>{state.sizeInfoList[1].price++;},
 futurePrice:state=>{state.sizeInfoList[2].price++;},
 otherSizePrice:state=>{state.sizeInfoList[3].price++;},
 historicalDate:state=>{state.sizeInfoList[0].applyStartDate='2026/08/12';},
 futureDate:state=>{state.sizeInfoList[2].applyEndDate='2030/12/31';},
 sizeName:state=>{state.sizeInfoList[1].sizeName='other';},
 sizeIdentity:state=>{state.sizeInfoList[2].sizeCode='003';},
 sizeChain:state=>{state.sizeInfoList[0].chainId=999;},
 sizeItem:state=>{state.sizeInfoList[2].itemCode='other';},
 linkage:state=>{state.sizeInfoList[0].linkageItemCode='changed';},
 sizeOrder:state=>{state.sizeInfoList[0].dispOrder=99;},
 periodOrder:state=>{state.sizeInfoList.reverse();},
 missingPeriod:state=>{state.sizeInfoList.pop();},
 missingSizeInfo:state=>{delete state.sizeInfoList;},
 historicalGroup:state=>{state.sizeInfoList[0].sizeOptionGroupLinkList.pop();},
 activeGroup:state=>{state.sizeInfoList[1].sizeOptionGroupLinkList.pop();},
 futureGroup:state=>{state.sizeInfoList[2].sizeOptionGroupLinkList.pop();},
 groupOrder:state=>{state.sizeInfoList[1].sizeOptionGroupLinkList.reverse();},
 groupChain:state=>{state.sizeInfoList[1].sizeOptionGroupLinkList[0].chainId=999;},
 groupCode:state=>{state.sizeInfoList[1].sizeOptionGroupLinkList[0].optionGroupCode='other';},
 groupName:state=>{state.sizeInfoList[1].sizeOptionGroupLinkList[0].optionGroupName='other';},
 groupPosition:state=>{state.sizeInfoList[1].sizeOptionGroupLinkList[0].dispOrder=99;},
 otherSizeGroup:state=>{state.sizeInfoList[3].sizeOptionGroupLinkList=[];},
 category:state=>{state.categoryItemLinkList[0].categoryCode='other';},
 image:state=>{state.itemImageUri='https://cdn.demae-can.com/files/imgix/item720/other.jpg?v=1';},
 filename:state=>{state.itemImageFileName='other.jpg';},
 cropping:state=>{state.imageTrimmingRange.x=1;},
 stock:(_state,{stock})=>{stock.records=[];},
 occurrences:(_state,{occurrences})=>{occurrences[0].stockoutType='AVAILABLE';}
};
test('shared-size relation handling cannot conceal identity, period, order, image or stock drift',async t=>{
 for(const [name,mutate] of Object.entries(drift))await t.test(name,async()=>{
  const f=fixture(mutate);
  await assert.rejects(()=>f.client.updateItem(nativeId,{groupLinks:requested,price:2390}),/demae_menu_item_verification_failed|demae_menu_availability_changed/);
  assert.equal(f.writes.length,1);
 });
});

test('verification diagnostics include only native identity and fixed field tags, never the menu body',async()=>{
 const f=fixture(drift.activeGroup);
 await assert.rejects(()=>f.client.updateItem(nativeId,{groupLinks:requested}),error=>{
  const prefix='demae_menu_item_verification_failed:';
  assert.ok(error.message.startsWith(prefix));
  assert.deepEqual(JSON.parse(error.message.slice(prefix.length)),{nativeId,failedFields:['size_group_links']});
  assert.equal(error.message.includes('香菜'),false);assert.equal(error.message.includes('https://'),false);
  return true;
 });
});
