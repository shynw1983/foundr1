import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeMenuClient} from '../src/demae-menu-client.mjs';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';

const period={applyStartDate:'2026/08/11',applyEndDate:'9999/12/31'};
const area='FS0123456789abcd';
function fixture() {
 const category={chainId:1,categoryCode:'hidden',categoryName:`未公開 ${area}`,...period};
 const item={chainId:1,itemCode:'99',itemName:'historical soup',itemDescription:'unchanged',
  categoryItemLinkList:[{...category}],sizeInfoList:[{chainId:1,itemCode:'99',sizeCode:'001',...period,
   price:330,sizeName:'1人前',sizeOptionGroupLinkList:[{chainId:1,optionGroupCode:'group'}]}]};
 const state={item,linked:[{...category}],category,categoryLinks:[{chainId:1,menuPatternCode:'draft'}],
  live:{categoryList:[{categoryCode:'business',...period,itemList:[{itemCode:'88',itemName:'other'}]}]},
  draft:{categoryList:[{...category,itemList:[{itemCode:'99',itemName:'historical soup'}]}]},
  patterns:{menuPatternList:[{chainId:1,menuPatternCode:'live',menuPatternName:'Live',shopCountPerMenuPattern:1,displayShopCount:1,linkedShopList:[{shopId:7}]},
   {chainId:1,menuPatternCode:'draft',menuPatternName:`Foundr1 下書き ${area}`,shopCountPerMenuPattern:0,displayShopCount:0,linkedShopList:[]}],
   totalCount:2,isContinueNextPage:false},
  stock:{itemList:[{chainId:1,itemCode:'88',linkedShopList:[{shopId:7,orderType:'DELIVERY'}],stockoutItemList:[{shopId:7,orderType:'DELIVERY',isEndSale:true,isCurrentApplying:true}]}],optionList:[]},
  afterItem:null,afterLinks:null,patternReads:0,itemReads:0,linkReads:0};
 const calls=[],writes=[];
 const transport={request:async(path,method='GET',body)=>{
  calls.push({path,method});
  if(state.fail&&path.endsWith(state.fail))throw Error('native read failed');
  if(method!=='GET'&&!path.endsWith('/search/menu-pattern')&&!path.endsWith('/stock/stockout/target-list')) {
   writes.push({path,method,body});throw Error('no-op must not mutate native menu or stock');
  }
  if(path.endsWith('/search/chain-menu-pattern'))return [{chain:{chainId:1},menuPatternList:[{menuPatternCode:'live'},{menuPatternCode:'draft'}]}];
  if(path.endsWith('/search/menu-pattern')) {
   state.patternReads++;
   if(state.driftPattern&&state.patternReads>1)return {...structuredClone(state.patterns),menuPatternList:state.patterns.menuPatternList.map(row=>
    row.menuPatternCode==='draft'?{...row,shopCountPerMenuPattern:1}:row)};
   return structuredClone(state.patterns);
  }
  if(path.endsWith('/menu-pattern/live/item-list'))return structuredClone(state.live);
  if(path.endsWith('/linked-option-group-list'))return [];
  if(path.endsWith('/menu-pattern/draft/item-list'))return structuredClone(state.draft);
  if(path.endsWith('/item/99/linked-category-list'))return structuredClone(++state.linkReads>1&&state.afterLinks?state.afterLinks:state.linked);
  if(path.endsWith('/item/99'))return structuredClone(++state.itemReads>1&&state.afterItem?state.afterItem:state.item);
  if(path.endsWith('/item/88'))return {chainId:1,itemCode:'88',itemName:'other',categoryItemLinkList:[{chainId:1,categoryCode:'business',...period}],
   sizeInfoList:[{chainId:1,itemCode:'88',sizeCode:'001',...period,price:100,sizeOptionGroupLinkList:[]}]};
  if(path.endsWith('/stock/stockout/shop-list'))return {shopList:[{chainId:1,shopId:7,orderType:'DELIVERY'}]};
  if(path.endsWith('/stock/stockout/target-list'))return {hasOverOptionLimitChain:false,...structuredClone(state.stock)};
  if(path.endsWith('/category/hidden/menu-pattern-list'))return structuredClone(state.categoryLinks);
  if(path.endsWith('/category/hidden/2026-08-11/9999-12-31'))return structuredClone(state.category);
  throw Error(`unexpected native read:${path}`);
 }};
 const client=new DemaeMenuClient(transport,'1','live',{today:'2026-10-20',draftPatternCode:'draft'});
 return {state,calls,writes,client};
}

test('already retired native item in the exact unassigned private category proves no-op in 12 reads and zero saves',async()=>{
 const f=fixture(),beforeStock=structuredClone(f.state.stock),beforeItem=structuredClone(f.state.item);
 assert.equal(await f.client.retirementNoop('item','99'),true);
 assert.equal(f.calls.length,12);
 assert.equal(f.calls.filter(row=>row.path.endsWith('/item/99')).length,2);
 assert.equal(f.calls.filter(row=>row.path.endsWith('/search/menu-pattern')).length,2);
 assert.equal(f.calls.filter(row=>row.path.endsWith('/item/99/linked-category-list')).length,2);
 assert.ok(!f.calls.some(row=>/stockout|option-group\/group\//.test(row.path)));
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.state.stock,beforeStock);assert.deepEqual(f.state.item,beforeItem);
});

test('same-attempt fresh catalog and item are reused without another base catalog/detail read',async()=>{
 const f=fixture();const [catalog,item]=await Promise.all([f.client.catalog(),f.client.item('99')]);
 const existingReads=f.calls.length;
 assert.equal(await f.client.retirementNoop('item','99',{catalog,item}),true);
 assert.equal(existingReads,5);assert.equal(f.calls.length-existingReads,7);assert.deepEqual(f.writes,[]);
});

test('multiple known item periods remain hidden together without changing future stock or group links',async()=>{
 const f=fixture();f.state.item.sizeInfoList.push({...f.state.item.sizeInfoList[0],applyStartDate:'2030/01/01',applyEndDate:'2030/12/31'});
 assert.equal(await f.client.retirementNoop('item','99'),true);assert.deepEqual(f.writes,[]);
});

for(const [label,mutate] of Object.entries({
 'live occurrence':f=>{f.state.live.categoryList[0].itemList.push({itemCode:'99'});},
 'future live occurrence':f=>{f.state.live.categoryList.push({categoryCode:'future',applyStartDate:'2030/01/01',applyEndDate:'9999/12/31',itemList:[{itemCode:'99'}]});},
 'truncated live catalog':f=>{f.state.live.hasMore=true;},
 'unknown live pagination':f=>{f.state.live.isContinueNextPage='false';},
 'wrong live summary chain':f=>{f.state.live.categoryList[0].chainId=2;},
 'incomplete live summary':f=>{delete f.state.live.categoryList[0].itemList;},
 'wrong item identity':f=>{f.state.item.itemCode='wrong';},
 'wrong item chain':f=>{f.state.item.chainId=2;},
 'coercible item chain':f=>{f.state.item.chainId=[1];},
 'truncated item':f=>{f.state.item.isTruncated=true;},
 'missing item links':f=>{delete f.state.item.categoryItemLinkList;},
 'wrong item link identity':f=>{f.state.item.categoryItemLinkList[0].categoryCode='business';},
 'partial item link period':f=>{delete f.state.item.categoryItemLinkList[0].applyEndDate;},
 'extra future detail link':f=>{f.state.item.categoryItemLinkList.push({chainId:1,categoryCode:'future',applyStartDate:'2030/01/01',applyEndDate:'9999/12/31'});},
 'unknown item size period':f=>{delete f.state.item.sizeInfoList[0].applyEndDate;},
 'invalid item size date':f=>{f.state.item.sizeInfoList[0].applyStartDate='2026/02/30';},
 'wrong item size identity':f=>{f.state.item.sizeInfoList[0].itemCode='other';},
 'incomplete item group links':f=>{delete f.state.item.sizeInfoList[0].sizeOptionGroupLinkList;},
 'truncated draft catalog':f=>{f.state.draft.truncated=true;},
 'missing draft item':f=>{f.state.draft.categoryList[0].itemList=[];},
 'ambiguous private category':f=>{f.state.draft.categoryList.push({...f.state.draft.categoryList[0],categoryCode:'another'});},
 'unknown private category period':f=>{delete f.state.draft.categoryList[0].applyStartDate;},
 'missing linked category list':f=>{f.state.linked=[];},
 'truncated linked category list':f=>{f.state.linked.hasMore=true;},
 'foreign linked category':f=>{f.state.linked[0].chainId=2;},
 'unknown linked category period':f=>{delete f.state.linked[0].applyEndDate;},
 'future live linked category':f=>{f.state.linked.push({chainId:1,categoryCode:'business',applyStartDate:'2030/01/01',applyEndDate:'9999/12/31'});},
 'conflicting category period':f=>{f.state.linked[0].applyStartDate='2030/01/01';},
 'wrong exact category':f=>{f.state.category.categoryCode='wrong';},
 'wrong exact category chain':f=>{f.state.category.chainId=2;},
 'wrong exact category name':f=>{f.state.category.categoryName='Other';},
 'missing exact category date':f=>{delete f.state.category.applyEndDate;},
 'shared category':f=>{f.state.categoryLinks.push({chainId:1,menuPatternCode:'live'});},
 'live category assignment':f=>{f.state.categoryLinks[0].menuPatternCode='live';},
 'wrong category assignment chain':f=>{f.state.categoryLinks[0].chainId=2;},
 'truncated category assignments':f=>{f.state.categoryLinks.hasMore=true;},
 'assigned draft pattern':f=>{f.state.patterns.menuPatternList[1].shopCountPerMenuPattern=1;},
 'visible draft pattern':f=>{f.state.patterns.menuPatternList[1].displayShopCount=1;},
 'draft shop linked':f=>{f.state.patterns.menuPatternList[1].linkedShopList=[{shopId:7}];},
 'truncated pattern search':f=>{f.state.patterns.hasMore=true;},
 'duplicate pattern':f=>{f.state.patterns.menuPatternList.push({...f.state.patterns.menuPatternList[1]});f.state.patterns.totalCount++;},
 'missing live pattern':f=>{f.state.patterns.menuPatternList.shift();f.state.patterns.totalCount--;},
 'wrong private pattern marker':f=>{f.state.patterns.menuPatternList[1].menuPatternName='Foundr1 下書き FSffffffffffffff';},
 'item placement drift during graph read':f=>{f.state.afterItem={...f.state.item,categoryItemLinkList:[{categoryCode:'business'}]};},
 'item size link drift during graph read':f=>{f.state.afterItem=structuredClone(f.state.item);f.state.afterItem.sizeInfoList[0].sizeOptionGroupLinkList=[];},
 'future category link added during graph read':f=>{f.state.afterLinks=[...f.state.linked,{chainId:1,categoryCode:'future',applyStartDate:'2030/01/01',applyEndDate:'9999/12/31'}];},
 'draft assigned during graph read':f=>{f.state.driftPattern=true;},
 'native detail read failure':f=>{f.state.fail='/item/99';},
 'native link read failure':f=>{f.state.fail='/item/99/linked-category-list';},
 'native category read failure':f=>{f.state.fail='/category/hidden/2026-08-11/9999-12-31';}
}))test(`uncertain private retirement returns false, leaving the full native guard mandatory: ${label}`,async()=>{
 const f=fixture();mutate(f);const beforeStock=structuredClone(f.state.stock);
 assert.equal(await f.client.retirementNoop('item','99'),false);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.state.stock,beforeStock);
});

function publication(f) {
 const target={kind:'item',targetId:'historical',sourceKey:'item:historical',archived:true,name:'historical soup',price:330,description:'unchanged',
  marker:area,mappings:[{externalId:'99'}],source:{groupIds:[]}};
 const payload={authoritativePublication:true,sourceId:'source',storeId:'os',platformKey:'demae_can',merchantId:'1',menuPatternCode:'live',
  draftPatternCode:'draft',revision:52,newItemsHidden:true,imagePolicy:'read_only',targets:[target]};
 return {target,payload,driver:new AuthorityNativeDriver(f.client.transport,payload)};
}

test('driver uses the real private retirement proof before any complete snapshot or writer',async()=>{
 const f=fixture(),{driver,target}=publication(f);
 driver.snapshot=async()=>{throw Error('already retired item must not scan the complete native graph');};
 await driver.retire(target);
 assert.equal(f.calls.length,12);assert.deepEqual(f.writes,[]);
});

test('uncertain private proof retains the complete global barrier and exact native retirement guard',async()=>{
 const f=fixture(),{driver,target}=publication(f);f.state.categoryLinks.push({chainId:1,menuPatternCode:'live'});
 let fullSnapshots=0,nativeGuards=0;
 driver.snapshot=async()=>{fullSnapshots++;return [{kind:'item',id:'99',parentIds:[],native:f.state.item}];};
 driver.client.retireItem=async id=>{nativeGuards++;assert.equal(id,'99');throw Error('original native retirement guard');};
 await assert.rejects(()=>driver.retire(target),/original native retirement guard/);
 assert.equal(fullSnapshots,1);assert.equal(nativeGuards,1);assert.deepEqual(f.writes,[]);
});

for(const mode of ['unchanged','later-live-relink','later-draft-assignment'])test(`full publication keeps independent final native verification: ${mode}`,async()=>{
 const f=fixture(),{driver,payload}=publication(f),beforeStock=structuredClone(f.state.stock);
 let finalPhase=false,finalSnapshots=0,noopRetirements=0;
 const snapshot=driver.snapshot.bind(driver),retirementNoop=driver.client.retirementNoop.bind(driver.client);
 driver.snapshot=async options=>{if(finalPhase)finalSnapshots++;return snapshot(options);};
 driver.client.retirementNoop=async(...args)=>{const result=await retirementNoop(...args);if(result)noopRetirements++;return result;};
 const run=()=>runUberAuthorityPublication(payload,driver,async progress=>{
  if(progress.phase!=='verifying'||finalPhase)return;
  finalPhase=true;
  if(mode==='later-live-relink') {
   f.state.live.categoryList[0].itemList.push({itemCode:'99',itemName:'historical soup'});
   f.state.item.categoryItemLinkList=[{chainId:1,categoryCode:'business',...period}];
   f.state.stock.itemList.push({chainId:1,itemCode:'99',linkedShopList:[{shopId:7,orderType:'DELIVERY'}],
    stockoutItemList:[{shopId:7,orderType:'DELIVERY',isEndSale:false,isCurrentApplying:true}]});
  }
  if(mode==='later-draft-assignment')f.state.patterns.menuPatternList[1].shopCountPerMenuPattern=1;
 });
 if(mode==='unchanged') {
  const result=await run();assert.equal(result.outcome,'applied');assert.equal(result.observations.length,1);
  assert.equal(result.observations[0].hidden,true);assert.equal(result.observations[0].placement,'staged');
  assert.deepEqual(f.state.stock,beforeStock);
 } else await assert.rejects(run,/retirement_unverified|draft_pattern_is_assigned/);
 assert.equal(noopRetirements,1);assert.equal(finalSnapshots,1);assert.deepEqual(f.writes,[]);
});
