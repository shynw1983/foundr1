import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveUberOptionPlacement} from './uber-option-placement.ts';
import {buildUberPublication,type UberPublicationNode} from './uber-menu-publication.ts';
import {projectInventoryTargetsForPlatform} from './inventory-platform-targets.ts';
import {resolveLinkedTargetKeys} from './menu-availability-link-graph.ts';
const group=(id:string,name:string):UberPublicationNode=>({sourceKey:`option_group:${id}`,kind:'option_group',targetId:id,parentId:null,name,displayNames:{},price:null,uberPrice:null,description:'',imageUrl:'',sortOrder:0,payload:{}});
const option=(id:string,parent:string,uber='u'):UberPublicationNode=>({...group(id,'竹笋'),kind:'option',sourceKey:`option:${parent}:${uber}`,parentId:parent,price:300,uberPrice:376,payload:{id:uber,groupId:parent}});
const nodes=[group('normal','標準'),group('new','新登場トッピング'),option('n','normal'),option('p','new')];
test('publication suppresses only same-ID promotional membership on both platforms without mutating OS',()=>{
 for(const platform of ['rocket_now','demae_can'] as const) {
  const original=structuredClone(nodes);
  const payload=buildUberPublication({sourceId:'s',storeId:'store',brandId:'b',revision:1,platform,merchantId:'1',nodes,mappings:[]});
  assert.deepEqual(payload.targets.filter(t=>t.kind==='option').map(t=>t.targetId),['n']);
  assert.deepEqual(nodes,original);assert.equal(payload.newItemsHidden,true);
 }
});
test('promotion-only and same-name different-ID products are not excluded or stock-linked',()=>{
 assert.deepEqual(resolveUberOptionPlacement(nodes.filter(n=>n.targetId!=='n'),[]),[]);
 assert.deepEqual(resolveUberOptionPlacement([...nodes.slice(0,3),option('p','new','different')],[]),[]);
 assert.deepEqual(resolveUberOptionPlacement(nodes.map(n=>n.targetId==='n'?{...n,archived:true}:n),[]),[]);
});
test('multiple regular groups need exactly one established main membership',()=>{
 const extended=[...nodes,group('other','麺'),option('o','other')];
 assert.throws(()=>resolveUberOptionPlacement(extended,[]),/主所属/);
 assert.deepEqual(resolveUberOptionPlacement(extended,[{kind:'option',targetId:'n',externalId:'1'}]).map(a=>a.targetId),['p','o']);
 assert.throws(()=>resolveUberOptionPlacement(extended,[{kind:'option',targetId:'n',externalId:'1'},{kind:'option',targetId:'o',externalId:'2'}]),/主所属/);
});
test('existing promotional physical objects cannot be silently detached or retired',()=>{
 assert.throws(()=>resolveUberOptionPlacement(nodes,[{kind:'option',targetId:'p',externalId:'live'}]),/既存の公開先/);
});
test('stock peers use the same resolver and promotional targets do not create downstream commands',()=>{
 const [alias]=resolveUberOptionPlacement(nodes,[]);
 const links=[{sourceKind:'option' as const,sourceId:alias.targetId,dependentKind:'option' as const,dependentId:alias.primaryTargetId,isBidirectional:true}];
 assert.ok(resolveLinkedTargetKeys(links,['option:p']).includes('option:n'));
 assert.ok(resolveLinkedTargetKeys(links,['option:n']).includes('option:p'));
 const targets=['n','p'].map(id=>({kind:'option' as const,targetId:id,menuOptionId:id,brandId:'b',groupKey:'g',optionKey:id,inventoryKey:id,label:'竹笋',aliases:[],isAvailable:false}));
 for(const platform of ['rocket_now','demae_can'] as const) {
  const mappings=new Map([[`${platform}:option:p`,[]],[`${platform}:option:n`,['native']]]);
  assert.deepEqual(projectInventoryTargetsForPlatform(platform,targets,mappings).map(t=>t.targetId),['n']);
  assert.equal(projectInventoryTargetsForPlatform('uber_eats',targets,mappings).length,2);
 }
});
