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

const summary = { orderCount: 2, total: 2945, average: 1473, latestOrders: [], products: [{key:'catalog:bowl:bowl',name:'麻辣湯',isBowl:true,quantity:3,total:2545,average:848},{key:'catalog:drink:item',name:'烏龍茶',isBowl:false,quantity:2,total:400,average:200}] };
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
      let raw = ''; for await (const part of req) raw += part; const body = JSON.parse(raw); posts.push(body); Object.assign(summary,{orderCount:3,total:3645,average:1215,products:[{...summary.products[0],quantity:4,total:3245,average:811},summary.products[1]]});
      return send(res, { ok: true, orderId: `fixture-order-${posts.length}`, pickupCode: 'D-FIXTURE', servingTickets: [], amount: 700, subtotalAmount: 700, taxableAmount: 700, taxAmount: 63, taxRate: body.orderType === 'eat_in' ? 10 : 8, priceTaxMode: 'tax_included', discountAmount: 0, couponDiscountAmount: 0, cashTenderedAmount: body.cashTenderedAmount, cashChangeAmount: body.cashTenderedAmount - 700, receiptRequested: body.receiptRequested === true, todaySummary: summary });
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
 const card='[data-pos-daily-summary]';
 const clickMode=async text=>{await page.$$eval('[data-pos-daily-summary] button',(bs,text)=>bs.find(b=>b.textContent===text).click(),text)};
 const metrics=()=>page.$eval(card,e=>[e.querySelector('[data-summary-count]')?.textContent,e.querySelector('[data-summary-total]')?.textContent,e.querySelector('[data-summary-average]')?.textContent]);
 const ready=async()=>{await page.goto(base+'/store/pos?lang=ja',{waitUntil:'domcontentloaded'});await page.waitForSelector('.store-pos-item-button:not(:disabled)');await page.waitForSelector(card);};
 for(const width of [390,768,1024,1440]){
   await page.setViewport({width,height:1024});await ready();await clickMode('会計別');assert.deepEqual(await metrics(),['2 件','¥2,945','平均 ¥1,473']);
   await clickMode('商品別');await page.waitForSelector(card+' select');assert.deepEqual(await metrics(),['3 杯','¥2,545','1杯平均 ¥848']);
   const bounds=await page.$eval(card,e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth}});assert(bounds.left>=0&&bounds.right<=width+1&&!bounds.overflow,JSON.stringify(bounds));assert(bounds.height<150,JSON.stringify(bounds));
   await page.screenshot({path:join(output,'bowl-'+width+'.png'),fullPage:true});checks.push(width+':compact_payment_product_switch_and_bowl_metrics_no_overflow');
   await page.select(card+' select','catalog:drink:item');assert.deepEqual(await metrics(),['2 点','¥400','1点平均 ¥200']);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector(card+' select');assert.deepEqual(await metrics(),['2 点','¥400','1点平均 ¥200']);checks.push(width+':drink_selection_and_mode_survive_reload');
   await page.select(card+' select','catalog:bowl:bowl');
 }
 await page.setViewport({width:768,height:1024});await ready();await page.evaluate(()=>{localStorage.setItem('foundr1-pos-daily-summary:11111111-1111-4111-8111-111111111111','{bad-json')});await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector(card);assert.equal(await page.$eval(card+' button',e=>e.getAttribute('aria-pressed')),'true');checks.push('corrupt_storage_falls_back_to_payment_summary');
 await clickMode('商品別');await page.select(card+' select','catalog:drink:item');
 await page.evaluate(()=>localStorage.setItem('foundr1-pos-daily-summary:11111111-1111-4111-8111-111111111111',JSON.stringify({mode:'product',productKey:'deleted'})));await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector(card+' select');assert.deepEqual(await metrics(),['3 杯','¥2,545','1杯平均 ¥848']);checks.push('missing_saved_product_falls_back_to_available_bowl');
 // Live checkout response changes the same actual card without resetting its mode.
 await addConfigured(localItem.name,localGroup.options[0].name);await page.$eval('.store-pos-floating-checkout button',e=>e.click());const cash=await page.$('.store-pos-cash-payment input');await cash.click({clickCount:3});await cash.type('1000');await page.waitForFunction(()=>!document.querySelector('.store-pos-checkout').disabled);await page.$eval('.store-pos-checkout',e=>e.click());await page.waitForFunction(()=>document.querySelector('[data-summary-count]')?.textContent==='4 杯');assert.deepEqual(await metrics(),['4 杯','¥3,245','1杯平均 ¥811']);assert.equal(posts.length,1);checks.push('checkout_response_updates_product_quantities_and_keeps_view');
 // Empty days, old offline cache, provisional and translated UI are explicit.
 const original=structuredClone(summary);summary.orderCount=0;summary.total=0;summary.average=0;summary.products=[];await ready();await clickMode('商品別');assert.deepEqual(await metrics(),['0 点','¥0','1点平均 ¥0']);assert(await page.$eval(card,e=>e.textContent.includes('本日の販売商品はありません。')));checks.push('empty_day_has_zero_metrics_without_stale_product');
 delete summary.products;await ready();await clickMode('商品別');assert(await page.$eval(card,e=>e.textContent.includes('商品別集計はオンラインで更新してください。')));assert.equal(await page.$('[data-summary-count]'),null);checks.push('old_offline_cache_does_not_present_missing_product_data_as_zero_sales');
 Object.assign(summary,original,{pendingSync:true});await ready();assert(await page.$eval(card,e=>e.textContent.includes('未同期の会計を含む概算')));checks.push('offline_projection_is_marked_provisional');delete summary.pendingSync;
 await page.goto(base+'/store/pos?lang=zh-Hans',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('[data-pos-daily-summary]')?.textContent.includes('按商品'));assert(await page.$eval(card,e=>e.textContent.includes('每碗均价')));checks.push('Chinese_switch_labels_and_per_bowl_average_are_translated');
 assert.deepEqual(pageErrors,[]);assert.deepEqual(serverErrors,[]);assert.deepEqual(externalRequests,[]);await writeFile(join(output,'results.json'),JSON.stringify({passed:true,checks,pageErrors,serverErrors,externalRequests,productionWrites:0},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));await context.close();
} catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,checks,pageErrors,serverErrors,externalRequests,state:page&&!page.isClosed()?await page.evaluate(()=>document.body.innerText.slice(0,6000)):''},null,2));if(page&&!page.isClosed())await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));stop();}
