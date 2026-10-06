import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUberPublication,verifyUberPublication,type UberPublicationNode,type UberMenuNameAdaptation} from './uber-menu-publication.ts';
import type {UberCreationHoldRelease} from '../desktop-bridge/src/uber-authority-hold-release.mjs';
const node:UberPublicationNode={sourceKey:'item:a',kind:'item',targetId:'a',parentId:'c',name:'湯',displayNames:{zh:'汤'},price:180,uberPrice:227,description:'Soup',imageUrl:'',sortOrder:0,payload:{}};
const input={sourceId:'s',storeId:'store',brandId:'b',revision:1,merchantId:'123',nodes:[node],mappings:[]};
const release=(platform:'rocket_now'|'demae_can',source:UberPublicationNode,externalId:string,externalParentId=''):UberCreationHoldRelease=>({
  sourceId:input.sourceId,storeId:input.storeId,platform,merchantId:input.merchantId,sourceKey:source.sourceKey,kind:source.kind as 'item'|'option',targetId:source.targetId,
  externalId,externalParentId,inventoryCommandId:'11111111-1111-4111-8111-111111111111',auditCommandId:'22222222-2222-4222-8222-222222222222',
  completedAt:'2026-10-05T00:00:00.000Z',capturedAt:'2026-10-05T00:01:00.000Z',verified:true,isAvailable:true,validation:'persisted-native-audit-v1'
});
test('Demae hidden identity survives repeated group moves without relaxing isolation',()=>{
 const original={...node,kind:'option',sourceKey:'option:first:a'};
 const before=buildUberPublication({...input,platform:'demae_can',nodes:[original]}).targets[0];
 const mappings=[{kind:'option',targetId:'a',externalId:'remote-a',externalParentId:'stage:0010'}];
 const receipt={sourceKey:original.sourceKey,status:'identified',externalId:'remote-a',externalParentId:'stage:0010'};
 for(const group of ['second','third']) {
  const args={...input,platform:'demae_can' as const,nodes:[{...original,sourceKey:`option:${group}:a`}],mappings,creationIdentities:[receipt]};
  const after=buildUberPublication(args).targets[0];
  assert.equal(after.marker,before.marker);
  assert.equal(after.sourceKey,`option:${group}:a`);
  assert.equal(buildUberPublication(args).newItemsHidden,true);
  for(const patch of [{status:'creating'},{externalId:'other'},{externalParentId:'stage:0020'},{sourceKey:'option:first:other'}])
   assert.throws(()=>buildUberPublication({...args,creationIdentities:[{...receipt,...patch}]}),/identity_missing/);
  assert.throws(()=>buildUberPublication({...args,creationIdentities:[receipt,{...receipt,sourceKey:'option:other:a'}]}),/identity_ambiguous/);
 }
});
test('unlinked Uber products are retired downstream without losing their stable identity',()=>{
 for(const platform of ['rocket_now','demae_can'] as const) {
  const publication=buildUberPublication({...input,platform,nodes:[{...node,parentId:null,payload:{attached:false}}]});
  assert.equal(publication.targets[0].archived,true);assert.equal(publication.targets[0].targetId,node.targetId);assert.equal(publication.targets[0].price,null);
  assert.equal(buildUberPublication({...input,platform,nodes:[{...node,payload:{attached:true}}]}).targets[0].archived,false);
 }
});
test('both downstream platforms require explicit approval to preserve native quantities',()=>{
 for(const platform of ['rocket_now','demae_can'] as const) {
  assert.equal(buildUberPublication({...input,platform}).selectionPolicy,'strict');
  assert.equal(buildUberPublication({...input,platform,selectionPolicy:'preserve_native'}).selectionPolicy,'preserve_native');
 }
});
test('Rocket replaces the rejected full-width ampersand without losing source words',()=>{
 assert.equal(buildUberPublication({...input,platform:'rocket_now',nodes:[{...node,kind:'category',name:'ミニ麻辣湯＆旬のフルーツセット',displayNames:{}}]}).targets[0].name,'ミニ麻辣湯・旬のフルーツセット');
});
test('Demae group names keep the complete Japanese source within the native form limit',()=>{
 const group={...node,kind:'option_group',name:'追加調味料',displayNames:{zh:'追加调味料',en:'A very long optional English translation that exceeds the native group name limit'},price:null,uberPrice:null};
 const result=buildUberPublication({...input,platform:'demae_can',nodes:[group]});
 assert.equal(result.targets[0].name,'追加調味料｜追加调味料');
 assert.equal(buildUberPublication({...input,platform:'demae_can',nodes:[{...group,name:'あ'.repeat(51)}]}).targets[0].name,'あ'.repeat(51));
});
test('Demae long option translations retain complete Japanese and Chinese within 255 characters',()=>{
 const option={...node,kind:'option',name:'おまかせ野菜3種盛り',displayNames:{zh:'蔬菜随机三种拼盘',en:'Very long '.repeat(30)}};
 assert.equal(buildUberPublication({...input,platform:'demae_can',nodes:[option]}).targets[0].name,'おまかせ野菜3種盛り｜蔬菜随机三种拼盘');
});
test('Demae descriptions preserve words and paragraphs while adapting prohibited typography',()=>{
 const description="Hot (spicy)!\n───\n\n\n１個  ﾁｰｽﾞ🔥";
 assert.equal(buildUberPublication({...input,platform:'demae_can',nodes:[{...node,description}]}).targets[0].description,"Hot （spicy）！\n---\n\n1個 チーズ");
 assert.equal(buildUberPublication({...input,platform:'rocket_now',nodes:[{...node,description}]}).targets[0].description,description);
});
test('OS image ingestion is not turned into outbound image publishing',()=>{
 const source={...node,imageUrl:'https://uber.example/photo.jpg',payload:{id:'a',imageUrl:'photo',taxInfo:{tax:8},nested:[{thumbnailUrl:'image',id:'b'}]}};
 for(const platform of ['rocket_now','demae_can'] as const) {
  const publication=buildUberPublication({...input,platform,nodes:[source]});
  assert.equal(publication.imagePolicy,'read_only');
  assert.equal('imageUrl' in publication.targets[0],false);
  assert.deepEqual(publication.targets[0].source,{id:'a',taxInfo:{tax:8},nested:[{id:'b'}]});
 }
 assert.equal(source.payload.imageUrl,'photo');assert.match(source.imageUrl,/photo.jpg/);
});
test('publications carry source-specific exact prices and a stable hidden-create identity',()=>{
 const rocket=buildUberPublication({...input,platform:'rocket_now'});
 const demae=buildUberPublication({...input,platform:'demae_can'});
 assert.equal(rocket.targets[0].price,227);assert.equal(demae.targets[0].price,227);
 assert.equal(rocket.targets[0].name,'湯(汤)');assert.equal(rocket.newItemsHidden,true);
 assert.equal(rocket.targets[0].marker,buildUberPublication({...input,revision:2,platform:'rocket_now'}).targets[0].marker);
});
test('success without actual observations, wrong prices, unverified structure or exposed drafts is rejected',()=>{
 const payload=buildUberPublication({...input,platform:'rocket_now'});
 const observation={sourceKey:'item:a',externalId:'123',name:payload.targets[0].name,price:227,created:true,hidden:true,structureVerified:true};
  assert.deepEqual(verifyUberPublication(payload,{observations:[observation]}),{verified:1,observed:1});
  assert.throws(()=>verifyUberPublication({...payload,pendingRemovals:[{sourceKey:'option:g:missing'}]},{observations:[observation]}),/pending_removal_not_applied/);
 assert.throws(()=>verifyUberPublication(payload,{outcome:'applied'}),/observations_missing/);
 for(const patch of [{price:180},{name:'old'},{structureVerified:false},{hidden:false}]) assert.throws(()=>verifyUberPublication(payload,{observations:[{...observation,...patch}]}));
});
test('every mapped occurrence must be verified, and retired items must remain hidden',()=>{
 const payload=buildUberPublication({...input,platform:'rocket_now',mappings:[{kind:'item',targetId:'a',externalId:'1',externalParentId:''},{kind:'item',targetId:'a',externalId:'2',externalParentId:''}]});
 const row={sourceKey:'item:a',externalId:'1',name:payload.targets[0].name,price:227,structureVerified:true};
 assert.throws(()=>verifyUberPublication(payload,{observations:[row]}),/occurrence_missing/);
 assert.equal(verifyUberPublication(payload,{observations:[row,{...row,externalId:'2'}]}).observed,2);
 const retired=buildUberPublication({...input,platform:'rocket_now',nodes:[{...node,archived:true}]});
 assert.throws(()=>verifyUberPublication(retired,{observations:[{sourceKey:'item:a',hidden:false}]}),/not_retired/);
});

test('the worker cannot conceal a newly created exposed item by omitting its created flag',()=>{
 const payload=buildUberPublication({...input,platform:'demae_can'});
 assert.throws(()=>verifyUberPublication(payload,{observations:[{sourceKey:node.sourceKey,externalId:'new',name:payload.targets[0].name,price:227,structureVerified:true,hidden:false}]}),/draft_exposed/);
});
test('user-authorized quarantine is acknowledged separately, never counted as verified publication',()=>{
 const payload=buildUberPublication({...input,platform:'demae_can',quarantinedSourceKeys:[node.sourceKey]});
 assert.deepEqual(verifyUberPublication(payload,{observations:[{sourceKey:node.sourceKey,quarantined:true}]}),{verified:0,observed:1,quarantined:1});
 assert.throws(()=>verifyUberPublication(payload,{observations:[{sourceKey:node.sourceKey,quarantined:true,created:true}]}),/quarantine_violated/);
});
test('explicit informational-card exclusions do not drop other zero-price products or mutate OS',()=>{
 const nodes=[{...node,uberPrice:0,price:0},{...node,sourceKey:'item:other',targetId:'other',uberPrice:0,price:0}];
 for(const platform of ['rocket_now','demae_can'] as const) {
  const payload=buildUberPublication({...input,platform,nodes,excludedSourceKeys:[node.sourceKey]});
  assert.deepEqual(payload.targets.map(row=>row.sourceKey),['item:other']);
  assert.equal(payload.targets[0].price,0);
 }
 assert.equal(nodes.length,2);
});

test('exact persisted inventory release survives revision changes without releasing another zero-price option',()=>{
  const first:UberPublicationNode={...node,kind:'option',sourceKey:'option:g:confirmation',targetId:'confirmation',parentId:'g',price:0,uberPrice:0,name:'もちろん!',displayNames:{}};
  const second={...first,sourceKey:'option:g:other',targetId:'other',name:'他の無料選択肢'};
  const nodes=[first,second],original=structuredClone(nodes);
  for(const platform of ['rocket_now','demae_can'] as const)for(const revision of [38,39]) {
    const proof=release(platform,first,'native-confirmation','parent');
    const payload=buildUberPublication({...input,revision,platform,nodes,mappings:[
      {kind:'option',targetId:first.targetId,externalId:'native-confirmation',externalParentId:'parent'},
      {kind:'option',targetId:second.targetId,externalId:'native-other',externalParentId:'parent'}
    ],creationHoldReleases:[proof]});
    assert.equal(payload.targets[0].mappings[0].created,true);
    assert.equal(payload.targets[0].mappings[0].creationHoldRelease,proof);
    assert.equal(payload.targets[1].mappings[0].creationHoldRelease,undefined);
    assert.equal(payload.targets[1].mappings[0].created,undefined); // no blanket historical receipt reclassification
    const other=payload.targets[1].mappings[0] as Record<string,unknown>;other.created=true;
    const observations=payload.targets.map(target=>({sourceKey:target.sourceKey,externalId:target.mappings[0].externalId,name:target.name,price:target.price,hidden:false,structureVerified:true}));
    assert.throws(()=>verifyUberPublication(payload,{observations}),/draft_exposed:option:g:other/);
    assert.deepEqual(verifyUberPublication(payload,{observations:[observations[0],{...observations[1],hidden:true}]}),{verified:2,observed:2});
    // A later ordinary stockout is not undone or rejected by this policy.
    assert.equal(verifyUberPublication(payload,{observations:observations.map(row=>({...row,hidden:true}))}).verified,2);
    assert.equal(payload.newItemsHidden,true);assert.deepEqual(nodes,original);
  }
});

test('approval flags or stale release identities cannot bypass either occurrence or draft verification',()=>{
  const mappings=[{kind:'item',targetId:node.targetId,externalId:'native-item',externalParentId:'parent'}];
  const proof=release('rocket_now',node,'native-item','parent');
  for(const patch of [{validation:'approved-only'},{verified:false},{isAvailable:false},{externalId:'other'},{externalParentId:'other'},{sourceKey:'item:other'},{targetId:'other'},
    {platform:'demae_can'},{merchantId:'other'},{storeId:'other'},{sourceId:'other'},{kind:'option'},
    {auditCommandId:proof.inventoryCommandId},{capturedAt:'2026-10-04T00:00:00Z'},{capturedAt:new Date(Date.now()+6*60*1000).toISOString()}]) {
    const payload=buildUberPublication({...input,platform:'rocket_now',mappings,creationHoldReleases:[{...proof,...patch} as UberCreationHoldRelease]});
    assert.equal(payload.targets[0].mappings[0].creationHoldRelease,undefined);
    const mapping=payload.targets[0].mappings[0] as Record<string,unknown>;mapping.created=true;
    const observation={sourceKey:node.sourceKey,externalId:'native-item',name:payload.targets[0].name,price:227,structureVerified:true,hidden:false};
    assert.throws(()=>verifyUberPublication(payload,{observations:[observation]}),/draft_exposed/);
  }
  const payload=buildUberPublication({...input,platform:'rocket_now',mappings,creationHoldReleases:[proof]});
  const observation={sourceKey:node.sourceKey,externalId:'native-item',name:payload.targets[0].name,price:227,structureVerified:true,hidden:false};
  for(const patch of [{externalId:'different-native'},{name:'different name'},{price:1},{structureVerified:false}])assert.throws(()=>verifyUberPublication(payload,{observations:[{...observation,...patch}]}));
});

test('verified exact name adaptations are reused while unsafe or stale cache entries are ignored',()=>{
 const source:UberPublicationNode={...node,sourceKey:'option_group:minimum',targetId:'minimum',kind:'option_group',name:'お願い：商品合計1,600円〜で',displayNames:{},uberPrice:null,price:null};
 const baseline=buildUberPublication({...input,platform:'rocket_now',nodes:[source]});
 const projected=baseline.targets[0];
 const adaptation:UberMenuNameAdaptation={sourceKey:source.sourceKey,targetId:source.targetId,
  sourceName:source.name,inputName:projected.nameProjection,name:'お願い：商品合計1600円以上で',
  reason:'金額の下限を自然な表現で維持',model:'test-model',policyVersion:'contextual-name-v1',
  verified:true,attemptedNames:[projected.nameProjection],rejectionReason:'special characters',createdAt:'2026-10-05T00:00:00Z'};
 const publish=(saved:UberMenuNameAdaptation)=>buildUberPublication({...input,platform:'rocket_now',nodes:[source],nameAdaptations:{[source.sourceKey]:saved}});
 const accepted=publish(adaptation).targets[0];
 assert.equal(accepted.name,adaptation.name);
 assert.equal(accepted.nameAdaptation,adaptation);
 assert.equal(accepted.sourceName,source.name);
 assert.equal(accepted.nameProjection,projected.nameProjection);
 for(const patch of [{verified:false},{sourceName:'別の商品名'},{targetId:'another-target'},{sourceKey:'option_group:other'},{inputName:'前の公開名称'}]) {
  const ignored=publish({...adaptation,...patch}).targets[0];
  assert.equal(ignored.name,projected.nameProjection);
  assert.equal(ignored.nameAdaptation,undefined);
 }
 const renamed=buildUberPublication({...input,platform:'rocket_now',nodes:[{...source,name:'お願い：商品合計1,700円〜で'}],nameAdaptations:{[source.sourceKey]:adaptation}}).targets[0];
 assert.equal(renamed.name,renamed.nameProjection);assert.equal(renamed.nameAdaptation,undefined);
 const translationChanged=buildUberPublication({...input,platform:'rocket_now',nodes:[{...source,displayNames:{zh:'商品总额1600日元起'}}],nameAdaptations:{[source.sourceKey]:adaptation}}).targets[0];
 assert.equal(translationChanged.name,translationChanged.nameProjection);assert.equal(translationChanged.nameAdaptation,undefined);
});

test('AI name cache changes only the downstream name and retains the source graph, identities, prices and ordering',()=>{
 const category:UberPublicationNode={...node,sourceKey:'category:c',targetId:'c',kind:'category',parentId:null,name:'麺',displayNames:{},price:null,uberPrice:null,payload:{id:'c',itemIds:['a']}};
 const group:UberPublicationNode={...node,sourceKey:'option_group:g',targetId:'g',kind:'option_group',parentId:null,name:'麺の種類',displayNames:{},price:null,uberPrice:null,payload:{id:'g',optionIds:['o']}};
 const option:UberPublicationNode={...node,sourceKey:'option:g:o',targetId:'o',kind:'option',parentId:'g',name:'刀削麺50〜100g',displayNames:{zh:'刀削面'},sortOrder:20,payload:{id:'o',groupId:'g'}};
 const product:UberPublicationNode={...node,payload:{id:'a',groupIds:['g'],categoryIds:['c']}};
 const nodes=[category,group,option,product];
 const original=structuredClone(nodes);
 const before=buildUberPublication({...input,platform:'rocket_now',nodes});
 const projected=before.targets.find(target=>target.sourceKey===option.sourceKey)!;
 const saved:UberMenuNameAdaptation={sourceKey:option.sourceKey,targetId:option.targetId,sourceName:option.name,
  inputName:projected.nameProjection,name:'刀削麺50から100g(刀削面)',reason:'重量の範囲を維持',model:'test-model',policyVersion:'contextual-name-v1',
  verified:true,attemptedNames:[projected.nameProjection],rejectionReason:'special characters',createdAt:'2026-10-05T00:00:00Z'};
 const after=buildUberPublication({...input,platform:'rocket_now',nodes,nameAdaptations:{[option.sourceKey]:saved}});
 assert.deepEqual(nodes,original);
 assert.equal(after.targets.length,before.targets.length);
 for(const prior of before.targets) {
  const current=after.targets.find(target=>target.sourceKey===prior.sourceKey)!;
  assert.deepEqual({targetId:current.targetId,parentId:current.parentId,marker:current.marker,price:current.price,sortOrder:current.sortOrder,source:current.source},
   {targetId:prior.targetId,parentId:prior.parentId,marker:prior.marker,price:prior.price,sortOrder:prior.sortOrder,source:prior.source});
  assert.equal(current.name,prior.sourceKey===option.sourceKey?saved.name:prior.name);
 }
 const observations=after.targets.map(target=>({sourceKey:target.sourceKey,externalId:`native-${target.targetId}`,name:target.name,price:target.price,hidden:true,structureVerified:true}));
 assert.deepEqual(verifyUberPublication(after,{observations}),{verified:4,observed:4});
 const stale=observations.map(row=>row.sourceKey===option.sourceKey?{...row,name:projected.nameProjection}:row);
 assert.throws(()=>verifyUberPublication(after,{observations:stale}),/uber_publication_content_mismatch/);
});
