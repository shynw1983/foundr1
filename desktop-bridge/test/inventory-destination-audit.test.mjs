import test from 'node:test';
import assert from 'node:assert/strict';
import {auditDestination} from '../src/inventory-destination-audit.mjs';

const target=(kind,ids)=>({kind,targetId:kind,label:kind,knownExternalIds:ids});
const adapterFor=(rows,overrides={})=>({async locateTargets(targets){return targets.map(t=>({...t,matchBasis:'external_id',...overrides,matches:[{rowMatches:rows[t.kind]}]}));}});

test('read-only audit handles mixed kinds and rejects mixed occurrence states',async()=>{
 const targets=[target('item',['1']),target('option',['sub_checkbox_2_20','sub_checkbox_2_21'])];
 const calls=[];const located=adapterFor({item:[{checkboxId:'1',hidden:false,unavailable:true}],option:[{checkboxId:'sub_checkbox_2_20',unavailable:false},{checkboxId:'sub_checkbox_2_21',unavailable:true}]});
 const adapter={async locateTargets(rows){calls.push(rows);return located.locateTargets(rows);}};
 const result=await auditDestination(adapter,{targets},'rocket_now');
 assert.equal(calls.length,2);assert.equal(result.items[0].isAvailable,false);assert.equal(result.items[1].found,false);assert.equal(result.items[1].isAvailable,null);
 assert.deepEqual(result.items[0].nativeObservations,[{externalId:'1',physicalId:'1',found:true,isAvailable:false,matchBasis:'external_id'}]);
 assert.deepEqual(result.items[1].nativeObservations,[]);
 assert.ok(Number.isFinite(Date.parse(result.capturedAt)));
 await assert.rejects(auditDestination(adapter,{targets:[{...targets[0],knownExternalIds:[]}]},'rocket_now'));
});

test('Rocket records actual relocated checkbox identities, never echoes old parent IDs',async()=>{
 const targets=[target('option',['sub_checkbox_2_20, sub_checkbox_2_21'])];
 const adapter=adapterFor({option:[{checkboxId:'sub_checkbox_9_20',unavailable:false},{checkboxId:'sub_checkbox_9_21',unavailable:false}]});
 const [row]=(await auditDestination(adapter,{targets},'rocket_now')).items;
 assert.equal(row.found,true);
 assert.deepEqual(row.externalIds,['sub_checkbox_9_20','sub_checkbox_9_21']);
 assert.deepEqual(row.nativeObservations.map(n=>[n.externalId,n.physicalId,n.isAvailable]),[['sub_checkbox_9_20','20',true],['sub_checkbox_9_21','21',true]]);
 assert.equal(JSON.stringify(row).includes('sub_checkbox_2_'),false);
});

test('stable logical match alone cannot prove missing, foreign, duplicate or malformed native rows',async()=>{
 const targets=[target('option',['sub_checkbox_2_20','sub_checkbox_2_21'])];
 for(const rows of [
  [{checkboxId:'sub_checkbox_2_20',unavailable:false}],
  [{checkboxId:'sub_checkbox_2_20',unavailable:false},{checkboxId:'sub_checkbox_2_22',unavailable:false}],
  [{checkboxId:'sub_checkbox_2_20',unavailable:false},{checkboxId:'sub_checkbox_2_20',unavailable:false}],
  [{unavailable:false},{checkboxId:'sub_checkbox_2_21',unavailable:false}],
  [{checkboxId:'not-native',unavailable:false},{checkboxId:'sub_checkbox_2_21',unavailable:false}],
  [{checkboxId:'sub_checkbox_2_20',unavailable:'false'},{checkboxId:'sub_checkbox_2_21',unavailable:false}]
 ]) {
  const [row]=(await auditDestination(adapterFor({option:rows}),{targets},'rocket_now')).items;
  assert.equal(row.found,false);assert.equal(row.isAvailable,null);assert.deepEqual(row.externalIds,[]);assert.deepEqual(row.nativeObservations,[]);
 }
});

test('name/alias, wrong-kind or wrong logical label matches never become stable-ID evidence',async()=>{
 const targets=[target('option',['sub_checkbox_2_20'])],rows={option:[{checkboxId:'sub_checkbox_2_20',unavailable:false}]};
 for(const override of [{matchBasis:'alias'},{matchBasis:'exact_name'},{matchBasis:'fallback_name'},{kind:'item'},{label:'other'}]) {
  const [row]=(await auditDestination(adapterFor(rows,override),{targets},'rocket_now')).items;
  assert.equal(row.found,false);assert.deepEqual(row.nativeObservations,[]);
 }
});

test('Demae observes real row IDs with exact full coverage without inventing a physical code',async()=>{
 const targets=[target('option',['itemList_41064900000251true','itemList_41064900000252true'])];
 const rows=targets[0].knownExternalIds.map(rowId=>({rowId,unavailable:false}));
 const [row]=(await auditDestination(adapterFor({option:rows}),{targets},'demae_can')).items;
 assert.equal(row.found,true);assert.deepEqual(row.externalIds,rows.map(r=>r.rowId));
 assert.equal(row.nativeObservations.every(n=>n.matchBasis==='external_id'&&!Object.hasOwn(n,'physicalId')),true);
 for(const observed of [rows.slice(0,1),[rows[0],{...rows[1],rowId:'itemList_9999900000252true'}],[{...rows[0],rowId:'itemList_41064900000251false'},rows[1]]]) {
  const [unknown]=(await auditDestination(adapterFor({option:observed}),{targets},'demae_can')).items;
  assert.equal(unknown.found,false);assert.deepEqual(unknown.nativeObservations,[]);
 }
});
