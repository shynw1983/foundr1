import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeMenuClient} from '../src/demae-menu-client.mjs';
import {DemaeStagedOption} from '../src/demae-staged-option.mjs';
import {planDemaeRelease,releaseDemaeInventory} from '../src/demae-inventory-release.mjs';
const scope={storeId:'s',merchantId:'1',menuPatternCode:'live',graph:[{kind:'option',targetId:'o',parentId:'g',mappings:[{externalId:'itemList_100001true'}]},{kind:'option_group',targetId:'g',mappings:[{externalId:'g'}]}],targets:[{kind:'option',targetId:'o'}]};
function setup(t) {
 t.mock.method(DemaeMenuClient.prototype,'assertScope',async()=>{});
 t.mock.method(DemaeMenuClient.prototype,'catalog',async()=>({groups:[{optionGroupCode:'g'}],items:{categoryList:[{itemList:[{itemCode:'i'}]}]}}));
 t.mock.method(DemaeMenuClient.prototype,'group',async()=>({items:[{itemCode:'i',sizeList:[{sizeCode:'s'}]}],options:[{optionCode:'00001'}]}));
 t.mock.method(DemaeMenuClient.prototype,'stockCatalog',async()=>({itemList:[],optionList:[]}));
 t.mock.method(DemaeMenuClient.prototype,'stockState',async()=>({listed:true}));
}
test('release rejects nonmanual and unavailable payloads before native requests',async()=>{
 for(const p of [{},{isAvailable:false,availabilityAuthority:'uber_eats',fullSyncRunId:'r',syncSource:'store'}])await assert.rejects(()=>releaseDemaeInventory({},p,'s'),/manual_confirmation/);
});
test('mapped live option parent yields an explicit plan; retry of completed link is no-op',async t=>{
 setup(t);const target={kind:'option',targetId:'o'};
 const plan=await planDemaeRelease({},scope,target);assert.deepEqual(plan.groups,['g']);
 const writes=t.mock.method(DemaeMenuClient.prototype,'updateGroup',async()=>{throw Error('should not write');});
 assert.equal(await releaseDemaeInventory({},{isAvailable:true,availabilityAuthority:'uber_eats',fullSyncRunId:'r',syncSource:'store',demaeStaging:[scope],targets:[{...target,releasePlan:plan}]},'s'),1);
 assert.equal(writes.mock.callCount(),0);
});
test('missing or hidden parent blocks planning',async t=>{
 setup(t);await assert.rejects(()=>planDemaeRelease({}, {...scope,graph:[scope.graph[0]]},{kind:'option',targetId:'o'}),/ありません/);
});
test('plan drift blocks all writes',async t=>{
 setup(t);await assert.rejects(()=>releaseDemaeInventory({},{isAvailable:true,availabilityAuthority:'uber_eats',fullSyncRunId:'r',syncSource:'store',demaeStaging:[scope],targets:[{kind:'option',targetId:'o',releasePlan:{id:'other'}}]},'s'),/プレビュー後/);
});
test('verified draft option is attached using only explicit available IDs',async t=>{
 setup(t);let listed=false,attached=false;
 t.mock.method(DemaeMenuClient.prototype,'stockState',async()=>({listed}));
 t.mock.method(DemaeMenuClient.prototype,'stockCatalog',async()=>({itemList:[],optionList:[]}));
 t.mock.method(DemaeStagedOption.prototype,'readAll',async()=>[{hidden:true}]);
 t.mock.method(DemaeMenuClient.prototype,'group',async()=>({items:[{itemCode:'i',sizeList:[{sizeCode:'s'}]}],options:attached?[{optionCode:'00001'}]:[]}));
 const write=t.mock.method(DemaeMenuClient.prototype,'updateGroup',async(id,patch)=>{assert.equal(id,'g');assert.deepEqual(patch,{optionCodes:['00001'],releaseAvailableOptionIds:['00001']});listed=true;attached=true;});
 const target={kind:'option',targetId:'o',knownExternalIds:['itemList_100001true']};
 const s={...scope,targets:[{...target,marker:'FS0123456789abcd',mappings:[{externalId:target.knownExternalIds[0],externalParentId:'stage:carrier'}]}]};
 const plan=await planDemaeRelease({},s,target);
 await releaseDemaeInventory({},{isAvailable:true,availabilityAuthority:'uber_eats',fullSyncRunId:'r',syncSource:'store',demaeStaging:[s],targets:[{...target,releasePlan:plan}]},'s');
 assert.equal(write.mock.callCount(),1);
});
test('an unpublished group can be linked only to mapped live Uber consumers',async t=>{
 setup(t);
 t.mock.method(DemaeMenuClient.prototype,'catalog',async()=>({groups:[],items:{categoryList:[{itemList:[{itemCode:'00002'}]}]}}));
 t.mock.method(DemaeMenuClient.prototype,'group',async()=>({items:[],options:[]}));
 t.mock.method(DemaeMenuClient.prototype,'item',async()=>({sizeInfoList:[{sizeCode:'s',applyStartDate:'2020/01/01',applyEndDate:'9999/12/31'}]}));
 const s={...scope,graph:[scope.graph[0],{...scope.graph[1],sourceKey:'option_group:uber-group'},{kind:'item',targetId:'i',source:{groupIds:['uber-group']},mappings:[{externalId:'itemList_100002false'}]}]};
 const plan=await planDemaeRelease({},s,{kind:'option',targetId:'o'});
 assert.deepEqual(plan.links,[{itemCode:'00002',sizeCode:'s'}]);
 await assert.rejects(()=>planDemaeRelease({},scope,{kind:'option',targetId:'o'}),/関連付け/);
});
test('draft item release uses the mapped category, never the whole draft menu',async t=>{
 setup(t);let listed=false;
 const target={kind:'item',targetId:'i',knownExternalIds:['itemList_100002false']};
 const s={...scope,graph:[{...target,parentId:'c',source:{groupIds:[]},mappings:[{externalId:target.knownExternalIds[0]}]},{kind:'category',targetId:'c',mappings:[{externalId:'cat'}]}],targets:[{...target,mappings:[{externalId:target.knownExternalIds[0]}]}]};
 t.mock.method(DemaeMenuClient.prototype,'catalog',async()=>({groups:[],items:{categoryList:[{categoryCode:'cat',itemList:[]}]}}));
 t.mock.method(DemaeMenuClient.prototype,'item',async()=>({chainId:1,itemCode:'00002',categoryItemLinkList:[]}));
 t.mock.method(DemaeMenuClient.prototype,'stockState',async()=>({listed}));
 const write=t.mock.method(DemaeMenuClient.prototype,'updateItem',async(id,patch)=>{assert.equal(id,'00002');assert.deepEqual(patch.categoryLinks,[{categoryCode:'cat'}]);assert.equal(patch.releaseAvailable,true);listed=true;});
 const plan=await planDemaeRelease({},s,target);
 await releaseDemaeInventory({},{isAvailable:true,availabilityAuthority:'uber_eats',fullSyncRunId:'r',syncSource:'store',demaeStaging:[s],targets:[{...target,releasePlan:plan}]},'s');
 assert.equal(write.mock.callCount(),1);
 await assert.rejects(()=>planDemaeRelease({},{...s,draftCarrierItemCode:'00002'},target),/下書き保管用/);
});
