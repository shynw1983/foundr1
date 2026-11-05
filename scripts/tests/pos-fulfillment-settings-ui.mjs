// Real OS POS settings page, local fetch fixtures and Chromium only.
// No production API, database, Android, Bluetooth, printer or settings writes.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = process.env.POS_FULFILLMENT_SETTINGS_UI_OUTPUT || 'outputs/pos-fulfillment-20261019/settings-ui';
const translationLanguages = ['zh-Hans', 'zh-Hant'];
const baselinePage = undefined;
const screenshotsOnly = process.env.FILTER_SETTINGS_UI_SCREENSHOTS_ONLY === '1';
await mkdir(output, { recursive: true });
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async (language) => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import PosPage from './app/os/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';import{defaultPosPrinterSettings}from'./lib/pos-printer';
const language=new URLSearchParams(location.search).get('lang')||'ja';localStorage.setItem('foundr1-os-language',language);localStorage.setItem('foundr1-os-language-preference','manual');
const blank={enabled:false,revision:'',presets:[{id:'small',grams:null},{id:'large',grams:null}]};
const settings=id=>({storeId:id,storeName:id==='store-a'?'テスト店舗 A':'テスト店舗 B',dineInEnabled:true,takeoutEnabled:true,dineInTaxRate:10,takeoutTaxRate:8,externalPaymentTerminalBrand:'PayCAS',priceTaxMode:'tax_included',discountPresets:[],customerDisplayMediaSettings:{mode:'default',transition:'fade',slideDurationSeconds:8,videoMuted:true,videoLoop:true,backgroundColor:'#fbfbf8',assets:[]},printerSettings:structuredClone(defaultPosPrinterSettings),posBrandSettings:[],scaleTareSettings:structuredClone(blank),scaleFilterSettings:{enabled:false,revision:'',toleranceGrams:2,settleMs:2000}});
window.__settings={'store-a':settings('store-a'),'store-b':settings('store-b')};window.__settings['store-b'].scaleTareSettings={enabled:false,revision:'fixture-b',presets:[{id:'small',grams:80.1},{id:'large',grams:90}]};window.__settings['store-b'].scaleFilterSettings={enabled:false,revision:'filter-b',toleranceGrams:5,settleMs:5000};window.__writes=[];window.__denied=[];window.__holdSave=false;window.__holdSettingsLoad=false;window.__saveFailure=false;window.__canManage=true;
const stores=[{id:'store-a',name:'テスト店舗 A'},{id:'store-b',name:'テスト店舗 B'}];const originalFetch=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!url.pathname.startsWith('/api/'))return originalFetch(input,init);const id=url.searchParams.get('storeId')||'store-a';if(url.pathname==='/api/store/pos')return Response.json({selectedStoreId:id,access:{stores},posSettings:window.__settings[id],todaySummary:{orderCount:0,total:0,average:0,latestOrders:[]}});if(url.pathname==='/api/store/pos/reconciliation')return Response.json({businessDate:'2026-10-18',sessions:[],totals:{}});if(url.pathname==='/api/os/pos/settings'){if(init?.method==='POST'){const body=JSON.parse(init.body);window.__writes.push(structuredClone(body));const failed=window.__saveFailure;if(window.__holdSave)await new Promise(resolve=>{window.__releaseSave=resolve});if(failed)return Response.json({error:'fixture old save failure'},{status:409});const current=window.__settings[body.storeId];const next={...current,...(['tare','filter','fulfillment'].includes(body.section)?{}:body)};delete next.section;if(body.fulfillmentWorkspace)next.fulfillmentWorkspace=structuredClone(body.fulfillmentWorkspace);if(body.scaleTareSettings)next.scaleTareSettings={...body.scaleTareSettings,revision:'fixture-revision-'+window.__writes.length};if(body.scaleFilterSettings)next.scaleFilterSettings={...body.scaleFilterSettings,revision:'filter-revision-'+window.__writes.length};window.__settings[body.storeId]=next;return Response.json({ok:true,settings:next});}if(window.__holdSettingsLoad)await new Promise(resolve=>{window.__releaseLoad=resolve});return Response.json({access:{canManagePosSettings:window.__canManage},settings:window.__settings[id]});}window.__denied.push(url.pathname);return Response.json({error:'fixture denied'},{status:403});};
createRoot(document.getElementById('root')).render(<OsTranslationProvider><PosPage/></OsTranslationProvider>);`;
const fixtureShell = {
  name: 'local-settings-shell', setup(build) {
    if (baselinePage) build.onLoad({ filter: /app\/os\/pos\/page\.tsx$/ }, async () => ({ contents: await readFile(baselinePage, 'utf8'), loader: 'tsx' }));
    build.onResolve({ filter: /(?:\/|^)components\/(?:UserBadge|OsNavList|MobileNavMenu)$/ }, (args) => ({ path: args.path, namespace: 'fixture-shell' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture-shell' }, () => ({ contents: 'export function UserBadge(){return null}export function OsNavList(){return null}export function MobileNavMenu(){return null}', loader: 'js' }));
  }
};
const bundled = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, plugins: [fixtureShell], bundle: true, write: false, outdir: '/virtual', charset: 'utf8', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const js = bundled.outputFiles.find((file) => file.path.endsWith('.js')).text;
const css = (await readFile('app/globals.css', 'utf8')) + '\n' + bundled.outputFiles.filter((file) => file.path.endsWith('.css')).map((file) => file.text).join('\n');
const unexpected = [], external = [], errors = [], checks = [], pageWidths = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); response.end(js); return; }
  if (url.pathname.startsWith('/locales/os/')) { response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans'])); return; }
  if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  if (url.pathname === '/os/pos') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
  if (url.pathname.startsWith('/images/')) { response.writeHead(204); response.end(); return; }
  if (url.pathname.startsWith('/icons/')) { response.writeHead(204); response.end(); return; }
  unexpected.push({ path: url.pathname, method: request.method }); response.writeHead(403); response.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(45000);
page.on('pageerror', (error) => errors.push(error.message));
page.on('dialog', (dialog) => dialog.accept());
await page.setRequestInterception(true);
page.on('request', (request) => { if (request.url().startsWith(origin + '/') || request.url().startsWith('data:')) request.continue(); else { external.push(request.url()); request.abort(); } });
const section = '#pos-fulfillment-settings';
const minutes = `${section} input:not([type="checkbox"])`, toggle = `${section} input[type="checkbox"]`;
const input = async (selector, value) => { await page.click(selector); await page.$eval(selector, (element) => element.select()); await page.keyboard.press('Backspace'); if (value) await page.type(selector, value); };
const click = async (text) => { assert.equal(await page.evaluate((text) => { const button = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === text); if (!button) return false; button.click(); return true; }, text), true, `missing button ${text}`); };
const ready = () => page.waitForFunction(() => Boolean(document.querySelector('#pos-fulfillment-settings input') && !document.querySelector('.store-context-selector select').disabled));
const saved = () => page.waitForFunction(() => !document.querySelector('#pos-fulfillment-settings button').disabled && !document.querySelector('.store-context-selector select').disabled);
const writes = () => page.evaluate(() => window.__writes);
const screenshots = async (prefix) => { for (const width of (screenshotsOnly ? [390, 768] : [390, 768, 1440])) { await page.setViewport({ width, height: 1000 }); await page.$eval(section, (element) => element.scrollIntoView({ block: 'center' })); const dimensions = await page.$eval(section, (element) => { const rectangle = element.getBoundingClientRect(); return { left: rectangle.left, right: rectangle.right, scroll: element.scrollWidth, client: element.clientWidth }; }); assert.equal(dimensions.left >= -1 && dimensions.right <= width + 1 && dimensions.scroll <= dimensions.client + 1, true, `filter section overflow ${prefix} ${width}px: ${JSON.stringify(dimensions)}`); await page.screenshot({ path: `${output}/${prefix}-${width}.png` }); await (await page.$(section)).screenshot({ path: `${output}/${prefix}-section-${width}.png` }); } };
try {
  await page.setViewport({width:768,height:1000});
  await page.goto(`${origin}/os/pos`,{waitUntil:'networkidle0'}); await ready();
  assert.equal(await page.$eval(toggle,e=>e.checked),false);
  assert.equal(await page.$(minutes),null);
  await screenshots('default-off'); checks.push('unconfigured store defaults off with one compact checkbox and no numeric field');
  await page.click(toggle); assert.equal(await page.$eval(minutes,e=>e.value),'15');
  for(const invalid of ['', '0', '-1', '121', '1.5', 'abc']) {
    await input(minutes,invalid); assert.equal(await page.$eval(`${section} button`,e=>e.disabled),true);
    const before=(await writes()).length;await click('POS 設定をすべて保存');assert.equal((await writes()).length,before);
  }
  await input(minutes,'12');
  const tax='input[inputmode="decimal"]:not([name])';await input(tax,'9');
  await click('受け渡し設定を保存');await saved();
  assert.deepEqual((await writes()).at(-1),{storeId:'store-a',section:'fulfillment',fulfillmentWorkspace:{enabled:true,overdueMinutes:12}});
  assert.equal(await page.$eval(tax,e=>e.value),'9');
  assert.equal(await page.evaluate(()=>window.__settings['store-a'].dineInTaxRate),10);
  await screenshots('enabled');checks.push('invalid parameters block own/all saves; dedicated save includes only store and workspace and retains unrelated tax draft');
  await input(minutes,'20');await click('POS 設定をすべて保存');await saved();
  assert.deepEqual((await writes()).at(-1).fulfillmentWorkspace,{enabled:true,overdueMinutes:20});
  assert.equal((await writes()).at(-1).dineInTaxRate,'9');checks.push('save-all includes current workspace settings with other intentional store changes');
  await input(minutes,'21');await page.evaluate(()=>{window.__saveFailure=true});await click('受け渡し設定を保存');await saved();
  assert.equal(await page.$eval(minutes,e=>e.value),'21');
  assert.equal(await page.evaluate(()=>document.body.textContent.includes('fixture old save failure')),true);
  checks.push('failed save keeps entered workspace value and exposes failure');
  await page.evaluate(()=>{window.__saveFailure=false});await click('受け渡し設定を保存');await saved();
  await page.evaluate(()=>{window.__canManage=false});await page.select('.store-context-selector select','store-b');await ready();
  assert.equal(await page.$eval(toggle,e=>e.checked),false);
  assert.equal(await page.$eval(toggle,e=>e.disabled),true);assert.equal(await page.$eval(`${section} button`,e=>e.disabled),true);
  checks.push('store switch loads independent disabled default and blocks controls for viewers');
  assert.deepEqual(external,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
  await writeFile(`${output}/verification.json`,JSON.stringify({passed:true,checks,widths:[390,768,1440],externalRequests:external,unexpectedRequests:unexpected,pageErrors:errors,productionAccess:false},null,2)+'\n');
  console.log(`PASS ${checks.length} actual OS fulfillment settings UI groups`);
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
