import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createMerchantMenuPacer} from '../src/merchant-menu-pacer.mjs';

test('merchant requests are serialized and failures are never blindly retried',async()=>{
 const paced=createMerchantMenuPacer({intervalMs:0});let active=0,max=0,attempts=0;
 const results=await Promise.allSettled(Array.from({length:5},(_,index)=>paced(async()=>{
  attempts++;active++;max=Math.max(max,active);await delay(1);active--;
  if(index===2)throw Error('native rejection');return index;
 })));
 assert.equal(max,1);assert.equal(attempts,5);
 assert.equal(results[2].status,'rejected');assert.equal(results[4].value,4);
});
