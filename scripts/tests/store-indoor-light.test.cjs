// Actual adapter, service, routes and migrations; local PostgreSQL and fake devices only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const storeId = '10000000-0000-4000-8000-000000000001', otherStoreId = '10000000-0000-4000-8000-000000000002', actorId = '20000000-0000-4000-8000-000000000001';
const botId='ABCDEF123456', hubId='ABCDEF654321', outdoorId='ABCDEF123457', shadeId='ABCDEF123458', lockId='ABCDEF123459', meterId='ABCDEF123460', keypadId='ABCDEF123461', remoteId='ABCDEF123462', foreignId='ABCDEF123463';
const plugId='ABCDEF123464',foreignPlugId='ABCDEF123465';
const env = { SWITCHBOT_TOKEN:'test-token',SWITCHBOT_SECRET:'test-secret',SWITCHBOT_INDOOR_LIGHT_STORE_ID:storeId,SWITCHBOT_INDOOR_LIGHT_BOT_ID:botId,SWITCHBOT_INDOOR_LIGHT_HUB_ID:hubId,SWITCHBOT_CONTROL_ENABLED:'true' };
function load(file, modules={}, globals={}) {
 const context={exports:{},Response,Request,URL,AbortSignal,Date,Buffer,process:{env},console,require:name=>Object.hasOwn(modules,name.split('/').at(-1))?modules[name.split('/').at(-1)]:require(name),...globals};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context,{filename:file});return context.exports;
}
const light=load('lib/store-light-state.ts'), state=load('lib/store-device-state.ts',{'store-light-state':light}), scenePolicy=load('lib/store-scene-state.ts');
const plain=v=>JSON.parse(JSON.stringify(v));
const types=[[botId,'Bot'],[outdoorId,'Bot'],[shadeId,'Roller Shade'],[lockId,'Smart Lock Pro'],[hubId,'Hub 2'],[meterId,'Meter'],[keypadId,'Keypad Vision'],[remoteId,'Remote'],[foreignId,'Bot'],[plugId,'Plug Mini (JP)'],[foreignPlugId,'Plug Mini (JP)']];
function fakeVendor(onPost=async()=>{}) {
 const control={posts:[],reads:[],level:12,mode:'pressMode',position:0,moving:false,calibrated:true,lockState:'unlocked',doorState:'closed',failReads:false,postMode:'ok',plugPower:'on',plugHub:null};
 control.fetch=async(url,init)=>{
  assert.equal(init.redirect,'error');assert.equal(init.headers.sign,crypto.createHmac('sha256',env.SWITCHBOT_SECRET).update(env.SWITCHBOT_TOKEN+init.headers.t+init.headers.nonce).digest('base64'));
  if(init.method==='POST'){
   control.posts.push({url,body:JSON.parse(init.body)});await onPost();
   if(control.postMode==='timeout')throw Error('lost response');
   if(control.postMode==='offline')return Response.json({statusCode:161});
   return Response.json({statusCode:100,body:{items:[{deviceID:url.split('/').at(-2),code:100,status:{}}]}});
  }
  control.reads.push(url);if(control.failReads || control.failStatuses && url.endsWith('/status'))throw Error('offline');
  if(url.endsWith('/devices'))return Response.json({statusCode:100,body:{deviceList:types.map(([deviceId,deviceType])=>({deviceId,deviceType,deviceName:deviceType,hubDeviceId:deviceType==='Plug Mini (JP)'?'':deviceId===foreignId?foreignId:hubId,enableCloudService:true,group:false,master:true,keyList:[{password:'DO-NOT-EXPOSE'}]})),infraredRemoteList:[]}});
  const id=url.split('/').at(-2),type=types.find(t=>t[0]===id)?.[1];assert.notEqual(id,foreignId);
  let body={deviceId:id,deviceType:type,hubDeviceId:hubId,battery:100};
  if(type==='Plug Mini (JP)')Object.assign(body,{hubDeviceId:control.plugHub??id,power:control.plugPower});
  if(type==='Bot')Object.assign(body,{deviceMode:control.mode,power:'on'});
  if(type==='Hub 2')Object.assign(body,{lightLevel:control.level,temperature:22.6,humidity:66});
  if(type==='Roller Shade')Object.assign(body,{calibrate:control.calibrated,slidePosition:control.position,moving:control.moving,battery:13});
  if(type==='Smart Lock Pro')Object.assign(body,{calibrate:control.calibrated,lockState:control.lockState,doorState:control.doorState});
  if(type==='Meter')Object.assign(body,{temperature:0,humidity:0,battery:0});
  return Response.json({statusCode:100,body});
 };return control;
}

test('inferred lighting and command observations distinguish acknowledgement from a later state',()=>{
 const at=new Date().toISOString();for(const [level,expected] of [[1,'off'],[3,'off'],[4,'unknown'],[9,'unknown'],[10,'on'],[20,'on'],[0,'unknown'],[21,'unknown'],[null,'unknown'],['12','unknown'],[2.5,'unknown']])assert.equal(light.estimateIndoorLight(level,at),expected);
 assert.equal(light.estimateIndoorLight(12,new Date(Date.now()-120001).toISOString()),'unknown');
 const d={kind:'indoorLight',sample:{lightLevel:12},fetchedAt:at,readError:false,command:{action:'press',result:'accepted',parameter:'default',requestedAt:at,finishedAt:at,before:{lightLevel:2}}};
 assert.equal(state.deviceObservation(d),'waiting');
 assert.equal(state.deviceObservation({...d,fetchedAt:new Date(Date.now()+5000).toISOString()}),'observed');
 assert.equal(state.deviceObservation({...d,kind:'bot'} ,Date.now()+36000),'unconfirmed');
 for(const [action,sample,param] of [['setPosition',{position:37,moving:false},'37'],['lock',{lockState:'locked'},'default'],['unlock',{lockState:'unlocked'},'default'],['turnOff',{power:'off'},'default']])assert.equal(state.deviceObservation({...d,sample,fetchedAt:new Date(Date.now()+5000).toISOString(),command:{...d.command,action,parameter:param}}),'observed');
 assert.equal(state.deviceObservation({...d,sample:{position:37,moving:true},fetchedAt:new Date(Date.now()+5000).toISOString(),command:{...d.command,action:'setPosition',parameter:'37'}}),'waiting');
 assert.equal(state.deviceStateLabel({kind:"shade",sample:{position:null},readError:false}),"状態を判定できません");
 assert.equal(state.deviceCooldownMs,10000);
});

test('on-demand reads, additive migration, actual SQL claims, device safety and idempotency',async t=>{
 const db=new PGlite();try{
  await db.exec(`create table stores(id uuid primary key);create table employees(id uuid primary key);insert into stores values('${storeId}'),('${otherStoreId}');insert into employees values('${actorId}');`);
  await db.exec(fs.readFileSync('db/schema.sql','utf8').match(/create table if not exists module_settings \([\s\S]*?\n\);/)[0]);
  await db.query("insert into module_settings(scope_key,module_key,settings) values($1,'store_devices',$2::jsonb)",['store:'+storeId,JSON.stringify({directDeviceIds:[plugId],preserved:'yes'})]);
  const initial=fs.readFileSync('db/migrations/20260929-store-indoor-light.sql','utf8'),expand=fs.readFileSync('db/migrations/20260929-store-device-commands.sql','utf8');await db.exec(initial);
  const legacyId=crypto.randomUUID();await db.query("insert into store_light_commands(id,store_id,device_id,result,before_state,before_level) values($1,$2,$3,'accepted','off',2)",[legacyId,storeId,botId]);
  const before=(await db.query('select * from store_light_commands')).rows[0];await db.exec(expand);await db.exec(expand);
  const after=(await db.query('select * from store_light_commands')).rows[0];for(const k in before)assert.deepEqual(after[k],before[k],`preserved ${k}`);assert.equal(after.command,'press');assert.equal(after.parameter,'default');assert.equal(after.before_sample,null);
  assert.ok(fs.readFileSync('db/schema.sql','utf8').includes(expand));
  await db.exec(fs.readFileSync('db/migrations/20260930-store-device-scenes.sql','utf8'));
  const queries=[];const sql=async(strings,...values)=>{const q=strings.reduce((q,s,i)=>q+(i?'$'+i:'')+s,'');queries.push(q);return(await db.query(q,values)).rows;};
  let holdPost=null;
  const vendor=fakeVendor(async()=>{
   assert.equal((await db.query("select count(*)::int as n from store_light_commands where result='pending'")).rows[0].n,1,'durable journal before send');if(holdPost)await holdPost;
  });
  const adapter=load('lib/switchbot.ts',{}, {fetch:vendor.fetch});const service=load('lib/store-devices.ts',{db:{sql},switchbot:adapter,'store-device-state':state,'store-light-state':light,'store-scene-state':scenePolicy});
  const legacy=load('lib/store-indoor-light.ts',{'store-devices':service,switchbot:adapter,'store-light-state':light});
  const key=id=>adapter.deviceKey(storeId,id),send=(id,action='press',param='default',requestId=crypto.randomUUID())=>service.requestStoreDeviceCommand(storeId,actorId,key(id),requestId,action,param);
  const expire=()=>db.exec("update store_light_runtime set blocked_until=now()-interval '1 second'");
  let view=await service.getStoreDevices(storeId);
  assert.equal(view.devices.length,9);assert.equal(view.devices.filter(d=>d.actions.length).length,5);
  assert.deepEqual(plain(view.devices.find(d=>d.kind==='lock').actions),['lock','unlock']);
  assert.equal(vendor.reads.filter(u=>u.includes(hubId+'/status')).length,1,'hub reading shared across indoor light and hub');
  assert.equal(view.devices.find(d=>d.kind==='bot').sample.power,undefined,'press-mode Bot power not exposed as lamp status');
  assert.equal(view.devices.find(d=>d.kind==='plug').sample.power,'on');
  assert.ok(!JSON.stringify(view).includes(plugId));
  assert.ok(!(await adapter.listStoreSwitchBots(adapter.indoorLightConfig(storeId))).some(d=>d.kind==='plug'),'unbound Wi-Fi devices are excluded');
  assert.equal(view.devices.find(d=>d.kind==='meter').issue,'sensor_unavailable');
  assert.equal(view.devices.find(d=>d.kind==='remote').issue,'status_unsupported');
  assert.ok(!JSON.stringify(view).includes('DO-NOT-EXPOSE'));assert.ok(!JSON.stringify(view).includes(botId));assert.ok(!JSON.stringify(view).includes(env.SWITCHBOT_TOKEN));
  const firstReads=vendor.reads.length;await service.getStoreDevices(storeId);assert.equal(vendor.reads.length,firstReads*2-1,'each explicit request reads provider');
  assert.ok(queries.every(q=>/^select /i.test(q.trim())),'status requests issue SELECT only');assert.equal((await db.query('select count(*)::int n from store_light_runtime')).rows[0].n,0,'no runtime created for reads');
  assert.equal((await service.getStoreDevices(otherStoreId)).configured,false);assert.equal(vendor.reads.length,firstReads*2-1);
  await assert.rejects(()=>service.getStoreDevices(storeId,key(foreignId)),e=>e.status===404);
  await assert.rejects(()=>send(remoteId),e=>e.status===400);await assert.rejects(()=>send(shadeId,'setPosition','101'),e=>e.status===400);await assert.rejects(()=>send(botId,'unlock'),e=>e.status===400);
  await assert.rejects(()=>send(lockId,'deadbolt'),e=>e.status===400,'old clients cannot retract an unsupported latch');
  assert.equal(vendor.posts.length,0,'unsupported actions never reach the device');
  // Independent requests for the same device must result in one vendor command.
  const ids=[crypto.randomUUID(),crypto.randomUUID()];const results=await Promise.allSettled(ids.map(id=>send(botId,'press','default',id)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(vendor.posts.length,1);
  const accepted=results.find(r=>r.status==='fulfilled').value;
  assert.equal(Date.parse(accepted.blockedUntil)-Date.parse(accepted.command.finishedAt),10000);
  const winner=accepted.command.id;await legacy.requestIndoorLightPress(storeId,actorId,winner);assert.equal(vendor.posts.length,1,'old route shares idempotency');
  await assert.rejects(()=>send(botId),e=>e.status===409);await expire();await send(botId,'press','default',winner);assert.equal(vendor.posts.length,1,'replay remains idempotent after cooldown');
  await assert.rejects(()=>send(outdoorId,'press','default',winner),e=>e.status===409,'same ID cannot target another device');
  vendor.postMode='timeout';const unknown=await send(botId);assert.equal(unknown.command.result,'unknown');await send(botId,'press','default',unknown.command.id);assert.equal(vendor.posts.length,2,'unknown commands never retried');
  await expire();vendor.postMode='offline';assert.equal((await send(botId)).command.result,'rejected');assert.equal(vendor.posts.length,3);
  vendor.postMode='ok';await expire();vendor.mode='switchMode';assert.equal((await send(botId)).command.result,'rejected');assert.equal(vendor.posts.length,3,'fresh mode preflight rejects old press intent');
  await expire();assert.equal((await send(outdoorId,'turnOn')).command.result,'accepted');assert.equal(vendor.posts.length,4,'explicit on still sent when cloud already says on');
  await expire();await send(outdoorId,'turnOff');assert.deepEqual(vendor.posts.at(-1).body,{command:'turnOff',parameter:'default',commandType:'command'});
  vendor.mode='pressMode';await expire();vendor.calibrated=false;assert.equal((await send(shadeId,'setPosition','37')).command.reason,'not_calibrated');assert.equal(vendor.posts.length,5);
  vendor.calibrated=true;await expire();await send(shadeId,'setPosition','37');assert.deepEqual(vendor.posts.at(-1).body,{command:'setPosition',parameter:'37',commandType:'command'});
  await expire();vendor.doorState='open';assert.equal((await send(lockId,'lock')).command.reason,'door_not_closed');assert.equal(vendor.posts.length,6);
  vendor.doorState='close';vendor.lockState='unlock';await expire();assert.equal((await send(lockId,'unlock')).command.result,'accepted');assert.equal(vendor.posts.length,7,'explicit unlock not skipped based on stale cloud state');
  await expire();await send(lockId,'lock');assert.equal(vendor.posts.at(-1).body.command,'lock');
  await expire();vendor.lockState='jammed';assert.equal((await send(lockId,'unlock')).command.reason,'lock_unavailable');assert.equal(vendor.posts.length,8);
  vendor.lockState='unlocked';vendor.failStatuses=true;await expire();assert.equal((await legacy.getIndoorLight(storeId)).readError,true);
  assert.equal((await send(botId)).command.result,'rejected');assert.equal(vendor.posts.length,8,'failed preflight sends nothing');
  vendor.failStatuses=false;await expire();
  let release;holdPost=new Promise(resolve=>{release=resolve;});const inFlight=send(botId);const started=Date.now();
  while(vendor.posts.length<9){if(Date.now()-started>2000)throw Error('command not started');await new Promise(r=>setTimeout(r,5));}
  const lease=(await db.query('select extract(epoch from(blocked_until-now())) as seconds from store_light_runtime where device_id=$1',[botId])).rows[0];
  assert.ok(Number(lease.seconds)>55,'in-flight lease outlasts normal 10-second cooldown');
  await assert.rejects(()=>send(botId),e=>e.status===409);release();await inFlight;holdPost=null;assert.equal(vendor.posts.length,9);
  await expire();vendor.level=2;assert.equal((await legacy.getIndoorLight(storeId)).estimate,'off');
  const staleId=crypto.randomUUID();await db.query("insert into store_light_commands(id,store_id,device_id,result,requested_at) values($1,$2,$3,'pending',now()-interval '2 minutes')",[staleId,storeId,botId]);
  assert.equal((await send(botId,'press','default',staleId)).command.result,'unknown');assert.equal(vendor.posts.length,9,'orphaned commands are never resumed');
  const getQueriesStart=queries.length;await service.getStoreDevices(storeId);assert.ok(queries.slice(getQueriesStart).every(q=>/^select /i.test(q.trim())));
  const postCount=vendor.posts.length;
  const order=[key(lockId),key(plugId)];await service.saveStoreDeviceOrder(storeId,actorId,order);
  const preferences=(await db.query("select settings from module_settings where scope_key=$1",['store:'+storeId])).rows[0].settings;
  assert.deepEqual(preferences,{directDeviceIds:[plugId],preserved:'yes',deviceOrder:order},'sorting preserves private bindings and other settings');
  assert.deepEqual(plain((await service.getStoreDevices(storeId)).devices.slice(0,2).map(d=>d.key)),order,'saved order survives a fresh service read');
  for(const invalid of [[key(foreignId)],[key(foreignPlugId)],[key(botId),key(botId)],['bad'],Array(129).fill(key(botId))])await assert.rejects(()=>service.saveStoreDeviceOrder(storeId,actorId,invalid),e=>e.status===400);
  await assert.rejects(()=>service.saveStoreDeviceOrder(otherStoreId,actorId,order),e=>e.status===409);
  assert.equal(vendor.posts.length,postCount,'ordering sends no device commands');
  await expire();await send(plugId,'turnOff');assert.deepEqual(vendor.posts.at(-1).body,{command:'turnOff',parameter:'default',commandType:'command'});assert.match(vendor.posts.at(-1).url,new RegExp(plugId));
  await expire();await send(plugId,'turnOn');assert.equal(vendor.posts.at(-1).body.command,'turnOn','explicit on is sent even when cloud already says on');
  vendor.plugPower='unknown';await expire();assert.equal((await send(plugId,'turnOff')).command.reason,'invalid_power_state');assert.equal(vendor.posts.length,postCount+2);
  vendor.plugPower='off';vendor.plugHub=foreignId;assert.equal((await service.getStoreDevices(storeId,key(plugId))).devices[0].issue,'device_mismatch');
  t.diagnostic('Nine devices; read-only status; preserved history; 10-second completion cooldown; in-flight protection; shared legacy lock; guarded shade/lock controls; no command retries.');
 }finally{await db.close();}
});

test('route enforces session, role, active store, origin, confirmation and typed input',async()=>{
 let actor={id:actorId,role:'store_terminal'},visible=[{id:storeId}],calls=[];
 class StoreDeviceError extends Error { constructor(message,status){super(message);this.status=status;} }
 const service={StoreDeviceError,getStoreDevices:async(...args)=>{calls.push(['read',...args]);return{configured:true,devices:[]};},saveStoreDeviceOrder:async(...args)=>{calls.push(['order',...args]);return{order:args[2]};},requestStoreDeviceCommand:async(...args)=>{calls.push(['command',...args]);return{command:{result:'accepted'}};}};
 const route=load('app/api/store/devices/route.ts',{'api-auth':{requireOsSession:async()=>actor},'store-order-access':{getStoreOrderAccess:async()=>({stores:visible})},'store-devices':service});
 const key='a'.repeat(24),post=(patch={},origin='http://test')=>route.POST(new Request('http://test/api/store/devices',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({storeId,device:key,requestId:crypto.randomUUID(),action:'press',confirmed:true,...patch})}));
 const get=()=>route.GET(new Request(`http://test/api/store/devices?storeId=${storeId}`));
 assert.equal((await post()).status,200);assert.equal((await get()).status,200);calls=[];
 for(const [label,setup,patch,code] of [
 ['logged out',()=>{actor=null;},{},401],['staff',()=>{actor={id:actorId,role:'staff'};},{},403],
 ['cross store',()=>{actor={id:actorId,role:'store_terminal'};},{storeId:otherStoreId},403],
 ['inactive store',()=>{visible=[];},{},403],['missing store',()=>{visible=[{id:storeId}];},{storeId:''},400],
 ['arbitrary ID',()=>{},{device:botId},400],['no confirmation',()=>{},{confirmed:false},400],
 ['invalid request ID',()=>{},{requestId:'repeat'},400],['invalid shade position',()=>{},{action:'setPosition',position:101},400],
 ['fractional shade position',()=>{},{action:'setPosition',position:1.5},400],['string position',()=>{},{action:'setPosition',position:'37'},400]
 ]){setup();assert.equal((await post(patch)).status,code,label);}
 assert.equal((await post({},'https://other.example')).status,403);assert.equal(calls.length,0,'denied requests never touch devices');
 actor=null;assert.equal((await get()).status,401);assert.equal(calls.length,0);
 actor={id:actorId,role:'owner'};assert.equal((await post({action:'setPosition',position:37})).status,200);assert.equal(calls.at(-1).at(-1),'37');
 const patch=(body={storeId,order:[key]},origin='http://test')=>route.PATCH(new Request('http://test/api/store/devices',{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 calls=[];assert.equal((await patch()).status,200);assert.deepEqual(plain(calls[0]),['order',storeId,actorId,[key]]);calls=[];
 actor=null;assert.equal((await patch()).status,401);actor={id:actorId,role:'staff'};assert.equal((await patch()).status,403);
 actor={id:actorId,role:'owner'};assert.equal((await patch({storeId:otherStoreId,order:[]})).status,403);assert.equal((await patch(undefined,'https://other.example')).status,403);assert.equal((await patch({storeId,order:'bad'})).status,400);assert.equal(calls.length,0);

});

test('nested device results override an outer success and never trigger a resend',async()=>{
 const device={id:shadeId,type:'Roller Shade',kind:'shade',cloud:true},config={storeId,botId,hubId,token:env.SWITCHBOT_TOKEN,secret:env.SWITCHBOT_SECRET,controlEnabled:true};
 for(const [body,code,uncertain] of [
  [{items:[{deviceID:shadeId,code:100,status:{}}]},null,false],
  [{items:[{deviceId:shadeId.toLowerCase(),code:100}]},null,false],
  [{},null,false],
  [{items:[{deviceID:shadeId,code:190,message:'invalid command format'}]},'api_190',false],
  [{items:[{deviceID:shadeId,code:160}]},'api_160',false],
  [{items:[{deviceID:shadeId,code:161}]},'api_161',false],
  [{items:[{deviceID:shadeId,code:171}]},'api_171',false],
  [{code:190},'api_190',false],
  [{items:[{deviceID:shadeId,code:500}]},'api_500',true],
  [{items:[{deviceID:botId,code:100}]},'device_result_missing',true],
  [{items:[]},'device_result_missing',true],
  [{items:'invalid'},'invalid_device_result',true],
  [{items:[{deviceID:shadeId,code:'100'}]},'invalid_device_result',true]
 ]){
  let posts=0;const adapter=load('lib/switchbot.ts',{}, {fetch:async(url,init)=>{posts++;assert.equal(init.method,'POST');assert.equal(url,`https://api.switch-bot.com/v1.1/devices/${shadeId}/commands`);assert.deepEqual(JSON.parse(init.body),{command:'setPosition',parameter:'43',commandType:'command'});return Response.json({statusCode:100,body,message:'success'});}});
  if(code)await assert.rejects(()=>adapter.sendStoreDeviceCommand(config,device,'setPosition','43'),e=>e.code===code&&e.uncertain===uncertain);
  else await adapter.sendStoreDeviceCommand(config,device,'setPosition','43');
  assert.equal(posts,1,'no automatic retry even when nested result is uncertain');
 }
});
