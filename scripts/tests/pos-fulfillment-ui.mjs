// Actual POS page and providers against local synthetic APIs. No production,
// payment service, printer, Bluetooth, or real database is contacted.
import { build, stop } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = resolve(process.env.POS_FULFILLMENT_UI_OUTPUT || 'outputs/pos-fulfillment-20261019/ui');
const extraOnly = Boolean(process.env.POS_FULFILLMENT_UI_EXTRA_ONLY);
const checkoutOnly = Boolean(process.env.POS_FULFILLMENT_UI_CHECKOUT_ONLY);
const coreOnly = Boolean(process.env.POS_FULFILLMENT_UI_CORE_ONLY) || checkoutOnly;
await mkdir(output, { recursive: true });
const languages = ['zh-Hans', 'zh-Hant'];
const dictionaries = Object.fromEntries(await Promise.all(languages.map(async language => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const store = { id: 'fixture-sakura', name: '桜並木店', brandIds: ['fixture-brand'] };
const brand = { id: 'fixture-brand', name: 'まぁ麻' };
const item = { id: 'fixture-menu', brandId: brand.id, brandName: brand.name, name: '自選マーラータン', itemKind: 'buildable_product', category: 'マーラータン', priceOverride: null, basePrice: 0, posPricingMode: 'weight', posWeightUnit: 'g', posWeightUnitPrice: 4, isAvailable: true, variableSchema: {}, imageUrl: '' };
const optionGroup = (id, groupKey, name, names) => ({ id, brandId: brand.id, menuCatalogItemId: '', applicableCategories: [], groupKey, name, selectionType: 'single', ruleJson: {}, sortOrder: 0, options: names.map((name, index) => ({ id: `${id}-${index}`, optionKey: `${groupKey}-${index}`, applicableCategories: [], name, priceDelta: 0, sortOrder: index })) });
const posData = { selectedStoreId: store.id, access: { role: 'owner', stores: [store] }, brands: [brand], categories: [], items: [item], optionGroups: [optionGroup('flavor', 'flavor', 'スープ', ['麻辣', 'トマト']), optionGroup('noodle', 'noodle', '麺', ['春雨', '中華麺'])], todaySummary: { orderCount: 0, total: 0, average: 0, latestOrders: [] }, posSettings: { dineInEnabled: true, takeoutEnabled: true, priceTaxMode: 'tax_included', fulfillmentWorkspace: { enabled: true, overdueMinutes: 15 }, printerSettings: { enabled: false, receiptEnabled: false, kitchenEnabled: false, customerDisplay: { enabled: false } }, customerDisplayMediaSettings: { weighing: { enabled: false } } } };
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';import{StoreThemeProvider}from'./app/store/components/StoreThemeProvider';localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');createRoot(document.getElementById('root')).render(<OsTranslationProvider><StoreThemeProvider employeeId="fixture-employee"><Pos/></StoreThemeProvider></OsTranslationProvider>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', charset: 'utf8', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'local-fulfillment-fixture', setup(b) {
  b.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture-navigation' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-navigation' }, args => ({ contents: args.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` : `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`, loader: 'js', resolveDir: process.cwd() }));
  b.onResolve({ filter: /shared-pusher-client$/ }, args => ({ path: args.path, namespace: 'fixture-pusher' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-pusher' }, () => ({ contents: `const leases=new Set();window.__fulfillmentEmit=(event,payload={})=>{for(const handlers of leases)for(const fn of handlers.get(event)||[])fn(payload)};export function acquireSharedPusher(){const handlers=new Map();leases.add(handlers);return{connection:{bind(){}},subscribe(name){return{name,bind(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(fn);if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(event){handlers.delete(event)}}},unsubscribe(){},disconnect(){leases.delete(handlers)}}}`, loader: 'js' }));
} }] });
const css = (await readFile('app/globals.css', 'utf8')) + '\n' + (await readFile('app/store/store-responsive.css', 'utf8')) + '\n' + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const digest = contents => createHash('sha256').update(contents).digest('hex');
await writeFile(`${output}/${extraOnly ? 'extra-' : ''}source-hashes.json`, JSON.stringify({ cwd: process.cwd(), js: digest(js), css: digest(css), sources: Object.fromEntries(await Promise.all(['app/store/pos/page.tsx', 'app/store/pos/PosFulfillmentPanel.tsx', 'app/store/pos/PosFulfillmentPanel.module.css', 'app/store/pos/usePosFulfillmentQueue.ts', 'scripts/tests/pos-fulfillment-ui.mjs', ...languages.map(language => `public/locales/os/${language}.json`)].map(async path => [path, digest(await readFile(path))]))) }, null, 2));

let tasks, mutations, committed, undoRecords, posts, checkoutPosts, fulfillmentReads, workspaceEnabled, fixturePrinting, readFailure, writeFailure, dropAfterCommit, writeDelay, readDelay, recallCount, summary;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function task(id, code, minutes, status = 'waiting', orderId = 'same-payment') { return { id, orderId, orderItemId: `item-${id}`, pickupCode: code, status, productionStatus: status === 'ready' ? 'ready' : 'new', version: '1', itemSummary: '自選マーラータン 204g\nスープ: 麻辣\n麺: 春雨\n牛すじ 50g ×1', note: id === 'bowl-a' ? 'この杯だけ辛さ控えめ' : '', createdAt: new Date(Date.now() - minutes * 60000).toISOString(), readyAt: status === 'ready' ? new Date(Date.now() - 30000).toISOString() : '', tableLabel: '', orderType: 'eat_in', quantity: 1 }; }
function reset() {
  tasks = [task('bowl-b', '038', 2), task('bowl-a', '037', 22), task('bowl-c', '039', 5, 'ready')];
  mutations = new Map(); committed = []; undoRecords = new Map(); posts = []; checkoutPosts = []; fulfillmentReads = [];
  readFailure = false; writeFailure = false; dropAfterCommit = false; writeDelay = 0; readDelay = 0; recallCount = 0; summary = structuredClone(posData.todaySummary);
  workspaceEnabled = true;
  fixturePrinting = false;
}
reset();
const bodyOf = () => ({ selectedStoreId: store.id, settings: { enabled: workspaceEnabled }, tasks: workspaceEnabled ? structuredClone(tasks) : [], serverNow: new Date().toISOString() });
const send = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); return res.end(js); }
    if (url.pathname.startsWith('/locales/os/')) return send(res, dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']);
    if (url.pathname === '/api/auth/me') return send(res, { employee: { id: 'fixture-employee', name: 'Fixture', role: 'owner' } });
    if (url.pathname === '/api/store/context') return send(res, { selectedStoreId: store.id, access: { role: 'owner', stores: [store] } });
    if (url.pathname === '/api/store/realtime-config') return send(res, { key: 'local-fixture', cluster: 'local-fixture', channels: ['private-fulfillment-fixture'] });
    if (url.pathname === '/api/store/pos/operator') return send(res, { enabled: false, settings: { enabled: false, idleMinutes: 10 }, operator: null, employees: [], serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos/customer-display') return send(res, { state: { status: 'advertising', weighingRevision: 0 }, customerDisplayMediaSettings: posData.posSettings.customerDisplayMediaSettings });
    if (url.pathname === '/api/store/pos/reconciliation') return send(res, { businessDate: '2026-10-19', activeSession: { id: 'fixture-register', status: 'open', expectedCashAmount: 10000, openingAmount: 10000 }, sessions: [], movements: [], activeCashResponsibleEmployees: [] });
    if (url.pathname === '/api/store/pos/fulfillment') {
      if (req.method !== 'POST') { const body = bodyOf(); fulfillmentReads.push(body.tasks.map(task => task.id)); await pause(readDelay); return send(res, readFailure ? { error: 'Fixture: 更新失敗' } : body, readFailure ? 503 : 200); }
      let raw = ''; for await (const part of req) raw += part; const request = JSON.parse(raw); posts.push(request);
      assert.equal(request.storeId, store.id); assert.match(request.mutationId, /^[0-9a-f-]{36}$/);
      await pause(writeDelay);
      if (writeFailure) return send(res, { error: 'Fixture: 保存失敗' }, 503);
      if (mutations.has(request.mutationId)) return send(res, { ...mutations.get(request.mutationId), ...bodyOf() });
      const previous = tasks.find(task => task.id === request.taskId);
      let undo;
      if (request.action === 'undo') {
        const record = undoRecords.get(request.undoToken);
        if (!record || Date.parse(record.expiresAt) <= Date.now()) return send(res, { error: 'Fixture: 元に戻せません' }, 409);
        tasks = tasks.filter(task => task.id !== record.task.id).concat({ ...record.task, version: String(Number(record.task.version) + 2) });
        undoRecords.delete(request.undoToken);
      } else {
        if (!previous || previous.version !== request.expectedVersion) return send(res, { error: 'Fixture: 他の端末で更新されました' }, 409);
        const snapshot = structuredClone(previous);
        previous.version = String(Number(previous.version) + 1);
        if (request.action === 'ready') { previous.status = 'ready'; previous.productionStatus = 'ready'; previous.readyAt = new Date().toISOString(); }
        else if (request.action === 'handoff') tasks = tasks.filter(task => task.id !== request.taskId);
        else if (request.action === 'recall') recallCount++;
        else return send(res, { error: 'Fixture: invalid action' }, 400);
        if (request.action !== 'recall') {
          const token = `undo-${request.mutationId}`;
          undo = { token, expiresAt: new Date(Date.now() + 15000).toISOString(), taskId: request.taskId, pickupCode: previous.pickupCode, action: request.action, version: previous.version };
          undoRecords.set(token, { ...undo, task: snapshot });
        }
      }
      committed.push(request);
      const response = { ok: true, ...bodyOf(), ...(undo ? { undo } : {}) };
      mutations.set(request.mutationId, response);
      if (dropAfterCommit) { dropAfterCommit = false; return send(res, { error: 'Fixture: 保存結果を受信できませんでした' }, 503); }
      return send(res, response);
    }
    if (url.pathname === '/api/store/pos') {
      if (req.method !== 'POST') return send(res, { ...posData, todaySummary: summary, posSettings: { ...posData.posSettings, printerSettings: fixturePrinting ? { ...posData.posSettings.printerSettings, enabled: true, receiptEnabled: true, receiptPrinter: { deviceType: 'star_printer', connectionType: 'bluetooth', identifier: 'local-fixture-printer', paperWidth: '58mm', cutPaper: true, openCashDrawer: true } } : posData.posSettings.printerSettings } });
      let raw = ''; for await (const part of req) raw += part; const request = JSON.parse(raw); checkoutPosts.push(request);
      const servingTickets = request.items.map((item, index) => ({ itemIndex: index, itemId: `paid-item-${index}`, taskId: `paid-task-${index}`, pickupCode: String(50 + index).padStart(3, '0') }));
      for (const ticket of servingTickets) tasks.push(task(ticket.taskId, ticket.pickupCode, 0, 'waiting', 'fixture-paid'));
      const amount = request.items.reduce((sum, item) => sum + item.measuredQuantity * 4 * item.quantity, 0);
      summary = { orderCount: 1, total: amount, average: amount, latestOrders: [{ id: 'fixture-paid', pickupCode: 'D-PAID', amount, paymentMethod: 'cash', createdTime: new Date().toISOString() }] };
      return send(res, { ok: true, orderId: 'fixture-paid', pickupCode: 'D-PAID', servingTickets, amount, subtotalAmount: amount, taxAmount: Math.floor(amount / 11), taxRate: 10, discountAmount: 0, couponDiscountAmount: 0, cashTenderedAmount: request.cashTenderedAmount, cashChangeAmount: request.cashTenderedAmount - amount, todaySummary: summary });
    }
    if (url.pathname.includes('/device-relay')) return send(res, { stations: [], jobs: [], canManage: true, serverNow: new Date().toISOString() });
    if (url.pathname.startsWith('/api/')) return send(res, { items: [], notifications: [], unreadCount: 0 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  } catch (error) { send(res, { error: error.message }, 500); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [], pageErrors = [], externalRequests = [];
let currentPage;
const panel = '[data-pos-fulfillment-pinned]';
const drawer = '#store-pos-fulfillment-board[role="dialog"]';
const ticket = id => `[data-fulfillment-task="${id}"]`;
async function newPage({ width = 768, height = 1024, language = 'ja', expectDisabled = false, nativePrinter = false } = {}) {
  const context = await browser.createBrowserContext(), page = await context.newPage(); currentPage = page;
  page.on('pageerror', error => pageErrors.push(error.message));
  if (nativePrinter) await page.evaluateOnNewDocument(() => { window.__fixturePrints = []; window.Foundr1Printer = { isAvailable: () => true, print: payload => { window.__fixturePrints.push(JSON.parse(payload)); return JSON.stringify({ ok: true }); } }; });
  await page.setViewport({ width, height });
  await page.setRequestInterception(true); page.on('request', request => { if (request.url().startsWith(base + '/')) return request.continue(); externalRequests.push(request.url()); return request.abort(); });
  await page.goto(`${base}/store/pos?lang=${language}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.store-pos-item-button:not(:disabled)');
  await page.waitForSelector(`${panel} button[aria-expanded="false"]`);
  const waitingLabel = language === 'ja' ? '提供待ち' : dictionaries[language]['提供待ち'];
  if (expectDisabled) await page.waitForFunction(() => document.querySelector('[data-fulfillment-error]')?.textContent.includes('管理者が無効'));
  else await page.waitForFunction((selector, label) => document.querySelector(selector)?.textContent.includes(`${label} 2`), {}, panel, waitingLabel);
  return { page, context };
}
async function button(page, within, text) {
  const handle = await page.evaluateHandle(({ within, text }) => [...document.querySelectorAll(`${within} button`)].find(button => button.textContent.trim() === text || button.querySelector(':scope > span')?.textContent.trim() === text), { within, text });
  assert.ok(handle.asElement(), `Missing button ${within} ${text}`); await handle.asElement().click(); await handle.dispose();
}
async function openPanel(page) { await page.click(`${panel} button[aria-expanded="false"]`); await page.waitForSelector(drawer); }
async function closePanel(page) { await page.click(`${drawer} > header button:last-child`); await page.waitForSelector(drawer, { hidden: true }); }
async function emit(page, event = 'order.updated') { await page.evaluate(event => window.__fulfillmentEmit(event, {}), event); await pause(80); }
async function setInput(page, selector, value) { await page.$eval(selector, (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }, String(value)); }
async function addBowl(page, weight) { await page.click('.store-pos-item-button'); await page.waitForSelector('.store-pos-weight-entry input'); await setInput(page, '.store-pos-weight-entry input', weight); await page.click('.store-pos-option-add'); await page.waitForSelector('.store-pos-option-overlay', { hidden: true }); }
async function assertNoOverflow(page) { const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, dialog: document.querySelector('#store-pos-fulfillment-board') ? { client: document.querySelector('#store-pos-fulfillment-board').clientWidth, scroll: document.querySelector('#store-pos-fulfillment-board').scrollWidth } : null })); assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry)); assert.ok(!geometry.dialog || geometry.dialog.scroll <= geometry.dialog.client + 1, JSON.stringify(geometry)); return geometry; }
try {
  if (!extraOnly) {
  if (!checkoutOnly) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1600, height: 1000 }]) {
    reset(); const { page, context } = await newPage(viewport);
    const compact = await page.$eval(panel, element => ({ height: element.getBoundingClientRect().height, open: element.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded') }));
    assert.equal(compact.open, 'false'); assert.ok(compact.height <= 56, JSON.stringify(compact));
    await page.click('.store-pos-item-button'); await page.waitForSelector('.store-pos-weight-entry input'); await setInput(page, '.store-pos-weight-entry input', 204);
    await button(page, '.store-pos-option-groups', 'トマト'); await button(page, '.store-pos-option-groups', '中華麺');
    const draft = await page.$eval('.store-pos-option-overlay', element => ({ weight: element.querySelector('.store-pos-weight-entry input').value, choices: [...element.querySelectorAll('.store-pos-option-choice.is-active')].map(el => el.textContent.trim()), focused: document.activeElement?.outerHTML }));
    tasks.push(task('arrived', '041', 0)); await emit(page, 'order.created');
    const unchanged = await page.$eval('.store-pos-option-overlay', element => ({ weight: element.querySelector('.store-pos-weight-entry input').value, choices: [...element.querySelectorAll('.store-pos-option-choice.is-active')].map(el => el.textContent.trim()), focused: document.activeElement?.outerHTML }));
    assert.deepEqual(unchanged, draft, 'Arrival must preserve weight, options and focus'); assert.equal(await page.$(drawer), null, 'Arrival cannot open queue');
    await page.click('.store-pos-option-add'); await page.waitForSelector('.store-pos-option-overlay', { hidden: true });
    const cart = await page.$eval('.store-pos-cart-list', element => element.textContent); assert.match(cart, /204\s*g/); assert.match(cart, /トマト/); assert.match(cart, /中華麺/);
    await openPanel(page); await page.waitForSelector(ticket('arrived'));
    const waitingCodes = await page.$$eval('[aria-label="提供待ち"] [data-fulfillment-task] strong', elements => elements.map(el => el.textContent)); assert.deepEqual(waitingCodes, ['037', '038', '041']);
    assert.match(await page.$eval(ticket('bowl-a'), element => element.textContent), /お待たせしています/);
    assert.equal(await page.$$eval(`${drawer} section[aria-label]`, elements => elements.map(el => el.getAttribute('aria-label'))).then(labels => labels.includes('制作中')), false);
    assert.ok(!(await page.$eval(drawer, element => element.innerText)).includes('制作開始'));
    const geometry = await assertNoOverflow(page);
    await page.screenshot({ path: `${output}/queue-${viewport.width}.png`, fullPage: true });
    await closePanel(page); assert.equal(await page.$eval('.store-pos-cart-list', element => element.textContent), cart, 'Queue must preserve cart');
    assert.equal(checkoutPosts.length, 0); assert.equal(posts.length, 0);
    results.push({ name: `compact-draft-arrival-cart-layout-${viewport.width}`, passed: true, compact, geometry }); await context.close();
  }
  reset(); {
    const { page, context } = await newPage(); await openPanel(page);
    writeDelay = 350; await button(page, ticket('bowl-a'), '呼び出す'); await page.click(`${ticket('bowl-a')} button[aria-label="037を呼び出す"]`);
    await page.waitForSelector(`${ticket('bowl-a')}[data-fulfillment-status="ready"]`); assert.equal(posts.length, 1, 'Double tap cannot duplicate write');
    assert.equal(tasks.filter(task => task.orderId === 'same-payment').length, 3, 'One bowl cannot complete its paid siblings');
    assert.equal(await page.$$eval('[aria-label="提供待ち"] [data-fulfillment-task]', elements => elements.length), 1);
    writeDelay = 0; await button(page, ticket('bowl-a'), 'もう一度呼ぶ'); await page.waitForFunction(() => ![...document.querySelectorAll('[data-fulfillment-task="bowl-a"] button')].some(button => button.disabled)); assert.equal(recallCount, 1);
    await button(page, ticket('bowl-a'), 'お渡し済み'); await page.waitForSelector(ticket('bowl-a'), { hidden: true });
    assert.equal(await page.$$eval('[data-fulfillment-task]', elements => elements.length), 2, 'Only handed bowl is removed');
    await button(page, '[data-fulfillment-undo]', '元に戻す'); await page.waitForSelector(`${ticket('bowl-a')}[data-fulfillment-status="ready"]`);
    await page.screenshot({ path: `${output}/per-bowl-undo.png`, fullPage: true });
    results.push({ name: 'per-bowl-call-recall-handoff-undo-no-double-write', passed: true, posts: structuredClone(posts), recallCount }); await context.close();
  }
  reset(); {
    const { page, context } = await newPage(); await openPanel(page); writeFailure = true;
    await button(page, ticket('bowl-a'), '呼び出す'); await page.waitForSelector('[data-fulfillment-error]');
    assert.equal(await page.$eval(ticket('bowl-a'), element => element.dataset.fulfillmentStatus), 'waiting');
    assert.match(await page.$eval('[data-fulfillment-error]', element => element.textContent), /Fixture: 保存失敗/);
    await page.screenshot({ path: `${output}/failure-keeps-ticket.png`, fullPage: true });
    writeFailure = false; await button(page, '[data-fulfillment-error]', '同じ操作を再試行'); await page.waitForSelector(`${ticket('bowl-a')}[data-fulfillment-status="ready"]`);
    assert.equal(posts.length, 2); assert.equal(posts[0].mutationId, posts[1].mutationId); assert.equal(committed.length, 1);
    dropAfterCommit = true; await button(page, ticket('bowl-b'), '呼び出す'); await page.waitForSelector('[data-fulfillment-error]');
    await button(page, '[data-fulfillment-error]', '同じ操作を再試行'); await page.waitForSelector('[data-fulfillment-error]', { hidden: true });
    assert.equal(committed.filter(entry => entry.taskId === 'bowl-b').length, 1, 'Lost response retry cannot duplicate committed action'); assert.equal(posts.at(-1).mutationId, posts.at(-2).mutationId);
    await closePanel(page); readFailure = true; await page.click(`${panel} button[aria-label="提供状況を更新"]`); await page.waitForSelector('[data-fulfillment-error]'); await openPanel(page);
    assert.equal(await page.$$eval('[data-fulfillment-task]', elements => elements.length), 3, 'Read failure preserves last known queue');
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-fulfillment-task] button')].every(el => el.disabled));
    results.push({ name: 'persistent-write-read-failure-idempotent-retry-offline', passed: true, posts: structuredClone(posts) }); await context.close();
  }
  reset(); {
    const { page, context } = await newPage({ width: 1600, height: 1000 }); await openPanel(page);
    await page.click(`${drawer} button[aria-label="この端末で常駐表示"]`);
    await page.waitForSelector(`${panel}[data-pos-fulfillment-pinned="true"]`); assert.equal(await page.$(drawer), null);
    const geometry = await assertNoOverflow(page); await page.screenshot({ path: `${output}/desktop-pinned.png`, fullPage: true });
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector(`${panel}[data-pos-fulfillment-pinned="true"]`);
    await page.setViewport({ width: 768, height: 1024 }); await page.waitForSelector(`${panel}[data-pos-fulfillment-pinned="false"]`); assert.equal(await page.$(drawer), null);
    await openPanel(page); await assertNoOverflow(page); await closePanel(page);
    await page.setViewport({ width: 1600, height: 1000 }); await page.waitForSelector(`${panel}[data-pos-fulfillment-pinned="true"]`);
    results.push({ name: 'device-side-preference-reload-and-small-screen-fallback', passed: true, geometry }); await context.close();
  }
  }
  reset(); {
    fixturePrinting = true;
    const { page, context } = await newPage({ width: 1024, height: 768, nativePrinter: true }); await addBowl(page, 204); await addBowl(page, 250);
    const cash = await page.$('.store-pos-cash-payment input'); assert.ok(cash); await cash.type('2000'); await page.click('.store-pos-checkout');
    await page.waitForFunction(() => document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length === 0);
    await openPanel(page); await page.waitForSelector(ticket('paid-task-0')); await page.waitForSelector(ticket('paid-task-1'));
    assert.equal(checkoutPosts.length, 1); assert.equal(checkoutPosts[0].items.length, 2); assert.equal(tasks.filter(task => task.orderId === 'fixture-paid').length, 2);
    assert.equal(posts.length, 0, 'Checkout automatically queues bowls without begin/skip actions');
    results.push({ name: 'paid-checkout-refresh-queues-two-independent-bowls', passed: true }); await context.close();
  }
  }
  if (!coreOnly) {
  reset(); {
    const { page, context } = await newPage();
    await openPanel(page); await closePanel(page);
    await page.waitForFunction(selector => !document.querySelector(selector).disabled, {}, `${panel} button[aria-label="提供状況を更新"]`);
    readDelay = 300; const readsBefore = fulfillmentReads.length;
    await page.click(`${panel} button[aria-label="提供状況を更新"]`);
    for (let i = 0; i < 20 && fulfillmentReads.length === readsBefore; i++) await pause(5);
    assert.equal(fulfillmentReads.length, readsBefore + 1); assert.ok(!fulfillmentReads.at(-1).includes('race-arrival'));
    tasks.push(task('race-arrival', '099', 0)); await emit(page, 'order.created');
    await openPanel(page); await page.waitForSelector(ticket('race-arrival'), { timeout: 3000 });
    assert.ok(fulfillmentReads.length >= readsBefore + 2); assert.ok(fulfillmentReads.at(-1).includes('race-arrival'));
    await page.setViewport({ width: 1600, height: 1000 }); await page.waitForSelector(`${drawer} button[aria-label="この端末で常駐表示"]`);
    await page.click(`${drawer} button[aria-label="この端末で常駐表示"]`); await page.waitForSelector(`${panel}[data-pos-fulfillment-pinned="true"]`);
    const pinnedGeometry = await assertNoOverflow(page); await page.screenshot({ path: `${output}/final-desktop-pinned.png`, fullPage: true });
    workspaceEnabled = false; await emit(page, 'order.updated');
    await page.waitForFunction(() => document.querySelector('[data-fulfillment-error]')?.textContent.includes('管理者が無効'));
    assert.equal(await page.$$eval('[data-fulfillment-task]', elements => elements.length), 4, 'Disabled GET must preserve last confirmed tickets');
    assert.ok(await page.$$eval('[data-fulfillment-task] button', elements => elements.every(el => el.disabled)));
    workspaceEnabled = true; await emit(page, 'order.updated'); await page.waitForSelector('[data-fulfillment-error]', { hidden: true });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-fulfillment-task] button')].every(el => !el.disabled));
    assert.equal(posts.length, 0); const readSnapshots = fulfillmentReads.slice(readsBefore); await context.close();
    workspaceEnabled = false; readDelay = 0;
    const initialDisabled = await newPage({ width: 768, height: 1024, expectDisabled: true });
    const unknownCount = await initialDisabled.page.$eval(`${panel} button[aria-expanded]`, el => el.textContent);
    assert.ok(unknownCount.includes('—')); assert.ok(!unknownCount.includes('提供待ち 0'));
    await openPanel(initialDisabled.page);
    const disabledContent = await initialDisabled.page.$eval(drawer, el => el.textContent);
    assert.ok(!disabledContent.includes('提供待ちはありません。')); assert.ok(!disabledContent.includes('お渡し待ちはありません。'));
    await initialDisabled.page.screenshot({ path: `${output}/disabled-before-first-read.png`, fullPage: true }); await initialDisabled.context.close();
    results.push({ name: 'event-during-pending-get-coalesces-fresh-read-and-disabled-store-retains-tickets', passed: true, readSnapshots, pinnedGeometry, firstDisabledCounts: unknownCount });
  }
  for (const [index, language] of languages.entries()) {
    reset(); const { page, context } = await newPage({ language, width: index ? 768 : 390, height: 1024 });
    await page.click('.store-pos-item-button'); await page.waitForSelector('.store-pos-weight-entry input'); await setInput(page, '.store-pos-weight-entry input', 316);
    const draft = await page.$eval('.store-pos-option-overlay', el => el.innerHTML); await emit(page, 'order.updated');
    assert.equal(await page.$eval('.store-pos-weight-entry input', input => input.value), '316');
    assert.equal(await page.$eval('.store-pos-option-overlay', el => el.innerHTML), draft);
    await page.click('.store-pos-option-add'); await page.waitForSelector('.store-pos-option-overlay', { hidden: true });
    const cart = await page.$eval('.store-pos-cart-list', el => el.textContent);
    await openPanel(page);
    await page.waitForFunction((selector, text) => document.querySelector(selector)?.textContent.includes(text), {}, drawer, dictionaries[language]['提供待ち']);
    const content = await page.$eval(drawer, element => element.textContent);
    for (const key of ['提供状況', '提供待ち', 'お渡し', '呼び出す', 'お渡し済み', 'もう一度呼ぶ', '厨房メモ']) assert.ok(dictionaries[language][key] && content.includes(dictionaries[language][key]), `Missing ${language} ${key}`);
    assert.ok(content.includes(dictionaries[language]['{minutes}分経過'].replace('{minutes}', '22')));
    assert.equal(await page.$eval(`${ticket('bowl-a')} button.primary-button`, el => el.getAttribute('aria-label')), dictionaries[language]['{code}を呼び出す'].replace('{code}', '037'));
    await assertNoOverflow(page); await page.screenshot({ path: `${output}/${language}-translated-queue.png`, fullPage: true });
    await closePanel(page); assert.equal(await page.$eval('.store-pos-cart-list', el => el.textContent), cart); assert.equal(posts.length, 0);
    await openPanel(page); await button(page, ticket('bowl-a'), dictionaries[language]['呼び出す']); await page.waitForSelector('[data-fulfillment-undo]');
    assert.equal(await page.$eval('[data-fulfillment-undo] button', el => el.textContent.trim()), dictionaries[language]['元に戻す']);
    results.push({ name: `${language}-labels-dynamic-code-minutes-draft-layout`, passed: true }); await context.close();
  }
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
  await writeFile(`${output}/${extraOnly ? 'extra-' : ''}results.json`, JSON.stringify({ results, pageErrors, externalRequests }, null, 2));
  console.log(`PASS ${results.length} actual POS fulfillment UI groups; no browser errors or external requests.`);
} catch (error) {
  await writeFile(`${output}/driver-failure.json`, JSON.stringify({ message: error.message, stack: error.stack, text: await currentPage?.evaluate(() => document.body.innerText).catch(() => null), tasks, posts, checkoutPosts, pageErrors, externalRequests }, null, 2));
  if (currentPage) await currentPage.screenshot({ path: `${output}/driver-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  stop(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
