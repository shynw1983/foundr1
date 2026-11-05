// Actual isolated React component; all Bluetooth/native operations are in-memory mocks.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = process.env.AND_SCALE_SETUP_OUTPUT || 'outputs/and-scale-setup-20261016'; await mkdir(output, { recursive: true });
const built = await build({ stdin: { contents: `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{AndScaleSetup,AND_SCALE_COPY}from'./app/store/device-relay/AndScaleSetup';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
window.__scaleCopy=AND_SCALE_COPY;
function Fixture(){const[props,setProps]=useState({enabled:new URLSearchParams(location.search).get('enabled')!=='false',storeId:'store-a',stationId:'station-a',scopeKey:'store-a:station-a'});useEffect(()=>{const change=e=>setProps(p=>({...p,...e.detail}));window.addEventListener('fixture-scale-props',change);return()=>window.removeEventListener('fixture-scale-props',change)},[]);return <main style={{width:'min(100%,760px)',margin:'0 auto',padding:16}}><AndScaleSetup {...props}/></main>};createRoot(document.getElementById('root')).render(<OsTranslationProvider><Fixture/></OsTranslationProvider>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = await readFile('app/globals.css', 'utf8') + '\n' + built.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const chinese = JSON.parse(await readFile('public/locales/os/zh-Hans.json', 'utf8'));
const translated = text => { assert.ok(chinese[text], `Missing Chinese entry: ${text}`); return chinese[text]; };
const requests = [];
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://fixture').pathname;
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return; }
  if (pathname.startsWith('/locales/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(pathname === '/locales/os/zh-Hans.json' ? chinese : {})); return; }
  if (req.method !== 'GET' || req.url.startsWith('/api/')) { requests.push({ method: req.method, url: req.url }); res.writeHead(403); res.end(); return; }
  res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let page; const errors = [], externalRequests = [], checks = [], traces = [];
const devices = [{ name: 'SH-3000AWP-BT A&D', address: '01:23:45:AA:BB:01', rssi: -50 }, { name: 'SH-3000AWP-BT A&D', address: '01:23:45:AA:BB:02', rssi: -65 }];
async function open({ mode = 'modern', enabled = true, snapshot = {}, language = 'ja' } = {}) {
  if (page) { traces.push(await page.evaluate(() => window.__scaleActions)); await page.close(); }
  page = await browser.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000); page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true); page.on('request', request => { if (request.url().startsWith(origin + '/')) request.continue(); else { externalRequests.push(request.url()); request.abort(); } });
  await page.evaluateOnNewDocument(({ mode, snapshot, language }) => {
    localStorage.setItem('foundr1-os-language', language); localStorage.setItem('foundr1-os-language-preference', 'manual');
    window.__scaleActions = []; window.__scaleReads = 0; window.__scaleDenied = false; window.__scaleBadStatus = false;
    window.__scaleSnapshot = { enabled: true, state: 'not_selected', message: '', selected: null, devices: [], scanning: false,
      permissionsGranted: true, bluetoothEnabled: true, storeId: 'store-a', stationId: 'station-a', targetAgeMs: 0,
      lastReadingAgeMs: -1, lastReading: null, ...snapshot };
    if (mode === 'browser') return;
    window.Foundr1DeviceRelay = mode === 'old' ? { status: () => '{"running":true}' } : {
      scaleStatus() { window.__scaleReads++; return window.__scaleBadStatus ? '{}' : JSON.stringify(window.__scaleSnapshot); },
      scaleScan() { window.__scaleActions.push(['scan']); if (window.__scaleDenied) { window.__scaleSnapshot.state = 'permission_denied'; window.__scaleSnapshot.permissionsGranted = false; return JSON.stringify({ ok: false, error: 'Bluetooth の権限がありません。', state: 'permission_denied' }); } Object.assign(window.__scaleSnapshot, { state: 'scanning', scanning: true, devices: [] }); return '{"ok":true}'; },
      scaleSelect(address) { window.__scaleActions.push(['select', address]); Object.assign(window.__scaleSnapshot, { state: 'bonding', scanning: false, selected: window.__scaleSnapshot.devices.find(device => device.address === address) }); return '{"ok":true}'; },
      scaleDisconnect() { window.__scaleActions.push(['disconnect']); window.__scaleSnapshot.state = 'disconnected'; return '{"ok":true}'; },
      scaleForget() { window.__scaleActions.push(['forget']); Object.assign(window.__scaleSnapshot, { state: 'not_selected', selected: null, devices: [] }); return '{"ok":true}'; },
      scaleCancelScan() { window.__scaleActions.push(['cancel']); Object.assign(window.__scaleSnapshot, { state: 'not_selected', scanning: false }); return '{"ok":true}'; }
    };
  }, { mode, snapshot, language });
  await page.goto(`${origin}/?enabled=${enabled}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(`section[aria-label="${language === 'zh-Hans' ? translated('電子はかりを接続') : '電子はかりを接続'}"]`);
}
async function click(text) {
  await page.waitForFunction(text => [...document.querySelectorAll('button,summary')].some(element => element.textContent.trim() === text), {}, text);
  await page.evaluate(text => [...document.querySelectorAll('button,summary')].find(element => element.textContent.trim() === text).click(), text);
}
const waitText = text => page.waitForFunction(text => document.body.textContent.includes(text), {}, text);
const refresh = async patch => { await page.evaluate(patch => { Object.assign(window.__scaleSnapshot, patch); document.dispatchEvent(new Event('visibilitychange')); }, patch); };
const actionList = () => page.evaluate(() => window.__scaleActions);
async function screenshot(prefix) {
  for (const width of [390, 768]) {
    await page.setViewport({ width, height: 900 }); await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${prefix}: no overflow at ${width}px`);
    await page.screenshot({ path: `${output}/${prefix}-top-${width}.png`, fullPage: false });
    await page.screenshot({ path: `${output}/${prefix}-${width}.png`, fullPage: true });
  }
}
try {
  await open({ mode: 'browser' }); await waitText('電子はかりの接続は Android Store App で操作してください。'); assert.equal(await page.$('button'), null); await screenshot('browser');
  await open({ mode: 'old' }); await waitText('電子はかりに対応した Store App へ更新してください。'); assert.ok(await page.$('a[href="/downloads/foundr1-store-latest.apk"]')); assert.equal(await page.$('button'), null);
  await open({ enabled: false }); await waitText('この店舗では電子はかり連携がオフです。'); assert.equal(await page.$('button'), null); assert.equal(await page.evaluate(() => window.__scaleReads), 0);
  checks.push('browser, old APK and disabled store provide no Bluetooth operations; old APK offers download');

  await open({ snapshot: { storeId: '', stationId: '', targetAgeMs: -1 } }); await waitText('このスマホの接続先を確認しています。'); assert.equal(await page.$('button'), null);
  await refresh({ storeId: 'store-b', stationId: 'station-b', targetAgeMs: 0, devices }); await waitText('このスマホの接続先が一致していません。'); assert.equal(await page.$('[aria-label="見つかったはかり"]'), null);
  await refresh({ storeId: 'store-a', stationId: 'station-a', targetAgeMs: 15001 }); await waitText('接続先を確認できません。'); assert.equal(await page.$('button'), null); assert.deepEqual(await actionList(), []);
  checks.push('unconfirmed, foreign and expired authoritative bindings cannot expose devices or issue operations');

  await open(); await waitText('はかりの電源を入れてから'); assert.deepEqual(await actionList(), []);
  const firstReads = await page.evaluate(() => window.__scaleReads);
  await page.waitForFunction(count => window.__scaleReads > count, {}, firstReads); assert.deepEqual(await actionList(), []);
  await page.evaluate(() => { window.__hidden = true; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__hidden ? 'hidden' : 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenReads = await page.evaluate(() => window.__scaleReads); await new Promise(resolve => setTimeout(resolve, 2200));
  assert.equal(await page.evaluate(() => window.__scaleReads), hiddenReads);
  await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(count => window.__scaleReads > count, {}, hiddenReads);
  checks.push('visible polling only reads status; hidden page does not poll or start scanning');

  await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === '近くのはかりを探す'); button.click(); button.click(); });
  await waitText('電子はかりを探しています。'); assert.deepEqual(await actionList(), [['scan']]);
  await refresh({ scanning: true, state: 'scanning', devices }); await page.waitForSelector('[aria-label="見つかったはかり"] button');
  assert.deepEqual(await page.$$eval('[aria-label="見つかったはかり"] button', buttons => buttons.map(button => button.getAttribute('aria-pressed'))), ['false', 'false']);
  assert.deepEqual(await actionList(), [['scan']]);
  const listText = await page.$eval('[aria-label="見つかったはかり"]', element => element.textContent); assert.ok(listText.includes('AA:BB:01') && listText.includes('AA:BB:02'));
  await screenshot('devices');
  await page.$$eval('[aria-label="見つかったはかり"] button', buttons => buttons[1].click());
  await waitText('はかりとペアリングしています。');
  assert.deepEqual(await actionList(), [['scan'], ['select', devices[1].address]]);
  await refresh({ state: 'connecting' }); await waitText('はかりに接続しています。');
  await refresh({ state: 'connected', lastReading: null, lastReadingAgeMs: -1 }); await waitText('はかりに接続しました。新しい重量を待っています。');
  await refresh({ lastReading: { grams: 253, stable: true, overload: false }, lastReadingAgeMs: 100 }); await waitText('重量を受信しています。'); await waitText('253');
  await screenshot('reading');
  await refresh({ lastReadingAgeMs: 5001 }); await waitText('はかりに接続しました。新しい重量を待っています。'); assert.ok(!(await page.$eval('body', element => element.textContent)).includes('253'));
  await refresh({ lastReading: { grams: 0, stable: false, overload: true }, lastReadingAgeMs: 0 }); await waitText('計量範囲を超えています。');
  checks.push('scan needs a click; live scan results remain unselected until chosen; explicit second device pairs/connects during scanning; only fresh readings appear');
  await click('接続の詳細操作'); await click('はかりとの接続を切る'); await waitText('はかりとの接続が切れています。');
  await click('はかりの登録を解除'); await waitText('はかりの電源を入れてから');
  assert.deepEqual(await actionList(), [['scan'], ['select', devices[1].address], ['disconnect'], ['forget']]);
  checks.push('disconnect and forget require explicit clicks and follow confirmed native status');

  await click('近くのはかりを探す'); await waitText('電子はかりを探しています。'); await refresh({ state: 'not_selected', scanning: false, devices: [] }); await waitText('はかりが見つかりませんでした。');
  await screenshot('not-found');
  await click('近くのはかりを探す'); await waitText('電子はかりを探しています。'); await click('探索を止める'); await waitText('はかりが見つかりませんでした。');
  assert.deepEqual((await actionList()).slice(-3), [['scan'], ['scan'], ['cancel']]);
  checks.push('empty scan explains two-minute discovery/restart; stopping scan is a user action');

  await open(); await page.evaluate(() => { window.__scaleDenied = true; }); await click('近くのはかりを探す'); await waitText('Bluetooth の権限がありません。');
  assert.deepEqual(await actionList(), [['scan']]);
  await screenshot('permission-denied');
  await refresh({ state: 'bluetooth_off', bluetoothEnabled: false }); await waitText('Bluetooth がオフです。');
  await refresh({ state: 'location_off' }); await waitText('位置情報がオフです。');
  await refresh({ state: 'unsupported_properties' }); await waitText('このはかりの通信方法は未確認です。');
  await page.evaluate(() => { window.__scaleBadStatus = true; document.dispatchEvent(new Event('visibilitychange')); }); await waitText('はかりの状態を確認できません。'); assert.equal(await page.$('button'), null);
  checks.push('permission rejection, Bluetooth/location off, unsupported GATT and malformed status are visible without automatic retries');

  await open({ snapshot: { devices } }); await page.waitForSelector('[aria-label="見つかったはかり"]');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-scale-props', { detail: { storeId: 'store-b', stationId: 'station-b', scopeKey: 'store-b:station-b' } })));
  await waitText('このスマホの接続先が一致していません。'); assert.equal(await page.$('[aria-label="見つかったはかり"]'), null);
  await refresh({ devices, state: 'connected', selected: devices[0], lastReadingAgeMs: 0, lastReading: { grams: 777, stable: true, overload: false } });
  assert.ok(!(await page.$eval('body', element => element.textContent)).includes('777')); assert.deepEqual(await actionList(), []);
  await refresh({ storeId: 'store-b', stationId: 'station-b', targetAgeMs: 0, state: 'not_selected', selected: null, lastReading: null }); await page.waitForSelector('[aria-label="見つかったはかり"] button');
  // An authorization expiry after rendering is checked again before any selected device can be passed to native.
  await page.evaluate(() => { window.__scaleSnapshot.targetAgeMs = 15001; document.querySelector('[aria-label="見つかったはかり"] button').click(); });
  await waitText('接続先を確認できません。'); assert.deepEqual(await actionList(), []);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-scale-props', { detail: { enabled: false } })));
  await waitText('この店舗では電子はかり連携がオフです。'); assert.equal(await page.$('button'), null);
  checks.push('scope changes hide old devices/readings; each click rechecks authoritative binding and disabling removes operations');

  await open({ language: 'zh-Hans', snapshot: { state: 'scanning', scanning: true, devices } });
  await waitText(translated('電子はかりを接続')); await waitText(translated('電子はかりを探しています。'));
  const chineseList = `[aria-label="${translated('見つかったはかり')}"]`;
  await page.waitForSelector(`${chineseList} button`);
  assert.deepEqual(await page.$$eval(`${chineseList} button`, buttons => buttons.map(button => button.getAttribute('aria-pressed'))), ['false', 'false']);
  assert.ok((await page.$eval(chineseList, element => element.textContent)).includes(translated('このはかりに接続')));
  assert.deepEqual(await actionList(), []); await screenshot('devices-zh-Hans');
  await refresh({ state: 'connected', scanning: false, selected: devices[1], lastReading: { grams: 253, stable: true, overload: false }, lastReadingAgeMs: 100 });
  await waitText(translated('重量を受信しています。')); await waitText(translated('安定')); await waitText('253');
  await waitText(translated('重量は POS の計量画面で確定します。')); await screenshot('reading-zh-Hans');
  assert.deepEqual(await actionList(), []);
  checks.push('actual Simplified Chinese provider translates live scan/results and fresh reading states at 390/768px without overflow');

  await open({ snapshot: { state: 'connected', selected: devices[0], lastReadingAgeMs: 100,
    lastReading: { grams: 200, grossGrams: 300, tareGrams: 100, mode: 'preset', stable: true, overload: false } } });
  await waitText('総重量'); await waitText('容器重量'); await waitText('正味重量');
  assert.ok(await page.$eval('body', element => /300\s*g\s*−.*100\s*g/.test(element.textContent)));
  await click('はかりの準備'); await waitText('本体で風袋引きせずに計量してください。');
  assert.deepEqual(await actionList(), []); await screenshot('preset-gross-tare-net');
  await refresh({ lastReadingAgeMs: 5001 });
  await waitText('はかりに接続しました。新しい重量を待っています。');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('span')].some(span => span.textContent === '総重量')), false);
  checks.push('preset mode shows raw total, one container deduction and net weight without changing native state; stale totals disappear and preparation warns against physical tare');

  traces.push(await actionList());
  assert.deepEqual(requests, []); assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []);
  const copy = await page.evaluate(() => window.__scaleCopy);
  await writeFile(`${output}/copy-keys.json`, JSON.stringify(Object.values(copy), null, 2) + '\n');
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: true, checks, traces, pageErrors: errors, unexpectedRequests: requests, externalRequests }, null, 2) + '\n');
  await rm(`${output}/failure.png`, { force: true }); console.log(`PASS A&D scale setup UI: ${checks.join('; ')}.`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: false, checks, pageErrors: errors, unexpectedRequests: requests, externalRequests, error: error.stack }, null, 2) + '\n'); throw error;
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
