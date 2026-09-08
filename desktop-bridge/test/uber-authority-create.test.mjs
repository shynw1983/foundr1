import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureUberAuthorityObject} from '../src/uber-authority-create.mjs';

test('quarantined objects never trigger discovery, creation or mapping updates',async()=>{
 const driver={findMarker:async()=>{throw Error('must not query');},createHidden:async()=>{throw Error('must not create');}};
 await assert.rejects(ensureUberAuthorityObject({sourceKey:'option:orphan',quarantined:true},{},driver,async()=>{throw Error('must not map');}),/object_quarantined/);
});

test('a journaled ID is independently recovered even when missing from the ordinary list',async()=>{
 let writes=0;const phases=[];
 const target={sourceKey:'option:a',marker:'FSa'};
 const driver={findMarker:async()=>[],findById:async id=>({externalId:id,marker:'FSa',hidden:true}),createHidden:async()=>writes++};
 const result=await ensureUberAuthorityObject(target,{authorityState:{'option:a':{status:'creating',externalId:'001'}}},driver,async p=>phases.push(p.phase));
 assert.equal(result[0].externalId,'001');assert.equal(writes,0);assert.deepEqual(phases,['identified']);
});
test('a saved receipt is not proof of hidden state or identity',async()=>{
 for(const record of [{externalId:'001',marker:'other',hidden:true},{externalId:'other',marker:'FSa',hidden:true},{externalId:'001',marker:'FSa',hidden:false}]) {
  await assert.rejects(ensureUberAuthorityObject({sourceKey:'option:a',marker:'FSa'},{authorityState:{'option:a':{status:'creating',externalId:'001'}}},{findMarker:async()=>[],findById:async()=>record},async()=>{}),/identity_mismatch|not_hidden/);
 }
});

test('a creation receipt is persisted before attempting marker discovery',async()=>{
 const events=[];
 await assert.rejects(()=>ensureUberAuthorityObject({sourceKey:'item:a',marker:'FSa'}, {}, {findMarker:async()=>[],createHidden:async()=>({externalId:'123'})},async p=>events.push(p)),/uncertain/);
 assert.deepEqual(events.map(p=>p.phase),['creating','received']);
 assert.equal(events[1].authorityOperation.externalId,'123');
});

test('only definite input rejections release creation uncertainty',async()=>{
 for(const definite of [false,true]) {
  const phases=[];
  const payload={authorityState:{'item:a':{status:'rejected'}}};
  await assert.rejects(()=>ensureUberAuthorityObject({sourceKey:'item:a',marker:'FSa'},payload,{findMarker:async()=>[],createHidden:async()=>{throw Error('failed');},isDefiniteRejection:()=>definite},async progress=>phases.push(progress.phase)),/failed/);
  assert.deepEqual(phases,definite?['creating','rejected']:['creating']);
 }
});

test('creation reserves first and persists the independently read hidden identity',async()=>{
 const events=[];let created=false;
 const target={sourceKey:'item:a',marker:'FSa',mappings:[]};
 const driver={findMarker:async()=>created?[{externalId:'1',hidden:true}]:[],createHidden:async()=>{events.push('write');created=true;}};
 const mappings=await ensureUberAuthorityObject(target,{},driver,async progress=>events.push(progress.phase));
 assert.deepEqual(events,['creating','write','identified']);
 assert.equal(mappings[0].externalId,'1');
});
test('a lost reservation acknowledgement prevents a merchant create',async()=>{
 let writes=0;
 await assert.rejects(()=>ensureUberAuthorityObject({sourceKey:'item:a',marker:'FSa'}, {}, {findMarker:async()=>[],createHidden:async()=>writes++},async()=>{throw Error('connection lost');}),/connection lost/);
 assert.equal(writes,0);
});
test('uncertain creations are recovered by marker, never blindly duplicated',async()=>{
 let writes=0;
 const target={sourceKey:'item:a',marker:'FSa'};
 const payload={authorityState:{'item:a':{status:'creating'}}};
 const driver={findMarker:async()=>[],createHidden:async()=>writes++};
 await assert.rejects(()=>ensureUberAuthorityObject(target,payload,driver,async()=>{}),/uncertain/);
 driver.findMarker=async()=>[{externalId:'saved',hidden:true}];
 assert.equal((await ensureUberAuthorityObject(target,payload,driver,async()=>{}))[0].externalId,'saved');
 assert.equal(writes,0);
});

test('a multi-stage resume persists its parent receipt before independent discovery',async()=>{
 const target={sourceKey:'option:a',marker:'FSa',mappings:[]},events=[];
 const payload={authorityState:{'option:a':{status:'creating',externalId:'1',externalParentId:''}}};let ready=false;
 const driver={findMarker:async()=>[],findById:async id=>ready?{externalId:id,externalParentId:'stage:g',marker:'FSa',hidden:true}:null,
  resumeHidden:async(t,{receipt,saveReceipt})=>{assert.equal(receipt.externalId,'1');await saveReceipt({externalId:'1',externalParentId:'stage:g'});ready=true;return {externalId:'1',externalParentId:'stage:g'};},
  createHidden:async()=>{throw Error('must not recreate');}};
 const result=await ensureUberAuthorityObject(target,payload,driver,async row=>events.push(row.phase));
 assert.deepEqual(events,['received','identified']);assert.equal(result[0].externalParentId,'stage:g');
});
