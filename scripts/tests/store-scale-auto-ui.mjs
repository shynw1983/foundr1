// Real POS scale component and relay hook, with isolated HTTP fixtures only.
// This never calls production, Bluetooth APIs, a physical scale, or a printer.
import { build, stop } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = resolve(process.env.SCALE_AUTO_UI_OUTPUT || 'outputs/store-pos-reliability-20261017/scale');
await mkdir(output, { recursive: true });
const entry = `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{StoreRelayScale,scaleSnapshotBlocksConfirmation}from'./app/store/components/StoreRelayScale';
import{useStoreRelay}from'./app/store/components/useStoreRelay';
import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
const params=new URLSearchParams(location.search);localStorage.setItem('foundr1-os-language',params.get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
localStorage.removeItem('store-relay-owner:fixture-store');
if(params.get('owner')!=='false')sessionStorage.setItem('store-relay-owner:fixture-store',JSON.stringify({stationId:'station-a',token:'fixture-owner',epoch:7}));else sessionStorage.removeItem('store-relay-owner:fixture-store');
window.__scaleCaptures=[];window.__scaleFixture={};
function Fixture(){const relay=useStoreRelay('fixture-store');const[item,setItem]=useState('bowl-a');const[open,setOpen]=useState(true);const[manual,setManual]=useState(false);const[weight,setWeight]=useState('');const[validity,setValidity]=useState(null);
useEffect(()=>{window.__scaleFixture={refresh:relay.refresh,action:relay.action,setOpen,setItem:item=>{setWeight('');setManual(false);setItem(item)},setManual,state:()=>({item,open,manual,weight,validity,error:relay.error,owner:relay.owner,station:relay.station,recoveryVersion:relay.recoveryVersion})};},[relay,item,open,manual,weight,validity]);
const ready=validity?.ready&&validity.scopeKey===item&&validity.ownerToken===relay.owner?.token&&validity.epoch===relay.owner?.epoch&&validity.recoveryVersion===relay.recoveryVersion&&!scaleSnapshotBlocksConfirmation(relay.station,Number(weight),relay.now());
return <main className="store-pos-page" style={{padding:16,maxWidth:900,margin:'0 auto'}}><h1>自選マーラータン</h1><p>商品を開くと自動計量し、安定した重量を入力します。</p>
{open?<section role="dialog" aria-modal="true" aria-label="商品オプション"><h2>{item}</h2><StoreRelayScale relay={relay} scopeKey={item} manualMode={manual} onManualModeChange={setManual} onValidityChange={setValidity} onAdopt={(id,grams)=>{window.__scaleCaptures.push({item,id,grams});setWeight(String(grams))}}/><label style={{display:'grid',gap:8,marginTop:16}}>自選食材の重量<input data-fixture-weight aria-label="自選食材の重量" inputMode="decimal" value={weight} onChange={event=>{setManual(true);setWeight(event.target.value)}}/></label><button data-fixture-add type="button" disabled={!Number(weight)||(!manual&&!ready)}>この内容で追加</button><button type="button" onClick={()=>setOpen(false)}>閉じる</button></section>:<p>商品画面を閉じました。</p>}</main>}
createRoot(document.getElementById('root')).render(<OsTranslationProvider><Fixture/></OsTranslationProvider>);`;

const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = (await readFile('app/globals.css', 'utf8')) + '\n' + (await readFile('app/store/store-responsive.css', 'utf8')) + '\n' + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async language => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
let station, posts, pending, sessionCounter, captureCounter;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function reset(patch = {}) {
  station = { id: 'station-a', name: 'レジ A', enabled: true, print_enabled: true, scale_enabled: true, epoch: 7, owner_until: new Date(Date.now() + 60000).toISOString(), device_online: true, device_paired: true, scale_session: null, scale_sequence: -1, scale_reading: null, scale_received_at: null, device_status: { scale: 'connected' }, ...patch };
  posts = []; pending = []; sessionCounter = 0; captureCounter = 0;
}
reset();
function plan(action, { error, status = 409, hold = false } = {}) {
  const gate = deferred(); const next = { action, error, status, hold, gate, seen: false }; pending.push(next); return next;
}
function reading({ grams = 321, stable = true, overload = false, age = 0, ...patch } = {}) {
  station = { ...station, scale_sequence: station.scale_sequence + 1, scale_reading: { grams, stable, overload }, scale_received_at: new Date(Date.now() - age).toISOString(), ...patch };
}
const requests = [], externalRequests = [], pageErrors = [], checks = [];
const send = (response, body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); response.end(js); return; }
    if (url.pathname.startsWith('/locales/os/')) { send(response, dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']); return; }
    if (url.pathname === '/api/auth/me') { send(response, { employee: { id: 'fixture-employee', name: 'Fixture', role: 'owner' } }); return; }
    if (url.pathname === '/api/store/device-relay') {
      if (request.method === 'GET') { send(response, { serverNow: new Date().toISOString(), serverElapsedMs: 0, stations: [station], jobs: [] }); return; }
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); posts.push(body);
      const next = pending.find(next => !next.seen && next.action === body.action);
      if (next) { next.seen = true; if (next.hold && ['scaleEnd', 'heartbeat', 'resume'].includes(body.action)) await next.gate.promise; if (next.error) { send(response, { error: next.error }, next.status); return; } }
      if (body.action === 'claim' || body.action === 'takeover') {
        station = { ...station, epoch: station.epoch + 1, owner_until: new Date(Date.now() + 60000).toISOString(), scale_session: null, scale_sequence: -1, scale_reading: null, scale_received_at: null };
        send(response, { ok: true, owner: { stationId: station.id, token: `fixture-owner-${station.epoch}`, epoch: station.epoch } }); return;
      }
      if (body.action === 'scaleStart') {
        const scaleSession = body.scaleSession;
        if (!scaleSession) { send(response, { error: '計量セッションがありません。' }, 400); return; }
        if (scaleSession === station.scale_session) { send(response, { ok: true, scaleSession }); return; }
        if ((body.expectedScaleSession ?? null) !== station.scale_session) { send(response, { error: '計量セッションが変わりました。' }, 409); return; }
        sessionCounter++;
        station = { ...station, scale_session: scaleSession, scale_sequence: -1, scale_reading: null, scale_received_at: null };
        if (next?.hold) await next.gate.promise;
        send(response, { ok: true, scaleSession }); return;
      }
      if (body.action === 'scaleAdopt') {
        if (body.scaleSession !== station.scale_session) { send(response, { error: '計量セッションが変わりました。' }, 409); return; }
        if (body.scaleSequence !== station.scale_sequence) { send(response, { error: '重量が更新されました。' }, 409); return; }
        const capture = { id: `capture-${++captureCounter}`, grams: station.scale_reading?.grams };
        const scaleSequence = station.scale_sequence;
        station = { ...station, scale_session: null, scale_sequence: -1, scale_reading: null, scale_received_at: null };
        if (next?.hold) await next.gate.promise;
        send(response, { ok: true, capture, scaleSession: body.scaleSession, scaleSequence }); return;
      }
      if (body.action === 'scaleEnd') {
        if (body.scaleSession === station.scale_session) station = { ...station, scale_session: null, scale_sequence: -1, scale_reading: null, scale_received_at: null };
        send(response, { ok: true }); return;
      }
      if (body.action === 'heartbeat' || body.action === 'resume') {
        const expectedToken=station.epoch===7?'fixture-owner':`fixture-owner-${station.epoch}`;
        if(!station.enabled||body.owner?.stationId!==station.id||body.owner?.epoch!==station.epoch||body.owner?.token!==expectedToken){send(response,{error:'操作権が失効しました。'},409);return;}
        const resumed=!(Date.parse(station.owner_until||'')>Date.now());
        if(resumed)station={...station,scale_session:null,scale_tare_context:{},scale_filter_state:{},scale_sequence:-1,scale_reading:null,scale_received_at:null};
        station.owner_until=new Date(Date.now()+45000).toISOString();send(response,{ok:true,resumed,ownerUntil:station.owner_until});return;
      }
      requests.push({ method: request.method, path: url.pathname, action: body.action }); send(response, { error: 'Unexpected action' }, 400); return;
    }
    if (url.pathname.startsWith('/api/')) { requests.push({ method: request.method, path: url.pathname }); send(response, {}, 403); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html);
  } catch (error) { response.writeHead(500); response.end(error.stack); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let page;
async function open(patch = {}, { language = 'ja', owner = true, heartbeatMs = null } = {}) {
  if (page) await page.close();
  reset(patch); page = await browser.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => pageErrors.push(error.message));
  if (heartbeatMs !== null) await page.evaluateOnNewDocument(heartbeatMs => { const original = window.setInterval; window.setInterval = (callback, delay, ...args) => original(callback, delay === 12000 ? heartbeatMs : delay, ...args); }, heartbeatMs);
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.url().startsWith(origin + '/')) request.continue(); else { externalRequests.push(request.url()); request.abort(); } });
  await page.goto(`${origin}/?lang=${language}&owner=${owner}`, { waitUntil: heartbeatMs === null ? 'networkidle0' : 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__scaleFixture.refresh === 'function');
}
const refresh = () => page.evaluate(() => window.__scaleFixture.refresh());
const captures = () => page.evaluate(() => window.__scaleCaptures);
const actions = action => posts.filter(post => post.action === action);
const waitAction = async (action, count = 1) => { for (let step = 0; step < 100; step++) { if (actions(action).length >= count) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error(`Expected ${count} ${action}; actual ${actions(action).length}`); };
const waitSession = async () => { for (let step = 0; step < 100; step++) { if (station.scale_session) return station.scale_session; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Expected an active scale session'); };
const waitNewSession = async previous => { for (let step = 0; step < 100; step++) { if (station.scale_session && station.scale_session !== previous) return station.scale_session; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Expected a new active scale session'); };
const waitWeight = weight => page.waitForFunction(weight => document.querySelector('input[data-fixture-weight]')?.value === String(weight), {}, weight);
const waitAdd = enabled => page.waitForFunction(enabled => document.querySelector('button[data-fixture-add]')?.disabled === !enabled, {}, enabled);
const waitText = text => page.waitForFunction(text => document.body.textContent.includes(text), {}, text);
async function clickContaining(text) { await page.waitForFunction(text => [...document.querySelectorAll('button')].some(button => button.textContent.includes(text)), {}, text); await page.evaluate(text => [...document.querySelectorAll('button')].find(button => button.textContent.includes(text)).click(), text); }
async function settle(ms = 200) { await new Promise(resolve => setTimeout(resolve, ms)); }
async function screenshot(prefix) {
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewport({ width, height }); await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${prefix}: overflow at ${width}px`);
    await page.screenshot({ path: `${output}/${prefix}-${width}.png`, fullPage: true });
  }
}

async function runOwnerRecoveryCases(){
  await open();await waitAction('scaleStart');reading({grams:352});await refresh();await waitWeight(352);await waitAction('scaleStart',2);
  reading({grams:352});await refresh();await waitAdd(true);
  const confirmedBefore=await captures(),oldSession=await waitSession(),oldStarts=actions('scaleStart').length;
  const recoveryBefore=await page.evaluate(()=>window.__scaleFixture.state().recoveryVersion);
  const heldResume=plan('resume',{hold:true});station={...station,owner_until:new Date(Date.now()-1000).toISOString()};
  await refresh();await waitAction('resume',2);await waitAdd(false);assert.equal(heldResume.seen,true);
  heldResume.gate.resolve();await waitNewSession(oldSession);await settle(350);await waitAdd(false);
  assert.equal((await captures()).length,1);assert.ok(actions('scaleStart').length>oldStarts);
  assert.equal(await page.evaluate(()=>window.__scaleFixture.state().owner?.epoch),7);
  assert.ok(await page.evaluate(previous=>window.__scaleFixture.state().recoveryVersion>previous,recoveryBefore));
  reading({grams:352});await refresh();await page.waitForFunction(()=>window.__scaleCaptures.length===2);
  assert.notEqual((await captures())[1].id,confirmedBefore[0].id);
  await waitAction('scaleStart',oldStarts+2);reading({grams:352});await refresh();await waitAdd(true);
  checks.push('same-epoch expiry pauses the confirmed hardware weight; automatic resume needs a new scale session and a distinct capture even when its grams are unchanged');

  await open();await waitAction('scaleStart');const firstSession=await waitSession();
  const staleAdoption=plan('scaleAdopt',{hold:true});reading({grams:453});await refresh();await waitAction('scaleAdopt');
  const pendingResume=plan('resume',{hold:true});station={...station,owner_until:new Date(Date.now()-1000).toISOString()};
  await refresh();await waitAction('resume',2);assert.equal(pendingResume.seen,true);await waitAdd(false);
  pendingResume.gate.resolve();await waitNewSession(firstSession);await waitAction('scaleStart',2);
  staleAdoption.gate.resolve();await settle(650);await waitAdd(false);await waitWeight('');assert.deepEqual(await captures(),[]);
  reading({grams:453});await refresh();await page.waitForFunction(()=>window.__scaleCaptures.length===1);
  assert.equal((await captures())[0].id,'capture-2');await waitAction('scaleStart',3);
  reading({grams:453});await refresh();await waitAdd(true);
  checks.push('a pending pre-expiry hardware adoption cannot populate or enable POS after same-token and same-epoch recovery; only the successor session capture can do so');
  await screenshot('owner-recovery-hardware');
}

try {
  await runOwnerRecoveryCases();
  if(!process.env.SCALE_AUTO_RECOVERY_ONLY){
  // Tests are completed against the actual component contract after implementation.
  await open(); await waitAction('scaleStart');
  assert.equal(actions('scaleStart').length, 1);
  assert.equal(await page.$$eval('button', buttons => buttons.some(button => ['計量を開始', '重量を採用'].includes(button.textContent.trim()))), false);
  await refresh(); await refresh(); await settle(); assert.equal(actions('scaleStart').length, 1);
  checks.push('opening the item automatically starts once; no start or adopt button is required');

  reading({ grams: 325 }); await refresh(); await waitWeight(325); await waitAction('scaleStart', 2); assert.equal((await captures()).length, 1);
  await refresh(); await refresh(); await settle(); assert.equal((await captures()).length, 1);
  reading({ grams: 325 }); await refresh(); await settle();
  assert.equal((await captures()).length, 1);
  reading({ grams: 470 }); await refresh(); await waitWeight(470); await waitAction('scaleStart', 3);
  assert.equal((await captures()).length, 2);
  checks.push('a fresh stable weight is adopted automatically; repeated polling and unchanged samples do not repeatedly adopt; changed stable weight updates');
  // A legacy capture retires its session. The independent successor must see a
  // fresh native frame before the retained weight can be used again.
  await waitAdd(false); reading({ grams: 470 }); await refresh();
  await waitAdd(true);
  await screenshot('stable');

  // Removing a confirmed bowl is normal; a previously invalidated reading is a different state.
  for(const grams of [0,-25]){reading({grams,stable:false});await refresh();await settle(500);await waitAdd(true);await waitWeight(470);}
  checks.push('normal zero and negative readings after removing a confirmed bowl keep its confirmed weight usable');
  station={...station,device_online:false};await refresh();await waitAdd(false);
  station={...station,device_online:true};reading({grams:0});await refresh();await settle(500);await waitAdd(false);
  reading({grams:470});await refresh();await waitAdd(true);
  checks.push('an observed brief disconnect stays invalidated after immediate reconnect with zero; a fresh stable reading is required');
  reading({grams:470,stable:false});await refresh();await waitAdd(false);await waitText('重量を再確認しています。安定するまで追加できません。');
  for(const grams of [0,-25]){reading({grams});await refresh();await settle(500);await waitAdd(false);await waitWeight(470);}
  const currentRecheckSession=station.scale_session;
  station={...station,scale_session:actions('scaleStart')[0].scaleSession};reading({grams:470});await refresh();await settle(500);await waitAdd(false);
  station={...station,scale_session:currentRecheckSession};const beforeRecheckRetry=actions('scaleStart').length;
  await clickContaining('もう一度試す');await waitAction('scaleStart',beforeRecheckRetry+1);await waitNewSession(currentRecheckSession);
  reading({grams:470});await refresh();await waitAdd(true);
  assert.equal((await captures()).length,2,'A current, fresh, same-value ST restores the original immutable capture without recapturing.');
  checks.push('positive US blocks adding the old weight; zero/negative and an old-session GET cannot unlock it; only current-session fresh ST restores readiness');
  reading({grams:470,overload:true});await refresh();await waitAdd(false);
  await screenshot('overload-blocked');
  reading({grams:470});await refresh();await waitAdd(true);
  reading({grams:3400});await refresh();await waitAdd(false);
  reading({grams:470});await refresh();await waitAdd(true);
  checks.push('overload blocks even an unchanged numeric value, and readings beyond the scale range cannot reuse a previous confirmation');

  const delayedCapture=plan('scaleAdopt',{hold:true}),delayedFollowingStart=plan('scaleStart',{hold:true});
  reading({grams:520});await refresh();await waitAction('scaleAdopt',3);await waitAdd(false);await waitWeight(470);
  delayedCapture.gate.resolve();await waitWeight(520);await waitAdd(true);
  for(let step=0;step<100&&!delayedFollowingStart.seen;step++)await settle(50);
  assert.equal(delayedFollowingStart.seen,true);await settle(700);await waitAdd(true);
  delayedFollowingStart.gate.resolve();await refresh();await waitAdd(false);
  reading({grams:520});await refresh();await waitAdd(true);
  reading({grams:470});await refresh();await waitWeight(470);await waitNewSession(currentRecheckSession);await waitAdd(false);
  reading({grams:470});await refresh();await waitAdd(true);
  checks.push('a changed value blocks old-weight addition until capture; a retired null gap preserves it, while a newly active successor needs its own fresh frame');

  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__fixtureVisibility||'visible'});window.__fixtureVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'));});
  await waitAdd(false);const beforeVisibleStart=actions('scaleStart').length;
  await page.evaluate(()=>{window.__fixtureVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));});
  await waitAction('scaleStart',beforeVisibleStart+1);reading({grams:0});await refresh();await settle(500);await waitAdd(false);
  reading({grams:470});await refresh();await waitAdd(true);
  checks.push('hiding the page invalidates readiness; returning with only a removed bowl does not silently restore it before a fresh stable current-session reading');

  for (const sample of [{ grams: 470, stable: false }, { grams: 0 }, { grams: -10 }, { grams: 3400 }, { grams: 500, overload: true }, { grams: 500, age: 6000 }, { grams: 500, age: -10000 }]) {
    const before = actions('scaleAdopt').length; reading(sample); await refresh(); await settle(500); assert.equal(actions('scaleAdopt').length, before, `invalid reading adopted: ${JSON.stringify(sample)}`); await waitWeight(470);await waitAdd(false);
  }
  station = { ...station, device_online: false }; reading({ grams: 700 }); const beforeDisconnect = actions('scaleAdopt').length; await refresh(); await settle(); assert.equal(actions('scaleAdopt').length, beforeDisconnect); await waitWeight(470);await waitAdd(false);
  station={...station,device_online:true};reading({grams:0});await refresh();await settle(500);await waitAdd(false);
  checks.push('unstable, zero, negative, overload, overrange, stale, future and disconnected readings cannot change the weight');

  station = { ...station, device_online: true }; await refresh(); await waitSession(); reading({ grams: 540 }); const before540 = actions('scaleStart').length; await refresh(); await waitWeight(540); await waitAction('scaleStart', before540 + 1);
  await page.$eval('input[data-fixture-weight]', input => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, '612'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitWeight(612); const beforeManual = actions('scaleAdopt').length;
  reading({ grams: 800 }); await refresh(); await settle(); assert.equal(actions('scaleAdopt').length, beforeManual); await waitWeight(612);
  await screenshot('manual');
  const beforeResume = actions('scaleStart').length; await clickContaining('自動読取に戻す'); await waitAction('scaleStart', beforeResume + 1); reading({ grams: 820 }); await refresh(); await waitWeight(820); await waitAction('scaleStart', beforeResume + 2);
  checks.push('manual edits pause auto adoption and preserve the entered value; explicit resume starts a fresh weighing session');

  const closedSession = station.scale_session, beforeClose = actions('scaleEnd').length;
  await page.evaluate(() => window.__scaleFixture.setOpen(false)); await waitAction('scaleEnd', beforeClose + 1);
  assert.equal(actions('scaleEnd').at(-1).scaleSession, closedSession);
  assert.deepEqual(actions('scaleEnd').at(-1).owner, { stationId: 'station-a', token: 'fixture-owner', epoch: 7 });
  checks.push('closing the dialog ends the original scale session explicitly');

  await open(); await waitAction('scaleStart');
  const failedAdopt = plan('scaleAdopt', { error: '重量を保存できません。再試行してください。', status: 503 });
  reading({ grams: 390 }); await refresh(); await waitText('重量を保存できません。再試行してください。'); assert.equal(failedAdopt.seen, true);
  await settle(1100); assert.equal(actions('scaleAdopt').length, 1); assert.deepEqual(await captures(), []);
  await screenshot('adopt-error'); const beforeRetryStart = actions('scaleStart').length, beforeRetrySession = station.scale_session; await clickContaining('もう一度試す'); await waitAction('scaleStart', beforeRetryStart + 1); await waitNewSession(beforeRetrySession); reading({ grams: 390 }); await refresh(); await waitWeight(390);
  checks.push('adoption errors appear within the scale area and wait for explicit retry instead of silently looping');

  await open({ device_online: false });
  const failedStart = plan('scaleStart', { error: '計量を開始できません。接続を確認してください。', status: 503 });
  station = { ...station, device_online: true }; await refresh(); await waitText('計量を開始できません。接続を確認してください。'); assert.equal(failedStart.seen, true);
  await settle(1100); assert.equal(actions('scaleStart').length, 1);
  await clickContaining('もう一度試す'); await waitAction('scaleStart', 2);
  checks.push('start errors remain visible in the dialog and retry starts only when requested');

  await open(); await waitAction('scaleStart'); plan('scaleAdopt', { error: '重量が更新されました。', status: 409 });
  reading({ grams: 360 }); await refresh(); await waitAction('scaleAdopt'); await settle(500); assert.deepEqual(await captures(), []);
  assert.equal(actions('scaleAdopt').length, 1);
  reading({ grams: 380 }); await refresh(); await waitWeight(380);
  checks.push('a sequence race waits for the next fresh stable sample and recovers without a retry tap');

  await open(); await waitAction('scaleStart');
  const delayedAdopt = plan('scaleAdopt', { hold: true }); reading({ grams: 450 }); await refresh(); await waitAction('scaleAdopt');
  await page.evaluate(() => window.__scaleFixture.setItem('bowl-b')); await waitAction('scaleStart', 2);
  delayedAdopt.gate.resolve(); await settle(400); assert.deepEqual(await captures(), []); await waitWeight('');
  reading({ grams: 660 }); const before660 = actions('scaleStart').length; await refresh(); await waitWeight(660); await waitAction('scaleStart', before660 + 1); assert.equal((await captures())[0].item, 'bowl-b');
  checks.push('a late adoption response for the previous item cannot populate a new item');

  const currentSession = station.scale_session, beforeLateEnd = actions('scaleEnd').length, beforeReopen = actions('scaleStart').length; const delayedEnd = plan('scaleEnd', { hold: true });
  await page.evaluate(() => window.__scaleFixture.setOpen(false)); await waitAction('scaleEnd', beforeLateEnd + 1);
  await page.evaluate(() => window.__scaleFixture.setOpen(true)); await waitAction('scaleStart', beforeReopen + 1);
  const newSession = station.scale_session; assert.notEqual(newSession, currentSession);
  delayedEnd.gate.resolve(); await settle(400);
  assert.equal(station.scale_session, newSession); assert.equal(actions('scaleEnd').at(-1).scaleSession, currentSession);
  checks.push('delayed cleanup names its original session and cannot cancel a newer item session');

  await open({ device_online: false }); const delayedStart = plan('scaleStart', { hold: true }); station = { ...station, device_online: true }; await refresh(); await waitAction('scaleStart');
  await page.evaluate(() => window.__scaleFixture.setOpen(false)); delayedStart.gate.resolve(); await waitAction('scaleEnd'); await settle(200);
  assert.equal(actions('scaleEnd').at(-1).scaleSession, actions('scaleStart')[0].scaleSession); assert.deepEqual(await captures(), []);
  checks.push('a start response arriving after the dialog closes is ended and cannot update an unmounted item');

  await open({}, { owner: false }); await waitText('先に、この端末で会計を始めてください。'); assert.equal(actions('scaleStart').length, 0); assert.equal(actions('claim').length, 0); assert.equal(actions('takeover').length, 0);
  checks.push('a device without cashier ownership shows guidance and never claims or takes over automatically');

  await open({}, { heartbeatMs: 500 }); const delayedHeartbeat = plan('heartbeat', { error: '操作権が失効しました。', status: 409, hold: true });
  await waitAction('heartbeat'); assert.equal(delayedHeartbeat.seen, true);
  await page.evaluate(() => window.__scaleFixture.action('takeover', { stationId: 'station-a', epoch: 7 }));
  await page.waitForFunction(() => window.__scaleFixture.state().owner?.token === 'fixture-owner-8');
  delayedHeartbeat.gate.resolve(); await settle(600);
  assert.equal(await page.evaluate(() => window.__scaleFixture.state().owner?.token), 'fixture-owner-8');
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('store-relay-owner:fixture-store')).token), 'fixture-owner-8');
  checks.push('an old delayed heartbeat failure cannot clear the newly acquired owner or its saved credential');

  await open({}, { language: 'zh-Hans' }); await waitAction('scaleStart'); reading({ grams: 285 }); await refresh(); await waitWeight(285); await screenshot('stable-zh-Hans');
  }
  assert.deepEqual(requests, []); assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []);
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: true, checks, pageErrors, unexpectedRequests: requests, externalRequests }, null, 2) + '\n');
  await rm(`${output}/failure.png`, { force: true }); console.log(`PASS automatic POS scale UI: ${checks.join('; ')}.`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: false, checks, pageErrors, unexpectedRequests: requests, externalRequests, posts, station,fixtureState:page&&!page.isClosed()?await page.evaluate(()=>window.__scaleFixture?.state()).catch(()=>null):null, error: error.stack }, null, 2) + '\n'); throw error;
} finally {
  stop();
  for (const next of pending) next.gate.resolve();
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
