// Runs the actual POS page and translation layers with an isolated history API fixture.
// All HTTP and native responses are synthetic; external requests are blocked.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const source = resolve(args.source || process.cwd());
const output = resolve(args.output || '/private/tmp/pos-option-refunds-ui');
const requireSource = createRequire(join(source, 'package.json'));
const { build, stop } = requireSource('esbuild');
const puppeteer = requireSource('puppeteer-core');
await mkdir(output, { recursive: true });
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async lang => [lang, JSON.parse(await readFile(join(source, `public/locales/os/${lang}.json`), 'utf8'))])));
const store = { id: '11111111-1111-4111-8111-111111111111', name: '清水店', brandIds: ['fixture-maamaa'] };
const brand = { id: 'fixture-maamaa', name: 'まぁ麻' };
const item = { id: 'fixture-soup', brandId: brand.id, brandName: brand.name, name: '麻辣湯スープ', displayNames: { ja: '麻辣湯スープ' }, itemKind: 'buildable_product', category: 'スープ', imageUrl: '', basePrice: 815, priceOverride: null, posPricingMode: 'fixed', posWeightUnit: 'g', posWeightUnitPrice: null, isAvailable: true, variableSchema: {} };
const printer = { deviceType: 'escpos_network', connectionType: 'lan', host: '127.0.0.2', port: 9100, identifier: '', paperWidth: '80mm', characterEncoding: 'shift_jis', cutPaper: true, openCashDrawer: true };
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';import{StoreThemeProvider}from'./app/store/components/StoreThemeProvider';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
createRoot(document.getElementById('root')).render(<OsTranslationProvider><StoreThemeProvider employeeId="fixture-employee"><Pos/></StoreThemeProvider></OsTranslationProvider>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', charset: 'utf8', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'local-fixture-only', setup(b) {
  b.onResolve({ filter: /^next\/(link|navigation)$/ }, a => ({ path: a.path, namespace: 'fixture-navigation' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-navigation' }, a => ({ contents: a.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` : `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`, loader: 'js', resolveDir: source }));
  b.onResolve({ filter: /shared-pusher-client$/ }, a => ({ path: a.path, namespace: 'fixture-pusher' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-pusher' }, () => ({ contents: `export function acquireSharedPusher(){return{connection:{bind(){}},subscribe(){return{name:'private-checkout-fixture',bind(event,fn){if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(){}}},unsubscribe(){},disconnect(){}}}`, loader: 'js' }));
} }] });
const css = await readFile(join(source, 'app/globals.css'), 'utf8') + '\n' + await readFile(join(source, 'app/store/store-responsive.css'), 'utf8') + '\n' + (bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text || '');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const historyRequests = [];
let fixtureDetail, refundRequests = [], receipts = new Map(), rejectFirst = false;
function resetRefund(method='cash', reject=false) {
 refundRequests=[];receipts=new Map();rejectFirst=reject;
 fixtureDetail={id:'multi-bowl',pickupCode:'D-20261025-001',amount:1600,status:'preparing',paymentStatus:'paid',paymentMethod:method,cashSessionStatus:'open',createdLabel:'10/25 12:01',cashierName:'Fixture',cashTenderedAmount:null,cashChangeAmount:null,items:[{
 id:'fixture-order-item',name:'麻辣湯',pickupCode:'037',quantity:1,measuredQuantity:250,measuredUnit:'g',measuredUnitPrice:4,amount:1600,grossAmount:1600,paidAmount:1600,remainingPaidAmount:1600,refundStatus:'',refundedAmount:0,toppings:['コーラ','緑茶'],refundOptions:[{key:'0:0',groupName:'追加飲料',label:'コーラ',quantity:1,paidAmount:350,refunded:false},{key:'0:1',groupName:'追加飲料',label:'緑茶',quantity:1,paidAmount:250,refunded:false}]
 }]};
}
resetRefund();
const settings = { enabled: false, receiptEnabled: false, kitchenEnabled: false, receiptPrinter: printer, kitchenPrinter: printer, customerDisplay: { enabled: false } };
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
    if (url.pathname === '/api/store/pos/customer-display') {
      return send(res, { ok: true, state: { status: 'advertising', weighingRevision: 0 }, customerDisplayMediaSettings: { weighing: { enabled: false } } });
    }
    if (url.pathname === '/api/store/pos/reconciliation') return send(res, { businessDate: '2026-10-20', activeSession: openSession, sessions: [openSession], movements: [], activeCashResponsibleEmployees: [] });
    if (url.pathname.includes('/device-relay')) return send(res, { stations: [], jobs: [], canManage: true, serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos/transactions') {
      if(req.method==='POST'){
        let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);refundRequests.push(body);
        assert.equal(body.orderId,fixtureDetail.id);assert.equal(body.storeId,store.id);assert.match(body.requestId,/^[0-9a-f-]{36}$/i);
        assert.deepEqual(body.itemIds,[],'Option-only refund must not include its parent');assert.equal(body.optionSelections.length,1);
        if(!receipts.has(body.requestId)){
          const selected=fixtureDetail.items[0].refundOptions.find(o=>o.key===body.optionSelections[0].key);assert(selected&&!selected.refunded);
          assert.equal(body.optionSelections[0].itemId,'fixture-order-item');
          if(fixtureDetail.paymentMethod!=='cash')assert.equal(body.externalRefundConfirmed,true);
          selected.refunded=true;fixtureDetail.amount-=selected.paidAmount;fixtureDetail.paymentStatus='partial_refunded';fixtureDetail.items[0].remainingPaidAmount-=selected.paidAmount;fixtureDetail.items[0].refundedAmount+=selected.paidAmount;fixtureDetail.items[0].refundStatus='partial';
          receipts.set(body.requestId,selected.paidAmount);
        }
        if(rejectFirst){rejectFirst=false;return send(res,{error:'返金は記録済みです。同じ内容で再試行して連携を更新してください。',refundRecorded:true},503);}
        return send(res,{ok:true,requestId:body.requestId,refundAmount:receipts.get(body.requestId),selectedTransaction:fixtureDetail,transactions:[{...fixtureDetail,items:undefined,servingPickupCodes:['037']}],todaySummary:{orderCount:1,total:fixtureDetail.amount,average:fixtureDetail.amount}});
      }
      historyRequests.push(url.search);
      return send(res,{transactions:[{...fixtureDetail,items:undefined,servingPickupCodes:['037']}],selectedTransaction:url.searchParams.has('orderId')?fixtureDetail:null});
    }
    if (url.pathname === '/api/store/pos' && req.method === 'POST') throw new Error('History verification must never create a sale');
    if (url.pathname === '/api/store/pos') return send(res, { selectedStoreId: store.id, access: { role: 'owner', stores: [store] }, brands: [brand], items: [item], categories: [], optionGroups: [], posMenuRevision: 'fixture-revision', todaySummary: summary, posSettings: { dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: 'KOMOJU', priceTaxMode: 'tax_included', discountPresets: [{ key: 'student', name: '学割 20%OFF', discountType: 'percent', discountValue: 20, targetScope: 'all', targetValue: '', enabled: true, stampEligible: false, allowCouponCombination: false }], printerSettings: settings, customerDisplayMediaSettings: { weighing: { enabled: false } } } });
    if (url.pathname.startsWith('/api/')) return send(res, { items: [], notifications: [], unreadCount: 0 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  } catch (error) { serverErrors.push(error.stack); send(res, { error: error.message }, 500); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true, timeout: 30000, dumpio: Boolean(process.env.POS_CHECKOUT_UI_DEBUG) });
const results = [], pageErrors = [], externalRequests = [];
let currentPage;
async function geometry(page, selector) {
  return page.$eval(selector, async el => {
    el.scrollIntoView({ block: 'center' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = el.getBoundingClientRect(), top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { text: el.textContent, x: rect.x, y: rect.y, right: rect.right, width: rect.width, height: rect.height, hit: top === el || el.contains(top), scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
  });
}
function assertGeometry(info) { assert.ok(info.width > 0 && info.height > 0); assert.ok(info.hit, `Control/alert obscured: ${JSON.stringify(info)}`); assert.ok(info.x >= -1 && info.right <= info.viewportWidth + 1); assert.ok(info.scrollWidth <= info.viewportWidth + 1, `Horizontal overflow: ${JSON.stringify(info)}`); }
async function openDetail(width,language,method='cash',reject=false){
 resetRefund(method,reject);historyRequests.length=0;
 const context=await browser.createBrowserContext(),page=await context.newPage();currentPage=page;
 page.on('pageerror',error=>pageErrors.push(error.message));await page.setViewport({width,height:1000});await page.setRequestInterception(true);
 page.on('request',request=>{if(request.url().startsWith(base+'/'))return request.continue();externalRequests.push(request.url());return request.abort();});
 await page.goto(`${base}/store/pos?lang=${language}`,{waitUntil:'domcontentloaded'});await page.waitForSelector('.store-pos-item-button:not(:disabled)');
 if(language!=='ja')await page.waitForFunction(()=>document.querySelector('.store-pos-head-actions button').textContent.includes('交易'));
 await page.$eval('.store-pos-item-button',el=>el.click());await page.waitForFunction(()=>document.querySelectorAll('.store-pos-cart-row').length===1);
 await page.click('.store-pos-head-actions button');await page.waitForSelector('.store-pos-transaction-list button');await page.click('.store-pos-transaction-list button');await page.waitForSelector('[data-pos-refund-item]');
 assert.equal(await page.$eval('[data-pos-refund-item]',el=>el.getAttribute('aria-pressed')),'false','Never preselect a whole bowl');assert.equal(await page.$eval('[data-pos-refund-submit]',el=>el.disabled),true);
 return{page,context};
}
const optionSelector=key=>`[data-pos-refund-option="fixture-order-item/${key}"]`;
try{
 for(const language of ['ja','zh-Hans','zh-Hant'])for(const width of [390,800,1366]){
  const{page,context}=await openDetail(width,language);
  await page.click(optionSelector('0:0'));assert.equal(await page.$eval('[data-pos-refund-item]',el=>el.getAttribute('aria-pressed')),'false');
  assert.match(await page.$eval('.store-pos-selected-refund-item',el=>el.innerText),/350/);
  assertGeometry(await geometry(page,'[data-pos-refund-submit]'));
  await page.screenshot({path:join(output,`option-refund-${language}-${width}.png`),fullPage:true});await page.click('[data-pos-refund-submit]');
  await page.waitForFunction(()=>document.querySelector('[data-pos-refund-option="fixture-order-item/0:0"]').getAttribute("data-refunded")==="true");
  assert.equal(refundRequests.length,1);assert.equal(fixtureDetail.amount,1250);assert.equal(fixtureDetail.items[0].refundStatus,'partial');assert.equal(fixtureDetail.items[0].pickupCode,'037');
  // Choosing the entire bowl then an option must automatically remove the parent.
  await page.click('[data-pos-refund-item]');await page.click(optionSelector('0:1'));assert.equal(await page.$eval('[data-pos-refund-item]',el=>el.getAttribute('aria-pressed')),'false');
  await page.click('[data-pos-refund-submit]');await page.waitForFunction(()=>document.querySelector('[data-pos-refund-option="fixture-order-item/0:1"]').getAttribute("data-refunded")==="true");assert.equal(fixtureDetail.amount,1000);assert.equal(refundRequests.length,2);assert.notEqual(refundRequests[0].requestId,refundRequests[1].requestId);
  await page.click('.store-pos-transaction-head > button');assert.equal(await page.$$eval('.store-pos-cart-row',r=>r.length),1);results.push({name:'sequential-options-preserve-bowl-and-cart',language,width,amount:fixtureDetail.amount,passed:true});await context.close();
 }
 {
  const{page,context}=await openDetail(390,'ja','card');await page.click(optionSelector('0:0'));assert.equal(await page.$eval('[data-pos-refund-submit]',el=>el.disabled),true);assert.equal(refundRequests.length,0);
  await page.click('.store-pos-external-refund-check input');await page.click('[data-pos-refund-submit]');await page.waitForFunction(()=>document.querySelector('[data-pos-refund-option="fixture-order-item/0:0"]').getAttribute("data-refunded")==="true");assert.equal(refundRequests.length,1);assert.equal(refundRequests[0].externalRefundConfirmed,true);results.push({name:'external-terminal-confirmation',passed:true});await context.close();
 }
 {
  const{page,context}=await openDetail(390,'zh-Hans','cash',true);await page.click(optionSelector('0:0'));await page.click('[data-pos-refund-submit]');await page.waitForSelector('.store-pos-refund-panel [role="alert"]');
  assertGeometry(await geometry(page,'.store-pos-refund-panel [role="alert"]'));await page.screenshot({path:join(output,'recorded-error-retry.png'),fullPage:true});
  await page.click('[data-pos-refund-submit]');await page.waitForFunction(()=>document.querySelector('[data-pos-refund-option="fixture-order-item/0:0"]').getAttribute("data-refunded")==="true");assert.equal(refundRequests.length,2);assert.equal(refundRequests[0].requestId,refundRequests[1].requestId);assert.equal(fixtureDetail.amount,1250);results.push({name:'lost-response-reuses-request-and-keeps-inline-feedback',passed:true});await context.close();
 }
 assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(serverErrors,[]);
 const report={passed:true,synthetic:true,liveWrites:0,scenarios:results.length,results,pageErrors,serverErrors};await writeFile(join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,scenarios:results.length,output}));
}catch(error){if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:join(output,'failure.png'),fullPage:true});await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,results,pageErrors,serverErrors,refundRequests},null,2));throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));stop();}
