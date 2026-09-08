import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateRocketOption} from '../src/rocket-option-migration.mjs';

function fixture(status='NOT_EXPOSE') {
  const target={sourceKey:'option:g:o',targetId:'os-option',name:'topping',price:227,mappings:[{externalId:'sub_checkbox_1_10'}]};
  const groups=[{optionId:1,optionItems:[{optionItemId:10,optionItemName:target.name,salePrice:227,displayStatus:status}]},{optionId:2,optionItems:[]}];
  let saved,receipt,creates=0,deletes=0;
  const client={storeId:'1',transport:{creationReceipt:async()=>receipt},catalog:async()=>structuredClone({groups}),
    createHiddenOption:async({marker,price,groupId})=>{creates++;assert.equal(groupId,'2');groups[1].optionItems.push({optionItemId:20,optionItemName:marker,salePrice:price,displayStatus:'NOT_EXPOSE'});receipt={status:'received',data:{optionItemId:20}};return receipt.data;},
    updateOption:async(id,patch)=>{assert.equal(groups[1].optionItems[0].displayStatus,'NOT_EXPOSE');Object.assign(groups[1].optionItems[0],{optionItemName:patch.name,salePrice:patch.price});},
    setMigratedOptionStatus:async(id,patch)=>{assert.equal(saved.phase,'prepared');groups[1].optionItems[0].displayStatus=patch.displayStatus;},
    retireOption:async()=>{assert.equal(saved.phase,'prepared');assert.equal(groups[1].optionItems[0].displayStatus,status);deletes++;groups[0].optionItems=[];}
  };
  const save=async state=>{saved=structuredClone(state);};
  const run=()=>migrateRocketOption({client,sourceId:'source',target,fromId:'10',toParentId:'2',state:saved,save});
  return {client,groups,target,run,save,state:()=>saved,counts:()=>({creates,deletes})};
}
for(const status of ['ON_SALE','NOT_EXPOSE'])test(`migration preserves ${status} and journals before cutover`,async()=>{
  const f=fixture(status);await f.run();await f.run();
  assert.deepEqual(f.counts(),{creates:1,deletes:1});assert.equal(f.state().phase,'complete');
  assert.equal(f.groups[1].optionItems[0].displayStatus,status);
});
test('lost creation acknowledgement recovers receipt without another create',async()=>{
  const f=fixture(),create=f.client.createHiddenOption;
  f.client.createHiddenOption=async input=>{await create(input);throw Error('lost acknowledgement');};
  await assert.rejects(f.run,/lost acknowledgement/);
  assert.equal(f.state().phase,'reserved');assert.equal(f.groups[0].optionItems.length,1);
  await f.run();assert.deepEqual(f.counts(),{creates:1,deletes:1});
});
test('missing receipt after uncertain create cannot cause a new write',async()=>{
  const f=fixture();f.client.createHiddenOption=async()=>{throw Error('network');};
  await assert.rejects(f.run,/network/);await assert.rejects(f.run,/creation_uncertain/);
  assert.equal(f.groups[0].optionItems.length,1);assert.equal(f.groups[1].optionItems.length,0);
});
test('lost retirement acknowledgement completes from native absence without deleting twice',async()=>{
  const f=fixture('ON_SALE'),remove=f.client.retireOption;
  f.client.retireOption=async()=>{await remove();throw Error('lost delete acknowledgement');};
  await assert.rejects(f.run,/lost delete acknowledgement/);await f.run();
  assert.deepEqual(f.counts(),{creates:1,deletes:1});assert.equal(f.state().phase,'complete');
});
test('wrong replacement price never retires the old item',async()=>{
  const f=fixture(),create=f.client.createHiddenOption;
  f.client.createHiddenOption=async input=>{const result=await create(input);f.groups[1].optionItems[0].salePrice=999;return result;};
  await assert.rejects(f.run,/new_identity_invalid/);assert.equal(f.counts().deletes,0);
});
test('concurrent stockout hides the replacement and retains the changed original',async()=>{
  const f=fixture('ON_SALE'),set=f.client.setMigratedOptionStatus;
  f.client.setMigratedOptionStatus=async(id,patch)=>{await set(id,patch);f.groups[0].optionItems[0].displayStatus='NOT_EXPOSE';};
  await assert.rejects(f.run,/old_changed/);assert.equal(f.counts().deletes,0);
  assert.equal(f.groups[1].optionItems[0].displayStatus,'NOT_EXPOSE');
});
test('failed reservation prevents native creation',async()=>{
  const f=fixture();
  await assert.rejects(()=>migrateRocketOption({client:f.client,sourceId:'source',target:f.target,fromId:'10',toParentId:'2',save:async()=>{throw Error('database unavailable');}}),/database unavailable/);
  assert.equal(f.counts().creates,0);
});
