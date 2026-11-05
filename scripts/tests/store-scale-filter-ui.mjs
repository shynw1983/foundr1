// Real POS scale component and relay hook, with isolated HTTP fixtures only.
// This never calls production, Bluetooth APIs, a physical scale, or a printer.
import { build, stop } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = resolve(process.env.SCALE_FILTER_UI_OUTPUT || 'outputs/store-scale-filter-20261018/ui/pos');
await mkdir(output, { recursive: true });
const entry = `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{StoreRelayScale,scaleSnapshotBlocksConfirmation}from'./app/store/components/StoreRelayScale';
import{useStoreRelay}from'./app/store/components/useStoreRelay';
import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
const params=new URLSearchParams(location.search);localStorage.setItem('foundr1-os-language',params.get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
localStorage.removeItem('store-relay-owner:fixture-store');
if(params.get('owner')!=='false')sessionStorage.setItem('store-relay-owner:fixture-store',JSON.stringify({stationId:'station-a',token:'fixture-owner',epoch:7}));else sessionStorage.removeItem('store-relay-owner:fixture-store');
window.__scaleCaptures=[];window.__scaleFixture={};
function Fixture(){const[storeId,setStoreId]=useState('fixture-store');const relay=useStoreRelay(storeId);const[item,setItem]=useState('bowl-a');const[open,setOpen]=useState(params.get('open')!=='false');const[manual,setManual]=useState(false);const[weight,setWeight]=useState('');const[validity,setValidity]=useState(null);const[tare,setTare]=useState(undefined);const[captureMeasurement,setCaptureMeasurement]=useState(null);
useEffect(()=>{window.__scaleFixture={refresh:relay.refresh,action:relay.action,setOpen,setStoreId,setItem:item=>{setWeight('');setCaptureMeasurement(null);setManual(false);setItem(item)},setManual,setTare,state:()=>({storeId,item,open,manual,weight,validity,captureMeasurement,error:relay.error,owner:relay.owner,station:relay.station,recoveryVersion:relay.recoveryVersion})};},[relay,storeId,item,open,manual,weight,validity,tare,captureMeasurement]);
const ready=validity?.ready&&validity.scopeKey===item&&validity.ownerToken===relay.owner?.token&&validity.epoch===relay.owner?.epoch&&validity.recoveryVersion===relay.recoveryVersion&&!scaleSnapshotBlocksConfirmation(relay.station,Number(weight),relay.now(),captureMeasurement?.filter?.windowId||null);
return <main className="store-pos-page" style={{padding:16,maxWidth:900,margin:'0 auto'}}><h1>自選マーラータン</h1><p>商品を開くと自動計量し、安定した重量を入力します。</p>
{open?<section role="dialog" aria-modal="true" aria-label="商品オプション"><h2>{item}</h2><StoreRelayScale relay={relay} scopeKey={item} manualMode={manual} onManualModeChange={setManual} onValidityChange={setValidity} tareSettings={tare} tarePresetId={tare?'small':''} onAdopt={(id,grams,measurement)=>{window.__scaleCaptures.push({item,id,grams,measurement});setCaptureMeasurement(measurement||null);setWeight(String(grams))}}/><label style={{display:'grid',gap:8,marginTop:16}}>自選食材の重量<input data-fixture-weight aria-label="自選食材の重量" inputMode="decimal" value={weight} onChange={event=>{setManual(true);setWeight(event.target.value)}}/></label><button data-fixture-add type="button" disabled={!Number(weight)||(!manual&&!ready)}>この内容で追加</button><button type="button" onClick={()=>setOpen(false)}>閉じる</button></section>:<p>商品画面を閉じました。</p>}</main>}
createRoot(document.getElementById('root')).render(<OsTranslationProvider><Fixture/></OsTranslationProvider>);`;

const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const filterBundle = await build({ entryPoints: ['lib/pos-scale-filter.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { evaluatePosScaleFilter } = await import(`data:text/javascript;base64,${Buffer.from(filterBundle.outputFiles[0].text).toString('base64')}`);
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = (await readFile('app/globals.css', 'utf8')) + '\n' + (await readFile('app/store/store-responsive.css', 'utf8')) + '\n' + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async language => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
let station, posts, pending, sessionCounter, captureCounter, gets, nativeFilterState, monitoringSupported, softwareFrameContext, adoptResults, clockResponse;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function reset(patch = {}) {
  station = { id: 'station-a', name: 'レジ A', enabled: true, print_enabled: true, scale_enabled: true, epoch: 7, owner_until: new Date(Date.now() + 60000).toISOString(), device_online: true, device_paired: true, scale_session: null, scale_sequence: -1, scale_reading: null, scale_received_at: null, device_status: { scale: 'connected', scaleTareVersion: 1 }, scale_filter_settings:{enabled:false,revision:'',toleranceGrams:2,settleMs:2000}, ...patch };
  posts = []; pending = []; gets = []; sessionCounter = 0; captureCounter = 0;
  nativeFilterState = {}; monitoringSupported = true; softwareFrameContext = ''; adoptResults = []; clockResponse = 'valid';
}
reset();
function plan(action, { error, status = 409, hold = false, beforeError, invalidJson = false, afterAction, afterActionCount = 1, responseMonitoring, beforeAction } = {}) {
  const gate = deferred(); const next = { action, error, status, hold, gate, beforeError, invalidJson, afterAction, afterActionCount, responseMonitoring, beforeAction, seen: false }; pending.push(next); return next;
}
function reading({ grams = 321, stable = true, overload = false, age = 0, hardwareStable, filter, mode, grossGrams, tareGrams, tarePresetId, settingsRevision } = {}) {
  station = { ...station, scale_sequence: station.scale_sequence + 1, scale_reading: { grams, stable, overload, ...(hardwareStable === undefined ? {} : {hardwareStable}), ...(filter ? {filter} : {}), ...(mode ? {mode,grossGrams,tareGrams,tarePresetId,settingsRevision} : {}) }, scale_received_at: new Date(Date.now() - age).toISOString() };
}
function software(grams,{accepted=true,hardwareStable=false,rawGrams=grams,revision=station.scale_filter_settings.revision,windowId,...extra}={}){
  const context=JSON.stringify([station.scale_session,revision,extra.mode,extra.tarePresetId,extra.settingsRevision]);
  const prior=station.scale_reading;
  const continuous=context===softwareFrameContext&&prior?.filter?.accepted&&prior.grams===grams;
  const acceptedWindowId=accepted&&windowId!==null?(windowId||(continuous?prior.filter.windowId:null)||randomUUID()):null;
  reading({grams,stable:accepted,hardwareStable,filter:{source:'software_window',settingsRevision:revision,toleranceGrams:station.scale_filter_settings.toleranceGrams,settleMs:station.scale_filter_settings.settleMs,sampleCount:accepted?3:1,spanMs:accepted?2500:0,rawGrams,accepted,...(acceptedWindowId?{windowId:acceptedWindowId}:{})},...extra});
  softwareFrameContext=context;
}
function nativeSoftware(grams, { hardwareStable = false, overload = false } = {}) {
  const measuredAt = Date.now();
  const result = evaluatePosScaleFilter({ settings: station.scale_filter_settings, state: nativeFilterState,
    contextKey: station.scale_session, reading: { grams, stable: hardwareStable, overload }, measuredAt, newWindowId: randomUUID() });
  nativeFilterState = result.state;
  station = { ...station, scale_sequence: station.scale_sequence + 1, scale_reading: result.reading,
    scale_received_at: new Date(measuredAt).toISOString() };
  return result;
}
function changeSettings(settings){station={...station,scale_filter_settings:settings,scale_session:null,scale_sequence:-1,scale_reading:null,scale_received_at:null};}
const requests = [], externalRequests = [], pageErrors = [], checks = [];
const send = (response, body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); response.end(js); return; }
    if (url.pathname.startsWith('/locales/os/')) { send(response, dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']); return; }
    if (url.pathname === '/api/auth/me') { send(response, { employee: { id: 'fixture-employee', name: 'Fixture', role: 'owner' } }); return; }
    if (url.pathname === '/api/store/device-relay') {
      if (request.method === 'GET') {
        const requestStartedAt=performance.now();
        gets.push({at:Date.now(),storeId:url.searchParams.get('storeId'),scaleSession:station.scale_session});
        const next = pending.find(next => !next.seen && next.action === 'GET' && (!next.afterAction || posts.filter(post=>post.action===next.afterAction).length>=next.afterActionCount));
        const snapshot = { stations: [structuredClone(station)], jobs: [] };
        if (next) { next.seen = true; if (next.hold) await next.gate.promise; if (next.invalidJson) { response.writeHead(200, {'Content-Type':'application/json'});response.end('{');return; } if (next.error) { send(response, {error: next.error}, next.status); return; } }
        const clock=clockResponse==='missing'?{}:clockResponse==='malformed'?{serverNow:'not-a-clock'}:{serverNow:new Date().toISOString(),serverElapsedMs:Math.floor(performance.now()-requestStartedAt)};
        send(response, {...snapshot,...clock}); return;
      }
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); posts.push(body);
      const next = pending.find(next => !next.seen && next.action === body.action);
      if (next) { next.seen = true; if (next.hold && ['scaleEnd', 'heartbeat', 'resume'].includes(body.action)) await next.gate.promise; if (next.error) { next.beforeError?.(); send(response, { error: next.error }, next.status); return; } }
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
        if(next?.beforeAction)await next.beforeAction(body);
        if (body.scaleSession !== station.scale_session) { send(response, { error: '計量セッションが変わりました。' }, 409); return; }
        const hasWindowProof=body.scaleWindowId!==undefined||body.scaleGrams!==undefined;
        if(hasWindowProof){
          const r=station.scale_reading;
          if(!Number.isSafeInteger(body.scaleSequence)||body.scaleSequence<0||body.scaleSequence>station.scale_sequence
            ||!Number.isInteger(body.scaleGrams)||body.scaleGrams<=0||body.scaleGrams!==r?.grams||body.scaleWindowId!==r?.filter?.windowId
            ||r?.filter?.accepted!==true||!r.stable||r.overload||station.scale_filter_settings.enabled!==true){
            send(response,{error:'安定した重量が更新されました。'},409);return;
          }
        }else if (body.scaleSequence !== station.scale_sequence) { send(response, { error: '重量が更新されました。' }, 409); return; }
        const r=station.scale_reading; const capture = { id: `capture-${++captureCounter}`, grams: r?.grams, weightMeasurement:{...(r?.mode==='preset'?{mode:'preset',grossGrams:r.grossGrams,tareGrams:r.tareGrams,tarePresetId:r.tarePresetId,settingsRevision:r.settingsRevision,netGrams:r.grams}:{mode:'device_net'}),...(r?.filter?{filter:r.filter,hardwareStable:r.hardwareStable,rawGrams:r.filter.rawGrams}:{})} };
        const scaleSequence = station.scale_sequence;
        adoptResults.push({observedSequence:body.scaleSequence,scaleSequence,scaleWindowId:body.scaleWindowId,capture:structuredClone(capture)});
        const monitoring = monitoringSupported && body.keepMonitoring === true && station.scale_filter_settings.enabled === true;
        if (!monitoring) station = { ...station, scale_session: null, scale_sequence: -1, scale_reading: null, scale_received_at: null };
        if (next?.hold) await next.gate.promise;
        send(response, { ok: true, capture, scaleSession: body.scaleSession, scaleSequence,
          ...(next?.responseMonitoring === false ? { monitoring: false } : monitoring ? { monitoring: true } : {}) }); return;
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
async function open(patch = {}, { language = 'ja', owner = true, heartbeatMs = null, dialogOpen = true, clockOffset = 0 } = {}) {
  if (page) await page.close();
  reset(patch); page = await browser.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => pageErrors.push(error.message));
  if(clockOffset)await page.evaluateOnNewDocument(offset=>{const original=Date.now;Date.now=()=>original()+offset;},clockOffset);
  if (heartbeatMs !== null) await page.evaluateOnNewDocument(heartbeatMs => { const original = window.setInterval; window.setInterval = (callback, delay, ...args) => original(callback, delay === 12000 ? heartbeatMs : delay, ...args); }, heartbeatMs);
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.url().startsWith(origin + '/')) request.continue(); else { externalRequests.push(request.url()); request.abort(); } });
  await page.goto(`${origin}/?lang=${language}&owner=${owner}&open=${dialogOpen}`, { waitUntil: heartbeatMs === null ? 'networkidle0' : 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__scaleFixture.refresh === 'function');
}
const refresh = () => page.evaluate(() => window.__scaleFixture.refresh());
const captures = () => page.evaluate(() => window.__scaleCaptures);
const actions = action => posts.filter(post => post.action === action);
const waitAction = async (action, count = 1) => { for (let step = 0; step < 100; step++) { if (actions(action).length >= count) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error(`Expected ${count} ${action}; actual ${actions(action).length}`); };
const waitSession = async () => { for (let step = 0; step < 100; step++) { if (station.scale_session) return station.scale_session; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Expected an active scale session'); };
const waitNewSession = async previous => { for (let step = 0; step < 100; step++) { if (station.scale_session && station.scale_session !== previous) return station.scale_session; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Expected a new active scale session'); };
const waitPlan = async next => { for (let step=0;step<100;step++) { if(next.seen)return;await new Promise(resolve=>setTimeout(resolve,50)); }throw new Error(`Expected planned ${next.action}`); };
const waitWeight = weight => page.waitForFunction(weight => document.querySelector('input[data-fixture-weight]')?.value === String(weight), {}, weight);
const waitAdd = enabled => page.waitForFunction(enabled => document.querySelector('button[data-fixture-add]')?.disabled === !enabled, {}, enabled);
const waitText = text => page.waitForFunction(text => document.body.textContent.includes(text), {}, text);
async function openScaleDiagnostics(){
  await page.waitForSelector('.store-relay-scale details > summary');
  if(!await page.$eval('.store-relay-scale details',element=>element.open))await page.click('.store-relay-scale details > summary');
  await page.waitForFunction(()=>document.querySelector('.store-relay-scale details')?.open===true);
}
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
  const filter={enabled:true,revision:'recovery-filter',toleranceGrams:2,settleMs:2000};
  await open({scale_filter_settings:filter});await waitAction('scaleStart');software(354,{rawGrams:354.2});await refresh();await waitWeight(354);await waitAdd(true);
  const originalCapture=(await captures())[0],oldSession=await waitSession(),oldWindow=station.scale_reading.filter.windowId;
  const recoveryBefore=await page.evaluate(()=>window.__scaleFixture.state().recoveryVersion);
  const heldResume=plan('resume',{hold:true});station={...station,owner_until:new Date(Date.now()-1000).toISOString()};
  await refresh();await waitAction('resume',2);await waitPlan(heldResume);await waitAdd(false);
  heldResume.gate.resolve();await waitNewSession(oldSession);await waitAction('scaleStart',2);await settle(350);await waitAdd(false);
  assert.equal((await captures()).length,1);assert.equal(await page.evaluate(()=>window.__scaleFixture.state().owner?.epoch),7);
  assert.ok(await page.evaluate(previous=>window.__scaleFixture.state().recoveryVersion>previous,recoveryBefore));
  software(354,{rawGrams:354.3});await refresh();await page.waitForFunction(()=>window.__scaleCaptures.length===2);await waitAdd(true);
  const recoveredCapture=(await captures())[1];assert.notEqual(recoveredCapture.id,originalCapture.id);assert.notEqual(recoveredCapture.measurement.filter.windowId,oldWindow);
  checks.push('same-epoch recovery invalidates the old accepted software weight; the same354g requires a fresh session, accepted window and immutable capture before addition returns');

  await open({scale_filter_settings:filter});await waitAction('scaleStart');const firstSession=await waitSession();
  const staleAdoption=plan('scaleAdopt',{hold:true});software(455,{rawGrams:455.2});await refresh();await waitPlan(staleAdoption);
  const pendingResume=plan('resume',{hold:true});station={...station,owner_until:new Date(Date.now()-1000).toISOString()};
  await refresh();await waitAction('resume',2);await waitPlan(pendingResume);await waitAdd(false);
  pendingResume.gate.resolve();await waitNewSession(firstSession);await waitAction('scaleStart',2);
  staleAdoption.gate.resolve();await settle(650);await waitAdd(false);await waitWeight('');assert.deepEqual(await captures(),[]);
  software(455,{rawGrams:455.3});await refresh();await page.waitForFunction(()=>window.__scaleCaptures.length===1);await waitAdd(true);
  assert.equal((await captures())[0].id,'capture-2');assert.equal(actions('scaleAdopt').length,2);
  checks.push('a delayed monitoring adoption from before lease expiry is fenced despite the same owner token and epoch; only a new independent window capture can populate POS');
  await screenshot('owner-recovery-software');
}

try {
  await runOwnerRecoveryCases();
  if(!process.env.SCALE_FILTER_RECOVERY_ONLY){
  await open(); await waitAction('scaleStart'); reading({ grams: 300 }); await refresh(); await waitWeight(300); await waitAdd(true); await waitAction('scaleStart',2); reading({grams:300}); await refresh();
  await waitText('はかり本体の安定判定'); assert.equal(await page.evaluate(() => document.body.textContent.includes('ソフトウェア判定')), false);
  assert.equal(actions('scaleAdopt')[0].keepMonitoring,undefined);
  checks.push('default-off policy keeps the original hardware stable rule and capture retirement, omits keepMonitoring, and identifies the hardware judgement');

  const filter={enabled:true,revision:'filter-a',toleranceGrams:2,settleMs:2000};
  // The five-second idle poll must be replaced as soon as starting a weighing
  // session is visible, rather than delaying its first fresh reading.
  await open({scale_filter_settings:filter},{dialogOpen:false});
  assert.equal(actions('scaleStart').length,0);
  await page.evaluate(()=>window.__scaleFixture.setOpen(true));
  await waitAction('scaleStart');
  await page.waitForFunction(()=>Boolean(window.__scaleFixture.state().station?.scale_session));
  const activeAt=Date.now(),getCount=gets.length;
  for(let step=0;step<36&&gets.length===getCount;step++)await settle(50);
  assert.ok(gets.length>getCount,'active weighing retained the idle polling timer');
  const activePollMs=gets[getCount].at-activeAt;
  assert.ok(activePollMs<=1800,`first active weighing poll took ${activePollMs}ms`);
  assert.equal(gets[getCount].scaleSession,station.scale_session);
  checks.push(`starting a weighing session replaces the idle five-second timer; next real HTTP poll arrived in ${activePollMs}ms without a manual refresh`);

  // The capture POST is the authoritative result. A slow follow-up status GET
  // must not keep an already confirmed weight out of the POS input.
  await open({scale_filter_settings:filter},{dialogOpen:false});
  await page.evaluate(()=>window.__scaleFixture.setOpen(true));await waitAction('scaleStart');
  await page.waitForFunction(()=>Boolean(window.__scaleFixture.state().station?.scale_session));
  const followupGet=plan('GET',{hold:true,afterAction:'scaleAdopt'});
  software(387,{rawGrams:387.3});await refresh();await waitPlan(followupGet);
  const heldAt=Date.now();
  await page.waitForFunction(()=>document.querySelector('input[data-fixture-weight]')?.value==='387',{timeout:1500});
  assert.equal(followupGet.seen,true);await waitAdd(true);
  assert.equal((await captures()).length,1);
  const captureWithoutGetMs=Date.now()-heldAt;
  // A successful software capture retains its authoritative monitoring session.
  // Holding the status GET through later loop ticks must not restart its window.
  const recoveredAfterCapture=await waitSession();await settle(900);
  assert.equal(actions('scaleStart').length,1);
  assert.equal(actions('scaleAdopt')[0].keepMonitoring,true);
  followupGet.gate.resolve();await settle(450);await waitWeight(387);await waitAdd(true);
  assert.equal(station.scale_session,recoveredAfterCapture);
  assert.equal((await captures()).length,1);
  checks.push(`immutable scaleAdopt result populates the POS while its status GET is held (${captureWithoutGetMs}ms); monitoring keeps the same session and late GET completion neither restarts filtering nor duplicates adoption`);

  // A server without the optional monitoring response still has the previous
  // retirement contract; the client must recover it without assuming retention.
  await open({scale_filter_settings:filter});monitoringSupported=false;await waitAction('scaleStart');
  plan('scaleAdopt',{beforeAction:()=>software(388,{rawGrams:388.1,windowId:null})});
  software(388,{rawGrams:388.2,windowId:null});await refresh();await waitWeight(388);await waitAction('scaleStart',2);
  assert.equal(actions('scaleAdopt')[0].keepMonitoring,true);assert.equal((await captures()).length,1);
  assert.equal(actions('scaleAdopt')[0].scaleWindowId,undefined);
  assert.equal(actions('scaleAdopt').length,2);assert.notEqual(actions('scaleAdopt')[0].scaleSequence,actions('scaleAdopt')[1].scaleSequence);
  software(388,{accepted:false,rawGrams:388.1,windowId:null});await refresh();await waitAdd(false);
  software(388,{rawGrams:388.2,windowId:null});await refresh();await waitAdd(true);assert.equal((await captures()).length,1);
  checks.push('a legacy no-window proof keeps strict-sequence409 retries and an absent monitoring acknowledgement retains retirement plus independent successor qualification');

  // These transitions can occur while Bluetooth/network capture confirmation is
  // in flight. Faster response handling must preserve every context fence.
  for(const transition of ['item','manual','store','owner']){
    await open({scale_filter_settings:filter});await waitAction('scaleStart');
    const capturePost=plan('scaleAdopt',{hold:true});software(399,{rawGrams:399.2});await refresh();await waitPlan(capturePost);
    if(transition==='item')await page.evaluate(()=>window.__scaleFixture.setItem('bowl-b'));
    if(transition==='manual')await page.evaluate(()=>window.__scaleFixture.setManual(true));
    if(transition==='store')await page.evaluate(()=>window.__scaleFixture.setStoreId('fixture-successor-store'));
    if(transition==='owner')await page.evaluate(()=>window.__scaleFixture.action('takeover'));
    await settle(100);capturePost.gate.resolve();await settle(650);
    assert.deepEqual(await captures(),[],`late capture populated after ${transition} changed`);
    assert.equal(await page.$eval('input[data-fixture-weight]',input=>input.value),'');
    await waitAdd(false);
  }
  checks.push('delayed capture responses cannot write weight after item, manual mode, store, or owner/epoch changes');

  await open({scale_filter_settings:filter});await waitAction('scaleStart');
  const unsafePendingCapture=plan('scaleAdopt',{hold:true});software(390,{rawGrams:390.1});await refresh();await waitPlan(unsafePendingCapture);
  const pendingCaptureSession=await waitSession();
  await page.evaluate(()=>{window.__pendingReadinessProbe={enabled:[]};window.__pendingReadinessTimer=setInterval(()=>{
    if(!document.querySelector('button[data-fixture-add]')?.disabled)window.__pendingReadinessProbe.enabled.push({at:Date.now(),text:document.querySelector('.store-relay-scale')?.textContent});
  },25);});
  software(590,{accepted:false,rawGrams:590.2});await refresh();await page.waitForFunction(()=>window.__scaleFixture.state().station?.scale_reading?.grams===590);await settle(50);
  software(0,{accepted:false,rawGrams:0});await refresh();await settle(50);unsafePendingCapture.gate.resolve();
  await waitNewSession(pendingCaptureSession);await settle(700);await waitAdd(false);assert.deepEqual(await captures(),[]);await waitWeight('');
  const pendingProbe=await page.evaluate(()=>{clearInterval(window.__pendingReadinessTimer);return window.__pendingReadinessProbe;});
  assert.deepEqual(pendingProbe.enabled,[],'a delayed earlier capture briefly re-enabled the POS after an unsafe load then zero');
  for(const [index,raw]of[390.2,390.1,390.3].entries()){
    if(index)await settle(1000);nativeSoftware(raw);await refresh();if(index<2){await waitAdd(false);assert.deepEqual(await captures(),[]);}
  }
  await waitWeight(390);await waitAdd(true);assert.equal((await captures()).length,1);assert.equal((await captures())[0].id,'capture-2');
  checks.push('a load reset then zero observed during the first held adoption permanently rejects its old result; a25ms probe never sees readiness before a fresh independent successor window captures again');

  await open({scale_filter_settings:filter});await waitAction('scaleStart');software(333,{rawGrams:333.2});await refresh();await waitWeight(333);await waitAdd(true);
  const freshnessSession=await waitSession(),freshnessWindow=station.scale_reading.filter.windowId;
  station={...station,scale_received_at:new Date(Date.now()-11000).toISOString()};await refresh();await waitAdd(false);await settle(900);
  assert.equal(station.scale_session,freshnessSession);assert.equal(actions('scaleStart').length,1);assert.equal((await captures()).length,1);
  software(333,{rawGrams:333.3,windowId:freshnessWindow});await refresh();await waitAdd(true);
  assert.equal(station.scale_session,freshnessSession);assert.equal(actions('scaleAdopt').length,1);
  checks.push('an expired cached accepted reading pauses addition and refreshes without rotating its retained window or capture; a fresh same-window sample resumes readiness');

  await open({scale_filter_settings:filter});await waitAction('scaleStart');
  const expiringAdoption=plan('scaleAdopt',{hold:true});software(334,{rawGrams:334.1});await refresh();await waitPlan(expiringAdoption);
  const expiringSession=await waitSession(),expiringWindow=station.scale_reading.filter.windowId;
  station={...station,scale_received_at:new Date(Date.now()-11000).toISOString()};await refresh();expiringAdoption.gate.resolve();
  await waitWeight(334);await waitAdd(false);assert.equal((await captures()).length,1);assert.equal(actions('scaleStart').length,1);
  software(334,{rawGrams:334.2,windowId:expiringWindow});await refresh();await waitAdd(true);assert.equal(station.scale_session,expiringSession);assert.equal((await captures()).length,1);
  checks.push('freshness loss during an in-flight server confirmation cannot poison its valid immutable capture; it fills immediately while gated, then resumes under the same monitoring session');

  for(const invalidClock of ['missing','malformed']){
    await open({scale_filter_settings:filter});await waitAction('scaleStart');software(335,{rawGrams:335.1});await refresh();await waitWeight(335);await waitAdd(true);
    const clockSession=await waitSession(),clockWindow=station.scale_reading.filter.windowId;
    clockResponse=invalidClock;await refresh();await waitAdd(false);await settle(500);
    assert.equal(actions('scaleStart').length,1);assert.equal((await captures()).length,1);
    clockResponse='valid';software(335,{rawGrams:335.2,windowId:clockWindow});await refresh();await waitAdd(true);
    assert.equal(station.scale_session,clockSession);assert.equal(actions('scaleAdopt').length,1);
  }
  checks.push('missing or malformed server clock fails closed without using browser wall time, and a valid clock restores the unchanged capture without a new session');

  for(const unknownClockUnsafe of ['overload','new-window','null']){
    await open({scale_filter_settings:filter});await waitAction('scaleStart');
    const unknownClockAdoption=plan('scaleAdopt',{hold:true});software(336,{rawGrams:336.1});await refresh();await waitPlan(unknownClockAdoption);
    const oldClockSession=await waitSession();clockResponse='missing';
    if(unknownClockUnsafe==='overload')software(3001,{accepted:false,overload:true});
    if(unknownClockUnsafe==='new-window')software(336,{rawGrams:336.2,windowId:randomUUID()});
    if(unknownClockUnsafe==='null')station={...station,scale_sequence:station.scale_sequence+1,scale_reading:null,scale_received_at:null};
    await refresh();await settle(75);clockResponse='valid';software(0,{accepted:false,rawGrams:0});await refresh();unknownClockAdoption.gate.resolve();
    await waitNewSession(oldClockSession);await settle(450);await waitAdd(false);assert.deepEqual(await captures(),[]);await waitWeight('');
  }
  checks.push('unknown server time never hides semantic overload, a changed window or active null during pending adoption; a later zero and recovered clock cannot unlock that rejected capture');

  for(const clockOffset of [-2500,2500]){
    await open({scale_filter_settings:filter},{clockOffset});await waitAction('scaleStart');software(337,{rawGrams:337.1});await refresh();await waitWeight(337);await waitAdd(true);
    const calibratedSession=await waitSession(),calibratedWindow=station.scale_reading.filter.windowId;
    for(let sample=0;sample<4;sample++){await settle(1000);software(337,{rawGrams:337.1+sample/10,hardwareStable:sample%2===0,windowId:calibratedWindow});await refresh();await waitAdd(true);}
    assert.equal(station.scale_session,calibratedSession);assert.equal(actions('scaleStart').length,1);assert.equal((await captures()).length,1);
  }
  checks.push('browser-only clock offsets of minus or plus2.5 seconds preserve a single confirmed session and readiness using server time while native/server clocks stay unchanged');

  for(const responseMonitoring of [true,false]){
    await open({scale_filter_settings:filter});await waitAction('scaleStart');
    const heldSuccessorCapture=plan('scaleAdopt',{hold:true,responseMonitoring});software(391,{rawGrams:391.2});await refresh();await waitPlan(heldSuccessorCapture);
    const successorSession=`00000000-0000-4000-8000-0000000000${responseMonitoring?'71':'72'}`;
    station={...station,scale_session:successorSession,scale_sequence:-1};software(391,{rawGrams:391.3});await refresh();
    heldSuccessorCapture.gate.resolve();await settle(700);await waitAdd(false);assert.deepEqual(await captures(),[]);await waitWeight('');
    assert.equal(station.scale_session,successorSession);assert.equal(actions('scaleStart').length,1);
  }
  checks.push('a same-owner successor session with the same accepted grams fences a delayed capture for both stale monitoring:true and explicit monitoring:false responses; neither steals or unlocks its successor');

  for(const transition of ['store','owner']){
    await open({scale_filter_settings:filter});await waitAction('scaleStart');
    const staleStatus=plan('GET',{hold:true,afterAction:'scaleAdopt'});software(410,{rawGrams:410.2});await refresh();await waitPlan(staleStatus);await waitWeight(410);
    if(transition==='store'){
      await page.evaluate(()=>window.__scaleFixture.setStoreId('fixture-successor-store'));
      await page.waitForFunction(()=>window.__scaleFixture.state().storeId==='fixture-successor-store'&&window.__scaleFixture.state().owner===null);
      await refresh();
    }else{
      await page.evaluate(()=>window.__scaleFixture.action('takeover'));
      await page.waitForFunction(()=>window.__scaleFixture.state().owner?.epoch===8);
    }
    staleStatus.gate.resolve();await settle(650);
    const state=await page.evaluate(()=>window.__scaleFixture.state());
    if(transition==='store'){assert.equal(state.storeId,'fixture-successor-store');assert.equal(state.owner,null);assert.equal(state.station,undefined);}
    else{assert.equal(state.owner.epoch,8);assert.equal(state.station.epoch,8);}
    assert.equal((await captures()).length,1);await waitAdd(false);
  }
  checks.push('a delayed post-capture GET cannot restore the old store or owner epoch after either context changes');

  // A distinct native frame arrives while every adoption POST is travelling.
  // This reproduces exact-sequence starvation using the real window algorithm:
  // a changed sequence with the same server window/net is still one safe load.
  await open({scale_filter_settings:filter});await waitAction('scaleStart');
  const advancingAdopt=plan('scaleAdopt',{beforeAction:async()=>{await settle(1100);nativeSoftware(424.3,{hardwareStable:false});}});
  for(const [index,raw]of[424.2,423.9,424.1].entries()){
    if(index)await settle(1000);nativeSoftware(raw,{hardwareStable:index%2===0});await refresh();
  }
  await waitPlan(advancingAdopt);await waitWeight(424);await waitAdd(true);
  assert.equal(actions('scaleAdopt').length,1);assert.equal((await captures()).length,1);
  assert.equal(actions('scaleAdopt')[0].scaleWindowId,adoptResults[0].capture.weightMeasurement.filter.windowId);
  assert.equal(actions('scaleAdopt')[0].scaleGrams,424);
  assert.ok(adoptResults[0].scaleSequence>adoptResults[0].observedSequence);
  assert.equal((await captures())[0].measurement.filter.windowId,adoptResults[0].scaleWindowId);
  await writeFile(`${output}/advancing-sequence-window.json`,JSON.stringify({request:actions('scaleAdopt')[0],result:adoptResults[0],captures:await captures()},null,2)+'\n');
  checks.push('a1.1s in-flight native update advances the observed sequence under one actual accepted window; proof adopts once, records the actual later sequence, and populates POS without409 starvation');

  for(const mismatch of ['window','grams']){
    await open({scale_filter_settings:filter});await waitAction('scaleStart');
    const initialWindow=randomUUID(),replacementWindow=randomUUID();
    plan('scaleAdopt',{beforeAction:()=>software(mismatch==='grams'?426:425,{windowId:replacementWindow,rawGrams:mismatch==='grams'?426.2:425.2})});
    software(425,{windowId:initialWindow,rawGrams:425.1});await refresh();await waitAction('scaleAdopt',2);await waitWeight(mismatch==='grams'?426:425);await waitAdd(true);
    assert.equal(actions('scaleAdopt')[0].scaleWindowId,initialWindow);assert.equal(actions('scaleAdopt')[0].scaleGrams,425);
    assert.equal(actions('scaleAdopt')[1].scaleWindowId,replacementWindow);assert.equal(actions('scaleAdopt')[1].scaleGrams,mismatch==='grams'?426:425);
    assert.equal((await captures()).length,1);assert.equal(adoptResults.length,1);assert.equal((await captures())[0].measurement.filter.windowId,replacementWindow);
  }
  checks.push('a window replacement with unchanged grams or a changed load rejects stale proof409; only fresh current window and exact net produce a capture after refresh');

  await open({scale_filter_settings:filter});await waitAction('scaleStart');
  const sameNetOldWindow=randomUUID(),sameNetNewWindow=randomUUID();software(427,{windowId:sameNetOldWindow,rawGrams:427.1});await refresh();await waitWeight(427);await waitAdd(true);
  const sameNetOldSession=await waitSession(),sameNetHeld=plan('scaleAdopt',{hold:true});
  software(427,{windowId:sameNetNewWindow,rawGrams:427.2});await refresh();await waitAdd(false);
  await waitNewSession(sameNetOldSession);assert.equal((await captures()).length,1);
  for(const [index,raw]of[427.3,427.1,427.2].entries()){
    if(index)await settle(1000);nativeSoftware(raw);await refresh();if(index<2){await waitAdd(false);assert.equal((await captures()).length,1);}
  }
  const sameNetSuccessorWindow=station.scale_reading.filter.windowId;
  assert.notEqual(sameNetSuccessorWindow,sameNetOldWindow);assert.notEqual(sameNetSuccessorWindow,sameNetNewWindow);
  await waitPlan(sameNetHeld);await waitAdd(false);assert.equal((await captures()).length,1);
  sameNetHeld.gate.resolve();await page.waitForFunction(()=>window.__scaleCaptures.length===2);await waitAdd(true);
  assert.equal((await captures())[0].measurement.filter.windowId,sameNetOldWindow);assert.equal((await captures())[1].measurement.filter.windowId,sameNetSuccessorWindow);
  checks.push('a reset into a new accepted window with the same427g net immediately blocks the old capture; a fresh session and new immutable capture are required before readiness returns');

  await open({scale_filter_settings:filter});await waitAction('scaleStart');
  plan('scaleAdopt',{error:'重量が更新されました。',beforeError:()=>software(430,{rawGrams:430.3})});
  software(429,{rawGrams:429.2});await refresh();await waitAction('scaleAdopt',2);await waitWeight(430);await waitAdd(true);
  assert.deepEqual((await captures()).map(capture=>capture.grams),[430]);
  assert.notEqual(actions('scaleAdopt')[0].scaleSequence,actions('scaleAdopt')[1].scaleSequence);
  checks.push('an advanced sequence409 refreshes and retries the new exact sequence; no stale or duplicate weight is adopted');

  await open({scale_filter_settings:filter}); await waitAction('scaleStart');
  reading({ grams: 301, stable: true }); await refresh(); await settle(450); assert.deepEqual(await captures(), []); await waitAdd(false);
  software(301.4,{accepted:false,hardwareStable:true,rawGrams:301.4}); await refresh(); await waitText('ソフトウェア判定');await waitAdd(false);
  assert.equal(await page.$eval('.store-relay-scale details',element=>element.open),false);await openScaleDiagnostics();await waitText('はかり本体');
  assert.deepEqual(await captures(), []);
  checks.push('an enabled filter rejects bare hardware ST and collecting software windows, while showing software and hardware states separately');

  software(301,{rawGrams:301.4}); await refresh(); await waitWeight(301); await waitAdd(true);
  assert.equal((await captures()).length,1); assert.equal((await captures())[0].measurement.filter.source,'software_window');
  software(301,{hardwareStable:true,rawGrams:301.1}); await refresh(); await waitAdd(true);
  assert.equal(await page.$eval('input[data-fixture-weight]',e=>e.value),'301');
  software(301,{rawGrams:301.2}); await refresh(); await waitAdd(true); assert.equal((await captures()).length,1);
  assert.equal(actions('scaleStart').length,1);
  await waitText('はかりの読取値'); await waitText('判定後の正味重量'); await screenshot('software-stable');
  checks.push('accepted software weight auto-adopts at1g, raw and accepted weights are distinct, and alternating hardware ST/US cannot restart or invalidate the retained software session');

  // Reproduce the reported long-lived flicker using the actual numerical window
  // rather than fixtures that mark every frame accepted. Independent 1 Hz native
  // measurements run for more than 24 real seconds; ordinary browser polls do
  // not enter the algorithm and the hardware ST bit changes on every sample.
  await open({scale_filter_settings:filter});await waitAction('scaleStart');
  const continuousSession=await waitSession(),continuousStartedAt=Date.now(),continuousFrames=[];
  for(let sample=0;sample<=24;sample++){
    if(sample)await settle(Math.max(0,continuousStartedAt+sample*1000-Date.now()));
    const raw=[300.8,301.2,300.9,301.1][sample%4],hardwareStable=sample%2===0;
    const evaluated=nativeSoftware(raw,{hardwareStable});await refresh();
    continuousFrames.push({sample,at:Date.now()-continuousStartedAt,raw,hardwareStable,accepted:evaluated.reading.filter.accepted,
      sampleCount:evaluated.reading.filter.sampleCount,spanMs:evaluated.reading.filter.spanMs,session:station.scale_session});
    if(sample===2){
      await waitWeight(301);await waitAdd(true);
      assert.equal(await page.$eval('.store-relay-scale details',element=>element.open),false);
      await page.evaluate(()=>{window.__scaleReadinessProbe={startedAt:Date.now(),blocked:[],primaryWaiting:[]};window.__scaleReadinessTimer=setInterval(()=>{
        if(document.querySelector('button[data-fixture-add]')?.disabled)window.__scaleReadinessProbe.blocked.push({at:Date.now(),text:document.querySelector('.store-relay-scale')?.textContent});
        const primary=[...document.querySelector('.store-relay-scale').children].filter(element=>element.tagName!=='DETAILS').map(element=>element.textContent).join(' ');
        if(primary.includes('安定待ち'))window.__scaleReadinessProbe.primaryWaiting.push({at:Date.now(),text:primary});
      },25);});
    }
    if(sample>=2){
      assert.equal(evaluated.reading.filter.accepted,true,`actual window re-entered collecting at sample${sample}`);
      await waitAdd(true);assert.equal(station.scale_session,continuousSession);assert.equal(actions('scaleStart').length,1);
      assert.equal((await captures()).length,1);assert.equal(actions('scaleAdopt').length,1);
      assert.match(await page.$eval('.store-relay-scale > span',element=>element.textContent),/301 g · 安定$/);
    }
  }
  const continuousProbe=await page.evaluate(()=>{clearInterval(window.__scaleReadinessTimer);return window.__scaleReadinessProbe;});
  assert.deepEqual(continuousProbe.blocked,[],'the business confirmation flickered while an accepted native software window was unchanged');
  assert.deepEqual(continuousProbe.primaryWaiting,[],'hardware ST/US leaked a waiting state into the default primary software judgement');
  assert.ok(Date.now()-continuousStartedAt>=24000);
  await writeFile(`${output}/continuous-native-window.json`,JSON.stringify({durationMs:Date.now()-continuousStartedAt,frames:continuousFrames,probe:continuousProbe,
    captures:await captures(),starts:actions('scaleStart'),adopts:actions('scaleAdopt')},null,2)+'\n');
  checks.push('25 actual independent native samples over24 real seconds keep one accepted software window, one monitoring session and one capture; business readiness never flickers despite raw drift and alternating hardware ST/US');
  await screenshot('software-primary');

  const loadChangeSession=await waitSession(),loadChangeStarts=actions('scaleStart').length;
  nativeSoftware(510); await refresh(); await waitAdd(false); await waitText('重量を再確認しています。安定するまで追加できません。');
  await waitNewSession(loadChangeSession);assert.equal(actions('scaleStart').length,loadChangeStarts+1);
  software(0,{accepted:false,rawGrams:0}); await refresh(); await settle(450); await waitAdd(false);
  assert.equal(actions('scaleStart').length,loadChangeStarts+1,'unsafe load rotated its session repeatedly');
  for(const [index,raw]of[510.4,510.2,510.3].entries()){
    if(index)await settle(1000);const successor=nativeSoftware(raw);await refresh();
    if(index<2){assert.equal(successor.reading.filter.accepted,false);await waitAdd(false);assert.equal((await captures()).length,1);}
  }
  await waitWeight(510); await waitAdd(true); assert.equal((await captures()).length,2);
  checks.push('an actual filter reset from a larger load change immediately blocks the previous weight and rotates once; removing it cannot bypass the latch, and only a newly accepted successor window unlocks addition');

  const previousSession=await waitSession(); const oldStartCount=actions('scaleStart').length;
  changeSettings({...filter,revision:'filter-b',toleranceGrams:3,settleMs:3000}); await refresh(); await waitAction('scaleStart',oldStartCount+1); assert.notEqual(station.scale_session,previousSession); await waitAdd(false);
  software(510,{revision:'filter-a'}); await refresh(); await settle(450); await waitAdd(false); assert.equal((await captures()).length,2);
  software(511,{revision:'filter-b'}); await refresh(); await waitWeight(511); await waitAdd(true); assert.equal((await captures()).length,3);
  checks.push('parameter/revision changes clear the current confirmation and rotate the session; stale filter proof cannot unlock the new policy');

  await open({scale_filter_settings:filter}); await waitAction('scaleStart'); const held=plan('scaleAdopt',{hold:true}); software(280,{rawGrams:280.4}); await refresh(); await waitAction('scaleAdopt');
  changeSettings({...filter,revision:'filter-c'}); await refresh(); const startsBeforeRelease=actions('scaleStart').length; await waitAction('scaleStart',startsBeforeRelease+1);
  held.gate.resolve(); await settle(500); assert.deepEqual(await captures(), []); await waitAdd(false);
  software(281,{revision:'filter-c'}); await refresh(); await waitWeight(281); assert.equal((await captures()).length,1);
  checks.push('an adopt response held across a settings change cannot populate or revalidate the successor measurement');

  const beforeDisable=actions('scaleStart').length;changeSettings({enabled:false,revision:'filter-disabled',toleranceGrams:2,settleMs:2000});await refresh();await waitAction('scaleStart',beforeDisable+1);await waitAdd(false);
  software(281,{revision:'filter-c'});await refresh();await settle(450);await waitAdd(false);
  reading({grams:282});await refresh();await waitWeight(282);await waitAdd(true);
  checks.push('turning filtering off rotates the session and needs a fresh hardware reading; old software samples are rejected');

  const tare={enabled:true,revision:'tare-a',presets:[{id:'small',grams:112.3},{id:'large',grams:200}]};
  // Force old-end/new-start conflict, then supersede and finish the recovery GET
  // before releasing it. A discarded GET must deliver the newer flight result.
  for(const invalidJson of [false,true]){
  await open({scale_filter_settings:filter});await waitAction('scaleStart');await waitSession();await refresh();
  const endedSession=station.scale_session;const delayedEnd=plan('scaleEnd',{hold:true});
  plan('scaleStart',{error:'計量セッションが変わりました。',beforeError:()=>{station={...station,scale_session:null,scale_sequence:-1,scale_reading:null,scale_received_at:null};}});
  const recoveryGet=plan('GET',{hold:true,invalidJson,afterAction:'scaleStart',afterActionCount:2});await page.evaluate(tare=>window.__scaleFixture.setTare(tare),tare);await waitPlan(recoveryGet);
  await refresh();recoveryGet.gate.resolve();await waitAction('scaleStart',3);const recoveredSession=await waitSession();
  assert.notEqual(recoveredSession,endedSession);assert.equal(actions('scaleStart').at(-1).expectedScaleSession,null);
  delayedEnd.gate.resolve();await settle(300);assert.equal(station.scale_session,recoveredSession,'late cleanup cannot clear the successor');
  software(300,{rawGrams:412.7,mode:'preset',grossGrams:412.3,tareGrams:112.3,tarePresetId:'small',settingsRevision:'tare-a'});await refresh();await waitWeight(300);await waitAdd(true);
  }
  checks.push('old cleanup/start409 automatically recovers using a newer completed GET even when it supersedes a held successful or malformed recovery response; late cleanup cannot end its successor');

  // A latest failed GET must reject all older waiters, not fall back to cache.
  await open({scale_filter_settings:filter});await waitAction('scaleStart');await waitSession();await refresh();
  const oldGet=plan('GET',{hold:true});await page.evaluate(()=>{window.__oldRefreshResult=null;window.__scaleFixture.refresh().then(value=>window.__oldRefreshResult={ok:true,value},error=>window.__oldRefreshResult={ok:false,message:error.message});});await waitPlan(oldGet);
  plan('GET',{error:'fixture latest refresh unavailable',status:503});const failedLatest=await page.evaluate(()=>window.__scaleFixture.refresh().then(()=>({ok:true}),error=>({ok:false,message:error.message})));
  assert.deepEqual(failedLatest,{ok:false,message:'fixture latest refresh unavailable'});oldGet.gate.resolve();await page.waitForFunction(()=>window.__oldRefreshResult!==null);
  assert.deepEqual(await page.evaluate(()=>window.__oldRefreshResult),{ok:false,message:'fixture latest refresh unavailable'});
  checks.push('a superseding GET failure propagates to older refresh callers instead of returning cached session data');

  // A competing successor or changed epoch is never overwritten by recovery.
  for(const changedEpoch of [false,true]){
    await open({scale_filter_settings:filter});await waitAction('scaleStart');await waitSession();await refresh();
    const cleanup=plan('scaleEnd',{hold:true});plan('scaleStart',{error:'計量セッションが変わりました。',beforeError:()=>{station={...station,scale_session:null,scale_sequence:-1,scale_reading:null,scale_received_at:null};}});
    const heldGet=plan('GET',{hold:true,afterAction:'scaleStart',afterActionCount:2});await page.evaluate(tare=>window.__scaleFixture.setTare(tare),tare);await waitPlan(heldGet);
    const successor='00000000-0000-4000-8000-000000000099';station={...station,scale_session:successor,...(changedEpoch?{epoch:8}:{})};await refresh();heldGet.gate.resolve();cleanup.gate.resolve();await settle(700);
    assert.equal(actions('scaleStart').length,2);assert.equal(station.scale_session,successor);assert.deepEqual(await captures(),[]);await waitAdd(false);
    if(changedEpoch)assert.equal((await page.evaluate(()=>window.__scaleFixture.state())).owner,null);
  }
  checks.push('superseding current sessions and changed owner epochs prevent recovery from starting or adopting under stale ownership');

  await open({scale_filter_settings:filter});await waitAction('scaleStart');await waitSession();await refresh();
  const preTareSession=station.scale_session;await page.evaluate(tare=>window.__scaleFixture.setTare(tare),tare);await waitNewSession(preTareSession);
  software(300,{rawGrams:412.7,mode:'preset',grossGrams:412.3,tareGrams:112.3,tarePresetId:'small',settingsRevision:'tare-a'});await refresh();await waitWeight(300);await waitText('判定後の総重量');
  software(300,{rawGrams:412.7,mode:'preset',grossGrams:412.3,tareGrams:112.3,tarePresetId:'small',settingsRevision:'tare-a'});await refresh();await openScaleDiagnostics();await waitText('412.7');await screenshot('filter-and-tare');
  checks.push('filtered gross and raw scale readings are labelled separately when plate tare is active, while adopted net remains300g');

  // A genuine zero after a successful capture is the normal bowl-removal flow.
  // Conversely, an unsafe sample must latch before zero can hide it.
  await open({scale_filter_settings:filter});await waitAction('scaleStart');software(304,{rawGrams:304.1});await refresh();await waitWeight(304);await waitAdd(true);
  software(0,{accepted:false,rawGrams:0});await refresh();await settle(700);await waitAdd(true);assert.equal((await captures()).length,1);assert.equal(actions('scaleStart').length,1);
  checks.push('normal zero after removing a confirmed bowl preserves its captured weight and readiness without restarting monitoring');

  for(const unsafe of ['null','overload','stale','disconnect']){
    await open({scale_filter_settings:filter});await waitAction('scaleStart');software(305,{rawGrams:305.2});await refresh();await waitWeight(305);await waitAdd(true);
    if(unsafe==='null')station={...station,scale_sequence:station.scale_sequence+1,scale_reading:null,scale_received_at:new Date().toISOString()};
    if(unsafe==='overload')software(3001,{accepted:false,overload:true});
    if(unsafe==='stale')software(305,{rawGrams:305.2,age:11000});
    if(unsafe==='disconnect')station={...station,device_online:false,device_status:{...station.device_status,scale:'disconnected'}};
    await refresh();await waitAdd(false);
    if(unsafe==='disconnect')station={...station,device_online:true,device_status:{...station.device_status,scale:'connected'}};
    software(0,{accepted:false,rawGrams:0});await refresh();await settle(700);await waitAdd(false);
    assert.equal(await page.$eval('input[data-fixture-weight]',input=>input.value),'305');assert.equal((await captures()).length,1);
  }
  checks.push('active-session null, overload, stale samples and relay disconnect each block old confirmation immediately; a later zero cannot unlock the unsafe capture');

  await open({scale_filter_settings:filter});await waitAction('scaleStart');software(306,{rawGrams:306.1});await refresh();await waitWeight(306);await waitAdd(true);
  await page.evaluate(()=>window.__scaleFixture.setManual(true));await page.waitForFunction(()=>window.__scaleFixture.state().validity?.ready===false);
  software(600,{rawGrams:600.1});await refresh();await settle(650);assert.equal((await captures()).length,1);await waitWeight(306);
  const beforeAutoResume=actions('scaleStart').length;await page.evaluate(()=>window.__scaleFixture.setManual(false));await waitAction('scaleStart',beforeAutoResume+1);await waitAdd(false);
  software(307,{rawGrams:307.1});await refresh();await waitWeight(307);await waitAdd(true);assert.equal((await captures()).length,2);
  checks.push('manual mode suspends automatic capture and clears its validity; resuming automatic weighing requires a new session and independently confirmed weight');

  await open({scale_filter_settings:filter});await waitAction('scaleStart');software(308,{rawGrams:308.1});await refresh();await waitWeight(308);await waitAdd(true);
  const previousTareSession=await waitSession();await page.evaluate(tare=>window.__scaleFixture.setTare(tare),tare);await waitNewSession(previousTareSession);await waitAdd(false);
  software(308,{rawGrams:308.2});await refresh();await settle(500);await waitAdd(false);assert.equal((await captures()).length,1);
  software(308,{rawGrams:420.7,mode:'preset',grossGrams:420.3,tareGrams:112.3,tarePresetId:'small',settingsRevision:'tare-a'});await refresh();await waitWeight(308);await waitAdd(true);
  assert.equal((await captures()).length,2);assert.equal((await captures())[1].measurement.settingsRevision,'tare-a');
  const beforeTareRevision=await waitSession(),updatedTare={...tare,revision:'tare-b',presets:[{id:'small',grams:120},{id:'large',grams:200}]};
  await page.evaluate(tare=>window.__scaleFixture.setTare(tare),updatedTare);await waitNewSession(beforeTareRevision);await waitAdd(false);
  software(308,{rawGrams:420.7,mode:'preset',grossGrams:420.3,tareGrams:112.3,tarePresetId:'small',settingsRevision:'tare-a'});await refresh();await settle(500);await waitAdd(false);assert.equal((await captures()).length,2);
  software(308,{rawGrams:428.3,mode:'preset',grossGrams:428,tareGrams:120,tarePresetId:'small',settingsRevision:'tare-b'});await refresh();await waitAdd(true);
  assert.equal((await captures()).length,3);assert.equal((await captures())[2].measurement.settingsRevision,'tare-b');assert.equal((await captures())[2].measurement.tareGrams,120);
  checks.push('enabling or revising plate tare invalidates a live capture and rotates its session; the same308g net requires new current-tare captures, and old device-net or preset proof cannot unlock it');

  for(const language of ['zh-Hans','zh-Hant']){
    await open({scale_filter_settings:filter},{language});await waitAction('scaleStart');software(300,{rawGrams:300.4});await refresh();await waitWeight(300);software(300,{rawGrams:300.2});await refresh();
    assert.equal(await page.$eval('.store-relay-scale details',element=>element.open),false);await openScaleDiagnostics();
    await waitText(dictionaries[language]['ソフトウェア判定']);await waitText(dictionaries[language]['はかりの読取値']);await screenshot(`software-${language}`);
  }
  checks.push('primary software judgement keeps hardware diagnostics collapsed by default; the disclosure and raw/accepted labels translate in Simplified and Traditional Chinese at390/768/1440px without overflow');
  }
  assert.deepEqual(requests, []); assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []);
  await writeFile(`${output}/ui-verification.json`,JSON.stringify({passed:true,checks,pageErrors,unexpectedRequests:requests,externalRequests,fixture:'actual React component+relay hook+numerical filter algorithm;25 independent native samples over24 real seconds plus isolated validated HTTP fault fixtures'},null,2)+'\n');
  await rm(`${output}/failure.png`,{force:true});console.log(`PASS software filter POS UI: ${checks.length} groups.`);

} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: false, checks, pageErrors, unexpectedRequests: requests, externalRequests, posts, station,fixtureState:page&&!page.isClosed()?await page.evaluate(()=>window.__scaleFixture?.state()).catch(()=>null):null, error: error.stack }, null, 2) + '\n'); throw error;
} finally {
  stop();
  for (const next of pending) next.gate.resolve();
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
