// Real normal customer-display component, synthetic read APIs and realtime only.
// No production network, records, camera or native peripherals are used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, values) => {
  if (value.startsWith('--')) all.push([value.slice(2), values[index + 1]]);
  return all;
}, []));
const source = resolve(args.source || process.cwd());
const output = resolve(args.output || 'outputs/pos-customer-display-regression');
await mkdir(output, { recursive: true });
const require = createRequire(join(source, 'package.json'));
const { build, stop } = require('esbuild');
const puppeteer = require('puppeteer-core');
const sourceFiles = ['app/store/pos/customer-display/CustomerDisplayWorkspace.tsx', 'app/store/pos/usePosDebugDisplay.ts', 'app/globals.css'];
const hashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(join(source, path))).digest('hex')])));
const beforeHashes = await hashes();
const store = { id: '11111111-1111-4111-8111-111111111111', name: 'Fixture store' };
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Display from'./app/store/pos/customer-display/CustomerDisplayWorkspace';
window.__subscriptions=[];createRoot(document.getElementById('root')).render(<Display/>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated-display-adapters', setup(build) {
  build.onResolve({ filter: /\/shared-pusher-client$/ }, () => ({ path: 'pusher', namespace: 'fixture' }));
  build.onResolve({ filter: /\/OsTranslationProvider$/ }, () => ({ path: 'translation', namespace: 'fixture' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'translation' ? 'export const useOsTranslation=()=>({t:text=>text});' : `export function acquireSharedPusher(){const channels=[];window.__emit=(event,payload)=>{for(const channel of channels)for(const fn of channel.listeners.get(event)||[])fn(payload)};return{connection:{bind(){}},subscribe(name){window.__subscriptions.push(name);const listeners=new Map();const channel={name,listeners,bind(event,fn){listeners.set(event,[...(listeners.get(event)||[]),fn]);if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(event,fn){listeners.set(event,(listeners.get(event)||[]).filter(item=>item!==fn))}};channels.push(channel);return channel},unsubscribe(){},disconnect(){channels.length=0}}}` }));
} }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = await readFile(join(source, 'app/globals.css'), 'utf8') + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const requests = [], errors = [], external = [], checks = [];
function send(res, value) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname.startsWith('/api/')) requests.push({ path: url.pathname, query: url.search, method: req.method });
  if (url.pathname === '/api/store/pos/customer-display') return send(res, { selectedStoreId: store.id, access: { stores: [store] }, state: { status: 'idle', items: [] } });
  if (url.pathname === '/api/store/realtime-config') return send(res, { key: 'fixture', cluster: 'fixture', channels: ['private-store-' + store.id] });
  if (url.pathname === '/api/store/pos/customer-display/member-scan') return send(res, { scanCommand: null });
  if (url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': url.pathname === '/fixture.js' ? 'application/javascript' : 'text/html' });
  res.end(url.pathname === '/fixture.js' ? js : html);
});
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true });
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const baseState = { status: 'editing', storeName: store.name, orderType: 'eat_in', paymentMethod: 'cash', paymentLabel: '現金', preferredLanguage: 'ja', subtotal: 1440, taxLabel: '内消費税 10%', taxAmount: 131, cashTenderedAmount: 2000, cashChangeAmount: 560, discountName: '学割20%', discountAmount: 360, items: [{ name: '基礎麻辣湯', optionLabel: '牛筋 50g', weightLabel: '200g × ¥4/g', quantity: 1, unitPrice: 800, amount: 1450 }, { name: '自家製レモン水', optionLabel: '', weightLabel: '', quantity: 1, unitPrice: 350, amount: 350 }] };
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 800, height: 1100 }, { width: 1366, height: 900 }]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport(viewport);
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith(origin + '/') ? request.continue() : (external.push(request.url()), request.abort()));
    await page.goto(origin + '/store/pos/customer-display?storeId=' + store.id, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__emit) && document.querySelector('.customer-display-menu-button.is-realtime'));
    assert.equal(await page.$('[data-pos-debug-display]'), null);
    assert.deepEqual(await page.evaluate(() => window.__subscriptions), ['private-store-' + store.id]);
    checks.push({ name: 'normal-live-channel-and-idle-' + viewport.width, passed: true });
    const emit = async state => { await page.evaluate((storeId, state) => window.__emit('pos.customer-display.updated', { storeId, state }), store.id, state); await pause(80); };
    await emit(baseState);
    await page.waitForFunction(() => document.querySelector('.customer-display-total strong')?.textContent === '¥1,440');
    assert.match(await page.$eval('.customer-display-item-list', node => node.textContent), /牛筋 50g/);
    assert.match(await page.$eval('.customer-display-settlement', node => node.textContent), /560/);
    assert.equal(await page.$('[data-pos-debug-weighing]'), null);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(output, 'normal-cart-' + viewport.width + '.png'), fullPage: true });
    checks.push({ name: 'normal-cart-options-discount-total-and-change-' + viewport.width, passed: true });
    await page.evaluate(() => window.__emit('pos.debug-display', { kind: 'state', state: { items: [{ name: 'SHOULD NOT APPEAR' }] } }));
    await page.evaluate(() => window.__emit('pos.customer-display.updated', { storeId: 'foreign-store', state: { items: [{ name: 'SHOULD NOT APPEAR' }] } }));
    assert.ok(!(await page.$eval('body', node => node.textContent)).includes('SHOULD NOT APPEAR'));
    checks.push({ name: 'normal-display-ignores-debug-and-other-store-' + viewport.width, passed: true });
    await emit({ ...baseState, paymentMethod: 'external', status: 'external_wait', externalPaymentTerminalBrand: 'PayCAS' });
    assert.match(await page.$eval('.customer-display-terminal', node => node.textContent), /PayCAS/);
    assert.ok(!(await page.$eval('.customer-display-terminal', node => node.textContent)).includes('テスト'));
    checks.push({ name: 'normal-terminal-payment-instruction-' + viewport.width, passed: true });
    await emit({ ...baseState, status: 'complete', pickupCode: 'P-123' });
    await page.waitForSelector('.customer-display-advertising.is-thanks');
    assert.equal(await page.$('.customer-display-total'), null);
    checks.push({ name: 'normal-completion-keeps-thank-you-screen-' + viewport.width, passed: true });
    await emit({ status: 'advertising', items: [] });
    await page.waitForSelector('.customer-display-advertising:not(.is-thanks)');
    checks.push({ name: 'normal-advertising-mode-' + viewport.width, passed: true });
    await context.close();
  }
  assert.deepEqual(requests.filter(request => request.method !== 'GET'), []);
  assert.deepEqual(requests.filter(request => request.path.includes('debug') || new URLSearchParams(request.query).has('debug')), []);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const afterHashes = await hashes(); assert.deepEqual(afterHashes, beforeHashes);
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: checks.length, checks, sourceHashes: afterHashes, noSourceDrift: true, actualNormalCustomerDisplay: true, requests, errors, externalRequests: external, liveWrites: 0 }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, report: join(output, 'report.json') }));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(ok => server.close(ok)); stop(); }
