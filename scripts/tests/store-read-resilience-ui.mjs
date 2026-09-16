// Run with scripts/verify-store-responsive.mjs --serve. All responses are synthetic; writes are blocked.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const output = 'outputs/store-read-resilience-20260916';
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const visit = path => page.goto(`http://127.0.0.1:4178${path}`, { waitUntil: 'networkidle0' });
const failRead = async path => {
 await page.evaluate(path => { window.__readTest.failPath = path; }, path);
 if (path.startsWith('/api/store/display/')) {
  await page.click('.store-display-menu-button');
  await page.waitForSelector('.store-display-menu');
  await page.$$eval('.store-display-menu button', es => es.find(e => e.textContent === '更新').click());
  await page.click('.store-display-menu-button');
  await page.waitForFunction(() => !document.querySelector('.store-display-menu'));
 }
};
const recover = async () => { await page.evaluate(() => { window.__readTest.failPath = ''; window.__readTest.hangPath = ''; }); await page.click('.read-status-notice button'); await page.waitForFunction(() => !document.querySelector('.read-status-notice')); };
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
try {
 for (const width of (process.argv.includes('--flows') || process.argv.includes('--menus') || process.argv.includes('--stats')) ? [] : [1440, 768, 390]) {
  await page.setViewport({ width, height: width < 500 ? 844 : 1024 });
  for (const display of ['pickup', 'courier', 'kitchen']) {
   await visit(`/store/display/${display}`);
   await failRead(`/api/store/display/${display}`);
   await page.waitForSelector('.read-status-notice');
   assert.match(await page.$eval('.read-status-notice', e => e.textContent), /最終取得/);
   if (display === 'pickup') assert.match(await page.$eval('main', e => e.textContent), /P-0001/);
   await noOverflow();
   assert.ok(await page.evaluate(() => {
    const notice = document.querySelector('.read-status-notice').getBoundingClientRect();
    const board = document.querySelector('.store-pickup-board, .store-kitchen-board, .store-courier-header').getBoundingClientRect();
    return notice.bottom <= board.top;
   }), 'Read notice must not cover the display');
   await page.screenshot({ path: `${output}/${display}-failure-${width}.png` });
   await recover();
  }
  await visit('/store/orders?fail=/api/store/order-stats');
  await page.waitForFunction(() => document.querySelectorAll('.store-order-card').length === 182);
  const queries = await page.evaluate(() => window.__requests.filter(r => r.path === '/api/store/orders').map(r => r.query));
  assert.ok(queries.some(q => q.includes('cursor=100')), 'Active queue must fetch subsequent pages');
  await page.select('select[aria-label="表示状態"]', 'all');
  await page.waitForFunction(() => document.querySelectorAll('.store-order-card').length === 50);
  const firstPage = await page.$$eval('.store-order-card', es => es.map(e => e.textContent));
  await page.click('.store-history-pagination button:last-child');
  await page.waitForFunction(() => document.querySelector('.store-history-pagination').textContent.includes('2') && document.querySelectorAll('.store-order-card').length === 50);
  const secondPage = await page.$$eval('.store-order-card', es => es.map(e => e.textContent));
  assert.ok(secondPage.every(text => !firstPage.includes(text)));
  await page.click('.store-history-pagination button:first-child');
  await page.waitForFunction(() => document.querySelector('.store-history-pagination').textContent.includes('1') && document.querySelectorAll('.store-order-card').length === 50);
  assert.deepEqual(await page.$$eval('.store-order-card', es => es.map(e => e.textContent)), firstPage);
  await page.type('input[aria-label="注文を検索"]', 'P-0182');
  await page.waitForFunction(() => document.querySelectorAll('.store-order-card').length === 1);
  assert.match(await page.$eval('.store-order-card', e => e.textContent), /P-0182/);
  await noOverflow();
  await page.screenshot({ path: `${output}/history-search-${width}.png` });
  await visit('/sync');
  await page.waitForSelector('.store-menu-sync-feedback');
  await failRead('/api/store/menu-sync-runs');
  await page.waitForSelector('.read-status-notice', { timeout: 15000 });
  await noOverflow();
  await page.screenshot({ path: `${output}/sync-failure-${width}.png` });
  await recover();
  console.log(`PASS ${width}px: three display failures/recovery, 182 orders across pages, history/search/previous page, single sync failure/recovery`);
 }
 if (!process.argv.includes('--menus')) {
  await visit('/store/orders');
  await page.waitForFunction(() => document.querySelector('.store-order-performance').textContent.includes('218,400'));
  await page.click('.store-orders-performance-disclosure > summary');
  await page.evaluate(() => { window.__readTest.failPath = '/api/store/order-stats'; });
  await page.select('select[aria-label="集計期間"]', '7');
  await page.waitForSelector('.read-status-notice');
  assert.deepEqual(await page.$$eval('.store-order-performance strong', es => es.map(e => e.textContent)), ['—', '—', '—', '—'], 'A different reporting period must not display stale totals or fabricated zeroes');
  assert.equal(await page.$$('.store-order-card').then(es => es.length), 182);
  await page.evaluate(() => { window.__readTest.failPath = ''; });
  await page.waitForFunction(() => !document.querySelector('.read-status-notice'), { timeout: 8000 });
  assert.match(await page.$eval('.store-order-performance', e => e.textContent), /218,400/);
  console.log('PASS reporting-period failure keeps orders usable and recovers automatically');
 }
 if (!process.argv.includes('--menus') && !process.argv.includes('--stats')) {
 // Timeout ends loading; concurrent focus/manual refreshes use the same pending request.
 await visit('/store/display/pickup');
 await page.evaluate(() => { window.__readTest.hangPath = '/api/store/display/pickup'; window.__requests = []; window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
 await page.waitForSelector('.read-status-notice', { timeout: 18000 });
 assert.equal(await page.evaluate(() => window.__requests.filter(r => r.path === '/api/store/display/pickup').length), 1);
 await recover();
 // Late first-store responses must not overwrite the newly selected store.
 await page.click('.store-display-menu-button');
 await page.evaluate(() => { window.__readTest.delays['test-store'] = 800; window.dispatchEvent(new Event('focus')); });
 await page.select('.store-display-menu select', 'test-store-2');
 await page.waitForFunction(() => !document.querySelector('main').textContent.includes('P-0001'));
 await new Promise(ok => setTimeout(ok, 1000));
 assert.equal(await page.$eval('.store-display-menu select', e => e.value), 'test-store-2');
 assert.ok(!(await page.$eval('main', e => e.textContent)).includes('P-0001'));
 console.log('PASS timeout, deduplication and stale store response');
 }
 if (!process.argv.includes('--stats')) {
 // Initial menu load failure is visible and retryable. Polling never downloads the catalog.
 await visit('/os/menus?fail=/api/menus');
 await page.waitForSelector('.read-status-notice');
 assert.ok(!(await page.$eval('main', e => e.textContent)).includes('読み込み中'));
 await recover();
 await page.waitForFunction(() => window.__requests.some(r => r.path === '/api/menus/progress'));
 const menuLoads = await page.evaluate(() => window.__requests.filter(r => r.path === '/api/menus').length);
 await failRead('/api/menus/progress');
 await page.waitForSelector('.read-status-notice', { timeout: 8000 });
 await page.evaluate(() => { window.__fixtures['/api/menus/progress'].syncTasks[0].status = 'succeeded'; });
 await recover();
 assert.equal(await page.evaluate(() => window.__requests.filter(r => r.path === '/api/menus').length), menuLoads);
 console.log('PASS menu initial failure/recovery and progress-only polling');
 }
 assert.deepEqual(errors, []);
 console.log('PASS no browser runtime errors');
} finally { await browser.close(); }
