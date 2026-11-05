// Actual relay setup React components, local synthetic APIs and a JavaScript native-bridge mock.
// No production, database, printer, Bluetooth device, or real Android bridge is accessed.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = 'outputs/store-relay-setup-20261016';
await mkdir(output, { recursive: true });
const built = await build({
  stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{DeviceRelaySettings}from'./app/os/stores/devices/DeviceRelaySettings';import Page from './app/store/device-relay/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
localStorage.setItem('foundr1-os-language',localStorage.getItem('foundr1-os-language')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
function Fixture(){const[store,setStore]=useState('store-a');return new URLSearchParams(location.search).get('view')==='admin'?<main style={{padding:16,maxWidth:1280,margin:'0 auto'}}><div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}><label htmlFor="fixture-store">Fixture store</label><select id="fixture-store" value={store} onChange={e=>setStore(e.target.value)}><option value="store-a">桜並木店</option><option value="store-b">別店舗</option></select></div><DeviceRelaySettings storeId={store}/></main>:<Page/>};
createRoot(document.getElementById('root')).render(<OsTranslationProvider><Fixture/></OsTranslationProvider>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }
});
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = (await readFile('app/globals.css', 'utf8')) + '\n' + built.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const chinese = JSON.parse(await readFile('public/locales/os/zh-Hans.json', 'utf8'));
const translated = text => { assert.ok(chinese[text], `Missing Chinese dictionary entry: ${text}`); return chinese[text]; };
const station = (id = 'station-a', extra = {}) => ({ id, name: id === 'station-a' ? 'レジ A' : id === 'station-b' ? 'レジ B' : '別店舗レジ', enabled: true,
  print_enabled: true, scale_enabled: false, epoch: 1, owner_until: null, device_online: false, device_paired: false,
  scale_session: null, scale_reading: null, scale_received_at: null, device_status: {}, ...extra });
let state;
const reset = (extra = {}) => { state = { stations: { 'store-a': [station()], 'store-b': [station('station-other')] }, canManage: true, events: [], adminGets: [],
  failAdminPair: false, failAdminGet: false, holdAdminPair: false, heldAdminPair: null, holdGetStore: '', heldGet: null, ...extra }; };
reset();
const json = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
  if (url.pathname === '/locales/os/zh-Hans.json') { json(res, chinese); return; }
  if (url.pathname.startsWith('/locales/')) { json(res, {}); return; }
  if (url.pathname === '/api/store/context' && req.method === 'GET') {
    json(res, { access: { stores: [{ id: 'store-a', name: '桜並木店' }, { id: 'store-b', name: '別店舗' }] } }); return;
  }
  if (req.method === 'GET' && ['/api/os/stores/device-relay', '/api/store/device-relay'].includes(url.pathname)) {
    const storeId = url.searchParams.get('storeId') || '';
    state.adminGets.push({ path: url.pathname, storeId });
    if (state.failAdminGet && url.pathname === '/api/os/stores/device-relay') { json(res, { error: '合成テスト: 接続状態を取得できません。' }, 503); return; }
    const body = structuredClone({ stations: state.stations[storeId] || [], canManage: state.canManage, jobs: [] });
    if (storeId === state.holdGetStore && !state.heldGet) { state.holdGetStore = ''; state.heldGet = () => json(res, body); return; }
    json(res, body); return;
  }
  if (req.method === 'POST' && ['/api/os/stores/device-relay', '/api/store/device-relay'].includes(url.pathname)) {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw); state.events.push({ path: url.pathname, ...body });
    if (url.pathname === '/api/os/stores/device-relay') {
      if (!state.canManage || (body.action === 'pair' && state.failAdminPair)) { json(res, { error: '権限がありません。' }, 403); return; }
      if (body.action === 'save') {
        const list = state.stations[body.storeId] ||= []; let saved = list.find(entry => entry.id === body.stationId);
        if (!saved) { saved = station(body.stationId || 'station-new'); list.push(saved); }
        Object.assign(saved, { name: body.name, enabled: body.enabled, print_enabled: body.printEnabled, scale_enabled: body.scaleEnabled });
        json(res, { ok: true, stationId: saved.id }); return;
      }
      if (body.action === 'pair') {
        const reply = () => json(res, { ok: true, pairingCode: 'synthetic-code' });
        if (state.holdAdminPair) { state.holdAdminPair = false; state.heldAdminPair = reply; return; }
        reply(); return;
      }
      if (['testPrint', 'revoke'].includes(body.action)) { json(res, { ok: true }); return; }
    }
    if (url.pathname === '/api/store/device-relay' && body.action === 'pair') {
      json(res, { ok: true, token: 'T'.repeat(43), stationId: body.stationId || 'station-a' }); return;
    }
    json(res, { error: 'Unexpected synthetic mutation.' }, 400); return;
  }
  if (url.pathname.startsWith('/api/')) { json(res, { error: 'Unexpected synthetic endpoint.' }, 404); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const checks = [], errors = [], externalRequests = [];
let page;
const newPage = async ({ native = 'modern', running = false, resumeOk = true, language = 'ja' } = {}) => {
  if (page) await page.close();
  page = await browser.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith(origin + '/') || /^(data:|blob:)/.test(request.url())) request.continue();
    else { externalRequests.push(request.url()); request.abort(); }
  });
  await page.evaluateOnNewDocument(({ native, running, resumeOk, language }) => {
    localStorage.setItem('foundr1:store:selectedStoreId', 'store-b');
    localStorage.setItem('foundr1-os-language', language); localStorage.setItem('foundr1-os-language-preference', 'manual');
    window.__relayCalls = []; window.__relayRunning = running; window.__relayConfirm = false; window.__relayDialogs = [];
    window.confirm = text => { window.__relayDialogs.push(text); return window.__relayConfirm; };
    const fetchOriginal = window.fetch;
    window.fetch = function (input, init) {
      if (init?.method === 'POST' && typeof init.body === 'string') {
        const body = JSON.parse(init.body), path = String(input);
        window.__relayCalls.push(`${path.startsWith('/api/os/') ? 'admin' : 'store'}:${body.action}`);
      }
      return fetchOriginal.apply(this, arguments);
    };
    const bridge = {
      start(token) { window.__relayCalls.push('native:start'); window.__relayRunning = true; return JSON.stringify({ ok: token === 'T'.repeat(43) }); },
      resume() { window.__relayCalls.push('native:resume'); if (resumeOk) window.__relayRunning = true; return JSON.stringify({ ok: resumeOk }); },
      stop() { window.__relayCalls.push('native:stop'); window.__relayRunning = false; return JSON.stringify({ ok: true }); },
      status() { return native === 'unknown' ? '{}' : JSON.stringify({ running: window.__relayRunning, message: window.__relayRunning ? '接続を確認中' : '' }); }
    };
    if (native === 'modern' || native === 'unknown') window.Foundr1DeviceRelay = bridge;
    if (native === 'old') { window.Foundr1DeviceRelay = { start: bridge.start }; window.Foundr1Printer = {}; }
  }, { native, running, resumeOk, language });
};
const goto = async query => {
  await page.goto(`${origin}/store/device-relay?${query}`, { waitUntil: 'networkidle0' });
};
const button = async (text, action = 'click') => {
  await page.waitForFunction(text => [...document.querySelectorAll('button,a,summary')].some(element => element.textContent.trim() === text), {}, text);
  return page.evaluate(({ text, action }) => {
    const element = [...document.querySelectorAll('button,a,summary')].find(entry => entry.textContent.trim() === text);
    if (action === 'disabled') return element.disabled === true || element.getAttribute('aria-disabled') === 'true';
    if (action === 'href') return element.href;
    element.click();
  }, { text, action });
};
const checkbox = async text => page.evaluate(text => {
  const label = [...document.querySelectorAll('label')].find(entry => entry.querySelector('input[type="checkbox"]') && entry.textContent.trim().startsWith(text));
  if (!label?.querySelector('input[type="checkbox"]')) throw new Error(`Missing checkbox ${text}`);
  label.querySelector('input[type="checkbox"]').click();
}, text);
const waitBody = text => page.waitForFunction(text => document.body.textContent.includes(text), {}, text);
const startUnavailable = () => page.evaluate(() => ![...document.querySelectorAll('button')].some(element => element.textContent.trim() === 'このスマホで中継を開始' && !element.disabled));
const waitHeld = async property => {
  for (let attempt = 0; !state[property] && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(state[property], `Fixture held ${property}`);
};
const screenshots = async (prefix, widths = [390, 768, 1024, 1440]) => {
  for (const width of widths) {
    await page.setViewport({ width, height: 900 }); await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${prefix} overflow at ${width}px`);
    await page.screenshot({ path: `${output}/${prefix}-top-${width}.png`, fullPage: false });
    await page.screenshot({ path: `${output}/${prefix}-${width}.png`, fullPage: true });
  }
};

try {
  // Administrative setup: local drafts are saved independently from connecting a phone.
  reset({ stations: { 'store-a': [station('station-a', { enabled: false, print_enabled: false, device_online: true })], 'store-b': [station('station-other')] } });
  await newPage(); await goto('view=admin'); await waitBody('スマホで印刷・計量');
  await checkbox('この店舗でスマホ連携を使う'); await checkbox('印刷');
  assert.equal(await button('このスマホの接続画面を開く', 'disabled'), true);
  assert.equal(await button('テスト印刷', 'disabled'), true);
  assert.equal(state.events.length, 0);
  await button('設定を保存');
  await page.waitForFunction(() => [...document.querySelectorAll('button,a')].some(element => element.textContent.trim() === 'このスマホの接続画面を開く' && !element.disabled));
  assert.equal(state.events.filter(event => event.action === 'save').length, 1);
  assert.deepEqual(state.events.filter(event => event.action === 'pair'), []);
  const href = await button('このスマホの接続画面を開く', 'href');
  assert.ok(href.includes('storeId=store-a') && href.includes('stationId=station-a'));
  const advanced = await page.$$eval('details', elements => elements.filter(element => element.querySelector('summary')?.textContent === '詳細設定').map(element => element.open));
  assert.deepEqual(advanced, [false]);
  checks.push('admin saves feature flags independently; unsaved settings cannot connect or test; advanced settings start collapsed');
  await checkbox('電子はかり');
  const getCount = state.adminGets.length;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  for (let attempt = 0; state.adminGets.length === getCount && attempt < 400; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(state.adminGets.length > getCount, 'A real component status refresh occurred.');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('label')].find(element => element.textContent.trim().startsWith('電子はかり'))?.querySelector('input').checked), true);
  assert.equal(await button('このスマホの接続画面を開く', 'disabled'), true);
  checks.push('status polling leaves unsaved feature drafts intact');
  await checkbox('電子はかり');
  state.stations['store-a'][0].scale_enabled = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => [...document.querySelectorAll('label')].find(element => element.textContent.trim().startsWith('電子はかり'))?.querySelector('input').checked);
  assert.equal(await button('このスマホの接続画面を開く', 'disabled'), false);
  state.failAdminGet = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await waitBody('合成テスト: 接続状態を取得できません。');
  assert.equal(await button('テスト印刷', 'disabled'), true);
  state.failAdminGet = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => !document.body.textContent.includes('合成テスト: 接続状態を取得できません。'));
  assert.equal(await button('テスト印刷', 'disabled'), false);
  checks.push('clean drafts adopt refreshed settings; unknown server status disables test printing until recovery');
  await screenshots('admin-single');
  state.holdGetStore = 'store-a';
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitHeld('heldGet');
  await page.select('#fixture-store', 'store-b'); await waitBody('別店舗レジ');
  state.heldGet(); state.heldGet = null; await page.waitForNetworkIdle();
  assert.ok((await page.$eval('body', element => element.textContent)).includes('別店舗レジ'));
  assert.ok(!(await page.$eval('body', element => element.textContent)).includes('レジ A'));
  checks.push('late previous-store reads cannot overwrite the selected store');

  reset({ stations: { 'store-a': [station(), station('station-b')], 'store-b': [] } });
  await newPage(); await goto('view=admin'); await waitBody('スマホで印刷・計量');
  await button('詳細設定');
  const select = await page.$('select[aria-label="設定するレジ"]');
  if (select) await select.select('station-b');
  else await page.evaluate(() => { const element = [...document.querySelectorAll('label')].find(entry => entry.textContent.trim().startsWith('設定するレジ'))?.querySelector('select'); element.value = 'station-b'; element.dispatchEvent(new Event('change', { bubbles: true })); });
  await screenshots('admin-multiple');
  checks.push('multiple checkout stations remain selectable inside advanced settings');
  reset({ canManage: false }); await newPage(); await goto('view=admin'); await waitBody('スマホで印刷・計量');
  assert.equal(await button('設定を保存', 'disabled'), true);
  assert.equal(state.events.length, 0);
  checks.push('admin without management permission cannot change configuration');

  // Phone connection: explicit URL scope, native capability checks and a serial pair/start flow.
  reset(); await newPage({ native: 'browser' }); await goto('storeId=store-a&stationId=station-a');
  await waitBody('Android');
  assert.equal(await startUnavailable(), true);
  assert.ok(state.adminGets.some(request => request.storeId === 'store-a'));
  assert.ok(state.adminGets.every(request => request.storeId !== 'store-b'));
  await screenshots('connect-browser');
  reset(); await newPage({ native: 'old' }); await goto('storeId=store-a&stationId=station-a');
  assert.equal(await startUnavailable(), true);
  await waitBody('Store App を更新してください');
  assert.equal(state.events.length, 0);
  checks.push('query store overrides remembered store; browsers and incomplete old app bridges cannot start');

  reset({ stations: { 'store-a': [station(), station('station-b')], 'store-b': [] } });
  await newPage(); await goto('storeId=store-a'); await page.waitForSelector('select[aria-label="接続先のレジ"]');
  assert.equal(await page.$eval('select[aria-label="接続先のレジ"]', element => element.value), '');
  assert.equal(await startUnavailable(), true);
  await page.select('select[aria-label="接続先のレジ"]', 'station-b');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(element => element.textContent.trim() === 'このスマホで中継を開始' && !element.disabled));
  await page.screenshot({ path: `${output}/connect-multiple.png`, fullPage: true });
  checks.push('multiple stations require an explicit connection target');
  reset(); await newPage(); await goto('storeId=store-a&stationId=missing-station');
  await waitBody('指定されたレジがこの店舗に見つかりません');
  assert.equal(await startUnavailable(), true);
  assert.equal(state.events.length, 0);
  checks.push('an invalid explicit station never falls back to another checkout station');

  reset({ holdAdminPair: true }); await newPage(); await goto('storeId=store-a&stationId=station-a');
  await page.evaluate(() => { const element = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'このスマホで中継を開始'); element.click(); element.click(); });
  await waitHeld('heldAdminPair');
  assert.equal(state.events.filter(event => event.action === 'pair').length, 1);
  state.heldAdminPair(); state.heldAdminPair = null;
  await page.waitForFunction(() => window.__relayCalls.includes('native:start'));
  assert.deepEqual(await page.evaluate(() => window.__relayCalls), ['admin:pair', 'store:pair', 'native:start']);
  assert.equal(state.events[0].storeId, 'store-a'); assert.equal(state.events[0].stationId, 'station-a');
  assert.equal(state.events[1].storeId, 'store-a'); assert.equal(state.events[1].code, 'synthetic-code');
  await screenshots('connect-running');
  checks.push('one tap performs admin pair, store pair and native start in order; duplicate taps do not duplicate pairing');
  assert.ok((await page.$eval('body', element => element.textContent)).includes('オフライン'));
  checks.push('local native running state does not imply the server has an online phone');
  await page.evaluate(() => { window.__relayConfirm = true; });
  await button('このスマホの中継を停止');
  await page.waitForFunction(() => window.__relayCalls.includes('native:stop'));
  await button('保存済みの接続を再開');
  await page.waitForFunction(() => window.__relayCalls.includes('native:resume'));
  assert.equal(state.events.filter(event => event.action === 'pair').length, 2);
  checks.push('stop and resume use native state without issuing another pairing');

  reset({ failAdminPair: true }); await newPage(); await goto('storeId=store-a&stationId=station-a');
  await button('このスマホで中継を開始'); await waitBody('権限がありません');
  assert.deepEqual(await page.evaluate(() => window.__relayCalls), ['admin:pair']);
  assert.equal(state.events.filter(event => event.path === '/api/store/device-relay').length, 0);
  checks.push('management permission failure prevents store pairing and native start');

  reset({ stations: { 'store-a': [station('station-a', { device_paired: true })], 'store-b': [] } });
  await newPage(); await goto('storeId=store-a&stationId=station-a');
  await button('このスマホで中継を開始');
  await page.waitForFunction(() => window.__relayDialogs.length === 1);
  assert.equal(state.events.length, 0); assert.equal(await page.evaluate(() => window.__relayDialogs.length), 1);
  await page.evaluate(() => { window.__relayConfirm = true; }); await button('このスマホで中継を開始');
  await page.waitForFunction(() => window.__relayCalls.includes('native:start'));
  assert.deepEqual(await page.evaluate(() => window.__relayCalls), ['admin:pair', 'store:pair', 'native:start']);
  checks.push('replacing an existing paired phone requires an explicit confirmation');

  reset({ canManage: false }); await newPage(); await goto('storeId=store-a&stationId=station-a');
  await button('接続コードで設定する');
  await page.waitForSelector('input[aria-label="接続コード"]');
  await page.type('input[aria-label="接続コード"]', 'manual-code'); await button('接続コードで開始');
  await page.waitForFunction(() => window.__relayCalls.includes('native:start'));
  assert.deepEqual(await page.evaluate(() => window.__relayCalls), ['store:pair', 'native:start']);
  assert.equal(state.events[0].code, 'manual-code');
  await page.screenshot({ path: `${output}/connect-manual.png`, fullPage: true });
  checks.push('non-managers can use an issued manual code without requesting management pairing');

  reset(); await newPage({ native: 'unknown' }); await goto('storeId=store-a&stationId=station-a');
  assert.equal(await button('このスマホで中継を開始', 'disabled'), true);
  assert.equal(await button('保存済みの接続を再開', 'disabled'), true);
  await button('接続コードで設定する');
  await page.type('input[aria-label="接続コード"]', 'manual-code');
  assert.equal(await button('接続コードで開始', 'disabled'), true);
  await button('このスマホで中継を開始'); await button('接続コードで開始');
  assert.equal(state.events.length, 0); assert.deepEqual(await page.evaluate(() => window.__relayCalls), []);
  checks.push('an unknown native status disables automatic/manual start and resume before consuming a code');

  // The real translation provider loads the repository dictionary through this local server.
  reset(); await newPage({ language: 'zh-Hans' }); await goto('view=admin');
  await waitBody(translated('スマホで印刷・計量'));
  assert.ok((await page.$eval('body', element => element.textContent)).includes(translated('この店舗でスマホ連携を使う')));
  await button(translated('設定を保存'), 'disabled');
  await button(translated('このスマホの接続画面を開く'), 'href');
  await screenshots('admin-zh-Hans', [390, 768]);
  reset(); await newPage({ native: 'browser', language: 'zh-Hans' }); await goto('storeId=store-a&stationId=station-a');
  await waitBody(translated('スマホで印刷・計量を中継'));
  await waitBody(translated('Android Store App で開いてください'));
  await button(translated('Android Store App をダウンロード'), 'href');
  await screenshots('connect-browser-zh-Hans', [390, 768]);
  reset(); await newPage({ language: 'zh-Hans' }); await goto('storeId=store-a&stationId=station-a');
  await waitBody(translated('スマホで印刷・計量を中継'));
  assert.equal(await button(translated('このスマホで中継を開始'), 'disabled'), false);
  await waitBody(translated('このスマホのサービス'));
  await screenshots('connect-native-zh-Hans', [390, 768]);
  assert.equal(state.events.length, 0);
  checks.push('actual Simplified Chinese provider translates admin/browser/native headings and actions; 390/768px remain within viewport');
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: true, scope: 'Actual React components; local synthetic APIs/native bridge only', checks, pageErrors: errors, externalRequests }, null, 2) + '\n');
  console.log(`PASS relay setup UI: ${checks.join('; ')}.`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: false, checks, pageErrors: errors, externalRequests, fixtureEvents: state.events, error: error.stack }, null, 2) + '\n');
  throw error;
} finally {
  state.heldGet?.(); state.heldAdminPair?.(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
