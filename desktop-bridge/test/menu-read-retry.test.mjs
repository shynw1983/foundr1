import test from 'node:test';
import assert from 'node:assert/strict';
import {retryTransientMenuRead} from '../src/merchant-menu-client.mjs';

test('transient reads retry with a bounded backoff and return actual responses',async()=>{
 let calls=0;const waits=[];
 const value=await retryTransientMenuRead('GET',async()=>{if(++calls<3)throw Error('TypeError: Failed to fetch');return {actual:true};},async ms=>waits.push(ms));
 assert.deepEqual(value,{actual:true});assert.deepEqual(waits,[500,1000]);
 calls=0;await assert.rejects(()=>retryTransientMenuRead('GET',async()=>{calls++;throw Error('CDP Runtime.evaluate timeout');},async()=>{}),/timeout/);
 assert.equal(calls,3);
});
test('writes and authentication or validation failures are never retried',async()=>{
 for(const [method,message] of [['POST','Failed to fetch'],['PUT','TimeoutError'],['DELETE','Failed to fetch'],['GET','merchant_menu_request_failed:401:MWA0007'],['GET','merchant_menu_request_failed:400:MWA0012']]) {
  let calls=0;await assert.rejects(()=>retryTransientMenuRead(method,async()=>{calls++;throw Error(message);},async()=>{throw Error('must not wait');}));
  assert.equal(calls,1);
 }
});
