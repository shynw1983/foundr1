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
const output = resolve(args.output || '/private/tmp/foundr1-pos-immediate-20261103/evidence/pos-ui');
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
const item = { id: 'instant-drink', brandId: brand.id, brandName: brand.name, name: '缶ウーロン茶', productionType:'drink',fulfillmentMode:'immediate', displayNames: { ja:'缶ウーロン茶' }, itemKind:'drink', category:'飲料',imageUrl:'',basePrice:300,priceOverride:null,posPricingMode:'fixed',posWeightUnit:'g',posWeightUnitPrice:null,isAvailable:true,variableSchema:{} };
const bowl={...item,id:'prepared-bowl',name:'麻辣湯',displayNames:{ja:'麻辣湯'},productionType:'bowl',fulfillmentMode:'prepare',itemKind:'buildable_product',category:'麻辣湯',basePrice:1000};

const printer = { deviceType: 'escpos_network', connectionType: 'lan', host: '127.0.0.2', port: 9100, identifier: '', paperWidth: '80mm', characterEncoding: 'shift_jis', cutPaper: true, openCashDrawer: true };
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Pos from './app/store/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';import{StoreThemeProvider}from'./app/store/components/StoreThemeProvider';import Display from './app/store/pos/customer-display/CustomerDisplayWorkspace';
localStorage.setItem('foundr1-os-language',new URLSearchParams(location.search).get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
window.__prints=[];window.__printFailure=false;if(new URLSearchParams(location.search).get('bridge')==='yes')window.Foundr1Printer={isAvailable:()=>true,print:payload=>{window.__prints.push(JSON.parse(payload));return JSON.stringify(window.__printFailure?{ok:false,error:"Fixture unknown send"}:{ok:true})}};
let fixtureRoot;window.__remountPos=()=>{fixtureRoot?.unmount();fixtureRoot=createRoot(document.getElementById('root'));fixtureRoot.render(<OsTranslationProvider><StoreThemeProvider employeeId="fixture-employee">{new URLSearchParams(location.search).get("view")==="display"?<Display/>:<Pos/>}</StoreThemeProvider></OsTranslationProvider>)};window.__remountPos();`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', charset: 'utf8', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'local-fixture-only', setup(b) {
  b.onResolve({ filter: /^next\/(link|navigation)$/ }, a => ({ path: a.path, namespace: 'fixture-navigation' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-navigation' }, a => ({ contents: a.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` : `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`, loader: 'js', resolveDir: source }));
  b.onResolve({ filter: /shared-pusher-client$/ }, a => ({ path: a.path, namespace: 'fixture-pusher' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture-pusher' }, () => ({ contents: `export function acquireSharedPusher(){return{connection:{state:'connected',bind(){},unbind(){}},subscribe(){return{name:'private-checkout-fixture',subscribed:true,bind(event,fn){if(event==='pusher:subscription_succeeded')queueMicrotask(fn)},unbind(){}}},unsubscribe(){},disconnect(){}}}`, loader: 'js' }));
} }] });
const css = await readFile(join(source, 'app/globals.css'), 'utf8') + '\n' + await readFile(join(source, 'app/store/store-responsive.css'), 'utf8') + '\n' + (bundle.outputFiles.find(f => f.path.endsWith('.css'))?.text || '');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
let settings, posts, rejectCheckout, checkoutResponses, customerDisplayPosts, serverPrintContract;let includeBowl=false,previewAccounting=false;
function reset({ enabled = false, receiptEnabled = false, reject = false, serverDocuments = false } = {}) {
  settings = { enabled, receiptEnabled, kitchenEnabled: true, receiptPrinter: printer, kitchenPrinter: printer, customerDisplay: { enabled: false } };
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
      return send(res, { ok: true, selectedStoreId:store.id,access:{stores:[store]},state: previewAccounting?{revision:1,serverNow:new Date().toISOString(),status:'complete',storeName:store.name,numberKind:'accounting',pickupCode:'DFIXTURE1',subtotal:300,paymentMethod:'cash',cashTenderedAmount:1000,cashChangeAmount:700,items:[{name:item.name,quantity:1,unitPrice:300,amount:300,optionLabel:'',weightLabel:''}]}:{ status: 'advertising', weighingRevision: 0 }, customerDisplayMediaSettings: { weighing: { enabled: false } } });
    }
    if (url.pathname === '/api/store/pos/summary')return send(res,{selectedStoreId:store.id,todaySummary:summary});
    if (url.pathname === '/api/store/pos/reconciliation') return send(res, { selectedStoreId:store.id,businessDate: '2026-10-20', activeSession: openSession, sessions: [openSession], movements: [], activeCashResponsibleEmployees: [] });
    if (url.pathname.includes('/device-relay')) return send(res, { stations: [], jobs: [], canManage: true, serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos' && req.method === 'POST') {
      let raw = ''; for await (const part of req) raw += part; const body = JSON.parse(raw); posts.push(body);
      if (rejectCheckout) return send(res, { error: 'Fixture: メニューが更新されました。商品と金額を確認してください。' }, 409);
      assert.equal(body.posFulfillmentPolicyVersion,1);
      const total=body.items.reduce((sum,row)=>sum+row.quantity*(row.menuCatalogItemId===bowl.id?1000:300),0);
      const servingTickets=body.items.flatMap((row,index)=>row.menuCatalogItemId===bowl.id?[{itemIndex:index,pickupCode:'001',itemId:'fixture-bowl',taskId:'fixture-task'}]:[]);
      const response={ok:true,orderId:'fixture-order',pickupCode:'DFIXTURE1',servingTickets,hasPreparation:servingTickets.length>0,posFulfillmentPolicyVersion:1,amount:total,subtotalAmount:total,taxableAmount:total,taxAmount:Math.round(total/11),taxRate:10,priceTaxMode:'tax_included',discountAmount:0,couponDiscountAmount:0,cashTenderedAmount:body.cashTenderedAmount,cashChangeAmount:body.cashTenderedAmount-total,receiptRequested:body.receiptRequested,todaySummary:{...summary,orderCount:1,total,average:total}};
      if (serverPrintContract) response.printDocuments = { version: 1, orderId: 'fixture-order', mode: body.printMode, documentCount: 4, pendingCount: 4 };
      checkoutResponses.push(response); return send(res, response);
    }
    if (url.pathname === '/api/store/pos') return send(res, { selectedStoreId: store.id, access: { role: 'owner', stores: [store] }, brands: [brand], items: includeBowl?[bowl,item]:[item], categories: [], optionGroups: [], dineInMenuRevision:'fixture-dine-in-revision', posMenuRevision: 'fixture-revision', todaySummary: summary, posSettings: { dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: 'KOMOJU', priceTaxMode: 'tax_included', discountPresets: [], printerSettings: settings, customerDisplayMediaSettings: { weighing: { enabled: false } } } });
    if (url.pathname.startsWith('/api/')) return send(res, { items: [], notifications: [], unreadCount: 0 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  } catch (error) { serverErrors.push(error.stack); send(res, { error: error.message }, 500); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true, timeout: 30000, dumpio: Boolean(process.env.POS_CHECKOUT_UI_DEBUG) });
const results=[],errors=[],external=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));
const check=(name,value)=>{assert(value,name);results.push(name)};
async function create({mixed=false,receipt=true,width=800}={}){
 reset({enabled:true,receiptEnabled:receipt});includeBowl=mixed;
 const context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width,height:1000});page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(base+'/'))return r.continue();external.push(r.url());return r.abort()});
 await page.goto(base+'/store/pos?bridge=yes',{waitUntil:'domcontentloaded'});try{await page.waitForSelector('.store-pos-item-button:not(:disabled)',{timeout:7000})}catch(e){console.log('CREATE-DEBUG',await page.evaluate(()=>document.body.innerText),errors,serverErrors);throw e}
 return{context,page};
}
async function add(page,label){await page.evaluate(label=>[...document.querySelectorAll('.store-pos-item-button')].find(x=>x.innerText.includes(label))?.click(),label);await pause(40)}
async function pay(page,amount='2000'){
 if(await page.$('.store-pos-floating-checkout button'))await page.evaluate(()=>document.querySelector('.store-pos-floating-checkout button')?.click());
 await page.waitForSelector('.store-pos-cash-payment input');await page.type('.store-pos-cash-payment input',amount);await page.waitForFunction(()=>!document.querySelector('.store-pos-checkout').disabled);await page.evaluate(()=>document.querySelector('.store-pos-checkout').click());await page.waitForFunction(()=>document.querySelectorAll('.store-pos-cart-list >.store-pos-cart-row').length===0);await pause(80);
}
async function data(page){return page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('foundr1-store-offline');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)}),out={};for(const name of['pos-print-jobs','pos-orders','pos-checkout-recovery'])out[name]=await new Promise((resolve,reject)=>{const r=db.transaction(name,'readonly').objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();return out})}
try{
 let{page,context}=await create({receipt:false,width:390});await add(page,'缶ウーロン茶');await pay(page);
 check('Immediate-only kitchen-enabled sale selects printMode none when receipt disabled',posts.length===1&&posts[0].printMode==='none');
 check('Online request declares fulfillment version and trusted line snapshot',posts[0].posFulfillmentPolicyVersion===1&&posts[0].items[0].fulfillmentMode==='immediate'&&posts[0].dineInMenuRevision==='fixture-dine-in-revision');
 check('Immediate-only with no receipt creates no kitchen output or local jobs',await page.evaluate(()=>__prints.length)===0&&(await data(page))['pos-print-jobs'].length===0);
 check('Immediate-only confirmation uses accounting identity label',await page.evaluate(()=>document.body.innerText.includes('会計番号 DFIXTURE1')));await context.close();
 ({page,context}=await create({receipt:true}));await add(page,'缶ウーロン茶');await pay(page);const printed=await page.evaluate(()=>__prints);
 check('Immediate-only legacy/direct checkout prints exactly one receipt',printed.length===1&&printed[0].jobType==='receipt'&&printed[0].order.items[0].name==='缶ウーロン茶');
 const direct=await data(page);check('Direct immediate receipt has durable sent evidence',direct['pos-print-jobs'].length===1&&direct['pos-print-jobs'][0].state==='sent');check('Direct immediate receipt retains raw accounting ID',printed[0].order.pickupCode==='DFIXTURE1');await context.close();
 ({page,context}=await create({mixed:true}));await add(page,'麻辣湯');await add(page,'缶ウーロン茶');await pay(page);const mixedPrints=await page.evaluate(()=>__prints);
 check('Mixed bowl+instant checkout prints three bowl roles and receipt',mixedPrints.length===4&&mixedPrints.filter(p=>p.jobType==='kitchen').length===3&&mixedPrints.at(-1).jobType==='receipt');
 check('Mixed kitchen documents exclude standalone immediate drink',mixedPrints.slice(0,3).every(p=>p.order.items.length===1&&p.order.items[0].name==='麻辣湯'));
 check('Mixed receipt contains all paid lines and amounts',mixedPrints.at(-1).order.items.length===2&&mixedPrints.at(-1).order.totalAmount===1300);await context.close();
 ({page,context}=await create({receipt:true}));await add(page,'缶ウーロン茶');await pause(100);await page.setOfflineMode(true);await page.evaluate(()=>{window.__printFailure=true});await pay(page,'1000');const offline=await data(page);
 check('Offline sale persists fulfillment version and immediate mode',offline['pos-orders'].length===1&&offline['pos-orders'][0].request.posFulfillmentPolicyVersion===1&&offline['pos-orders'][0].request.items[0].fulfillmentMode==='immediate');
 check('Offline immediate-only sale has no serving tickets and retains all totals',offline['pos-orders'][0].localResponse.hasPreparation===false&&offline['pos-orders'][0].localResponse.servingTickets.length===0&&offline['pos-orders'][0].localResponse.amount===300);
 check('Unknown offline receipt persists failed evidence without kitchen output',offline['pos-print-jobs'].length===1&&offline['pos-print-jobs'][0].kind==='receipt'&&offline['pos-print-jobs'][0].state==='failed'&&await page.evaluate(()=>__prints.length)===1);
 await page.evaluate(()=>__remountPos());await page.waitForSelector('.store-pos-item-button:not(:disabled)');await pause(100);
 check('Reload of offline unknown receipt never prints a second time',await page.evaluate(()=>__prints.length)===1);
 await page.setOfflineMode(false);await page.waitForFunction(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('foundr1-store-offline');q.onsuccess=()=>r(q.result)});const rows=await new Promise(r=>{const q=db.transaction('pos-orders').objectStore('pos-orders').getAll();q.onsuccess=()=>r(q.result)});db.close();return rows.length===0});
 check('Offline sync reuses one immutable checkout request identity',posts.length===1&&posts[0].offlineClientOrderId===offline['pos-orders'][0].clientOrderId&&posts[0].offlineQueued===true);
 check('Offline reconnect does not automatically reprint unknown receipt',await page.evaluate(()=>__prints.length)===1);await context.close();
 previewAccounting=true;
 const displayContext=await browser.createBrowserContext(),displayPage=await displayContext.newPage();displayPage.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));await displayPage.setViewport({width:844,height:390});await displayPage.goto(base+'/store/pos?view=display&storeId='+store.id,{waitUntil:'domcontentloaded'});await displayPage.waitForFunction(()=>document.body.innerText.includes('会計番号 DFIXTURE1'));check('Customer display labels immediate-only accounting ID without inventing a pickup number',await displayPage.$eval('[data-customer-display-number]',e=>e.textContent.includes('会計番号 DFIXTURE1')));check('Accounting label fits existing landscape phone customer display',await displayPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await displayPage.screenshot({path:join(output,'customer-display-accounting-844x390.png'),fullPage:true});await displayContext.close();
 console.log('BROWSER-CHECK',JSON.stringify({errors,serverErrors,external}));check('No browser runtime exceptions or external business requests',errors.length===0&&serverErrors.length===0&&external.length===0);
 await writeFile(join(output,'results.json'),JSON.stringify({passed:true,checks:results.length,results,errors,serverErrors,external,synthetic:true,productionWrites:0,physicalPrints:0},null,2));console.log(JSON.stringify({passed:true,checks:results.length,output}));
}finally{await browser.close();await new Promise(r=>server.close(r));stop()}
