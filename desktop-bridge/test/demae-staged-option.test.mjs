import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeStagedOption} from '../src/demae-staged-option.mjs';
const marker='FS0123456789abcd';
function fixture() {
 const events=[],receipts=new Map();let option,group,listed=false;
 const client={chainId:'1',base:'/merchant-admin/api/v1/product/chain/1',assertScope:async()=>{},
  transport:{creationReceipt:async key=>receipts.get(key),request:async(path,method,body)=>{events.push('update');option={...option,...body};}},
  createUnlinkedOption:async input=>{events.push('create-option');option={chainId:1,optionCode:'00001',optionName:input.marker,price:input.price,applyStartDate:'2026/09/08',applyEndDate:'9999/12/31',itemType:input.itemType};receipts.set(`demae:1:option:${marker}`,{status:'received',data:structuredClone(option)});return structuredClone(option);},
  hiddenGroupItems:async items=>{if(items.some(row=>row.itemCode==='selling'))throw Error('not_isolated');},
  createStagedGroup:async(input,save)=>{events.push('create-group');assert.deepEqual(input.optionCodes,['00001']);group={detail:{optionGroupName:input.marker},items:[]};receipts.set(`demae:1:group:${marker}`,{status:'received',data:{chainId:1,optionGroupCode:'g'}});await save('g');return group;},
  group:async id=>{assert.equal(id,'g');return structuredClone({...group,options:[option]});},
  stockState:async()=>({listed}),stockCatalog:async()=>({optionList:listed?[option]:[]}),options:async()=>listed?[option]:[]};
 return {stage:new DemaeStagedOption(client),client,events,receipts,setListed:()=>{listed=true;},attach:()=>{group.items=[{itemCode:'selling'}];}};
}
const args={marker,price:170,itemType:'REDUCED_RATE_NORMAL_ITEM',allowCreate:true};
test('staged creation saves both identities and the group reservation before writes continue',async()=>{
 const f=fixture();let receipt;
 const actual=await f.stage.ensure(args,async row=>{receipt=row;f.events.push(`save:${row.groupCode}`);});
 assert.deepEqual(f.events,['create-option','save:','save:__creating__','create-group','save:g']);
 assert.equal(actual.hidden,true);
 await f.stage.ensure({...args,allowCreate:false,receipt},async()=>{throw Error('must not write');});
 assert.equal(f.events.filter(e=>e.startsWith('create')).length,2);
 await f.stage.update({optionCode:'00001',groupCode:'g',marker},{name:'チーズ（芝士）',price:180});
 assert.equal((await f.stage.read({optionCode:'00001',groupCode:'g',marker})).option.price,180);
});
test('lost option acknowledgement recovers the saved native receipt without another create',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.stage.ensure(args,async()=>{throw Error('offline');}),/offline/);
 await f.stage.ensure({...args,allowCreate:false},async()=>{});
 assert.equal(f.events.filter(e=>e==='create-option').length,1);
});
test('uncertain carrier creation with missing browser storage is never blindly retried',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.stage.ensure({...args,receipt:{optionCode:'00001',groupCode:'__creating__'}},async()=>{}),/group_creation_uncertain/);
 assert.deepEqual(f.events,[]);
});
test('failed carrier reservation prevents native creation',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.stage.ensure(args,async row=>{if(row.groupCode==='__creating__')throw Error('offline');}),/offline/);
 assert.equal(f.events.includes('create-group'),false);
});
test('linked or listed drafts fail independent verification and cannot be renamed',async()=>{
 for(const mutate of ['attach','setListed']) {
  const f=fixture();await f.stage.ensure(args,async()=>{});f[mutate]();
  await assert.rejects(()=>f.stage.update({optionCode:'00001',groupCode:'g',marker},{name:'new',price:170}),/not_isolated|is_published/);
  assert.equal(f.events.includes('update'),false);
 }
});
test('unknown option creations stay blocked when there is no durable receipt',async()=>{
 const f=fixture();await assert.rejects(()=>f.stage.ensure({...args,allowCreate:false},async()=>{}),/creation_uncertain/);
 assert.deepEqual(f.events,[]);
});
