import test from 'node:test';
import assert from 'node:assert/strict';
import { authoritativeDeliveryPrice, confirmedUberRemovals, resolveUberBasePrice, splitUberName, uberContextPrice, uberSourceContentHash, validateUberSourceCatalog, type UberSourceCatalog } from './uber-menu-authority.ts';

function catalog(time='2026-09-07T01:00:00Z'): UberSourceCatalog {
 return {version:1,storeUuid:'store',menuId:'delivery',capturedAt:time,sections:[{id:'s',name:'All day',categoryIds:['c'],hours:[],hidden:false}],categories:[{id:'c',name:'Soup',itemIds:['a'],hidden:false}],groups:[{id:'g',name:'Toppings',optionIds:['b'],min:0,max:10}],entities:[{id:'a',name:'Soup｜汤｜수프｜Soup',description:'',imageUrl:'',price:415,groupIds:['g'],contextPrices:[]},{id:'b',name:'Tofu',description:'',imageUrl:'',price:216,groupIds:[],contextPrices:[{contextType:'CUSTOMIZATION_UUID',contextId:'g',price:222}]}]};
}
test('source graph rejects missing objects and wrong stores',()=>{
 assert.equal(validateUberSourceCatalog(catalog(),'store').entities.length,2);
 assert.throws(()=>validateUberSourceCatalog(catalog(),'other'),/invalid/);
 const broken=catalog(); broken.entities.pop();
 assert.throws(()=>validateUberSourceCatalog(broken,'store'),/reference/);
});
test('same option takes the exact price of its Uber group',()=>{
 const option=catalog().entities[1];
 assert.equal(uberContextPrice(option,'g'),222);
 assert.equal(uberContextPrice(option,'other'),216);
 option.contextPrices.push({...option.contextPrices[0]});
 assert.throws(()=>uberContextPrice(option,'g'),/ambiguous/);
});
test('historical overrides for deleted groups do not replace current prices',()=>{
 const source=catalog();
 source.entities[1].contextPrices.push({contextType:'CUSTOMIZATION_UUID',contextId:'deleted-group',price:999});
 validateUberSourceCatalog(source,'store');
 assert.equal(uberContextPrice(source.entities[1],'g'),222);
 assert.equal(uberContextPrice(source.entities[1],'new-group'),216);
 source.entities[1].contextPrices.push({contextType:'UNKNOWN',contextId:'other',price:111});
 assert.throws(()=>validateUberSourceCatalog(source,'store'),/unsupported/);
});
test('existing OS base prices stay intact; new automatic prices follow the agreed rule',()=>{
 assert.deepEqual(resolveUberBasePrice({uberPrice:216,currentBasePrice:170}),{mode:'manual',price:170});
 assert.deepEqual(resolveUberBasePrice({uberPrice:2222}),{mode:'automatic',price:1780});
 assert.deepEqual(resolveUberBasePrice({uberPrice:500,currentBasePrice:170,mode:'automatic'}),{mode:'automatic',price:400});
 assert.equal(authoritativeDeliveryPrice('rocket_now',2222,1780),2222);
 assert.equal(authoritativeDeliveryPrice('demae_can',2222,1780),1780);
 assert.throws(()=>authoritativeDeliveryPrice('rocket_now',NaN,1780),/missing/);
});
test('removal needs two independent complete observations, not a retry',()=>{
 const original=catalog();
 const next=catalog('2026-09-07T01:10:00Z'); next.entities.pop(); next.groups[0].optionIds=[];
 const first=confirmedUberRemovals(original,next,[]);
 assert.deepEqual(first,{pending:['entity:b'],confirmed:[]});
 assert.deepEqual(confirmedUberRemovals(next,next,first.pending).confirmed,[]);
 const later={...next,capturedAt:'2026-09-07T01:20:00Z'};
 assert.deepEqual(confirmedUberRemovals(next,later,first.pending).confirmed,['entity:b']);
 assert.deepEqual(confirmedUberRemovals(next,{...original,capturedAt:later.capturedAt},first.pending).pending,[]);
});
test('unlinked and sold-out items are not deleted; availability is not content',()=>{
 const before=catalog(),after=catalog('2026-09-07T01:10:00Z');
 after.categories[0].itemIds=[];
 assert.deepEqual(confirmedUberRemovals(before,after,[]).pending,[]);
 const suspension=catalog(); suspension.entities[1].suspensionInfo={until:'forever'};
 assert.equal(uberSourceContentHash(before),uberSourceContentHash(suspension));
 suspension.entities[1].price=500;
 assert.notEqual(uberSourceContentHash(before),uberSourceContentHash(suspension));
});
test('source languages are structured, with missing translations left empty',()=>{
 assert.deepEqual(splitUberName('日本語｜中文｜한국어｜English'),{name:'日本語',displayNames:{zh:'中文',ko:'한국어',en:'English'}});
 assert.deepEqual(splitUberName('日本語'),{name:'日本語',displayNames:{}});
});
