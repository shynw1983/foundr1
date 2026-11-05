// Real Store navigation, theme and account components; local in-memory APIs only.
// No production requests, orders, hardware or account mutations.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, stop } from 'esbuild';
import puppeteer from 'puppeteer-core';

const output = resolve(process.env.STORE_TABLET_NAV_OUTPUT || 'outputs/store-tablet-navigation-20261018/ui');
await mkdir(output, { recursive: true });
const storeId = '00000000-0000-4000-8000-000000000001';
const stores = [{ id: storeId, name: '桜並木店' }, { id: '00000000-0000-4000-8000-000000000002', name: '清川店' }];
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import{StoreNavTabs}from'./app/store/components/StoreNavTabs';import{StoreThemeProvider}from'./app/store/components/StoreThemeProvider';
import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
const params=new URLSearchParams(location.search);localStorage.setItem('foundr1-os-language',params.get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
function App(){return <OsTranslationProvider><StoreThemeProvider employeeId="fixture-employee"><main className="store-workbench-shell store-pos-page" style={{alignContent:"start"}}><header className="store-workbench-topbar"><a className="brand-block" href="/store" aria-label="Foundr1 店舗"><div className="brand-mark">F1</div><div><p className="eyebrow">Foundr1 STORE</p><h1>POS</h1></div></a><StoreNavTabs active="pos"/></header><section className="store-pos-head"><div><p className="eyebrow">レジ</p><h2>店頭会計</h2><p>LOCAL NAVIGATION VERIFICATION</p></div></section><button data-outside>商品を選択</button></main></StoreThemeProvider></OsTranslationProvider>};
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'fixture-navigation', setup(builder) {
  builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url),replace:url=>location.replace(url)});export const useSearchParams=()=>new URLSearchParams(location.search);`, loader: 'js' }));
}}] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async language => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const globalCss = await readFile('app/globals.css', 'utf8');
const themeCss = await readFile('app/store/store-theme.css', 'utf8');
const css = async before => globalCss + '\n' + await readFile(before ? resolve(output, 'store-responsive-before.css') : 'app/store/store-responsive.css', 'utf8') + '\n' + themeCss;
const requests = [], externalRequests = [], pageErrors = [], checks = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://fixture');
  const role = /fixtureRole=([^;]+)/.exec(request.headers.cookie ?? '')?.[1] || url.searchParams.get('role') || 'owner';
  const long = /fixtureLong=1/.test(request.headers.cookie ?? '') || url.searchParams.has('long');
  const fixtureStores = long ? stores.map(store => ({ ...store, name: store.name + '（店舗名が長い場合の表示確認）' })) : stores;
  const json = body => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
  try {
    if (url.pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(js); return; }
    if (url.pathname === '/fixture.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(await css(url.searchParams.has('before'))); return; }
    if (url.pathname.startsWith('/locales/os/')) { json(dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']); return; }
    if (url.pathname === '/api/auth/me') { json({ employee: { id: 'fixture-employee', name: long ? '店舗スタッフの名前が非常に長い場合の確認担当者' : '検証担当', loginId: 'fixture', role, permissions: ['store.inventory'] } }); return; }
    if (url.pathname === '/api/settings') { json({ settings: { header: { showClock: true, showLanguagePicker: true, showNotifications: true, userDisplay: long ? 'avatar_name' : 'avatar' } } }); return; }
    if (url.pathname === '/api/store/theme') { json({ storeId, storeName: fixtureStores[0].name, stores: fixtureStores, canManageTheme: role === 'owner', theme: { primaryColor: '#245d49', paletteVersion: 1 }, revision: null, updatedAt: null }); return; }
    if (url.pathname === '/api/store/context') { json({ access: { role, stores: role === 'owner' ? fixtureStores : fixtureStores.slice(0, 1), canUseAllStoreView: role === 'owner' }, selectedStoreId: storeId }); return; }
    if (url.pathname === '/api/os/store-context') { json({ canSelectStore: false, stores: [], selectedStoreId: storeId }); return; }
    if (url.pathname.startsWith('/api/')) { requests.push({ method: request.method, path: url.pathname }); json({ notifications: [], unreadCount: 0, enabled: false, stores: [] }); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': [`fixtureRole=${url.searchParams.get('role') || role}; Path=/; SameSite=Lax`, `fixtureLong=${long ? '1' : '0'}; Path=/; SameSite=Lax`] });
    response.end(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css${url.searchParams.has('before') ? '?before=1' : ''}"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  } catch (error) { response.writeHead(500); response.end(error.stack); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let context, page;
async function open({ width, height, role = 'owner', language = 'ja', before = false, long = false }) {
  if (context) await context.close(); context = await browser.createBrowserContext(); page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 1024, hasTouch: width <= 1024 });
  await page.setRequestInterception(true); page.on('request', request => { if (request.url().startsWith(origin + '/')) request.continue(); else { externalRequests.push(request.url()); request.abort(); } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${origin}/store/pos?role=${role}&lang=${language}${before ? '&before=1' : ''}${long ? '&long=1' : ''}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.account-menu');
  await page.waitForFunction(() => document.querySelector('.store-nav-tabs > details'));
  await page.evaluate(() => document.addEventListener('click', event => { if (event.target.closest('.store-group-list a')) event.preventDefault(); }, true));
}
async function fits(label) {
  const result = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, width: innerWidth }));
  assert.ok(result.document <= result.width + 1 && result.body <= result.width + 1, `${label}: ${JSON.stringify(result)}`);
}
async function verifyNavigation({ width, height, role, language, before = false, long = false }) {
  const label = `${before ? 'before' : 'after'}-${role}-${language}-${width}${long ? '-long' : ''}`;
  await open({ width, height, role, language, before, long });
  const expanded = width >= 768 && !before || width > 1100;
  const state = await page.evaluate(() => {
    const visible = element => Boolean(element && element.getBoundingClientRect().width && element.getBoundingClientRect().height && getComputedStyle(element).visibility !== 'hidden');
    return { tabs: visible(document.querySelector('.store-nav-tabs')), menu: visible(document.querySelector('.store-nav-menu')), language: visible(document.querySelector('.os-language-picker select')), account: visible(document.querySelector('.account-menu > summary')), store: visible(document.querySelector('.store-nav-store-switch')), posCurrent: document.querySelector('.store-nav-tabs a[href="/store/pos"]')?.getAttribute('aria-current') };
  });
  assert.equal(state.tabs, expanded, `${label}: expanded nav`); assert.equal(state.menu, !expanded, `${label}: menu`);
  assert.equal(state.language, true, `${label}: language`); assert.equal(state.account, true, `${label}: account`); assert.equal(state.store, role === 'owner', `${label}: store access`); assert.equal(state.posCurrent, 'page');
  if (long) {
    const badge = await page.$eval('.account-menu > summary', element => {
      const bounds = element.getBoundingClientRect();
      const children = [...element.querySelectorAll('.user-avatar, .user-badge-meta, .user-badge-name, .user-badge-role')].map(child => {
        const rect = child.getBoundingClientRect(); return { className: child.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, visible: Boolean(rect.width && rect.height) && getComputedStyle(child).display !== 'none' };
      });
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, children };
    });
    assert.ok(badge.children.filter(child => child.visible).every(child => child.left >= badge.left - 1 && child.right <= badge.right + 1 && child.top >= badge.top - 1 && child.bottom <= badge.bottom + 1), `${label}: badge content overflow ${JSON.stringify(badge)}`);
  }
  await fits(label);
  if (!expanded) await page.click('.store-nav-menu > summary');
  const nav = expanded ? '.store-nav-tabs' : '.store-nav-list';
  if (expanded && width <= 1100) {
    const heights = await page.$$eval(`${nav} > a, ${nav} > details > summary`, elements => elements.map(element => element.getBoundingClientRect().height));
    assert.ok(heights.every(height => height >= 44), `${label}: tablet target heights ${heights}`);
  }
  assert.equal(await page.$$eval(`${nav} > a`, items => items.some(item => item.getAttribute('href') === '/store/settings/appearance')), role === 'owner', `${label}: theme role access`);
  assert.equal(await page.$$eval(`${nav} > details`, items => items.length), 4, `${label}: four function groups`);
  for (let index = 0; index < 4; index++) {
    const selector = `${nav} > details:nth-of-type(${index + 1})`;
    await page.click(`${selector} > summary`);
    assert.equal(await page.$eval(selector, element => element.open), true);
    const bounds = await page.$eval(`${selector} .store-group-list`, element => { const b = element.getBoundingClientRect(); return { left: b.left, right: b.right, width: innerWidth }; });
    assert.ok(bounds.left >= -1 && bounds.right <= bounds.width + 1, `${label}: dropdown ${index} clipped ${JSON.stringify(bounds)}`);
    await fits(`${label}: dropdown ${index}`);
    if (index === 0) {
      await page.click(`${selector} .store-group-list a`);
      assert.equal(await page.$eval(selector, element => element.open), false, `${label}: selecting a group link closes it`);
      await page.click(`${selector} > summary`);
    }
    await page.keyboard.press('Escape'); assert.equal(await page.$eval(selector, element => element.open), false);
    if (!expanded) await page.click('.store-nav-menu > summary');
  }
  if (!expanded) await page.keyboard.press('Escape');
  await page.click('.account-menu > summary');
  assert.equal(await page.$eval('.account-menu', element => element.open), true);
  assert.equal(await page.$$eval('.account-menu-panel a', items => items.some(item => item.getAttribute('href') === '/os')), role === 'owner');
  assert.equal(await page.$$eval('.account-menu-panel a', items => items.some(item => item.getAttribute('href') === '/store/logout')), true);
  await fits(`${label}: account`); await page.mouse.click(2, height - 2);
  assert.equal(await page.$eval('.account-menu', element => element.open), false);
  await page.select('.os-language-picker select', language === 'ja' ? 'zh-Hans' : 'ja');
  assert.equal(await page.$eval('.os-language-picker select', element => element.value), language === 'ja' ? 'zh-Hans' : 'ja');
  await page.select('.os-language-picker select', language);
  await page.screenshot({ path: `${output}/${label}.png`, fullPage: true });
  checks.push({ label, state, groupCount: 4, noOverflow: true });
}
try {
  const beforeOnly = process.env.STORE_TABLET_NAV_BEFORE_ONLY === '1';
  const longOnly = process.env.STORE_TABLET_NAV_LONG_ONLY === '1';
  if (beforeOnly) {
    for (const width of [768, 1024]) await verifyNavigation({ width, height: width === 768 ? 1024 : 768, role: 'store_terminal', language: 'ja', before: true });
  } else if (longOnly) {
    for (const [width, height] of [[390, 844], [768, 1024], [1024, 768]]) await verifyNavigation({ width, height, role: 'owner', language: 'ja', long: true });
  } else {
    for (const role of ['owner', 'store_terminal']) for (const language of ['ja', 'zh-Hans']) for (const [width, height] of [[390, 844], [767, 1024], [768, 1024], [834, 1112], [1024, 768], [1440, 900]]) await verifyNavigation({ width, height, role, language });
    await verifyNavigation({ width: 768, height: 1024, role: 'owner', language: 'ja', long: true });
    await open({ width: 768, height: 1024, role: 'staff', language: 'ja', long: true });
    assert.equal(await page.$$eval('.store-nav-tabs > details', elements => elements.length), 1);
    await page.click('.store-nav-tabs > details > summary');
    const staffBounds = await page.$eval('.store-nav-tabs .store-group-list', element => { const b = element.getBoundingClientRect(); return { left: b.left, right: b.right, width: innerWidth }; });
    assert.ok(staffBounds.left >= -1 && staffBounds.right <= staffBounds.width + 1, `staff single group clipped: ${JSON.stringify(staffBounds)}`);
    await fits('staff-single-inventory-768');
    await page.screenshot({ path: `${output}/after-staff-ja-768-single-group-long.png`, fullPage: true });
    checks.push({ label: 'staff-ja-768-single-group-long', groupCount: 1, noOverflow: true, dropdownBounds: staffBounds });
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
  const report = { checks, pageErrors, externalRequests, unexpectedApiMutations: requests.filter(request => request.method !== 'GET') };
  assert.deepEqual(report.unexpectedApiMutations, []);
  const reportName = beforeOnly ? 'before' : longOnly ? 'long-name' : 'after';
  await writeFile(`${output}/${reportName}-verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: checks.length, report: `${output}/${reportName}-verification.json` }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); stop(); }
