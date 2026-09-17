// Renders the real store pages against isolated, synthetic API responses.
// No database, authentication credentials, platform commands, or payments are used.
import { context } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const output = resolve(root, 'outputs/os-responsive-review-20260917/after');
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

fixtures['/api/menus'] = { selectedStoreId: stores[0].id, brands, stores: stores.map(s => ({ ...s, brandIds: [brands[0].id] })), sources: [], categories: [], items: [], groups: [], options: [], itemOptionGroups: [], externalPlatforms: [], syncTasks: [{ id: 'task', brandId: brands[0].id, storeId: stores[0].id, status: 'processing', targetLabel: 'Test', platformName: 'Uber', createdAt: now }], availabilityLinks: [], platformTargetSettings: [], publishBatches: [], platformImportCandidates: [] };
fixtures['/api/menus/progress'] = Object.fromEntries(['externalPlatforms','syncTasks','availabilityLinks','platformTargetSettings','publishBatches','platformImportCandidates'].map(key => [key, fixtures['/api/menus'][key]]));
fixtures['/api/store/menu-sync-runs'] = { runs: [{ id: 'run', itemLabel: 'テスト商品', isAvailable: true, source: 'store', createdAt: now, platforms: [{ commandId: 'command', platform: 'uber_eats', status: 'processing', phase: 'locating', updatedAt: now }] }] };
fixtures['/api/dashboard']={stores,products:[],suppliers:[],orders:[],purchaseOrderItems:[],supplierFulfillments:[],staffOptions:[],priceSignals:[]};
fixtures['/api/os/loyalty']={summary:{memberCount:6,availableCoupons:9}};
fixtures['/api/sales/summary']={month:'2026-09',stores,selectedStoreId:stores[0].id,totals:{orderCount:10,sales:1000,estimatedFee:0,estimatedDeposit:1000,deliveryShare:0,averageOrderValue:100,salesPostedDayCount:2,workTrackedDayCount:1}};
fixtures['/api/settings/payroll-allowances']={rules:[],stores,employees:[]};
const entry = `import OsHome from './app/os/page';import Analytics from './app/os/analytics/page';import Settings from './app/os/settings/page';
import React from 'react';import {createRoot} from 'react-dom/client';
import Home from './app/store/page';import Orders from './app/store/orders/page';import Pos from './app/store/pos/page';import Availability from './app/store/menu/page';import History from './app/store/menu/inventory-history/page';import Timecard from './app/store/timecard/page';import Receiving from './app/store/receiving/page';import Procedures from './app/store/procedures/page';import Seats from './app/store/seats/page';import Pickup from './app/store/display/pickup/page';import Kitchen from './app/store/display/kitchen/page';import Courier from './app/store/display/courier/page';
import MenuAdmin from './app/os/menus/page';import {StoreInventorySyncStatus} from './app/store/components/StoreInventorySyncStatus';
import {OsTranslationProvider} from './app/os/components/OsTranslationProvider';import {FloatingFeedbackButton} from './components/feedback/FloatingFeedbackButton';import {defaultStoreModuleSettings} from './lib/module-setting-defaults';
if(new URLSearchParams(location.search).get('role')==='store_terminal'){window.__fixtures['/api/auth/me'].employee.role='store_terminal';window.__fixtures['/api/os/store-context'].canSelectStore=false;window.__fixtures['/api/timecard'].currentEmployeeRole='store_terminal';}
if(new URLSearchParams(location.search).get('reception')==='force_closed'){window.__fixtures['/api/store/operations'].operation.acceptanceMode='force_closed';}
const daysCase=new URLSearchParams(location.search).get('days');if(daysCase==='missing')delete window.__fixtures['/api/sales/summary'].totals.salesPostedDayCount;else if(daysCase==='zero')window.__fixtures['/api/sales/summary'].totals.salesPostedDayCount=0;
const nativeFetch=window.fetch; window.__requests=[];
window.__readTest={failPath:new URLSearchParams(location.search).get('fail')||'',hangPath:'',delays:{}};
window.fetch=async(input,init={})=>{
 const url=new URL(String(input),location.href);if(!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
 window.__requests.push({path:url.pathname,query:url.search,method:init.method||'GET',body:init.body});
 if(init.method&&init.method!=='GET')return Response.json({error:'Fixture does not persist operations'},{status:409});
 const state=window.__readTest;
 if(state.hangPath===url.pathname)await new Promise((resolve,reject)=>{if(init.signal?.aborted)reject(new DOMException('Aborted','AbortError'));else init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
 const delay=state.delays[url.searchParams.get('storeId')]||0;if(delay)await new Promise(r=>setTimeout(r,delay));
 if(state.failPath===url.pathname)return new Response('Read failed',{status:500});
 if(url.pathname==='/api/settings'&&url.searchParams.get('module')==='navigation')return Response.json({});
 if(url.pathname==='/api/settings')return Response.json({settings:defaultStoreModuleSettings});
 if(url.pathname==='/api/os/quick-dashboard')return Response.json({stores:window.__fixtures['/api/os/store-context'].stores,selectedStoreId:'test-store',canChangeGlobalStore:true,staff:[],operation:null,metrics:{activeOrders:1065},preferences:{widgets:[]}});
 const fixture=window.__fixtures[url.pathname]||{};
 if(url.pathname==='/api/store/orders'){
  let rows=fixture.orders;const q=(url.searchParams.get('q')||'').toLowerCase();
  if(q)rows=rows.filter(o=>(o.pickupCode+' '+o.drink+' '+o.customerName+' '+o.customerPhone).toLowerCase().includes(q));
  if(url.searchParams.get('status')==='completed')rows=rows.filter(o=>o.status==='completed');
  const offset=Number(url.searchParams.get('cursor')||0),limit=Number(url.searchParams.get('pageSize')||50);
  return Response.json({...fixture,orders:rows.slice(offset,offset+limit),nextCursor:offset+limit<rows.length?String(offset+limit):null});
 }
 if(url.pathname.startsWith('/api/store/display/')&&url.searchParams.get('storeId')==='test-store-2')return Response.json({...fixture,selectedStoreId:'test-store-2',preparing:[],ready:[],orders:[],tasks:[]});
 return Response.json(fixture);
};
const pages={'/os':OsHome,'/os/analytics':Analytics,'/os/settings':Settings,'/os/menus':MenuAdmin,'/sync':StoreInventorySyncStatus,'/store':Home,'/store/orders':Orders,'/store/pos':Pos,'/store/menu':Availability,'/store/menu/inventory-history':History,'/store/timecard':Timecard,'/store/receiving':Receiving,'/store/procedures':Procedures,'/store/seats':Seats,'/store/display/pickup':Pickup,'/store/display/kitchen':Kitchen,'/store/display/courier':Courier};const Page=pages[location.pathname]||Home; createRoot(document.getElementById('root')).render(<OsTranslationProvider><Page/><FloatingFeedbackButton/></OsTranslationProvider>);`;
const compiler = await context({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, outdir: '/private/tmp/store-ui-fixture', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' }, plugins: [{ name: 'fixture-navigation', setup(b) { b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const usePathname=()=>location.pathname; export const useRouter=()=>({push:(p)=>location.assign(p),replace:(p)=>location.replace(p)});', loader: 'js' })); } }] });
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/fixture.js') { const bundle = await compiler.rebuild(); res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(f => f.path.endsWith('.js')).text); return; }
  if (path === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(`${await readFile('app/globals.css', 'utf8')}\n${await readFile('app/store/store-responsive.css', 'utf8')}\n${(await compiler.rebuild()).outputFiles.filter(f => f.path.endsWith('.css')).map(f => f.text).join('\n')}`); return; }
  if (path.startsWith('/locales/') || path.endsWith('.svg')) { try { const content = await readFile(resolve(root, 'public', path.slice(1))); res.setHeader('Content-Type', path.endsWith('.svg') ? 'image/svg+xml' : 'application/json'); res.end(content); } catch { res.writeHead(404).end(); } return; }
  if (path.startsWith('/api/')) { res.writeHead(403).end('Fixture only'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>window.__errors=[];window.addEventListener('error',e=>window.__errors.push({message:e.message,stack:e.error?.stack,file:e.filename,line:e.lineno}));window.__fixtures=${JSON.stringify(fixtures).replaceAll('<', '\\u003c')}</script><script src="/fixture.js"></script></body></html>`);
});

await new Promise(ok=>server.listen(4179,'127.0.0.1',ok));
console.log('OS fixture http://127.0.0.1:4179 (synthetic data, writes blocked)');
if(process.argv.includes('--serve'))await new Promise(()=>{});
await mkdir(output,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 for(const width of [1440,1024,768,390,360]) {
  await page.setViewport({width,height:900});
  for(const route of ['/os','/os/analytics','/os/settings','/store']) {
   await page.goto('http://127.0.0.1:4179'+route,{waitUntil:'networkidle0'});
   assert.ok(await page.$('main'),'No main '+route);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Overflow '+route+' '+width);
   for(const language of ['ja','zh-Hans','zh-Hant']) {
    await page.select('.os-language-picker select',language);
    await new Promise(r=>setTimeout(r,350));
    assert.equal(await page.evaluate(()=>document.body.innerText.includes('undefined')),false,'Undefined '+route);
    if(route==='/os/analytics')assert.match(await page.$eval('.metric-card p',e=>e.textContent),/10.*2/);
    if(width===768&&route!=='/store') {
     assert.ok(await page.$$eval('.os-quick-drawer-trigger',nodes=>nodes.filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().width>=48)));
     assert.equal(await page.$$eval('.os-quick-drawer-trigger',nodes=>nodes.filter(e=>e.getClientRects().length).some(e=>getComputedStyle(e.querySelector('b')).display==='none')),false);
    }
    if(width===768)assert.equal(await page.evaluate(()=>{
     const boxes=[...document.querySelectorAll('.user-panel > *')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect());
     return boxes.some((a,i)=>boxes.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
    }),false,'Header overlap '+route+' '+language);
   }
   await page.screenshot({path:output+'/'+route.replaceAll('/','-')+'-'+width+'.png'});
  }
  console.log('PASS '+width+'px / 4 routes / 3 languages');
 }
 for(const [days,expected] of [['missing','未取得'],['zero','売上計上 0日']]) {
  await page.goto('http://127.0.0.1:4179/os/analytics?days='+days,{waitUntil:'networkidle0'});
  await page.select('.os-language-picker select','ja');
  await page.waitForFunction(value=>document.querySelector('.metric-card p')?.textContent.includes(value),{},expected);
 }
 assert.deepEqual(errors,[]);
} finally {await browser.close();server.close();await compiler.dispose();}
