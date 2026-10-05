import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createMerchantMenuPacer} from '../src/merchant-menu-pacer.mjs';
import {CdpPage} from '../src/cdp-page.mjs';
import {connectMerchantMenuClient} from '../src/merchant-menu-client.mjs';

test('merchant requests are serialized and failures are never blindly retried',async()=>{
 const paced=createMerchantMenuPacer({intervalMs:0});let active=0,max=0,attempts=0;
 const results=await Promise.allSettled(Array.from({length:5},(_,index)=>paced(async()=>{
  attempts++;active++;max=Math.max(max,active);await delay(1);active--;
  if(index===2)throw Error('native rejection');return index;
 })));
 assert.equal(max,1);assert.equal(attempts,5);
 assert.equal(results[2].status,'rejected');assert.equal(results[4].value,4);
});

test('verified merchant connections pace concurrent requests and recover after an unretried 403', {timeout:10000}, async()=>{
 const originalConnect=CdpPage.connect;
 try {
  for(const [origin,interval] of [['https://store.rocketnow.co.jp',1000],['https://partner.demae-can.com',250]]) {
   const starts=[];let active=0,max=0,calls=0,closed=0;
   CdpPage.connect=async(_port,requestedOrigin)=>{
    assert.equal(requestedOrigin,origin);
    return {
     close:()=>closed++,
     evaluate:async expression=>{
      if(expression==='location.origin')return origin;
      starts.push(Date.now());active++;max=Math.max(max,active);
      const call=++calls;await delay(20);active--;
      if(call===2)throw Error('merchant_menu_request_failed:403');
      return {call};
     }
    };
   };
   const client=await connectMerchantMenuClient({ensureRunning:async()=>1},origin,'OK');
   const results=await Promise.allSettled([
    client.request('/api/read'),
    client.request('/api/write','POST',{name:'unchanged'}),
    client.request('/api/read-again')
   ]);
   assert.equal(calls,3,'a rejected write must not be replayed or poison the queue');
   assert.equal(max,1);
   assert.equal(results[0].value.call,1);
   assert.equal(results[1].status,'rejected');
   assert.match(results[1].reason.message,/403/);
   assert.equal(results[2].value.call,3);
   for(let index=1;index<starts.length;index++) {
    // Real timer scheduling can round a millisecond at the boundary.
    assert.ok(starts[index]-starts[index-1]>=interval-10,`${origin} request started too soon`);
   }
   client.close();assert.equal(closed,1);
  }
 } finally {CdpPage.connect=originalConnect;}
});
