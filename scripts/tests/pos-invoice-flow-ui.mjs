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
const output = resolve(args.output || 'outputs/store-dine-in-pos-client');
const requireSource = createRequire(join(source, 'package.json'));
const { build, stop } = requireSource('esbuild');
const puppeteer = requireSource('puppeteer-core');
await mkdir(output, { recursive: true });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async lang => [lang, JSON.parse(await readFile(join(source, `public/locales/os/${lang}.json`), 'utf8'))])));
const store = { id: '11111111-1111-4111-8111-111111111111', name: '桜並木店', brandIds: ['fixture-brand'] };
const brand = { id: 'fixture-brand', name: 'まぁ麻' };
const canonicalId = '22222222-2222-4222-8222-222222222222', localId = '33333333-3333-4333-8333-333333333333';
const canonicalGroupId = '44444444-4444-4444-8444-444444444444', localGroupId = '55555555-5555-4555-8555-555555555555';
const canonicalOptionId = '66666666-6666-4666-8666-666666666666', localOptionId = '77777777-7777-4777-8777-777777777777';
const item = { id: canonicalId, brandId: brand.id, brandName: brand.name, name: 'ブランド牛筋50g', displayNames: {}, itemKind: 'product', productionType: 'item', category: '追加', imageUrl: '', basePrice: 600, priceOverride: null, posPricingMode: 'fixed', posWeightUnit: 'g', posWeightUnitPrice: null, isAvailable: true, variableSchema: { allowedOptions: ['原本の辛味'] } };
const group = { id: canonicalGroupId, brandId: brand.id, menuCatalogItemId: canonicalId, applicableCategories: [], groupKey: 'option', name: 'ブランド仕上げ', displayNames: {}, selectionType: 'single', ruleJson: { minSelections: 1, limit: 1 }, sortOrder: 0, options: [{ id: canonicalOptionId, optionKey: 'spice-key', name: '原本の辛味', displayNames: {}, applicableCategories: [], priceDelta: 100, sortOrder: 0 }, { id: 'forbidden-option', optionKey: 'forbidden-key', name: '選択不可', displayNames: {}, applicableCategories: [], priceDelta: 999, sortOrder: 1 }] };
const localItem = { ...item, id: localId, sourceItemId: canonicalId, sourceName: item.name, name: '桜並木の牛筋50g', optionGroupIds: [localGroupId] };
const localGroup = { ...group, id: localGroupId, sourceGroupId: canonicalGroupId, sourceName: group.name, menuCatalogItemId: localId, name: '店内仕上げ', options: group.options.map((option, index) => ({ ...option, id: index ? 'forbidden-local-option' : localOptionId, sourceOptionId: option.id, sourceName: option.name, name: index ? '店内選択不可' : '店内ピリ辛' })) };
const printer = { deviceType: 'escpos_network', connectionType: 'lan', host: '', port: 9100, identifier: '', paperWidth: '80mm', characterEncoding: 'shift_jis', cutPaper: false, openCashDrawer: false };
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

const summary = { orderCount: 0, total: 0, average: 0, latestOrders: [] };
const openSession = { id: 'fixture-register', businessDate: '2026-10-20', status: 'open', openingAmount: 10000, expectedCashAmount: 10000, openedAt: '2026-10-20T01:00:00.000Z', cashSales: 0, cashIn: 0, cashOut: 0 };
let invoiceIssued=false,invoiceFailOnce=false;const invoicePosts=[];const invoiceId='88888888-8888-4888-8888-888888888888';
const transaction={id:'99999999-9999-4999-8999-999999999999',printDocumentVersion:1,pickupCode:'037',status:'ready',paymentStatus:'paid',paymentMethod:'cash',amount:700,orderType:'eat_in',cashierName:'Fixture',cashTenderedAmount:1000,cashChangeAmount:300,createdLabel:'11/02 12:00',refundStatus:'none',refundedAt:'',cashSessionStatus:'open',items:[]};
const posts = [], customerDisplayPosts = [], serverErrors = [], pageErrors = [], externalRequests = [], checks = [];
const send = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
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
    if(url.pathname==='/api/store/pos/transactions')return send(res,{transactions:[transaction],selectedTransaction:transaction});
    if(url.pathname==='/api/store/pos/invoice'){
      if(req.method==='POST'){let raw='';for await(const part of req)raw+=part;const data=JSON.parse(raw);invoicePosts.push(data);if(invoiceFailOnce){invoiceFailOnce=false;return send(res,{error:'領収書を発行できませんでした。'},500);}const alreadyIssued=invoiceIssued;invoiceIssued=true;return send(res,{ok:true,orderId:transaction.id,documentId:invoiceId,alreadyIssued});}
      return send(res,{eligible:true,reason:'',issued:invoiceIssued,documentId:invoiceIssued?invoiceId:undefined,receiptRecipientName:'Fixture商事',receiptPurposeText:'会食代'});
    }
    if(url.pathname==='/api/store/pos/print-documents')return send(res,{version:1,selectedStoreId:store.id,documents:invoiceIssued?[{id:invoiceId,orderId:transaction.id,kind:'receipt',label:'領収書',state:'pending',eligible:true,revision:0,pickupCode:'037',copyNumber:1,sequence:5,transport:null,createdAt:new Date().toISOString(),orderCreatedAt:new Date().toISOString()}]:[],summary:{pendingDocuments:invoiceIssued?1:0,pendingOrders:invoiceIssued?1:0,needsReview:0,sendingDocuments:0},hasMore:false,cursor:null,relay:{available:false,online:false},serverNow:new Date().toISOString()});
    if (url.pathname === '/api/store/pos/customer-display') {
      if (req.method === 'POST') { let raw = ''; for await (const part of req) raw += part; customerDisplayPosts.push(JSON.parse(raw)); }
      return send(res, { ok: true, state: { status: 'advertising', weighingRevision: 0 }, customerDisplayMediaSettings: { weighing: { enabled: false } } });
    }
    if (url.pathname === '/api/store/pos/reconciliation') return send(res, { businessDate: '2026-10-20', activeSession: openSession, sessions: [openSession], movements: [], activeCashResponsibleEmployees: [] });
    if (url.pathname.includes('/device-relay')) return send(res, { stations: [], jobs: [], canManage: true, serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos' && req.method === 'POST') {
      let raw = ''; for await (const part of req) raw += part; const body = JSON.parse(raw); posts.push(body);
      return send(res, { ok: true, orderId: `fixture-order-${posts.length}`, pickupCode: 'D-FIXTURE', servingTickets: [], amount: 700, subtotalAmount: 700, taxableAmount: 700, taxAmount: 63, taxRate: body.orderType === 'eat_in' ? 10 : 8, priceTaxMode: 'tax_included', discountAmount: 0, couponDiscountAmount: 0, cashTenderedAmount: body.cashTenderedAmount, cashChangeAmount: body.cashTenderedAmount - 700, receiptRequested: body.receiptRequested === true, todaySummary: { ...summary, orderCount: posts.length, total: 700 * posts.length, average: 700 } });
    }
    if (url.pathname === '/api/store/pos') return send(res, { selectedStoreId: store.id, access: { role: 'owner', stores: [store] }, brands: [brand], items: [item], categories: [], optionGroups: [group], dineInMenu: { items: [localItem], categories: [], optionGroups: [localGroup] }, dineInMenuRevision: 'dine-in-fixture:17', posMenuRevision: 'canonical-fixture:4', todaySummary: summary, posSettings: { dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: 'KOMOJU', priceTaxMode: 'tax_included', discountPresets: [], printerSettings: { enabled: false, receiptEnabled: false, kitchenEnabled: false, receiptPrinter: printer, kitchenPrinter: printer, customerDisplay: { enabled: false } }, customerDisplayMediaSettings: { weighing: { enabled: false } } } });
    if (url.pathname.startsWith('/api/')) return send(res, { items: [], documents: [], notifications: [], unreadCount: 0 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  } catch (error) { serverErrors.push(error.stack); send(res, { error: error.message }, 500); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true, timeout: 30000 });
let page;
async function switchType(label) {
  await page.evaluate(label => [...document.querySelectorAll('.store-pos-segmented button')].find(button => button.textContent === label)?.click(), label);
}
async function addConfigured(expectedName, expectedOption) {
  await page.waitForSelector('.store-pos-item-button:not(:disabled)');
  await page.click('.store-pos-item-button');
  await page.waitForSelector('.store-pos-option-overlay');
  assert.equal(await page.$eval('.store-pos-option-head h3', el => el.textContent), expectedName);
  const labels = await page.$$eval('.store-pos-option-choice > button', buttons => buttons.map(button => button.querySelector('span').textContent));
  assert.deepEqual(labels, [expectedOption], 'Only the inherited allowed source identity remains selectable after local renaming');
  await page.click('.store-pos-option-choice > button');
  await page.click('.store-pos-option-add');
  await page.waitForFunction(() => !document.querySelector('.store-pos-option-overlay'));
  await page.waitForFunction(() => document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length === 1);
}
async function assertCatalog(name, absent) {
  await page.waitForFunction(name => [...document.querySelectorAll('.store-pos-item-button')].some(button => button.textContent.includes(name)), {}, name);
  const text = await page.$$eval('.store-pos-item-button', buttons => buttons.map(button => button.textContent).join('\n'));
  assert.ok(text.includes(name)); assert.ok(!text.includes(absent));
}
async function checkout(expectedType, expectedId, expectedGroup, expectedOption, revision) {
  const before = posts.length;
  const cash = await page.$('.store-pos-cash-payment input'); await cash.click({ clickCount: 3 }); await cash.type('1000');
  await page.waitForFunction(() => !document.querySelector('.store-pos-checkout').disabled);
  // Dispatch the real React button handler; pointer geometry is covered by the existing POS UI suite.
  await page.$eval('.store-pos-checkout', button => button.click());
  await page.waitForFunction(() => document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length === 0);
  assert.equal(posts.length, before + 1);
  const request = posts.at(-1); assert.equal(request.orderType, expectedType); assert.equal(request.posMenuRevision, 'canonical-fixture:4');
  assert.equal(request.dineInMenuRevision, revision); assert.equal(request.items.length, 1); assert.equal(request.items[0].menuCatalogItemId, expectedId);
  assert.deepEqual(request.items[0].selectedOptions, [{ groupId: expectedGroup, optionIds: [expectedOption] }]);
  assert.equal(request.offlineExpectedAmount, 700); assert.equal(await page.evaluate(() => window.__prints.length), 0);
  return request;
}
try {
 const context=await browser.createBrowserContext();page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>pageErrors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(base+'/')?r.continue():(externalRequests.push(r.url()),r.abort()));
 const selected=()=>page.$eval('[data-pos-receipt-choice="invoice"]',b=>b.getAttribute('aria-pressed'));
 const choose=type=>page.$eval('[data-pos-receipt-choice="'+type+'"]',b=>b.click());
 const fill=async(selector,value)=>{const el=await page.$(selector);await el.focus();await el.evaluate(e=>e.select());await el.press('Backspace');if(value)await el.type(value)};
 const cancel=async()=>{await page.$eval('.store-pos-cancel-transaction',b=>b.click());await page.waitForFunction(()=>!document.querySelector('.store-pos-cart-list > .store-pos-cart-row'));};
 const pay=async()=>{await fill('.store-pos-cash-payment input','1000');await page.waitForFunction(()=>!document.querySelector('.store-pos-checkout').disabled);await page.$eval('.store-pos-checkout',b=>b.click());await page.waitForFunction(()=>!document.querySelector('.store-pos-cart-list > .store-pos-cart-row'));};
 for(const width of [390,768,1024,1440]){
  if(width!==390){await page.close();page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>pageErrors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(base+'/')?r.continue():(externalRequests.push(r.url()),r.abort()));}
  await page.setViewport({width,height:1024});await page.goto(base+'/store/pos?lang=ja',{waitUntil:'domcontentloaded'});await page.waitForSelector('.store-pos-item-button:not(:disabled)');await addConfigured(localItem.name,localGroup.options[0].name);assert.equal(await selected(),'false');
  if(width<1100)await page.$eval('.store-pos-floating-checkout button',b=>b.click());
  await page.$eval('.store-pos-checkout',b=>b.scrollIntoView({block:'end'}));
  await page.waitForFunction(()=>{const b=document.querySelector('[data-pos-receipt-choice=invoice]'),r=b.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>0&&r.height>0&&(top===b||b.contains(top))});
  const size=await page.$eval('.store-pos-checkout',b=>({width:b.getBoundingClientRect().width,text:b.textContent}));assert(size.width>=139,JSON.stringify(size));assert((await page.$eval('[data-pos-footer-total]',e=>e.textContent)).includes('¥700'));await page.screenshot({path:join(output,'normal-'+width+'.png'),fullPage:true});checks.push(width+':explicit_default_receipt_and_readable_confirm_button');
  await choose('invoice');await fill('[data-pos-invoice-recipient]','Fixture会社 様');await fill('[data-pos-invoice-purpose]','会食代');await page.screenshot({path:join(output,'invoice-'+width+'.png'),fullPage:true});
  await cancel();assert.equal(await selected(),'false');await choose('invoice');assert.equal(await page.$eval('[data-pos-invoice-recipient]',e=>e.value),'');assert.equal(await page.$eval('[data-pos-invoice-purpose]',e=>e.value),'飲食代');await choose('receipt');checks.push(width+':cancel_resets_type_recipient_and_purpose');
 }
 await page.goto(base+'/store/pos?lang=ja',{waitUntil:'domcontentloaded'});await page.waitForSelector('.store-pos-item-button:not(:disabled)');await addConfigured(localItem.name,localGroup.options[0].name);await pay();assert.equal(posts.at(-1).receiptRequested,false);checks.push('ordinary_checkout_requests_receipt');
 await addConfigured(localItem.name,localGroup.options[0].name);await choose('invoice');await fill('[data-pos-invoice-recipient]','Fixture会社 様');await fill('[data-pos-invoice-purpose]','会食代');await pay();assert.equal(posts.at(-1).receiptRequested,true);assert.equal(posts.at(-1).receiptRecipientName,'Fixture会社 様');assert.equal(posts.at(-1).receiptPurposeText,'会食代');assert.equal(await selected(),'false');checks.push('invoice_checkout_sends_fields_then_resets');
 await addConfigured(localItem.name,localGroup.options[0].name);await choose('invoice');await cancel();await addConfigured(localItem.name,localGroup.options[0].name);assert.equal(await selected(),'false');await pay();assert.equal(posts.at(-1).receiptRequested,false);checks.push('cancelled_invoice_does_not_leak_to_next_order');
 const history=async()=>{await page.$$eval('button',bs=>bs.find(b=>b.textContent.trim()==='取引履歴').click());await page.waitForSelector('[data-pos-issue-invoice]');};
 await page.setViewport({width:768,height:1024});await history();await page.click('[data-pos-issue-invoice]');await page.waitForSelector('[data-invoice-recipient]');await fill('[data-invoice-recipient]','Fixture商事');await fill('[data-invoice-purpose]','会食代');await page.screenshot({path:join(output,'history-issue.png'),fullPage:true});invoiceFailOnce=true;await page.click('[data-invoice-submit]');await page.waitForSelector('[role=dialog] [role=alert]');assert.equal(await page.$eval('[data-invoice-recipient]',e=>e.value),'Fixture商事');await page.waitForFunction(()=>!document.querySelector('[data-invoice-submit]').disabled);await page.click('[data-invoice-submit]');await page.waitForSelector('[data-print-document]');assert.equal(invoicePosts.length,2);assert.equal(invoicePosts[0].operationId,invoicePosts[1].operationId);checks.push('issuance_error_keeps_fields_and_retry_reuses_operation');assert.equal(invoicePosts[0].receiptRecipientName,'Fixture商事');const label=await page.$eval('[data-print-document] strong',e=>e.textContent);assert(label.includes('領収書'));checks.push('history_issuance_uses_separate_endpoint_and_opens_correctly_labeled_print_queue');
 // Close the print drawer, revisit history; issuance is read-only once a document exists.
 await page.close();page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>pageErrors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(base+'/')?r.continue():(externalRequests.push(r.url()),r.abort()));await page.setViewport({width:768,height:1024});await page.goto(base+'/store/pos?lang=ja',{waitUntil:'domcontentloaded'});await page.waitForSelector('.store-pos-item-button:not(:disabled)');await history();await page.click('[data-pos-issue-invoice]');await page.waitForFunction(()=>document.body.innerText.includes('この取引の領収書は発行済み'));assert.equal(await page.$('[data-invoice-submit]'),null);await page.screenshot({path:join(output,'history-already-issued.png'),fullPage:true});checks.push('already_issued_invoice_only_offers_original_reprint');
 assert.equal(posts.length,3);assert.deepEqual(pageErrors,[]);assert.deepEqual(serverErrors,[]);assert.deepEqual(externalRequests,[]);await writeFile(join(output,'results.json'),JSON.stringify({passed:true,checks,checkoutPosts:posts.map(p=>({receiptRequested:p.receiptRequested,receiptRecipientName:p.receiptRecipientName,receiptPurposeText:p.receiptPurposeText})),invoicePosts,liveWrites:0,pageErrors,serverErrors,externalRequests},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));await context.close();
} catch (error) {
  const state = page && !page.isClosed() ? await page.evaluate(() => document.body.innerText.slice(-6000)) : '';
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, posts, pageErrors, serverErrors, externalRequests, state }, null, 2));
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); stop(); }
