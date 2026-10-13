// Actual React hooks and Store component with deferred synthetic fetch only.
// No browser, production API, database or merchant page is accessed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');
const deps = process.env.INVENTORY_REFERENCE_UI_TEST_DEPS || resolve(process.cwd(), '../ui-test-deps/package.json');
const testRequire = createRequire(deps);
const React = testRequire('react');
const Renderer = testRequire('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const copy = value => JSON.parse(JSON.stringify(value));
function compile(file, modules = {}, globals = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017
  } }).outputText, { exports, require: name => modules[name] || require(name), Error, ...globals });
  return exports;
}
const { buildInventoryComparison } = compile('lib/inventory-comparison.ts');
const targets = [{ kind: 'option', targetId: 'exact-id', label: '同名の選択肢', isAvailable: false, wasAvailable: false }];
function report(referencePlatform = 'uber_eats', revision = 'preview-a', patch = {}) {
  const details = { authority: 'uber_eats', referencePlatform, previewRevision: revision, osApplied: false,
    previewAt: new Date().toISOString(), comparisonVersion: 1, comparisonPlatforms: ['rocket_now', 'demae_can'],
    preview: copy(targets), referenceConflicts: [], ...patch };
  details.comparison = copy(buildInventoryComparison(details, ['rocket_now', 'demae_can'].map(platform => ({
    platform, status: patch.failedPlatform === platform ? 'failed' : 'succeeded', updatedAt: details.previewAt,
    payload: { comparisonAudit: true, targets }, result: { items: [{ ...targets[0], found: true, isAvailable: true, status: 'available' }] }
  }))));
  return { id: patch.runId || 'run-a', status: 'awaiting_confirmation', details, reads: [
    { id: 'read-uber', platform: 'uber_eats', status: 'succeeded', count: 1 },
    { id: 'read-rocket', platform: 'rocket_now', status: patch.failedPlatform === 'rocket_now' ? 'failed' : 'succeeded', count: 1 },
    { id: 'read-demae', platform: 'demae_can', status: 'succeeded', count: 1 }
  ], platforms: [] };
}
async function harness(language = 'zh-Hans') {
  const requests = [], intervals = new Map(), timeouts = new Map(), callbacks = [];
  let sequence = 0, renderer, props = { storeId: 'store-a', language, disabled: false, onApplied: () => callbacks.push('applied') };
  const globals = { Date, AbortController, window: { confirm: () => true },
    setInterval: (fn, ms) => { intervals.set(++sequence, { fn, ms }); return sequence; },
    clearInterval: id => intervals.delete(id),
    setTimeout: (fn, ms) => { timeouts.set(++sequence, { fn, ms }); return sequence; },
    clearTimeout: id => timeouts.delete(id),
    fetch: (url, options = {}) => new Promise((resolve, reject) => {
      const request={ url, options, body: options.body ? JSON.parse(options.body) : undefined, resolve, reject, settled: false };
      requests.push(request);
      options.signal?.addEventListener('abort',()=>{if(!request.settled&&!request.ignoreAbort){request.settled=true;reject(new Error('Synthetic request aborted'));}},{once:true});
    }) };
  const modules = { react: React, 'react/jsx-runtime': testRequire('react/jsx-runtime'),
    '../../../lib/inventory-preview': compile('lib/inventory-preview.ts'),
    './InventoryComparisonPreview': { InventoryComparisonPreview: () => React.createElement('div', null, 'Verified comparison') },
    './InventoryReadProgress': { InventoryReadProgress: () => React.createElement('div', null, 'Read progress') } };
  const { WholeStoreAvailabilitySync, inventorySyncErrorMessage } = compile('app/store/menu/WholeStoreAvailabilitySync.tsx', modules, globals);
  await Renderer.act(async () => { renderer = Renderer.create(React.createElement(WholeStoreAvailabilitySync, props)); });
  const h = { requests, callbacks, renderer, globals, inventorySyncErrorMessage,
    async reply(body, status = 200, index = requests.findIndex(r => !r.settled)) {
      const request = requests[index]; assert.ok(request && !request.settled, 'An unsettled synthetic request must exist'); request.settled = true;
      await Renderer.act(async () => request.resolve({ ok: status >= 200 && status < 300, status, json: async () => copy(body) }));
    },
    async fail(index = requests.findIndex(r => !r.settled)) { const request = requests[index]; request.settled = true;
      await Renderer.act(async () => request.reject(new TypeError('Synthetic connection lost'))); },
    async update(changes) { props = { ...props, ...changes }; await Renderer.act(async () => renderer.update(React.createElement(WholeStoreAvailabilitySync, props))); },
    all(type) { return renderer.root.findAll(node => node.type === type); },
    text() { return JSON.stringify(renderer.toJSON()); },
    selector() { return h.all('select')[0]; },
    confirm() { return h.all('button').find(node => /按.*同步/.test(node.children.join(''))); },
    refresh() { return h.all('button').find(node => node.children.join('').includes('重新获取进度')); },
    async select(platform) { await Renderer.act(async () => h.selector().props.onChange({ target: { value: platform } })); },
    async click(button) { assert.ok(button); assert.equal(Boolean(button.props.disabled), false, 'Only enabled UI actions may run'); await Renderer.act(async () => button.props.onClick()); },
    async tick() { await Renderer.act(async () => { for (const timer of [...intervals.values()]) if (timer.ms === 5000) timer.fn(); }); },
    async abortMutation() { await Renderer.act(async () => { for(const timer of [...timeouts.values()]) if(timer.ms===20000)timer.fn(); }); },
    async close() { await Renderer.act(async () => renderer.unmount()); assert.equal(intervals.size, 0); assert.equal(timeouts.size, 0); }
  };
  return h;
}
async function ready(h, value = report()) { await h.reply({ reports: [value] }); }
async function switchToRocket(h, value = report('rocket_now', 'preview-b')) {
  await h.select('rocket_now'); await h.reply({ ok: true, referencePlatform: 'rocket_now', previewRevision: 'preview-b' });
  await h.reply({ reports: [value] });
}
async function withHarness(fn, language) { const h = await harness(language); try { await fn(h); } finally { await h.close(); } }

test('initial read stays Uber-default and never sends a stock mutation', () => withHarness(async h => {
  await ready(h); assert.equal(h.selector().props.value, 'uber_eats'); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].body, undefined); assert.equal(h.confirm().props.disabled, false);
}));
test('source change sends exact store/run/reference/revision and no inventory command', () => withHarness(async h => {
  await ready(h); await h.select('rocket_now');
  assert.deepEqual(h.requests[1].body, { action: 'set_full_sync_reference', storeId: 'store-a', runId: 'run-a', referencePlatform: 'rocket_now', previewRevision: 'preview-a' });
  assert.equal(h.confirm().props.disabled, true);
}));
test('source acknowledgement does not enable confirmation before complete GET conflict receipt', () => withHarness(async h => {
  await ready(h); await h.select('rocket_now'); await h.reply({ referencePlatform: 'rocket_now', previewRevision: 'preview-b' });
  assert.equal(h.selector().props.value, 'rocket_now'); assert.equal(h.confirm().props.disabled, true);
  assert.ok(h.requests[2].url.includes('inventory-history'));
  await h.reply({ reports: [report('rocket_now', 'preview-b')] }); assert.equal(h.confirm().props.disabled, false);
}));
test('inventory/override conflicts require explicit acknowledgment bound to preview', () => withHarness(async h => {
  await ready(h); await switchToRocket(h, report('rocket_now', 'preview-b', { referenceConflicts: [
    { kind: 'option', targetId: 'exact-id', label: '同名', reason: 'inventory_block' },
    { kind: 'option', targetId: 'exact-id', label: '同名', reason: 'platform_override', platform: 'demae_can' }
  ] }));
  assert.equal(h.confirm().props.disabled, true); assert.ok(h.text().includes('库存保护')); assert.ok(h.text().includes('出前馆 · 单独设置'));
  await Renderer.act(async () => h.all('input')[0].props.onChange({ target: { checked: true } }));
  await h.click(h.confirm()); assert.deepEqual(h.requests.at(-1).body, { action: 'confirm_full_sync', runId: 'run-a', storeId: 'store-a', referencePlatform: 'rocket_now', previewRevision: 'preview-b', acknowledgeInventoryConflicts: true });
}));
test('same-token polling preserves conflict acknowledgment', () => withHarness(async h => {
  const conflicts = [{ kind: 'option', targetId: 'exact-id', label: '同名', reason: 'inventory_block' }];
  await ready(h); await switchToRocket(h, report('rocket_now', 'preview-b', { referenceConflicts: conflicts }));
  await Renderer.act(async () => h.all('input')[0].props.onChange({ target: { checked: true } }));
  await h.tick(); await h.reply({ reports: [report('rocket_now', 'preview-b', { referenceConflicts: conflicts })] });
  assert.equal(h.all('input')[0].props.checked, true);
}));
test('new preview token clears conflict acknowledgment', () => withHarness(async h => {
  const conflicts = [{ kind: 'option', targetId: 'exact-id', label: '同名', reason: 'inventory_block' }];
  await ready(h); await switchToRocket(h, report('rocket_now', 'preview-b', { referenceConflicts: conflicts }));
  await Renderer.act(async () => h.all('input')[0].props.onChange({ target: { checked: true } }));
  await h.tick(); await h.reply({ reports: [report('rocket_now', 'preview-c', { referenceConflicts: conflicts })] });
  assert.equal(h.all('input')[0].props.checked, false); assert.equal(h.confirm().props.disabled, true);
}));
test('expected-token mismatch stays disabled and explicit refresh loads latest complete preview', () => withHarness(async h => {
  await ready(h); await h.select('rocket_now'); await h.reply({ referencePlatform: 'rocket_now', previewRevision: 'preview-b' });
  await h.reply({ reports: [report('rocket_now', 'preview-c')] });
  assert.equal(h.confirm().props.disabled, true); assert.ok(h.text().includes('预览已更新')); assert.ok(h.refresh());
  await h.click(h.refresh()); await h.reply({ reports: [report('rocket_now', 'preview-c')] });
  assert.equal(h.confirm().props.disabled, false);
  assert.ok(!h.text().includes('本次依据或预览已更新'), 'Explicit successful refresh must remove the obsolete stale-preview alert');
}));
test('older in-flight poll cannot roll back a newer source selection', () => withHarness(async h => {
  await ready(h); await h.tick(); const staleIndex = h.requests.length - 1; h.requests[staleIndex].ignoreAbort=true;
  await h.select('rocket_now'); const changeIndex = h.requests.length - 1;
  await h.reply({ referencePlatform: 'rocket_now', previewRevision: 'preview-b' }, 200, changeIndex);
  await h.reply({ reports: [report()] }, 200, staleIndex);
  assert.equal(h.selector().props.value, 'rocket_now'); assert.equal(h.confirm().props.disabled, true);
  await h.reply({ reports: [report('rocket_now', 'preview-b')] }); assert.equal(h.confirm().props.disabled, false);
}));
test('new run starts with Uber again and ignores previous-run polls', () => withHarness(async h => {
  await ready(h); await switchToRocket(h); const start = h.all('button').find(node => node.children.join('') === '读取状态');
  await h.click(start); await h.reply({ runId: 'run-new', targetCount: 1, excluded: [] });
  await h.reply({ reports: [report('rocket_now', 'preview-b')] });
  assert.ok(!h.selector() || h.selector().props.value === 'uber_eats');
  await h.click(h.refresh()); await h.reply({ reports: [report('uber_eats', 'preview-new', { runId: 'run-new' })] });
  assert.equal(h.selector().props.value, 'uber_eats');
}));
test('store change invalidates preceding source mutation before response arrives', () => withHarness(async h => {
  await ready(h); await h.select('rocket_now'); const previous = h.requests.length - 1; h.requests[previous].ignoreAbort=true;
  await h.update({ storeId: 'store-b' });
  await h.reply({ referencePlatform: 'rocket_now', previewRevision: 'preview-b' }, 200, previous);
  await h.reply({ reports: [report('uber_eats', 'other', { runId: 'run-other' })] });
  assert.equal(h.selector().props.value, 'uber_eats'); assert.equal(h.confirm().props.disabled, false);
}));
test('unknown source-change outcome waits for fresh report and never automatically resends', () => withHarness(async h => {
  await ready(h); await h.select('rocket_now'); await h.fail();
  assert.equal(h.confirm().props.disabled, true); assert.ok(h.text().includes('无法确认操作结果'));
  await h.reply({ reports: [report('rocket_now', 'preview-b')] });
  assert.equal(h.selector().props.value, 'rocket_now'); assert.equal(h.requests.filter(r => r.body?.action === 'set_full_sync_reference').length, 1);
}));
test('failed platform reads cannot be selected as reference or confirmed', () => withHarness(async h => {
  await ready(h, report('uber_eats', 'preview-a', { failedPlatform: 'rocket_now' }));
  assert.equal(h.confirm().props.disabled, true);
  assert.equal(h.all('option').find(node => node.props.value === 'rocket_now').props.disabled, true);
  const eligibility = h.all('p').find(node => node.props.className === 'inventory-reference-unavailable').children.join('');
  assert.ok(eligibility.includes('完整状态对照尚未确认'));
  assert.ok(!eligibility.includes('Uber：读取失败'), 'A global comparison guard must not report a successful Uber read as failed');
  assert.ok(!eligibility.includes('出前馆：读取失败'), 'A global comparison guard must not report a successful Demae read as failed');
  await h.select('rocket_now'); assert.equal(h.requests.length, 1);
}));
test('pending comparisons cannot confirm or select a source', () => withHarness(async h => {
  const pending = report(); pending.details.comparison.pending = true; pending.details.comparison.ready = false;
  await ready(h, pending); assert.equal(h.selector().props.disabled, true); assert.equal(h.confirm().props.disabled, true);
}));
test('expired preview does not unlock when alternative source is selected', () => withHarness(async h => {
  await ready(h, report('uber_eats', 'preview-a', { previewAt: new Date(Date.now() - 660000).toISOString() }));
  assert.equal(h.confirm().props.disabled, true); assert.equal(h.selector().props.disabled, true);
  await h.select('rocket_now'); assert.equal(h.requests.length, 1);
}));
test('failed progress read preserves last verified report but disables confirmation', () => withHarness(async h => {
  await ready(h); await h.tick(); await h.fail(); assert.equal(h.confirm().props.disabled, true); assert.equal(h.selector().props.value, 'uber_eats');
  await h.click(h.refresh()); await h.reply({ reports: [report()] }); assert.equal(h.confirm().props.disabled, false);
}));
test('missing preview revision never sends old client confirmation', () => withHarness(async h => {
  const old = report(); delete old.details.previewRevision; await ready(h, old);
  assert.equal(h.confirm().props.disabled, true); assert.equal(h.selector().props.disabled, true);
}));
test('advisory partial-write hints do not silently change source or execute stock writes', () => withHarness(async h => {
  await ready(h, report('uber_eats', 'preview-a', { previousWriteConflicts: [{ ...targets[0], isAvailable: true, successfulPlatforms: ['rocket_now'] }] }));
  assert.ok(h.text().includes('上次修改仅在部分平台成功')); assert.equal(h.selector().props.value, 'uber_eats'); assert.equal(h.requests.length, 1);
}));
test('unknown confirmation response never invents applied state or automatically retries write', () => withHarness(async h => {
  await ready(h); await h.click(h.confirm()); await h.fail();
  assert.equal(h.confirm().props.disabled, true); assert.deepEqual(h.callbacks, []);
  await h.reply({ reports: [report()] }); assert.equal(h.requests.filter(r => r.body?.action === 'confirm_full_sync').length, 1);
}));
test('all user-facing guard failures and permissions are translated without internal error codes', () => withHarness(async h => {
  for (const language of ['ja', 'zh-Hans', 'zh-Hant']) {
    for (const message of ['Unauthorized', '権限がありません。', 'プレビューが変更されました。最新の内容を確認してください。', 'synthetic_internal_error']) {
      const translated = h.inventorySyncErrorMessage(new Error(message), language);
      assert.ok(translated && !translated.includes('synthetic_internal_error') && !translated.includes('Unauthorized'));
      if (language === 'zh-Hans') assert.ok(!translated.includes('してください'));
    }
  }
}));
test('hung source mutation times out, releases busy and requires fresh GET without write replay',()=>withHarness(async h=>{
  await ready(h);await h.select('rocket_now');await h.abortMutation();
  assert.equal(h.confirm().props.disabled,true);assert.equal(h.requests.filter(r=>r.body?.action==='set_full_sync_reference').length,1);
  await h.reply({reports:[report('rocket_now','preview-b')]});
  assert.equal(h.selector().props.disabled,false);assert.equal(h.confirm().props.disabled,false);
}));
test('progress authentication failure supplies login instructions and disables stale confirmation',()=>withHarness(async h=>{
  await ready(h);await h.tick();await h.reply({error:'Unauthorized'},401);
  assert.ok(h.text().includes('请重新登录'));assert.equal(h.confirm().props.disabled,true);
}));
