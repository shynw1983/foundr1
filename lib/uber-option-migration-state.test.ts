import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateUberOptionMigration} from './uber-option-migration-state.ts';

const key=createHash('sha256').update('source:option:g:o:10:2').digest('hex');
const payload={platformKey:'rocket_now',sourceId:'source',optionMigrationPolicy:'preserve_stock',targets:[
  {kind:'option_group',targetId:'group',mappings:[{externalId:'2'}]},
  {kind:'option',targetId:'item',sourceKey:'option:g:o',parentId:'group',name:'topping',price:227,mappings:[{externalId:'sub_checkbox_1_10'}]}
]};
const state={key,marker:`FS${key.slice(0,14)}`,phase:'reserved',sourceKey:'option:g:o',targetId:'item',fromId:'10',fromExternalId:'sub_checkbox_1_10',fromParentId:'1',toParentId:'2',name:'topping',price:227,displayStatus:'NOT_EXPOSE',newId:''};
test('migration state requires authorization and immutable scoped identity',()=>{
  validateUberOptionMigration(payload,state);
  for(const patch of [{key:'wrong'},{fromId:'99'},{toParentId:'3'},{price:999},{displayStatus:'SOLD_OUT_TODAY'},{fromExternalId:'sub_checkbox_1_99'}])
    assert.throws(()=>validateUberOptionMigration(payload,{...state,...patch}));
  assert.throws(()=>validateUberOptionMigration({...payload,optionMigrationPolicy:undefined},state));
});
test('migration phases cannot skip preparation, regress or replace a saved native ID',()=>{
  const received={...state,phase:'received',newId:'20'},prepared={...received,phase:'prepared'},complete={...prepared,phase:'complete'};
  validateUberOptionMigration(payload,received,state);validateUberOptionMigration(payload,prepared,received);validateUberOptionMigration(payload,complete,prepared);
  assert.throws(()=>validateUberOptionMigration(payload,complete,state));
  assert.throws(()=>validateUberOptionMigration(payload,state,received));
  assert.throws(()=>validateUberOptionMigration(payload,{...prepared,newId:'30'},received));
  assert.throws(()=>validateUberOptionMigration(payload,{...prepared,displayStatus:'ON_SALE'},received));
});
