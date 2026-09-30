const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {fixture,policy,ids}=require('./store-scenes-fixture.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));

test('Roller Shade numeric transport changes position while journal text and replay are preserved',async()=>{
 const f=await fixture();try{
  for(const position of [10,0,100]){
   await f.expire();const id=randomUUID(),before=f.posts.length;
   const result=await f.service.requestStoreDeviceCommand(f.storeId,f.actorId,f.key(ids.shade),id,'setPosition',String(position));
   assert.equal(result.command.result,'accepted');
   assert.deepEqual(f.posts.slice(before),[{id:ids.shade,command:'setPosition',parameter:position,commandType:'command'}]);
   const device=(await f.service.getStoreDevices(f.storeId,f.key(ids.shade))).devices[0];
   assert.equal(device.sample.position,position,'provider acknowledgement alone does not move a string percentage');
   assert.equal(device.command.parameter,String(position),'public/journal parameter remains text');
   const row=(await f.db.query('select parameter from store_light_commands where id=$1',[id])).rows[0];
   assert.equal(row.parameter,String(position));
   await f.service.requestStoreDeviceCommand(f.storeId,f.actorId,f.key(ids.shade),id,'setPosition',String(position));
   assert.equal(f.posts.length,before+1,'same request ID cannot send the numeric command twice');
  }
  const count=f.posts.length;
  for(const invalid of ['-1','101','','0,ff,10','garbage']){
   await assert.rejects(()=>f.service.requestStoreDeviceCommand(f.storeId,f.actorId,f.key(ids.shade),randomUUID(),'setPosition',invalid),e=>e.status===400);
  }
  assert.equal(f.posts.length,count,'invalid values cannot become zero or NaN during transport conversion');
 }finally{await f.db.close();}
});

test('indoor scene targets only press in the opposite calibrated range',()=>{
 for(const level of [1,2,3,4,9,10,12,20]){
  const sample={botMode:'pressMode',lightLevel:level};
  assert.equal(Boolean(policy.indoorSceneDecision(sample,'turnOff').skip),level<10);
  assert.equal(Boolean(policy.indoorSceneDecision(sample,'turnOn').skip),level>3);
 }
 for(const lightLevel of [0,21,null,undefined,'12',2.5])assert.equal(policy.indoorSceneDecision({botMode:'pressMode',lightLevel},'turnOff').skip,'invalid_light_level');
 assert.deepEqual(plain(policy.indoorSceneDecision({botMode:'switchMode',power:'on'},'turnOff')),{action:'turnOff',skip:''});
});

test('scene definitions are store scoped, revision protected, and preserve other device settings',async()=>{
 const f=await fixture();try{
  const migration=fs.readFileSync('db/migrations/20260930-store-device-scenes.sql','utf8');
  const before=(await f.db.query('select * from module_settings')).rows;
  await f.db.exec(migration);assert.deepEqual((await f.db.query('select * from module_settings')).rows,before);
  const start=f.queries.length,v=await f.scenes.getStoreScenes(f.storeId);
  assert.ok(f.queries.slice(start).every(q=>/^select/i.test(q.trim())),'GET never writes');
  assert.equal(v.scenes[0].name,'休憩モード');assert.ok(v.devices.every(d=>Object.keys(d).sort().join(',')==='key,kind,name'),'native confirmation gets names without raw vendor IDs');assert.deepEqual(plain(v.scenes[0].steps.map(s=>s.action)),['turnOff','turnOn','setPosition','lock']);
  assert.equal(f.posts.length,0);assert.equal(f.reads.filter(s=>s.endsWith('/status')).length,0,'scene configuration does not wake every device');
  const saved=await f.scenes.saveStoreScenes(f.storeId,f.actorId,v.scenes,'');
  assert.ok(saved.revision);await assert.rejects(()=>f.scenes.saveStoreScenes(f.storeId,f.actorId,[],''),e=>e.status===409);
  assert.equal((await f.scenes.getStoreScenes(f.storeId)).scenes[0].steps.length,4);
  const corrupt=structuredClone(plain(v.scenes));corrupt[0].steps[0].device=f.key(ids.foreign);
  await assert.rejects(()=>f.scenes.saveStoreScenes(f.storeId,f.actorId,corrupt,saved.revision),e=>e.status===400);
  corrupt[0].steps[0].device=f.key(ids.light);corrupt[0].steps[0].action='press';
  await assert.rejects(()=>f.scenes.saveStoreScenes(f.storeId,f.actorId,corrupt,saved.revision),e=>e.status===400,'indoor scenes cannot bypass conditional power targets');
  for(const invalid of [[{...plain(v.scenes[0]),name:' '}],[{...plain(v.scenes[0]),steps:[v.scenes[0].steps[0],v.scenes[0].steps[0]]}],[{...plain(v.scenes[0]),steps:[{device:f.key(ids.shade),action:'setPosition',position:101}]}]])assert.equal(policy.validScenes(invalid),false);
  const concurrent=await Promise.allSettled([f.scenes.saveStoreScenes(f.storeId,f.actorId,[],saved.revision),f.scenes.saveStoreScenes(f.storeId,f.actorId,v.scenes,saved.revision)]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1,'only one writer can use the same revision');
  const latest=await f.scenes.getStoreScenes(f.storeId);await f.scenes.saveStoreScenes(f.storeId,f.actorId,[],latest.revision);
  assert.equal((await f.scenes.getStoreScenes(f.storeId)).scenes.length,0,'deleted default does not reappear');
  assert.equal((await f.db.query("select settings->>'preserved' as value from module_settings where module_key='store_devices'")).rows[0].value,'keep');
  assert.equal((await f.scenes.getStoreScenes(f.otherStoreId)).configured,false);
 }finally{await f.db.close();}
});

test('real scene executor skips dim indoor light and sends the remaining commands in order exactly once',async()=>{
 const f=await fixture();try{
  const v=await f.scenes.getStoreScenes(f.storeId),scene=v.scenes[0];
  for(const level of [1,2,3,4,9,10,12,20]){
   f.vendor.level=level;await f.expire();const before=f.posts.length,requestId=randomUUID();
   const started=await f.scenes.createStoreSceneRun(f.storeId,f.actorId,scene.id,requestId,'',false);assert.ok(started.created);
   assert.equal(f.posts.length,before,'creating/confirming a run only schedules it');
   await f.scenes.executeStoreSceneRun(f.storeId,requestId);
   const run=await f.scenes.getStoreSceneRun(f.storeId,requestId);
   assert.equal(run.status,'finished');assert.equal(run.steps[0].status,level<10?'skipped':'sent');
   const expected=[...(level>=10?[{id:ids.light,command:'press',parameter:'default',commandType:'command'}]:[]),
    {id:ids.ambient,command:'turnOn',parameter:'default',commandType:'command'},
    {id:ids.shade,command:'setPosition',parameter:100,commandType:'command'},
    {id:ids.lock,command:'lock',parameter:'default',commandType:'command'}];
   assert.deepEqual(f.posts.slice(before),expected);
   const count=f.posts.length;
   assert.equal((await f.scenes.createStoreSceneRun(f.storeId,f.actorId,scene.id,requestId,'',false)).created,false);
   await f.scenes.executeStoreSceneRun(f.storeId,requestId);assert.equal(f.posts.length,count,'replayed run/worker sends nothing');
   assert.equal(await f.scenes.getStoreSceneRun(f.otherStoreId,requestId),null);
  }
  await f.expire();f.vendor.level=2;const before=f.posts.length;
  await f.service.requestStoreDeviceCommand(f.storeId,f.actorId,f.key(ids.light),randomUUID(),'press','default');
  assert.equal(f.posts.length,before+1,'deliberate manual press remains available');
 }finally{await f.db.close();}
});

test('failures and uncertain responses are recorded independently without retrying physical commands',async()=>{
 const f=await fixture();try{
  const scene=(await f.scenes.getStoreScenes(f.storeId)).scenes[0];
  f.vendor.failLight=true;f.vendor.door='open';let id=randomUUID();
  await f.scenes.createStoreSceneRun(f.storeId,f.actorId,scene.id,id,'',false);await f.scenes.executeStoreSceneRun(f.storeId,id);
  let run=await f.scenes.getStoreSceneRun(f.storeId,id);
  assert.deepEqual(plain(run.steps.map(s=>s.status)),['failed','sent','sent','failed']);
  assert.deepEqual(f.posts.map(p=>p.id),[ids.ambient,ids.shade]);assert.equal(run.steps[3].reason,'door_not_closed');
  f.vendor.failLight=false;f.vendor.door='closed';f.vendor.postError=ids.light;await f.expire();id=randomUUID();
  const before=f.posts.length;await f.scenes.createStoreSceneRun(f.storeId,f.actorId,scene.id,id,'',false);await f.scenes.executeStoreSceneRun(f.storeId,id);
  run=await f.scenes.getStoreSceneRun(f.storeId,id);assert.deepEqual(plain(run.steps.map(s=>s.status)),['unknown','sent','sent','sent']);
  await f.scenes.executeStoreSceneRun(f.storeId,id);assert.equal(f.posts.length-before,4);
  assert.equal((await f.db.query("select count(*)::int as n from store_light_commands where result='unknown'")).rows[0].n,1);
 }finally{await f.db.close();}
});

test('concurrent runs and workers share a durable store/device claim; expired work is never resumed',async()=>{
 const f=await fixture();try{
  const scene=(await f.scenes.getStoreScenes(f.storeId)).scenes[0],id=randomUUID();
  const duplicate=await Promise.all([1,2].map(()=>f.scenes.createStoreSceneRun(f.storeId,f.actorId,scene.id,id,'',false)));
  assert.equal(duplicate.filter(r=>r.created).length,1);
  await assert.rejects(()=>f.scenes.createStoreSceneRun(f.storeId,f.actorId,scene.id,randomUUID(),'',false),e=>e.status===409);
  await assert.rejects(()=>f.service.requestStoreDeviceCommand(f.storeId,f.actorId,f.key(ids.light),randomUUID(),'press','default'),e=>e.status===409);
  await Promise.all([f.scenes.executeStoreSceneRun(f.storeId,id),f.scenes.executeStoreSceneRun(f.storeId,id)]);assert.equal(f.posts.length,4);
  const expired=randomUUID();await f.scenes.createStoreSceneRun(f.storeId,f.actorId,scene.id,expired,'',false);
  await f.db.query("update store_device_scene_runs set expires_at=now()-interval '1 second', steps=jsonb_set(steps,'{0,status}','\"running\"') where id=$1",[expired]);
  await f.scenes.executeStoreSceneRun(f.storeId,expired);assert.equal(f.posts.length,4);
  let abandoned=await f.scenes.getStoreSceneRun(f.storeId,expired);assert.equal(abandoned.status,'interrupted');assert.equal(abandoned.steps[0].status,'unknown');assert.equal(abandoned.steps[1].status,'not_run');
  await f.scenes.createStoreSceneRun(f.storeId,f.actorId,scene.id,randomUUID(),'',false);
  abandoned=await f.scenes.getStoreSceneRun(f.storeId,expired);assert.equal(abandoned.steps[0].status,'unknown');
 }finally{await f.db.close();}
});

test('scene routes enforce role, scope, confirmation, revision and unlock consent before scheduling',async()=>{
 const f=await fixture();try{
  const scene=(await f.scenes.getStoreScenes(f.storeId)).scenes[0];
  const body={sceneId:scene.id,requestId:randomUUID(),revision:'',confirmed:true};
  f.auth.session=null;assert.equal((await f.route.POST(f.request('POST',body))).status,401);
  f.auth.session={id:f.actorId,role:'staff'};assert.equal((await f.route.GET(f.request('GET'))).status,403);
  f.auth.session.role='owner';f.auth.stores=[];assert.equal((await f.route.PATCH(f.request('PATCH',{scenes:[scene],revision:''}))).status,403);
  f.auth.stores=[{id:f.storeId}];assert.equal((await f.route.POST(f.request('POST',{...body,confirmed:false}))).status,400);
  const foreign=f.request('POST',body);foreign.headers.set('Origin','https://foreign.example');assert.equal((await f.route.POST(foreign)).status,403);
  const unlock={id:randomUUID(),name:'開店',steps:[{device:f.key(ids.lock),action:'unlock'}]};const saved=await f.scenes.saveStoreScenes(f.storeId,f.actorId,[unlock],'');
  assert.equal((await f.route.POST(f.request('POST',{...body,sceneId:unlock.id,revision:saved.revision}))).status,400);
  assert.equal((await f.route.POST(f.request('POST',{...body,sceneId:unlock.id,revision:'',allowUnlock:true}))).status,409);
  assert.equal(f.jobs.length,0);assert.equal(f.posts.length,0);
  const response=await f.route.POST(f.request('POST',{...body,sceneId:unlock.id,revision:saved.revision,allowUnlock:true}));assert.equal(response.status,202);
  assert.equal(f.jobs.length,1);assert.equal(f.posts.length,0);await f.jobs[0]();assert.equal(f.posts[0].command,'unlock');
  const replay=await f.route.POST(f.request('POST',{...body,sceneId:unlock.id,revision:saved.revision,allowUnlock:true}));assert.equal(replay.status,200);assert.equal(f.jobs.length,1);
 }finally{await f.db.close();}
});
