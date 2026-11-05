import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {createCommandWake} from '../src/command-wake.mjs';
const config={serverUrl:'https://fixture.invalid',storeId:'store-a',deviceName:'Test'};
const channel='presence-store-bridge-store-a';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({wrongScope=false,unavailable=false}={}){
 const sockets=[],requests=[];
 class Socket extends EventEmitter{
  readyState=1;sent=[];
  constructor(url){super();this.url=url;sockets.push(this);}
  send(raw){this.sent.push(JSON.parse(raw));}
  terminate(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
  receive(event,data={},eventChannel){this.emit('message',JSON.stringify({event,data:JSON.stringify(data),channel:eventChannel}));}
 }
 const api={request:async(url,init)=>{requests.push({url,init});if(unavailable)throw Error('offline');return init?{auth:'signature',channel_data:'{"user_id":"bridge:test"}'}:{key:'key',cluster:'ap3',channel:wrongScope?'presence-store-bridge-store-b':channel};}};
 const client=createCommandWake(api,config,{Socket});
 return {client,sockets,requests,async connect(){client.start();await flush();sockets[0].receive('pusher:connection_established',{socket_id:'1.2'});await flush();sockets[0].receive('pusher_internal:subscription_succeeded',{},channel);await flush();}};
}
test('only a confirmed scoped subscription enables idle reduction, auth uses existing endpoint',async()=>{
 const f=fixture();try{
  f.client.start();await flush();assert.equal(f.client.connected,false);
  const socket=f.sockets[0];socket.receive('pusher:connection_established',{socket_id:'1.2'});await flush();
  assert.equal(f.client.connected,false);assert.equal(f.requests[1].init.headers['Content-Type'],'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(f.requests[1].init.body).get('channel_name'),channel);
  assert.equal(socket.sent[0].event,'pusher:subscribe');socket.receive('pusher_internal:subscription_succeeded',{},channel);assert.equal(f.client.connected,true);
 }finally{f.client.stop();}
});
test('command notification wakes the ordinary poll immediately and retains events received during work',async()=>{
 const f=fixture();try{
  await f.connect();await f.client.wait(100); // Drain subscription's initial wake.
  let woke=false;const wait=f.client.wait(1000).then(()=>{woke=true;});
  f.sockets[0].receive('bridge.command.available',{},'other-store');await flush();assert.equal(woke,false);
  f.sockets[0].receive('bridge.command.available',{},channel);await wait;assert.equal(woke,true);
  f.sockets[0].receive('bridge.command.available',{command:{type:'untrusted'}},channel);
  await f.client.wait(1000);assert.equal(f.requests.length,2,'notification never executes supplied payload');
 }finally{f.client.stop();}
});
test('loss of realtime immediately wakes the poll so original fallback cadence resumes',async()=>{
 const f=fixture();try{
  await f.connect();await f.client.wait(100);const wait=f.client.wait(1000);f.sockets[0].terminate();await wait;assert.equal(f.client.connected,false);
 }finally{f.client.stop();}
});
test('unavailable realtime and wrong store scope fail closed without blocking command polling',async()=>{
 for(const options of [{unavailable:true},{wrongScope:true}]){
  const f=fixture(options);try{f.client.start();await flush();assert.equal(f.client.connected,false);assert.equal(f.sockets.length,0);await f.client.wait(1);}finally{f.client.stop();}
 }
});
test('server heartbeat is answered and stop closes the subscription',async()=>{
 const f=fixture();await f.connect();f.sockets[0].receive('pusher:ping');assert.equal(f.sockets[0].sent.at(-1).event,'pusher:pong');
 f.client.stop();assert.equal(f.client.connected,false);assert.equal(f.sockets[0].readyState,3);
});
