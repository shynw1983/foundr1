// Actual AndScaleSetup rendered against an isolated, in-memory native bridge.
// No production, database, Android settings, Bluetooth or printer access.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = resolve(process.env.SAVED_SCALE_UI_OUTPUT || 'outputs/and-scale-saved-reconnect-20261017');
await mkdir(output, { recursive: true });
const built = await build({ stdin: { contents: `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{AndScaleSetup}from'./app/store/device-relay/AndScaleSetup';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
function Fixture(){const[props,setProps]=useState({enabled:true,storeId:'store-a',stationId:'station-a',scopeKey:'store-a:station-a'});useEffect(()=>{window.__fixtureSetProps=next=>setProps(previous=>({...previous,...next}));},[]);return <main style={{width:'min(100%,760px)',margin:'0 auto',padding:16}}><AndScaleSetup {...props}/></main>};createRoot(document.getElementById('root')).render(<OsTranslationProvider><Fixture/></OsTranslationProvider>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = (await readFile('app/globals.css', 'utf8')) + '\n' + built.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const dictionary = JSON.parse(await readFile('public/locales/os/zh-Hans.json', 'utf8'));
const unexpectedRequests = [], externalRequests = [], errors = [], checks = [], traces = [];
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname;
  if (path === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(js); return; }
  if (path.startsWith('/locales/')) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(dictionary)); return; }
  if (path.startsWith('/api/') || req.method !== 'GET') { unexpectedRequests.push({ path, method: req.method }); res.writeHead(403); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(45000);
page.on('pageerror', error => errors.push(error.message));
await page.setRequestInterception(true); page.on('request', request => { if (request.url().startsWith(origin + '/')) request.continue(); else { externalRequests.push(request.url()); request.abort(); } });
const saved = { name: 'A&D_BT saved scale', address: '01:23:45:AA:BB:01' }, discovered = { name: 'A&D_BT new scale', address: '01:23:45:AA:BB:02', rssi: -50 };
await page.evaluateOnNewDocument(saved => {
  localStorage.setItem('foundr1-os-language', 'ja'); localStorage.setItem('foundr1-os-language-preference', 'manual');
  window.__scaleActions = []; window.__scaleReads = 0; window.__holdSelect = false; window.__scopeSequence = 0; window.__hidden = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__hidden ? 'hidden' : 'visible' });
  window.__baseScaleSnapshot = { enabled: true, state: 'disconnected', message: '', selected: saved, devices: [], scanning: false, permissionsGranted: true, bluetoothEnabled: true, storeId: 'store-a', stationId: 'station-a', targetAgeMs: 0, lastReadingAgeMs: -1, lastReading: null };
  window.__scaleSnapshot = structuredClone(window.__baseScaleSnapshot);
  window.Foundr1DeviceRelay = {
    scaleStatus() { window.__scaleReads++; return JSON.stringify(window.__scaleSnapshot); },
    scaleScan() { window.__scaleActions.push(['scan']); Object.assign(window.__scaleSnapshot, { state: 'scanning', scanning: true, devices: [] }); return '{"ok":true}'; },
    scaleSelect(address) { window.__scaleActions.push(['select', address]); if (!window.__holdSelect) { const selected = window.__scaleSnapshot.devices.find(device => device.address === address) || (window.__scaleSnapshot.selected?.address === address ? window.__scaleSnapshot.selected : null); Object.assign(window.__scaleSnapshot, { state: 'connecting', scanning: false, selected }); } return '{"ok":true}'; },
    scaleDisconnect() { window.__scaleActions.push(['disconnect']); return '{"ok":true}'; },
    scaleForget() { window.__scaleActions.push(['forget']); return '{"ok":true}'; },
    scaleCancelScan() { window.__scaleActions.push(['cancel']); window.__scaleSnapshot.scanning = false; window.__scaleSnapshot.state = 'disconnected'; return '{"ok":true}'; }
  };
}, saved);
const reconnect = '選択中のはかりに再接続';
const actions = () => page.evaluate(() => window.__scaleActions);
const waitText = text => page.waitForFunction(text => document.body.textContent.includes(text), {}, text);
async function reset(snapshot = {}, props = {}) {
  traces.push(await actions());
  const reads = await page.evaluate(({ snapshot, props }) => { window.__hidden = false; window.__scaleActions = []; window.__holdSelect = false; window.__scaleSnapshot = { ...structuredClone(window.__baseScaleSnapshot), ...snapshot }; const reads = window.__scaleReads; window.__fixtureSetProps({ enabled: true, storeId: 'store-a', stationId: 'station-a', scopeKey: `fixture-${++window.__scopeSequence}`, ...props }); return reads; }, { snapshot, props });
  if (props.enabled !== false) await page.waitForFunction(reads => window.__scaleReads > reads, {}, reads);
}
async function clickReconnect() { await page.evaluate(text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text)?.click(), reconnect); }
async function waitReconnectEnabled() { await page.waitForFunction(text => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === text && !button.disabled), {}, reconnect); }
async function assertNoReconnect(snapshot) {
  await reset(snapshot); await page.waitForFunction(text => ![...document.querySelectorAll('button')].some(button => button.textContent.trim() === text && !button.disabled), {}, reconnect);
  await clickReconnect(); assert.deepEqual(await actions(), []);
}
async function freshClickDenied(patch) {
  await reset(); await waitReconnectEnabled();
  await page.evaluate(({ patch, text }) => { Object.assign(window.__scaleSnapshot, patch); [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text).click(); }, { patch, text: reconnect });
  assert.deepEqual(await actions(), [], `stale UI allowed reconnect: ${JSON.stringify(patch)}`);
}
async function screenshot(prefix) { for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) { await page.setViewport({ width, height }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${prefix}: overflow at ${width}px`); await page.screenshot({ path: `${output}/${prefix}-${width}.png`, fullPage: true }); } }
try {
  await page.goto(origin, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => typeof window.__fixtureSetProps === 'function'); await waitReconnectEnabled();
  assert.deepEqual(await actions(), []); assert.equal(await page.evaluate(() => window.__scaleSnapshot.devices.length), 0);
  await screenshot('saved-address'); await clickReconnect(); assert.deepEqual(await actions(), [['select', saved.address]]);
  checks.push('a known saved scale can explicitly reconnect with no current scan results; page load itself does not select or scan');

  await reset({ state: 'reconnect_required' }); await waitReconnectEnabled(); await clickReconnect(); assert.deepEqual(await actions(), [['select', saved.address]]);
  checks.push('the stopped automatic-retry state exposes an explicit saved-scale reconnect action');

  for (const patch of [{ storeId: 'store-b' }, { stationId: 'station-b' }, { targetAgeMs: 15001 }, { targetAgeMs: -1 }, { permissionsGranted: false }, { bluetoothEnabled: false }, { state: 'connected' }, { state: 'connecting' }, { state: 'bonding' }, { state: 'discovering' }, { state: 'subscribing' }, { state: 'scanning', scanning: true }]) await assertNoReconnect(patch);
  checks.push('foreign/expired/unconfirmed targets, missing permissions, Bluetooth off, already connected, scanning and connection transitions cannot reconnect');

  for (const patch of [{ storeId: 'store-b' }, { stationId: 'station-b' }, { targetAgeMs: 15001 }, { permissionsGranted: false }, { bluetoothEnabled: false }, { state: 'connected' }, { state: 'connecting' }, { state: 'scanning', scanning: true }, { selected: { ...saved, address: discovered.address } }]) await freshClickDenied(patch);
  checks.push('each reconnect click rechecks authoritative target, saved address, permissions and busy state rather than trusting the rendered snapshot');

  await reset(); await waitReconnectEnabled();
  await page.evaluate(text => { window.__hidden = true; [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text).click(); }, reconnect);
  assert.deepEqual(await actions(), []);
  checks.push('a hidden page cannot reconnect even if an enabled button was rendered before hiding');

  await reset(); await waitReconnectEnabled();
  await page.evaluate(text => { window.__holdSelect = true; const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text); button.click(); button.click(); }, reconnect);
  assert.deepEqual(await actions(), [['select', saved.address]]);
  checks.push('an unacknowledged reconnect suppresses repeated taps and emits only one native selection');

  await reset({ selected: null, state: 'not_selected' });
  assert.equal(await page.$$eval('button', (buttons, text) => buttons.some(button => button.textContent.trim() === text), reconnect), false);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '近くのはかりを探す').click());
  await page.evaluate(discovered => { window.__scaleSnapshot.devices = [discovered]; document.dispatchEvent(new Event('visibilitychange')); }, discovered);
  await page.waitForSelector('[aria-label="見つかったはかり"] button');
  await page.click('[aria-label="見つかったはかり"] button'); assert.deepEqual(await actions(), [['scan'], ['select', discovered.address]]);
  checks.push('a new scale still requires a scan and explicit result selection, including selection while discovery is running');

  await reset({}, { storeId: 'store-b', stationId: 'station-b' }); await waitText('このスマホの接続先が一致していません。'); assert.deepEqual(await actions(), []);
  checks.push('changing the component store/register scope hides the previous saved scale without a native operation');

  traces.push(await actions()); assert.deepEqual(errors, []); assert.deepEqual(unexpectedRequests, []); assert.deepEqual(externalRequests, []);
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: true, checks, traces, pageErrors: errors, unexpectedRequests, externalRequests }, null, 2) + '\n');
  await rm(`${output}/failure.png`, { force: true }); console.log(`PASS saved scale reconnect UI: ${checks.join('; ')}.`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: false, checks, traces, actions: await actions().catch(() => []), pageErrors: errors, unexpectedRequests, externalRequests, error: error.stack }, null, 2) + '\n'); throw error;
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
