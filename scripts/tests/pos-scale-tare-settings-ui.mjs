// Real OS POS settings page, local fetch fixtures and Chromium only.
// No production API, database, Android, Bluetooth, printer or settings writes.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const output = process.env.TARE_SETTINGS_UI_OUTPUT || 'outputs/store-tare-20261018/settings-ui';
const translationLanguages = process.env.TARE_SETTINGS_UI_JAPANESE_ONLY === '1' ? [] : ['zh-Hans', 'zh-Hant'];
const baselinePage = process.env.TARE_SETTINGS_UI_BASELINE_PAGE;
await mkdir(output, { recursive: true });
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async (language) => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import PosPage from './app/os/pos/page';import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';import{defaultPosPrinterSettings}from'./lib/pos-printer';
const language=new URLSearchParams(location.search).get('lang')||'ja';localStorage.setItem('foundr1-os-language',language);localStorage.setItem('foundr1-os-language-preference','manual');
const blank={enabled:false,revision:'',presets:[{id:'small',grams:null},{id:'large',grams:null}]};
const settings=id=>({storeId:id,storeName:id==='store-a'?'テスト店舗 A':'テスト店舗 B',dineInEnabled:true,takeoutEnabled:true,dineInTaxRate:10,takeoutTaxRate:8,externalPaymentTerminalBrand:'PayCAS',priceTaxMode:'tax_included',discountPresets:[],customerDisplayMediaSettings:{mode:'default',transition:'fade',slideDurationSeconds:8,videoMuted:true,videoLoop:true,backgroundColor:'#fbfbf8',assets:[]},printerSettings:structuredClone(defaultPosPrinterSettings),posBrandSettings:[],scaleTareSettings:structuredClone(blank)});
window.__settings={'store-a':settings('store-a'),'store-b':settings('store-b')};window.__settings['store-b'].scaleTareSettings={enabled:false,revision:'fixture-b',presets:[{id:'small',grams:80.1},{id:'large',grams:90}]};window.__writes=[];window.__denied=[];window.__holdSave=false;window.__canManage=true;
const stores=[{id:'store-a',name:'テスト店舗 A'},{id:'store-b',name:'テスト店舗 B'}];const originalFetch=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!url.pathname.startsWith('/api/'))return originalFetch(input,init);const id=url.searchParams.get('storeId')||'store-a';if(url.pathname==='/api/store/pos')return Response.json({selectedStoreId:id,access:{stores},posSettings:window.__settings[id],todaySummary:{orderCount:0,total:0,average:0,latestOrders:[]}});if(url.pathname==='/api/store/pos/reconciliation')return Response.json({businessDate:'2026-10-18',sessions:[],totals:{}});if(url.pathname==='/api/os/pos/settings'){if(init?.method==='POST'){const body=JSON.parse(init.body);window.__writes.push(structuredClone(body));if(window.__holdSave)await new Promise(resolve=>{window.__releaseSave=resolve});const current=window.__settings[body.storeId];const next={...current,...(body.section==='tare'?{}:body)};delete next.section;if(body.scaleTareSettings)next.scaleTareSettings={...body.scaleTareSettings,revision:'fixture-revision-'+window.__writes.length};window.__settings[body.storeId]=next;return Response.json({ok:true,settings:next});}return Response.json({access:{canManagePosSettings:window.__canManage},settings:window.__settings[id]});}window.__denied.push(url.pathname);return Response.json({error:'fixture denied'},{status:403});};
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
const section = '#pos-scale-tare-settings';
const small = `${section} input[name="tare-small"]`, large = `${section} input[name="tare-large"]`, toggle = `${section} input[type="checkbox"]`;
const values = () => page.evaluate(({ small, large, toggle }) => ({ small: document.querySelector(small).value, large: document.querySelector(large).value, enabled: document.querySelector(toggle).checked, toggleDisabled: document.querySelector(toggle).disabled, saveDisabled: document.querySelector('#pos-scale-tare-settings button').disabled }), { small, large, toggle });
const input = async (selector, value) => { await page.click(selector); await page.$eval(selector, (element) => element.select()); await page.keyboard.press('Backspace'); if (value) await page.type(selector, value); };
const click = async (text) => { assert.equal(await page.evaluate((text) => { const button = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === text); if (!button) return false; button.click(); return true; }, text), true, `missing button ${text}`); };
const ready = () => page.waitForFunction(() => Boolean(document.querySelector('#pos-scale-tare-settings input') && !document.querySelector('.store-context-selector select').disabled));
const saved = () => page.waitForFunction(() => !document.querySelector('#pos-scale-tare-settings button').disabled && !document.querySelector('.store-context-selector select').disabled);
const writes = () => page.evaluate(() => window.__writes);
const measurePage = () => page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, outside: [...document.querySelectorAll('input,select,textarea,.pos-admin-receipt-paper')].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).map((element) => ({ tag: element.tagName, class: element.className, right: Math.round(element.getBoundingClientRect().right) })).slice(0, 10) }));
const screenshots = async (prefix) => { for (const width of [390, 768, 1440]) { await page.setViewport({ width, height: 1000 }); await page.$eval(section, (element) => element.scrollIntoView({ block: 'center' })); const dimensions = await page.$eval(section, (element) => { const rectangle = element.getBoundingClientRect(); return { left: rectangle.left, right: rectangle.right, scroll: element.scrollWidth, client: element.clientWidth }; }); assert.equal(dimensions.left >= -1 && dimensions.right <= width + 1 && dimensions.scroll <= dimensions.client + 1, true, `tare section overflow ${prefix} ${width}px: ${JSON.stringify(dimensions)}`); pageWidths.push({ prefix, ...(await measurePage()) }); await page.screenshot({ path: `${output}/${prefix}-${width}.png` }); await (await page.$(section)).screenshot({ path: `${output}/${prefix}-section-${width}.png` }); } };
try {
  await page.setViewport({ width: 768, height: 1000 }); await page.goto(`${origin}/os/pos`, { waitUntil: 'networkidle0' });
  if (baselinePage) {
    await page.waitForSelector('.pos-admin-tax-settings');
    for (const width of [390, 768, 1440]) { await page.setViewport({ width, height: 1000 }); pageWidths.push(await measurePage()); }
    await writeFile(`${output}/baseline-page-widths.json`, JSON.stringify({ source: baselinePage, pageWidths, pageErrors: errors }, null, 2) + '\n');
    console.log('BASELINE POS settings width evidence recorded.');
  } else {
  await ready();
  assert.deepEqual(await values(), { small: '', large: '', enabled: false, toggleDisabled: true, saveDisabled: false });
  await screenshots('unconfigured');
  checks.push('existing stores default to disabled with both empty weights unset, and cannot enable before both are configured');

  await input(small, '12.3'); await click('ボウルの重さを保存'); await saved();
  let latest = (await writes()).at(-1); assert.deepEqual(Object.keys(latest).sort(), ['scaleTareSettings', 'section', 'storeId']);
  assert.equal(latest.section, 'tare'); assert.equal(latest.scaleTareSettings.enabled, false); assert.deepEqual(latest.scaleTareSettings.presets, [{ id: 'small', grams: 12.3 }, { id: 'large', grams: null }]);
  assert.equal((await values()).toggleDisabled, true);
  checks.push('disabled configuration may save one measured plate and leave the other unset; tare-only save sends no unrelated POS fields');

  for (const invalid of ['0', '-1', '3000.1', '1.23', 'abc']) {
    await input(small, invalid); assert.equal(await page.$eval(small, (element) => element.getAttribute('aria-invalid')), 'true');
    assert.equal((await values()).saveDisabled, true); const before = (await writes()).length;
    await click('POS 設定をすべて保存'); assert.equal((await writes()).length, before);
  }
  await screenshots('invalid');
  checks.push('zero, negative, over-capacity, excessive precision and nonnumeric entries remain visible, block tare/all saves and are never coerced to zero or positive');

  await input(small, '12.3'); await input(large, '45.6'); await page.click(toggle);
  const taxInput = 'input[inputmode="decimal"]:not([name])'; await input(taxInput, '9');
  await page.evaluate(() => { window.__holdSave = true; const button = document.querySelector('#pos-scale-tare-settings button'); button.click(); button.click(); });
  await page.waitForFunction(() => document.querySelector('.store-context-selector select').disabled);
  assert.equal((await writes()).length, 2); await page.evaluate(() => { window.__holdSave = false; window.__releaseSave(); }); await saved();
  assert.equal(await page.$eval(taxInput, (element) => element.value), '9'); assert.equal(await page.evaluate(() => window.__settings['store-a'].dineInTaxRate), 10);
  assert.equal(await page.evaluate(() => document.body.textContent.includes('POS 設定に未保存の変更があります。移動前に保存してください。')), true);
  checks.push('valid presets enable the feature; tare save preserves another unsaved section, guards duplicate taps and disables store switching during save');

  await input(small, '15.1'); await click('レシート設定を保存'); await saved();
  latest = (await writes()).at(-1); assert.equal(Object.hasOwn(latest, 'scaleTareSettings'), false);
  assert.equal((await values()).small, '15.1'); assert.equal(await page.evaluate(() => window.__settings['store-a'].scaleTareSettings.presets[0].grams), 12.3);
  await click('割引を保存'); await saved(); assert.equal(Object.hasOwn((await writes()).at(-1), 'scaleTareSettings'), false);
  checks.push('receipt and discount saves omit tare settings and preserve both the persisted configuration and the separate unsaved tare draft');

  await click('POS 設定をすべて保存'); await saved(); latest = (await writes()).at(-1); assert.equal(latest.scaleTareSettings.presets[0].grams, 15.1); assert.equal(latest.dineInTaxRate, '9');
  await page.select('.store-context-selector select', 'store-b'); await ready();
  assert.deepEqual(await values(), { small: '80.1', large: '90', enabled: false, toggleDisabled: false, saveDisabled: false });
  await page.select('.store-context-selector select', 'store-a'); await ready(); assert.equal((await values()).small, '15.1'); assert.equal((await values()).enabled, true);
  checks.push('all save includes tare with the other draft settings, and switching stores reloads each store independent saved weights');

  await input(small, '20'); await page.select('.store-context-selector select', 'store-b'); await page.waitForSelector('[role="dialog"]');
  await click('キャンセル'); assert.equal((await values()).small, '20'); assert.equal(await page.$eval('.store-context-selector select', (element) => element.value), 'store-a');
  await page.select('.store-context-selector select', 'store-b'); await page.waitForSelector('[role="dialog"]'); await click('保存せず店舗を切替'); await ready();
  assert.equal((await values()).small, '80.1'); await screenshots('configured');
  checks.push('unsaved plate edits participate in the existing store-switch guard; cancel preserves the draft and discard reloads only the destination store');

  await page.evaluate(() => { window.__canManage = false; }); await page.select('.store-context-selector select', 'store-a'); await ready();
  assert.equal(await page.$eval(small, (element) => element.disabled), true); assert.equal(await page.$eval(large, (element) => element.disabled), true); assert.equal((await values()).toggleDisabled, true); assert.equal((await values()).saveDisabled, true);
  const beforeReadonly = (await writes()).length; await click('POS 設定をすべて保存'); assert.equal((await writes()).length, beforeReadonly);
  checks.push('read-only POS users can view saved weights but cannot edit, enable or save the feature');

  for (const language of translationLanguages) {
    const dictionary = dictionaries[language];
    assert.ok(dictionary['ボウルの重さ・クイック風袋引き'], `${language} translations required before final run`);
    await page.goto(`${origin}/os/pos?lang=${language}`, { waitUntil: 'networkidle0' }); await ready();
    await page.waitForFunction((text) => document.querySelector('#pos-scale-tare-settings').textContent.includes(text), {}, dictionary['ボウルの重さ・クイック風袋引き']);
    await input(small, '0'); await page.waitForFunction((text) => document.querySelector('#pos-scale-tare-settings [role="alert"]').textContent === text, {}, dictionary['空のボウルの重さは、0より大きく3000g以下、小数第1位までで入力してください。']);
    await screenshots(language);
  }
  if (translationLanguages.length) checks.push('Simplified and Traditional Chinese labels, validation and actions fit at390/768/1440px without horizontal overflow');
  assert.deepEqual(await page.evaluate(() => window.__denied), []); assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(unexpected, []);
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: true, checks, pageWidths, pageErrors: errors, externalRequests: external, unexpectedRequests: unexpected, persistence: 'in-memory fetch fixture; backend SQL covered separately', layoutScope: 'new tare section; pre-existing receipt-editor page overflow recorded against baseline separately' }, null, 2) + '\n');
  console.log(`PASS POS scale tare settings UI: ${checks.length} groups.`);
  }
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: false, checks, error: error.stack, pageErrors: errors, externalRequests: external, unexpectedRequests: unexpected }, null, 2) + '\n');
  throw error;
} finally { await browser.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
