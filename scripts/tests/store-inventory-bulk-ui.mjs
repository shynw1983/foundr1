// Real Store components, synthetic API persistence. Never connects to a database or delivery platform.
// node scripts/tests/store-inventory-bulk-ui.mjs --serve, then --check
import { context } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const output = resolve(root, process.env.INVENTORY_TEST_OUTPUT || 'outputs/store-inventory-bulk-20260927');
const port = Number(process.env.INVENTORY_TEST_PORT || 4189);
const base = `http://127.0.0.1:${port}`;
const stores = [{ id: 'test-store', name: '清水店（検証用）' }];
const brands = [{ id: 'brand-a', name: 'まぁ麻' }, { id: 'brand-b', name: 'nanacha' }];
const categories = ['マーラータン', 'サイドメニュー'].map((name, i) => ({ id: `category-${i}`, brandId: 'brand-a', name, sortOrder: i }));
const items = Array.from({ length: 40 }, (_, i) => ({
  id: `item-${i}`, brandId: i === 39 ? 'brand-b' : 'brand-a', brandName: i === 39 ? 'nanacha' : 'まぁ麻',
  name: `野菜マーラータン ${i + 1}`, displayNames: { zh: `蔬菜麻辣烫 ${i + 1}`, 'zh-Hant': `蔬菜麻辣燙 ${i + 1}` },
  category: categories[i % 2].name, promotionPrefix: '', promotionPrefixDisplayNames: {}, websitePresentation: {},
  imageUrl: '', basePrice: i === 0 ? 0 : 1000, priceOverride: null, websiteEnabled: true, posEnabled: true, deliveryEnabled: true,
  isAvailable: true, stockStatus: 'available', platformAvailability: {}, statusNote: ''
}));
const options = Array.from({ length: 36 }, (_, i) => ({
  id: `option-${i}`, brandId: 'brand-a', brandName: 'まぁ麻', groupId: `group-${i % 2}`, groupKey: `group-${i % 2}`,
  groupName: i % 2 ? 'きのこ' : '野菜', groupDisplayNames: { zh: i % 2 ? '菌菇' : '蔬菜' },
  name: `追加具材 ${i + 1}`, displayNames: { zh: `新鲜配菜 ${i + 1}`, 'zh-Hant': `新鮮配菜 ${i + 1}` },
  priceDelta: 100, isAvailable: true, stockStatus: 'available', platformAvailability: {}, statusNote: ''
}));
const access = { role: 'owner', stores, canUseAllStoreView: true };
const menu = { access, selectedStoreId: stores[0].id, brands, categories, items, options };
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import Page from './app/store/menu/page';
import {OsTranslationProvider} from './app/os/components/OsTranslationProvider';
import {StoreInventorySyncStatus} from './app/store/components/StoreInventorySyncStatus';
const params=new URLSearchParams(location.search);
localStorage.setItem('foundr1-os-language',params.get('lang')||'ja');
localStorage.setItem('foundr1-os-language-preference','manual');
window.__menu=${JSON.stringify(menu)};
window.__menu.settings={availability:{targets:{items:true,options:true},optionDisplayMode:params.get('optionMode')||'separate_category',allowStorePriceEdit:false,allowChannelToggle:false}};
if(params.has('noOptions'))window.__menu.options=[];
if(params.has('singleBrand'))window.__menu.brands=window.__menu.brands.slice(0,1);
window.__writes=[]; window.__reads=0; window.__failKeys=[]; window.__inflight=0; window.__maxInflight=0; window.__runs=[];
window.__menuEvents=[]; window.__refreshMenu=()=>window.__menuEvents.forEach(fn=>fn());
const nativeFetch=window.fetch;
window.fetch=async (input,init={})=>{
 const url=new URL(String(input),location.href),path=url.pathname;
 if(!path.startsWith('/api/'))return nativeFetch(input,init);
 if(path==='/api/store/menu-settings'){
  window.__reads++;
  if(window.__failRead)throw new TypeError('offline');
  const data=structuredClone(window.__menu);
  if(window.__holdRead)await new Promise(resolve=>window.__releaseRead=resolve);
  return Response.json(data);
 }
 if(init.method==='POST' && path==='/api/store/display/kitchen/inventory'){
  const body=JSON.parse(init.body); window.__writes.push(body); window.__inflight++; window.__maxInflight=Math.max(window.__maxInflight,window.__inflight);
  await new Promise(resolve=>setTimeout(resolve,window.__writeDelay||80));
  window.__inflight--;
  if(window.__failKeys.includes(body.targetKind+':'+body.targetId))return Response.json({error:'Fixture: permission denied'},{status:403});
  const target=(body.targetKind==='item'?window.__menu.items:window.__menu.options).find(t=>t.id===body.targetId);
  if(!target)return Response.json({error:'Missing exact ID'},{status:409});
  target.isAvailable=body.isAvailable;target.stockStatus=body.stockStatus;target.platformAvailability={};
  const targetStates=[{kind:body.targetKind,targetId:body.targetId,isAvailable:body.isAvailable}];
  if(body.targetId==='item-0'){
   Object.assign(window.__menu.options[0],{isAvailable:body.isAvailable,stockStatus:body.stockStatus});
   targetStates.push({kind:'option',targetId:'option-0',isAvailable:body.isAvailable});
  }
  const syncRun={id:'run-'+window.__writes.length,itemLabel:body.feedbackLabel,isAvailable:body.isAvailable,source:'store',createdAt:new Date().toISOString(),platforms:[{commandId:'cmd-'+window.__writes.length,platform:'uber_eats',status:'queued'}]};
  window.__runs=[syncRun];window.__refreshMenu();
  return Response.json({ok:true,targetStates,targets:targetStates,syncRun});
 }
 if(init.method && init.method!=='GET')return Response.json({error:'Other writes are blocked'},{status:403});
 if(path==='/api/store/realtime-config')return Response.json({key:'fixture',cluster:'fixture',menuChannel:'fixture-menu'});
 if(path==='/api/store/menu-sync-runs')return Response.json({runs:window.__runs});
 if(path==='/api/store/context')return Response.json({access:window.__menu.access,selectedStoreId:window.__menu.selectedStoreId});
 if(path==='/api/auth/me')return Response.json({employee:{id:'test-user',name:'検証担当',role:'owner'}});
 if(path==='/api/os/store-context')return Response.json({canSelectStore:false,stores:${JSON.stringify(stores)},selectedStoreId:'test-store'});
 if(path==='/api/store/inventory-history')return Response.json({reports:[]});
 if(path==='/api/notifications')return Response.json({notifications:[],unreadCount:0});
 if(path.includes('connection'))return Response.json({});
 return Response.json({});
};
createRoot(document.getElementById('root')).render(<OsTranslationProvider><StoreInventorySyncStatus/><Page/></OsTranslationProvider>);`;

let compiler;
let server;
if (!process.argv.includes('--check')) {
  compiler = await context({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false,
    outdir: '/private/tmp/store-inventory-bulk-fixture', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'fixture-realtime', setup(build) {
      build.onResolve({ filter: /shared-pusher-client$/ }, () => ({ path: 'pusher', namespace: 'fixture' }));
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: path === 'pusher'
        ? "export const acquireSharedPusher=()=>({subscribe:()=>({bind:(event,fn)=>{if(event==='menu.updated')window.__menuEvents.push(fn)},unbind:(event,fn)=>{window.__menuEvents=window.__menuEvents.filter(f=>f!==fn)}}),disconnect:()=>{}})"
        : "export const usePathname=()=>location.pathname;export const useRouter=()=>({push:p=>location.assign(p),replace:p=>location.replace(p)})" }));
    } }]
  });
  const bundle = await compiler.rebuild();
  server = createServer(async (request, response) => {
    const path = new URL(request.url, base).pathname;
    if (path === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(f => f.path.endsWith('.js')).text); return; }
    if (path === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(`${await readFile('app/globals.css', 'utf8')}\n${await readFile('app/store/store-responsive.css', 'utf8')}`); return; }
    if (path.startsWith('/locales/') || path.endsWith('.svg')) {
      try { response.setHeader('Content-Type', path.endsWith('.svg') ? 'image/svg+xml' : 'application/json'); response.end(await readFile(resolve(root, 'public', path.slice(1)))); }
      catch { response.writeHead(404).end(); } return;
    }
    if (path.startsWith('/api/')) { response.writeHead(403).end('Only synthetic requests allowed'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  console.log(`Isolated Store inventory: ${base}/store/menu`);
}
if (process.argv.includes('--serve')) await new Promise(() => {});

await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const click = async selector => { await page.waitForSelector(selector); await page.$eval(selector, el => el.scrollIntoView({ block: 'center' })); await page.click(selector); };
const pause = () => new Promise(resolve => setTimeout(resolve, 200));
const visit = async (width = 390, lang = 'ja', fixture = '') => {
  await page.setViewport({ width, height: width >= 1000 ? 900 : 844 });
  await page.goto(`${base}/store/menu?lang=${lang}&${fixture}`, { waitUntil: 'networkidle0' });
  await page.select('.os-language-picker select', lang);
  await page.waitForFunction(language => document.documentElement.lang === language, {}, lang);
  await page.waitForFunction(() => document.querySelector('.store-menu-list-tools button')?.disabled === false);
};
const selectAllCategory = async () => {
  if (await page.$('.store-menu-kind-switch')) await click('.store-menu-kind-switch button:last-child');
  await click('.store-menu-category-panel button:first-child');
};
const enterSelection = async () => click('.store-menu-list-tools button');
const checkRow = async n => click(`.store-menu-item-list > .store-inventory-selection-row:nth-child(${n})`);
const writes = () => page.evaluate(() => window.__writes);
const apply = async available => {
  await click(`.store-inventory-bulk-submit button:${available ? 'last' : 'first'}-child`);
  await page.waitForSelector('dialog[open]');
  await click('.store-inventory-bulk-dialog-actions button:last-child');
  await page.waitForFunction(() => document.querySelector('.store-inventory-bulk-result') && !document.querySelector('.store-inventory-bulk-secondary button:last-child').disabled);
};
try {
  await visit(360, 'zh-Hans', 'singleBrand');
  assert.equal(await page.$eval('.store-menu-kind-switch button:first-child', el => el.getAttribute('aria-pressed')), 'true', 'First visit opens options instead of the first zero-price product');
  assert.equal(await page.$('.store-menu-category-select'), null, 'No mobile category dropdown');
  assert.equal(await page.$('.store-menu-brand'), null, 'A single brand needs no brand picker');
  assert.equal(await page.$eval('.store-menu-status-filter button:first-child small', el => el.textContent), '36');
  assert.equal(await page.$eval('.store-menu-kind-switch button:first-child', el => el.getBoundingClientRect().height >= 44), true);
  await page.screenshot({path: `${output}/filters-options-360.png`});
  await page.type('.store-menu-search input', '17'); await pause();
  assert.equal(await page.$$eval('.store-menu-option-group', els => els.length), 1);
  assert.equal(await page.$eval('.store-menu-option-group', el => el.open), true, 'Searching opens the matching group');
  await page.screenshot({path: `${output}/filters-search-360.png`});
  assert.equal((await writes()).length, 0, 'Browsing and search never mutate inventory');

  await visit(360, 'zh-Hans'); await selectAllCategory();
  assert.equal(await page.$eval('.store-menu-status-filter button:first-child small', el => el.textContent), '39');
  assert.equal(await page.$eval('.store-menu-status-filter .is-available small', el => el.textContent), '39', 'Product status counts exclude options');
  await click('.store-menu-category-panel button:last-child');
  const category = await page.$eval('.store-menu-category-panel button[aria-pressed="true"] span', el => el.textContent);
  await visit(360, 'zh-Hans');
  assert.equal(await page.$eval('.store-menu-kind-switch button:last-child', el => el.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('.store-menu-category-panel button[aria-pressed="true"] span', el => el.textContent), category, 'Reopening preserves the product category');
  await page.screenshot({path: `${output}/filters-products-360.png`});
  await click('.store-menu-kind-switch button:first-child');
  await page.select('.store-menu-brand select', 'brand-b');
  assert.equal(await page.$eval('.store-menu-kind-switch button:last-child', el => el.getAttribute('aria-pressed')), 'true', 'Brands with no options open all products');
  await page.select('.store-menu-brand select', 'brand-a');
  assert.equal(await page.$eval('.store-menu-kind-switch button:first-child', el => el.getAttribute('aria-pressed')), 'true', 'Each brand retains its own view');
  await page.evaluate(() => {
    window.__menu.selectedStoreId = 'other-store';
    window.__menu.access.stores.push({id:'other-store',name:'別店舗'});
    localStorage.setItem('foundr1-store-inventory-category:other-store:brand-a', '');
    window.__refreshMenu();
  }); await pause();
  assert.equal(await page.$eval('.store-menu-kind-switch button:last-child', el => el.getAttribute('aria-pressed')), 'true', 'A different store restores its own view');

  await visit(390, 'ja', 'optionMode=hidden');
  assert.equal(await page.$('.store-menu-kind-switch'), null, 'Hidden option configuration has no option shortcut');
  assert.equal(await page.$('.store-menu-option-group'), null);
  await visit(390, 'ja', 'optionMode=mixed');
  assert.equal(await page.$('.store-menu-kind-switch'), null);
  assert.equal(await page.$eval('.store-menu-status-filter button:first-child small', el => el.textContent), '75', 'Mixed mode still includes both target types');
  await visit(390, 'ja', 'noOptions');
  assert.equal(await page.$eval('.store-menu-kind-switch button:last-child', el => el.getAttribute('aria-pressed')), 'true', 'Missing options fall back to all products');
  await page.evaluate(() => localStorage.setItem('foundr1-store-inventory-category:test-store:brand-a', 'deleted-category'));
  await visit();
  assert.equal(await page.$eval('.store-menu-kind-switch button:first-child', el => el.getAttribute('aria-pressed')), 'true', 'Stale categories fall back to an available view');
  console.log('PASS: direct mobile filters, option default, search expansion, scoped counts, brand/store persistence and configured mode fallbacks');

  await enterSelection();
  await click('.store-menu-option-group:first-child .store-inventory-group-select');
  await selectAllCategory(); await checkRow(2);
  await click('.store-menu-kind-switch button:first-child');
  assert.equal(await page.$$eval('.store-inventory-selection-row input:checked', nodes => nodes.length), 18, 'Switching target views retains selection');
  await click('.store-inventory-bulk-submit button:first-child');
  await page.waitForSelector('dialog[open]');
  assert.equal(await page.$$eval('dialog li', nodes => nodes.length), 19, 'Confirmation includes selected products and options across views');
  await click('.store-inventory-bulk-dialog-actions button:first-child');
  assert.equal((await writes()).length, 0);
  console.log('PASS: cross-view multiselect, complete confirmation and no writes on cancel');

  for (const width of [360, 768, 1440]) {
    await visit(width, width === 360 ? 'zh-Hans' : width === 768 ? 'zh-Hant' : 'ja');
    await selectAllCategory();
    await page.screenshot({path: `${output}/filters-products-${width}.png`});
    assert.equal(await page.$$eval('.store-menu-category-panel button', buttons => buttons.every(el => { const r=el.getBoundingClientRect(); return r.height>=44 && r.left>=0 && r.right<=innerWidth; })), true, 'Categories are tappable without a dropdown or page overflow');
    await enterSelection(); await checkRow(1); await checkRow(16);
    const y = await page.evaluate(() => scrollY);
    assert.ok(y > 300, 'Exercise selection from below the fold');
    await page.evaluate(() => window.__refreshMenu()); await pause();
    assert.equal(await page.evaluate(() => scrollY), y, 'Realtime reload preserves scroll');
    assert.equal(await page.$$eval('.store-inventory-selection-row input:checked', nodes => nodes.length), 2);
    assert.equal(await page.$eval('.store-menu-items-panel > .store-menu-list-head h2', el => el.textContent), width === 1440 ? 'すべての商品' : '全部商品');
    await page.screenshot({ path: `${output}/selection-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
    assert.equal(await page.$eval('.store-inventory-bulk-submit', el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true);
    await click('.store-inventory-bulk-submit button:first-child');
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.$$eval('dialog li', nodes => nodes.length), 2);
    await page.screenshot({ path: `${output}/confirmation-${width}.png` });
    await click('.store-inventory-bulk-dialog-actions button:first-child');
    assert.equal((await writes()).length, 0, 'Cancel must not write');
    const anchorBefore = await page.$eval('.store-inventory-selection-row:nth-child(16)', el => el.getBoundingClientRect().top);
    await apply(false);
    assert.equal(new URL(page.url()).pathname, '/store/menu');
    assert.equal(await page.$$eval('.store-inventory-selection-row input:checked', nodes => nodes.length), 0);
    assert.ok(await page.evaluate(() => scrollY) > 300, 'Submitting keeps user in the list');
    const anchorAfter = await page.$eval('.store-inventory-selection-row:nth-child(16)', el => el.getBoundingClientRect().top);
    assert.ok(Math.abs(anchorBefore - anchorAfter) <= 2, `List anchor moved: ${anchorBefore} -> ${anchorAfter}`);
    assert.deepEqual((await writes()).map(body => body.targetId), ['item-0', 'item-15']);
    for (const body of await writes()) {
      assert.equal(body.source, 'sales_status'); assert.equal(body.action, 'apply'); assert.equal(body.storeId, 'test-store');
      assert.equal(body.targetKind, 'item'); assert.equal(body.resetPlatformOverrides, true); assert.equal(body.isAvailable, false);
      assert.deepEqual(body.platforms, ['uber_eats', 'rocket_now', 'demae_can']);
    }
    assert.equal(await page.evaluate(() => window.__maxInflight), 1, 'Writes are serial');
    assert.equal(await page.evaluate(() => window.__menu.options[0].stockStatus), 'unavailable', 'Linked response is persisted');
    const overlap = await page.evaluate(() => { const a = document.querySelector('.store-inventory-bulk-bar').getBoundingClientRect(), b = document.querySelector('.store-menu-sync-feedback')?.getBoundingClientRect(); return b && b.bottom > a.top; });
    assert.ok(!overlap, 'Sync dock does not cover bulk actions');
    console.log(`PASS: ${width}px selection, cancel, submit, translation, scroll, API identity and sync dock`);
  }

  await visit(); await selectAllCategory(); await enterSelection(); await checkRow(1); await checkRow(2);
  await page.evaluate(() => { window.__failKeys = ['item:item-1']; });
  await apply(false);
  assert.equal(await page.$$eval('.store-inventory-selection-row input:checked', nodes => nodes.length), 1);
  assert.match(await page.$eval('.store-inventory-bulk-result', el => el.textContent), /permission denied/);
  await page.evaluate(() => { window.__failKeys = []; });
  await apply(true);
  assert.deepEqual((await writes()).map(body => body.targetId), ['item-0', 'item-1', 'item-1']);
  assert.equal((await writes()).at(-1).isAvailable, true);
  console.log('PASS: partial failure, failed-only retry, restore direction');

  await visit(); await selectAllCategory(); await enterSelection(); await checkRow(2);
  await page.type('.store-menu-search input', '17'); await pause();
  await click('.store-inventory-selection-tools button');
  assert.match(await page.$eval('.store-inventory-bulk-summary', el => el.textContent), /2/);
  await apply(false);
  assert.deepEqual((await writes()).map(body => body.targetId), ['item-1', 'item-16'], 'Filtered select-all keeps hidden selection');
  assert.equal(await page.$eval('.store-menu-search input', el => el.value), '17');
  await page.select('.store-menu-controls > label select', 'brand-b');
  assert.equal(await page.$$eval('.store-inventory-selection-row input:checked', nodes => nodes.length), 0);
  console.log('PASS: filtered select-all, cross-search selection, search preservation and brand isolation');

  await visit(); await click('.store-menu-kind-switch button:first-child'); await enterSelection();
  await click('.store-menu-option-group:first-child .store-menu-option-group-title');
  await click('.store-menu-option-group:first-child .store-inventory-group-select');
  assert.equal(await page.$$eval('.store-menu-option-group:first-child input:checked', nodes => nodes.length), 18);
  await page.evaluate(() => window.__refreshMenu()); await pause();
  assert.equal(await page.$eval('.store-menu-option-group:first-child', el => el.open), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/options-390.png` });
  await apply(false);
  assert.equal((await writes()).length, 18);
  assert.ok((await writes()).every(body => body.targetKind === 'option'));
  assert.equal(await page.$eval('.store-menu-option-group:first-child', el => el.open), true);
  console.log('PASS: grouped options, group selection and expanded state after submit');

  await visit(); await selectAllCategory();
  await click('.store-menu-item-row:nth-child(15) .store-menu-status-actions button:last-child');
  await page.waitForFunction(() => window.__writes.length === 1 && !document.querySelector('.store-menu-head-actions button').disabled);
  assert.ok(await page.evaluate(() => scrollY) > 300, 'Single action keeps scroll');
  assert.equal(await page.$$eval('.store-menu-item-row', nodes => nodes.length), 39, 'All categories remain visible after single save');
  await page.evaluate(() => { window.__holdRead = true; window.__refreshMenu(); });
  await page.waitForFunction(() => typeof window.__releaseRead === 'function');
  await click('.store-menu-item-row:nth-child(15) .store-menu-status-actions button:first-child');
  await page.waitForFunction(() => window.__inflight === 1);
  await page.evaluate(() => { window.__holdRead = false; window.__releaseRead(); });
  await page.waitForFunction(() => window.__writes.length === 2 && !document.querySelector('.store-menu-head-actions button').disabled);
  assert.equal(await page.$eval('.store-menu-item-row:nth-child(15) .store-menu-status-actions button:first-child', el => el.classList.contains('is-on')), true);
  await page.evaluate(() => { window.__failRead = true; window.__refreshMenu(); }); await pause();
  assert.equal(await page.$$eval('.store-menu-item-row', nodes => nodes.length), 39, 'Read failure preserves the list');
  assert.ok(await page.$('.inline-alert'));
  console.log('PASS: single-operation scroll, stale read exclusion and failed refresh keeps content');
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(`PASS: all inventory interactions; screenshots in ${output}`);
} finally {
  await browser.close();
  server?.close();
  await compiler?.dispose();
}
