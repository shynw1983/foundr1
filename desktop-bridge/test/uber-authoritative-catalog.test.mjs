import test from 'node:test';
import assert from 'node:assert/strict';
import {captureUberAuthoritativeCatalog} from '../src/uber-authoritative-catalog.mjs';
const fixture=()=>({data:{menuMapping:[{menuType:'MENU_TYPE_FULFILLMENT_DELIVERY',menuUUID:'delivery'}],menus:{delivery:{sections:[],subsectionsMap:{},entities:{itemsMap:{orphan:{itemInfo:{title:{defaultValue:'Unlinked'}},paymentInfo:{priceInfo:{defaultValue:{price:{high:0,low:222200}}}}}},customizationsMap:{}}}}}});
test('captures unlinked source entities without inventing zero prices',()=>{
 assert.equal(captureUberAuthoritativeCatalog(fixture(),'store').entities[0].price,2222);
 const bad=fixture();delete bad.data.menus.delivery.entities.itemsMap.orphan.paymentInfo;
 assert.throws(()=>captureUberAuthoritativeCatalog(bad,'store'),/price_missing/);
});
test('incomplete graph is rejected, not projected to an empty menu',()=>{
 const bad=fixture();bad.data.menus.delivery.subsectionsMap.x={displayItems:[{uuid:'absent'}]};
 assert.throws(()=>captureUberAuthoritativeCatalog(bad,'store'),/dangling/);
 assert.throws(()=>captureUberAuthoritativeCatalog({data:{}},'store'),/incomplete/);
});
