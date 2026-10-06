import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeMenuClient} from '../src/demae-menu-client.mjs';
import {DemaeStagedOption} from '../src/demae-staged-option.mjs';
import {verifyDemaeInventoryStaging} from '../src/demae-inventory-staging.mjs';
import {auditDestination} from '../src/inventory-destination-audit.mjs';
function fixture(t,{listed=false,invalid=false}={}) {
 t.mock.method(DemaeMenuClient.prototype,'assertScope',async()=>{});
 t.mock.method(DemaeMenuClient.prototype,'stockCatalog',async()=>({itemList:listed?[{itemCode:'00001'}]:[]}));
 t.mock.method(DemaeMenuClient.prototype,'item',async()=>({chainId:1,itemCode:'00001',categoryItemLinkList:[]}));
 t.mock.method(DemaeStagedOption.prototype,'readAll',async identities=>{if(invalid)throw Error('isolation failed');return identities;});
 const targets=['item','option'].map(kind=>({kind,targetId:kind,knownExternalIds:[`itemList_100001${kind==='option'?'true':'false'}`]}));
 const items=targets.map(t=>({...t,found:false,isAvailable:null,status:'unknown'}));
 const scope={storeId:'s',merchantId:'1',menuPatternCode:'live',targets:targets.map(t=>({...t,marker:'FS0123456789abcd',mappings:[{externalId:t.knownExternalIds[0],externalParentId:'stage:g'}]}))};
 return {items,payload:{targets,demaeStaging:[scope]},scope};
}
test('fresh verified unpublished objects become staged without availability or writes',async t=>{
 const f=fixture(t);await verifyDemaeInventoryStaging({},f.payload,f.items,'s');
 assert.ok(f.items.every(r=>r.status==='staged'&&r.stagingVerified&&r.isAvailable===null));
 assert.ok(f.items.every(r=>r.nativeObservations.length===0&&r.externalIds.length===0&&r.nativeMatchBasis===null));
});
test('published item and failed option isolation remain unknown',async t=>{
 const f=fixture(t,{listed:true,invalid:true});await verifyDemaeInventoryStaging({},f.payload,f.items,'s');
 assert.ok(f.items.every(r=>!r.found&&r.status==='unknown'));
});
test('mapping drift and missing request never inherit old publication proof',async t=>{
 const f=fixture(t);f.payload.targets[0].knownExternalIds=['different'];f.payload.targets.pop();
 await verifyDemaeInventoryStaging({},f.payload,f.items,'s');assert.ok(f.items.every(r=>!r.found));
});
test('wrong store fails closed',async t=>{
 const f=fixture(t);await assert.rejects(()=>verifyDemaeInventoryStaging({},f.payload,f.items,'other'),/scope_mismatch/);
});
test('visible cached row must still exist in the native menu inventory',async t=>{
 const f=fixture(t);
 f.items=[{kind:'option',targetId:'option',found:true,status:'available',isAvailable:true}];
 f.scope.graph=[{kind:'option',targetId:'option'}];
 f.scope.targets=[];
 t.mock.method(DemaeMenuClient.prototype,'stockCatalog',async()=>({itemList:[],optionList:[]}));
 await verifyDemaeInventoryStaging({},f.payload,f.items,'s');
 assert.equal(f.items[0].found,false);
 assert.equal(f.items[0].reason,'native_menu_identity_missing');
});

const linkedShops=[{shopId:6002884,orderType:'DELIVERY'},{shopId:6002884,orderType:'TAKEOUT'}];
const stockRecord=(overrides={})=>({shopId:6002884,orderType:'DELIVERY',optionCode:'00000251',isEndSale:false,
 isCurrentApplying:true,applyStartTime:'2026/10/06 00:00',applyEndTime:'2026/10/06 23:59',...overrides});
const optionStock=(overrides={})=>({chainId:410649,optionCode:'00000251',linkedShopList:structuredClone(linkedShops),stockoutOptionList:[],...overrides});
const itemStock=(overrides={})=>({chainId:410649,itemCode:'00000013',linkedShopList:structuredClone(linkedShops),stockoutItemList:[],
 itemSizeList:[{sizeCode:'001',linkedShopList:structuredClone(linkedShops),stockoutItemSizeList:[]}],...overrides});

async function visible(t,{kind='option',ids,stock,available=true,mutate}={}) {
 const externalId=kind==='option'?'itemList_41064900000251true':'itemList_41064900000013false';
 const target={kind,targetId:'logical',label:'logical',knownExternalIds:ids??[externalId]};
 const adapter={async locateTargets(targets){return targets.map(row=>({...row,matchBasis:'external_id',matches:[{rowMatches:row.knownExternalIds.map(rowId=>({rowId,unavailable:!available}))}]}));}};
 const payload={targets:[target],demaeStaging:[{storeId:'s',merchantId:'410649',menuPatternCode:'live',targets:[],graph:[{kind,targetId:'logical'}]}]};
 const result=await auditDestination(adapter,payload,'demae_can');
 const snapshot=stock??{itemList:kind==='item'?[itemStock()]:[],optionList:kind==='option'?[optionStock()]:[]};
 const read=t.mock.method(DemaeMenuClient.prototype,'stockCatalog',async()=>structuredClone(snapshot));
 const write=t.mock.method(DemaeMenuClient.prototype,'updateGroup',async()=>{throw Error('audit must not write');});
 if(mutate)mutate(result.items[0]);
 await verifyDemaeInventoryStaging({},payload,result.items,'s');
 assert.equal(read.mock.callCount(),1);assert.equal(write.mock.callCount(),0);
 return {row:result.items[0],snapshot,payload};
}

test('visible native option proof uses independently fetched chain/code and all actual IDs',async t=>{
 const {row}=await visible(t);
 assert.equal(row.found,true);assert.equal(row.isAvailable,true);assert.equal(row.nativeMatchBasis,'native_stock');
 assert.deepEqual(row.externalIds,['itemList_41064900000251true']);
 assert.deepEqual(row.nativeObservations,[{externalId:'itemList_41064900000251true',physicalId:'00000251',found:true,isAvailable:true,matchBasis:'native_stock'}]);
});

test('both permanent and temporary currently applying stockouts are unavailable',async t=>{
 for(const isEndSale of [false,true]) {
  const records=linkedShops.map(shop=>stockRecord({...shop,isEndSale}));
  const {row}=await visible(t,{available:false,stock:{itemList:[],optionList:[optionStock({stockoutOptionList:records})]}});
  assert.equal(row.found,true);assert.equal(row.isAvailable,false);assert.equal(row.nativeObservations[0].isAvailable,false);
 }
});

test('future/noncurrent stockout records do not pretend the option is unavailable now',async t=>{
 const records=linkedShops.map(shop=>stockRecord({...shop,isEndSale:true,isCurrentApplying:false,applyStartTime:'2026/12/01 00:00',applyEndTime:'9999/12/31 23:59'}));
 const snapshot={itemList:[],optionList:[optionStock({stockoutOptionList:records})]},before=structuredClone(snapshot);
 const {row}=await visible(t,{stock:snapshot});
 assert.equal(row.found,true);assert.equal(row.isAvailable,true);assert.deepEqual(snapshot,before);
});

test('native stock and cached DOM disagreement never supplies release proof',async t=>{
 for(const [available,records] of [[true,linkedShops.map(shop=>stockRecord(shop))],[false,[]]]) {
  const {row}=await visible(t,{available,stock:{itemList:[],optionList:[optionStock({stockoutOptionList:records})]}});
  assert.equal(row.found,false);assert.equal(row.isAvailable,null);assert.equal(row.reason,'native_menu_availability_unproven');
  assert.deepEqual(row.nativeObservations,[]);assert.deepEqual(row.externalIds,[]);
 }
});

test('unknown current flags, incomplete scopes and mixed channel stock remain unknown',async t=>{
 const options=[
  optionStock({linkedShopList:[]}),optionStock({linkedShopList:undefined}),
  optionStock({linkedShopList:[linkedShops[0],linkedShops[0]]}),
  optionStock({stockoutOptionList:undefined}),
  optionStock({stockoutOptionList:[stockRecord({isCurrentApplying:undefined})]}),
  optionStock({stockoutOptionList:[stockRecord({isEndSale:undefined})]}),
  optionStock({stockoutOptionList:[stockRecord({optionCode:'other'})]}),
  optionStock({stockoutOptionList:[stockRecord({shopId:999})]}),
  optionStock({stockoutOptionList:[stockRecord({orderType:'OTHER'})]}),
  optionStock({stockoutOptionList:[stockRecord()]})
 ];
 for(const native of options) {
  const {row}=await visible(t,{stock:{itemList:[],optionList:[native]}});
  assert.equal(row.found,false);assert.equal(row.isAvailable,null);assert.deepEqual(row.nativeObservations,[]);
 }
});

test('wrong chain, missing or duplicate native identities and partial multi-ID coverage fail closed',async t=>{
 for(const options of [[],[optionStock({chainId:999})],[optionStock({optionCode:'00000252'})],[optionStock(),optionStock()]]) {
  const {row}=await visible(t,{stock:{itemList:[],optionList:options}});
  assert.equal(row.found,false);assert.equal(row.reason,'native_menu_identity_missing');assert.deepEqual(row.nativeObservations,[]);
 }
 const {row}=await visible(t,{ids:['itemList_41064900000251true','itemList_41064900000252true']});
 assert.equal(row.found,false);assert.deepEqual(row.nativeObservations,[]);
});

test('logical availability and supplied IDs cannot replace actual exact-ID DOM evidence',async t=>{
 for(const mutate of [
  row=>delete row.nativeObservations,
  row=>row.nativeMatchBasis='alias',
  row=>row.nativeObservations[0].externalId='itemList_9999900000251true',
  row=>row.nativeObservations[0].matchBasis='name',
  row=>row.nativeObservations[0].isAvailable=false,
  row=>row.nativeObservations.push({...row.nativeObservations[0]})
 ]) {
  const {row}=await visible(t,{mutate});
  assert.equal(row.found,false);assert.equal(row.reason,'native_menu_identity_unproven');assert.deepEqual(row.nativeObservations,[]);
 }
});

test('item proof covers every native size and shop without treating partial-size sales as all available',async t=>{
 const {row}=await visible(t,{kind:'item'});
 assert.equal(row.found,true);assert.equal(row.nativeObservations[0].physicalId,'00000013');
 const sizeSoldOut=linkedShops.map(shop=>({shopId:shop.shopId,orderType:shop.orderType,itemCode:'00000013',sizeCode:'002',isCurrentApplying:true,isEndSale:false}));
 for(const native of [
  itemStock({itemSizeList:[]}),itemStock({itemSizeList:undefined}),
  itemStock({itemSizeList:[{sizeCode:'001',linkedShopList:[linkedShops[0]],stockoutItemSizeList:[]}]}),
  itemStock({itemSizeList:[{sizeCode:'001',linkedShopList:linkedShops,stockoutItemSizeList:[]},{sizeCode:'002',linkedShopList:linkedShops,stockoutItemSizeList:sizeSoldOut}]}),
  itemStock({itemSizeList:[{sizeCode:'001',linkedShopList:linkedShops,stockoutItemSizeList:[{...sizeSoldOut[0],sizeCode:'002'}]}]})
 ]) {
  const {row}=await visible(t,{kind:'item',stock:{itemList:[native],optionList:[]}});
  assert.equal(row.found,false);assert.equal(row.isAvailable,null);assert.deepEqual(row.nativeObservations,[]);
 }
 const soldOut=linkedShops.map(shop=>({shopId:shop.shopId,orderType:shop.orderType,itemCode:'00000013',isCurrentApplying:true,isEndSale:true}));
 const unavailable=await visible(t,{kind:'item',available:false,stock:{itemList:[itemStock({stockoutItemList:soldOut})],optionList:[]}});
 assert.equal(unavailable.row.found,true);assert.equal(unavailable.row.nativeObservations[0].isAvailable,false);
});
