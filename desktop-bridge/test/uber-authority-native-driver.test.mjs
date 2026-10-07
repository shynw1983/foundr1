import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityNativeDriver} from '../src/uber-authority-native-driver.mjs';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';
import {ensureUberAuthorityObject} from '../src/uber-authority-create.mjs';

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

test('Demae preflight identifies both independent same-name options and blocks the batch without mutation',async()=>{
 const {payload,rows}=fixture();payload.platformKey='demae_can';payload.menuPatternCode='live';
 const first=payload.targets[2];first.sourceKey='option:g:first';first.name='Bite-Sized Taiwanese Pork Sausage';
 const second={...structuredClone(first),targetId:'second',sourceKey:'option:g:second',mappings:[{externalId:'5'}]};
 payload.targets.push(second);rows[1].childIds.push('5');rows.push({...structuredClone(rows[2]),id:'5'});
 const driver=new AuthorityNativeDriver({},payload);let reads=0,writes=0;
 driver.snapshot=async()=>{reads++;return structuredClone(rows);};
 for(const method of ['updateCategory','updateGroup','updateOption','updateItem','createHiddenOption','retireOption'])driver.client[method]=async()=>{writes++;throw Error('must not write');};
 const before={payload:structuredClone(payload),rows:structuredClone(rows)};
 const phases=[];
 await assert.rejects(()=>runUberAuthorityPublication(payload,driver,async progress=>phases.push(progress)),error=>{
  assert.match(error.message,/uber_authority_preflight_blocked/);
  assert.deepEqual(error.issues,[first,second].map(target=>({sourceKey:target.sourceKey,code:'native_name_prohibited_substring',rule:'demae-option-size-substring',fragment:'size'})));
  return true;
 });
 assert.equal(reads,1);assert.equal(writes,0);
 assert.deepEqual(phases.map(progress=>progress.phase),['preflight','blocked']);
 assert.deepEqual(phases[1].issues.map(issue=>issue.sourceKey),[first.sourceKey,second.sourceKey]);
 assert.deepEqual(payload,before.payload);assert.deepEqual(rows,before.rows);
});

test('Demae naming preflight ignores retired and quarantined options but preserves its existing group limit',async()=>{
 const {payload,rows}=fixture();payload.platformKey='demae_can';payload.menuPatternCode='live';
 const archived=payload.targets[2];archived.archived=true;archived.name='Bite-Sized archived';
 const quarantined={...structuredClone(archived),targetId:'quarantine',sourceKey:'option:g:quarantine',archived:false,quarantined:true,mappings:[{externalId:'5'}]};
 payload.targets.push(quarantined);
 payload.targets[0].name='Size category';payload.targets[3].name='Size item';
 payload.targets[1].name='Size group '+ '長'.repeat(40);
 const driver=new AuthorityNativeDriver({},payload);driver.snapshot=async()=>structuredClone(rows);
 const before=structuredClone(payload);
 const issues=(await driver.preflight(payload)).issues;
 assert.deepEqual(issues,[{sourceKey:payload.targets[1].sourceKey,code:'native_group_name_too_long'}]);
 assert.deepEqual(payload,before);
 payload.targets[1].name='Size group '+ '長'.repeat(39);
 assert.equal(payload.targets[1].name.length,50);
 assert.deepEqual((await driver.preflight(payload)).issues,[]);
});

test('confirmed retirement retains Demae carrier ownership without trusting unknown groups',()=>{
 const target={kind:'item',sourceKey:'item:beef',targetId:'beef',source:{groupIds:[]},mappings:[{externalId:'00000015'}]};
 const option={kind:'option',sourceKey:'option:fruit:mango',targetId:'mango',archived:true,mappings:[{externalId:'00000210',externalParentId:'stage:0044'}]};
 const driver=new AuthorityNativeDriver({}, {platformKey:'demae_can',merchantId:'1',menuPatternCode:'live',draftCarrierItemCode:'00000015',targets:[target,option]});
 const rows=[{kind:'item',id:'00000015',staged:true,hidden:true,parentIds:[],groupIds:['0044']},
  {kind:'option_group',id:'0044',staged:true,internalCarrier:true,carrierItemId:'00000015',childIds:['00000210']},
  {kind:'option',id:'00000210',staged:true,hidden:true,parentIds:['0044']}];
 driver.contentSnapshot=rows;
 assert.deepEqual(driver.structureIssues(target,rows,{preflight:true}),[]);
 rows[0].groupIds.push('unknown');
 assert.deepEqual(driver.structureIssues(target,rows,{preflight:true}).map(row=>row.code),['item_group_migration_required']);
});

test('Demae category item order is applied and verified independently, excluding hidden drafts',async()=>{
 for(const ignored of [false,true]) {
  const category={kind:'category',targetId:'category',sourceKey:'category:category',name:'category',mappings:[{externalId:'12'}]};
  const item=(id,sortOrder)=>({kind:'item',targetId:id,sourceKey:`item:${id}`,parentId:'category',sortOrder,mappings:[{externalId:id}]});
  const payload={platformKey:'demae_can',merchantId:'1',menuPatternCode:'live',targets:[category,item('1',0),item('15',1),item('2',2)]};
  const rows=[{kind:'category',id:'12',childIds:['2','1'],name:'category',hidden:false},
   {kind:'item',id:'1',hidden:false},{kind:'item',id:'2',hidden:true},{kind:'item',id:'15',staged:true,hidden:true}];
  const driver=new AuthorityNativeDriver({},payload);driver.categorySnapshot=rows;
  assert.deepEqual(driver.structureIssues(category,rows,{preflight:true}),[]);
  assert.equal(driver.structureIssues(category,rows).length,1);
  let writes=0;
  driver.client.updateCategory=async(id,patch)=>{writes++;assert.equal(id,'12');assert.deepEqual(patch,{itemCodes:['1','2']});if(!ignored)rows[0].childIds=patch.itemCodes;};
  await driver.updateRelationships(category);
  assert.equal(writes,1);driver.observationSnapshot=rows;
  assert.equal((await driver.observe(category))[0].structureVerified,!ignored);
  assert.equal(rows[3].hidden,true);assert.equal(rows[3].staged,true);
 }
});

test('category sorting never removes hidden retired records or adopts unknown members',async()=>{
 const category={kind:'category',targetId:'category',sourceKey:'category:category',mappings:[{externalId:'12'}]};
 const item=(id,sortOrder,archived=false)=>({kind:'item',targetId:id,sourceKey:`item:${id}`,parentId:'category',sortOrder,archived,mappings:[{externalId:id}]});
 const driver=new AuthorityNativeDriver({}, {platformKey:'rocket_now',merchantId:'1',targets:[category,item('1',0),item('2',1),item('3',2,true)]});
 const rows=[{kind:'category',id:'12',childIds:['2','3','1']},{kind:'item',id:'1'},{kind:'item',id:'2'},{kind:'item',id:'3',hidden:true}];
 driver.categorySnapshot=rows;let writes=0;
 driver.client.reorderCategoryItems=async(id,ids)=>{writes++;assert.equal(id,'12');assert.deepEqual(ids,['1','2','3']);rows[0].childIds=ids;};
 await driver.updateRelationships(category);assert.equal(writes,1);
 assert.deepEqual(driver.structureIssues(category,rows),[]);assert.equal(rows[3].hidden,true);
 rows[0].childIds.push('unknown');
 await assert.rejects(()=>driver.updateRelationships(category),/relationship_drift/);assert.equal(writes,1);
});
test('same-name options in another group are safe only with a distinct exact mapped owner',()=>{
 const {payload,driver,rows}=fixture();
 const owner=payload.targets[2];owner.sourceKey='option:g:old';
 const target={...owner,targetId:'new',parentId:'other',sourceKey:'option:other:new',mappings:[]};
 assert.equal(driver.isIdentifiedOtherGroupOption(rows[2],target),true);
 for(const patch of [{parentId:'g'},{sourceKey:'option:other:old'},{sourceKey:'option:broken'}])
  assert.equal(driver.isIdentifiedOtherGroupOption(rows[2],{...target,...patch}),false);
 assert.equal(driver.isIdentifiedOtherGroupOption({...rows[2],parentIds:['unknown']},target),false);
 owner.quarantined=true;assert.equal(driver.isIdentifiedOtherGroupOption(rows[2],target),false);
 owner.quarantined=false;owner.mappings=[];assert.equal(driver.isIdentifiedOtherGroupOption(rows[2],target),false);
});
test('mapped native graph runs end-to-end and reports separately read prices',async()=>{
 const {payload,driver,writes}=fixture();
 const result=await runUberAuthorityPublication(payload,driver,async()=>{});
 assert.equal(result.observations.length,4);assert.equal(writes.length,4);
 assert.equal(result.observations.find(row=>row.sourceKey==='option:o').hidden,true);
 assert.equal(result.observations.find(row=>row.sourceKey==='item:i').price,227);
});

function stableCreatedFixture(platform='rocket_now') {
 const {payload,rows,writes}=fixture();payload.platformKey=platform;
 for(const target of payload.targets) {
  target.mappings[0].created=true;
  const row=rows.find(row=>row.kind===target.kind&&row.id===target.mappings[0].externalId);
  Object.assign(row,{name:target.name,price:target.price,hidden:true});
 }
 const driver=new AuthorityNativeDriver({},payload),reads=[];
 driver.snapshot=async options=>{reads.push(options);return structuredClone(rows);};
 for(const method of ['updateCategory','updateGroup','updateOption','updateDish','updateItem'])driver.client[method]=async()=>{writes.push(method);};
 return {payload,driver,rows,writes,reads};
}

test('historical created receipts reuse exact preflight kind/IDs without another content snapshot',async()=>{
 for(const platform of ['rocket_now','demae_can']) {
  const {payload,driver,writes,reads}=stableCreatedFixture(platform);
  const mappings=structuredClone(payload.targets.map(target=>target.mappings));
  assert.deepEqual((await driver.preflight(payload)).issues,[]);
  for(const target of payload.targets)await driver.updateContent(target);
  assert.equal(reads.length,1,platform);assert.deepEqual(writes,[]);
  assert.deepEqual(payload.targets.map(target=>target.mappings),mappings);
 }
});

test('mixed historical/new created IDs need fresh proof only for the missing same-kind identity',async()=>{
 const {payload,driver,rows,writes,reads}=stableCreatedFixture();
 const target=payload.targets.find(target=>target.kind==='option');
 assert.deepEqual((await driver.preflight(payload)).issues,[]);
 const second={...rows.find(row=>row.kind==='option'),id:'5'};
 rows.push(second);rows.find(row=>row.kind==='option_group').childIds.push('5');
 target.mappings.push({externalId:'5',created:true});
 await driver.updateContent(target);
 assert.equal(reads.length,2);assert.deepEqual(reads[1],{itemDetails:false});assert.deepEqual(writes,[]);
 // The next execution independently lists both identities, regardless of
 // the durable created flags; it must not repeat the full content scan.
 assert.deepEqual((await driver.preflight(payload)).issues,[]);
 target.mappings[1].created=false; // mixed durable/new mapping flags
 await driver.updateContent(target);assert.equal(reads.length,3);assert.deepEqual(writes,[]);
 // The same numeric ID in a different kind is not an identity proof.
 driver.contentSnapshot=driver.contentSnapshot.map(row=>row.kind==='option'&&row.id==='3'?{...row,kind:'item'}:row);
 await driver.updateContent(target);assert.equal(reads.length,4);assert.deepEqual(writes,[]);
 driver.contentSnapshot=[];driver.snapshot=async()=>[{...second,id:'different'}];
 await assert.rejects(()=>driver.updateContent(target),/native_object_missing/);assert.deepEqual(writes,[]);
});

test('a new Demae group missing from preflight retains the original full identity proof and name update',async()=>{
 const target={kind:'option_group',sourceKey:'option_group:new',targetId:'new',source:{},name:'new group',price:null,
  marker:'FS0123456789abcd',mappings:[{externalId:'3',created:true}]};
 const driver=new AuthorityNativeDriver({},{platformKey:'demae_can',merchantId:'1',targets:[target]});
 driver.contentSnapshot=[{kind:'category',id:'3',name:'different native kind'}];
 const native={kind:'option_group',id:'3',name:target.marker,price:null,hidden:true,childIds:[]};
 let reads=0;const writes=[];
 driver.snapshot=async options=>{reads++;assert.deepEqual(options,{itemDetails:false});return [structuredClone(native)];};
 driver.client.updateGroup=async(id,patch)=>{writes.push({id,patch});Object.assign(native,patch);};
 await driver.updateContent(target);
 assert.equal(reads,1);assert.deepEqual(writes,[{id:'3',patch:{name:'new group'}}]);
 assert.equal(native.hidden,true);assert.equal(target.mappings[0].created,true);
 driver.snapshot=async()=>[{...native,id:'unrelated'}];
 await assert.rejects(()=>driver.updateContent(target),/native_object_missing/);assert.equal(writes.length,1);
});

test('unchanged created content still requires fresh final ordering, identity and hidden-state verification',async()=>{
 for(const mode of ['ok','order','identity','exposed']) {
  const {payload,driver,rows,writes,reads}=stableCreatedFixture();
  const option=payload.targets.find(target=>target.kind==='option');
  const second={...option,targetId:'second',sourceKey:'option:second',name:'new-second',mappings:[{externalId:'5',created:true}]};
  payload.targets.push(second);
  rows.push({...rows.find(row=>row.kind==='option'),id:'5',name:second.name});
  rows.find(row=>row.kind==='option_group').childIds.push('5');
  const snapshot=driver.snapshot,beginPhase=driver.beginPhase.bind(driver);let verifying=false;
  driver.beginPhase=async(...args)=>{if(args[0]==='verifying')verifying=true;return beginPhase(...args);};
  driver.snapshot=async options=>{
   const observed=await snapshot(options);
   if(verifying) {
    if(mode==='order')observed.find(row=>row.kind==='option_group').childIds.reverse();
    if(mode==='identity')observed.splice(observed.findIndex(row=>row.kind==='option'&&row.id==='5'),1);
    if(mode==='exposed')observed.find(row=>row.kind==='option'&&row.id==='5').hidden=false;
   }
   return observed;
  };
  if(mode==='ok') {
   const result=await runUberAuthorityPublication(payload,driver,async()=>{});
   assert.equal(result.observations.length,5);assert.equal(result.observations.find(row=>row.sourceKey==='option:second').hidden,true);
  }else await assert.rejects(()=>runUberAuthorityPublication(payload,driver,async()=>{}),mode==='exposed'?/draft_exposed/:/content_unverified/,mode);
  assert.equal(reads.length,5,mode);assert.equal(reads.at(-1),undefined);assert.deepEqual(writes,[]);
  assert.ok(payload.targets.every(target=>target.mappings.every(mapping=>mapping.created===true)));
 }
});

test('creation uses the same exact-owner exception as preflight without changing the other option',async()=>{
 const {payload,driver,rows}=fixture();
 const owner=payload.targets[2];owner.sourceKey='option:g:old';rows[2].name=owner.name;
 const group={...payload.targets[1],targetId:'other',sourceKey:'option_group:other',mappings:[{externalId:'6'}]};
 const target={...owner,targetId:'new',parentId:'other',sourceKey:'option:other:new',mappings:[],marker:'FSnewoption'};
 payload.targets.push(group,target);rows.push({kind:'option_group',id:'6',name:group.name,childIds:[],hidden:true});
 assert.ok(!(await driver.preflight(payload)).issues.some(issue=>issue.sourceKey===target.sourceKey));
 const original=structuredClone(rows[2]);let creates=0;
 driver.client.createHiddenOption=async({marker,price,groupId})=>{
  creates++;assert.equal(groupId,'6');rows.push({kind:'option',id:'7',name:marker,price,parentIds:['6'],hidden:true});return {optionItemId:7};
 };
 const phases=[];
 await ensureUberAuthorityObject(target,payload,driver,async p=>phases.push(p.phase));
 assert.equal(creates,1);assert.deepEqual(rows[2],original);
 assert.deepEqual(phases,['creating','received','identified']);
 await ensureUberAuthorityObject(target,payload,driver,async()=>{});assert.equal(creates,1);
});

test('pre-write collisions are rejected safely, but merchant errors remain uncertain',async()=>{
 for(const collision of [true,false]) {
  const {payload,driver,rows}=fixture();const target=payload.targets[2];target.mappings=[];
  rows[2].name=collision?target.name:'unrelated';
  let creates=0;driver.client.createHiddenOption=async()=>{creates++;throw Error('network timeout');};
  const phases=[];
  await assert.rejects(()=>ensureUberAuthorityObject(target,payload,driver,async p=>phases.push(p.phase)),collision?/creation_existing_candidate/:/network timeout/);
  assert.equal(creates,collision?0:1);assert.deepEqual(phases,collision?['creating','rejected']:['creating']);
 }
 const {driver,payload,rows}=fixture();const target=payload.targets[2];rows[2].name=target.marker;
 assert.equal(driver.hasCreationCollision(rows,target),true);
 assert.equal(driver.isDefiniteRejection(Error('uber_authority_creation_existing_candidate')),false);
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
test('Rocket native adaptation repairs fixed-one quantities instead of skipping verification',async()=>{
 const {payload,driver,rows}=fixture();payload.selectionPolicy='preserve_native';
 const group=payload.targets[1];group.source={min:0,max:50};
 rows[1].native={minSelect:0,maxSelect:1,isMultiSelect:false};
 assert.equal(driver.quantityMatches(group,rows[1]),false);
 let patch;driver.client.updateGroup=async(id,value)=>{patch=value;};
 await driver.updateRelationships(group);assert.deepEqual(patch,{memberIds:['3'],min:0,max:1,isMultiSelect:true});
 rows[1].native.isMultiSelect=true;assert.equal(driver.quantityMatches(group,rows[1]),true);
 payload.selectionPolicy='strict';assert.equal(driver.quantityMatches(group,rows[1]),false);
});
test('Rocket caps 50 to 13 available choices and still enables repeated quantities',()=>{
 const {payload,driver}=fixture();payload.selectionPolicy='preserve_native';
 driver.children=()=>Array.from({length:13},()=>({}));
 const group={kind:'option_group',source:{min:0,max:50}};
 assert.deepEqual(driver.rocketQuantityLimits(group),{min:0,max:13,isMultiSelect:true});
 assert.equal(driver.quantityMatches(group,{native:{minSelect:0,maxSelect:1,isMultiSelect:false}}),false);
 assert.equal(driver.quantityMatches(group,{native:{minSelect:0,maxSelect:13,isMultiSelect:true}}),true);
});

test('Demae permits only identified additions to a verified private draft carrier',async()=>{
 for(const mode of ['owned','missing-group-proof','unknown','selling','removed']) {
  const target={kind:'item',sourceKey:'item:i',targetId:'i',source:{groupIds:[]},mappings:[{externalId:'itemList_141false'}]};
  const payload={platformKey:'demae_can',merchantId:'1',targets:[target,{kind:'option',mappings:[{externalId:'itemList_151true',externalParentId:'stage:g'}]}]};
  const driver=new AuthorityNativeDriver({},payload);
  driver.contentSnapshot=[{kind:'item',id:'41',staged:mode!=='selling',groupIds:mode==='removed'?['old']:[],parentIds:['draft']}];
  driver.relationshipSnapshot=[{kind:'item',id:'41',staged:mode!=='selling',groupIds:['g'],parentIds:['draft']},
   {kind:'option_group',id:'g',staged:true,internalCarrier:true,carrierItemId:'41',childIds:['51']},
   {kind:'option',id:'51',staged:true,hidden:true,parentIds:['g']}];
  driver.groupIds=()=>['g'];
  if(mode==='missing-group-proof')driver.relationshipSnapshot.splice(1,1);
  if(mode==='unknown')driver.managedGroup=()=>false;
  if(mode==='owned')await driver.updateRelationships(target);
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

test('Rocket preserves only unused empty required placeholders under native adaptation',async()=>{
 const target={kind:'option_group',targetId:'g',source:{id:'g',min:1,max:1},mappings:[{externalId:'2'}]};
 const payload={platformKey:'rocket_now',merchantId:'1',selectionPolicy:'preserve_native',targets:[target]};
 const driver=new AuthorityNativeDriver({},payload);
 const row={kind:'option_group',id:'2',childIds:[],native:{minSelect:0,maxSelect:0,isMandatory:false,mappingDishCount:0,mappingDishes:null}};
 driver.snapshot=async()=>[row];driver.client.updateGroup=async()=>{throw Error('empty placeholder must not be written');};
 assert.equal(driver.quantityMatches(target,row),true);
 await driver.updateRelationships(target);
 payload.selectionPolicy='strict';assert.equal(driver.quantityMatches(target,row),false);
 payload.selectionPolicy='preserve_native';row.native.mappingDishCount=1;
 assert.equal(driver.quantityMatches(target,row),false);row.native.mappingDishCount=0;
 payload.targets.push({kind:'item',source:{groupIds:['g']}});
 assert.equal(driver.quantityMatches(target,row),false);payload.targets.pop();
 payload.targets.push({kind:'option',targetId:'o',parentId:'g'});
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
