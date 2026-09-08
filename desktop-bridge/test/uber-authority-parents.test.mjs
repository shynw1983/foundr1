import test from 'node:test';
import assert from 'node:assert/strict';
import {planAuthorityParents,authorityPhysicalId} from '../src/uber-authority-parents.mjs';
const group=(id,name='same')=>({kind:'option_group',targetId:id,sourceKey:`group:${id}`,name,mappings:[]});
const option=(id,parentId)=>({kind:'option',targetId:`option:${id}`,parentId,mappings:[{externalId:`sub_checkbox_9_${id}`} ]});
test('parent adoption uses stable child membership, never translated labels',()=>{
 const payload={platformKey:'rocket_now',targets:[group('a'),group('b'),option(11,'a'),option(12,'b')]};
 const result=planAuthorityParents(payload,[{kind:'option_group',externalId:'9',name:'renamed（中文）',childIds:['11']}]);
 assert.equal(result.bindings[0].targetId,'a');assert.equal(result.issues[0].sourceKey,'group:b');
});
test('mixed, split and unknown members are explicitly planned instead of silently flattened',()=>{
 const payload={platformKey:'rocket_now',targets:[group('a'),group('b'),option(11,'a'),option(12,'b'),option(13,'a')]};
 const result=planAuthorityParents(payload,[{kind:'option_group',externalId:'7',childIds:['11','12']},{kind:'option_group',externalId:'8',childIds:['11','14']},{kind:'option_group',externalId:'9',childIds:['13']}]);
 assert.deepEqual(result.issues.map(row=>row.code).sort(),['mixed_parent','parent_unresolved','split_parent','unmapped_children'].sort());
});
test('Demae IDs retain leading zeros and require the configured chain and kind',()=>{
 assert.equal(authorityPhysicalId('demae_can','option','itemList_41064900000094true','410649'),'00000094');
 assert.throws(()=>authorityPhysicalId('demae_can','item','itemList_41064900000094true','410649'),/kind_mismatch/);
 assert.throws(()=>authorityPhysicalId('demae_can','option','itemList_99999900000094true','410649'),/chain_mismatch/);
});
