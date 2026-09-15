// Exercises the actual sync panel with isolated status responses; never connects to a store.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const output = resolve(root, 'outputs/store-sync-progress-20260916');
const report = {
  id: 'test-sync', status: 'processing', details: { authority: 'uber_eats', osApplied: false }, platforms: [],
  reads: ['uber_eats', 'rocket_now', 'demae_can'].map((platform, i) => ({ id: `read-${i}`, platform, status: i < 2 ? 'succeeded' : 'processing', error: '', count: i < 2 ? 242 : 0 }))
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {WholeStoreAvailabilitySync} from './app/store/menu/WholeStoreAvailabilitySync';
window.__state={report:${JSON.stringify(report)},failure:false,requests:[],applied:0};
window.fetch=async(input,init={})=>{const s=window.__state;const url=new URL(String(input),location.href);s.requests.push({path:url.pathname,scope:url.searchParams.get('scope'),method:init.method||'GET'});await new Promise(r=>setTimeout(r,20));if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');if(init.method==='POST'){s.report=${JSON.stringify(report)};return Response.json({runId:s.report.id,targetCount:242});}if(s.failure)return new Response('Unavailable',{status:500});return Response.json({reports:s.report?[s.report]:[]});};
createRoot(document.getElementById('root')).render(<WholeStoreAvailabilitySync storeId="test-store" language={new URLSearchParams(location.search).get('language')||'zh-Hans'} disabled={false} onApplied={()=>window.__state.applied++}/>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = `${await readFile('app/globals.css', 'utf8')}\n${await readFile('app/store/store-responsive.css', 'utf8')}`;
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
  if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main class="store-workbench-shell"><div id="root" style="width:100%;max-width:1000px;margin:auto"></div></main><script src="/fixture.js"></script></body></html>');
});
if (!process.argv.includes('--check')) await new Promise(ok => server.listen(4179, '127.0.0.1', ok));
console.log('Sync progress fixture: http://127.0.0.1:4179 (synthetic responses only)');
if (process.argv.includes('--serve')) await new Promise(() => {});
else {
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    await mkdir(output, { recursive: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewport({ width, height: width < 500 ? 844 : 1024 });
      await page.goto('http://127.0.0.1:4179', { waitUntil: 'networkidle0' });
      await page.click('.inventory-calibration-panel > summary');
      await page.waitForSelector('.inventory-read-row');
      assert.equal(await page.$$('.inventory-read-row').then(rows => rows.length), 3);
      assert.match(await page.$eval('.inventory-read-summary', e => e.textContent), /2\/3/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.ok(await page.evaluate(() => window.__state.requests.every(r => r.scope === 'latest_full_sync')));
      await page.screenshot({ path: `${output}/progress-${width}.png`, fullPage: true });
    }
    await page.evaluate(() => { window.__state.failure = true; });
    await page.waitForSelector('.inventory-progress-refresh-error', { timeout: 8000 });
    assert.match(await page.$eval('.inventory-read-summary', e => e.textContent), /2\/3/);
    await page.screenshot({ path: `${output}/refresh-failed-360.png`, fullPage: true });
    await page.evaluate(() => {
      const state = window.__state;
      state.failure = false;
      state.report.status = 'awaiting_confirmation';
      state.report.reads.forEach(r => { r.status = 'succeeded'; r.count = 242; });
      state.report.details.previewAt = new Date().toISOString();
      state.report.details.comparison = { ready: true, pending: false, unknown: 0, counts: { foundr1: 1, rocket_now: 0, demae_can: 0 }, platforms: ['rocket_now', 'demae_can'], rows: [{ kind: 'item', targetId: 'test-item', label: '検証用商品', isAvailable: true, changes: ['foundr1'], cells: { uber_eats: { state: 'available' }, foundr1: { state: 'sold_out' }, rocket_now: { state: 'available' }, demae_can: { state: 'available' } } }] };
    });
    await page.click('.inventory-progress-refresh-error button');
    await page.waitForFunction(() => !document.querySelector('.inventory-progress-refresh-error') && document.querySelector('.inventory-read-summary').textContent.includes('3/3'));
    assert.ok(await page.$('.inventory-comparison-preview'));
    assert.equal(await page.evaluate(() => window.__state.requests.filter(r => r.method === 'POST').length), 0, 'Status recovery must not restart synchronization');
    await page.screenshot({ path: `${output}/recovered-preview-360.png`, fullPage: true });

    // Starting a new run should immediately fetch its progress, rather than wait for the polling interval.
    await page.evaluate(() => { window.__state.report = null; window.__state.failure = true; });
    await page.waitForSelector('.inventory-progress-refresh-error', { timeout: 8000 });
    await page.evaluate(() => { window.__state.failure = false; });
    await page.click('.inventory-progress-refresh-error button');
    await page.waitForFunction(() => !document.querySelector('.inventory-read-progress'));
    await page.click('.store-menu-head button');
    await page.waitForSelector('.inventory-read-progress', { timeout: 2000 });
    assert.equal(await page.evaluate(() => window.__state.requests.filter(r => r.method === 'POST').length), 1);
    assert.deepEqual(errors, []);
    console.log('PASS: 4 viewport sizes; 3-platform progress, failed refresh preserves progress, read-only recovery, comparison preview, immediate refresh after start; no browser errors');
  } finally { await browser.close(); if (server.listening) await new Promise(ok => server.close(ok)); }
}
