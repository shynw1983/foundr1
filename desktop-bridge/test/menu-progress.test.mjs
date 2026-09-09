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
  assert.equal(rows.at(-1).requestsCompleted,20);assert.equal(rows.at(-1).recent.length,10);
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
});
