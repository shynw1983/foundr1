// Real OS POS settings page, local fetch fixtures and Chromium only.
// No production API, database, Android, Bluetooth, printer or settings writes.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = process.env.FILTER_SETTINGS_UI_OUTPUT || 'outputs/store-scale-filter-20261018/ui/settings';
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
const stores=[{id:'store-a',name:'テスト店舗 A'},{id:'store-b',name:'テスト店舗 B'}];const originalFetch=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!url.pathname.startsWith('/api/'))return originalFetch(input,init);const id=url.searchParams.get('storeId')||'store-a';if(url.pathname==='/api/store/pos')return Response.json({selectedStoreId:id,access:{stores},posSettings:window.__settings[id],todaySummary:{orderCount:0,total:0,average:0,latestOrders:[]}});if(url.pathname==='/api/store/pos/reconciliation')return Response.json({businessDate:'2026-10-18',sessions:[],totals:{}});if(url.pathname==='/api/os/pos/settings'){if(init?.method==='POST'){const body=JSON.parse(init.body);window.__writes.push(structuredClone(body));const failed=window.__saveFailure;if(window.__holdSave)await new Promise(resolve=>{window.__releaseSave=resolve});if(failed)return Response.json({error:'fixture old save failure'},{status:409});const current=window.__settings[body.storeId];const next={...current,...(['tare','filter'].includes(body.section)?{}:body)};delete next.section;if(body.scaleTareSettings)next.scaleTareSettings={...body.scaleTareSettings,revision:'fixture-revision-'+window.__writes.length};if(body.scaleFilterSettings)next.scaleFilterSettings={...body.scaleFilterSettings,revision:'filter-revision-'+window.__writes.length};window.__settings[body.storeId]=next;return Response.json({ok:true,settings:next});}if(window.__holdSettingsLoad)await new Promise(resolve=>{window.__releaseLoad=resolve});return Response.json({access:{canManagePosSettings:window.__canManage},settings:window.__settings[id]});}window.__denied.push(url.pathname);return Response.json({error:'fixture denied'},{status:403});};
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
const section = '#pos-scale-filter-settings';
const tolerance = `${section} input[name="filter-tolerance"]`, settleInput = `${section} input[name="filter-settle"]`, toggle = `${section} input[type="checkbox"]`;
const values = () => page.evaluate(({ tolerance, settleInput, toggle }) => ({ tolerance: document.querySelector(tolerance).value, seconds: document.querySelector(settleInput).value, enabled: document.querySelector(toggle).checked, saveDisabled: document.querySelector('#pos-scale-filter-settings button').disabled }), { tolerance, settleInput, toggle });
const input = async (selector, value) => { await page.click(selector); await page.$eval(selector, (element) => element.select()); await page.keyboard.press('Backspace'); if (value) await page.type(selector, value); };
const click = async (text) => { assert.equal(await page.evaluate((text) => { const button = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === text); if (!button) return false; button.click(); return true; }, text), true, `missing button ${text}`); };
const ready = () => page.waitForFunction(() => Boolean(document.querySelector('#pos-scale-filter-settings input') && !document.querySelector('.store-context-selector select').disabled));
const saved = () => page.waitForFunction(() => !document.querySelector('#pos-scale-filter-settings button').disabled && !document.querySelector('.store-context-selector select').disabled);
const writes = () => page.evaluate(() => window.__writes);
const screenshots = async (prefix) => { for (const width of (screenshotsOnly ? [390, 768] : [390, 768, 1440])) { await page.setViewport({ width, height: 1000 }); await page.$eval(section, (element) => element.scrollIntoView({ block: 'center' })); const dimensions = await page.$eval(section, (element) => { const rectangle = element.getBoundingClientRect(); return { left: rectangle.left, right: rectangle.right, scroll: element.scrollWidth, client: element.clientWidth }; }); assert.equal(dimensions.left >= -1 && dimensions.right <= width + 1 && dimensions.scroll <= dimensions.client + 1, true, `filter section overflow ${prefix} ${width}px: ${JSON.stringify(dimensions)}`); await page.screenshot({ path: `${output}/${prefix}-${width}.png` }); await (await page.$(section)).screenshot({ path: `${output}/${prefix}-section-${width}.png` }); } };
try {
  await page.setViewport({ width: 768, height: 1000 }); await page.goto(`${origin}/os/pos`, { waitUntil: 'networkidle0' }); await ready();
  if (screenshotsOnly) {
    for (const language of ['ja','zh-Hans','zh-Hant']) {
      if (language !== 'ja') { await page.goto(`${origin}/os/pos?lang=${language}`,{waitUntil:'networkidle0'});await ready(); }
      await page.click(tolerance);await screenshots(`final-focus-${language}`);
      const control = await page.$eval(tolerance, element => { const s=getComputedStyle(element);return {height:element.getBoundingClientRect().height,borderRadius:s.borderRadius,outline:s.outlineColor,outlineStyle:s.outlineStyle}; });
      assert.ok(control.height>=40);assert.equal(control.borderRadius,'8px');assert.equal(control.outlineStyle,'solid');
    }
    await writeFile(`${output}/final-style-verification.json`,JSON.stringify({passed:true,widths:[390,768],languages:['ja','zh-Hans','zh-Hant'],checks:['40px minimum touch controls with themed rounded border and green focus outline','checkbox retains18px','new section fits mobile and tablet']},null,2)+'\n');
    console.log('PASS filter settings final styles.');
  } else {
  assert.deepEqual(await values(), { tolerance: '2', seconds: '2', enabled: false, saveDisabled: false });
  assert.equal(await page.$eval('#pos-scale-tare-settings input[name="tare-small"]', element => element.value), '');
  await screenshots('default-off');
  checks.push('filter defaults off with2g and2seconds; existing unset plate presets remain unchanged');

  await page.click(toggle);
  for (const invalid of ['', '0', '-1', '6', '1.5', 'abc']) {
    await input(tolerance, invalid); assert.equal(await page.$eval(tolerance, element => element.getAttribute('aria-invalid')), 'true'); assert.equal((await values()).saveDisabled, true);
    const before = (await writes()).length; await click('POS 設定をすべて保存'); assert.equal((await writes()).length, before);
  }
  await input(tolerance, '2');
  for (const invalid of ['', '1', '6', '2.5', 'abc']) {
    await input(settleInput, invalid); assert.equal(await page.$eval(settleInput, element => element.getAttribute('aria-invalid')), 'true'); assert.equal((await values()).saveDisabled, true);
    const before = (await writes()).length; await click('POS 設定をすべて保存'); assert.equal((await writes()).length, before);
  }
  await screenshots('invalid');
  checks.push('empty/nonnumeric/negative/fractional/out-of-range parameters stay visible and block filter/all saves');

  await input(tolerance, '3'); await input(settleInput, '4');
  await input('#pos-scale-tare-settings input[name="tare-small"]', '30.1');
  const taxInput = 'input[inputmode="decimal"]:not([name])'; await input(taxInput, '9');
  await page.evaluate(() => { window.__holdSave = true; const button = document.querySelector('#pos-scale-filter-settings button'); button.click(); button.click(); });
  await page.waitForFunction(() => document.querySelector('.store-context-selector select').disabled);
  assert.equal((await writes()).length, 1); await page.evaluate(() => { window.__holdSave = false; window.__releaseSave(); }); await saved();
  let latest = (await writes()).at(-1); assert.deepEqual(Object.keys(latest).sort(), ['scaleFilterSettings', 'section', 'storeId']); assert.equal(latest.section, 'filter');
  assert.deepEqual(latest.scaleFilterSettings, { enabled: true, revision: '', toleranceGrams: 3, settleMs: 4000 });
  assert.equal(await page.$eval(taxInput, element => element.value), '9'); assert.equal(await page.$eval('#pos-scale-tare-settings input[name="tare-small"]', element => element.value), '30.1');
  assert.equal(await page.evaluate(() => window.__settings['store-a'].dineInTaxRate), 10); assert.equal(await page.evaluate(() => window.__settings['store-a'].scaleTareSettings.presets[0].grams), null);
  checks.push('filter-only save sends numeric parameters, suppresses duplicates, prevents in-flight store switch and preserves unrelated tax/tare drafts');

  await input(tolerance, '4'); await click('ボウルの重さを保存'); await saved(); assert.equal(Object.hasOwn((await writes()).at(-1), 'scaleFilterSettings'), false);
  assert.equal((await values()).tolerance, '4'); assert.equal(await page.evaluate(() => window.__settings['store-a'].scaleFilterSettings.toleranceGrams), 3);
  await click('レシート設定を保存'); await saved(); assert.equal(Object.hasOwn((await writes()).at(-1), 'scaleFilterSettings'), false);
  await click('割引を保存'); await saved(); assert.equal(Object.hasOwn((await writes()).at(-1), 'scaleFilterSettings'), false);
  checks.push('tare/receipt/discount section saves omit filter configuration and preserve its unsaved draft and saved value');

  await click('POS 設定をすべて保存'); await saved(); latest = (await writes()).at(-1); assert.equal(latest.scaleFilterSettings.toleranceGrams, 4); assert.equal(latest.dineInTaxRate, '9');
  await page.select('.store-context-selector select', 'store-b'); await ready(); assert.deepEqual(await values(), { tolerance: '5', seconds: '5', enabled: false, saveDisabled: false });
  await page.select('.store-context-selector select', 'store-a'); await ready(); assert.deepEqual(await values(), { tolerance: '4', seconds: '4', enabled: true, saveDisabled: false });
  await screenshots('enabled');
  checks.push('all save includes filter with other drafts; switching stores restores only each store saved filter policy');

  await input(tolerance, '2'); await page.select('.store-context-selector select', 'store-b'); await page.waitForSelector('[role="dialog"]'); await click('キャンセル'); assert.equal((await values()).tolerance, '2');
  await page.select('.store-context-selector select', 'store-b'); await page.waitForSelector('[role="dialog"]'); await click('保存せず店舗を切替'); await ready(); assert.equal((await values()).tolerance, '5');
  checks.push('filter drafts use existing unsaved-change guard; cancel retains the draft and discard loads destination values');

  await page.select('.store-context-selector select', 'store-a'); await ready(); await input(tolerance,'2');
  await page.evaluate(()=>{window.__holdSave=true;}); const beforeHeld=(await writes()).length; await click('揺れ対策を保存');
  await page.waitForFunction(count=>window.__writes.length===count+1,{},beforeHeld);
  await page.evaluate(()=>{window.__oldRelease=window.__releaseSave;window.__holdSettingsLoad=true;document.querySelector('.store-context-selector select').disabled=false;});
  await page.select('.store-context-selector select','store-b');await page.waitForSelector('[role="dialog"]');await click('保存せず店舗を切替');
  await page.waitForFunction(()=>typeof window.__releaseLoad==='function');const beforeLoadingSave=(await writes()).length;await click('POS 設定をすべて保存');assert.equal((await writes()).length,beforeLoadingSave);
  await page.evaluate(()=>{window.__holdSettingsLoad=false;window.__releaseLoad();});await ready();assert.equal((await values()).tolerance,'5');
  await input(tolerance,'4');await click('揺れ対策を保存');await page.waitForFunction(count=>window.__writes.length===count+1,{},beforeLoadingSave);
  await page.evaluate(()=>window.__oldRelease());await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(await page.$eval('.store-context-selector select',e=>e.value),'store-b');assert.equal((await values()).tolerance,'4');assert.equal((await values()).saveDisabled,true);
  await page.evaluate(()=>{window.__holdSave=false;window.__releaseSave();});await saved();assert.equal((await values()).tolerance,'4');
  checks.push('a delayed old-store save cannot overwrite the destination form or clear its newer pending save; loading blocks old-form saves synchronously');

  await input(tolerance,'3');await page.evaluate(()=>{window.__holdSave=true;window.__saveFailure=true;});const beforeFailure=(await writes()).length;await click('揺れ対策を保存');await page.waitForFunction(count=>window.__writes.length===count+1,{},beforeFailure);
  await page.evaluate(()=>{window.__oldRelease=window.__releaseSave;window.__saveFailure=false;document.querySelector('.store-context-selector select').disabled=false;});await page.select('.store-context-selector select','store-a');await page.waitForSelector('[role="dialog"]');await click('保存せず店舗を切替');await ready();
  await page.evaluate(()=>{window.__holdSave=false;window.__oldRelease();});await new Promise(resolve=>setTimeout(resolve,150));assert.equal((await values()).tolerance,'2');assert.equal(await page.evaluate(()=>document.body.textContent.includes('fixture old save failure')),false);
  checks.push('a delayed old-store save error is ignored after switching stores');

  await page.evaluate(() => { window.__canManage = false; }); await page.select('.store-context-selector select', 'store-a'); await ready();
  for (const selector of [tolerance, settleInput, toggle]) assert.equal(await page.$eval(selector, element => element.disabled), true);
  const beforeReadonly = (await writes()).length; await click('POS 設定をすべて保存'); assert.equal((await writes()).length, beforeReadonly);
  checks.push('read-only users cannot modify or save filter settings');

  for (const language of translationLanguages) {
    const dictionary = dictionaries[language]; assert.ok(dictionary['重量の揺れ対策']);
    await page.goto(`${origin}/os/pos?lang=${language}`, { waitUntil: 'networkidle0' }); await ready(); await page.waitForFunction(text => document.querySelector('#pos-scale-filter-settings').textContent.includes(text), {}, dictionary['重量の揺れ対策']);
    await input(tolerance, '0'); await page.waitForFunction(text => document.querySelector('#pos-scale-filter-settings [role="alert"]').textContent === text, {}, dictionary['許容する揺れ幅は1〜5gの整数で入力してください。']);
    await screenshots(language);
  }
  checks.push('Japanese, Simplified Chinese and Traditional Chinese filter states fit390/768/1440px with translated labels/actions/validation');
  assert.deepEqual(await page.evaluate(() => window.__denied), []); assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(unexpected, []);
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: true, checks, pageErrors: errors, externalRequests: external, unexpectedRequests: unexpected, persistence: 'in-memory API fixture; backend SQL covered separately', layoutScope: 'new filter section; old receipt-editor2px tablet overflow documented in tare baseline' }, null, 2) + '\n');
  console.log(`PASS POS scale filter settings UI: ${checks.length} groups.`);
  }
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: false, checks, error: error.stack, pageErrors: errors, externalRequests: external, unexpectedRequests: unexpected }, null, 2) + '\n');
  throw error;
} finally { await browser.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
