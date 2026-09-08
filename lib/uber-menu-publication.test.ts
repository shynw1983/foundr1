import test from 'node:test';
import assert from 'node:assert/strict';
import {buildUberPublication,verifyUberPublication,type UberPublicationNode} from './uber-menu-publication.ts';
const node:UberPublicationNode={sourceKey:'item:a',kind:'item',targetId:'a',parentId:'c',name:'湯',displayNames:{zh:'汤'},price:180,uberPrice:227,description:'Soup',imageUrl:'',sortOrder:0,payload:{}};
const input={sourceId:'s',storeId:'store',brandId:'b',revision:1,merchantId:'123',nodes:[node],mappings:[]};
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
 assert.equal(rocket.targets[0].price,227);assert.equal(demae.targets[0].price,180);
 assert.equal(rocket.targets[0].name,'湯(汤)');assert.equal(rocket.newItemsHidden,true);
 assert.equal(rocket.targets[0].marker,buildUberPublication({...input,revision:2,platform:'rocket_now'}).targets[0].marker);
});
test('success without actual observations, wrong prices, unverified structure or exposed drafts is rejected',()=>{
 const payload=buildUberPublication({...input,platform:'rocket_now'});
 const observation={sourceKey:'item:a',externalId:'123',name:payload.targets[0].name,price:227,created:true,hidden:true,structureVerified:true};
 assert.deepEqual(verifyUberPublication(payload,{observations:[observation]}),{verified:1,observed:1});
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
 assert.throws(()=>verifyUberPublication(payload,{observations:[{sourceKey:node.sourceKey,externalId:'new',name:payload.targets[0].name,price:180,structureVerified:true,hidden:false}]}),/draft_exposed/);
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
