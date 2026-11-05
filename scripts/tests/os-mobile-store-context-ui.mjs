// Actual OS navigation, account, store picker, translation provider and global CSS.
// Only local synthetic APIs are used; store changes update in-memory fixture state.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build, stop } from 'esbuild';
import puppeteer from 'puppeteer-core';

const output = resolve(process.env.OS_MOBILE_STORE_UI_OUTPUT || 'outputs/os-mobile-store-context-20261020/ui');
await mkdir(output, { recursive: true });
const stores = [
  { id: '00000000-0000-4000-8000-000000000001', name: '桜並木店' },
  { id: '00000000-0000-4000-8000-000000000002', name: '清水店（店舗名が非常に長い場合の多店舗管理表示確認）' }
];
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import{MobileNavMenu}from'./app/os/components/MobileNavMenu';
import{UserBadge}from'./app/os/components/UserBadge';
import{OsNavList,canonicalNavItems}from'./app/os/components/OsNavList';
import{OsTranslationProvider}from'./app/os/components/OsTranslationProvider';
const params=new URLSearchParams(location.search),home=params.get('layout')==='home';
localStorage.setItem('foundr1-os-language',params.get('lang')||'ja');localStorage.setItem('foundr1-os-language-preference','manual');
const brand=<a className="brand-block" href="/os"><div className="brand-mark">F1</div><div><p className="eyebrow">Foundr1 OS</p><h1>{home?'管理画面':'メニュー管理'}</h1></div></a>;
const content=<section className="workspace"><h2>LOCAL OS STORE CONTEXT VERIFICATION</h2><button data-outside type="button">操作対象を確認</button></section>;
function App(){return <OsTranslationProvider>{home?<main className="os-home-shell"><header className="os-home-topbar">{brand}<div className="os-home-user"><UserBadge/><MobileNavMenu navItems={canonicalNavItems}/></div></header>{content}</main>:<main className="shell"><aside className="sidebar" aria-label="管理画面ナビゲーション">{brand}<MobileNavMenu navItems={canonicalNavItems}/><div className="sidebar-user"><UserBadge/></div><OsNavList navItems={canonicalNavItems}/></aside>{content}</main>}</OsTranslationProvider>};
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, outdir: '/virtual', jsx: 'automatic', charset: 'utf8',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'os-navigation-fixture', setup(builder) {
    builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onResolve({ filter: /\/(QuickOperationsDashboard|NotificationMenu)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
      contents: args.path === 'next/link'
        ? `import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`
        : args.path === 'next/navigation'
          ? `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`
          : `export function ${args.path}(){return null}`,
      loader: 'js', resolveDir: process.cwd()
    }));
  } }]
});
const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = await readFile('app/globals.css', 'utf8');
const dictionaries = Object.fromEntries(await Promise.all(['zh-Hans', 'zh-Hant'].map(async language => [language, JSON.parse(await readFile(`public/locales/os/${language}.json`, 'utf8'))])));
const sources = ['app/os/components/MobileNavMenu.tsx', 'app/os/components/OsStoreContextPicker.tsx', 'app/os/components/UserBadge.tsx', 'app/globals.css'];
await writeFile(`${output}/source-hashes.json`, JSON.stringify(Object.fromEntries(await Promise.all(sources.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')]))), null, 2) + '\n');

const cases = new Map(), pendingChanges = new Map(), posts = [], unexpectedRequests = [], pageErrors = [], checks = [], layouts = [];
let documentId = 0;
const send = (response, body, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://fixture');
    const referer = new URL(request.headers.referer || request.url, 'http://fixture');
    const params = url.pathname.startsWith('/api/') ? referer.searchParams : url.searchParams;
    const caseId = params.get('case') || 'default';
    if (!cases.has(caseId)) cases.set(caseId, { selectedStoreId: stores[0].id, visits: 0 });
    const state = cases.get(caseId), role = params.get('role') || 'owner';
    if (url.pathname === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); response.end(javascript); return; }
    if (url.pathname.startsWith('/locales/os/')) { send(response, dictionaries[url.pathname.includes('Hant') ? 'zh-Hant' : 'zh-Hans']); return; }
    if (url.pathname === '/api/auth/me') { send(response, { employee: { id: 'fixture-employee', name: '検証担当', loginId: 'fixture', role, permittedNavPaths: ['/os/inventory'] } }); return; }
    if (url.pathname === '/api/settings' && request.method === 'GET') { send(response, { settings: { betaNavPaths: [] } }); return; }
    if (url.pathname === '/api/sns' && request.method === 'GET') { send(response, { stores: [] }); return; }
    if (url.pathname === '/api/os/store-context') {
      if (request.method === 'GET') { send(response, { canSelectStore: role === 'owner' || role === 'manager', stores: role === 'staff' ? [] : stores, selectedStoreId: state.selectedStoreId }); return; }
      if (request.method === 'POST') {
        let raw = ''; for await (const part of request) raw += part;
        const body = JSON.parse(raw); posts.push({ caseId, ...body });
        assert.ok(stores.some(store => store.id === body.storeId), 'Only synthetic store IDs may be selected');
        const complete = () => {
          if (params.get('mode') === 'fail') { send(response, { error: '検証用: 店舗を切り替えられませんでした。' }, 503); return; }
          state.selectedStoreId = body.storeId;
          send(response, { ok: true, selectedStoreId: body.storeId });
        };
        if (params.get('mode') === 'delay') pendingChanges.set(caseId, complete); else complete();
        return;
      }
    }
    if (url.pathname.startsWith('/api/') || request.method !== 'GET') { unexpectedRequests.push({ method: request.method, path: url.pathname }); send(response, { error: 'Unexpected fixture request' }, 403); return; }
    state.visits++;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.__fixtureDocumentId=${++documentId}</script><script src="/fixture.js"></script></body></html>`);
  } catch (error) { response.writeHead(500); response.end(error.stack); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let page, context, caseCounter = 0;
const headerSelect = '.mobile-store-context select';
async function open({ width = 390, layout = 'sidebar', role = 'owner', lang = 'ja', mode = '' } = {}) {
  if (context) await context.close();
  context = await browser.createBrowserContext(); page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1, isMobile: width <= 1024, hasTouch: width <= 1024 });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith(origin + '/')) request.continue();
    else { unexpectedRequests.push({ method: request.method(), path: request.url() }); request.abort(); }
  });
  const caseId = `case-${++caseCounter}`;
  await page.goto(`${origin}${layout === 'home' ? '/os' : '/os/menus'}?${new URLSearchParams({ case: caseId, layout, role, lang, mode })}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.account-menu');
  if (role !== 'staff') await page.waitForFunction(selector => document.querySelector(selector)?.value !== '', {}, '.os-global-store-picker select');
  return caseId;
}
async function measure(label) {
  const info = await page.evaluate(() => {
    const visible = element => Boolean(element?.getClientRects().length && element.getBoundingClientRect().width && element.getBoundingClientRect().height && getComputedStyle(element).visibility !== 'hidden');
    const bounds = element => { const rect = element?.getBoundingClientRect(); return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null; };
    const select = document.querySelector('.mobile-store-context select');
    const menu = document.querySelector('.mobile-nav-menu');
    const header = document.querySelector('.sidebar,.os-home-topbar');
    const childStyles = [...header.children].map(element => { const style = getComputedStyle(element); return { className: element.className, bounds: bounds(element), display: style.display, order: style.order, width: style.width, flex: style.flex }; });
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, header: bounds(header), workspace: bounds(document.querySelector('.workspace')), brand: bounds(header.querySelector('.brand-block')), headerStyles: { display: getComputedStyle(header).display, alignSelf: getComputedStyle(header).alignSelf, alignContent: getComputedStyle(header).alignContent, gridRows: getComputedStyle(header).gridTemplateRows }, childStyles, store: bounds(select), wrapper: bounds(document.querySelector('.mobile-store-context')), storeVisible: visible(select), menu: bounds(menu?.querySelector('summary')), open: menu?.open, visibleSelects: [...document.querySelectorAll('.os-global-store-picker select')].filter(visible).length };
  });
  assert.ok(info.scrollWidth <= info.width + 1, `${label}: no horizontal overflow ${JSON.stringify(info)}`);
  if (info.storeVisible) {
    assert.ok(info.store.left >= 0 && info.store.right <= info.width + 1, `${label}: store selector fits viewport`);
    assert.ok(info.store.bottom <= info.header.bottom + 1, `${label}: selector belongs to header`);
    assert.ok(info.store.height >= 38, `${label}: touch control retains usable height`);
    assert.equal(info.visibleSelects, 1, `${label}: one visible store selector`);
  }
  layouts.push({ label, ...info });
  if (info.storeVisible && label.startsWith('sidebar-')) {
    assert.ok(info.header.height <= 240, `${label}: compact header does not stretch with workspace ${JSON.stringify(info)}`);
    assert.ok(Math.abs(info.menu.top - info.brand.top) <= 10, `${label}: brand and hamburger share the first row`);
    assert.ok(info.workspace.top <= info.header.bottom + 32, `${label}: workspace follows header without a stretched empty grid row`);
  }
  return info;
}
async function assertMenu({ storeSelector = headerSelect, screenshotName } = {}) {
  await page.click('.mobile-nav-menu > summary');
  await page.waitForSelector('.mobile-nav-menu[open] .mobile-nav-list', { visible: true });
  assert.equal(await page.$('.mobile-nav-user .os-global-store-picker'), null, 'Menu does not duplicate the header selector');
  const menuPosition = await page.evaluate(selector => {
    const visible = element => Boolean(element?.getClientRects().length && element.getBoundingClientRect().width && element.getBoundingClientRect().height && getComputedStyle(element).visibility !== 'hidden');
    const store = document.querySelector(selector);
    return { menuTop: document.querySelector('.mobile-nav-list').getBoundingClientRect().top, storeBottom: store.getBoundingClientRect().bottom, storeVisible: visible(store), visibleSelects: [...document.querySelectorAll('.os-global-store-picker select')].filter(visible).length };
  }, storeSelector);
  assert.equal(menuPosition.storeVisible, true, 'Opening navigation retains the visible store selector');
  assert.equal(menuPosition.visibleSelects, 1, 'Open navigation retains one visible store selector');
  assert.ok(menuPosition.menuTop >= menuPosition.storeBottom, `Open menu preserves visible store context: ${JSON.stringify(menuPosition)}`);
  if (screenshotName) await page.screenshot({ path: `${output}/${screenshotName}.png` });
  const heading = '.mobile-nav-section-heading';
  await page.click(heading);
  await page.waitForSelector('.mobile-nav-section.is-open .mobile-nav-section-links a', { visible: true });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.mobile-nav-menu')?.open);
}

try {
  for (const layout of ['sidebar', 'home']) {
    for (const width of [360, 390, 768, 1024, 1440]) {
      await open({ width, layout });
      const label = `${layout}-${width}`;
      const info = await measure(label);
      assert.equal(info.storeVisible, width <= 1120, `${label}: header selector breakpoint`);
      if (width <= 1120) {
        assert.equal(info.open, false, `${label}: store visible while menu closed`);
        await page.screenshot({ path: `${output}/${label}.png` });
        await assertMenu();
      } else if (layout === 'sidebar') {
        await page.click('.nav-list .nav-item');
        await page.waitForSelector('.sidebar:has(.nav-shell.is-expanded) .sidebar-user .os-global-store-picker select', { visible: true });
        assert.equal(await page.$eval('.sidebar-user .os-global-store-picker select', element => element.value), stores[0].id, 'Expanded desktop retains store context');
      } else {
        const desktopHomeSelect = '.os-home-user > .user-panel .os-global-store-picker select';
        await page.waitForSelector(desktopHomeSelect, { visible: true });
        assert.equal(await page.$eval(desktopHomeSelect, element => element.value), stores[0].id, 'Desktop home retains its outer store context');
        await assertMenu({ storeSelector: desktopHomeSelect, screenshotName: 'home-1440-menu' });
      }
      await measure(`${label}-after-menu`);
    }
  }
  checks.push('sidebar and home: 360/390/768/1024px show one direct store selector; 1440px preserves desktop selector and all widths fit');
  checks.push('mobile menus open, expand navigation modules, close with Escape, and contain no duplicate store picker');
  checks.push('1440px desktop home menu opens, expands and closes while retaining exactly one visible outer store selector');

  const delayedCase = await open({ mode: 'delay' });
  const oldDocument = await page.evaluate(() => window.__fixtureDocumentId);
  await page.select(headerSelect, stores[1].id);
  await page.waitForFunction(selector => document.querySelector(selector)?.disabled === true, {}, headerSelect);
  assert.equal(posts.filter(post => post.caseId === delayedCase).length, 1, 'One context request while switching');
  const release = pendingChanges.get(delayedCase); assert.ok(release, 'Synthetic context response is held');
  const navigation = page.waitForNavigation({ waitUntil: 'networkidle0' }); release(); pendingChanges.delete(delayedCase); await navigation;
  await page.waitForFunction((selector, storeId) => document.querySelector(selector)?.value === storeId, {}, headerSelect, stores[1].id);
  assert.notEqual(await page.evaluate(() => window.__fixtureDocumentId), oldDocument, 'Successful switch reloads the current OS page');
  await measure('sidebar-long-name-after-success');
  await page.screenshot({ path: `${output}/sidebar-long-name-after-success.png` });
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(await page.$eval(headerSelect, element => element.value), stores[1].id, 'Selection is loaded from saved fixture context');
  checks.push('pending save disables selection; successful response reloads current page and retains saved long store name');

  await open({ layout: 'home', mode: 'fail' });
  const failureDocument = await page.evaluate(() => window.__fixtureDocumentId);
  await page.select(headerSelect, stores[1].id);
  await page.waitForSelector('.mobile-store-context [role="alert"]', { visible: true });
  assert.equal(await page.$eval(headerSelect, element => element.value), stores[0].id, 'Failed switch restores actual saved store');
  assert.equal(await page.$eval(headerSelect, element => element.disabled), false, 'Failed switch permits retry');
  assert.equal(await page.evaluate(() => window.__fixtureDocumentId), failureDocument, 'Failed switch does not reload');
  await measure('home-failed-switch');
  await page.screenshot({ path: `${output}/home-failed-switch.png` });
  checks.push('failed save restores previous store, exposes error and permits retry without reloading');

  for (const layout of ['sidebar', 'home']) {
    await open({ layout, role: 'staff' });
    const info = await measure(`${layout}-staff`);
    assert.equal(info.storeVisible, false, 'Existing permission response hides the selector');
    assert.equal(info.wrapper?.height || 0, 0, 'No empty store row for employees without switching permission');
    await page.click('.mobile-nav-menu > summary');
    assert.equal(await page.$('.mobile-nav-list a[href="/os/settings"]'), null, 'Existing navigation permission filtering stays active');
    assert.ok(await page.$('.mobile-nav-list'), 'Navigation remains available without store permission');
  }
  checks.push('staff permissions hide store selector without a blank header row; permitted navigation remains available');

  await open({ role: 'manager', lang: 'zh-Hans' });
  await page.waitForFunction(() => document.querySelector('.mobile-store-context')?.textContent.includes('目标门店'));
  await measure('manager-zh-Hans');
  checks.push('manager switching permission and Chinese translation retain direct header store context');
  assert.deepEqual(unexpectedRequests, [], 'No external requests or unexpected business mutations');
  assert.deepEqual(pageErrors, [], 'No browser errors');
  const report = { passed: true, scope: 'Real shared OS navigation/account/picker/translation/CSS; synthetic APIs; quick dashboard and notification stubs', checks, layouts, syntheticContextPosts: posts, unexpectedRequests, pageErrors };
  await writeFile(`${output}/ui-verification.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS OS mobile store context UI: ${checks.join('; ')}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/ui-verification.json`, JSON.stringify({ passed: false, checks, layouts, posts, unexpectedRequests, pageErrors, error: error.stack }, null, 2) + '\n');
  throw error;
} finally {
  for (const complete of pendingChanges.values()) complete();
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); stop();
}
