// Exercise the real relay hook against isolated HTTP fixtures. No production,
// orders, payment provider, Android device, scale, or printer is contacted.
import { build, stop } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

let browser, server;
try {
const output = resolve(process.env.STORE_RELAY_OWNER_UI_OUTPUT || 'outputs/store-relay-owner-recovery-20261018/ui');
await mkdir(output, { recursive: true });
const entry = `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{useStoreRelay}from'./app/store/components/useStoreRelay';
import{StoreRelayPanel}from'./app/store/components/StoreRelayPanel';
import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
window.__relayOwners=[];
function Fixture(){const[store,setStore]=useState(new URLSearchParams(location.search).get('store')||'store-a');const relay=useStoreRelay(store);
useEffect(()=>{window.__relayFixture={action:relay.action,refresh:relay.refresh,setStore,state:()=>({store,owner:relay.owner,station:relay.station,error:relay.error,required:relay.required,recoveryVersion:relay.recoveryVersion,registerClosed:relay.registerClosed,recoveringStationId:relay.recoveringStationId})};window.__relayOwners.push({store,owner:relay.owner});},[store,relay]);
return <main style={{padding:16,maxWidth:1000,margin:'0 auto'}}><h1>レジ端末の接続確認</h1><p data-store>{store}</p><p data-owner>{relay.owner?'この端末で会計中':'会計端末を確認中'}</p><p data-error>{relay.error}</p><StoreRelayPanel relay={relay} storeId={store}/></main>}
createRoot(document.getElementById('root')).render(<OsTranslationProvider><Fixture/></OsTranslationProvider>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = await readFile('app/globals.css', 'utf8') + '\n' + await readFile('app/store/store-responsive.css', 'utf8') + '\n' + bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async language => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const savedKey = store => `store-relay-owner:${store}`;
const makeOwner = (store = 'store-a', epoch = 7) => ({ stationId: `station-${store.slice(-1)}`, token: `fixture-${store}-${epoch}`, epoch });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let stations, credentials, posts, plans, authenticated;
function reset() {
  credentials = new Map(['store-a', 'store-b'].map(store => [store, makeOwner(store)]));
  stations = new Map([...credentials].map(([store, owner]) => [store, { id: owner.stationId, name: 'レジ A', enabled: true, print_enabled: true, scale_enabled: true, epoch: owner.epoch, owner_until: new Date(Date.now() + 60000).toISOString(), device_online: true, device_paired: true, scale_session: null, scale_sequence: -1, scale_reading: null, scale_received_at: null }]));
  posts = []; plans = []; authenticated = true;
}
reset();
function plan(action, patch = {}) { const value = { action, store: 'store-a', hold: false, status: 200, ...patch, gate: deferred(), seen: false }; plans.push(value); return value; }
const checks = [], pageErrors = [], unexpectedRequests = [], externalRequests = [];
let transportAborts = 0;
const send = (response, body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); };
server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://fixture');
    if (url.pathname === '/seed') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Isolated test setup</title>'); return; }
    if (url.pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(js); return; }
    if (url.pathname.startsWith('/locales/os/')) { send(response, dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']); return; }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (url.pathname === '/api/store/device-relay') {
      if (request.method === 'GET') {
        const next = plans.find(next => !next.seen && next.action === 'GET' && next.store === url.searchParams.get('storeId'));
        if (next) { next.seen = true; if (next.hold) await next.gate.promise; if (next.status !== 200) { send(response, { error: next.error || 'Fixture operation failed.' }, next.status); return; } }
        if (!authenticated) { send(response, { error: 'ログインしてください。' }, 401); return; }
        const station = stations.get(url.searchParams.get('storeId'));
        send(response, { stations: station ? [station] : [], jobs: [], serverNow: new Date().toISOString(), serverElapsedMs: 0 }); return;
      }
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); posts.push(body);
      const next = plans.find(next => !next.seen && next.action === body.action && next.store === body.storeId);
      if (next) { next.seen = true; if (next.hold) await next.gate.promise; if (next.disconnect) { response.destroy(); return; } if (next.status !== 200) { send(response, { error: next.error || 'Fixture operation failed.' }, next.status); return; } if (next.reply) { send(response, next.reply); return; } }
      if (!authenticated) { send(response, { error: 'ログインしてください。' }, 401); return; }
      const station = stations.get(body.storeId), expected = credentials.get(body.storeId);
      if (body.action === 'claim' || body.action === 'takeover') {
        if (body.epoch !== station.epoch) { send(response, { error: 'レジの状態が変わりました。' }, 409); return; }
        const owner = { ...makeOwner(body.storeId, station.epoch + 1), stationId: station.id };
        credentials.set(body.storeId, owner); Object.assign(station, { epoch: owner.epoch, owner_until: new Date(Date.now() + 60000).toISOString(), scale_session: null, scale_sequence: -1, scale_reading: null, scale_received_at: null });
        send(response, { ok: true, owner }); return;
      }
      if (body.action === 'resume' || body.action === 'heartbeat') {
        if (!station.enabled || JSON.stringify(body.owner) !== JSON.stringify(expected)) { send(response, { error: 'レジの操作権がありません。' }, 409); return; }
        const resumed = Date.parse(station.owner_until) <= Date.now();
        if (resumed) Object.assign(station, { scale_session: null, scale_sequence: -1, scale_reading: null, scale_received_at: null });
        station.owner_until = new Date(Date.now() + 60000).toISOString();
        send(response, { ok: true, resumed, ownerUntil: station.owner_until }); return;
      }
      unexpectedRequests.push(body); send(response, { error: 'Unexpected action' }, 400); return;
    }
    if (url.pathname.startsWith('/api/')) { unexpectedRequests.push({ method: request.method, path: url.pathname }); send(response, {}, 403); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html);
  } catch (error) { response.writeHead(500); response.end(error.stack); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let context, page;
async function configurePage(target) {
  target.setDefaultTimeout(10000); target.on('pageerror', error => pageErrors.push(error.message));
  await target.evaluateOnNewDocument(() => {
    const nativeInterval = window.setInterval, nativeClearInterval = window.clearInterval;
    const nativeTimeout = window.setTimeout, nativeClearTimeout = window.clearTimeout;window.__relayDelays=[];
    const timers = new Map(); let id = 1000000;
    // Fire only the actual 12-second lease/recovery timers deterministically.
    window.setInterval = (callback, delay, ...args) => { if (delay !== 12000) return nativeInterval(callback, delay, ...args); const key = ++id; timers.set(key, { callback: () => callback(...args), once: false }); return key; };
    window.clearInterval = key => { timers.delete(key); return nativeClearInterval(key); };
    window.setTimeout = (callback, delay, ...args) => { window.__relayDelays.push(delay); if (delay !== 12000) return nativeTimeout(callback, delay === 10000 && new URLSearchParams(location.search).has('fastTimeout') ? 200 : delay, ...args); const key = ++id; timers.set(key, { callback: () => callback(...args), once: true }); return key; };
    window.clearTimeout = key => { timers.delete(key); return nativeClearTimeout(key); };
    window.__fireRelayTimers = () => { for (const [key, timer] of [...timers]) { if (timer.once) timers.delete(key); timer.callback(); } };
    const prototype = Storage.prototype;
    for (const operation of ['getItem', 'setItem', 'removeItem']) { const native = prototype[operation]; prototype[operation] = function (...args) { if (window.__blockStorage || (window.__blockStorageWrites && operation !== 'getItem')) throw new DOMException('Fixture storage is unavailable', 'SecurityError'); return native.apply(this, args); }; }
  });
  await target.setRequestInterception(true);
  target.on('request', request => { if (request.url().startsWith(origin + '/')) { if (target.__abortHeartbeat && request.method() === 'POST' && JSON.parse(request.postData() || '{}').action === 'heartbeat') { target.__abortHeartbeat = false; transportAborts++; request.abort('failed'); } else request.continue(); } else { externalRequests.push(request.url()); request.abort(); } });
}
async function open({ seed = makeOwner(), legacy = false, beforeNavigate = null, store = 'store-a', fastTimeout = false, language = 'ja' } = {}) {
  if (context) await context.close();
  reset(); context = await browser.createBrowserContext(); page = await context.newPage(); await configurePage(page);
  await page.goto(`${origin}/seed`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(language => { localStorage.setItem('foundr1-os-language', language); localStorage.setItem('foundr1-os-language-preference', 'manual'); }, language);
  if (seed) await page.evaluate(({ key, seed, legacy }) => (legacy ? sessionStorage : localStorage).setItem(key, JSON.stringify(seed)), { key: savedKey(store), seed, legacy });
  if (beforeNavigate) await beforeNavigate();
  await page.goto(`${origin}/?store=${store}${fastTimeout ? '&fastTimeout=1' : ''}`, { waitUntil: 'domcontentloaded' }); await waitFixture();
}
async function waitFixture() { await page.waitForFunction(() => typeof window.__relayFixture?.action === 'function'); }
const state = () => page.evaluate(() => window.__relayFixture.state());
const stored = (store = 'store-a', type = 'localStorage') => page.evaluate(({ key, type }) => JSON.parse(window[type].getItem(key) || 'null'), { key: savedKey(store), type });
const actions = (action, store = 'store-a') => posts.filter(post => post.action === action && post.storeId === store);
const settle = (ms = 100) => new Promise(done => setTimeout(done, ms));
async function waitUntil(condition, description) { for (let count = 0; count < 150; count++) { if (await condition()) return; await settle(25); } throw new Error(description); }
const waitAction = (action, count = 1, store = 'store-a') => waitUntil(() => actions(action, store).length >= count, `Expected ${count} ${action} request(s) for ${store}; actual ${actions(action, store).length}`);
const waitOwner = owner => waitUntil(async () => JSON.stringify((await state()).owner) === JSON.stringify(owner), `Expected active owner ${JSON.stringify(owner)}`);
const fireTimer = () => page.evaluate(() => window.__fireRelayTimers());
const foreground = event => page.evaluate(event => { if (event === 'visibilitychange') document.dispatchEvent(new Event(event)); else window.dispatchEvent(new Event(event)); }, event);
const refresh = () => page.evaluate(() => window.__relayFixture.refresh());
const claim = action => page.evaluate(action => window.__relayFixture.action(action, { stationId: 'station-a', epoch: 7 }), action);
const assertNoAutoClaim = () => { assert.equal(actions('claim').length, 0); assert.equal(actions('takeover').length, 0); };
async function screenshot(name) {
  for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
    await page.setViewport({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name}: horizontal overflow at ${width}`);
    await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
  }
}

try {
  let held;
  await open({ beforeNavigate: () => { held = plan('resume', { hold: true }); } });
  await waitAction('resume'); await waitOwner(null); await settle();
  assert.equal((await page.evaluate(() => window.__relayOwners)).some(item => item.owner !== null), false, 'a saved credential must not become active before server validation');
  held.gate.resolve(); await waitOwner(makeOwner()); assert.deepEqual(await stored(), makeOwner()); assertNoAutoClaim();
  checks.push('saved local ownership is server-validated before it is exposed as active');

  await page.reload({ waitUntil: 'domcontentloaded' }); await waitFixture(); await waitOwner(makeOwner()); assert.ok(actions('resume').length >= 2); assertNoAutoClaim();
  const oldPage = page; page = await context.newPage(); await configurePage(page); await page.goto(`${origin}/seed`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), savedKey('store-a')), null);
  await page.goto(`${origin}/?store=store-a`, { waitUntil: 'domcontentloaded' }); await waitFixture(); await waitOwner(makeOwner()); await oldPage.close(); assertNoAutoClaim();
  checks.push('reload and a new page in the same browser context recover from durable local storage without a checkout tap');

  await open({ legacy: true }); await waitOwner(makeOwner()); assert.deepEqual(await stored(), makeOwner()); assertNoAutoClaim();
  checks.push('the previous session-only credential migrates to durable storage and is validated');

  await open({ beforeNavigate: () => { Object.assign(stations.get('store-a'), { owner_until: new Date(Date.now() - 60000).toISOString(), scale_session: 'old-live-measurement', scale_sequence: 42, scale_reading: { grams: 204, stable: true }, scale_received_at: new Date().toISOString() }); } });
  await waitOwner(makeOwner()); assert.equal(stations.get('store-a').scale_session, null); assert.equal((await state()).station?.scale_session, null); assert.equal((await state()).owner.epoch, 7); assertNoAutoClaim();
  checks.push('an expired lease resumes the same identity and discards old live measurement evidence without taking over');

  await open(); await waitOwner(makeOwner()); const beforeHiddenVersion = (await state()).recoveryVersion;
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__fixtureVisibility || 'visible' }); window.__fixtureVisibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  await waitOwner(null); assert.deepEqual(await stored(), makeOwner()); const beforeHiddenPosts = posts.length; await fireTimer(); await settle(); assert.equal(posts.length, beforeHiddenPosts);
  await page.evaluate(() => { window.__fixtureVisibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); }); await waitOwner(makeOwner()); assert.ok((await state()).recoveryVersion > beforeHiddenVersion); assertNoAutoClaim();
  checks.push('backgrounding pauses active ownership and returning validates recovery while invalidating previous live weighing readiness');

  await open(); await waitOwner(makeOwner()); const beforeExpiredHeartbeatVersion = (await state()).recoveryVersion;
  Object.assign(stations.get('store-a'), { owner_until: new Date(Date.now() - 60000).toISOString(), scale_session: 'sleeping-live-measurement', scale_sequence: 42, scale_reading: { grams: 204, stable: true }, scale_received_at: new Date().toISOString() });
  await fireTimer(); await waitAction('heartbeat'); await waitUntil(async () => (await state()).recoveryVersion > beforeExpiredHeartbeatVersion, 'Expired heartbeat did not invalidate old weighing readiness'); await waitOwner(makeOwner()); assert.equal((await state()).station.scale_session, null); assertNoAutoClaim();
  checks.push('a stale locally active lease can expire on the server and still resume safely with a fresh weighing generation');

  await open(); await waitOwner(makeOwner());
  plan('heartbeat', { status: 503 }); await fireTimer(); await waitAction('heartbeat'); await waitOwner(null); assert.deepEqual(await stored(), makeOwner());
  await fireTimer(); await waitOwner(makeOwner()); assert.ok(actions('resume').length >= 2); assertNoAutoClaim();
  checks.push('temporary heartbeat failure pauses active use, preserves the credential, and recovers automatically on the next lease timer');

  await open({ beforeNavigate: () => { plan('resume', { status: 500 }); } }); await waitAction('resume'); await waitOwner(null); assert.deepEqual(await stored(), makeOwner());
  await fireTimer(); await waitOwner(makeOwner()); assertNoAutoClaim();
  checks.push('a temporary initial recovery failure retains durable intent and retries without a manual claim');

  await open({ fastTimeout: true, beforeNavigate: () => { held = plan('resume', { hold: true }); } }); await waitAction('resume');
  await waitUntil(async () => Boolean((await state()).error), 'A hanging ownership POST did not time out'); await waitOwner(null); assert.deepEqual(await stored(), makeOwner());
  held.gate.resolve(); await fireTimer(); await waitOwner(makeOwner()); assertNoAutoClaim();
  checks.push('an aborted hanging recovery POST preserves the credential and releases its flight so a timer can retry');

  await open({ fastTimeout: true }); await waitOwner(makeOwner()); held = plan('GET', { hold: true });
  await fireTimer(); await waitUntil(() => held.seen, 'The renewal did not request the hanging status GET'); await waitOwner(null); assert.deepEqual(await stored(), makeOwner());
  held.gate.resolve(); await foreground('focus'); await waitOwner(makeOwner()); assertNoAutoClaim();
  checks.push('an aborted hanging status GET releases its flight and foreground recovery remains usable');

  for (const event of ['focus', 'online', 'visibilitychange']) {
    await open(); await waitOwner(makeOwner());
    plan('heartbeat', { status: 503 }); await fireTimer(); await waitAction('heartbeat'); await waitOwner(null);
    const before = actions('resume').length; await foreground(event); await waitAction('resume', before + 1); await waitOwner(makeOwner()); assertNoAutoClaim();
  }
  checks.push('focus, network online, and visibility return immediately retry a paused credential');

  await open(); await waitOwner(makeOwner());
  page.__abortHeartbeat = true; await fireTimer(); await waitOwner(null); assert.deepEqual(await stored(), makeOwner()); assert.equal(transportAborts, 1);
  await foreground('online'); await waitOwner(makeOwner()); assertNoAutoClaim();
  checks.push('a transport failure preserves the credential and recovers when the network becomes available');

  await open(); await waitOwner(makeOwner());
  credentials.set('store-a', makeOwner('store-a', 8)); Object.assign(stations.get('store-a'), { epoch: 8 });
  await refresh(); await waitOwner(null); assert.equal(await stored(), null); const resumeCount = actions('resume').length;
  await fireTimer(); await foreground('focus'); await settle(200); assert.equal(actions('resume').length, resumeCount); assertNoAutoClaim();
  checks.push('another device taking over clears stale intent and is never automatically taken back');

  for (const status of [401, 403, 409]) {
    await open({ beforeNavigate: () => { plan('resume', { status }); } }); await waitAction('resume'); await waitOwner(null); await waitUntil(async () => await stored() === null, `The ${status} credential was not cleared`);
    assert.equal((await page.evaluate(() => window.__relayOwners)).some(item => item.owner !== null), false); const resumeCount = actions('resume').length; await fireTimer(); await foreground('online'); await settle(); assert.equal(actions('resume').length, resumeCount); assertNoAutoClaim();
  }
  checks.push('authentication, permission, and ownership rejection clear old credentials and never expose a previous account as active');

  await open(); await waitOwner(makeOwner()); const delayedFailure = plan('heartbeat', { hold: true, status: 409 });
  await fireTimer(); await waitAction('heartbeat'); await claim('takeover'); await waitOwner(makeOwner('store-a', 8));
  delayedFailure.gate.resolve(); await settle(200); assert.deepEqual((await state()).owner, makeOwner('store-a', 8)); assert.deepEqual(await stored(), makeOwner('store-a', 8));
  checks.push('a delayed failure for an old credential cannot clear a newly acquired owner or its durable record');

  await open(); await waitOwner(makeOwner()); const delayedSuccess = plan('heartbeat', { hold: true, reply: { ok: true } });
  await fireTimer(); await waitAction('heartbeat'); await claim('takeover'); await waitOwner(makeOwner('store-a', 8));
  delayedSuccess.gate.resolve(); await settle(200); assert.deepEqual((await state()).owner, makeOwner('store-a', 8)); assert.deepEqual(await stored(), makeOwner('store-a', 8));
  checks.push('a delayed successful heartbeat for an old credential cannot overwrite a newly acquired owner');

  await open(); await waitOwner(makeOwner()); const crossTabFailure = plan('heartbeat', { hold: true, status: 409 });
  await fireTimer(); await waitAction('heartbeat');
  const otherTab = await context.newPage(); await otherTab.goto(`${origin}/seed`, { waitUntil: 'domcontentloaded' });
  await otherTab.evaluate(({ key, owner }) => localStorage.setItem(key, JSON.stringify(owner)), { key: savedKey('store-a'), owner: makeOwner('store-a', 8) });
  crossTabFailure.gate.resolve(); await settle(200); assert.deepEqual(await stored(), makeOwner('store-a', 8)); await otherTab.close();
  checks.push('rejecting an old tab credential does not delete a newer credential saved by another tab');

  await open(); await waitOwner(makeOwner()); const heldRenewGet = plan('GET', { hold: true });
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }));
  await fireTimer(); await waitUntil(() => heldRenewGet.seen, 'Successful renewal did not refresh its station');
  const newerChoiceTab = await context.newPage(); await newerChoiceTab.goto(`${origin}/seed`, { waitUntil: 'domcontentloaded' });
  await newerChoiceTab.evaluate(({ key, owner }) => localStorage.setItem(key, JSON.stringify(owner)), { key: savedKey('store-a'), owner: makeOwner('store-a', 8) });
  heldRenewGet.gate.resolve(); await settle(200); await waitOwner(null); assert.deepEqual(await stored(), makeOwner('store-a', 8)); await newerChoiceTab.close();
  checks.push('an old successful renewal cannot replace the newer browser choice written by another tab');

  await open({ beforeNavigate: async () => { held = plan('resume', { hold: true }); await page.evaluate(({ key, owner }) => localStorage.setItem(key, JSON.stringify(owner)), { key: savedKey('store-b'), owner: makeOwner('store-b') }); } });
  await waitAction('resume'); await page.evaluate(() => window.__relayFixture.setStore('store-b')); await waitAction('resume', 1, 'store-b'); await waitOwner(makeOwner('store-b'));
  held.gate.resolve(); await settle(200); assert.equal((await state()).store, 'store-b'); assert.deepEqual((await state()).owner, makeOwner('store-b')); assert.deepEqual(await stored('store-b'), makeOwner('store-b'));
  checks.push('a delayed recovery response for the previous store cannot change the current store owner');

  await open({ seed: null }); await settle(200); await waitOwner(null); await fireTimer(); await foreground('focus'); await settle(100); assert.equal(actions('resume').length, 0); assertNoAutoClaim();
  checks.push('a device without a remembered credential never automatically claims or takes over a register');

  await open({ seed: null }); await page.evaluate(() => { window.__blockStorage = true; }); await claim('takeover'); await waitOwner(makeOwner('store-a', 8)); await fireTimer(); await waitAction('heartbeat'); await settle(); assert.deepEqual((await state()).owner, makeOwner('store-a', 8));
  await page.evaluate(() => { window.__blockStorage = false; });
  checks.push('unavailable browser storage does not block explicit checkout ownership or in-tab heartbeat');

  await open(); await waitOwner(makeOwner()); await page.evaluate(() => { window.__blockStorageWrites = true; });
  await claim('takeover'); await waitOwner(makeOwner('store-a', 8)); await fireTimer(); await waitAction('heartbeat'); await settle(); assert.deepEqual((await state()).owner, makeOwner('store-a', 8));
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }));
  const writableTab = await context.newPage(); await writableTab.goto(`${origin}/seed`, { waitUntil: 'domcontentloaded' });
  await writableTab.evaluate(({ key, owner }) => localStorage.setItem(key, JSON.stringify(owner)), { key: savedKey('store-a'), owner: makeOwner('store-a', 9) });
  await fireTimer(); await waitOwner(null); assert.deepEqual(await stored(), makeOwner('store-a', 9)); await writableTab.close();
  await page.evaluate(() => { window.__blockStorageWrites = false; });
  checks.push('storage write errors do not invalidate successful in-tab ownership, while a genuinely newer browser choice still takes precedence');

  await open(); await waitOwner(makeOwner()); Object.assign(stations.get('store-a'), { id: 'station-c', name: 'レジ C' });
  await page.evaluate(() => { window.__blockStorageWrites = true; });
  const otherStationOwner = { ...makeOwner('store-a', 8), stationId: 'station-c' };
  await page.evaluate(() => window.__relayFixture.action('takeover', { stationId: 'station-c', epoch: 7 })); await waitOwner(otherStationOwner);
  await fireTimer(); await waitAction('heartbeat'); await settle(); assert.deepEqual((await state()).owner, otherStationOwner);
  await page.evaluate(() => { window.__blockStorageWrites = false; }); await fireTimer();
  await waitUntil(async () => JSON.stringify(await stored()) === JSON.stringify(otherStationOwner), 'Recovered storage did not save the newly selected register');
  checks.push('choosing a different register with unavailable writes remains usable and saves the new choice when storage recovers');

  await open({ beforeNavigate: () => { held = plan('resume', { hold: true }); } }); await waitAction('resume');
  await page.waitForSelector('[role="status"]'); await screenshot('recovering');
  held.gate.resolve(); await waitOwner(makeOwner()); await screenshot('connected');
  credentials.set('store-a', makeOwner('store-a', 8)); Object.assign(stations.get('store-a'), { epoch: 8 }); await refresh(); await waitOwner(null);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('この端末に会計を引き継ぐ'))); await screenshot('takeover-available');
  checks.push('the actual relay panel shows recovery, connected, and takeover states without overflow at phone, tablet, and desktop sizes');

  await open({ language: 'zh-Hans', beforeNavigate: () => { held = plan('resume', { hold: true }); } }); await waitAction('resume');
  const translatedRecovery = dictionaries['zh-Hans']['この端末の会計を再接続しています…']; assert.ok(translatedRecovery);
  await page.waitForFunction(text => document.querySelector('[role="status"]')?.textContent === text, {}, translatedRecovery); await screenshot('recovering-zh-Hans'); held.gate.resolve(); await waitOwner(makeOwner());
  checks.push('the reconnecting panel uses the real Simplified Chinese dictionary and remains readable at representative sizes');

  await open();await waitOwner(makeOwner());
  Object.assign(stations.get('store-a'),{register_open:false,scale_operating:false});
  await refresh();await waitOwner(null);
  assert.equal((await state()).registerClosed,true);assert.deepEqual(await stored(),makeOwner());
  const closedPosts=posts.length;await fireTimer();await fireTimer();await settle(100);assert.equal(posts.length,closedPosts);
  assert.equal((await state()).recoveringStationId,null);
  await page.waitForFunction(()=>document.body.textContent.includes('閉店中・設備待機'));
  assert.ok(await page.evaluate(()=>window.__relayDelays.includes(60000)));
  await screenshot('closed-sleep');
  Object.assign(stations.get('store-a'),{register_open:true,scale_operating:true});
  await refresh();await waitOwner(makeOwner());assert.equal((await state()).registerClosed,false);
  checks.push('closing pauses lease renewals and recovery warnings, keeps the remembered owner, polls at one minute, and reopening resumes safely');

  assert.deepEqual(pageErrors, []); assert.deepEqual(unexpectedRequests, []); assert.deepEqual(externalRequests, []);
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: true, checks, pageErrors, unexpectedRequests, externalRequests, source: { hook: 'app/store/components/useStoreRelay.ts' } }, null, 2) + '\n');
  await rm(`${output}/failure.png`, { force: true }); console.log(`PASS relay ownership recovery UI: ${checks.length} lifecycle checks.`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: false, checks, pageErrors, unexpectedRequests, externalRequests, posts, fixtureState: page && !page.isClosed() ? await state().catch(() => null) : null, error: error.stack }, null, 2) + '\n'); throw error;
} finally {
  for (const next of plans) next.gate.resolve();
}
} finally {
  try {
    if (browser) await browser.close();
    if (server?.listening) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  } finally { stop(); }
}
