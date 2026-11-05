// Runs the actual POS React page, translations, theme, IndexedDB, and print queue.
// All HTTP and native responses are synthetic; external requests are blocked.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const source = resolve(args.source || process.cwd());
const output = resolve(args.output || 'outputs/pos-checkout-print-optional-ui');
const mode = args.mode || 'after';
assert.ok(['before', 'after'].includes(mode), 'Expected --mode before or after');
const requireSource = createRequire(join(source, 'package.json'));
const { build, stop } = requireSource('esbuild');
const puppeteer = requireSource('puppeteer-core');
await mkdir(output, { recursive: true });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async lang => [lang, JSON.parse(await readFile(join(source, `public/locales/os/${lang}.json`), 'utf8'))])));
const store = { id: '11111111-1111-4111-8111-111111111111', name: '清水店', brandIds: ['fixture-maamaa'] };
const brand = { id: 'fixture-maamaa', name: 'まぁ麻' };
const item = { id: 'fixture-soup', brandId: brand.id, brandName: brand.name, name: '麻辣湯スープ', displayNames: { ja: '麻辣湯スープ' }, itemKind: 'buildable_product', category: 'スープ', imageUrl: '', basePrice: 815, priceOverride: null, posPricingMode: 'fixed', posWeightUnit: 'g', posWeightUnitPrice: null, isAvailable: true, variableSchema: {} };
const printer = { deviceType: 'escpos_network', connectionType: 'lan', host: '127.0.0.2', port: 9100, identifier: '', paperWidth: '80mm', characterEncoding: 'shift_jis', cutPaper: true, openCashDrawer: true };
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';import{StoreThemeProvider}from'./app/store/components/StoreThemeProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
window.__prints=[];if(new URLSearchParams(location.search).get('bridge')==='yes')window.Foundr1Printer={isAvailable:()=>true,print:payload=>{window.__prints.push(JSON.parse(payload));return JSON.stringify({ok:true})}};
createRoot(document.getElementById('root')).render(<OsTranslationProvider><StoreThemeProvider employeeId="fixture-employee"><Pos/></StoreThemeProvider></OsTranslationProvider>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', charset: 'utf8', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'local-fixture-only', setup(b) {
  b.onResolve({ filter: /^next\/(link|navigation)$/ }, a => ({ path: a.path, namespace: 'fixture-navigation' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-navigation' }, a => ({ contents: a.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` : `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`, loader: 'js', resolveDir: source }));
  b.onResolve({ filter: /shared-pusher-client$/ }, a => ({ path: a.path, namespace: 'fixture-pusher' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-pusher' }, () => ({ contents: `export function acquireSharedPusher(){return{connection:{bind(){}},subscribe(){return{name:'private-checkout-fixture',bind(event,fn){if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(){}}},unsubscribe(){},disconnect(){}}}`, loader: 'js' }));
} }] });
const css = await readFile(join(source, 'app/globals.css'), 'utf8') + '\n' + await readFile(join(source, 'app/store/store-responsive.css'), 'utf8') + '\n' + (bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text || '');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
let settings, posts, rejectCheckout, checkoutResponses, customerDisplayPosts, serverPrintContract;
function reset({ enabled = false, receiptEnabled = false, reject = false, serverDocuments = false } = {}) {
  settings = { enabled, receiptEnabled, kitchenEnabled: false, receiptPrinter: printer, kitchenPrinter: printer, customerDisplay: { enabled: false } };
  posts = []; checkoutResponses = []; customerDisplayPosts = []; rejectCheckout = reject; serverPrintContract = serverDocuments;
}
reset();
const summary = { orderCount: 0, total: 0, average: 0, latestOrders: [] };
const openSession = { id: 'fixture-register', businessDate: '2026-10-20', status: 'open', openingAmount: 10000, expectedCashAmount: 10000, openedAt: '2026-10-20T01:00:00.000Z', cashSales: 0, cashIn: 0, cashOut: 0 };
const send = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const serverErrors = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); return res.end(bundle.outputFiles.find(f => f.path.endsWith('.js')).text); }
    if (url.pathname.startsWith('/locales/os/')) return send(res, dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']);
    if (url.pathname === '/api/auth/me') return send(res, { employee: { id: 'fixture-employee', name: 'Fixture', role: 'owner' } });
    if (url.pathname === '/api/store/context') return send(res, { selectedStoreId: store.id, access: { role: 'owner', canUseAllStoreView: true, stores: [store] } });
    if (url.pathname === '/api/store/theme') return send(res, { storeId: store.id, storeName: store.name, target: 'operations', theme: { mode: 'custom', primaryColor: '#006b7d', paletteVersion: 1 }, brand: null, canManageTheme: true, stores: [store], updatedAt: null, revision: null });
    if (url.pathname === '/api/store/realtime-config') return send(res, { key: 'fixture', cluster: 'fixture', channels: ['private-checkout-fixture'] });
    if (url.pathname === '/api/store/pos/operator') return send(res, { enabled: false, settings: { enabled: false, idleMinutes: 10 }, operator: null, employees: [], serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos/print-documents') {
      const documents = serverPrintContract && checkoutResponses.length ? ['kitchen', 'finishing', 'pickup', 'receipt'].map((kind, index) => ({ id: `fixture-document-${index}`, orderId: 'fixture-order', itemId: kind === 'receipt' ? null : 'fixture-order-item', kind, sequence: index, copyNumber: 1, pickupCode: '037', label: kind, createdAt: '2026-10-20T01:00:00.000Z', orderCreatedAt: '2026-10-20T01:00:00.000Z', state: 'pending', error: '', eligible: true, blockedReason: '', revision: 1, transport: null })) : [];
      return send(res, { version: 1, selectedStoreId: store.id, documents, summary: { pendingDocuments: documents.length, pendingOrders: documents.length ? 1 : 0, needsReview: 0, sendingDocuments: 0 }, hasMore: false, cursor: null, relay: { available: false, online: false }, serverNow: new Date().toISOString() });
    }
    if (url.pathname === '/api/store/pos/customer-display') {
      if (req.method === 'POST') { let raw = ''; for await (const part of req) raw += part; customerDisplayPosts.push(JSON.parse(raw)); }
      return send(res, { ok: true, state: { status: 'advertising', weighingRevision: 0 }, customerDisplayMediaSettings: { weighing: { enabled: false } } });
    }
    if (url.pathname === '/api/store/pos/reconciliation') return send(res, { businessDate: '2026-10-20', activeSession: openSession, sessions: [openSession], movements: [], activeCashResponsibleEmployees: [] });
    if (url.pathname.includes('/device-relay')) return send(res, { stations: [], jobs: [], canManage: true, serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos' && req.method === 'POST') {
      let raw = ''; for await (const part of req) raw += part; const body = JSON.parse(raw); posts.push(body);
      if (rejectCheckout) return send(res, { error: 'Fixture: メニューが更新されました。商品と金額を確認してください。' }, 409);
      assert.equal(body.items.length, 1); assert.equal(body.items[0].menuCatalogItemId, item.id); assert.equal(body.items[0].quantity, 1);
      const response = { ok: true, orderId: 'fixture-order', pickupCode: 'D-FIXTURE', servingTickets: [{ itemIndex: 0, pickupCode: '037', itemId: 'fixture-order-item', taskId: 'fixture-task' }], amount: 652, subtotalAmount: 815, taxableAmount: 652, taxAmount: 49, taxRate: 8, priceTaxMode: 'tax_included', discountAmount: 163, couponDiscountAmount: 0, cashTenderedAmount: body.cashTenderedAmount, cashChangeAmount: body.cashTenderedAmount - 652, receiptRequested: body.receiptRequested, todaySummary: { ...summary, orderCount: 1, total: 652, average: 652 } };
      if (serverPrintContract) response.printDocuments = { version: 1, orderId: 'fixture-order', mode: body.printMode, documentCount: 4, pendingCount: 4 };
      checkoutResponses.push(response); return send(res, response);
    }
    if (url.pathname === '/api/store/pos') return send(res, { selectedStoreId: store.id, access: { role: 'owner', stores: [store] }, brands: [brand], items: [item], categories: [], optionGroups: [], posMenuRevision: 'fixture-revision', todaySummary: summary, posSettings: { dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: 'KOMOJU', priceTaxMode: 'tax_included', discountPresets: [{ key: 'student', name: '学割 20%OFF', discountType: 'percent', discountValue: 20, targetScope: 'all', targetValue: '', enabled: true, stampEligible: false, allowCouponCombination: false }], printerSettings: settings, customerDisplayMediaSettings: { weighing: { enabled: false } } } });
    if (url.pathname.startsWith('/api/')) return send(res, { items: [], notifications: [], unreadCount: 0 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  } catch (error) { serverErrors.push(error.stack); send(res, { error: error.message }, 500); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true, timeout: 30000, dumpio: Boolean(process.env.POS_CHECKOUT_UI_DEBUG) });
const results = [], pageErrors = [], externalRequests = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let currentPage;
async function clickVisible(page, selector) {
  const element = await page.$(selector); assert.ok(element, selector);
  // Native clicks must hit the control, including when a fixed mobile payment
  // bar initially covers it. Ordinary page scrolling must make it reachable.
  await element.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(el => {
    const rect = el.getBoundingClientRect(), top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return !el.disabled && rect.height > 0 && rect.y >= 0 && rect.bottom <= innerHeight && (top === el || el.contains(top));
  }, { timeout: 8000 }, element);
  await element.click();
}
async function createPage({ width = 390, bridge = false, language = 'ja' } = {}) {
  const context = await browser.createBrowserContext(), page = await context.newPage(); currentPage = page;
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewport({ width, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.url().startsWith(base + '/')) return request.continue(); externalRequests.push(request.url()); return request.abort(); });
  await page.goto(`${base}/store/pos?lang=${language}&bridge=${bridge ? 'yes' : 'no'}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.store-pos-item-button:not(:disabled)');
  await page.waitForFunction(() => getComputedStyle(document.body).getPropertyValue('--store-primary').trim() === '#006b7d');
  await clickVisible(page, '.store-pos-item-button');
  await page.waitForFunction(() => document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length === 1);
  if (width <= 900) { await page.click('.store-pos-floating-checkout button'); await page.waitForSelector('.store-pos-cart-panel.is-open'); }
  await page.evaluate(() => [...document.querySelectorAll('.store-pos-segmented button')].find(el => el.textContent === '持ち帰り')?.click());
  await page.click('.store-pos-discount-panel button');
  await page.type('.store-pos-cash-payment input', '2000');
  await page.waitForFunction(() => !document.querySelector('.store-pos-checkout').disabled);
  const values = await page.$eval('.store-pos-cart-panel', panel => ({ cash: panel.querySelector('.store-pos-cash-payment input').value, change: panel.querySelector('.store-pos-cash-payment strong').textContent, total: panel.querySelector('.store-pos-total').innerText, takeout: [...panel.querySelectorAll('.store-pos-segmented button')].find(el => el.classList.contains('is-active'))?.textContent }));
  assert.equal(values.cash, '2000'); assert.match(values.change, /1,348/); assert.match(values.total, /815/); assert.match(values.total, /163/); assert.match(values.total, /652/);
  return { page, context, values };
}
async function geometry(page, selector) {
  return page.$eval(selector, async el => {
    el.scrollIntoView({ block: 'center' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = el.getBoundingClientRect(), top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { text: el.textContent, x: rect.x, y: rect.y, right: rect.right, width: rect.width, height: rect.height, hit: top === el || el.contains(top), scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
}
function assertGeometry(info) { assert.ok(info.width > 0 && info.height > 0); assert.ok(info.hit, `Control/alert obscured: ${JSON.stringify(info)}`); assert.ok(info.x >= -1 && info.right <= info.viewportWidth + 1); assert.ok(info.scrollWidth <= info.viewportWidth + 1, `Horizontal overflow: ${JSON.stringify(info)}`); }
async function localData(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('foundr1-store-offline'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const result = {};
    for (const name of ['pos-print-jobs', 'pos-checkout-recovery', 'pos-orders']) result[name] = await new Promise((resolve, reject) => { const tx = db.transaction(name, 'readonly'), request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close(); return result;
  });
}
function assertRequest() {
  assert.equal(posts.length, 1, 'Exactly one checkout HTTP request');
  const body = posts[0]; assert.equal(body.storeId, store.id); assert.equal(body.orderType, 'takeout'); assert.equal(body.paymentMethod, 'cash'); assert.equal(body.cashTenderedAmount, 2000); assert.equal(body.discountPresetKey, 'student'); assert.equal(body.offlineExpectedAmount, 652); assert.equal(body.bowlTicketVersion, 1); assert.equal(body.receiptRequested, false); assert.equal(body.posMenuRevision, 'fixture-revision'); assert.equal(body.items[0].quantity, 1); assert.equal(body.items[0].menuCatalogItemId, item.id); assert.ok(body.offlineClientOrderId); assert.equal(checkoutResponses[0]?.amount, 652);
}
async function alertState(page) {
  const selector = '.store-pos-cart-panel [role="alert"]'; await page.waitForSelector(selector);
  const initial = await geometry(page, selector); assertGeometry(initial); return initial;
}
try {
  for (const width of [390, 800, 1366]) {
    reset(); const { page, context, values } = await createPage({ width });
    const button = await geometry(page, '.store-pos-checkout'); assertGeometry(button);
    await page.click('.store-pos-checkout');
    if (mode === 'before') {
      await page.waitForSelector('.store-pos-notice');
      assert.equal(posts.length, 0, 'Published bug must stop before a sale request');
      const notice = await page.$eval('.store-pos-notice', el => { const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { text: el.textContent, visible: r.y >= 0 && r.bottom <= innerHeight && (top === el || el.contains(top)), inlineAlert: Boolean(document.querySelector('.store-pos-cart-panel [role="alert"]')) }; });
      assert.match(notice.text, /プリンター/); assert.equal(notice.inlineAlert, false); if (width <= 900) assert.equal(notice.visible, false, 'Cart dialog hides published failure notice');
      await page.screenshot({ path: join(output, `before-${width}-silent-printer-block.png`), fullPage: true });
      const data = await localData(page); assert.equal(data['pos-print-jobs'].length, 0);
      results.push({ name: `published-silent-block-${width}`, passed: true, values, button, notice, checkoutPosts: posts.length, data });
    } else {
      await page.waitForFunction(() => document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length === 0);
      assertRequest(); const data = await localData(page); assert.equal(data['pos-print-jobs'].length, 0); assert.equal(data['pos-checkout-recovery'].length, 0); assert.equal(data['pos-orders'].length, 0); assert.equal(await page.evaluate(() => window.__prints.length), 0);
      const success = await geometry(page, '.store-pos-checkout-actions [role="status"]'); assertGeometry(success); assert.match(success.text, /会計を保存しました/); assert.match(success.text, /652/); assert.match(success.text, /1,348/);
      await page.screenshot({ path: join(output, `after-${width}-no-printer-checkout.png`), fullPage: true });
      results.push({ name: `printing-off-checkout-${width}`, passed: true, values, button, success, request: posts[0], response: checkoutResponses[0], printJobs: 0, nativePrintCalls: 0 });
    }
    await context.close();
  }
  if (mode === 'after') {
    for (const width of [390, 800, 1366]) {
      reset({ reject: true }); const { page, context } = await createPage({ width }); await geometry(page, '.store-pos-checkout'); await page.click('.store-pos-checkout');
      const initial = await alertState(page); assert.match(initial.text, /Fixture: メニュー/); assert.equal(posts.length, 1);
      await pause(3800); const persisted = await geometry(page, '.store-pos-cart-panel [role="alert"]'); assertGeometry(persisted); assert.equal(persisted.text, initial.text, 'Failure remains after transient toast timeout');
      assert.equal(await page.$eval('.store-pos-cash-payment input', el => el.value), '2000'); assert.equal(await page.$$eval('.store-pos-cart-list > .store-pos-cart-row', rows => rows.length), 1); assert.equal(await page.$eval('.store-pos-checkout', el => el.disabled), false);
      const data = await localData(page); assert.equal(data['pos-print-jobs'].length, 0); assert.equal(data['pos-checkout-recovery'].length, 0); assert.equal(await page.evaluate(() => window.__prints.length), 0);
      await page.screenshot({ path: join(output, `after-${width}-persistent-api-error.png`), fullPage: true });
      results.push({ name: `persistent-api-rejection-${width}`, passed: true, initial, persisted, checkoutPosts: posts.length, cartPreserved: true, cashPreserved: true }); await context.close();
    }
    reset({ enabled: true, receiptEnabled: true, serverDocuments: true }); {
      const { page, context } = await createPage({ width: 390 }); await geometry(page, '.store-pos-checkout'); await page.click('.store-pos-checkout');
      await page.waitForFunction(() => document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length === 0);
      assertRequest(); assert.equal(posts[0].printMode, 'deferred'); assert.equal(posts[0].printDocumentVersion, 1);
      const deferred = await geometry(page, '.store-pos-checkout-actions [role="status"]'); assertGeometry(deferred); assert.match(deferred.text, /会計済み・印刷待ち/);
      await pause(3800); assertGeometry(await geometry(page, '.store-pos-checkout-actions [role="status"]'));
      const data = await localData(page); assert.equal(data['pos-print-jobs'].length, 0); assert.equal(data['pos-checkout-recovery'].length, 0); assert.equal(data['pos-orders'].length, 0);
      assert.equal(await page.evaluate(() => window.__prints.length), 0);
      await page.screenshot({ path: join(output, 'after-390-printing-enabled-missing-bridge.png'), fullPage: true });
      results.push({ name: 'printing-enabled-missing-bridge-saves-with-explicit-deferred-documents', passed: true, deferred, checkoutPosts: 1, printMode: posts[0].printMode, serverPendingDocuments: 4, nativePrintCalls: 0 }); await context.close();
    }
    reset({ enabled: true, receiptEnabled: true }); {
      const { page, context } = await createPage({ width: 1366, bridge: true }); await geometry(page, '.store-pos-checkout'); await page.click('.store-pos-checkout');
      await page.waitForFunction(() => window.__prints.length === 4 && document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length === 0);
      assertRequest(); const prints = await page.evaluate(() => window.__prints), data = await localData(page);
      assert.deepEqual(prints.slice(0, 3).map(p => p.kitchenTicketTemplate.title), ['厨房伝票', '出品伝票', 'お客様番号札']); assert.equal(prints[3].jobType, 'receipt'); assert.equal(prints[3].order.totalAmount, 652); assert.equal(prints[3].order.cashTenderedAmount, 2000); assert.equal(prints[3].order.cashChangeAmount, 1348);
      assert.deepEqual(prints.slice(0, 3).map(p => p.order.pickupCode), ['037', '037', '037']); assert.equal(data['pos-print-jobs'].length, 4); assert.ok(data['pos-print-jobs'].every(job => job.state === 'sent')); assert.equal(data['pos-checkout-recovery'].length, 0);
      results.push({ name: 'printing-enabled-bowl-keeps-four-document-order', passed: true, request: posts[0], printKinds: data['pos-print-jobs'].map(job => job.kind), printTotal: prints[3].order.totalAmount, nativePrintCalls: prints.length });
      // A saved legacy three-document batch must survive a later master-disable.
      // An uncertain/failed pickup stops the queue and requires manual review.
      const recoveryRequest = posts[0];
      const savedBatch = [data['pos-print-jobs'][0], data['pos-print-jobs'][2], data['pos-print-jobs'][3]].map((job, index) => ({ ...job, id: `${recoveryRequest.offlineClientOrderId}:legacy-${index}`, sequence: index, state: ['sent', 'failed', 'pending'][index], error: index === 1 ? 'Fixture: prior send uncertain' : '' }));
      const recoveredCart = [{ ...item, cartKey: 'fixture-cart-key', quantity: 1, measuredQuantity: null, measuredUnit: '', measuredUnitPrice: null, selectedOptions: [], optionTotal: 0 }];
      await page.evaluate(async ({ jobs, recovery }) => {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open('foundr1-store-offline'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise((resolve, reject) => { const tx = db.transaction(['pos-print-jobs', 'pos-checkout-recovery'], 'readwrite'); tx.objectStore('pos-print-jobs').clear(); for (const job of jobs) tx.objectStore('pos-print-jobs').put(job); tx.objectStore('pos-checkout-recovery').put(recovery); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
      }, { jobs: savedBatch, recovery: { storeId: store.id, request: recoveryRequest, cart: recoveredCart } });
      settings.enabled = false; settings.receiptEnabled = false; posts = []; checkoutResponses = [];
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '元の会計結果を確認' && !button.disabled));
      await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === '元の会計結果を確認').click());
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent === '元の会計結果を確認'));
      const preserved = await localData(page); assert.equal(posts.length, 1); assert.equal(posts[0].offlineClientOrderId, recoveryRequest.offlineClientOrderId); assert.deepEqual(preserved['pos-print-jobs'], savedBatch); assert.equal(preserved['pos-checkout-recovery'].length, 0); assert.equal(await page.evaluate(() => window.__prints.length), 0, 'Never automatically repeat an uncertain document');
      results.push({ name: 'master-disabled-preserves-legacy-failed-batch', passed: true, originalRequestReused: true, unchangedJobs: preserved['pos-print-jobs'].length, states: preserved['pos-print-jobs'].map(job => job.state), nativePrintCalls: 0 }); await context.close();
    }
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(serverErrors, []);
  const files = ['app/store/pos/page.tsx', 'app/store/pos/StorePosWorkspace.tsx', 'app/globals.css', 'app/store/store-responsive.css'];
  const hashes = {};
  for (const file of files) { try { hashes[file] = sha256(await readFile(join(source, file))); } catch { /* Baseline does not contain this new regression script. */ } }
  hashes.executedTest = sha256(await readFile(new URL(import.meta.url)));
  const result = { mode, source, synthetic: true, liveWrites: 0, viewports: [390, 800, 1366], passed: true, checks: results, pageErrors, externalRequests, serverErrors, hashes, bundleSha256: sha256(bundle.outputFiles.find(f => f.path.endsWith('.js')).text) };
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2)); await writeFile(join(output, 'executed-test.mjs'), await readFile(new URL(import.meta.url)));
  console.log(JSON.stringify({ mode, passed: true, checks: results.length, externalRequests: 0, pageErrors: 0, output }));
} catch (error) {
  const state = currentPage && !currentPage.isClosed() ? await currentPage.evaluate(() => ({ body: document.body.innerText.slice(-6500), prints: window.__prints })) : null;
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.stack, results, posts, pageErrors, serverErrors, externalRequests, state }, null, 2));
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: join(output, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); stop(); }
