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
const output = resolve(args.output || 'outputs/store-dine-in-pricing-pos-ui');
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
const baseItem = { id: localId, sourceItemId: canonicalId, brandId: brand.id, brandName: brand.name, name: '基礎麻辣湯', displayNames: {}, itemKind: 'buildable_product', productionType: 'bowl', category: '料理', imageUrl: '', basePrice: 0, priceOverride: null, posPricingMode: 'weight', posWeightUnit: 'g', posWeightUnitPrice: 4, isAvailable: true, variableSchema: { posWeightPricing: { mode: 'weight', unit: 'g' } }, optionGroupIds: [localGroupId, canonicalGroupId] };
// Deliberately retain the old blanket mode in these cached-shaped entries. The
// actual React pricing resolver must still treat fixed foods/drinks per portion.
const foodItem = { ...baseItem, id: '88888888-8888-4888-8888-888888888888', sourceItemId: '99999999-9999-4999-8999-999999999999', name: '単品おにぎり', itemKind: 'fixed_product', productionType: 'item', basePrice: 300, variableSchema: {}, optionGroupIds: [] };
const drinkItem = { ...foodItem, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '自家製レモン水', itemKind: 'drink', productionType: 'drink', basePrice: 350, variableSchema: { posWeightPricing: { mode: 'weight' } } };
const noodle = { id: localOptionId, optionKey: 'noodle', name: '刀削麺 50g', displayNames: {}, applicableCategories: [], priceDelta: 200, sortOrder: 0 };
const beef = { ...noodle, id: canonicalOptionId, optionKey: 'beef', name: '牛筋 50g', priceDelta: 650 };
const noodleGroup = { id: localGroupId, brandId: brand.id, menuCatalogItemId: localId, applicableCategories: [], groupKey: 'noodle-addition', name: '麺', posEnabled: true, selectionType: 'quantity', ruleJson: { minSelections: 0, maxSelections: 10, allowRepeat: true, perOptionMax: 10, portionGrams: 50 }, sortOrder: 0, options: [noodle] };
const addonGroup = { ...noodleGroup, id: canonicalGroupId, groupKey: 'premium', name: '加料', options: [beef] };
const item=baseItem,localItem=baseItem,group=noodleGroup,localGroup=addonGroup;
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
    if (url.pathname === '/api/store/pos/print-documents') return send(res, { version: 1, selectedStoreId: store.id, documents: [], summary: { pendingDocuments: 0, pendingOrders: 0, needsReview: 0, sendingDocuments: 0 }, hasMore: false, cursor: null, relay: { available: false, online: false }, serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos/customer-display') {
      if (req.method === 'POST') { let raw = ''; for await (const part of req) raw += part; customerDisplayPosts.push(JSON.parse(raw)); }
      return send(res, { ok: true, state: { status: 'advertising', weighingRevision: 0 }, customerDisplayMediaSettings: { weighing: { enabled: false } } });
    }
    if (url.pathname === '/api/store/pos/reconciliation') return send(res, { businessDate: '2026-10-20', activeSession: openSession, sessions: [openSession], movements: [], activeCashResponsibleEmployees: [] });
    if (url.pathname.includes('/device-relay')) return send(res, { stations: [], jobs: [], canManage: true, serverNow: new Date().toISOString() });
    if (url.pathname === '/api/store/pos' && req.method === 'POST') {
      let raw = ''; for await (const part of req) raw += part; const body = JSON.parse(raw); posts.push(body);
      return send(res, { ok: true, orderId: `fixture-order-${posts.length}`, pickupCode: 'D-FIXTURE', servingTickets: [], amount: body.offlineExpectedAmount, subtotalAmount: body.offlineExpectedAmount, taxableAmount: body.offlineExpectedAmount, taxAmount: Math.round(body.offlineExpectedAmount / 11), taxRate: body.orderType === 'eat_in' ? 10 : 8, priceTaxMode: 'tax_included', discountAmount: 0, couponDiscountAmount: 0, cashTenderedAmount: body.cashTenderedAmount, cashChangeAmount: body.cashTenderedAmount - body.offlineExpectedAmount, receiptRequested: false, todaySummary: { ...summary, orderCount: posts.length, total: 700 * posts.length, average: 700 } });
    }
    if (url.pathname === '/api/store/pos') return send(res, { selectedStoreId: store.id, access: { role: 'owner', stores: [store] }, brands: [brand], items: [baseItem,foodItem,drinkItem], categories: [], optionGroups: [noodleGroup,addonGroup], dineInMenu: { items: [baseItem,foodItem,drinkItem], categories: [], optionGroups: [noodleGroup,addonGroup] }, dineInMenuRevision: 'dine-in-fixture:17', posMenuRevision: 'canonical-fixture:4', todaySummary: summary, posSettings: { dineInEnabled: true, takeoutEnabled: true, dineInTaxRate: 10, takeoutTaxRate: 8, externalPaymentTerminalBrand: 'KOMOJU', priceTaxMode: 'tax_included', discountPresets: [], printerSettings: { enabled: false, receiptEnabled: false, kitchenEnabled: false, receiptPrinter: printer, kitchenPrinter: printer, customerDisplay: { enabled: false } }, customerDisplayMediaSettings: { weighing: { enabled: false } } } });
    if (url.pathname.startsWith('/api/')) return send(res, { items: [], documents: [], notifications: [], unreadCount: 0 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  } catch (error) { serverErrors.push(error.stack); send(res, { error: error.message }, 500); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true, timeout: 30000 });
let page;
const tests=[];
async function clickItem(name) {
  const buttons=await page.$$('.store-pos-item-button');
  for(const button of buttons)if((await button.evaluate(el=>el.textContent)).includes(name)){await button.click();return;}
  throw new Error('Item not found '+name);
}
async function waitCart(count){await page.waitForFunction(count=>document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length===count,{},count);}
async function openPayment(){
  if(await page.$eval('.store-pos-cash-payment input',el=>el.getBoundingClientRect().width>0))return;
  const button=await page.$('.store-pos-floating-checkout button');
  if(button)await button.click();
  else await page.$eval('.store-pos-cart-panel',el=>el.scrollIntoView({block:'center'}));
}
try{
  for(const width of [800,1366]){
    const context=await browser.createBrowserContext();page=await context.newPage();page.setDefaultTimeout(20000);
    page.on('pageerror',e=>pageErrors.push(e.message));await page.setViewport({width,height:1100});await page.setRequestInterception(true);
    page.on('request',request=>request.url().startsWith(base+'/')?request.continue():(externalRequests.push(request.url()),request.abort()));
    await page.goto(base+'/store/pos',{waitUntil:'domcontentloaded'});await page.waitForSelector('.store-pos-item-button:not(:disabled)');
    await clickItem(foodItem.name);await waitCart(1);assert.equal(await page.$('.store-pos-option-overlay'),null);
    await clickItem(foodItem.name);assert.equal(await page.$eval('.store-pos-cart-row .store-pos-quantity span',el=>el.textContent),'2');
    assert.equal(await page.$('.store-pos-weight-entry'),null);tests.push({name:'old-blanket-weight-fixed-food-adds-two-portions-without-weight-dialog',width,passed:true});
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.store-pos-item-button:not(:disabled)');
    await clickItem(baseItem.name);await page.waitForSelector('.store-pos-weight-entry input');
    assert.equal(await page.$eval('.store-pos-option-add',el=>el.disabled),true,'Base bowl requires positive weight');
    await page.type('.store-pos-weight-entry input','200');
    for(const name of [noodle.name,beef.name]){
      const choices=await page.$$('.store-pos-option-choice');
      for(const choice of choices)if((await choice.evaluate(el=>el.textContent)).includes(name)){
        const plus=await choice.$('button[aria-label="数量を増やす"]');await plus.click();await plus.click();
        assert.equal(await choice.$eval('.store-pos-option-stepper span',el=>el.textContent),'2');
      }
    }
    assert.match(await page.$eval('.store-pos-weight-entry',el=>el.textContent),/2,500/);
    await page.screenshot({path:join(output,`base-200g-two-noodle-two-addon-${width}.png`),fullPage:true});
    await page.click('.store-pos-option-add');await waitCart(1);await clickItem(drinkItem.name);await waitCart(2);
    assert.equal(await page.$('.store-pos-weight-entry'),null);assert.equal(await page.$('.store-pos-option-overlay'),null);
    tests.push({name:'base200g-times4-plus-two50g-noodles-and-two50g-addons-plus-one-drink',width,passed:true,amount:2850});
    await openPayment();const cash=await page.$('.store-pos-cash-payment input');await cash.click();await cash.type('5000');
    await page.waitForFunction(()=>!document.querySelector('.store-pos-checkout').disabled);
    const total=await page.$eval('.store-pos-cart-panel',el=>el.textContent);assert.match(total,/2,850/);
    await page.screenshot({path:join(output,`mixed-2850-payment-${width}.png`),fullPage:true});
    await page.click('.store-pos-checkout');await page.waitForFunction(()=>document.querySelectorAll('.store-pos-cart-list > .store-pos-cart-row').length===0);
    const post=posts.at(-1);assert.equal(post.offlineExpectedAmount,2850);assert.equal(post.items.length,2);
    const bowl=post.items.find(x=>x.menuCatalogItemId===baseItem.id),drink=post.items.find(x=>x.menuCatalogItemId===drinkItem.id);
    assert.equal(bowl.measuredQuantity,200);assert.equal(bowl.quantity,1);assert.equal(drink.measuredQuantity,null);assert.equal(drink.quantity,1);
    assert.deepEqual(bowl.selectedOptions,[{groupId:localGroupId,optionIds:[noodle.id,noodle.id]},{groupId:canonicalGroupId,optionIds:[beef.id,beef.id]}]);
    tests.push({name:'actual-react-checkout-sends-weight-only-for-base-and-portion-counts-for-options',width,passed:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await context.close();
  }
  assert.deepEqual(serverErrors,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);
  const hashes={};for(const file of ['app/store/pos/page.tsx','lib/pos-item-pricing.ts','scripts/tests/store-dine-in-pricing-pos-ui.mjs'])hashes[file]=sha256(await readFile(join(source,file)));
  const report={passed:tests.length,tests,hashes,actualReactPage:true,apiAndPayments:'synthetic HTTP only; actual server and persistence covered by pricing DB suite',liveWrites:0,pageErrors,serverErrors,externalRequests,posts};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await writeFile(join(output,'executed-test.mjs'),await readFile(new URL(import.meta.url)));console.log(JSON.stringify({passed:tests.length,output}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,tests,posts,pageErrors,serverErrors,externalRequests,state:page&&!page.isClosed()?await page.evaluate(()=>document.body.innerText.slice(-7000)):''},null,2));if(page&&!page.isClosed())await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));stop();}
