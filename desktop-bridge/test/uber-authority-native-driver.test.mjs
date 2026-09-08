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

test('approved replacement into a new group preserves the OS identity and stock with a new native ID',async()=>{
 const {payload,driver,rows}=fixture();
 payload.optionMigrationPolicy='preserve_stock';
 payload.targets[1].mappings=[];
 rows[1].id='9';rows[2].parentIds=['9'];rows[2].native={displayStatus:'NOT_EXPOSE'};rows[3].groupIds=['9'];
 let creates=0,moves=0;
 driver.client.createGroup=async marker=>{creates++;rows.push({kind:'option_group',id:'6',name:marker,price:null,childIds:[],hidden:true});return {optionId:6};};
 driver.client.createHiddenOption=async({marker,price,groupId})=>{
  moves++;assert.equal(groupId,'6');rows.push({kind:'option',id:'8',name:marker,price,hidden:true,parentIds:['6'],native:{displayStatus:'NOT_EXPOSE'}});
  rows.find(row=>row.id==='6').childIds=['8'];return {optionItemId:8};
 };
 driver.client.retireOption=async id=>{assert.equal(id,'3');rows[1].childIds=[];rows.splice(rows.findIndex(row=>row.kind==='option'&&row.id===id),1);};
 driver.client.catalog=async()=>({groups:rows.filter(row=>row.kind==='option_group').map(group=>({optionId:Number(group.id),optionItems:rows.filter(row=>row.kind==='option'&&row.parentIds.includes(group.id)).map(row=>({optionItemId:Number(row.id),optionItemName:row.name,salePrice:row.price,displayStatus:row.hidden?'NOT_EXPOSE':'ON_SALE'}))}))});
 driver.client.detail=async()=>({options:rows.find(row=>row.kind==='item').groupIds.map(optionId=>({optionId})),mappingMenus:[{menuId:1}]});
 const update=driver.client.updateDish;
 driver.client.updateDish=async(id,patch)=>{await update(id,patch);if(patch.groups)rows.find(row=>row.kind==='item').groupIds=patch.groups.map(row=>String(row.optionId));};
 const result=await runUberAuthorityPublication(payload,driver,async()=>{});
 assert.equal(creates,1);assert.equal(moves,1);
 assert.equal(result.observations.find(row=>row.sourceKey==='option:o').hidden,true);
 assert.equal(result.observations.find(row=>row.sourceKey==='option:o').externalId,'sub_checkbox_6_8');
 assert.deepEqual(rows.find(row=>row.kind==='item').groupIds,['6']);
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

test('Rocket non-item creation checks use fresh catalog identities without reading unrelated dish details',async()=>{
 const driver=new AuthorityNativeDriver({},{platformKey:'rocket_now',merchantId:'1',targets:[]});
 driver.client={catalog:async()=>({menus:[{menuId:1,dishes:[{dishId:2}]}],groups:[{optionId:3,optionName:'empty',mappingDishCount:0,optionItems:[]},{optionId:4,optionName:'unknown',optionItems:[{optionItemId:5,optionItemName:'hidden',salePrice:12,displayStatus:'NOT_EXPOSE'}]}]}),detail:async()=>{throw Error('unrelated detail');}};
 const rows=await driver.snapshot({itemDetails:false});
 assert.equal(rows.find(r=>r.id==='3'&&r.kind==='option_group').hidden,true);
 assert.equal(rows.find(r=>r.id==='4'&&r.kind==='option_group').hidden,false);
 assert.equal(rows.find(r=>r.id==='1'&&r.kind==='category').hidden,false);
 assert.equal(rows.find(r=>r.id==='5'&&r.kind==='option').hidden,true);
 assert.equal(rows.some(r=>r.kind==='item'),false);
});

test('Rocket empty optional group normalization cannot hide a populated-group mismatch',()=>{
 const target={kind:'option_group',targetId:'g',source:{min:0,max:1}};
 const driver=new AuthorityNativeDriver({},{platformKey:'rocket_now',merchantId:'1',targets:[target]});
 const row={childIds:[],native:{minSelect:0,maxSelect:0,isMandatory:false,isMultiSelect:false}};
 assert.equal(driver.quantityMatches(target,row),true);
 driver.payload.targets.push({kind:'option',targetId:'o',parentId:'g'});
 assert.equal(driver.quantityMatches(target,row),false);
});

test('unchanged Demae staged options reuse the independently verified phase snapshot',async()=>{
 const target={kind:'option',sourceKey:'option:o',targetId:'o',name:'same',price:170,mappings:[{externalId:'itemList_151true',externalParentId:'stage:g'}]};
 const driver=new AuthorityNativeDriver({},{platformKey:'demae_can',merchantId:'1',targets:[target]});
 driver.contentSnapshot=[{kind:'option',id:'51',name:'same',price:170,staged:true,parentIds:['g']}];
 await driver.updateContent(target);
});

test('new Demae items are read by receipt ID and retain initial relationships without a full catalog scan',async()=>{
 const target={kind:'item',sourceKey:'item:new',targetId:'new',name:'new',price:170,description:'',mappings:[{externalId:'itemList_141false',externalParentId:'draft:draft',created:true}]};
 const transport={request:async path=>{
  if(path.endsWith('/search/menu-pattern'))return {menuPatternList:[{chainId:1,menuPatternCode:'draft',shopCountPerMenuPattern:0,displayShopCount:0,linkedShopList:[]}],isContinueNextPage:false,totalCount:1};
  if(path.endsWith('/item/41'))return {chainId:1,itemCode:'41',itemName:'new',itemDescription:'',sizeInfoList:[{sizeCode:'001',applyStartDate:'2020/01/01',applyEndDate:'9999/12/31',price:170,sizeOptionGroupLinkList:[]}]};
  if(path.endsWith('/linked-category-list'))return [{categoryCode:'c',applyStartDate:'2020/01/01',applyEndDate:'9999/12/31'}];
  if(path.endsWith('/menu-pattern-list'))return [{chainId:1,menuPatternCode:'draft'}];
  if(path.includes('/category/c/'))return {chainId:1,categoryCode:'c'};
  throw Error(`unexpected read:${path}`);
 }};
 const driver=new AuthorityNativeDriver(transport,{platformKey:'demae_can',merchantId:'1',menuPatternCode:'live',draftPatternCode:'draft',targets:[target]});
 driver.contentSnapshot=[];driver.snapshot=async()=>{throw Error('full scan not needed');};
 await driver.updateContent(target);
 assert.deepEqual(driver.contentSnapshot[0].groupIds,[]);
 assert.equal(driver.contentSnapshot[0].staged,true);
 assert.equal(driver.contentSnapshot[0].price,170);
});
