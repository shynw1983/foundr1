// Isolated actual React components with synthetic API responses. No store writes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(process.env.INVENTORY_TEST_DEPENDENCIES
  ? `${process.env.INVENTORY_TEST_DEPENDENCIES}/package.json` : import.meta.url);
const { build } = require('esbuild');
const report = {
  id: 'fixture', runType: 'availability_change', action: 'unavailable', itemLabel: '牛肉片',
  source: 'store', actorName: 'テスト', createdAt: new Date().toISOString(), status: 'superseded',
  details: {}, failedCommands: [],
  platforms: [{ platform: 'rocket_now', total: 2, succeeded: 1, superseded: 1, failed: 0, timedOut: 0, processing: 0, queued: 0 }]
};
const run = { id: 'fixture', itemLabel: '牛肉片', isAvailable: false, source: 'store', createdAt: report.createdAt,
  platforms: [{ commandId: 'old', platform: 'rocket_now', status: 'superseded', error: '' },
    { commandId: 'new', platform: 'rocket_now', status: 'succeeded', error: '' }] };
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import History from './app/store/menu/inventory-history/page';
import {StoreInventorySyncStatus} from './app/store/components/StoreInventorySyncStatus';
localStorage.setItem('foundr1:store:selectedStoreId','fixture');
window.fetch=async(input,init={})=>{if(init.method && init.method!=='GET')throw Error('Fixture forbids writes');
const path=String(input);return Response.json(path.includes('inventory-history')?{reports:[${JSON.stringify(report)}]}:
path.includes('menu-sync-runs')?{runs:[${JSON.stringify(run)}]}:{});};
createRoot(document.getElementById('root')).render(<><History/><StoreInventorySyncStatus/></>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, outfile: '/tmp/inventory-fixture.js', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'fixture-context', setup(build) {
    build.onResolve({ filter: /OsTranslationProvider|StoreNavTabs|PlatformConnectionRecovery|shared-pusher-client/ }, args => ({path: args.path, namespace: 'fixture'}));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('OsTranslationProvider')
      ? `export const useOsTranslation=()=>({language:new URLSearchParams(location.search).get('language')||'zh-Hans'});`
      : args.path.includes('PlatformConnectionRecovery') ? `export const PlatformConnectionRecovery=()=>null;`
      : args.path.includes('shared-pusher-client') ? `export const acquireSharedPusher=()=>{throw Error('No live connection in fixture')};`
      : `export const StoreNavTabs=()=>null;`, loader: 'js' }));
    if (process.env.INVENTORY_TEST_DEPENDENCIES) {
      build.onResolve({filter: /^[^./]/}, args => ({path: require.resolve(args.path)}));
    }
  } }] });
const css = await readFile('app/globals.css', 'utf8') + '\n' + await readFile('app/store/store-responsive.css', 'utf8')
  + '\n' + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
createServer((req,res) => {
  res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : req.url === '/fixture.css' ? 'text/css' : 'text/html; charset=utf-8');
  res.end(req.url === '/fixture.js' ? bundle.outputFiles.find(file => file.path.endsWith('.js')).text : req.url === '/fixture.css' ? css :
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
}).listen(4187,'127.0.0.1',()=>console.log('Synthetic inventory fixture http://127.0.0.1:4187'));
