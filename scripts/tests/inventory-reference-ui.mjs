// Server-only visual fixture. Real Store components + real pure comparison
// builder; all persistence below is synthetic and confined to 127.0.0.1.
// INVENTORY_REFERENCE_TEST_PORT=4190 node scripts/tests/inventory-reference-ui.mjs --serve
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';

if (!process.argv.includes('--serve')) throw new Error('This synthetic fixture supports --serve only; it never launches a browser');
const root = process.cwd(), require = createRequire(import.meta.url), ts = require('typescript');
const port = Number(process.env.INVENTORY_REFERENCE_TEST_PORT || 4190);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local fixture port');
const base = `http://127.0.0.1:${port}`;
const comparisonExports = {};
runInNewContext(ts.transpileModule(await readFile(resolve(root, 'lib/inventory-comparison.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: comparisonExports });
const { buildInventoryComparison } = comparisonExports;
const cases = new Set(['default', 'conflict', 'unknown', 'expired', 'stale', 'history-unavailable']);
const runs = new Map(), mutations = [];
const clone = value => JSON.parse(JSON.stringify(value));
const targets = [
  { kind: 'option', targetId: 'synthetic-fine', label: '火鍋春雨（細）50g', isAvailable: false, wasAvailable: false },
  { kind: 'option', targetId: 'synthetic-cheese', label: 'たっぷりチーズがけ', isAvailable: false, wasAvailable: false },
  { kind: 'option', targetId: 'synthetic-soup', label: '薬膳牛骨スープを選ぶ', isAvailable: true, wasAvailable: false },
  { kind: 'item', targetId: 'synthetic-tomato', label: '濃厚トマトスープ', isAvailable: true, wasAvailable: true },
  { kind: 'option', targetId: 'synthetic-draft', label: '未公開の新しい配料', isAvailable: false, wasAvailable: false },
  { kind: 'option', targetId: 'synthetic-excluded', label: 'Uber 限定の選択肢', isAvailable: true, wasAvailable: true }
];

function updateComparison(state) {
  state.report.details.comparison = clone(buildInventoryComparison(state.report.details, state.commands));
  const comparison = state.report.details.comparison;
  const blockedRow = comparison.rows.find(row => row.targetId === 'synthetic-soup' && row.changes.length);
  const overrideRow = comparison.rows.find(row => row.changes.some(platform => platform !== 'foundr1' && platform !== comparison.referencePlatform));
  const overridePlatform = overrideRow?.changes.find(platform => platform !== 'foundr1' && platform !== comparison.referencePlatform);
  state.report.details.referenceConflicts = state.case === 'conflict' ? [
    ...(blockedRow ? [{ kind: blockedRow.kind, targetId: blockedRow.targetId, label: blockedRow.label, reason: 'inventory_block' }] : []),
    ...(overrideRow && overridePlatform ? [{ kind: overrideRow.kind, targetId: overrideRow.targetId, label: overrideRow.label, reason: 'platform_override', platform: overridePlatform }] : [])
  ] : [];
}
function newRun(storeId, scenario, fresh = false) {
  const previewAt = new Date(Date.now() - (scenario === 'expired' && !fresh ? 660000 : 0)).toISOString();
  const preview = clone(targets), runId = randomUUID();
  const commands = ['rocket_now', 'demae_can'].map(platform => ({ id: `synthetic-read-${platform}`, platform,
    status: scenario === 'unknown' && platform === 'rocket_now' ? 'failed' : 'succeeded', error: scenario === 'unknown' && platform === 'rocket_now' ? 'Synthetic read timeout' : '',
    payload: { comparisonAudit: true, targets: preview.map(({ kind, targetId }) => ({ kind, targetId })) },
    result: { items: preview.map(row => row.targetId === 'synthetic-draft' && platform === 'demae_can'
      ? { kind: row.kind, targetId: row.targetId, found: true, status: 'staged', isAvailable: null, stagingVerified: true }
      : { kind: row.kind, targetId: row.targetId, found: true, status: row.targetId === 'synthetic-fine' || row.isAvailable ? 'available' : 'sold_out', isAvailable: row.targetId === 'synthetic-fine' || row.isAvailable }) }, updatedAt: previewAt
  }));
  const state = { storeId, case: scenario, commands, staleOnce: false, report: { id: runId,
    status: scenario === 'expired' && !fresh ? 'expired' : 'awaiting_confirmation',
    reads: [{ id: 'synthetic-read-uber', platform: 'uber_eats', status: 'succeeded', count: preview.length }, ...commands.map(command => ({ id: command.id, platform: command.platform, status: command.status, error: command.error, count: preview.length }))],
    details: { authority: 'uber_eats', referencePlatform: 'uber_eats', previewRevision: randomUUID(), previewAt,
      osApplied: false, comparisonVersion: 1, comparisonPlatforms: ['rocket_now', 'demae_can'],
      comparisonExclusions: [{ platform: 'demae_can', kind: 'option', targetId: 'synthetic-excluded' }], preview,
      previousWriteConflictsUnavailable: scenario === 'history-unavailable',
      previousWriteConflicts: [{ kind: 'option', targetId: 'synthetic-fine', label: '火鍋春雨（細）50g', isAvailable: true, successfulPlatforms: ['rocket_now', 'demae_can'] }] }, platforms: [] } };
  updateComparison(state); runs.set(storeId, state); return state;
}
function stateFor(storeId) {
  if (!/^fixture-(default|conflict|unknown|expired|stale|history-unavailable)(-other)?$/.test(storeId || '')) throw Error('Only synthetic store IDs are allowed');
  const scenario = storeId.replace(/^fixture-/, '').replace(/-other$/, '');
  return runs.get(storeId) || newRun(storeId, scenario);
}
const entry = `import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
import{WholeStoreAvailabilitySync}from'./app/store/menu/WholeStoreAvailabilitySync';
const params=new URLSearchParams(location.search),scenario=params.get('case')||'default';
if(!${JSON.stringify([...cases])}.includes(scenario))throw Error('Unknown synthetic case');
const originalFetch=window.fetch.bind(window);window.__fixtureRequests=[];
window.fetch=(input,init={})=>{const url=new URL(String(input),location.href);if(url.origin!==location.origin)throw Error('External requests are forbidden');window.__fixtureRequests.push({path:url.pathname,method:init.method||'GET',body:init.body?JSON.parse(init.body):null});return originalFetch(url,init)};
function Fixture(){const[language,setLanguage]=useState(params.get('lang')||'ja'),[other,setOther]=useState(false);
useEffect(()=>{document.documentElement.lang=language;document.querySelector('.inventory-calibration-panel')?.setAttribute('open','')},[language,other]);
return <main className="fixture-workbench" data-i18n-ignore><header><p>合成データのみ · Synthetic only</p><h1>販売状態・今回の基準</h1><nav aria-label="Fixture language">{['ja','zh-Hans','zh-Hant'].map(lang=><button key={lang} type="button" aria-pressed={language===lang} onClick={()=>setLanguage(lang)}>{lang}</button>)}</nav><nav aria-label="Fixture cases">{${JSON.stringify([...cases])}.map(value=><a key={value} href={'/?case='+value+'&lang='+language}>{value}</a>)}</nav><button type="button" onClick={()=>setOther(value=>!value)}>別の検証店舗／切换模拟门店</button><small>Case: {scenario} · Store: {other?'B':'A'}</small></header><WholeStoreAvailabilitySync storeId={'fixture-'+scenario+(other?'-other':'')} language={language} disabled={false} onApplied={()=>{}}/><p className="fixture-note">確認ボタンもローカルの合成記録だけを変更します。実際の商品・在庫は変更しません。</p></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false,
  format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = `${await readFile(resolve(root, 'app/globals.css'), 'utf8')}\n${await readFile(resolve(root, 'app/store/store-responsive.css'), 'utf8')}\n
.fixture-workbench{max-width:1160px;margin:24px auto;padding:0 16px}.fixture-workbench>header{display:grid;gap:10px;margin-bottom:20px}.fixture-workbench h1{font-size:22px;margin:0}.fixture-workbench header p,.fixture-workbench header small,.fixture-note{font-size:12px;color:var(--muted);margin:0}.fixture-workbench nav{display:flex;flex-wrap:wrap;gap:8px}.fixture-workbench nav button,.fixture-workbench nav a,.fixture-workbench header>button{padding:8px 12px;background:var(--panel);border:1px solid var(--line);border-radius:8px;font-size:13px;width:fit-content;max-width:100%;color:var(--green)}.fixture-workbench nav button[aria-pressed=true]{background:var(--green-soft);border-color:var(--green)}.fixture-note{margin-top:18px}`;
function json(response, body, status = 200) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); }
async function body(request) {
  let data = '';
  for await (const chunk of request) { data += chunk; if (data.length > 65536) throw Error('Synthetic request too large'); }
  return JSON.parse(data);
}
const server = createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
  try {
    const url = new URL(request.url, base), path = url.pathname;
    if (path === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(bundle.outputFiles[0].text); return; }
    if (path === '/fixture.css') { response.writeHead(200, { 'Content-Type': 'text/css' }); response.end(css); return; }
    if (path === '/api/store/inventory-history' && request.method === 'GET') {
      const state = stateFor(url.searchParams.get('storeId'));
      if (state.staleOnce) { state.staleOnce = false; state.report.details.previewRevision = randomUUID(); }
      json(response, { reports: [state.report] }); return;
    }
    if (path === '/api/store/display/kitchen/inventory' && request.method === 'POST') {
      const input = await body(request), state = stateFor(input.storeId), current = state.report;
      mutations.push(clone(input));
      if (input.action === 'full_sync') { const fresh = newRun(input.storeId, state.case, true); json(response, { runId: fresh.report.id, targetCount: targets.length, excluded: [] }); return; }
      if (input.runId !== current.id || input.previewRevision !== current.details.previewRevision) { json(response, { error: 'プレビューが変更されました。最新の内容を確認してください。' }, 409); return; }
      if (current.details.osApplied || Date.now() - Date.parse(current.details.previewAt) >= 600000) { json(response, { error: 'プレビューの有効期限（10分）が切れたか、適用済みです。再読み取りしてください。' }, 409); return; }
      if (input.action === 'set_full_sync_reference') {
        if (!current.details.comparison.referenceOptions.some(option => option.platform === input.referencePlatform && option.enabled)) { json(response, { error: '基準プラットフォームの全商品対応・販売状態を確認できません。再読み取りしてください。' }, 409); return; }
        current.details.referencePlatform = input.referencePlatform; current.details.previewRevision = randomUUID(); updateComparison(state);
        json(response, { ok: true, referencePlatform: current.details.referencePlatform, previewRevision: current.details.previewRevision });
        if (state.case === 'stale') state.staleOnce = true;
        return;
      }
      if (input.action === 'confirm_full_sync') {
        if (input.referencePlatform !== current.details.referencePlatform || !current.details.comparison.ready) { json(response, { error: '基準またはプレビューが変更されました。最新の内容を確認してください。' }, 409); return; }
        if (current.details.referenceConflicts.length && input.acknowledgeInventoryConflicts !== true) { json(response, { error: '在庫保護・プラットフォーム別設定と競合しています。解除する対象を確認してください。' }, 409); return; }
        current.details.osApplied = true; current.status = 'processing';
        current.platforms = Object.entries(current.details.comparison.counts).filter(([platform, count]) => platform !== current.details.referencePlatform && count > 0).map(([platform]) => ({ platform, total: 1, succeeded: 0, failed: 0, timedOut: 0 }));
        json(response, { ok: true }); setTimeout(() => { current.status = 'succeeded'; current.platforms.forEach(platform => platform.succeeded = platform.total); }, 250); return;
      }
      json(response, { error: 'Synthetic action is not allowed' }, 403); return;
    }
    if (path === '/api/store/menu-sync-runs/retry' && request.method === 'POST') {
      const input = await body(request), state = stateFor(input.storeId), command = state.commands.find(command => command.id === input.commandId);
      if (input.action !== 'retry_read' || !command) { json(response, { error: 'Synthetic read identity mismatch' }, 409); return; }
      command.status = 'succeeded'; command.error = ''; state.report.reads = state.report.reads.map(read => read.id === command.id ? { ...read, status: 'succeeded', error: '' } : read);
      state.report.details.previewRevision = randomUUID(); updateComparison(state); json(response, { ok: true }); return;
    }
    if (path === '/fixture-state' && request.method === 'GET') { json(response, { mutations }); return; }
    if (path.startsWith('/api/') || request.method !== 'GET') { json(response, { error: 'Only local synthetic requests allowed' }, 403); return; }
    if (path !== '/' && path !== '/store/menu' && path !== '/store/menu/inventory-history') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local inventory reference verification</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  } catch { json(response, { error: 'Synthetic request rejected' }, 400); }
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
console.log(`Synthetic inventory reference only: ${base}/?case=conflict&lang=zh-Hans`);
await new Promise(() => {});
