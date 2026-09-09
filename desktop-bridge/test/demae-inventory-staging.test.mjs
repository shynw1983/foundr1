import test from 'node:test';
import assert from 'node:assert/strict';
import {DemaeMenuClient} from '../src/demae-menu-client.mjs';
import {DemaeStagedOption} from '../src/demae-staged-option.mjs';
import {verifyDemaeInventoryStaging} from '../src/demae-inventory-staging.mjs';
function fixture(t,{listed=false,invalid=false}={}) {
 t.mock.method(DemaeMenuClient.prototype,'assertScope',async()=>{});
 t.mock.method(DemaeMenuClient.prototype,'stockCatalog',async()=>({itemList:listed?[{itemCode:'00001'}]:[]}));
 t.mock.method(DemaeMenuClient.prototype,'item',async()=>({chainId:1,itemCode:'00001',categoryItemLinkList:[]}));
 t.mock.method(DemaeStagedOption.prototype,'readAll',async identities=>{if(invalid)throw Error('isolation failed');return identities;});
 const targets=['item','option'].map(kind=>({kind,targetId:kind,knownExternalIds:[`itemList_100001${kind==='option'?'true':'false'}`]}));
 const items=targets.map(t=>({...t,found:false,isAvailable:null,status:'unknown'}));
 const scope={storeId:'s',merchantId:'1',menuPatternCode:'live',targets:targets.map(t=>({...t,marker:'FS0123456789abcd',mappings:[{externalId:t.knownExternalIds[0],externalParentId:'stage:g'}]}))};
 return {items,payload:{targets,demaeStaging:[scope]},scope};
}
test('fresh verified unpublished objects become staged without availability or writes',async t=>{
 const f=fixture(t);await verifyDemaeInventoryStaging({},f.payload,f.items,'s');
 assert.ok(f.items.every(r=>r.status==='staged'&&r.stagingVerified&&r.isAvailable===null));
});
test('published item and failed option isolation remain unknown',async t=>{
 const f=fixture(t,{listed:true,invalid:true});await verifyDemaeInventoryStaging({},f.payload,f.items,'s');
 assert.ok(f.items.every(r=>!r.found&&r.status==='unknown'));
});
test('mapping drift and missing request never inherit old publication proof',async t=>{
 const f=fixture(t);f.payload.targets[0].knownExternalIds=['different'];f.payload.targets.pop();
 await verifyDemaeInventoryStaging({},f.payload,f.items,'s');assert.ok(f.items.every(r=>!r.found));
});
test('wrong store fails closed',async t=>{
 const f=fixture(t);await assert.rejects(()=>verifyDemaeInventoryStaging({},f.payload,f.items,'other'),/scope_mismatch/);
});
