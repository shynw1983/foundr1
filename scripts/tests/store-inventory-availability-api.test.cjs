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
