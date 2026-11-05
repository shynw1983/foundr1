// Runs the actual POS React page, translations, theme, IndexedDB, and print queue.
// All HTTP and native responses are synthetic; external requests are blocked.
import assert from 'node:assert/strict';
import{evaluatePosDiscounts,posCampaignDate}from'../../lib/pos-discount-campaigns.ts';
import {evaluatePosBowlBenefits,posBowlQuote} from '../../lib/pos-bowl-benefits.ts';
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
const item = { id: 'fixture-soup', brandId: brand.id, brandName: brand.name, name: '麻辣湯スープ', displayNames: { ja: '麻辣湯スープ' }, itemKind: 'buildable_product', category: 'スープ', imageUrl: '', basePrice: 800, priceOverride: null, posPricingMode: 'fixed', posWeightUnit: 'g', posWeightUnitPrice: null, isAvailable: true, variableSchema: {} };
const drink={...item,id:'canned-tea',name:'缶ウーロン茶',itemKind:'drink',productionType:'drink',category:'缶飲料',basePrice:300};
const bottle={...drink,id:'bottle-tea',name:'瓶ウーロン茶',category:'瓶飲料',basePrice:500};
const groups=[{id:'premium',brandId:brand.id,menuCatalogItemId:item.id,applicableCategories:[],groupKey:'topping',name:'追加',selectionType:'multiple',ruleJson:{minSelections:0,maxSelections:5},sortOrder:1,options:[{id:'beef',name:'牛筋50g',optionKey:'beef',applicableCategories:[],priceDelta:200,sortOrder:0}]}];
const printer = { deviceType: 'escpos_network', connectionType: 'lan', host: '127.0.0.2', port: 9100, identifier: '', paperWidth: '80mm', characterEncoding: 'shift_jis', cutPaper: true, openCashDrawer: true };
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';import{StoreThemeProvider}from'./app/store/components/StoreThemeProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
window.__prints=[];if(new URLSearchParams(location.search).get('bridge')==='yes')window.Foundr1Printer={isAvailable:()=>true,print:payload=>{window.__prints.push(JSON.parse(payload));return JSON.stringify({ok:true})}};
createRoot(document.getElementById('root')).render(<OsTranslationProvider><StoreThemeProvider employeeId="fixture-employee"><Pos/></StoreThemeProvider></OsTranslationProvider>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', charset: 'utf8', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'local-fixture-only', setup(b) {
  b.onResolve({ filter: /^next\/(link|navigation)$/ }, a => ({ path: a.path, namespace: 'fixture-navigation' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-navigation' }, a => ({ contents: a.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` : `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`, loader: 'js', resolveDir: source }));
  b.onResolve({ filter: /shared-pusher-client$/ }, a => ({ path: a.path, namespace: 'fixture-pusher' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-pusher' }, () => ({ contents: `export function acquireSharedPusher(){return{connection:{bind(){}},subscribe(){return{name:'private-checkout-fixture',bind(event,fn){(globalThis.__posEventHandlers ||= {})[event] ||= [];globalThis.__posEventHandlers[event].push(fn);if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(){}}},unsubscribe(){},disconnect(){}}}`, loader: 'js' }));
} }] });
const css = await readFile(join(source, 'app/globals.css'), 'utf8') + '\n' + await readFile(join(source, 'app/store/store-responsive.css'), 'utf8') + '\n' + (bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text || '');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
let settings, posts, rejectCheckout, checkoutResponses, customerDisplayPosts, serverPrintContract,discountRules=[],clockOffset=0;
const bowl=()=>({bowlDefaultChoice:'discount',key:'bowl',name:'1杯1000円特典',applicationMode:'campaign',campaignBasis:'bowl_choice',enabled:true,startsOn:'',endsOn:'',minimumSubtotal:1000,discountType:'percent',discountValue:10,targetScope:'all',targetValue:'',giftCategories:[{brandId:brand.id,category:'缶飲料'}],giftItemIds:[],giftOptionIds:["beef"],giftButtonLabel:'ドリンク無料',stampEligible:false,allowCouponCombination:false});
const auto=()=>({key:'campaign',name:'期間限定200円OFF',applicationMode:'campaign',enabled:true,startsOn:posCampaignDate(),endsOn:posCampaignDate(),minimumSubtotal:800,discountType:'amount',discountValue:200,targetScope:'all',targetValue:'',stampEligible:false,allowCouponCombination:false});
const manual=()=>({key:'manual',name:'スタッフ割引300円',applicationMode:'manual',enabled:true,discountType:'amount',discountValue:300,targetScope:'all',targetValue:'',stampEligible:false,allowCouponCombination:false});
function reset({ enabled = false, receiptEnabled = false, reject = false, serverDocuments = false } = {}) {
  settings = { enabled, receiptEnabled, kitchenEnabled: false, receiptPrinter: printer, kitchenPrinter: printer, customerDisplay: { enabled: false } };
  posts = []; checkoutResponses = []; customerDisplayPosts = []; rejectCheckout = reject; serverPrintContract = serverDocuments;
}
reset();
const summary = { orderCount: 0, total: 0, average: 0, latestOrders: [] };
const openSession = { id: 'fixture-register', businessDate: '2026-10-20', status: 'open', openingAmount: 10000, expectedCashAmount: 10000, openedAt: '2026-10-20T01:00:00.000Z', cashSales: 0, cashIn: 0, cashOut: 0 };
const send = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
let summaryRequests=0,catalogReads=0,summaryFail=false,summaryDelay=0;
const serverErrors = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); return res.end(bundle.outputFiles.find(f => f.path.endsWith('.js')).text); }
    if (url.pathname.startsWith('/locales/os/')) return send(res, dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']);
    if (url.pathname === '/api/auth/me') return send(res, { employee: { id: 'fixture-employee', name: 'Fixture', role: 'owner' } });
    if (url.pathname === '/api/store/context') return send(res, { selectedStoreId: store.id, serverTime:new Date(Date.now()+clockOffset).toISOString(), access: { role: 'owner', canUseAllStoreView: true, stores: [store] } });
    if (url.pathname === '/api/store/theme') return send(res, { storeId: store.id, storeName: store.name, target: 'operations', theme: { mode: 'custom', primaryColor: '#006b7d', paletteVersion: 1 }, brand: null, canManageTheme: true, stores: [store], updatedAt: null, revision: null });
    if (url.pathname === '/api/store/realtime-config') return send(res, { key: 'fixture', cluster: 'fixture', channels: ['private-checkout-fixture'] });
    if(url.pathname==='/api/store/pos/summary'){summaryRequests++;const snap=structuredClone(summary),fail=summaryFail,delay=summaryDelay;if(delay)await new Promise(r=>setTimeout(r,delay));return send(res,fail?{error:'fixture failure'}:{selectedStoreId:store.id,todaySummary:snap},fail?503:200);}
    if (url.pathname === '/api/store/pos/operator') return send(res, { enabled: false, settings: { enabled: false, idleMinutes: 10 }, operator: null, employees: [], serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos/print-documents') {
      const documents = serverPrintContract && checkoutResponses.length ? ['kitchen', 'finishing', 'pickup', 'receipt'].map((kind, index) => ({ id: `fixture-document-${index}`, orderId: 'fixture-order', itemId: kind === 'receipt' ? null : 'fixture-order-item', kind, sequence: index, copyNumber: 1, pickupCode: '037', label: kind, createdAt: '2026-10-20T01:00:00.000Z', orderCreatedAt: '2026-10-20T01:00:00.000Z', state: 'pending', error: '', eligible: true, blockedReason: '', revision: 1, transport: null })) : [];
      return send(res, { version: 1, selectedStoreId: store.id, documents, summary: { pendingDocuments: documents.length, pendingOrders: documents.length ? 1 : 0, needsReview: 0, sendingDocuments: 0 }, hasMore: false, cursor: null, relay: { available: false, online: false }, serverNow: new Date().toISOString() });
    }
    if (url.pathname === '/api/store/pos/customer-display') {
      if (req.method === 'POST') { let raw = ''; for await (const part of req) raw += part; customerDisplayPosts.push(JSON.parse(raw)); }
      return send(res, { ok: true, streamId:'fixture-display-stream', state: { status: 'advertising', revision:0,weighingRevision: 0 }, customerDisplayMediaSettings: { weighing: { enabled: false } } });
    }
    if (url.pathname === '/api/store/pos/reconciliation') return send(res, { businessDate: '2026-10-20', activeSession: openSession, sessions: [openSession], movements: [], activeCashResponsibleEmployees: [] });
    if (url.pathname.includes('/device-relay')) return send(res, { stations: [], jobs: [], canManage: true, serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos' && req.method === 'POST') {
      let raw = ''; for await (const part of req) raw += part; const body = JSON.parse(raw); posts.push(body);
      if(rejectCheckout){discountRules=[auto()];discountRules[0].minimumSubtotal=1000;rejectCheckout=false;return send(res,{code:'POS_DISCOUNT_CHANGED',error:'割引・キャンペーン条件が変わりました。金額を確認し直してください。',storeId:store.id,discountPresets:discountRules,serverTime:new Date(Date.now()+clockOffset).toISOString()},409);}
      assert.equal(body.items.length,2);const lines=body.items.map(i=>({amount:800+(i.selectedOptions?.flatMap(g=>g.optionIds).length||0)*200,brandId:brand.id,category:'スープ',itemKind:'buildable_product',quantity:1,isBowl:true,choice:i.bowlBenefit}));
      const calculated=evaluatePosBowlBenefits(discountRules,'',lines,[{id:drink.id,name:drink.name,brandId:brand.id,category:drink.category,price:300,available:true,fixed:true}],Date.now()+clockOffset),total=1800-calculated.amount;assert.deepEqual(body.discountQuote,posBowlQuote(calculated));Object.assign(summary,{orderCount:summary.orderCount+1,total:summary.total+total,average:Math.round((summary.total+total)/(summary.orderCount+1))});
      const response = { ok: true, orderId: 'fixture-order', pickupCode: 'D-FIXTURE', servingTickets: [{ itemIndex: 0, pickupCode: '037', itemId: 'fixture-order-item', taskId: 'fixture-task' }], amount: total, subtotalAmount: 1800, taxableAmount: total, taxAmount: 49, taxRate: 8, priceTaxMode: 'tax_included', discountAmount: calculated.amount, discountName:calculated.preset?.name||'',discountPresetKey:calculated.appliedKey,couponDiscountAmount: 0, cashTenderedAmount: body.cashTenderedAmount, cashChangeAmount: body.cashTenderedAmount - total, receiptRequested: body.receiptRequested, todaySummary: structuredClone(summary) };
      if (serverPrintContract) response.printDocuments = { version: 1, orderId: 'fixture-order', mode: body.printMode, documentCount: 4, pendingCount: 4 };
      checkoutResponses.push(response); return send(res, response);
    }
    if (url.pathname === '/api/store/pos') {catalogReads++;return send(res, { selectedStoreId: store.id, serverTime:new Date(Date.now()+clockOffset).toISOString(), access: { role: 'owner', stores: [store] }, brands: [brand], items: [item,drink,bottle], categories: [], optionGroups: groups, posMenuRevision: 'fixture-revision', todaySummary: summary, posSettings: { dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: 'KOMOJU', priceTaxMode: 'tax_included', discountPresets: discountRules, printerSettings: settings, customerDisplayMediaSettings: { weighing: { enabled: false } } } });}
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
async function createPage({width=800}={}) {
 const context=await browser.createBrowserContext(),page=await context.newPage();currentPage=page;page.on('pageerror',e=>pageErrors.push(e.message));await page.setViewport({width,height:900});await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(base+'/')?r.continue():(externalRequests.push(r.url()),r.abort()));await page.goto(base+'/store/pos?lang=ja',{waitUntil:'domcontentloaded'});await page.waitForSelector('.store-pos-item-button:not(:disabled)');
 await clickVisible(page,'.store-pos-item-button');await page.waitForSelector('.store-pos-option-choice');await clickVisible(page,'.store-pos-option-choice');await clickVisible(page,'.store-pos-option-add');await page.waitForFunction(()=>!document.querySelector('.store-pos-option-overlay'));
 await clickVisible(page,'.store-pos-item-button');await page.waitForSelector('.store-pos-option-add');await clickVisible(page,'.store-pos-option-add');await page.waitForFunction(()=>!document.querySelector('.store-pos-option-overlay'));
 if(width<=900){await page.click('.store-pos-floating-checkout button');await page.waitForSelector('.store-pos-cart-panel.is-open');}
 await page.type('.store-pos-cash-payment input','3000');return {page,context};
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
 for(const width of [390,800,1366]) {
  reset({serverDocuments:true});discountRules=[bowl()];const {page,context}=await createPage({width});
  assert.equal(await page.$$eval('[data-pos-bowl-discount]',els=>els.length),1);assert.match(await page.$eval('.store-pos-cart-panel',el=>el.innerText),/対象金額未満/);
  assert.match(await page.$eval('.store-pos-total',el=>el.innerText),/1,700/);assert.equal(await page.$eval('[data-pos-bowl-discount]',el=>el.getAttribute('aria-pressed')),'true');
  assert(await page.$('[data-pos-bowl-auto]'));await clickVisible(page,'[data-pos-bowl-clear]');assert.match(await page.$eval('.store-pos-total',el=>el.innerText),/1,800/);await clickVisible(page,'[data-pos-bowl-auto-restore]');assert.match(await page.$eval('.store-pos-total',el=>el.innerText),/1,700/);results.push({name:'default-discount-opt-out-and-restore',width,passed:true});
  await clickVisible(page,'[data-pos-bowl-gift]');await page.waitForSelector('[data-pos-bowl-gift-item]');await page.waitForFunction(()=>document.querySelector('.store-pos-checkout').disabled);const options=await page.$$eval('[data-pos-bowl-gift-item] option',els=>els.map(el=>el.textContent));assert(!options.some(x=>x.includes('瓶')));await page.select('[data-pos-bowl-gift-item]','option:beef');await page.waitForSelector('[data-pos-bowl-applied-gift]');assert.match(await page.$eval('[data-pos-bowl-applied-gift]',el=>el.innerText),/牛筋50g/);assert.match(await page.$eval('.store-pos-total',el=>el.innerText),/1,800/);await pause(900);assert(customerDisplayPosts.some(p=>JSON.stringify(p).includes('牛筋50g')&&JSON.stringify(p).includes('¥0')));await page.select('[data-pos-bowl-gift-item]',drink.id);await page.waitForSelector('[data-pos-bowl-applied-gift]');await page.waitForFunction(()=>!document.querySelector('.store-pos-checkout').disabled);assert.match(await page.$eval('.store-pos-total',el=>el.innerText),/1,800/);assert.equal(await page.$eval('[data-pos-bowl-discount]',el=>el.getAttribute('aria-pressed')),'false');
  await page.waitForFunction(()=>document.querySelectorAll('[data-pos-bowl-applied-gift]').length===1);await pause(900);assert(customerDisplayPosts.some(p=>JSON.stringify(p).includes('缶ウーロン茶')));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:join(output,'bowl-benefits-'+width+'.png'),fullPage:true});await clickVisible(page,'.store-pos-checkout');await page.waitForFunction(()=>document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length===0);assert.equal(posts.length,1);assert.equal(posts[0].items[0].bowlBenefit.kind,'gift');assert.equal(posts[0].items[1].bowlBenefit,undefined);assert.equal(posts[0].offlineExpectedAmount,1800);results.push({name:'per-bowl-discount-gift-exclusive-threshold-picker-display-checkout',width,passed:true});await context.close();
 }
 for(const width of [390,800,1366])for(const mode of ['gift_only','discount_only']){
  reset({serverDocuments:true});discountRules=[{...bowl(),bowlBenefitMode:mode,...(mode==='gift_only'?{discountValue:0}:{giftItemIds:[],giftCategories:[],giftOptionIds:[]})}];const {page,context}=await createPage({width});
  if(mode==='gift_only'){assert.equal(await page.$('[data-pos-bowl-discount]'),null);await clickVisible(page,'[data-pos-bowl-gift]');await page.select('[data-pos-bowl-gift-item]','option:beef');await page.waitForSelector('[data-pos-bowl-applied-gift]');assert.match(await page.$eval('.store-pos-total',el=>el.innerText),/1,800/);}else{assert.equal(await page.$('[data-pos-bowl-gift]'),null);assert.match(await page.$eval('.store-pos-total',el=>el.innerText),/1,700/);}assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:join(output,mode+'-'+width+'.png'),fullPage:true});results.push({name:mode+'-only-valid-action-and-price',width,passed:true});await context.close();
 }
 reset({serverDocuments:true});discountRules=[bowl()];{const {page,context}=await createPage({width:800});await page.setOfflineMode(true);await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await page.waitForFunction(()=>document.querySelector('.store-pos-checkout').disabled);assert.equal(posts.length,0);results.push({name:'offline-prevents-unrecorded-benefit',passed:true});await context.close();}
 reset({serverDocuments:true});discountRules=[bowl()];Object.assign(summary,{orderCount:3,total:3000,average:1000,products:[{key:'bowl',name:'麻辣湯',isBowl:true,quantity:5,total:3000,average:600}]});{
  const {page,context}=await createPage({width:800});await clickVisible(page,'.store-pos-cart-back');await page.waitForFunction(()=>!document.querySelector('.store-pos-cart-panel').classList.contains('is-open'));const count=()=>page.$eval('[data-summary-count]',el=>el.textContent.trim());await page.waitForFunction(()=>document.querySelector('[data-summary-count]')?.textContent.trim()==='3 件');const reads=catalogReads;
  Object.assign(summary,{orderCount:4,total:4000,average:1000});await clickVisible(page,'[data-pos-summary-refresh]');await page.waitForFunction(()=>document.querySelector('[data-summary-count]')?.textContent.trim()==='4 件');assert.equal(catalogReads,reads);assert.equal(await page.$$eval('.store-pos-cart-list > .store-pos-cart-row',els=>els.length),2);results.push({name:'manual-summary-refresh-preserves-cart-and-menu',passed:true});
  Object.assign(summary,{orderCount:5,total:5000});await page.evaluate(()=>{for(const f of window.__posEventHandlers?.['order.created']||[])f({})});await page.waitForFunction(()=>document.querySelector('[data-summary-count]')?.textContent.trim()==='5 件');assert.equal(catalogReads,reads);results.push({name:'realtime-order-event-refreshes-payment-statistics',passed:true});
  Object.assign(summary,{orderCount:6,total:6000});await page.waitForFunction(()=>document.querySelector('[data-summary-count]')?.textContent.trim()==='6 件',{timeout:20000});results.push({name:'visible-page-15-second-fallback-refreshes-statistics',passed:true});
  summaryFail=true;await clickVisible(page,'[data-pos-summary-refresh]');await page.waitForFunction(()=>document.querySelector('[data-pos-daily-summary]')?.textContent.includes('再試行'));assert.equal(await count(),'6 件');summaryFail=false;Object.assign(summary,{orderCount:7,total:7000});await clickVisible(page,'[data-pos-summary-refresh]');await page.waitForFunction(()=>document.querySelector('[data-summary-count]')?.textContent.trim()==='7 件');results.push({name:'failed-refresh-keeps-values-and-manual-retry-recovers',passed:true});
  Object.assign(summary,{orderCount:8,total:8000});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('[data-summary-count]')?.textContent.trim()==='8 件');results.push({name:'return-to-page-focus-refreshes-statistics',passed:true});
  await page.screenshot({path:join(output,'live-statistics-800.png'),fullPage:true});
  summaryDelay=500;const beforeRequests=summaryRequests;await clickVisible(page,'[data-pos-summary-refresh]');await page.waitForFunction(()=>document.querySelector('[data-pos-summary-refresh]').disabled);await page.$eval('.store-pos-floating-checkout button',e=>e.click());await page.waitForSelector('.store-pos-cart-panel.is-open');await clickVisible(page,'.store-pos-checkout');await page.waitForFunction(()=>document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length===0);await pause(700);summaryDelay=0;assert.equal(await count(),'9 件');assert(summaryRequests>beforeRequests);assert.equal(checkoutResponses[0].amount,1700);assert.equal(posts[0].items[0].bowlBenefit,undefined);assert.equal(posts[0].discountQuote.version,2);assert.equal(posts[0].discountQuote.amount,100);results.push({name:'older-summary-response-cannot-overwrite-new-checkout-and-auto-quote',passed:true});await context.close();
 }
 assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(serverErrors,[]);await writeFile(join(output,'results.json'),JSON.stringify({passed:true,checks:results,externalRequests,pageErrors,serverErrors,liveWrites:0},null,2));console.log(JSON.stringify({passed:true,cases:results.length}));
}catch(error){if(currentPage&&!currentPage.isClosed()){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,body:await currentPage.$eval('body',el=>el.innerText),pageErrors,serverErrors,posts},null,2));await currentPage.screenshot({path:join(output,'failure.png'),fullPage:true});}throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));stop();}
