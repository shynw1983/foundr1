const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

function compile(path, modules = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, Response, Request, URL, console: { warn() {} }, require: name => modules[name.split('/').at(-1)] ?? {} });
  return exports;
}

function harness({ authenticated = true, scoped = true, hintFailure = false, applied = false } = {}) {
  const { buildInventoryComparison } = compile('lib/inventory-comparison.ts');
  const { inventoryPreviewExpired } = compile('lib/inventory-preview.ts');
  const target = { kind: 'option', targetId: 'option-a', label: '经典汤底', isAvailable: true, wasAvailable: false };
  const calls = [];
  const common = {
    id: 'run-a', runType: 'full_sync', action: 'full_sync', itemLabel: 'Sync', source: 'store', createdAt: new Date().toISOString(),
    actorName: 'Operator', details: {
      authority: 'uber_eats', referencePlatform: 'rocket_now', phase: 'awaiting_confirmation', previewRevision: 'preview-a',
      comparisonVersion: 1, comparisonPlatforms: ['rocket_now', 'demae_can'], previewAt: new Date().toISOString(),
      preview: [target], osApplied: applied
    }, commandType: 'audit_inventory', commandStatus: 'succeeded', lastError: '', attempts: 1,
    commandUpdatedAt: new Date().toISOString()
  };
  const rows = [false, true].map((available, index) => ({
    ...common, commandId: `command-${index}`, platform: index ? 'demae_can' : 'rocket_now',
    commandPayload: { comparisonAudit: true, targets: [target] },
    commandResult: { items: [{ kind: target.kind, targetId: target.targetId, found: true, isAvailable: available, status: available ? 'available' : 'sold_out' }] }
  }));
  const { GET } = compile('app/api/store/inventory-history/route.ts', {
    'api-auth': { requireOsSession: async () => authenticated ? { id: 'operator' } : null },
    'store-order-access': {
      getStoreOrderAccess: async () => ({ stores: [{ id: 'store-a' }] }),
      getScopedStoreFilter: (_access, storeId) => scoped && storeId === 'store-a' ? storeId : '__forbidden__'
    },
    db: { sql: () => { calls.push({ action: 'read' }); return rows; } },
    'inventory-preview': { inventoryPreviewExpired },
    'inventory-comparison': { buildInventoryComparison },
    'inventory-write-recovery-hints': { loadInventoryWriteRecoveryHints: async (storeId, targets) => {
      calls.push({ action: 'hints', storeId, targets: JSON.parse(JSON.stringify(targets)) });
      if (hintFailure) throw new Error('History unavailable');
      return [{ ...target, isAvailable: false, successfulPlatforms: ['rocket_now', 'demae_can'] }];
    } }
  });
  return { calls, get: scope => GET(new Request(`http://test/api/store/inventory-history?storeId=store-a&scope=${scope ?? 'latest_full_sync'}`)) };
}

test('current native read filters older successful-platform hints without changing the chosen reference', async () => {
  const h = harness();
  const response = await h.get();
  assert.equal(response.status, 200);
  const { reports: [report] } = await response.json();
  assert.equal(report.details.referencePlatform, 'rocket_now');
  assert.equal(report.details.previewRevision, 'preview-a');
  assert.deepEqual(report.details.previousWriteConflicts[0].successfulPlatforms, ['rocket_now']);
  assert.equal(report.details.previousWriteConflicts[0].isAvailable, false);
  assert.equal(report.details.snapshot, undefined);
  assert.equal(h.calls.find(call => call.action === 'hints').storeId, 'store-a');
});

test('hint read failure is explicitly unavailable, not proof that previous writes all succeeded', async () => {
  const h = harness({ hintFailure: true });
  const response = await h.get();
  const { reports: [report] } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(report.status, 'awaiting_confirmation');
  assert.equal(report.details.comparison.ready, true);
  assert.equal(report.details.previousWriteConflictsUnavailable, true);
  assert.equal(report.details.previousWriteConflicts, undefined);
});

test('normal history and already-applied records do not scan recovery hints', async () => {
  for (const [config, scope] of [[{}, ''], [{ applied: true }, 'latest_full_sync']]) {
    const h = harness(config);
    assert.equal((await h.get(scope)).status, 200);
    assert.equal(h.calls.some(call => call.action === 'hints'), false);
  }
});

test('signed-out and foreign-store history requests never access recovery data', async () => {
  for (const [config, expected] of [[{ authenticated: false }, 401], [{ scoped: false }, 403]]) {
    const h = harness(config);
    assert.equal((await h.get()).status, expected);
    assert.equal(h.calls.length, 0);
  }
});
