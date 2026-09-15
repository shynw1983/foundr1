const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function route(file, modules) {
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, Response, URL, Buffer, require: (name) => modules[name.split('/').at(-1)] ?? {} };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
const owner = { id: 'employee', name: 'Test', role: 'owner' };

test('receiving rejects empty deliveries and forbidden access before any update', async () => {
  for (const scenario of [{ session: null, allowed: true, hasItems: true, status: 403 }, { session: owner, allowed: false, hasItems: true, status: 403 }, { session: owner, allowed: true, hasItems: false, status: 409 }, { session: owner, allowed: true, hasItems: true, status: 200 }]) {
    let writes = 0;
    const api = route('app/api/store/procurement-receiving/route.ts', {
      'api-auth': { requireOsSession: async () => scenario.session, canAccessStore: async () => scenario.allowed },
      db: { sql: async (parts) => { if (/^\s*update/.test(parts.join(''))) { writes++; return []; } return [{ storeId: 'store', hasItems: scenario.hasItems }]; } }
    });
    const response = await api.PATCH({ json: async () => ({ type: 'batch', batchId: 'batch' }) });
    assert.equal(response.status, scenario.status);
    assert.equal(writes, scenario.status === 200 ? 2 : 0);
  }
});

test('POS rejects explicit information cards from online and cached offline checkout before writing an order', async () => {
  for (const offlineQueued of [false, true]) {
    let writes = 0;
    const api = route('app/api/store/pos/route.ts', {
      'api-auth': { requireOsSession: async () => owner },
      'store-order-access': { getStoreOrderAccess: async () => ({ stores: [{ id: 'store' }] }), getScopedStoreFilter: () => 'store' },
      'pos-catalog-policy': require('../../lib/pos-catalog-policy.ts'),
      'pos-printer': { normalizePosPrinterSettings: () => ({}) },
      db: { sql: async (parts) => {
        const sql = parts.join('');
        if (/\b(insert|update|delete)\b/i.test(sql)) { writes++; throw new Error('Unexpected write'); }
        if (sql.includes('from menu_catalog_items')) return [{ id: 'info', name: '【※こちら商品ではありません】ブランド紹介' }];
        return [];
      } }
    });
    const response = await api.POST({ json: async () => ({ storeId: 'store', orderType: 'takeout', paymentMethod: 'cash', offlineQueued, items: [{ menuCatalogItemId: 'info', quantity: 1 }] }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /案内専用/);
    assert.equal(writes, 0);
  }
});

test('inventory history returns the master display names alongside an untouched historical label and denies out-of-scope stores', async () => {
  for (const allowed of [true, false]) {
    let reads = 0;
    const api = route('app/api/store/inventory-history/route.ts', {
      'api-auth': { requireOsSession: async () => owner },
      'store-order-access': { getStoreOrderAccess: async () => ({ stores: [{ id: 'store' }] }), getScopedStoreFilter: () => allowed ? 'store' : '__forbidden__' },
      db: { sql: async () => { reads++; return [{ id: 'history', runType: 'availability_change', action: 'available', itemLabel: '历史中文', itemName: '牛肉', itemDisplayNames: { zh: '牛肉中文' }, inventoryKey: 'item:item-id', source: 'store', details: {}, createdAt: new Date().toISOString(), actorName: 'Test' }]; } }
    });
    const response = await api.GET(new Request('http://localhost/api/store/inventory-history?storeId=store'));
    assert.equal(response.status, allowed ? 200 : 403);
    assert.equal(reads, allowed ? 1 : 0);
    if (allowed) {
      const report = (await response.json()).reports[0];
      assert.equal(report.itemLabel, '历史中文');
      assert.equal(report.itemName, '牛肉');
      assert.equal(report.itemDisplayNames.zh, '牛肉中文');
    }
  }
});
