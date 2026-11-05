// Verifies real layout-service gating and React effect teardown in an isolated browser.
// Operational children are probes; no production endpoint or physical device is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, values) => {
  if (value.startsWith('--')) all.push([value.slice(2), values[index + 1]]);
  return all;
}, []));
const source = resolve(args.source || process.cwd());
const output = resolve(args.output || 'outputs/pos-debug-background');
await mkdir(output, { recursive: true });
const require = createRequire(join(source, 'package.json'));
const { build, stop } = require('esbuild');
const puppeteer = require('puppeteer-core');
const serviceNames = ['StoreVersionNotice', 'StoreNativeOrderNotifier', 'StorePrintStation', 'StoreInventorySyncStatus'];
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{StoreOperationalServices}from'./app/store/components/StoreOperationalServices';
window.__route=null;window.__events=[];window.__active=[];
function Harness(){const[state,setState]=useState({path:null,full:true});window.__change=(path,full=true)=>setState({path,full});window.__route=state.path;return <StoreOperationalServices fullWorkbench={state.full} initialVersion="fixture" initialShortVersion="fix"/>}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: source }, bundle: true, write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated-services', setup(build) {
  build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
  build.onResolve({ filter: /\/(StoreVersionNotice|StoreNativeOrderNotifier|StorePrintStation|StoreInventorySyncStatus)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', resolveDir: source, contents: args.path === 'navigation'
    ? 'export const usePathname=()=>window.__route;'
    : `import {useEffect} from 'react';export function ${args.path}(){useEffect(()=>{window.__events.push('mount:${args.path}');window.__active.push('${args.path}');return()=>{window.__events.push('unmount:${args.path}');window.__active=window.__active.filter(name=>name!=='${args.path}')}},[]);return null;}` }));
} }] });
const script = bundle.outputFiles[0].text;
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': req.url === '/fixture.js' ? 'application/javascript' : 'text/html' });
  res.end(req.url === '/fixture.js' ? script : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
});
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true });
const checks = [], errors = [], external = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => { if (request.url().startsWith(origin + '/')) return request.continue(); external.push(request.url()); return request.abort(); });
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__change));
  async function state(path, full, expected, name) {
    await page.evaluate((path, full) => window.__change(path, full), path, full);
    await page.waitForFunction(expected => JSON.stringify([...window.__active].sort()) === JSON.stringify([...expected].sort()), {}, expected);
    // Let passive effects complete before proving the null/debug states did not mount feeds.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual((await page.evaluate(() => window.__active)).sort(), [...expected].sort(), name);
    checks.push({ name, passed: true });
  }
  await state(null, true, [], 'unresolved-path-never-mounts-services');
  await state('/store/pos/debug', true, [], 'direct-debug-load-mounts-no-operational-or-version-effects');
  await state('/store/pos/debug/', true, [], 'trailing-slash-is-also-isolated');
  await state('/store/pos/customer-display/debug', true, [], 'debug-customer-display-mounts-no-live-services');
  await state('/store/pos/customer-display/debug/', true, [], 'debug-customer-display-trailing-slash-is-isolated');
  assert.deepEqual(await page.evaluate(() => window.__events), [], 'No transient mount before the route became known');
  await state('/store/pos', false, ['StoreVersionNotice'], 'restricted-user-keeps-normal-version-notice-only');
  await state('/store/pos', true, serviceNames, 'ordinary-full-store-preserves-all-services');
  await state('/store/pos/debug', true, [], 'entering-debug-unmounts-every-live-service');
  const events = await page.evaluate(() => window.__events);
  for (const name of serviceNames) assert.ok(events.includes(`unmount:${name}`), `${name} cleanup ran`);
  await state('/store/pos/debug-report', true, serviceNames, 'similarly-named-routes-remain-normal');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const path = 'app/store/components/StoreOperationalServices.tsx';
  const report = { checks, errors, externalRequests: external, sourceHash: createHash('sha256').update(await readFile(join(source, path))).digest('hex') };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: checks.length, report: join(output, 'report.json') }));
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); stop();
}
