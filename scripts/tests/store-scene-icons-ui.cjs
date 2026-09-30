// Real Store components and scene API with PGlite and fake devices. No live calls.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = process.cwd();
const { fixture, storeId } = require('./store-scenes-fixture.cjs');

(async () => {
  const f = await fixture();
  const esbuild = require(process.env.ESBUILD_MODULE_PATH || 'esbuild');
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {StoreDevicesPanel} from './app/store/devices/StoreDevicesPanel';
    import {OsTranslationProvider,OsLanguagePicker} from './app/os/components/OsTranslationProvider';
    function App(){return <OsTranslationProvider><main className="os-content" style={{maxWidth:1160,margin:'0 auto',padding:16}}>
      <header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h1>清水店 · 機器</h1><OsLanguagePicker/></header>
      <p style={{fontSize:12}}>ローカル検証 · 模擬デバイス</p><StoreDevicesPanel storeId="${storeId}" storeName="清水店"/>
    </main></OsTranslationProvider>}; createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`;
  const bundle = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true,
    format: 'iife', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost:38844');
      if (url.pathname === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/globals.css"><title>Store scene icons — local verification</title><div id="root"></div><script src="/app.js"></script></html>');
      }
      if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(bundle.outputFiles[0].text); }
      if (url.pathname === '/globals.css') { res.setHeader('Content-Type', 'text/css'); return res.end(fs.readFileSync(path.join(root, 'app/globals.css'))); }
      if (/^\/locales\/os\/(zh-Hans|zh-Hant|zh)\.json$/.test(url.pathname)) {
        res.setHeader('Content-Type', 'application/json'); return res.end(fs.readFileSync(path.join(root, 'public', url.pathname)));
      }
      let result;
      if (url.pathname === '/test/report') {
        const settings = (await f.db.query("select settings from module_settings where module_key='store_device_scenes'")).rows;
        result = Response.json({ settings, posts: f.posts, jobs: f.jobs.length, statusReads: f.reads.filter(url => url.endsWith('/status')).length });
      } else if (url.pathname === '/api/store/devices/scenes') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const request = new Request(url, { method: req.method, headers: req.headers,
          ...(['GET','HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
        result = await f.route[req.method](request);
      } else if (url.pathname === '/api/store/devices' && req.method === 'GET') {
        result = Response.json(await f.service.getStoreDevices(storeId, url.searchParams.get('device') || undefined));
      } else { res.statusCode = 404; return res.end('not found'); }
      res.statusCode = result.status; res.setHeader('Content-Type', 'application/json'); res.end(await result.text());
    } catch (error) { console.error(error); res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }
  });
  server.listen(38844, '127.0.0.1', () => console.log('Local scene icon fixture http://localhost:38844; no live hardware or account.'));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => server.close(async () => { await f.db.close(); process.exit(0); }));
})().catch(error => { console.error(error); process.exit(1); });
