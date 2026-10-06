import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeMenuClient} from '../src/demae-menu-client.mjs';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';

const period={applyStartDate:'2026/01/01',applyEndDate:'9999/12/31'};
function fixture() {
  const state={categories:[{chainId:1,categoryCode:'12',itemList:[{chainId:1,itemCode:'99'}]}],
    groups:[{chainId:1,optionGroupCode:'10',optionGroupName:'live group'}],
    members:[{chainId:1,optionCode:'other',optionName:'other',price:50,...period}],
    options:[{chainId:1,optionCode:'other',optionName:'other',price:50,...period}],
    detail:{chainId:1,optionGroupCode:'old-group',optionGroupName:'retired'},consumers:[],
    scope:[{chain:{chainId:1},menuPatternList:[{menuPatternCode:'live'}]}]};
  const requests=[],writes=[];
  const transport={request:async(path,method='GET',body)=>{
    requests.push({path,method});
    if(method!=='GET'){writes.push({path,method,body});throw Error('no-op attempted a write');}
    if(state.fail)throw Error('read failed');
    if(path.endsWith('/search/chain-menu-pattern'))return structuredClone(state.scope);
    if(path.endsWith('/menu-pattern/live/item-list'))return structuredClone({categoryList:state.categories,...state.catalogExtra});
    if(path.endsWith('/linked-option-group-list'))return structuredClone(state.groups);
    if(path.endsWith('/menu-pattern/live/option-item-list'))return structuredClone(state.options);
    if(path.endsWith('/option-item-list'))return structuredClone(state.members);
    if(path.endsWith('/linked-item-list'))return structuredClone(state.consumers);
    if(path.endsWith('/option-group/old-group'))return structuredClone(state.detail);
    throw Error(`unexpected read:${path}`);
  }};
  return {state,requests,writes,transport,client:new DemaeMenuClient(transport,'1','live',{today:'2026-10-07'})};
}

test('option absence uses fresh complete live-group and pattern lists, with no per-group detail reads or writes',async()=>{
  const f=fixture();
  assert.equal(await f.client.retirementNoop('option','retired'),true);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/option-group/10/option-item-list')).length,1);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/linked-item-list')||row.path.endsWith('/option-group/10')).length,0);
  assert.equal(f.requests.filter(row=>row.path.endsWith('/menu-pattern/live/option-item-list')).length,1);
  f.state.options.push({chainId:1,optionCode:'retired',...period});
  assert.equal(await f.client.retirementNoop('option','retired'),false);
  assert.deepEqual(f.writes,[]);
});

test('observed native summary shape omits chainId only on exact scoped category/item summaries',async()=>{
  const f=fixture();f.state.categories=[{categoryCode:'12',...period,categoryName:'category',itemList:[{
    itemCode:'99',itemName:'item',itemImageUri:null,stockoutType:'NONE',sizeInfoList:[]
  }]}];
  assert.equal(await f.client.retirementNoop('option','retired'),true);
  assert.equal(await f.client.retirementNoop('category','retired-category'),true);
  assert.ok(f.requests.some(row=>row.path.endsWith('/search/chain-menu-pattern')));
  assert.ok(f.requests.some(row=>row.path.endsWith('/chain/1/menu-pattern/live/item-list')));
  for(const row of [f.state.categories[0],f.state.categories[0].itemList[0]])for(const value of [2,null,undefined,{}]) {
    row.chainId=value;
    assert.equal(await f.client.retirementNoop('option','retired'),false);
    assert.equal(await f.client.retirementNoop('category','retired-category'),false);
    delete row.chainId;
  }
  delete f.state.groups[0].chainId;
  assert.equal(await f.client.retirementNoop('option','retired'),false);
  assert.deepEqual(f.writes,[]);
});

for(const [label,dates] of Object.entries({past:{applyStartDate:'2020/01/01',applyEndDate:'2020/12/31'},current:period,
  future:{applyStartDate:'2030/01/01',applyEndDate:'9999/12/31'}}))test(`${label} option member associations are never no-op`,async()=>{
  const f=fixture();f.state.members.push({chainId:1,optionCode:'retired',...dates});
  assert.equal(await f.client.retirementNoop('option','retired'),false);assert.deepEqual(f.writes,[]);
});

for(const [label,mutate] of Object.entries({
  'wrong-chain-member':f=>{f.state.members[0].chainId=2;},
  'array-chain-member':f=>{f.state.members[0].chainId=[1];},
  'invalid-member-id':f=>{f.state.members[0].optionCode='../wrong';},
  'missing-member-period':f=>{delete f.state.members[0].applyEndDate;},
  'impossible-calendar-date':f=>{f.state.members[0].applyStartDate='2026/02/30';},
  'mixed-period-separators':f=>{f.state.members[0].applyStartDate='2026/01-01';},
  'reversed-period':f=>{f.state.members[0].applyStartDate='9999/12/31';f.state.members[0].applyEndDate='2026/01/01';},
  'conflicting-duplicate-period':f=>{f.state.members.push({...f.state.members[0],price:70});},
  'wrong-chain-group':f=>{f.state.groups[0].chainId=2;},
  'duplicate-group':f=>{f.state.groups.push({...f.state.groups[0]});},
  'malformed-options':f=>{f.state.options=null;},
  'wrong-chain-pattern-option':f=>{f.state.options[0].chainId=2;},
  'incomplete-category-items':f=>{f.state.categories[0].itemList=null;},
  'wrong-chain-category':f=>{f.state.categories[0].chainId=2;},
  'array-chain-category':f=>{f.state.categories[0].chainId=[1];},
  'truncated-catalog':f=>{f.state.catalogExtra={isContinueNextPage:true};},
  'uncertain-catalog-pagination':f=>{f.state.catalogExtra={hasMore:'true'};},
  'truncated-member-array':f=>{f.state.members.hasMore=true;},
  'wrong-scope':f=>{f.state.scope[0].menuPatternList=[];},
  'failed-read':f=>{f.state.fail=true;}
}))test(`incomplete ${label} option proof falls back without authorizing any write`,async()=>{
  const f=fixture();mutate(f);
  assert.equal(await f.client.retirementNoop('option','retired'),false);assert.deepEqual(f.writes,[]);
});

test('valid repeated native option periods and calendar leap dates do not look like duplicate identities',async()=>{
  const f=fixture();f.state.members=[{chainId:1,optionCode:'other',applyStartDate:'2024/02/29',applyEndDate:'2024/12/31'},
    {chainId:1,optionCode:'other',...period}];
  assert.equal(await f.client.retirementNoop('option','retired'),true);assert.deepEqual(f.writes,[]);
});

test('empty group requires fresh exact detail, all-size consumers and complete dated members',async()=>{
  const f=fixture();assert.equal(await f.client.retirementNoop('option_group','old-group'),true);
  assert.ok(f.requests.some(row=>row.path.endsWith('/old-group/linked-item-list')));
  assert.ok(f.requests.some(row=>row.path.endsWith('/old-group/option-item-list')));
  f.state.consumers=[{chainId:1,itemCode:'99',sizeList:[{sizeCode:'future',applyStartDate:'2030/01/01',applyEndDate:'9999/12/31'}]}];
  assert.equal(await f.client.retirementNoop('option_group','old-group'),false);
  assert.deepEqual(f.writes,[]);
});

for(const [label,mutate] of Object.entries({
  'wrong-native-id':f=>{f.state.detail.optionGroupCode='other';},
  'wrong-chain':f=>{f.state.detail.chainId=2;},
  'array-chain-detail':f=>{f.state.detail.chainId=[1];},
  'truncated-detail':f=>{f.state.detail.hasMore=true;},
  'uncertain-detail-pagination':f=>{f.state.detail.hasMore='false';},
  'truncated-consumer-array':f=>{f.state.consumers.hasMore=true;},
  'truncated-member-array':f=>{f.state.members.isContinueNextPage=true;},
  'missing-consumer-size':f=>{f.state.consumers=[{chainId:1,itemCode:'99',sizeList:[]}];},
  'malformed-consumer-list':f=>{f.state.consumers=null;},
  'malformed-member-period':f=>{f.state.members[0].applyEndDate='bad';}
}))test(`group ${label} cannot prove no-op`,async()=>{
  const f=fixture();mutate(f);assert.equal(await f.client.retirementNoop('option_group','old-group'),false);assert.deepEqual(f.writes,[]);
});

test('absent category is no-op, but empty/current/future live categories still require the native retirement path',async()=>{
  const f=fixture();assert.equal(await f.client.retirementNoop('category','retired-category'),true);
  for(const dates of [period,{applyStartDate:'2030/01/01',applyEndDate:'9999/12/31'}]){
    f.state.categories.push({chainId:1,categoryCode:'retired-category',itemList:[],...dates});
    assert.equal(await f.client.retirementNoop('category','retired-category'),false);f.state.categories.pop();
  }
  f.state.categories[0].categoryCode='invalid/id';
  assert.equal(await f.client.retirementNoop('category','retired-category'),false);assert.deepEqual(f.writes,[]);
});

function driverFixture(platform='demae_can') {
  const f=fixture(),targets=['option','option_group','category','item'].map((kind,index)=>({kind,sourceKey:`${kind}:old`,targetId:`old-${kind}`,
    archived:true,mappings:[{externalId:['retired','old-group','retired-category','99'][index]}]}));
  const driver=new AuthorityNativeDriver(f.transport,{platformKey:platform,merchantId:'1',menuPatternCode:'live',targets});
  if(platform==='demae_can')driver.client=f.client;
  const calls=[];
  driver.snapshot=async()=>{calls.push('snapshot');return [{kind:'item',id:'99',native:{categoryItemLinkList:[{categoryCode:'12'}]},hidden:false}];};
  for(const method of ['retireOption','retireGroup','retireCategory','retireItem','updateDish'])driver.client[method]=async()=>{calls.push(method);};
  return {...f,driver,targets,calls};
}

test('Demae proven no-op skips full snapshots and writer calls only for the three supported retirement kinds',async()=>{
  const f=driverFixture();for(const target of f.targets.slice(0,3))await f.driver.retire(target);
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.writes,[]);
  await f.driver.retire(f.targets[3]);assert.deepEqual(f.calls,['snapshot','retireItem']);
});

test('uncertain proof preserves full snapshot barrier and native foreign-consumer failure',async()=>{
  const f=driverFixture();f.state.consumers=[{chainId:1,itemCode:'foreign',sizeList:[{sizeCode:'future'}]}];
  // Exercise the real native group retirement ownership guard, not a mirrored
  // test implementation. Its error must remain a failure before any write.
  f.driver.client.retireGroup=DemaeMenuClient.prototype.retireGroup.bind(f.client);
  await assert.rejects(()=>f.driver.retire(f.targets[1]),/group_unowned_consumer/);
  assert.deepEqual(f.calls,['snapshot']);assert.deepEqual(f.writes,[]);
});

test('malformed proof cannot skip the full snapshot and its global carrier failure',async()=>{
  const f=driverFixture();f.state.members[0].applyEndDate='bad';
  f.driver.snapshot=async()=>{f.calls.push('snapshot');throw Error('demae_internal_carrier_is_live');};
  await assert.rejects(()=>f.driver.retire(f.targets[0]),/carrier_is_live/);
  assert.deepEqual(f.calls,['snapshot']);assert.deepEqual(f.writes,[]);
});

test('Rocket retirement never uses the Demae no-op optimization',async()=>{
  const f=driverFixture('rocket_now');f.driver.client.retirementNoop=async()=>{throw Error('must not be called');};
  f.targets[0].mappings=[{externalId:'3'}];
  await f.driver.retire(f.targets[0]);assert.deepEqual(f.calls,['snapshot','retireOption']);
});

test('global Demae category writes freshly validate carriers and unchanged category identity/order',async()=>{
  for(const mode of ['success','carrier-live','changed-order','changed-id']) {
    const targets=['a','b'].map((id,sortOrder)=>({kind:'category',sourceKey:`category:${id}`,targetId:id,sortOrder,mappings:[{externalId:id}]}));
    const driver=new AuthorityNativeDriver({}, {platformKey:'demae_can',merchantId:'1',menuPatternCode:'live',targets}),calls=[];
    driver.client.catalog=async()=>({items:{categoryList:[{categoryCode:'b'},{categoryCode:'unmanaged'},{categoryCode:'a'}]}});
    driver.snapshot=async()=>{calls.push('snapshot');if(mode==='carrier-live')throw Error('demae_internal_carrier_is_live');
      return (mode==='changed-order'?['a','unmanaged','b']:mode==='changed-id'?['b','unmanaged','different']:['b','unmanaged','a'])
        .map(id=>({kind:'category',id}));};
    driver.client.reorderCategories=async ids=>{calls.push('reorder');assert.deepEqual(ids,['a','unmanaged','b']);};
    if(mode==='success'){await driver.updateCategoryOrder();assert.deepEqual(calls,['snapshot','reorder']);}
    else {await assert.rejects(()=>driver.updateCategoryOrder(),/carrier_is_live|order_identity_mismatch/);assert.deepEqual(calls,['snapshot']);}
  }
});

test('unchanged category order does not add a redundant carrier snapshot or write',async()=>{
  const driver=new AuthorityNativeDriver({}, {platformKey:'demae_can',merchantId:'1',menuPatternCode:'live',targets:['a','b']
    .map((id,sortOrder)=>({kind:'category',sourceKey:`category:${id}`,targetId:id,sortOrder,mappings:[{externalId:id}]}))});
  driver.client.catalog=async()=>({items:{categoryList:[{categoryCode:'a'},{categoryCode:'b'}]}});
  driver.snapshot=driver.client.reorderCategories=async()=>{throw Error('unchanged must not read/write');};
  await driver.updateCategoryOrder();
});
