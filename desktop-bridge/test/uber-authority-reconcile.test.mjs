import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileAuthorityChildren} from '../src/uber-authority-reconcile.mjs';
const target={kind:'option',sourceKey:'o',targetId:'o',parentId:'g',name:'【NEW】チーズ(芝士)',price:227,source:{name:'【NEW】チーズ｜芝士'},mappings:[]};
const payload={platformKey:'rocket_now',merchantId:'1',targets:[{kind:'option_group',targetId:'g',mappings:[{externalId:'7'}]},target]};
const row={kind:'option',id:'8',name:'チーズ',price:227,parentIds:['7']};
test('reconciliation needs matching name, exact price and an ID-verified parent',()=>{
 assert.equal(reconcileAuthorityChildren(payload,[row]).length,1);
 for(const patch of [{price:226},{parentIds:['9']},{name:'牛肉'}])assert.equal(reconcileAuthorityChildren(payload,[{...row,...patch}]).length,0);
});
test('ambiguous candidates, quarantined targets and previously owned IDs are never adopted',()=>{
 assert.equal(reconcileAuthorityChildren(payload,[row,{...row,id:'9'}]).length,0);
 assert.equal(reconcileAuthorityChildren({...payload,targets:[...payload.targets,{...target,targetId:'o2',sourceKey:'o2'}]},[row]).length,0);
 assert.equal(reconcileAuthorityChildren({...payload,targets:[payload.targets[0],{...target,quarantined:true}]},[row]).length,0);
 assert.equal(reconcileAuthorityChildren({...payload,targets:[...payload.targets,{...target,targetId:'old',mappings:[{externalId:'8'}]}]},[row]).length,0);
});
