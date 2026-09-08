import assert from "node:assert/strict";
import test from "node:test";
import { validateUberAvailability, type AuditTarget } from "./inventory-authority-policy.ts";
const targets:AuditTarget[]=[{kind:'item',targetId:'a',brandId:'brand',label:'商品',aliases:[],knownExternalIds:['uber-a']},
  {kind:'option',targetId:'b',brandId:'brand',label:'配料',aliases:[],knownExternalIds:['uber-b']}];
const rows=[{kind:'item',targetId:'a',found:true,isAvailable:true,status:'available'},
  {kind:'option',targetId:'b',found:true,isAvailable:false,status:'sold_out'}];
test('fresh Uber states preserve both availability directions',()=>{
  assert.deepEqual(validateUberAvailability(targets,{targetCount:2,items:rows}).map(t=>t.isAvailable),[true,false]);
});
test('partial reads do not produce a write plan',()=>{
  assert.throws(()=>validateUberAvailability(targets,{targetCount:2,items:rows.slice(0,1)}),/配料/);
});
test('duplicates, foreign IDs, missing flags and inconsistent states are rejected',()=>{
  for(const items of [[rows[0],rows[0]],[rows[0],{...rows[1],targetId:'other'}],
    [rows[0],{...rows[1],isAvailable:undefined}],[rows[0],{...rows[1],status:'available'}],
    [rows[0],{...rows[1],found:false}]]) assert.throws(()=>validateUberAvailability(targets,{targetCount:2,items}));
});
test('empty or wrong-count snapshots cannot become successful synchronization',()=>{
  assert.throws(()=>validateUberAvailability([],{targetCount:0,items:[]}));
  assert.throws(()=>validateUberAvailability(targets,{targetCount:1,items:rows}));
});
