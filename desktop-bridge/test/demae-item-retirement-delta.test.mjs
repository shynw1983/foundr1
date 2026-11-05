import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';

const period={applyStartDate:'2000/01/01',applyEndDate:'9999/12/31'};
function fixture() {
 const target={kind:'item',targetId:'retired',sourceKey:'item:retired',archived:true,name:'retired',price:100,description:'',
  marker:'FS0123456789abcd',mappings:[{externalId:'99'}],source:{groupIds:[]}};
 const payload={authoritativePublication:true,sourceId:'s',storeId:'os',platformKey:'demae_can',merchantId:'1',menuPatternCode:'live',
  revision:1,newItemsHidden:true,imagePolicy:'read_only',targets:[target]};
 const item=(id,links)=>({chainId:1,itemCode:id,itemName:id,itemDescription:'',categoryItemLinkList:links,
  sizeInfoList:[{sizeCode:'001',...period,price:100,sizeOptionGroupLinkList:[]}]});
 const state={catalog:{categoryList:[{categoryCode:'other',categoryName:'Other',itemList:[{itemCode:'88',itemName:'Other'}]}]},
  retired:item('99',[]),other:item('88',[{categoryCode:'other'}]),listed:false,fail:null};
 const calls=[],saves=[];
 const transport={request:async(path,method='GET',body)=>{
  calls.push({path,method});
  if(state.fail&&path.endsWith(state.fail))throw Error('native read unavailable');
  if(method!=='GET'&&!path.endsWith('/stock/stockout/target-list')) {
   saves.push({path,method,body});throw Error('read-only retirement must not save');
  }
  if(path.endsWith('/search/chain-menu-pattern'))return [{chain:{chainId:1},menuPatternList:[{menuPatternCode:'live'}]}];
  if(path.endsWith('/menu-pattern/live/item-list')) {
   const value=structuredClone(state.catalog);
   if(state.listed)value.categoryList[0].itemList.push({itemCode:'99',itemName:'retired'});
   return value;
  }
  if(path.endsWith('/linked-option-group-list'))return [];
  if(path.endsWith('/item/99'))return structuredClone(state.retired);
  if(path.endsWith('/item/88'))return structuredClone(state.other);
  if(path.endsWith('/stock/stockout/shop-list'))return {shopList:[{chainId:1,shopId:7,orderType:'DELIVERY'}]};
  if(path.endsWith('/stock/stockout/target-list'))return {hasOverOptionLimitChain:false,optionList:[],
   itemList:['88',...(state.listed?['99']:[])].map(itemCode=>({chainId:1,itemCode,
    linkedShopList:[{shopId:7,orderType:'DELIVERY'}],stockoutItemList:[{shopId:7,orderType:'DELIVERY',isEndSale:false,isCurrentApplying:true}]}))};
  throw Error(`unexpected native read:${path}`);
 }};
 return {payload,target,state,calls,saves,driver:new AuthorityNativeDriver(transport,payload)};
}

test('already unlinked Demae item needs only fresh scoped catalog and exact item reads, with zero saves',async()=>{
 const f=fixture();
 f.driver.snapshot=async()=>{throw Error('already unlinked item must not scan the complete native graph');};
 await f.driver.retire(f.target);
 assert.equal(f.calls.length,4);
 assert.ok(f.calls.some(row=>row.path.endsWith('/search/chain-menu-pattern')));
 assert.ok(f.calls.some(row=>row.path.endsWith('/menu-pattern/live/item-list')));
 assert.ok(f.calls.some(row=>row.path.endsWith('/item/99')));
 assert.deepEqual(f.saves,[]);
});

for(const [label,mutate] of Object.entries({
 'live catalog still lists item':f=>{f.state.listed=true;},
 'detail retains a category link':f=>{f.state.retired.categoryItemLinkList=[{categoryCode:'draft'}];},
 'missing explicit detail links':f=>{delete f.state.retired.categoryItemLinkList;},
 'malformed detail links':f=>{f.state.retired.categoryItemLinkList={};},
 'wrong native item identity':f=>{f.state.retired.itemCode='different';},
 'wrong native chain identity':f=>{f.state.retired.chainId=2;},
 'coercible native item identity':f=>{f.state.retired.itemCode=['99'];},
 'coercible native chain identity':f=>{f.state.retired.chainId=[1];},
 'truncated native detail':f=>{f.state.retired.hasMore=true;},
 'truncated live catalog':f=>{f.state.catalog.isContinueNextPage=true;},
 'unknown pagination flag':f=>{f.state.catalog.hasMore='false';},
 'missing category item list':f=>{delete f.state.catalog.categoryList[0].itemList;},
 'wrong category summary chain':f=>{f.state.catalog.categoryList[0].chainId=2;},
 'coercible summary chain':f=>{f.state.catalog.categoryList[0].chainId=[1];},
 'wrong item summary chain':f=>{f.state.catalog.categoryList[0].itemList[0].chainId=2;},
 'unknown item summary identity':f=>{delete f.state.catalog.categoryList[0].itemList[0].itemCode;},
 'duplicate category summaries':f=>{f.state.catalog.categoryList.push(structuredClone(f.state.catalog.categoryList[0]));},
 'duplicate item summaries':f=>{f.state.catalog.categoryList[0].itemList.push({...f.state.catalog.categoryList[0].itemList[0]});},
 'invalid catalog dates':f=>{Object.assign(f.state.catalog.categoryList[0],{applyStartDate:'2026/02/30',applyEndDate:'9999/12/31'});},
 'one missing catalog period endpoint':f=>{f.state.catalog.categoryList[0].itemList[0].applyStartDate='2026/01/01';},
 'failed detail read':f=>{f.state.fail='/item/99';},
 'failed catalog read':f=>{f.state.fail='/menu-pattern/live/item-list';},
 'failed scope read':f=>{f.state.fail='/search/chain-menu-pattern';}
}))test(`uncertain Demae item retirement proof preserves complete carrier barrier: ${label}`,async()=>{
 const f=fixture();mutate(f);let fullReads=0;
 f.driver.snapshot=async()=>{fullReads++;throw Error('complete native private-carrier barrier');};
 await assert.rejects(()=>f.driver.retire(f.target),/private-carrier barrier/);
 assert.equal(fullReads,1);assert.deepEqual(f.saves,[]);
});

test('Demae live/detail conflict and retained detail links still reach the original native retirement guard',async()=>{
 for(const listed of [false,true]) {
  const f=fixture();f.state.listed=listed;
  if(!listed)f.state.retired.categoryItemLinkList=[{categoryCode:'draft'}];
  let fullReads=0,guardCalls=0;
  f.driver.snapshot=async()=>{fullReads++;return [{kind:'item',id:'99',parentIds:listed?['other']:[],native:f.state.retired}];};
  f.driver.client.retireItem=async id=>{guardCalls++;assert.equal(id,'99');throw Error('original native retirement guard');};
  await assert.rejects(()=>f.driver.retire(f.target),/original native retirement guard/);
  assert.equal(fullReads,1);assert.equal(guardCalls,1);assert.deepEqual(f.saves,[]);
 }
});

test('Demae read-only item retirement keeps full final native verification and rejects later relinking',async()=>{
 for(const relinkAtEnd of [false,true]) {
  const f=fixture(),snapshot=f.driver.snapshot.bind(f.driver);let fullReads=0;
  f.driver.snapshot=async options=>{fullReads++;return snapshot(options);};
  const run=()=>runUberAuthorityPublication(f.payload,f.driver,async progress=>{
   if(progress.phase==='verifying'&&relinkAtEnd) {
    f.state.listed=true;f.state.retired.categoryItemLinkList=[{categoryCode:'other'}];
   }
  });
  if(relinkAtEnd)await assert.rejects(run,/retirement_unverified/);
  else {
   const result=await run();
   assert.equal(result.observations.length,1);assert.equal(result.observations[0].hidden,true);
  }
  assert.equal(fullReads,3);assert.deepEqual(f.saves,[]);
 }
});
