import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';

function fixture(platform) {
 const target=(kind,id,parentId,source={})=>({kind,sourceKey:`${kind}:${id}`,targetId:id,parentId,source,
  name:`same-${id}`,price:['item','option'].includes(kind)?227:null,description:'',sortOrder:0,
  marker:'FS0123456789abcd',mappings:[{externalId:{c:'1',g:'2',o:'3',i:'4'}[id]}]});
 const targets=[target('category','c',null),target('option_group','g',null,{id:'g',min:0,max:1}),
  target('option','o','g'),target('item','i','c',{groupIds:['g']})];
 const payload={authoritativePublication:true,sourceId:'s',storeId:'os',platformKey:platform,merchantId:'1',menuPatternCode:'live',
  revision:1,newItemsHidden:true,imagePolicy:'read_only',selectionPolicy:'preserve_native',targets};
 const rows=[{kind:'category',id:'1',name:'same-c',price:null,childIds:['4'],hidden:false},
  {kind:'option_group',id:'2',name:'same-g',price:null,childIds:['3'],hidden:false,native:{minSelect:0,maxSelect:1,isMultiSelect:false}},
  {kind:'option',id:'3',name:'same-o',price:227,parentIds:['2'],hidden:true},
  {kind:'item',id:'4',name:'same-i',price:227,description:'',parentIds:['1'],groupIds:['2'],hidden:false}];
 const driver=new AuthorityNativeDriver({},payload),reads=[],writes=[],groupReads=[];
 driver.snapshot=async options=>{reads.push(options);return structuredClone(rows);};
 driver.client.group=async id=>{groupReads.push(id);const row=rows.find(row=>row.kind==='option_group'&&row.id===id);
  return {detail:{optionGroupCode:id,optionGroupName:row.name},options:row.childIds.map(optionCode=>({optionCode})),items:[]};};
 for(const [method,kind] of [['updateCategory','category'],['updateGroup','option_group'],['updateOption','option'],['updateDish','item'],['updateItem','item']]) {
  driver.client[method]=async(id,patch)=>{
   writes.push({kind,id,patch:structuredClone(patch)});
   const row=rows.find(row=>row.kind===kind&&row.id===id);
   if(patch.memberIds||patch.optionCodes)row.childIds=patch.memberIds??patch.optionCodes;
   Object.assign(row,Object.fromEntries(Object.entries(patch).filter(([key])=>['name','price','description'].includes(key))));
  };
 }
 return {payload,driver,rows,reads,writes,groupReads};
}

for(const platform of ['rocket_now','demae_can']) {
 test(`${platform} skips unchanged content but independently verifies the complete native graph`,async()=>{
  const {payload,driver,reads,writes}=fixture(platform);
  assert.deepEqual((await driver.preflight(payload)).issues,[]);
  assert.deepEqual(payload.targets.filter(target=>driver.contentNeedsUpdate(target)),[]);
  const result=await runUberAuthorityPublication(payload,driver,async()=>{});
  assert.equal(result.observations.length,4);assert.deepEqual(writes,[]);
  assert.ok(reads.length>=4);assert.equal(reads.at(-1),undefined);
 });

 test(`${platform} changes only the native option with a content difference`,async()=>{
  const {payload,driver,rows,writes}=fixture(platform);
  payload.targets.find(target=>target.kind==='option').price=319;
  assert.deepEqual((await driver.preflight(payload)).issues,[]);
  assert.deepEqual(payload.targets.filter(target=>driver.contentNeedsUpdate(target)).map(target=>target.sourceKey),['option:o']);
  const result=await runUberAuthorityPublication(payload,driver,async()=>{});
  assert.deepEqual(writes,[{kind:'option',id:'3',patch:{name:'same-o',price:319}}]);
  assert.equal(result.observations.find(row=>row.sourceKey==='option:o').price,319);
  assert.equal(rows.find(row=>row.kind==='option').hidden,true);
 });

 test(`${platform} retains final stock and relationship drift guards when content work is empty`,async()=>{
  for(const drift of ['identity','relationship','created_exposure']) {
   const {payload,driver,writes}=fixture(platform);
   const option=payload.targets.find(target=>target.kind==='option');
   if(drift==='created_exposure')option.mappings[0].created=true;
   const snapshot=driver.snapshot,beginPhase=driver.beginPhase.bind(driver);let verifying=false;
   driver.beginPhase=async(...args)=>{if(args[0]==='verifying')verifying=true;return beginPhase(...args);};
   driver.snapshot=async options=>{
    const rows=await snapshot(options);
    if(verifying) {
     if(drift==='identity')rows.splice(rows.findIndex(row=>row.kind==='option'),1);
     if(drift==='relationship')rows.find(row=>row.kind==='item').groupIds=[];
     if(drift==='created_exposure')rows.find(row=>row.kind==='option').hidden=false;
    }
    return rows;
   };
   await assert.rejects(()=>runUberAuthorityPublication(payload,driver,async()=>{}),
    drift==='created_exposure'?/draft_exposed/:/content_unverified/,drift);
   assert.deepEqual(writes,[]);
  }
 });
}

test('content planning preserves missing identities and creation receipts without counting group quantities as name/price writes',async()=>{
 const {payload,driver,rows}=fixture('rocket_now');
 assert.deepEqual((await driver.preflight(payload)).issues,[]);
 const option=payload.targets.find(target=>target.kind==='option');
 option.mappings[0].created=true;
 assert.equal(driver.contentNeedsUpdate(option),false);
 option.mappings=[];assert.equal(driver.contentNeedsUpdate(option),true);
 option.mappings=[{externalId:'5',created:true}];assert.equal(driver.contentNeedsUpdate(option),true);
 driver.contentSnapshot.push({...rows.find(row=>row.kind==='option'),id:'5',kind:'item'});
 assert.equal(driver.contentNeedsUpdate(option),true);
 const group=payload.targets.find(target=>target.kind==='option_group');
 driver.contentSnapshot.find(row=>row.kind==='option_group').native.maxSelect=10;
 assert.equal(driver.contentNeedsUpdate(group),false);
 assert.equal(driver.quantityMatches(group,driver.contentSnapshot.find(row=>row.kind==='option_group')),false);
 const item=payload.targets.find(target=>target.kind==='item');item.description='new description';
 assert.equal(driver.contentNeedsUpdate(item),true);
});

test('shared physical content is memoized only after verified success, by exact desired fields and kind, for one execution',async()=>{
 for(const platform of ['rocket_now','demae_can']) {
  const {payload,driver,rows}=fixture(platform);
  const target=payload.targets.find(row=>row.kind==='option');target.price=319;
  assert.deepEqual((await driver.preflight(payload)).issues,[]);
  let attempts=0;
  driver.client.updateOption=async()=>{if(++attempts===1)throw Error('native readback failed');};
  await assert.rejects(()=>driver.updateContent(target),/native readback failed/);
  await driver.updateContent({...target,sourceKey:'option:other:occurrence'});
  await driver.updateContent(target);assert.equal(attempts,2);
  target.price=420;await driver.updateContent(target);assert.equal(attempts,3);
  target.name='different desired name';await driver.updateContent(target);assert.equal(attempts,4);
  const item={...target,kind:'item',description:'same physical number in another native kind'};
  driver.contentSnapshot.push({kind:'item',id:'3',name:'old item',price:100,description:''});
  let itemAttempts=0;
  driver.client[platform==='rocket_now'?'updateDish':'updateItem']=async()=>{itemAttempts++;};
  await driver.updateContent(item);assert.equal(itemAttempts,1);
  item.description='another desired description';await driver.updateContent(item);assert.equal(itemAttempts,2);
  // Reusing a driver for a later execution must read and repair fresh drift.
  rows.find(row=>row.kind==='option').price=227;
  assert.deepEqual((await driver.preflight(payload)).issues,[]);
  await driver.updateContent(target);assert.equal(attempts,5);
 }
});

test('Rocket category phase refreshes catalog membership without repeating every dish detail',async()=>{
 const {driver}=fixture('rocket_now');
 const calls=[];
 driver.snapshot=AuthorityNativeDriver.prototype.snapshot.bind(driver);
 driver.client.catalog=async()=>({menus:[{menuId:1,menuName:'same-c',dishes:[{dishId:4}]}],groups:[]});
 driver.client.detail=async()=>{calls.push('detail');throw Error('category phase must not request dish details');};
 await driver.beginPhase('categories');
 assert.deepEqual(driver.categorySnapshot.find(row=>row.kind==='category').childIds,['4']);
 assert.deepEqual(calls,[]);
});

test('Rocket retained retirements still get fresh hidden-state proof before category updates',async()=>{
 for(const exposed of [false,true]) {
  const {payload,driver}=fixture('rocket_now');
  payload.targets.push({kind:'item',sourceKey:'item:retired',targetId:'retired',parentId:'c',archived:true,mappings:[{externalId:'5'}]});
  const reads=[];
  driver.snapshot=AuthorityNativeDriver.prototype.snapshot.bind(driver);
  driver.client.catalog=async()=>({menus:[{menuId:1,menuName:'same-c',dishes:[{dishId:4},{dishId:5}]}],groups:[]});
  driver.client.detail=async id=>{reads.push(String(id));return {dishId:Number(id),dishName:`item-${id}`,salePrice:227,
   displayStatus:String(id)==='5'&&!exposed?'NOT_EXPOSE':'ON_SALE',mappingMenus:[{menuId:1}],options:[]};};
  driver.client.reorderCategoryItems=async()=>{throw Error('must not reorder or release a retained retirement');};
  await driver.beginPhase('categories');
  assert.deepEqual(reads,['4','5']);
  if(exposed)await assert.rejects(()=>driver.updateRelationships(payload.targets[0]),/relationship_drift/);
  else await driver.updateRelationships(payload.targets[0]);
 }
});

test('Demae unchanged relationships and categories reuse one phase read but independently refresh final proofs',async()=>{
 const {driver,reads,groupReads,writes}=fixture('demae_can');
 await driver.beginPhase('relationships');
 assert.equal(reads.length,1);assert.deepEqual(groupReads,[]);assert.deepEqual(writes,[]);
 assert.notEqual(driver.relationshipSnapshot,driver.contentSnapshot);
 await driver.beginPhase('categories');
 assert.equal(reads.length,1);assert.equal(driver.categorySnapshot,driver.relationshipSnapshot);
 await driver.beginPhase('verifying');
 assert.equal(reads.length,2);assert.notEqual(driver.observationSnapshot,driver.relationshipSnapshot);
});

test('Demae membership migration still adds the destination before any source removal and rereads afterward',async()=>{
 const {payload,driver,rows,writes,groupReads}=fixture('demae_can');
 const destination={kind:'option_group',sourceKey:'option_group:destination',targetId:'destination',name:'destination',price:null,
  source:{},mappings:[{externalId:'5'}]};
 payload.targets.push(destination);payload.targets.find(target=>target.kind==='option').parentId='destination';
 rows.push({kind:'option_group',id:'5',name:'destination',price:null,childIds:[],hidden:true});
 const sequence=[],snapshot=driver.snapshot,updateGroup=driver.client.updateGroup;
 driver.snapshot=async options=>{sequence.push('snapshot');return snapshot(options);};
 driver.client.updateGroup=async(id,patch)=>{sequence.push(`write:${id}`);return updateGroup(id,patch);};
 await driver.beginPhase('relationships');
 assert.deepEqual(groupReads,['2','5']);
 assert.deepEqual(writes,[{kind:'option_group',id:'5',patch:{optionCodes:['3']}}]);
 assert.deepEqual(sequence,['snapshot','write:5','snapshot']);
 assert.deepEqual(rows.find(row=>row.kind==='option_group'&&row.id==='2').childIds,['3']);
 assert.deepEqual(driver.relationshipSnapshot.find(row=>row.kind==='option_group'&&row.id==='5').childIds,['3']);
});

test('Demae later relationship reads reject unknown native members after the no-op pre-add decision',async()=>{
 const {payload,driver,rows,writes}=fixture('demae_can');
 await driver.beginPhase('relationships');
 // Incomplete cached native detail cannot prove a no-op; the focused native
 // read still sees a later unknown member and refuses any write.
 rows.find(row=>row.kind==='option_group').childIds.push('unowned');
 await assert.rejects(()=>driver.updateRelationships(payload.targets.find(target=>target.kind==='option_group')),/unowned_group_member/);
 assert.deepEqual(writes,[]);
});
