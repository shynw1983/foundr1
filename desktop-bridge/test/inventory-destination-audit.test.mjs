import test from 'node:test';import assert from 'node:assert/strict';
import {auditDestination} from '../src/inventory-destination-audit.mjs';
test('read-only audit handles mixed kinds and rejects mixed occurrence states',async()=>{
 const targets=[{kind:'item',targetId:'1',label:'a',knownExternalIds:['1']},{kind:'option',targetId:'2',label:'b',knownExternalIds:['2']}];
 const calls=[];const adapter={async locateTargets(rows){calls.push(rows);return rows.map(r=>({...r,matches:[{rowMatches:r.kind==='item'?[{hidden:true}]:[{hidden:false},{hidden:true}]}]}));}};
 const result=await auditDestination(adapter,{targets},'rocket_now');assert.equal(calls.length,2);assert.equal(result.items[0].isAvailable,false);assert.equal(result.items[1].found,false);assert.equal(result.items[1].isAvailable,null);
 await assert.rejects(auditDestination(adapter,{targets:[{...targets[0],knownExternalIds:[]}]},'rocket_now'));
});
