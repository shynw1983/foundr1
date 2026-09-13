import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeMenuClient} from '../src/demae-menu-client.mjs';

function fixture(mode='enriched') {
  let saved=false;
  const before={chainId:410649,itemCode:'00000018',itemName:'酸梅湯',itemDescription:'',
    categoryItemLinkList:[{categoryCode:'draft'}],
    sizeInfoList:[{sizeCode:'001',applyStartDate:'2026/09/10',applyEndDate:'9999/12/31',price:399,sizeOptionGroupLinkList:[]}]};
  let actual=structuredClone(before);
  const client=new DemaeMenuClient({request:async(path,method,body)=>{
    assert.equal(method,'PUT');assert.match(path,/item\/00000018$/);
    saved=true;actual=structuredClone(body);
    actual.sizeInfoList=actual.sizeInfoList.map(s=>({...s,originalApplyStartDate:null,originalApplyEndDate:null}));
    actual.categoryItemLinkList=body.categoryItemLinkList.map(link=>({chainId:410649,categoryName:'ペアリングドリンク',applyStartDate:'2026/08/11',applyEndDate:'9999/12/31',isRecommended:false,...link}));
    if(mode==='wrong-category')actual.categoryItemLinkList[0].categoryCode='0006';
    if(mode==='wrong-chain')actual.categoryItemLinkList[0].chainId=999;
    if(mode==='extra-category')actual.categoryItemLinkList.push({...actual.categoryItemLinkList[0]});
    if(mode==='missing-category')actual.categoryItemLinkList=[];
    if(mode==='price')actual.sizeInfoList[0].price=999;
    if(mode==='identity')actual.itemCode='other';
    if(mode==='requested-field')actual.categoryItemLinkList[0].isRecommended=true;
    return {};
  }},'410649','live',{today:'2026-09-13'});
  client.assertScope=async()=>{};
  client.item=async()=>structuredClone(actual);
  client.catalog=async()=>({items:{categoryList:[{categoryCode:'0005'}]}});
  client.itemOccurrences=async()=>saved?(mode==='not-live'?[]:[{categoryCode:'0005'}]):[];
  client.stockState=async()=>({listed:saved,records:[]});
  return client;
}
const release={categoryLinks:[{categoryCode:'0005'}],groupLinks:[],allowCategoryMove:true,releaseAvailable:true};
test('release accepts native category enrichment while preserving identity and exact price',async()=>{
  const actual=await fixture().updateItem('00000018',release);
  assert.equal(actual.categoryItemLinkList[0].categoryCode,'0005');
  assert.equal(actual.sizeInfoList[0].price,399);
});
for(const mode of ['wrong-category','wrong-chain','extra-category','missing-category','price','identity']) {
  test(`release still rejects ${mode}`,async()=>{
    await assert.rejects(fixture(mode).updateItem('00000018',release),/demae_menu_item_verification_failed/);
  });
}
test('explicit category fields are verified, not ignored',async()=>{
  await assert.rejects(fixture('requested-field').updateItem('00000018',{...release,categoryLinks:[{categoryCode:'0005',isRecommended:false}]}),/verification_failed/);
});
test('a matching detail cannot bypass independent live category verification',async()=>{
  await assert.rejects(fixture('not-live').updateItem('00000018',release),/category_move_unverified/);
});
test('ordinary content edits keep full category comparison',async()=>{
  await assert.rejects(fixture().updateItem('00000018',{price:399}),/verification_failed/);
});
