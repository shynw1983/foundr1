// Actual history page and StoreNavTabs, local synthetic API only. No database,
// merchant platform, push, or live store operation is contacted by this fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const root = resolve(process.env.FOUNDR1_HISTORY_UI_SOURCE_ROOT || process.cwd());
const output = resolve(process.env.FOUNDR1_HISTORY_UI_OUTPUT || 'outputs/store-history-width-20261018/ui');
const baseline = resolve(process.env.FOUNDR1_HISTORY_UI_BASELINE || 'outputs/store-history-width-20261018/primary-baseline');
const pagePath = 'app/store/menu/inventory-history/page.tsx';
const cssPath = 'app/store/store-responsive.css';
await mkdir(output, { recursive: true });
console.log('History width fixture: local dependencies loaded.');
const platforms = ['foundr1', 'rocket_now', 'uber_eats', 'demae_can'];
const platform = (name, status) => ({ platform: name, total: 1, succeeded: status === 'succeeded' ? 1 : 0,
  failed: status === 'failed' ? 1 : 0, timedOut: 0, processing: status === 'processing' ? 1 : 0, queued: 0 });
const longName = '（大）鶏もも肉と軟骨の串1本・もち米焼売・調理場で確認するための商品名が長い場合';
const reports = Array.from({ length: 25 }, (_, index) => {
  const status = index === 1 ? 'failed' : index === 2 ? 'processing' : 'succeeded';
  return { id: `history-${index + 1}`, runType: 'availability_change', action: index % 2 ? 'unavailable' : 'available',
    itemLabel: index === 0 ? 'もち米焼売' : index === 1 ? longName : `商品 ${index + 1}`,
    itemName: index === 1 ? longName : '', source: 'store', actorName: index === 1 ? '操作担当・レジ1／清水店' : 'レジ1',
    createdAt: new Date(Date.UTC(2026, 9, 18, 2, 4) - index * 60000).toISOString(), status, details: {},
    platforms: platforms.map(name => platform(name, name === 'demae_can' ? status : 'succeeded')),
    failedCommands: status === 'failed' ? [{ id: 'command-2', platform: 'demae_can', status: 'failed', attempts: 1,
      error: `multiple target matches:${'原始エラー情報LONG_UNBROKEN_ERROR_'.repeat(7)}`,
      failedItems: [longName], failedTargets: [{ label: longName, kind: 'item' }], desiredAvailable: false,
      updatedAt: '2026-10-18T02:03:00.000Z' }] : [] };
});

const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import History from './${pagePath}';
import {createStoreThemePalette} from './lib/store-theme';
document.body.setAttribute('data-store-theme','');for(const [key,value] of Object.entries(createStoreThemePalette()))document.body.style.setProperty(key,value);
localStorage.setItem('foundr1:store:selectedStoreId','fixture-store');
window.__fixture={reports:${JSON.stringify(reports)},reads:[],writes:[]};
window.fetch=async(input,init={})=>{const url=new URL(String(input),location.href);const state=window.__fixture;
if(url.origin!==location.origin)throw Error('Fixture forbids outbound requests: '+url.href);
if(init.method&&init.method!=='GET'){state.writes.push({path:url.pathname,method:init.method});throw Error('Fixture forbids live writes');}
state.reads.push(url.pathname+url.search);
if(url.pathname==='/api/store/inventory-history')return Response.json({reports:structuredClone(state.reports)});
if(url.pathname==='/api/store/context')return Response.json({selectedStoreId:'fixture-store',access:{role:'owner',canUseAllStoreView:true,stores:[{id:'fixture-store',name:'清水店'},{id:'other-store',name:'別店舗'}]}});
if(url.pathname==='/api/auth/me')return Response.json({employee:{id:'fixture-owner',name:'鄒',role:'owner'}});
if(url.pathname==='/api/settings')return Response.json({});
if(url.pathname==='/api/sns')return Response.json({stores:[]});
throw Error('Unexpected local fixture request: '+url.pathname);};
createRoot(document.getElementById('root')).render(<React.StrictMode><History/></React.StrictMode>);`;

const sources = {};
for (const variant of ['before', 'after']) {
  const sourceRoot = variant === 'before' ? baseline : root;
  const pageSource = await readFile(resolve(sourceRoot, pagePath), 'utf8');
  const responsiveCss = await readFile(resolve(sourceRoot, cssPath), 'utf8');
  const globals = await readFile(resolve(root, 'app/globals.css'), 'utf8');
  const themeCss = await readFile(resolve(sourceRoot, 'app/store/store-theme.css'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const bundled = await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true,
    write: false, outfile: '/tmp/store-history-width-fixture.js', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'synthetic-history-context', setup(builder) {
      builder.onLoad({ filter: /\/app\/store\/menu\/inventory-history\/page\.tsx$/ }, () => ({ contents: pageSource, loader: 'tsx', resolveDir: resolve(root, 'app/store/menu/inventory-history') }));
      builder.onResolve({ filter: /OsTranslationProvider|StoreThemeProvider|UserBadge/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('OsTranslationProvider')
        ? `export const useOsTranslation=()=>({language:new URLSearchParams(location.search).get('language')||'ja',t:key=>key});`
        : args.path.includes('StoreThemeProvider') ? `export const useStoreTheme=()=>({context:null});`
        : `import React from 'react';export const UserBadge=()=> <div className="user-panel"><details className="account-menu"><summary className="user-badge"><span className="user-avatar">鄒</span></summary></details><details className="notification-menu"><summary className="notification-trigger" aria-label="通知"><span className="notification-count">1164</span></summary></details><label className="os-language-picker"><select aria-label="Language"><option>日本語</option></select></label></div>;`, loader: 'tsx', resolveDir: root }));
    } }] });
  console.log(`History width fixture: ${variant} actual React source bundled.`);
  sources[variant] = { js: bundled.outputFiles.find(file => file.path.endsWith('.js')).text,
    css: `${globals}\n${responsiveCss}\n${themeCss}\n${bundled.outputFiles.find(file => file.path.endsWith('.css'))?.text || ''}`,
    evidence: { pageSha256: createHash('sha256').update(pageSource).digest('hex'), responsiveCssSha256: createHash('sha256').update(responsiveCss).digest('hex'), globalsSha256: createHash('sha256').update(globals).digest('hex'), themeCssSha256: createHash('sha256').update(themeCss).digest('hex') } };
}
const html = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><title>Store history width fixture</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
let variant = 'before';
const server = createServer((request, response) => {
  const resource = request.url.split('?')[0];
  response.setHeader('Content-Type', resource === '/fixture.js' ? 'text/javascript' : resource === '/fixture.css' ? 'text/css' : 'text/html; charset=utf-8');
  response.end(resource === '/fixture.js' ? sources[variant].js : resource === '/fixture.css' ? sources[variant].css : html);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.FOUNDR1_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
console.log('History width fixture: local Chrome started.');
const result = { sourceRoot: root, baseline, isolation: 'Actual React history page and navigation. User identity, translation/theme context and all APIs are synthetic; browser aborts non-local requests. No writes allowed.', evidence: { before: sources.before.evidence, after: sources.after.evidence }, sizes: [], checks: [], errors: [] };
try {
  const page = await browser.newPage();
  page.on('pageerror', error => result.errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin) ? request.continue() : request.abort());
  const open = async (language = 'ja') => {
    await page.goto(`${origin}/store/menu/inventory-history?language=${language}`, { waitUntil: 'load' });
    await page.waitForSelector('.store-inventory-history-row');
    await page.waitForSelector('.store-nav-store-switch');
    await page.evaluate(() => document.fonts.ready);
  };
  const metrics = async () => page.evaluate(() => {
    const box = selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width, height: rect.height }; };
    const visibleControls = [...document.querySelectorAll('.store-inventory-history-page button, .store-inventory-history-page input, .store-inventory-history-page select')].filter(node => node.getBoundingClientRect().width);
    return { viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      nav: box('.store-workbench-topbar'), header: box('.store-inventory-history-head'), filters: box('.store-history-filters'), list: box('.store-inventory-history-list'), row: box('.store-inventory-history-row'),
      controls: visibleControls.map(node => ({ text: node.getAttribute('aria-label') || node.textContent?.trim() || node.getAttribute('placeholder'), height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width })),
      chips: [...document.querySelectorAll('.store-inventory-history-row:first-of-type .store-inventory-history-platforms > span')].map(node => ({ text: node.textContent, width: node.getBoundingClientRect().width })),
      lastRow: document.querySelector('.store-inventory-history-row:last-of-type .store-inventory-history-operation strong')?.textContent };
  });
  for (const width of [360, 393, 768, 1440]) {
    const row = { width };
    await page.setViewport({ width, height: width === 393 ? 873 : 960 });
    for (variant of ['before', 'after']) {
      await open();
      row[variant] = await metrics();
      assert.equal(row[variant].overflow, false, `${variant}: no horizontal overflow at ${width}`);
      assert.equal(await page.$$eval('.store-inventory-history-row', nodes => nodes.length), 20);
      assert.equal(await page.$$eval('.store-inventory-history-row:first-of-type .store-inventory-history-platforms > span', nodes => nodes.length), 4, 'all four platforms remain visible');
      await page.screenshot({ path: resolve(output, `${variant}-ja-${width}.png`), fullPage: false });
    }
    result.sizes.push(row);
    assert.equal(row.after.header.left, row.after.filters.left, `header/filter align at ${width}`);
    assert.equal(row.after.filters.left, row.after.list.left, `filter/list align at ${width}`);
    assert.equal(row.after.header.right, row.after.list.right, `card right edges align at ${width}`);
    assert.ok(Math.abs(row.after.header.left - row.after.nav.left) < 1, `content aligns to navigation at ${width}`);
    if (width <= 760) {
      assert.ok(row.after.list.width > row.before.list.width, `mobile cards widened at ${width}`);
      assert.equal(row.after.list.left, 12, `one 12px mobile outer gutter at ${width}`);
      assert.ok(row.after.controls.every(control => control.height >= 44), `history controls meet 44px touch height at ${width}`);
    }
  }
  result.checks.push('Actual page and navigation at 360, 393, 768 and 1440px; before/after card/filter edges, four platforms, no horizontal overflow; mobile controls at least 44px.');

  variant = 'after';
  await page.setViewport({ width: 393, height: 873 });
  await open();
  await page.click('.store-inventory-history-detail-toggle');
  await page.waitForSelector('.store-inventory-history-details');
  await page.click('.store-inventory-history-error details summary');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'long item/error cannot create horizontal overflow');
  assert.match(await page.$eval('.store-inventory-history-details', node => node.textContent), /出前館.*同名商品が複数/s);
  assert.ok(await page.$eval('.store-inventory-history-detail-head button', node => node.getBoundingClientRect().height >= 44), 'retry touch height');
  await page.$eval('.store-inventory-history-row:nth-of-type(2)', node => node.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: resolve(output, 'after-failed-expanded-ja-393.png'), fullPage: false });
  result.checks.push('Failed platform expands; long Japanese item, target labels and unbroken original error wrap without overflow; retry control remains available.');

  await page.select('.store-history-filters select', 'processing');
  await page.waitForFunction(() => document.querySelectorAll('.store-inventory-history-row').length === 1);
  assert.match(await page.$eval('.store-inventory-history-row', node => node.textContent), /実行中/);
  await page.screenshot({ path: resolve(output, 'after-processing-ja-393.png'), fullPage: false });
  await page.select('.store-history-filters select', 'failed');
  await page.waitForFunction(() => document.querySelectorAll('.store-inventory-history-row').length === 1);
  assert.match(await page.$eval('.store-inventory-history-row', node => node.textContent), /要確認/);
  await page.select('.store-history-filters select', '');
  await page.waitForFunction(() => document.querySelectorAll('.store-inventory-history-row').length === 20);
  await page.type('.store-history-filters input', '串1本');
  await page.waitForFunction(() => document.querySelectorAll('.store-inventory-history-row').length === 1);
  await page.$eval('.store-history-filters input', node => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(node, '存在しない商品'); node.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForSelector('.empty-state');
  assert.equal(await page.$('.store-inventory-history-row'), null);
  await page.screenshot({ path: resolve(output, 'after-empty-ja-393.png'), fullPage: false });
  result.checks.push('Search by item, processing and failure filters, and empty results remain functional.');

  await open();
  const next = await page.$('.store-history-pagination button:last-of-type');
  await next.click();
  await page.waitForFunction(() => document.querySelectorAll('.store-inventory-history-row').length === 5);
  assert.match(await page.$eval('.store-history-pagination', node => node.textContent), /2 \/ 2/);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('store-inventory-history-list')), true, 'pagination preserves list focus');
  await page.select('.store-inventory-history-actions select', '7');
  await page.waitForFunction(() => window.__fixture.reads.some(path => path.includes('days=7')));
  await page.waitForFunction(() => document.querySelectorAll('.store-inventory-history-row').length === 20);
  const reads = await page.evaluate(() => window.__fixture.reads.length);
  await page.click('.store-inventory-history-actions button');
  await page.waitForFunction(count => window.__fixture.reads.length > count, {}, reads);
  assert.deepEqual(await page.evaluate(() => window.__fixture.writes), []);
  result.checks.push('Pagination page 2, list focus, date range reset/read and refresh remain functional; fixture records no writes.');
  for (const language of ['zh-Hans', 'zh-Hant']) {
    await open(language);
    await page.click('.store-inventory-history-detail-toggle');
    await page.waitForSelector('.store-inventory-history-details');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${language} expanded state has no overflow`);
    await page.screenshot({ path: resolve(output, `after-failed-expanded-${language}-393.png`), fullPage: false });
  }
  result.checks.push('Simplified and Traditional Chinese expanded states fit at 393px.');
  assert.deepEqual(result.errors, [], 'no browser runtime errors');
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  await rm(resolve(output, 'failure.json'), { force: true });
  console.log(JSON.stringify({ ok: true, output, checks: result.checks, widths: result.sizes.map(({ width, before, after }) => ({ width, before: before.list, after: after.list })) }, null, 2));
} catch (error) {
  result.failure = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  await writeFile(resolve(output, 'failure.json'), JSON.stringify(result, null, 2));
  throw error;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
