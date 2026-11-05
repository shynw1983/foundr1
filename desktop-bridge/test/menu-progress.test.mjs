import test from 'node:test';
import assert from 'node:assert/strict';
import {createMenuProgress,menuRequestAction} from '../src/menu-progress.mjs';
test('throttles telemetry, bounds history and never repeats durable operations',async()=>{
  let now=10000;const rows=[];const p=createMenuProgress(async row=>rows.push(structuredClone(row)),()=>now);
  await p.stage({phase:'content',sourceKey:'a',targetName:'Corn',completed:0,total:2});
  await p.stage({phase:'creating',authorityOperation:{sourceKey:'a',status:'creating'}});
  assert.equal(rows.length,2);assert.equal(rows[1].targetName,'Corn');
  for(let i=0;i<20;i++)await p.request({action:'read_options',state:'received',token:'secret',path:'secret'});
  assert.equal(rows.length,2);now+=5000;
  await p.request({action:'read_menu',state:'waiting'});
  assert.equal(rows.at(-1).requestsCompleted,20);assert.equal(rows.at(-1).recent.length,1);
  assert.equal(rows.at(-1).recent[0].occurrences,20);
  assert.equal(rows.at(-1).authorityOperation,undefined);assert.ok(!JSON.stringify(rows).includes('secret'));
  await p.stage({phase:'relationships',completed:0,total:1});
  assert.equal(rows.at(-1).targetName,undefined);
});
test('durable acknowledgements fail closed and bypass throttling',async()=>{
 const p=createMenuProgress(async()=>{throw Error('offline');});
 await assert.rejects(()=>p.stage({phase:'creating',authorityOperation:{status:'creating'}}),/offline/);
});
test('safe action labels contain no merchant paths or IDs',()=>{
 assert.equal(menuRequestAction('/merchant-admin/api/option-group/secret','GET'),'read_options');
 assert.equal(menuRequestAction('/api/secret','POST'),'save');
 assert.equal(menuRequestAction('/api/v1/merchant/web/stores/1/all-options?fetchDish=true','GET'),'read_options');
 assert.equal(menuRequestAction('/api/v1/merchant/web/stores/1/dishes/4/detail','GET'),'read_item');
 assert.equal(menuRequestAction('/merchant-admin/api/v1/product/chain/1/item/0001','GET'),'read_item');
 assert.equal(menuRequestAction('/merchant-admin/api/v1/product/chain/1/category/0001/menu-pattern-list','GET'),'read_category');
 assert.equal(menuRequestAction('/merchant-admin/api/v1/stock/stockout/target-list','POST'),'read_availability');
 assert.equal(menuRequestAction('/merchant-admin/api/v1/product/search/menu-pattern','POST'),'read_menu');
});

test('actual requests flush exact target context while logical target scans are throttled',async()=>{
 let now=10000;const rows=[];const p=createMenuProgress(async row=>rows.push(structuredClone(row)),()=>now);
 await p.stage({phase:'relationships',completed:0,total:61});
 await p.request({action:'read_item',state:'waiting',context:{sourceKey:'item:a',targetName:'Corn',targetKind:'item',parentName:'Meals',token:'secret'}});
 assert.equal(rows.length,2);assert.equal(rows.at(-1).targetName,'Corn');
 await p.request({action:'read_item',state:'received',context:{sourceKey:'item:a',targetName:'Corn',targetKind:'item',parentName:'Meals'}});
 await p.request({action:'read_item',state:'waiting',context:{sourceKey:'item:b',targetName:'Beef',targetKind:'item',parentName:'Meals'}});
 assert.equal(rows.length,3);assert.equal(rows.at(-1).completed,0);
 assert.deepEqual(rows.at(-1).recent[0],{at:10000,phase:'relationships',action:'read_item',sourceKey:'item:a',targetName:'Corn',targetKind:'item',parentName:'Meals',state:'received'});
 await p.request({action:'read_options',state:'waiting',context:{}});
 assert.equal(rows.at(-1).targetName,undefined);assert.equal(rows.at(-1).sourceKey,undefined);
 assert.equal(rows.at(-1).targetKind,undefined);assert.equal(rows.at(-1).parentName,undefined);
 assert.ok(!JSON.stringify(rows).includes('secret'));
 await p.stage({phase:'relationships',sourceKey:'option:g:a',targetName:'Corn',targetKind:'option',parentName:'Extras'});
  assert.equal(rows.at(-1).targetKind,undefined);
  await p.request({action:'save',state:'waiting',context:{sourceKey:'option:g:a',targetName:'Corn',targetKind:'option',parentName:'Extras'}});
  assert.equal(rows.at(-1).targetKind,'option');assert.equal(rows.at(-1).action,'save');
});

test('history keeps different kinds and parents distinct and stays bounded',async()=>{
 let now=10000;const rows=[];const p=createMenuProgress(async row=>rows.push(row),()=>now);
 await p.stage({phase:'verifying'});
 for(let i=0;i<12;i++)await p.request({action:'read_item',state:'received',context:{targetName:'Same name',targetKind:i%2?'item':'option',parentName:`Group ${i}`}});
 assert.equal(rows.at(-1).recent.length,10);assert.equal(rows.at(-1).requestsCompleted,12);
 assert.equal(rows.at(-1).recent[0].parentName,'Group 11');
});

test('thousands of unchanged logical targets do not await one network ACK each; completion and receipts still flush',async()=>{
 let now=10000;const rows=[];const p=createMenuProgress(async row=>rows.push(structuredClone(row)),()=>now);
 await p.stage({phase:'verifying',completed:0,total:1000});
 for(let index=0;index<1000;index++)await p.stage({phase:'verifying',sourceKey:`item:${index}`,targetName:`Item ${index}`,completed:index,total:1000});
 assert.equal(rows.length,1);
 await p.stage({phase:'verifying',completed:1000,total:1000});
 assert.equal(rows.length,2);assert.equal(rows.at(-1).completed,1000);
 await p.stage({phase:'content',sourceKey:'option:new',authorityOperation:{sourceKey:'option:new',status:'identified'}});
 assert.equal(rows.length,3);assert.equal(rows.at(-1).authorityOperation.status,'identified');
 await p.request({action:'read_menu',state:'waiting',context:{}});
 assert.equal(rows.at(-1).authorityOperation,undefined);
 now+=5000;
 await p.stage({phase:'content',sourceKey:'item:later',targetName:'Later'});
 assert.equal(rows.at(-1).targetName,'Later');
});

test('successful save responses are counted separately from read-only POST queries and unknown write results',async()=>{
 let now=10000;const rows=[];const p=createMenuProgress(async row=>rows.push(structuredClone(row)),()=>now);
 await p.stage({phase:'content',telemetryVersion:2});
 for(const [path,method] of [['/merchant-admin/api/v1/stock/stockout/target-list','POST'],['/merchant-admin/api/v1/product/search/menu-pattern','POST'],['/api/options','GET']]) {
  await p.request({action:menuRequestAction(path,method),state:'received',context:{}});
 }
 await p.request({action:'save',state:'waiting',context:{sourceKey:'option:a',targetName:'Corn'}});
 assert.equal(rows.at(-1).writeRequestsCompleted,0);
 await p.request({action:'save',state:'received',context:{sourceKey:'option:a',targetName:'Corn'}});
 now+=5000;await p.stage({phase:'verifying'});
 assert.equal(rows.at(-1).requestsCompleted,4);
 assert.equal(rows.at(-1).readRequestsCompleted,3);
 assert.equal(rows.at(-1).writeRequestsCompleted,1);
});
