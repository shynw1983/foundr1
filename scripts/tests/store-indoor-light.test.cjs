// Real route/service/adapter code with a local PostgreSQL engine and fake devices.
// No production DB, credentials, or physical SwitchBot commands are used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const storeId = '10000000-0000-4000-8000-000000000001';
const otherStoreId = '10000000-0000-4000-8000-000000000002';
const actorId = '20000000-0000-4000-8000-000000000001';
const botId = 'ABCDEF123456';
const hubId = 'ABCDEF654321';
const env = { SWITCHBOT_TOKEN: 'test-token', SWITCHBOT_SECRET: 'test-secret', SWITCHBOT_INDOOR_LIGHT_STORE_ID: storeId, SWITCHBOT_INDOOR_LIGHT_BOT_ID: botId, SWITCHBOT_INDOOR_LIGHT_HUB_ID: hubId, SWITCHBOT_CONTROL_ENABLED: 'true' };

function load(file, modules = {}, globals = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const context = { exports: {}, Response, Request, URL, AbortSignal, Date, Buffer, process: { env }, console,
    require: name => Object.hasOwn(modules, name.split('/').at(-1)) ? modules[name.split('/').at(-1)] : require(name), ...globals };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context, { filename: file });
  return context.exports;
}
const state = load('lib/store-light-state.ts');
const plain = value => JSON.parse(JSON.stringify(value));

test('light inference covers calibration, dead band, missing, invalid, stale and future readings', () => {
  const timestamp = new Date().toISOString();
  for (const [level, expected] of [[1,'off'],[2,'off'],[3,'off'],[4,'unknown'],[9,'unknown'],[10,'on'],[12,'on'],[20,'on'],[0,'unknown'],[21,'unknown'],[null,'unknown'],['12','unknown'],[2.5,'unknown']]) assert.equal(state.estimateIndoorLight(level,timestamp),expected);
  assert.equal(state.estimateIndoorLight(12,new Date(Date.now()-120001).toISOString()),'unknown');
  assert.equal(state.estimateIndoorLight(12,new Date(Date.now()+60000).toISOString()),'unknown');
  assert.equal(state.estimateIndoorLight(12,null),'unknown');
  const view = { sample:{lightLevel:12},fetchedAt:timestamp,readError:false,command:{result:'accepted',requestedAt:timestamp,finishedAt:timestamp,beforeState:'off'} };
  assert.equal(state.lightCommandObservation(view),'waiting','a pre-command reading cannot confirm a change');
  assert.equal(state.lightCommandObservation({...view, command:{...view.command,requestedAt:new Date(Date.now()-10000).toISOString(),finishedAt:new Date(Date.now()-6000).toISOString()}}),'changed');
});

test('adapter signs requests and never treats Bot power as the lamp state', async () => {
  const calls = [];
  const adapter = load('lib/switchbot.ts',{}, {fetch: async(url, init) => {
    calls.push({url,init});
    const headers=init.headers;
    assert.equal(headers.sign,crypto.createHmac('sha256',env.SWITCHBOT_SECRET).update(env.SWITCHBOT_TOKEN+headers.t+headers.nonce).digest('base64'));
    assert.equal(init.redirect,'error');
    return Response.json({statusCode:100,body:url.endsWith('/commands')?{}:url.includes(hubId)?{deviceId:hubId,deviceType:'Hub 2',lightLevel:2}:{deviceId:botId,deviceType:'Bot',hubDeviceId:hubId,deviceMode:'pressMode',power:'on',battery:100}});
  }});
  assert.equal(adapter.indoorLightConfig(otherStoreId),null);
  const config=adapter.indoorLightConfig(storeId);
  const sample=await adapter.readIndoorLight(config);
  assert.deepEqual(plain(sample),{lightLevel:2,battery:100,botMode:'pressMode'});
  await adapter.pressIndoorLight(config);
  assert.equal(calls.filter(c=>c.init.method==='POST').length,1);
  assert.equal(calls.at(-1).url,`https://api.switch-bot.com/v1.1/devices/${botId}/commands`);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),{command:'press',parameter:'default',commandType:'command'});
  for(const failure of ['timeout','server','malformed']) {
    let count=0;
    const broken=load('lib/switchbot.ts',{}, {fetch:async()=>{count++; if(failure==='timeout')throw Error('connection lost');return new Response(failure==='malformed'?'not-json':'error',{status:failure==='server'?503:200});}});
    await assert.rejects(()=>broken.pressIndoorLight(config),error=>error.uncertain===true);
    assert.equal(count,1,'ambiguous commands are never retried');
  }
});

test('persistence, concurrent requests, cache expiry, access control and uncertain command recovery', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create table stores(id uuid primary key);create table employees(id uuid primary key);insert into stores values('${storeId}'),('${otherStoreId}');insert into employees values('${actorId}');`);
    const migration=fs.readFileSync('db/migrations/20260929-store-indoor-light.sql','utf8');
    await db.exec(migration); await db.exec(migration);
    assert.ok(fs.readFileSync('db/schema.sql','utf8').endsWith(migration),'canonical schema includes exact migration');
    assert.equal((await db.query('select count(*)::int as n from stores')).rows[0].n,2,'existing records preserved');
    const sql=async(strings,...values)=> (await db.query(strings.reduce((q,s,i)=>q+(i?'$'+i:'')+s,''),values)).rows;
    let presses=0,reads=0,level=12,mode='pressMode',readFails=false,postMode='ok';
    const adapter=load('lib/switchbot.ts',{}, {fetch:async(url,init)=>{
      if(init.method==='POST') {
        presses++;
        assert.equal((await db.query("select count(*)::int as n from store_light_commands where result='pending'")).rows[0].n,1,'journal exists before physical side effect');
        if(postMode==='timeout')throw Error('response lost');
        if(postMode==='offline')return Response.json({statusCode:161});
        return Response.json({statusCode:100,body:{}});
      }
      reads++;
      if(readFails) throw Error('offline');
      return Response.json({statusCode:100,body:url.includes(hubId)?{deviceId:hubId,deviceType:'Hub 2',lightLevel:level}:{deviceId:botId,deviceType:'Bot',hubDeviceId:hubId,deviceMode:mode,battery:100,power:'on'}});
    }});
    const service=load('lib/store-indoor-light.ts',{db:{sql},'switchbot':adapter,'store-light-state':state});
    const expire=()=>db.exec("update store_light_runtime set refresh_after=now()-interval '1 second',blocked_until=now()-interval '1 second'");
    const before=await service.getIndoorLight(storeId);
    assert.equal(before.estimate,'on');assert.equal(before.canPress,true);
    assert.equal(reads,2);
    await Promise.all([service.getIndoorLight(storeId),service.getIndoorLight(storeId)]);
    assert.equal(reads,2,'shared cache avoids repeating upstream reads');
    const other=await service.getIndoorLight(otherStoreId);
    assert.equal(other.configured,false);assert.equal(reads,2,'unconfigured store cannot read devices');
    assert.ok(!JSON.stringify(before).includes(env.SWITCHBOT_TOKEN));
    assert.ok(!JSON.stringify(before).includes(botId),'physical identifiers stay server-side');
    const id=crypto.randomUUID();
    const concurrent=await Promise.allSettled([service.requestIndoorLightPress(storeId,actorId,id),service.requestIndoorLightPress(storeId,actorId,crypto.randomUUID())]);
    assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(presses,1,'concurrent different IDs cause exactly one press');
    const accepted=await service.requestIndoorLightPress(storeId,actorId,id);
    assert.equal(accepted.result,'accepted'); assert.equal(presses,1,'same ID replay does not resend');
    await expire();
    await service.requestIndoorLightPress(storeId,actorId,id);
    assert.equal(presses,1,'same ID remains idempotent after cooldown');
    postMode='timeout';
    const unknownId=crypto.randomUUID();
    const unknown=await service.requestIndoorLightPress(storeId,actorId,unknownId);
    assert.equal(unknown.result,'unknown'); assert.equal(presses,2);
    await service.requestIndoorLightPress(storeId,actorId,unknownId);
    assert.equal(presses,2,'lost acknowledgement is not retried');
    await expire();mode='switchMode';
    const rejected=await service.requestIndoorLightPress(storeId,actorId,crypto.randomUUID());
    assert.equal(rejected.result,'rejected');assert.equal(presses,2,'changed Bot mode cannot receive press');
    mode='pressMode';level=6;await expire();
    assert.equal((await service.getIndoorLight(storeId)).estimate,'unknown');
    readFails=true;await expire();
    const failed=await service.getIndoorLight(storeId);
    assert.equal(failed.readError,true);assert.equal(failed.estimate,'unknown');assert.equal(failed.canPress,false);
    readFails=false;level=2;await expire();
    // Remove old command from this isolated fixture so its observation window does not obscure sensor assertions.
    await db.exec('delete from store_light_commands');
    assert.equal((await service.getIndoorLight(storeId)).estimate,'off');
    await db.exec("update store_light_runtime set fetched_at=now()-interval '3 minutes',refresh_after=now()+interval '1 hour'");
    const stale=await service.getIndoorLight(storeId);
    assert.equal(stale.estimate,'unknown');assert.equal(stale.canPress,false);
    const pendingId=crypto.randomUUID();
    await db.query("insert into store_light_commands(id,store_id,device_id,result,requested_at) values($1,$2,$3,'pending',now()-interval '2 minutes')",[pendingId,storeId,botId]);
    assert.equal((await service.requestIndoorLightPress(storeId,actorId,pendingId)).result,'unknown');
    assert.equal(presses,2,'abandoned pending records are not resumed');
    let actor={id:actorId,role:'store_terminal'},visible=[{id:storeId}],calls=[];
    const route=load('app/api/store/indoor-light/route.ts',{
      'api-auth':{requireOsSession:async()=>actor},
      'store-order-access':{getStoreOrderAccess:async()=>({stores:visible})},
      'store-indoor-light':{...service,getIndoorLight:async id=>{calls.push('read');return service.getIndoorLight(id);},requestIndoorLightPress:async(...args)=>{calls.push('press');return {id:args[2],result:'accepted'};}}
    });
    const post=(patch={},origin='http://test')=>route.POST(new Request('http://test/api/store/indoor-light',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({storeId,requestId:crypto.randomUUID(),action:'press',...patch})}));
    assert.equal((await post()).status,200);assert.equal(calls.at(-1),'press');calls=[];
    for(const [label,setup,patch,code] of [
      ['logged out',()=>{actor=null;},{},401],
      ['staff surface',()=>{actor={id:actorId,role:'staff'};},{},403],
      ['cross store',()=>{actor={id:actorId,role:'store_terminal'};},{storeId:otherStoreId},403],
      ['inactive store',()=>{visible=[];},{},403],
      ['missing store',()=>{visible=[{id:storeId}];},{storeId:''},400],
      ['arbitrary command',()=>{},{action:'unlock'},400],
      ['invalid command ID',()=>{},{requestId:'repeat'},400]
    ]){setup();assert.equal((await post(patch)).status,code,label);}
    assert.equal((await post({},'https://other.example')).status,403);
    assert.equal(calls.length,0,'denied requests perform no device access');
    actor=null;
    assert.equal((await route.GET(new Request(`http://test/api/store/indoor-light?storeId=${storeId}`))).status,401);
    t.diagnostic('Migration rerun, retained store records, real SQL claim, concurrency, duplicate/recovery, cache and role/store/origin guards passed.');
  } finally { await db.close(); }
});
