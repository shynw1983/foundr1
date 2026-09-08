import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';

function fixture() {
 const node=(kind,id,parentId,source={})=>({kind,sourceKey:`${kind}:${id}`,targetId:id,parentId,source,name:`new-${id}`,price:['item','option'].includes(kind)?227:null,description:'',sortOrder:0,marker:'FS0123456789abcd',mappings:[{externalId:{c:'1',g:'2',o:'3',i:'4'}[id]}]});
 const targets=[node('category','c',null),node('option_group','g',null),node('option','o','g'),node('item','i','c',{groupIds:['g']})];
 const payload={authoritativePublication:true,sourceId:'s',storeId:'os',platformKey:'rocket_now',merchantId:'1',revision:1,newItemsHidden:true,imagePolicy:'read_only',targets};
 const rows=[{kind:'category',id:'1',name:'old-c',price:null,childIds:['4'],hidden:false},
 {kind:'option_group',id:'2',name:'old-g',price:null,childIds:['3'],hidden:false},
 {kind:'option',id:'3',name:'old-o',price:100,parentIds:['2'],hidden:true},
 {kind:'item',id:'4',name:'old-i',price:100,description:'',parentIds:['1'],groupIds:['2'],hidden:false}];
 const driver=new AuthorityNativeDriver({},payload);driver.snapshot=async()=>structuredClone(rows);
 const writes=[];
 for(const [method,kind] of [['updateCategory','category'],['updateGroup','option_group'],['updateOption','option'],['updateDish','item']])driver.client[method]=async(id,patch)=>{
  writes.push([kind,id]);Object.assign(rows.find(row=>row.kind===kind&&row.id===id),patch);
 };
 return {payload,driver,rows,writes};
}
test('mapped native graph runs end-to-end and reports separately read prices',async()=>{
 const {payload,driver,writes}=fixture();
 const result=await runUberAuthorityPublication(payload,driver,async()=>{});
 assert.equal(result.observations.length,4);assert.equal(writes.length,4);
 assert.equal(result.observations.find(row=>row.sourceKey==='option:o').hidden,true);
 assert.equal(result.observations.find(row=>row.sourceKey==='item:i').price,227);
});
test('a missing child or unmapped legacy member blocks the entire batch before writes',async()=>{
 for(const missing of [true,false]) {
  const {payload,driver,rows,writes}=fixture();
  if(missing)payload.targets[2].mappings=[];
  else rows[1].childIds.push('99');
  await assert.rejects(()=>runUberAuthorityPublication(payload,driver,async()=>{}),/preflight_blocked/);
  assert.equal(writes.length,0);
 }
});
test('one physical option cannot be assigned conflicting prices across source groups',async()=>{
 const {payload,driver}=fixture();
 payload.targets.push({...payload.targets[2],sourceKey:'option:other',targetId:'other',price:999});
 assert.ok((await driver.preflight(payload)).issues.some(row=>row.code==='conflicting_physical_object'));
});
test('verification detects manual relationship changes after content writes',async()=>{
 const {payload,driver,rows}=fixture();
 const update=driver.client.updateDish;
 driver.client.updateDish=async(...args)=>{await update(...args);rows[3].groupIds=[];};
 await assert.rejects(()=>runUberAuthorityPublication(payload,driver,async()=>{}),/relationship_drift/);
});
test('temporary forced hiding cannot masquerade as a permanent Rocket hold',async()=>{
 const driver=new AuthorityNativeDriver({},{platformKey:'rocket_now',merchantId:'1',targets:[]});
 driver.client.catalog=async()=>({menus:[{menuId:1,menuName:'c',dishes:[{dishId:4}]}],groups:[]});
 driver.client.detail=async()=>({dishId:4,dishName:'i',salePrice:100,displayStatus:'ON_SALE',forceNotExpose:true,mappingMenus:[{menuId:1}],options:[]});
 assert.equal((await driver.snapshot()).find(row=>row.kind==='item').hidden,false);
});

test('a new Rocket option is journaled, created hidden, renamed, and independently verified',async()=>{
 const {payload,driver,rows}=fixture();
 const option=payload.targets[2];option.mappings=[];
 rows.splice(2,1);rows[1].childIds=[];
 let creates=0;const phases=[];
 driver.client.createHiddenOption=async({marker,price,groupId})=>{
  creates++;assert.equal(groupId,'2');
  rows.push({kind:'option',id:'5',name:marker,price,parentIds:['2'],hidden:true});
  rows[1].childIds.push('5');return {optionItemId:5};
 };
 const result=await runUberAuthorityPublication(payload,driver,async progress=>phases.push(progress.phase));
 assert.equal(creates,1);
 assert.ok(phases.indexOf('received')<phases.indexOf('identified'));
 const observed=result.observations.find(row=>row.sourceKey===option.sourceKey);
 assert.equal(observed.externalId,'sub_checkbox_2_5');assert.equal(observed.hidden,true);
 await runUberAuthorityPublication(payload,driver,async()=>{});
 assert.equal(creates,1);
});

test('existing unmapped names block creation, and parentless drafts are not guessed',async()=>{
 const {payload,driver,rows}=fixture();payload.targets[2].mappings=[];
 rows[2].name=payload.targets[2].name;
 assert.ok((await driver.preflight(payload)).issues.some(row=>row.code==='existing_unmapped_candidate'));
 payload.targets[2].parentId='unknown';
 assert.ok((await driver.preflight(payload)).issues.some(row=>row.code==='creation_requires_verified_staging'));
});

test('a hidden marker can be recovered after a lost acknowledgement without creating again',async()=>{
 const {payload,driver,rows}=fixture();const option=payload.targets[2];option.mappings=[];
 rows[2].name=option.marker;payload.authorityState={[option.sourceKey]:{status:'creating'}};
 driver.client.createHiddenOption=async()=>{throw Error('must not create');};
 const result=await runUberAuthorityPublication(payload,driver,async()=>{});
 assert.equal(result.observations.find(row=>row.sourceKey===option.sourceKey).hidden,true);
});

test('retired options are removed before group verification and never cause another create',async()=>{
 const {payload,driver,rows}=fixture();const option=payload.targets[2];option.archived=true;
 let removed=0;
 driver.client.retireOption=async id=>{removed++;assert.equal(id,'3');rows.splice(rows.findIndex(row=>row.kind==='option'&&row.id===id),1);rows[1].childIds=[];};
 const result=await runUberAuthorityPublication(payload,driver,async()=>{});
 assert.equal(removed,1);assert.equal(result.observations.find(row=>row.sourceKey===option.sourceKey).exists,false);
});

test('a changed group is reported as a move, never as a missing native option',async()=>{
 const {payload,driver,rows}=fixture();rows[2].parentIds=['9'];
 const issues=driver.structureIssues(payload.targets[2],rows);
 assert.ok(issues.some(row=>row.code==='option_group_migration_required'));
 assert.equal(issues.some(row=>row.code==='mapped_object_missing'),false);
 driver.observationSnapshot=rows;
 const observed=await driver.observe(payload.targets[2]);
 assert.equal(observed[0].exists,true);assert.equal(observed[0].structureVerified,false);
});

test('moving a known option into a newly created group preserves identity and stock',async()=>{
 const {payload,driver,rows}=fixture();
 payload.targets[1].mappings=[];
 rows[1].id='9';rows[2].parentIds=['9'];rows[2].native={displayStatus:'NOT_EXPOSE'};rows[3].groupIds=['9'];
 let creates=0,moves=0;
 driver.client.createGroup=async marker=>{creates++;rows.push({kind:'option_group',id:'6',name:marker,price:null,childIds:[],hidden:true});return {optionId:6};};
 driver.client.moveOption=async(id,to)=>{
  moves++;assert.equal(id,'3');assert.equal(to,'6');rows[1].childIds=[];
  rows.find(row=>row.id==='6').childIds=['3'];rows[2].parentIds=['6'];
 };
 driver.client.catalog=async()=>({groups:[{optionId:6}]});
 driver.client.detail=async()=>({options:rows[3].groupIds.map(optionId=>({optionId})),mappingMenus:[{menuId:1}]});
 const update=driver.client.updateDish;
 driver.client.updateDish=async(id,patch)=>{await update(id,patch);if(patch.groups)rows[3].groupIds=patch.groups.map(row=>String(row.optionId));};
 const result=await runUberAuthorityPublication(payload,driver,async()=>{});
 assert.equal(creates,1);assert.equal(moves,1);
 assert.equal(result.observations.find(row=>row.sourceKey==='option:o').hidden,true);
 assert.deepEqual(rows[3].groupIds,['6']);
});

test('an unowned old group containing an unknown option blocks before any write',async()=>{
 const {payload,driver,rows,writes}=fixture();
 rows.push({kind:'option_group',id:'9',childIds:['999'],hidden:false});rows[3].groupIds=['9'];
 await assert.rejects(()=>runUberAuthorityPublication(payload,driver,async()=>{}),/preflight_blocked/);
 assert.equal(writes.length,0);
});

test('matching quantity limits cannot conceal a single-select native group',()=>{
 const {payload,driver}=fixture();const target=payload.targets[1];target.source={min:0,max:2};
 assert.equal(driver.quantityMatches(target,{native:{minSelect:0,maxSelect:2,isMultiSelect:false}}),false);
 assert.equal(driver.quantityMatches(target,{native:{minSelect:0,maxSelect:2,isMultiSelect:true}}),true);
});

test('Demae permits only identified additions to a verified private draft carrier',async()=>{
 for(const mode of ['owned','isolated-option','unknown','selling','removed']) {
  const target={kind:'item',sourceKey:'item:i',targetId:'i',source:{groupIds:[]},mappings:[{externalId:'itemList_141false'}]};
  const payload={platformKey:'demae_can',merchantId:'1',targets:[target,{kind:'option',mappings:[{externalId:'itemList_151true',externalParentId:'stage:g'}]}]};
  const driver=new AuthorityNativeDriver({},payload);
  driver.contentSnapshot=[{kind:'item',id:'41',staged:mode!=='selling',groupIds:mode==='removed'?['old']:[],parentIds:['draft']}];
  driver.relationshipSnapshot=[{kind:'item',id:'41',staged:mode!=='selling',groupIds:['g'],parentIds:['draft']},
   {kind:'option_group',id:'g',staged:true,childIds:['51']},
   {kind:'option',id:'51',staged:true,hidden:true,parentIds:['g']}];
  driver.groupIds=()=>['g'];
  if(mode==='isolated-option')driver.relationshipSnapshot.splice(1,1);
  if(mode==='unknown')driver.managedGroup=()=>false;
  if(mode==='owned'||mode==='isolated-option')await driver.updateRelationships(target);
  else await assert.rejects(()=>driver.updateRelationships(target),/relationship_drift/);
 }
});

test('unchanged Demae staged options reuse the independently verified phase snapshot',async()=>{
 const target={kind:'option',sourceKey:'option:o',targetId:'o',name:'same',price:170,mappings:[{externalId:'itemList_151true',externalParentId:'stage:g'}]};
 const driver=new AuthorityNativeDriver({},{platformKey:'demae_can',merchantId:'1',targets:[target]});
 driver.contentSnapshot=[{kind:'option',id:'51',name:'same',price:170,staged:true,parentIds:['g']}];
 await driver.updateContent(target);
});
