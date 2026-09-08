import test from 'node:test';
import assert from 'node:assert/strict';
import {runUberAuthorityPublication} from '../src/uber-authority-runner.mjs';
const target={kind:'item',sourceKey:'item:a',targetId:'a',name:'new',price:227,marker:'FS0123456789abcd',mappings:[{externalId:'1'}]};
const payload=()=>({authoritativePublication:true,sourceId:'s',storeId:'os',platformKey:'rocket_now',merchantId:'1',revision:1,newItemsHidden:true,imagePolicy:'read_only',targets:[structuredClone(target)]});
function fixture(issues=[]) {
 const events=[],native={name:'old',price:100};
 const driver={platform:'rocket_now',merchantId:'1',preflight:async()=>({issues}),
  updateContent:async target=>{events.push('content');native.name=target.name;native.price=target.price;},
  updateRelationships:async()=>events.push('relationships'),
  observe:async target=>{events.push('read');return [{sourceKey:target.sourceKey,externalId:'1',name:native.name,price:native.price,structureVerified:true}];}};
 return {events,driver};
}
test('full preflight and required acknowledgements happen before any write',async()=>{
 const {driver,events}=fixture([{sourceKey:'item:a',code:'ambiguous'}]);
 await assert.rejects(()=>runUberAuthorityPublication(payload(),driver,async()=>{}),/preflight_blocked/);
 assert.deepEqual(events,[]);
 await assert.rejects(()=>runUberAuthorityPublication(payload(),fixture().driver,async()=>{throw Error('offline');}),/offline/);
});
test('content then relationships then independent observations execute in one runner',async()=>{
 const {driver,events}=fixture();
 const result=await runUberAuthorityPublication(payload(),driver,async()=>{});
 assert.deepEqual(events,['content','relationships','read']);assert.equal(result.observations[0].price,227);
});
test('a successful merchant response without actual changed values is rejected',async()=>{
 const {driver}=fixture();driver.updateContent=async()=>{};
 await assert.rejects(()=>runUberAuthorityPublication(payload(),driver,async()=>{}),/content_unverified/);
});
test('incomplete occurrence readback and exposed new items cannot succeed',async()=>{
 for(const created of [false,true]) {
  const p=payload(),{driver}=fixture();
  if(created)p.targets[0].mappings[0].created=true;
  else p.targets[0].mappings.push({externalId:'2'});
  await assert.rejects(()=>runUberAuthorityPublication(p,driver,async()=>{}),/draft_exposed|occurrence_unverified/);
 }
});
test('wrong scope and old image-enabled commands fail before preflight',async()=>{
 for(const patch of [{merchantId:'2'},{imagePolicy:undefined},{revision:0}]) {
  const {driver}=fixture();driver.preflight=async()=>{throw Error('should not read');};
  await assert.rejects(()=>runUberAuthorityPublication({...payload(),...patch},driver,async()=>{}),/command_invalid/);
 }
});

test('new parents may contain existing selling children, but new options remain hidden',async()=>{
 for(const kind of ['category','option_group','option']) {
  const p=payload(),{driver}=fixture();p.targets[0].kind=kind;
  p.targets[0].mappings[0].created=true;
  if(kind==='option')await assert.rejects(()=>runUberAuthorityPublication(p,driver,async()=>{}),/draft_exposed/);
  else assert.equal((await runUberAuthorityPublication(p,driver,async()=>{})).outcome,'applied');
 }
});
