// Renders the real store pages against isolated, synthetic API responses.
// No database, authentication credentials, platform commands, or payments are used.
import { context } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const output = resolve(root, 'outputs/store-responsive-review-20260915/after');
const stores = [{ id: 'test-store', name: '清水店（検証用）' }, { id: 'test-store-2', name: '桜並木店（検証用）' }];
const access = { role: 'owner', stores, canUseAllStoreView: true, canViewSalesStats: true, canCancelOrders: true };
const brands = [{ id: 'brand-test', name: 'まぁ麻' }];
const categories = Array.from({ length: 12 }, (_, i) => ({ id: `category-${i}`, brandId: brands[0].id, name: `カテゴリー ${i + 1}`, sortOrder: i }));
const items = Array.from({ length: 36 }, (_, i) => ({ id: `item-${i}`, brandId: brands[0].id, brandName: 'まぁ麻', name: i === 0 ? '牛肉と野菜のマーラータン' : `香り豊かな野菜マーラータン ${i + 1}`, displayNames: { zh: `牛肉蔬菜麻辣烫 ${i + 1}`, 'zh-Hant': `牛肉蔬菜麻辣燙 ${i + 1}` }, category: categories[i % 12].name, imageUrl: '', basePrice: 1000, priceOverride: null, itemKind: 'fixed_product', posPricingMode: 'fixed', posWeightUnit: 'g', posWeightUnitPrice: null, isAvailable: true, stockStatus: i % 4 === 0 ? 'unavailable' : 'available', statusNote: '', variableSchema: {}, websitePresentation: {}, platformAvailability: {}, promotionPrefix: '', promotionPrefixDisplayNames: {}, websiteEnabled: true, posEnabled: true, deliveryEnabled: true }));
const optionGroups = Array.from({ length: 12 }, (_, group) => ({ id: `group-${group}`, brandId: brands[0].id, menuCatalogItemId: 'item-0', applicableCategories: [], groupKey: `custom-${group}`, name: `追加具材 ${group + 1}`, selectionType: group === 0 ? 'single' : 'quantity', ruleJson: { max: 12 }, sortOrder: group, options: Array.from({ length: 20 }, (_, option) => ({ id: `option-${group}-${option}`, name: `新鮮な野菜 ${group + 1}-${option + 1}`, optionKey: `option-${group}-${option}`, applicableCategories: [], priceDelta: option % 3 === 0 ? 0 : 100, sortOrder: option })) }));
const now = new Date().toISOString();
const orders = Array.from({ length: 182 }, (_, i) => ({ id: `order-${i}`, storeId: stores[0].id, storeName: stores[0].name, orderSource: 'maamaa_web', pickupCode: `P-${String(i + 1).padStart(4, '0')}`, status: i < 2 ? 'ready' : 'preparing', paymentStatus: 'paid', pickupDate: now.slice(0, 10), pickupTime: '13:30', pickupTiming: 'asap', paidAt: now, createdAt: now, createdTime: now, updatedAt: now, initialAlertAcknowledgedAt: now, alertPhase: 'immediate', amount: 1200, currency: 'JPY', drink: '牛肉と野菜のマーラータン', customerName: `テスト顧客 ${i + 1}`, customerPhone: '', customerNote: '', orderType: 'pickup', items: [], productionTasks: [], option: '', size: '', toppings: '', temperature: '', ice: '', sweetness: '', shortagePreference: 'refund' }));
const reports = Array.from({ length: 200 }, (_, i) => ({ id: `run-${i}`, runType: 'availability_change', action: 'available', itemLabel: `历史名称 ${i + 1}`, itemName: `検証用野菜 ${i + 1}`, itemDisplayNames: { zh: `测试蔬菜 ${i + 1}` }, source: 'store', actorName: '検証担当', createdAt: new Date(Date.now() - i * 3600000).toISOString(), status: i % 4 === 0 ? 'failed' : i % 4 === 1 ? 'processing' : 'succeeded', details: {}, platforms: [{ platform: 'rocket_now', total: 1, succeeded: i % 4 > 1 ? 1 : 0, failed: i % 4 === 0 ? 1 : 0, timedOut: 0, processing: i % 4 === 1 ? 1 : 0, queued: 0 }], failedCommands: i % 4 === 0 ? [{ id: `command-${i}`, platform: 'rocket_now', status: 'failed', error: 'Fixture connection unavailable', attempts: 1, failedItems: [], failedTargets: [], desiredAvailable: true, updatedAt: now }] : [] }));
const fixtures = {
  '/api/store/context': { access, selectedStoreId: stores[0].id },
  '/api/auth/me': { employee: { id: 'employee-0', name: '検証担当', loginId: 'test-only', role: 'owner' } },
  '/api/os/store-context': { canSelectStore: true, stores, selectedStoreId: stores[0].id },
  '/api/notifications': { notifications: [], unreadCount: 3 },
  '/api/store/orders': { access, selectedStoreId: stores[0].id, orders },
  '/api/store/order-stats': { summary: { paidOrders: 182, completedOrders: 2, grossSales: 218400, averageCompletionMinutes: -198 }, productRanking: [{ name: '牛肉マーラータン', count: 182 }], storeBreakdown: [] },
  '/api/store/operations': { operation: { minimumPickupMinutes: 15, defaultMinimumPickupMinutes: 15, reservationsEnabled: true, acceptanceMode: 'auto', statusNote: '' } },
  '/api/store/pos': { access, selectedStoreId: stores[0].id, brands, categories, items: [...items, { ...items[0], id: 'information-card', name: '【※こちら商品ではありません】ブランド紹介', basePrice: 0 }], optionGroups, tableCheckoutRequests: [], todaySummary: { orderCount: 0, total: 0, average: 0, latestOrders: [] } },
  '/api/store/pos/reconciliation': { businessDate: now.slice(0, 10), activeSession: { id: 'cash-test', openingAmount: 50000, cashSales: 10000, expectedCashAmount: 60000, openedAt: now, openedByName: '検証担当', businessDate: now.slice(0, 10) }, sessions: [], movements: [], activeCashResponsibleEmployees: [] },
  '/api/store/menu-settings': { access, selectedStoreId: stores[0].id, brands, categories, items, options: optionGroups.flatMap(g => g.options.map(o => ({ ...o, groupId: g.id, groupName: g.name, groupKey: g.groupKey, brandId: g.brandId, brandName: 'まぁ麻', groupDisplayNames: {}, displayNames: {}, stockStatus: 'available', isAvailable: true, platformAvailability: {}, statusNote: '' }))) },
  '/api/store/inventory-history': { reports },
  '/api/timecard': { currentEmployeeRole: 'owner', currentEmployeeId: 'employee-0', stores, selectedStoreId: stores[0].id, employees: Array.from({ length: 24 }, (_, i) => ({ id: `employee-${i}`, name: `テストスタッフ ${i + 1}`, role: 'staff', storeIds: [stores[0].id] })), latestPunches: [{ employeeId: 'employee-1', punchType: 'clock_in', punchedAt: now }] },
  '/api/store/procurement-receiving': { confirmations: [{ id: 'empty', type: 'batch', batchId: 'test-batch-empty', orderId: 'PO-TEST-001', storeName: stores[0].name, label: 'PO-TEST-001-1', status: 'delivered', deliveredLabel: '09/15 12:00', items: [] }, { id: 'valid', type: 'batch', batchId: 'test-batch-valid', orderId: 'PO-TEST-002', storeName: stores[0].name, label: 'PO-TEST-002-1', status: 'delivered', deliveredLabel: '09/15 12:30', items: [{ id: 'delivery-item', name: '牛肉スライス', actualQuantity: 2, unit: 'kg' }] }] },
  '/api/procedures': { procedures: Array.from({ length: 10 }, (_, i) => ({ id: `book-${i}`, title: `開店作業 ${i + 1}`, category: '店舗手順', summary: '開店前の確認手順', brand: 'まぁ麻', stores, versionNumber: 1, steps: [{ id: 'step-1', title: '作業場所を確認', instruction: '作業場所を清潔にしてください。', products: [] }, { id: 'step-2', title: '材料を確認', instruction: '準備する材料を確認してください。', products: [] }] })) },
  '/api/store/seats': { store: stores[0], stores, targets: [], sharedTables: [] },
  '/api/store/display/pickup': { access, selectedStoreId: stores[0].id, preparing: orders.slice(0, 27), ready: [] },
  '/api/store/display/courier': { access, selectedStoreId: stores[0].id, preparing: [], ready: [] },
  '/api/store/display/kitchen': { access, selectedStoreId: stores[0].id, tasks: [], areas: [] }
};

const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import Home from './app/store/page';import Orders from './app/store/orders/page';import Pos from './app/store/pos/page';import Availability from './app/store/menu/page';import History from './app/store/menu/inventory-history/page';import Timecard from './app/store/timecard/page';import Receiving from './app/store/receiving/page';import Procedures from './app/store/procedures/page';import Seats from './app/store/seats/page';import Pickup from './app/store/display/pickup/page';import Kitchen from './app/store/display/kitchen/page';import Courier from './app/store/display/courier/page';
import {OsTranslationProvider} from './app/os/components/OsTranslationProvider';import {FloatingFeedbackButton} from './components/feedback/FloatingFeedbackButton';import {defaultStoreModuleSettings} from './lib/module-setting-defaults';
if(new URLSearchParams(location.search).get('role')==='store_terminal'){window.__fixtures['/api/auth/me'].employee.role='store_terminal';window.__fixtures['/api/os/store-context'].canSelectStore=false;window.__fixtures['/api/timecard'].currentEmployeeRole='store_terminal';}
if(new URLSearchParams(location.search).get('reception')==='force_closed'){window.__fixtures['/api/store/operations'].operation.acceptanceMode='force_closed';}
const nativeFetch=window.fetch; window.__requests=[];window.fetch=async(input,init)=>{const url=new URL(String(input),location.href);if(!url.pathname.startsWith('/api/'))return nativeFetch(input,init);window.__requests.push({path:url.pathname,method:init?.method||'GET',body:init?.body});if(init?.method&&init.method!=='GET')return Response.json({error:'Fixture does not persist operations'},{status:409});if(url.pathname==='/api/settings')return Response.json({settings:defaultStoreModuleSettings});return Response.json(window.__fixtures[url.pathname]||{});};
const pages={'/store':Home,'/store/orders':Orders,'/store/pos':Pos,'/store/menu':Availability,'/store/menu/inventory-history':History,'/store/timecard':Timecard,'/store/receiving':Receiving,'/store/procedures':Procedures,'/store/seats':Seats,'/store/display/pickup':Pickup,'/store/display/kitchen':Kitchen,'/store/display/courier':Courier};const Page=pages[location.pathname]||Home; createRoot(document.getElementById('root')).render(<OsTranslationProvider><Page/><FloatingFeedbackButton/></OsTranslationProvider>);`;
const compiler = await context({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' }, plugins: [{ name: 'fixture-navigation', setup(b) { b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const usePathname=()=>location.pathname; export const useRouter=()=>({push:(p)=>location.assign(p),replace:(p)=>location.replace(p)});', loader: 'js' })); } }] });
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/fixture.js') { const bundle = await compiler.rebuild(); res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
  if (path === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(`${await readFile('app/globals.css', 'utf8')}\n${await readFile('app/store/store-responsive.css', 'utf8')}`); return; }
  if (path.startsWith('/locales/') || path.endsWith('.svg')) { try { const content = await readFile(resolve(root, 'public', path.slice(1))); res.setHeader('Content-Type', path.endsWith('.svg') ? 'image/svg+xml' : 'application/json'); res.end(content); } catch { res.writeHead(404).end(); } return; }
  if (path.startsWith('/api/')) { res.writeHead(403).end('Fixture only'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.__errors=[];window.addEventListener('error',e=>window.__errors.push({message:e.message,stack:e.error?.stack,file:e.filename,line:e.lineno}));window.__fixtures=${JSON.stringify(fixtures).replaceAll('<', '\\u003c')}</script><script src="/fixture.js"></script></body></html>`);
});
if (!process.argv.includes('--check')) {
  await new Promise(ok => server.listen(4178, '127.0.0.1', ok));
  console.log('Store UI fixture server: http://127.0.0.1:4178/store (synthetic data, writes blocked)');
}
if (process.argv.includes('--serve')) await new Promise(() => {});
else {
  await mkdir(output, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const width of process.argv.includes('--interactions') ? [] : [1440, 1024, 768, 390, 360]) {
      await page.setViewport({ width, height: ({ 1440: 900, 1024: 768, 768: 1024, 390: 844, 360: 800 })[width] });
      for (const route of ['store', 'store/orders', 'store/pos', 'store/menu', 'store/menu/inventory-history', 'store/timecard', 'store/receiving', 'store/procedures', 'store/seats', 'store/display/pickup', 'store/display/kitchen', 'store/display/courier']) {
        await page.goto(`http://127.0.0.1:4178/${route}`, { waitUntil: 'networkidle0' });
        assert.ok(await page.$('main'), `Page did not render: ${route}; ${JSON.stringify(await page.evaluate(() => window.__errors))}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Horizontal overflow: ${route} @ ${width}`);
        await page.screenshot({ path: `${output}/${route.replaceAll('/', '-')}-${width}.png` });
      }
      console.log(`PASS: 12 routes at ${width}px`);
    }
    const visit = async (route, width = 390, height = ({ 1440: 900, 1024: 768, 768: 1024, 390: 844, 360: 800 })[width]) => {
      await page.setViewport({ width, height });
      await page.goto(`http://127.0.0.1:4178/${route}`, { waitUntil: 'networkidle0' });
    };
    const onScreen = async selector => page.$eval(selector, e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight + 1; });
    for (const width of [1440, 1024, 768, 390, 360]) {
      await visit('store', width);
      assert.equal(await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('.user-panel > *')].filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect());
        return boxes.some((a, i) => boxes.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
      }), false, `Header overlap at ${width}`);
      assert.ok(await onScreen('.os-language-picker select'));
      await page.select('.os-language-picker select', 'zh-Hant');
      await page.waitForFunction(() => document.documentElement.lang === 'zh-Hant');
      await page.select('.os-language-picker select', 'ja');

      await visit('store/pos', width);
      assert.equal(await page.$$eval('.store-pos-item-button', elements => elements.some(e => e.textContent.includes('こちら商品ではありません'))), false);
      await page.$eval('.store-pos-item-button', e => e.scrollIntoView({ block: 'center' }));
      await page.click('.store-pos-item-button');
      await page.waitForSelector('.store-pos-option-add');
      assert.ok(await onScreen('.store-pos-option-add'), `POS confirmation offscreen at ${width}`);
      assert.ok(await onScreen('.store-pos-option-head button'), `POS close offscreen at ${width}`);
      await page.select('.store-pos-option-navigation select', 'group-5');
      await page.type('.store-pos-option-navigation input', '6-2');
      await page.waitForFunction(() => document.querySelectorAll('.store-pos-option-choice').length === 2);
      await page.click('.store-pos-option-choice > button');
      await page.select('.store-pos-option-navigation select', '');
      await page.$eval('.store-pos-option-navigation input', e => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.$eval('.store-pos-option-body', e => e.scrollTo(0, e.scrollHeight));
      assert.ok(await onScreen('.store-pos-option-add'));
      await page.screenshot({ path: `${output}/pos-options-${width}.png` });
      await page.click('.store-pos-option-add');
      await page.waitForFunction(() => !document.querySelector('.store-pos-option-overlay'));
      if (width <= 900) {
        await page.click('.store-pos-floating-checkout button');
        await page.waitForSelector('.store-pos-cart-panel.is-open');
        assert.ok(await onScreen('.store-pos-cart-back'));
        assert.match(await page.$eval('.store-pos-cart-panel', e => e.textContent), /新鮮な野菜 6-2/);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.store-pos-cart-panel.is-open'));
      }
      console.log(`PASS: header, translation, POS search/selection/confirmation/cart at ${width}px`);
    }
    await visit('store/orders');
    assert.equal(await page.$$('.store-order-card').then(items => items.length), 182);
    assert.ok(await onScreen('.store-orders-controls'));
    const cards = await page.$$('.store-order-card');
    await cards[80].scrollIntoView();
    const savedScroll = await page.evaluate(() => scrollY);
    await cards[80].click();
    await page.waitForSelector('.store-orders-page.is-detail-open');
    assert.ok(await onScreen('.store-order-detail-back'));
    await page.screenshot({ path: `${output}/orders-detail-390.png` });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.store-order-detail')), true);
    await page.click('.store-order-detail-back');
    await page.waitForFunction(() => !document.querySelector('.store-orders-page.is-detail-open'));
    assert.equal(await page.evaluate(() => scrollY), savedScroll, 'Order queue scroll should survive closing details');
    assert.equal(await page.$$('.store-order-card').then(items => items.length), 182);
    await page.click('.store-orders-performance-disclosure > summary');
    assert.match(await page.$eval('.store-order-performance', e => e.textContent), /-198分/, 'Pre-operation duration retained');

    await visit('store/menu/inventory-history');
    assert.equal(await page.$$('.store-inventory-history-row').then(items => items.length), 20);
    assert.match(await page.$eval('.store-inventory-history-operation strong', e => e.textContent), /検証用野菜/);
    await page.select('.store-history-filters select', 'failed');
    assert.equal(await page.$$('.store-inventory-history-row').then(items => items.length), 20);
    await page.click('.store-history-pagination button:last-child');
    await page.waitForFunction(() => document.querySelector('.store-history-pagination').textContent.includes('2 / 3'));
    await page.type('.store-history-filters input', '見つからない商品');
    await page.waitForFunction(() => document.querySelectorAll('.store-inventory-history-row').length === 0);

    await visit('store/timecard');
    await page.click('.timecard-employee-card:nth-child(2)');
    assert.match(await page.$eval('.timecard-status', e => e.textContent), /テストスタッフ 2 \/ 勤務中/);
    assert.equal(await page.$eval('.timecard-punch-button:first-child', e => e.disabled), true);
    assert.ok(await onScreen('.timecard-punch-actions'));
    await visit('store/timecard?role=store_terminal');
    assert.ok(await onScreen('.os-language-picker select'));
    assert.equal(await page.$('.os-global-store-picker'), null);

    await visit('store/receiving');
    assert.equal(await page.$eval('.order-row:first-child .primary-button', e => e.disabled), true);
    assert.equal(await page.$eval('.order-row:nth-child(2) .primary-button', e => e.disabled), false);
    await visit('store/procedures');
    await page.click('.procedure-reader-mobile-tools button:first-child');
    await page.click('.procedure-reader-book:nth-child(2)');
    assert.equal(await page.$eval('#procedure-directory', e => getComputedStyle(e).display), 'none');
    assert.match(await page.$eval('.procedure-reader-heading', e => e.textContent), /開店作業 1/);
    await visit('store/seats');
    assert.ok(await onScreen('.seat-list-targets button'));
    await page.click('.seat-list-targets button');
    await page.waitForSelector('.seat-action-sheet');
    assert.match(await page.$eval('.seat-action-sheet', e => e.textContent), /Aテーブル/);
    await visit('store/display/pickup', 390, 844);
    assert.ok(await onScreen('.store-pickup-pages button'));
    const firstCode = await page.$eval('.store-pickup-code-grid strong', e => e.textContent);
    await page.click('.store-pickup-pages button[aria-label="次のページ"]');
    assert.notEqual(await page.$eval('.store-pickup-code-grid strong', e => e.textContent), firstCode);
    assert.equal(await page.$('.floating-feedback'), null);
    assert.deepEqual(errors, [], 'Browser errors');
    console.log('PASS: order scroll return, unchanged duration, history filters/pages, employee identity, terminal language, empty receipt, procedures, seat selection and pickup paging');
  } finally { await browser.close(); if (server.listening) server.close(); await compiler.dispose(); }
}
