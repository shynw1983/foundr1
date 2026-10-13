// Exercise the unchanged shared route used by both single and bulk actions.
// Persistence/platform services are isolated; no live database or commands.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ authenticated = true, scoped = true, found = true } = {}) {
  const calls = [];
  const targets = [{ kind: 'option', targetId: 'option-a', brandId: 'brand-a' }, { kind: 'item', targetId: 'linked-item', brandId: 'brand-a' }];
  const modules = {
    'api-auth': { requireOsSession: async () => authenticated ? { id: 'employee-a', role: 'staff' } : null },
    'store-order-access': {
      getStoreOrderAccess: async () => ({ stores: [{ id: 'store-a' }] }),
      getScopedStoreFilter: (_access, storeId) => scoped && storeId === 'store-a' ? storeId : '__forbidden__'
    },
    db: { sql: () => { throw Error('Unexpected database access'); } },
    'inventory-manual-sync': {
      setInventorySyncReference: async (...args) => {
        calls.push({ action: 'set-reference', args });
        return { referencePlatform: args[2], previewRevision: 'new-preview' };
      },
      confirmUberAvailabilitySync: async (...args) => {
        calls.push({ action: 'confirm', args });
        return { updatedCount: 1, missingCount: 0 };
      }
    },
    'inventory-availability': {
      loadInventoryAvailabilityTargets: async (...args) => {
        calls.push({ action: 'resolve', args });
        return { inventoryKey: 'shared-a', ingredientLabel: '野菜', targets: found ? targets : [] };
      },
      applyInventoryAvailability: async input => {
        calls.push({ action: 'apply', input });
        return { commands: [{ id: 'command-a' }], syncRun: { id: 'run-a' }, targetStates: targets.map(target => ({ ...target, isAvailable: input.isAvailable })) };
      }
    }
  };
  const context = { exports: {}, Response, URL, require: name => modules[name.split('/').at(-1)] ?? {} };
  const source = fs.readFileSync('app/api/store/display/kitchen/inventory/route.ts', 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const post = patch => context.exports.POST(new Request('http://test/api/store/display/kitchen/inventory', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      storeId: 'store-a', brandId: 'brand-a', targetId: 'option-a', targetKind: 'option',
      ingredientLabel: '野菜', feedbackLabel: '蔬菜', source: 'sales_status', action: 'apply',
      isAvailable: false, stockStatus: 'unavailable', resetPlatformOverrides: true,
      platforms: ['uber_eats', 'rocket_now', 'demae_can'], ...patch
    })
  }));
  return { post, calls };
}

test('run reference selection passes store scope and exact preview revision without an inventory write', async () => {
  const { post, calls } = harness();
  const response = await post({ action: 'set_full_sync_reference', runId: 'run-a', referencePlatform: 'rocket_now', previewRevision: 'original-preview' });
  assert.equal(response.status, 200);
  assert.deepEqual([...calls[0].args], ['store-a', 'run-a', 'rocket_now', 'original-preview']);
  assert.equal(calls.length, 1);
  const body = await response.json();
  assert.equal(body.referencePlatform, 'rocket_now');
  assert.equal(body.previewRevision, 'new-preview');
});

test('confirmation binds reference and preview; conflict acknowledgement requires boolean true', async () => {
  const { post, calls } = harness();
  await post({ action: 'confirm_full_sync', runId: 'run-a', referencePlatform: 'demae_can', previewRevision: 'preview-a', acknowledgeInventoryConflicts: true });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), ['store-a', 'run-a', { referencePlatform: 'demae_can', previewRevision: 'preview-a', acknowledgeInventoryConflicts: true }]);
  await post({ action: 'confirm_full_sync', runId: 'run-a', referencePlatform: 'uber_eats', previewRevision: 'preview-b', acknowledgeInventoryConflicts: 'true' });
  assert.equal(calls[1].args[2].acknowledgeInventoryConflicts, false);
});

test('old confirmation clients do not inject a non-Uber reference', async () => {
  const { post, calls } = harness();
  assert.equal((await post({ action: 'confirm_full_sync', runId: 'run-a' })).status, 200);
  assert.equal(calls[0].args[2], undefined);
});

for (const [name, config, patch, expected] of [
  ['signed out', { authenticated: false }, { referencePlatform: 'rocket_now', previewRevision: 'preview-a' }, 401],
  ['other store', { scoped: false }, { referencePlatform: 'rocket_now', previewRevision: 'preview-a' }, 400],
  ['unknown reference', {}, { referencePlatform: 'foundr1', previewRevision: 'preview-a' }, 409],
  ['missing revision', {}, { referencePlatform: 'rocket_now' }, 409],
  ['missing reference', {}, { previewRevision: 'preview-a' }, 409]
]) {
  test(`reference endpoint rejects ${name} before service access`, async () => {
    const { post, calls } = harness(config);
    assert.equal((await post({ action: 'set_full_sync_reference', runId: 'run-a', ...patch })).status, expected);
    assert.equal(calls.length, 0);
  });
}

for (const available of [false, true]) {
  test(`inventory route preserves explicit target and linked output for ${available ? 'restore' : 'shortage'}`, async () => {
    const { post, calls } = harness();
    const response = await post({ isAvailable: available, stockStatus: available ? 'available' : 'unavailable' });
    assert.equal(response.status, 200);
    assert.deepEqual([...calls[0].args], ['store-a', 'brand-a', '野菜', 'option', 'option-a']);
    const input = calls[1].input;
    assert.equal(input.storeId, 'store-a'); assert.equal(input.updatedBy, 'employee-a');
    assert.equal(input.isAvailable, available); assert.equal(input.persistOverall, true); assert.equal(input.resetPlatformOverrides, true);
    assert.deepEqual([...input.platforms], ['uber_eats', 'rocket_now', 'demae_can']);
    const body = await response.json();
    assert.equal(body.commandId, 'command-a'); assert.equal(body.syncRun.id, 'run-a');
    assert.deepEqual(body.targetStates.map(target => [target.kind, target.targetId, target.isAvailable]), [['option', 'option-a', available], ['item', 'linked-item', available]]);
  });
}
for (const [label, config, patch, expected] of [
  ['signed out', { authenticated: false }, {}, 401],
  ['outside store scope', { scoped: false }, {}, 400],
  ['missing stable target ID', {}, { targetId: '' }, 409],
  ['stale target ID', { found: false }, { targetId: 'deleted' }, 409]
]) {
  test(`inventory route rejects ${label} without persisting`, async () => {
    const { post, calls } = harness(config);
    assert.equal((await post(patch)).status, expected);
    assert.equal(calls.some(call => call.action === 'apply'), false);
  });
}
