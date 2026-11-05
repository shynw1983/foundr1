import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture() {
  let now=1_000_000,id=0;
  const timers=new Map(), wl=new Map(), dl=new Map();
  const add=(map,name,fn)=>{if(!map.has(name))map.set(name,new Set());map.get(name).add(fn);};
  const remove=(map,name,fn)=>map.get(name)?.delete(fn);
  const setTimeout=(fn,ms=0)=>{timers.set(++id,{fn,at:now+ms});return id;};
  const clearTimeout=id=>timers.delete(id);
  const window={setTimeout,clearTimeout,addEventListener:(n,f)=>add(wl,n,f),removeEventListener:(n,f)=>remove(wl,n,f),localStorage:{getItem:()=>'{"closed":{}}'}};
  const document={visibilityState:'visible',addEventListener:(n,f)=>add(dl,n,f),removeEventListener:(n,f)=>remove(dl,n,f)};
  const navigator={onLine:true};
  class Clock extends Date {static now(){return now;}}
  const context={window,document,navigator,Date:Clock,Math:Object.assign(Object.create(Math),{random:()=>0}),AbortController,DOMException,setTimeout,clearTimeout,console,exports:{},require:()=>({getStoreCashBusinessDayState:()=>({status:'business_open'})})};
  const load=file=>{context.exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports;};
  const core=load('lib/store-polling-client.ts'),realtime=load('lib/store-realtime-refresh.ts');
  const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
  async function advance(ms){const end=now+ms;while(true){await flush();const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;await flush();}
  return {core,realtime,window,document,navigator,timers,flush,advance,fire:(n,where=wl)=>where.get(n)?.forEach(f=>f({})),visibility:()=>dl.get('visibilitychange')?.forEach(f=>f({})),create(task,opts={}){return core.createStoreRefreshCoordinator(task,{healthyIntervalMs:300000,fallbackIntervalMs:60000,jitterRatio:0,...opts});}};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}

test('healthy statistics use event refresh and 5 minute integrity checks, including lost pushes',async()=>{
 const f=fixture();let calls=0,source=0,shown=0;const c=f.create(async()=>{calls++;shown=source;});c.start({immediate:true});await f.flush();c.setRealtimeHealthy(true);
 await f.advance(15000);assert.equal(calls,1);source=1;await c.refresh();assert.equal(shown,1);source=2;
 await f.advance(299999);assert.equal(shown,1);await f.advance(1);assert.equal(shown,2);assert.equal(calls,3);c.stop();assert.equal(f.timers.size,0);
});
test('events arriving during a read produce exactly one trailing snapshot, never overlapping HTTP',async()=>{
 const f=fixture(),first=deferred();let calls=0,active=0,max=0;const c=f.create(async()=>{calls++;max=Math.max(max,++active);if(calls===1)await first.promise;active--;});c.start({immediate:true});await f.flush();
 c.refresh();c.refresh();c.refresh();assert.equal(calls,1);first.resolve();await f.flush();assert.equal(calls,2);assert.equal(max,1);c.stop();
});
test('unavailable realtime keeps successful HTTP recovery at 30 seconds even after an hour',async()=>{
 const f=fixture();let calls=0;const c=f.create(async()=>{calls++;},{healthyIntervalMs:60000,fallbackIntervalMs:30000});c.start({immediate:true});await f.advance(3600000);assert.equal(calls,121);c.stop();
});
test('online/focus/pageshow/visibility wake burst is one authority read',async()=>{
 const f=fixture();let calls=0;const c=f.create(async()=>{calls++;});c.start({immediate:true});await f.flush();f.fire('online');f.fire('focus');f.fire('pageshow');f.visibility();await f.advance(75);assert.equal(calls,2);c.stop();
});
test('hidden and offline pages pause reads and resume with a single reconciliation',async()=>{
 const f=fixture();let calls=0;const c=f.create(async()=>{calls++;});c.start({immediate:true});await f.flush();f.document.visibilityState='hidden';f.visibility();await f.advance(600000);assert.equal(calls,1);
 f.document.visibilityState='visible';f.navigator.onLine=false;f.visibility();await f.advance(100000);assert.equal(calls,1);f.navigator.onLine=true;f.fire('online');f.visibility();await f.advance(75);assert.equal(calls,2);c.stop();
});
test('HTTP failures back off; automatic events cannot defeat backoff; successful read resets it',async()=>{
 const f=fixture();let calls=0;const c=f.create(async()=>{if(++calls===1)throw Error('server unavailable');});c.start({immediate:true});await f.flush();await c.refresh();assert.equal(calls,1);await f.advance(119999);assert.equal(calls,1);await f.advance(1);assert.equal(calls,2);await f.advance(60000);assert.equal(calls,3);c.stop();
});
test('manual retry is immediate after an HTTP failure but cannot bypass Retry-After',async()=>{
 const f=fixture();let calls=0;const c=f.create(async()=>{if(++calls===1)throw Error('server unavailable');});c.start({immediate:true});await f.flush();await c.refresh({force:true});assert.equal(calls,2);c.stop();
 const g=fixture();let n=0;const d=g.create(async()=>{if(++n===1)throw Object.assign(Error('limited'),{status:429,retryAfterMs:200000});});d.start({immediate:true});await g.flush();await d.refresh({force:true});assert.equal(n,1);await g.advance(199999);assert.equal(n,1);await g.advance(1);assert.equal(n,2);d.stop();
});
for(const status of [401,403])test(`HTTP ${status} isolates data and stops automatic retry`,async()=>{
 const f=fixture();let calls=0,cleared=0;const c=f.create(async()=>{calls++;throw Object.assign(Error('denied'),{status});},{onUnauthorized:()=>cleared++});c.start({immediate:true});await f.flush();assert.equal(cleared,1);await f.advance(3600000);f.fire('online');await f.advance(100);await c.refresh({force:true});assert.equal(calls,1);c.stop();
});
test('request timeout is a real failure; abort/unmount does not trigger new HTTP',async()=>{
 const f=fixture();let calls=0,errors=0,signal;const c=f.create(async s=>{calls++;signal=s;await new Promise(()=>{});},{timeoutMs:1000,onError:()=>errors++});c.start({immediate:true});await f.advance(1000);assert.equal(signal.aborted,true);assert.equal(errors,1);assert.equal(calls,1);c.stop();await f.advance(300000);assert.equal(calls,1);
});
test('scope disposal aborts old read and a new scoped coordinator can proceed immediately',async()=>{
 const f=fixture(),pending=deferred();let oldSignal,oldApplied=false,newApplied=false;const old=f.create(async s=>{oldSignal=s;await pending.promise;if(!s.aborted)oldApplied=true;});old.start({immediate:true});await f.flush();old.stop();const next=f.create(async()=>{newApplied=true;});next.start({immediate:true});await f.flush();pending.resolve();await f.flush();assert.equal(oldSignal.aborted,true);assert.equal(oldApplied,false);assert.equal(newApplied,true);next.stop();
});
function emitter(){const listeners=new Map();return{listeners,bind(n,f){if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(f);},unbind(n,f){listeners.get(n)?.delete(f);},fire(n,v){listeners.get(n)?.forEach(f=>f(v));}};}
function client(){const channels=new Map();return{channels,connection:Object.assign(emitter(),{state:'connected'}),subscribe(n){if(!channels.has(n))channels.set(n,Object.assign(emitter(),{subscribed:false}));return channels.get(n);}};}
test('all scoped channel subscriptions must succeed; partial failures and reconnect degrade health',async()=>{
 const f=fixture(),p=client(),health=[];let events=0,reconciled=0;const dispose=f.realtime.bindStoreRealtimeChannels(p,{channels:['a','b','a'],events:['changed'],onEvent:()=>events++,onHealthChange:h=>{health.push(h);if(h)reconciled++;}});
 p.channels.get('a').subscribed=true;p.channels.get('a').fire('pusher:subscription_succeeded');assert.equal(health.at(-1),false);p.channels.get('b').subscribed=true;p.channels.get('b').fire('pusher:subscription_succeeded');assert.equal(health.at(-1),true);assert.equal(reconciled,1);
 p.channels.get('a').fire('changed');assert.equal(events,1);p.channels.get('b').subscribed=false;p.channels.get('b').fire('pusher:subscription_error',{status:500});assert.equal(health.at(-1),false);p.channels.get('b').subscribed=true;p.channels.get('b').fire('pusher:subscription_succeeded');assert.equal(reconciled,2);
 p.connection.state='unavailable';p.connection.fire('state_change',{current:'unavailable'});assert.equal(health.at(-1),false);for(const c of p.channels.values())c.subscribed=false;p.connection.state='connected';p.connection.fire('state_change',{current:'connected'});assert.equal(health.at(-1),false);for(const c of p.channels.values()){c.subscribed=true;c.fire('pusher:subscription_succeeded');}assert.equal(reconciled,3);dispose();p.channels.get('a').fire('changed');assert.equal(events,1);assert.equal(f.timers.size,0);
});
test('subscription timeout remains unhealthy and already subscribed shared channel reconciles',async()=>{
 const f=fixture(),p=client(),health=[];const dispose=f.realtime.bindStoreRealtimeChannels(p,{channels:['a','b'],events:[],onEvent:()=>{},onHealthChange:h=>health.push(h),subscriptionTimeoutMs:1000});p.channels.get('a').subscribed=true;p.channels.get('a').fire('pusher:subscription_succeeded');await f.advance(1000);assert.equal(health.at(-1),false);dispose();p.channels.get('b').subscribed=true;const second=[];const done=f.realtime.bindStoreRealtimeChannels(p,{channels:['a','b'],events:[],onEvent:()=>{},onHealthChange:h=>second.push(h)});assert.equal(second.at(-1),true);done();
});
test('dynamic active-work cadence is a single timer and idle reschedule removes fast reads',async()=>{
 const f=fixture();let calls=0,active=false;const c=f.create(async()=>{calls++;},{healthyIntervalMs:()=>active?2000:300000,fallbackIntervalMs:()=>active?2000:60000});c.start({immediate:true});await f.flush();c.setRealtimeHealthy(true);active=true;c.reschedule();await f.advance(6000);assert.equal(calls,4);active=false;c.reschedule();await f.advance(6000);assert.equal(calls,4);c.stop();
});

test('stop/start during an old read does not delay new read or let old finalizer erase it',async()=>{
 const f=fixture(),old=deferred(),next=deferred();let calls=0;const c=f.create(async()=>{calls++;if(calls===1)await old.promise;else if(calls===2)await next.promise;});c.start({immediate:true});await f.flush();c.stop();c.start({immediate:true});await f.flush();assert.equal(calls,2);old.resolve();await f.flush();c.refresh();next.resolve();await f.flush();assert.equal(calls,3);c.stop();
});
test('online recovery bypasses old HTTP failure backoff and still respects rate limiting',async()=>{
 const f=fixture();let calls=0;const c=f.create(async()=>{if(++calls===1)throw Error('offline server');});c.start({immediate:true});await f.flush();f.fire('online');await f.advance(75);assert.equal(calls,2);c.stop();
});

for (const status of [401,403]) test(`subscription ${status} stops all related callbacks immediately`, async()=>{
 const f=fixture(),p=client();let denied=0,events=0;const done=f.realtime.bindStoreRealtimeChannels(p,{channels:['a','b'],events:['changed'],onHealthChange:()=>{},onEvent:()=>events++,onUnauthorized:s=>{assert.equal(s,status);denied++;}});
 p.channels.get('a').fire('pusher:subscription_error',{status});p.channels.get('b').fire('changed');assert.equal(denied,1);assert.equal(events,0);p.connection.fire('state_change',{current:'connected'});await f.advance(20000);assert.equal(f.timers.size,0);done();
});
