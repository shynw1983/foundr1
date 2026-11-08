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
const output = resolve(args.output || 'outputs/pos-print-documents-ui');
const mode = 'after';
assert.ok(['before', 'after'].includes(mode), 'Expected --mode before or after');
const requireSource = createRequire(join(source, 'package.json'));
const { build, stop } = requireSource('esbuild');
const puppeteer = requireSource('puppeteer-core');
await mkdir(output, { recursive: true });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async lang => [lang, JSON.parse(await readFile(join(source, `public/locales/os/${lang}.json`), 'utf8'))])));
const store = { id: '11111111-1111-4111-8111-111111111111', name: '清水店', brandIds: ['fixture-maamaa'] };
const otherStore = { id: '11111111-1111-4111-8111-222222222222', name: '別店舗' };
const brand = { id: 'fixture-maamaa', name: 'まぁ麻' };
const item = { id: 'fixture-soup', brandId: brand.id, brandName: brand.name, name: '麻辣湯スープ', displayNames: { ja: '麻辣湯スープ' }, itemKind: 'buildable_product', category: 'スープ', imageUrl: '', basePrice: 815, priceOverride: null, posPricingMode: 'fixed', posWeightUnit: 'g', posWeightUnitPrice: null, isAvailable: true, variableSchema: {} };
const printer = { deviceType: 'escpos_network', connectionType: 'lan', host: '127.0.0.2', port: 9100, identifier: '', paperWidth: '80mm', characterEncoding: 'shift_jis', cutPaper: true, openCashDrawer: true };
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';import{StoreThemeProvider}from'./app/store/components/StoreThemeProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
window.__prints=[];window.__failPrint=false;if(new URLSearchParams(location.search).get('bridge')==='yes')window.Foundr1Printer={isAvailable:()=>true,print:payload=>{window.__prints.push(JSON.parse(payload));return JSON.stringify(window.__failPrint?{ok:false,error:'Fixture: printer result unknown'}:{ok:true})}};
createRoot(document.getElementById('root')).render(<OsTranslationProvider><StoreThemeProvider employeeId="fixture-employee"><Pos/></StoreThemeProvider></OsTranslationProvider>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', charset: 'utf8', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'local-fixture-only', setup(b) {
  b.onResolve({ filter: /^next\/(link|navigation)$/ }, a => ({ path: a.path, namespace: 'fixture-navigation' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-navigation' }, a => ({ contents: a.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` : `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`, loader: 'js', resolveDir: source }));
  b.onResolve({ filter: /shared-pusher-client$/ }, a => ({ path: a.path, namespace: 'fixture-pusher' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-pusher' }, () => ({ contents: `export function acquireSharedPusher(){return{connection:{bind(){}},subscribe(){return{name:'private-checkout-fixture',bind(event,fn){if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(){}}},unsubscribe(){},disconnect(){}}}`, loader: 'js' }));
} }] });
const css = await readFile(join(source, 'app/globals.css'), 'utf8') + '\n' + await readFile(join(source, 'app/store/store-responsive.css'), 'utf8') + '\n' + (bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text || '');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
let settings, posts, rejectCheckout, checkoutResponses, customerDisplayPosts;
let relayTest = false;
let ledger, printMutations, printOperations, rejectPrintClaim, dropAckResponse, queueReadError;
function reset({ enabled = false, receiptEnabled = false, reject = false } = {}) {
  relayTest = false;
  settings = { enabled, receiptEnabled, kitchenEnabled: false, receiptPrinter: printer, kitchenPrinter: printer, customerDisplay: { enabled: false } };
  ledger=[];printMutations=[];printOperations=new Map();rejectPrintClaim=false;dropAckResponse=false;queueReadError=false;
  posts = []; checkoutResponses = []; customerDisplayPosts = []; rejectCheckout = reject;
}
reset();
const summary = { orderCount: 0, total: 0, average: 0, latestOrders: [] };
const openSession = { id: 'fixture-register', businessDate: '2026-10-20', status: 'open', openingAmount: 10000, expectedCashAmount: 10000, openedAt: '2026-10-20T01:00:00.000Z', cashSales: 0, cashIn: 0, cashOut: 0 };
const send = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
function queueBody(storeId, orderId='') {
  const all=ledger.filter(doc=>doc.storeId===storeId), eligible=all.filter(doc=>doc.eligible);
  return {version:1,selectedStoreId:storeId,documents:all.filter(doc=>orderId?doc.orderId===orderId:['pending','sending','uncertain'].includes(doc.state)),summary:{pendingDocuments:eligible.filter(doc=>doc.state==='pending').length,pendingOrders:new Set(eligible.filter(doc=>doc.state==='pending').map(doc=>doc.orderId)).size,needsReview:all.filter(doc=>doc.state==='uncertain').length,sendingDocuments:eligible.filter(doc=>doc.state==='sending').length},hasMore:false,cursor:null,relay:{available:false,online:false},serverNow:new Date().toISOString()};
}
function createDocuments(body,response) {
 const createdAt=new Date().toISOString(), kinds=['kitchen','finishing','pickup','receipt'];
 kinds.forEach((kind,index)=>ledger.push({id:`${response.orderId}-doc-${index}`,storeId:body.storeId,orderId:response.orderId,itemId:index<3?'fixture-order-item':null,kind,sequence:index,copyNumber:1,pickupCode:index<3?'037':response.pickupCode,label:kind,createdAt,orderCreatedAt:createdAt,state:body.printMode==='none'||kind==='receipt'&&!settings.receiptEnabled?'not_requested':'pending',error:'',eligible:true,blockedReason:'',revision:0,transport:null}));
 response.printDocuments={version:1,orderId:response.orderId,mode:body.printMode,documentCount:4,pendingCount:ledger.filter(doc=>doc.orderId===response.orderId&&doc.state==='pending').length};
}
function fixturePayload(doc) {return{version:1,jobType:doc.kind==='receipt'?'receipt':'kitchen',printer:{...printer,openCashDrawer:false},storeName:store.name,printedAt:doc.createdAt,kitchenTicketTemplate:{title:doc.kind},order:{pickupCode:doc.pickupCode,totalAmount:652,subtotalAmount:815,discountAmount:163,cashTenderedAmount:2000,cashChangeAmount:1348,note:'original snapshot',items:[{name:item.name,quantity:1,amount:815}]}};}
const serverErrors = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); return res.end(bundle.outputFiles.find(f => f.path.endsWith('.js')).text); }
    if (url.pathname.startsWith('/locales/os/')) return send(res, dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']);
    if (url.pathname === '/api/store/pos/print-documents') {
      if(req.method!=='POST') {if(queueReadError)return send(res,{error:'Fixture: print queue unavailable'},503);return send(res,queueBody(url.searchParams.get('storeId')||store.id,url.searchParams.get('orderId')||''));}
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);printMutations.push(body);const doc=ledger.find(doc=>doc.id===body.documentId&&doc.storeId===body.storeId);if(!doc)return send(res,{error:'Fixture: document missing'},404);
      const key=doc.id+':'+body.operationId,previous=printOperations.get(key);if(previous){if(previous.action!==body.action)return send(res,{error:'Fixture: operation action collision'},409);return send(res,{document:doc,transport:'direct',shouldPrint:false,alreadyDone:true});}
      if(body.action==='claim'){
        if(!doc.eligible)return send(res,{error:'Fixture: document no longer printable'},409);
        if(rejectPrintClaim)return send(res,{error:'Fixture: printer destination unavailable'},409);
        if(body.expectedRevision!==doc.revision)return send(res,{error:'Fixture: revision changed'},409);
        if(doc.state!=='pending'&&!(body.reprint&&body.physicalConfirmed))return send(res,{error:'Fixture: physical confirmation required'},409);
        doc.state='sending';doc.revision++;doc.transport='direct';doc.claimToken='fixture-claim-'+body.operationId;printOperations.set(key,{action:body.action});return send(res,{document:doc,transport:'direct',claimToken:doc.claimToken,payload:fixturePayload(doc),shouldPrint:true});
      }
      if(body.action==='ack'){
        if(doc.claimToken!==body.claimToken)return send(res,{error:'Fixture: old claim token'},409);
        doc.state=body.result;doc.error=body.error||'';doc.revision++;printOperations.set(key,{action:body.action});if(dropAckResponse){dropAckResponse=false;res.destroy();return;}return send(res,{ok:true,document:doc});
      }
      if(body.action==='voidIneligible'){if(!body.physicalConfirmed||body.expectedRevision!==doc.revision||doc.eligible||doc.state!=='uncertain')return send(res,{error:'Fixture: review changed'},409);doc.state='cancelled';doc.revision++;doc.claimToken=null;doc.error='';printOperations.set(key,{action:body.action});return send(res,{ok:true,document:doc});}
      if(body.action==='confirmPrinted') {if(!body.physicalConfirmed||body.expectedRevision!==doc.revision)return send(res,{error:'Fixture: physical confirmation required'},409);doc.state='sent';doc.revision++;doc.claimToken=null;doc.error='';printOperations.set(key,{action:body.action});return send(res,{ok:true,document:doc});}
      return send(res,{error:'Fixture: unexpected action'},400);
    }
    if (url.pathname === '/api/store/pos/transactions') {const orderId=url.searchParams.get('orderId')||checkoutResponses.at(-1)?.orderId;const selected=checkoutResponses.find(order=>order.orderId===orderId);const transaction=selected?{id:selected.orderId,pickupCode:selected.pickupCode,status:'new',paymentStatus:'paid',paymentMethod:'cash',amount:652,cashSessionStatus:'open',printDocumentVersion:1,createdLabel:'Fixture',items:[{id:'fixture-order-item',name:item.name,quantity:1,amount:815,grossAmount:815,discountAmount:163,paidAmount:652,toppings:[],refundStatus:''}]}:null;return send(res,{transactions:transaction?[transaction]:[],selectedTransaction:url.searchParams.get('orderId')?transaction:null});}
    if (url.pathname === '/api/auth/me') return send(res, { employee: { id: 'fixture-employee', name: 'Fixture', role: 'owner' } });
    if (url.pathname === '/api/store/context') return send(res, { selectedStoreId: url.searchParams.get('storeId') || store.id, access: { role: 'owner', canUseAllStoreView: true, stores: [store,otherStore] } });
    if (url.pathname === '/api/store/theme') return send(res, { storeId: url.searchParams.get('storeId') || store.id, storeName: store.name, target: 'operations', theme: { mode: 'custom', primaryColor: '#006b7d', paletteVersion: 1 }, brand: null, canManageTheme: true, stores: [store,otherStore], updatedAt: null, revision: null });
    if (url.pathname === '/api/store/realtime-config') return send(res, { key: 'fixture', cluster: 'fixture', channels: ['private-checkout-fixture'] });
    if (url.pathname === '/api/store/pos/summary') return send(res, { selectedStoreId: store.id, ...summary, summary });
    if (url.pathname === '/api/store/pos/operator') return send(res, { enabled: false, settings: { enabled: false, idleMinutes: 10 }, operator: null, employees: [], serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos/customer-display') {
      if (req.method === 'POST') { let raw = ''; for await (const part of req) raw += part; customerDisplayPosts.push(JSON.parse(raw)); }
      return send(res, { ok: true, state: { status: 'advertising', weighingRevision: 0 }, customerDisplayMediaSettings: { weighing: { enabled: false } } });
    }
    if (url.pathname === '/api/store/pos/reconciliation') return send(res, { selectedStoreId: url.searchParams.get('storeId') || store.id, businessDate: '2026-10-20', activeSession: openSession, sessions: [openSession], movements: [], activeCashResponsibleEmployees: [] });
    if (url.pathname.includes('/device-relay')) return send(res, { stations: [], jobs: [], canManage: true, serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos' && req.method === 'POST') {
      let raw = ''; for await (const part of req) raw += part; const body = JSON.parse(raw); posts.push(body);
      if (rejectCheckout) return send(res, { error: 'Fixture: メニューが更新されました。商品と金額を確認してください。' }, 409);
      assert.equal(body.items.length, 1); assert.equal(body.items[0].menuCatalogItemId, item.id); assert.equal(body.items[0].quantity, 1);
      const response = { ok: true, orderId: `22222222-2222-4222-8222-${String(posts.length).padStart(12,'0')}`, pickupCode: 'D-FIXTURE', servingTickets: [{ itemIndex: 0, pickupCode: '037', itemId: 'fixture-order-item', taskId: 'fixture-task' }], amount: 652, subtotalAmount: 815, taxableAmount: 652, taxAmount: 49, taxRate: 8, priceTaxMode: 'tax_included', discountAmount: 163, couponDiscountAmount: 0, cashTenderedAmount: body.cashTenderedAmount, cashChangeAmount: body.cashTenderedAmount - 652, receiptRequested: body.receiptRequested, todaySummary: { ...summary, orderCount: 1, total: 652, average: 652 } };
      if(body.printDocumentVersion===1)createDocuments(body,response);
      if (relayTest) { response.relayPrinting = true; const currentOrder = response.orderId; setTimeout(() => { ledger.filter(doc=>doc.orderId===currentOrder && doc.state==='pending').forEach(doc=>{doc.state='sent';doc.transport='relay';doc.revision+=1;}); }, 300); }
      checkoutResponses.push(response); return send(res, response);
    }
    if (url.pathname === '/api/store/pos') return send(res, { selectedStoreId: url.searchParams.get('storeId') || store.id, access: { role: 'owner', stores: [store,otherStore] }, brands: [brand], items: [item], categories: [], optionGroups: [], posMenuRevision: 'fixture-revision', dineInMenuRevision: '', todaySummary: summary, posSettings: { dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: 'KOMOJU', priceTaxMode: 'tax_included', discountPresets: [{ key: 'student', name: '学割 20%OFF', discountType: 'percent', discountValue: 20, targetScope: 'all', targetValue: '', enabled: true, stampEligible: false, allowCouponCombination: false }], printerSettings: settings, customerDisplayMediaSettings: { weighing: { enabled: false } } } });
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
async function createPage({ width = 390, bridge = false, language = 'ja' } = {}) {
  const context = await browser.createBrowserContext(), page = await context.newPage(); currentPage = page;
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewport({ width, height: 900 });
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.url().startsWith(base + '/')) return request.continue(); externalRequests.push(request.url()); return request.abort(); });
  await page.goto(`${base}/store/pos?lang=${language}&bridge=${bridge ? 'yes' : 'no'}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.store-pos-item-button:not(:disabled)');
  await page.waitForFunction(() => getComputedStyle(document.body).getPropertyValue('--store-primary').trim() === '#006b7d');
  await page.$eval('.store-pos-item-button', async el => { el.scrollIntoView({ block: 'center', behavior: 'instant' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.click('.store-pos-item-button');
  await page.waitForFunction(() => document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length === 1);
  if (width <= 900) { await page.click('.store-pos-floating-checkout button'); await page.waitForSelector('.store-pos-cart-panel.is-open'); }
  await page.evaluate(() => [...document.querySelectorAll('.store-pos-segmented button')].find(el => el.textContent === '持ち帰り')?.click());
  await page.$eval('.store-pos-discount-panel button',el=>el.click());
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

const drawer = '[role="dialog"][aria-label="伝票・印刷待ち"]';
async function closeCart(page) { const back = await page.$('.store-pos-cart-panel.is-open .store-pos-cart-back'); if (back) await back.click(); }
async function openDocuments(page) { await closeCart(page); await geometry(page, '[data-print-queue-open]'); await page.click('[data-print-queue-open]'); await page.waitForSelector(drawer); }
async function pending(page, count) { await page.waitForFunction(count => document.querySelector('[data-print-queue-open] strong')?.textContent === String(count), {}, count); }
async function paid(page, expectedPending = 3) {
  await geometry(page, '.store-pos-checkout'); await page.click('.store-pos-checkout');
  await page.waitForFunction(() => document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length === 0);
  await pending(page, expectedPending); assert.equal(posts.length, 1); assert.equal(posts[0].offlineExpectedAmount, 652); assert.equal(posts[0].cashTenderedAmount, 2000); assert.equal(posts[0].discountPresetKey, 'student'); assert.equal(posts[0].printDocumentVersion, 1); assert.equal(checkoutResponses[0].amount, 652);
  assert.equal((await localData(page))['pos-print-jobs'].length, 0, 'Server-managed documents never also create legacy local print jobs');
}
async function selectDocument(page, doc) { const selector = `[data-print-document="${doc.id}"] input[type="checkbox"]`; await geometry(page, selector); await page.click(selector); }
async function printSelection(page) { await geometry(page, '[data-print-submit]'); await page.click('[data-print-submit]'); }
async function drawerGeometry(page) { const info = await geometry(page, drawer); assertGeometry(info); return info; }
async function printError(page) { const selector = `${drawer} [data-print-error]`; await page.waitForSelector(selector); const info = await geometry(page, selector); assertGeometry(info); return info; }
async function until(predicate, label) { const deadline=Date.now()+30000; while(!predicate()){ if(Date.now()>deadline)throw new Error(`Fixture wait timed out: ${label}`); await pause(20); } }

try {
  reset({ enabled: true, receiptEnabled: true }); relayTest = true;
  {
    const {page,context} = await createPage({width:1024,bridge:true});
    await page.click('.store-pos-checkout');
    await page.waitForFunction(()=>document.body.innerText.includes('会計済み・伝票送信済み'),{timeout:15000});
    const allNotices=await page.evaluate(()=>document.body.innerText);
    assert.match(allNotices,/1,348/); assert.match(allNotices,/652/); assert.match(allNotices,/学割/);
    assert.equal(posts.length,1); assert.equal(printMutations.length,0); assert.equal(await page.evaluate(()=>window.__prints.length),0);
    await page.screenshot({path:join(output,'relay-complete-1024.png'),fullPage:true});
    await openDocuments(page); await pending(page,0); await page.click(`${drawer} button[aria-label="閉じる"]`);
    assert.match(await page.$eval('.store-pos-checkout-actions [role="status"]',el=>el.textContent),/伝票送信済み/);
    results.push({name:'relay-ack-updates-paid-notice-preserves-change-discount-without-print-retry',passed:true});
    await context.close();
  }
  for (const width of [390, 800, 1366]) {
    reset(); const { page, context, values } = await createPage({ width }); page.on('dialog', dialog => dialog.accept());
    assert.equal(await page.$eval('[data-pos-print-mode]', select => select.value), 'deferred');
    assert.match(await page.$eval('.store-pos-checkout', button => button.textContent), /あとで印刷/);
    await paid(page); assert.equal(posts[0].printMode, 'deferred'); assert.equal(printMutations.length, 0); assert.equal(await page.evaluate(() => window.__prints.length), 0);
    const status = await geometry(page, '.store-pos-checkout-actions [role="status"]'); assertGeometry(status); assert.match(status.text, /会計済み・印刷待ち/); assert.match(status.text, /652/); assert.match(status.text, /1,348/);
    await page.screenshot({ path: join(output, `deferred-paid-${width}.png`), fullPage: true });
    const paidAccess=await geometry(page,'[data-print-paid-open]');assertGeometry(paidAccess);await page.click('[data-print-paid-open]');await page.waitForSelector(drawer);await page.waitForFunction(()=>document.querySelectorAll('[data-print-document]').length===4);assert.equal(await page.$$eval('[data-print-document][data-print-state="not_requested"]',rows=>rows.length),1);await page.click(`${drawer} button[aria-label="閉じる"]`);
    await openDocuments(page); await page.waitForFunction(()=>document.querySelectorAll('[data-print-document]').length===3); assert.equal(await page.$$eval('[data-print-document]', rows => rows.length), 3); assert.equal(await page.$eval('[data-print-submit]', button => button.disabled), true);
    const layout = await drawerGeometry(page); await page.screenshot({ path: join(output, `persistent-queue-${width}.png`), fullPage: true });
    await page.reload({ waitUntil: 'domcontentloaded' }); await pending(page, 3); assert.equal(printMutations.length, 0); assert.equal(posts.length, 1);
    if (width === 390) {
      await page.evaluate(id => localStorage.setItem('foundr1:store:selectedStoreId', id), otherStore.id); await page.reload({ waitUntil: 'domcontentloaded' }); await pending(page, 0);
      await page.evaluate(id => localStorage.setItem('foundr1:store:selectedStoreId', id), store.id); await page.reload({ waitUntil: 'domcontentloaded' }); await pending(page, 3); assert.equal(posts.length, 1); assert.equal(printMutations.length, 0);
    }
    results.push({ name: `paid-deferred-queue-persists-reload-${width}`, passed: true, values, status, layout, checkoutPosts: posts.length, printCalls: 0, storeReloadSwitch: width === 390 }); await context.close();
  }
  reset(); {
    const { page, context } = await createPage({ width: 1366, bridge: true }); page.on('dialog', dialog => dialog.accept()); await paid(page); await openDocuments(page);
    await page.select(`${drawer} select`, 'pickup'); const pickup = ledger.find(doc => doc.kind === 'pickup'); await selectDocument(page, pickup); await printSelection(page);
    await page.waitForFunction(() => window.__prints.length === 1); await until(()=>pickup.state==='sent','pickup acknowledgement'); await pending(page, 2); assert.equal(pickup.state, 'sent'); assert.equal(printMutations.length, 2); assert.notEqual(printMutations[0].operationId, printMutations[1].operationId, 'Claim and acknowledgement have distinct idempotency identifiers');
    await page.select(`${drawer} select`, ''); await page.click(`${drawer} input[type="checkbox"]`); await printSelection(page); await page.waitForFunction(() => window.__prints.length === 3); await until(()=>ledger.filter(doc=>doc.state==='sent').length===3,'three acknowledgements'); await pending(page, 0);
    assert.deepEqual(await page.evaluate(() => window.__prints.map(payload => payload.kitchenTicketTemplate.title)), ['pickup', 'kitchen', 'finishing']); assert.equal(posts.length, 1);
    await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }); await pause(400); assert.equal(await page.evaluate(() => window.__prints.length), 3); assert.equal(posts.length, 1);
    await page.click(`${drawer} button[aria-label="閉じる"]`);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === '取引履歴').click()); await page.waitForSelector('.store-pos-transaction-list button'); await page.click('.store-pos-transaction-list button'); await page.waitForSelector('[data-print-history-open]'); await page.click('[data-print-history-open]'); await page.waitForSelector(drawer); await page.waitForFunction(() => document.querySelectorAll('[data-print-document]').length === 4);
    assert.equal(await page.$$eval('[data-print-document][data-print-state="sent"] input[type="checkbox"]', inputs => inputs.every(input => input.disabled)), true, 'Sent documents are excluded from ordinary selection');
    const receipt = ledger.find(doc => doc.kind === 'receipt'); await selectDocument(page, receipt); await printSelection(page); await page.waitForFunction(() => window.__prints.length === 4); await until(()=>receipt.state==='sent','receipt acknowledgement'); assert.equal(receipt.state, 'sent'); assert.equal(posts.length, 1); assert.equal(printMutations.at(-2).reprint, true); assert.equal(printMutations.at(-2).physicalConfirmed, true); assert.equal(await page.evaluate(() => window.__prints.at(-1).printer.openCashDrawer), false);
    await page.screenshot({ path: join(output, 'history-manual-role-selection-1366.png'), fullPage: true });
    results.push({ name: 'manual-role-printing-sent-skip-history-entry-explicit-unrequested-receipt-no-reconnect-auto', passed: true, checkoutPosts: posts.length, nativeCalls: 4, distinctClaimAckOperations: true }); await context.close();
  }
  reset(); {
    const { page, context } = await createPage({ width: 390, bridge: true }); page.on('dialog', dialog => dialog.accept()); await paid(page); await openDocuments(page);
    rejectPrintClaim = true; const kitchen = ledger.find(doc => doc.kind === 'kitchen'); await selectDocument(page, kitchen); await printSelection(page); const failed = await printError(page); assert.match(failed.text, /Fixture: printer destination/); await pause(3800); assertGeometry(await printError(page)); assert.equal(await page.evaluate(() => window.__prints.length), 0); assert.equal(posts.length, 1); assert.equal(kitchen.state, 'pending');
    rejectPrintClaim = false; await page.evaluate(() => { window.__failPrint = true; }); await selectDocument(page, kitchen); await printSelection(page); await page.waitForFunction(() => window.__prints.length === 1); await page.waitForFunction(() => document.querySelector('[data-print-state="uncertain"]')); const uncertain = await printError(page); assert.match(uncertain.text, /現物/); assert.equal(posts.length, 1); assert.equal(await page.$$eval('.store-pos-cart-list > .store-pos-cart-row', rows => rows.length), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('online'))); await pause(300); assert.equal(await page.evaluate(() => window.__prints.length), 1);
    const confirmSelector = `[data-print-document="${kitchen.id}"] button`; await geometry(page, confirmSelector); await page.click(confirmSelector); await page.waitForFunction(() => !document.querySelector('[data-print-state="uncertain"]')); assert.equal(kitchen.state, 'sent'); assert.equal(await page.evaluate(() => window.__prints.length), 1); assert.equal(posts.length, 1);
    await page.screenshot({ path: join(output, 'paid-print-error-physical-confirmation-390.png'), fullPage: true });
    results.push({ name: 'paid-print-claim-error-persists-native-unknown-stops-physical-confirmation-no-new-payment', passed: true, failed, uncertain, checkoutPosts: 1, nativeCalls: 1 }); await context.close();
  }
  for (const width of [390, 800, 1366]) {
    reset(); const { page, context } = await createPage({ width, bridge: true }); await paid(page);
    const unknown = ledger.find(doc => doc.kind === 'kitchen'); unknown.state = 'uncertain'; unknown.eligible = false; unknown.blockedReason = 'お渡し済み・印刷対象外'; unknown.error = 'Fixture: outcome unknown before handoff'; unknown.revision++;
    await page.evaluate(({storeId,id}) => localStorage.setItem(`foundr1-pos-print-attempt:v1:${storeId}:${id}`, 'fixture-unacknowledged'), {storeId:store.id,id:unknown.id});
    await page.reload({waitUntil:'domcontentloaded'}); await pending(page,2); await page.waitForFunction(()=>document.querySelector('[data-print-queue-open]')?.innerText.includes('要確認'));
    await openDocuments(page); const selector=`[data-print-document="${unknown.id}"] [data-print-void-ineligible]`;
    await page.waitForSelector(selector); const actionGeometry=await geometry(page,selector); assertGeometry(actionGeometry);
    assert.equal(await page.$eval(`[data-print-document="${unknown.id}"] input[type="checkbox"]`,input=>input.disabled),true);
    assert.equal(await page.$$eval('[data-print-document][data-print-state="pending"] [data-print-void-ineligible]',buttons=>buttons.length),0);
    await page.screenshot({path:join(output,`ineligible-unknown-review-${width}.png`),fullPage:true});
    page.once('dialog',dialog=>dialog.dismiss()); await page.click(selector); await pause(100); assert.equal(printMutations.length,0); assert.equal(unknown.state,'uncertain');
    let physicalPrompt=''; page.once('dialog',dialog=>{physicalPrompt=dialog.message();return dialog.accept();}); await page.click(selector);
    await until(()=>unknown.state==='cancelled','ineligible uncertainty closes after physical confirmation'); await page.waitForFunction(()=>!document.querySelector('[data-print-void-ineligible]'));
    assert.match(physicalPrompt,/現物/);assert.match(physicalPrompt,/遅れて出る/); assert.equal(printMutations.length,1); assert.equal(printMutations[0].action,'voidIneligible'); assert.equal(printMutations[0].physicalConfirmed,true); assert.equal(printMutations[0].expectedRevision,1); assert.equal(printMutations[0].storeId,store.id);
    assert.equal(await page.evaluate(()=>window.__prints.length),0); assert.equal(posts.length,1); assert.equal(checkoutResponses[0].amount,652); assert.equal(await page.evaluate(({storeId,id})=>localStorage.getItem(`foundr1-pos-print-attempt:v1:${storeId}:${id}`),{storeId:store.id,id:unknown.id}),null);
    await page.screenshot({path:join(output,`ineligible-unknown-closed-${width}.png`),fullPage:true});
    results.push({name:`ineligible-unknown-visible-confirm-close-without-print-or-second-payment-${width}`,passed:true,actionGeometry,checkoutPosts:1,nativeCalls:0,mutations:['voidIneligible'],dismissPreservesRecord:true}); await context.close();
  }
  reset({ enabled: true, receiptEnabled: true }); {
    const { page, context } = await createPage({ width: 800, bridge: true }); assert.equal(await page.$eval('[data-pos-print-mode]', select => select.value), 'auto'); await page.evaluate(() => { window.__failPrint = true; });
    await paid(page); await page.waitForFunction(() => window.__prints.length === 1); await page.waitForFunction(() => document.querySelector('[data-print-queue-open]')?.innerText.includes('要確認'));
    assert.equal(posts.length, 1); assert.equal(ledger.filter(doc => doc.state === 'uncertain').length, 1); assert.equal(ledger.filter(doc => doc.state === 'pending').length, 3); assert.equal(await page.$eval('.store-pos-checkout', button => button.disabled), true);
    const status = await geometry(page, '.store-pos-checkout-actions [role="status"]'); assertGeometry(status); assert.match(status.text, /会計済み・印刷状況を確認してください/); await page.reload({ waitUntil: 'domcontentloaded' }); await pending(page, 3); await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); }); await pause(400); assert.equal(await page.evaluate(() => window.__prints.length), 0); assert.equal(posts.length, 1);
    results.push({ name: 'auto-print-failure-is-already-paid-no-second-checkout-no-reload-or-reconnect-print', passed: true, status, checkoutPosts: 1, pending: 3, uncertain: 1 }); await context.close();
  }
  reset(); {
    const { page, context } = await createPage({ width: 390, bridge: true }); await page.select('[data-pos-print-mode]', 'none'); await paid(page, 0); assert.ok(ledger.every(doc => doc.state === 'not_requested')); assert.equal(printMutations.length, 0); assert.equal(await page.evaluate(() => window.__prints.length), 0);
    results.push({ name: 'explicit-no-print-keeps-snapshots-with-zero-pending-count', passed: true, snapshots: ledger.length, checkoutPosts: 1 }); await context.close();
  }
  reset({ reject: true }); {
    const { page, context } = await createPage({ width: 390 }); await geometry(page, '.store-pos-checkout'); await page.click('.store-pos-checkout'); const error = await alertState(page); await pause(3800); assertGeometry(await alertState(page)); assert.match(error.text, /Fixture: メニュー/); assert.equal(posts.length, 1); assert.equal(ledger.length, 0); assert.equal(await page.$eval('.store-pos-cash-payment input', input => input.value), '2000'); assert.equal(await page.$$eval('.store-pos-cart-list > .store-pos-cart-row', rows => rows.length), 1);
    results.push({ name: 'cash-checkout-409-keeps-cart-tender-and-persistent-visible-error', passed: true, error }); await context.close();
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(serverErrors, []);
  const files = ['app/store/pos/page.tsx', 'app/store/pos/usePosPrintDocuments.ts', 'app/store/pos/PosPrintDocumentsPanel.tsx', 'app/store/pos/PosPrintDocumentsPanel.module.css', 'lib/pos-print-document-contract.ts'];
  const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, sha256(await readFile(join(source, file)))])));
  const result = { passed: true, source, synthetic: true, liveWrites: 0, viewports: [390, 800, 1366], checks: results, sourceHashes: hashes, pageErrors, externalRequests, serverErrors, limits: ['HTTP ledger and native printer responses are synthetic; actual SQL/API atomicity is covered separately by pos-print-documents-db.mjs.', 'Store selection changes are exercised through saved store selection followed by page reload, matching remount navigation.'] };
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2)); await writeFile(join(output, 'executed-test.mjs'), await readFile(new URL(import.meta.url))); console.log(JSON.stringify({ passed: true, checks: results.length, output }));
} catch (error) {
  const pageState = currentPage && !currentPage.isClosed() ? await currentPage.evaluate(() => ({ body: document.body.innerText.slice(-6500), prints: window.__prints })) : null;
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.stack, results, posts, ledger, printMutations, pageErrors, serverErrors, externalRequests, pageState }, null, 2)); if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: join(output, 'failure.png'), fullPage: true }); throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); stop(); }
