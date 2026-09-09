import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInventoryComparison} from './inventory-comparison.ts';
const target={kind:'option',targetId:'1',label:'干腐竹',isAvailable:false,wasAvailable:false};
const details={comparisonVersion:1,comparisonPlatforms:['rocket_now'],preview:[target],previewAt:new Date().toISOString()};
const command={platform:'rocket_now',status:'succeeded',payload:{comparisonAudit:true,targets:[target]},result:{items:[{kind:'option',targetId:'1',found:true,isAvailable:true,status:'available'}]}};
test('Uber equals OS but destination differs: show destination change',()=>{
 const result=buildInventoryComparison(details,[command]);assert.equal(result.ready,true);assert.deepEqual(result.rows[0].changes,['rocket_now']);assert.equal(result.counts.foundr1,0);
});
test('failed, missing, duplicate, and pending reads never become equal',()=>{
 for(const c of [{...command,status:'failed'},{...command,payload:{comparisonAudit:true,targets:[]}},{...command,result:{items:[...command.result.items,...command.result.items]}},{...command,status:'pending'}]) {
  const result=buildInventoryComparison(details,[c]);assert.equal(result.ready,false);assert.equal(result.rows[0].cells.rocket_now.state,'unknown');
 }
});
test('quarantine is explicit and cannot be unhidden',()=>{
 const result=buildInventoryComparison({...details,comparisonExclusions:[{platform:'rocket_now',kind:'option',targetId:'1'}]},[]);
 assert.equal(result.rows[0].cells.rocket_now.state,'excluded');assert.deepEqual(result.rows[0].changes,[]);
});
test('only freshly verified Demae drafts are nonblocking and never a stock difference',()=>{
 const draft={...command,platform:'demae_can',result:{items:[{kind:'option',targetId:'1',found:true,isAvailable:null,status:'staged',stagingVerified:true}]}};
 const d={...details,comparisonPlatforms:['demae_can']};
 const result=buildInventoryComparison(d,[draft]);
 assert.equal(result.ready,true);assert.equal(result.unknown,0);assert.equal(result.rows[0].cells.demae_can.state,'staged');assert.deepEqual(result.rows[0].changes,[]);
 for(const bad of [{...draft,status:'failed'},{...draft,result:{items:[{...draft.result.items[0],stagingVerified:false}]}},{...draft,result:{items:[...draft.result.items,...draft.result.items]}}])assert.equal(buildInventoryComparison(d,[bad]).ready,false);
});
test('only Uber-available verified release plans become new-product changes',()=>{
 const draft={...command,platform:'demae_can',result:{items:[{kind:'option',targetId:'1',found:true,isAvailable:null,status:'staged',stagingVerified:true,releasePlan:{kind:'option'}}]}};
 for(const isAvailable of [true,false]) {
  const result=buildInventoryComparison({...details,comparisonPlatforms:['demae_can'],preview:[{...target,isAvailable,wasAvailable:isAvailable}]},[draft]);
  assert.equal(result.counts.demae_can,isAvailable?1:0);assert.equal(result.ready,true);
 }
});
