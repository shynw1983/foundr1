const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules = {}) {
  const context = { exports: {}, Response, URL, Buffer, require: n => modules[n.split('/').at(-1)] ?? {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const pagination = load('lib/store-order-pagination.ts');
const owner = { role: 'owner' };
const cursor = { id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-09-16 09:15:12.123456+09' };
test('cursor retains microseconds and rejects malformed input', () => {
  assert.equal(pagination.parseStoreOrderCursor(pagination.encodeStoreOrderCursor(cursor)).createdAt, cursor.createdAt);
  for (const value of ['bad', 'x'.repeat(513), pagination.encodeStoreOrderCursor({ ...cursor, id: 'invalid' }), pagination.encodeStoreOrderCursor({ ...cursor, createdAt: 'invalid' })]) assert.throws(() => pagination.parseStoreOrderCursor(value));
});
test('order reads bound every page, use stable cursor order, retain active/checkout and history filters', async () => {
  for (const size of [1, 50, 100, 10000]) {
    const limit = Math.min(size, 100);
    const api = load('app/api/store/orders/route.ts', {
      'api-auth': { requireOsSession: async () => owner },
      'store-order-access': { getStoreOrderAccess: async () => ({ stores: [{ id: 'store' }], storeIds: ['store'], allStores: false }), getScopedStoreFilter: () => 'store' },
      'store-order-pagination': pagination,
      db: { sql: async (parts, ...values) => {
        const query = parts.join('?');
        assert.equal(values.at(-1), limit + 1);
        assert.match(query, /created_at desc, store_customer_orders.id desc/);
        assert.match(query, /checkoutStatus/);
        assert.match(query, /'new', 'preparing', 'ready'/);
        assert.ok(values.includes(cursor.createdAt));
        assert.ok(values.includes('history')); assert.ok(values.includes('completed')); assert.ok(values.includes('test'));
        return Array.from({ length: limit + 1 }, (_, i) => ({ id: `order-${i}`, pageCursor: cursor, status: 'completed' }));
      } }
    });
    const response = await api.GET(new Request(`http://test/api/store/orders?view=history&status=completed&q=TEST&pageSize=${size}&cursor=${pagination.encodeStoreOrderCursor(cursor)}`));
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.orders.length, limit);
    assert.equal(body.orders[0].pageCursor, undefined);
    assert.equal(body.nextCursor, pagination.encodeStoreOrderCursor(cursor));
  }
});
test('orders deny unauthorized scope and invalid cursors before database read', async () => {
  for (const [session, scope, query, status] of [[null, 'store', '', 401], [owner, '__forbidden__', '', 403], [owner, 'store', '?cursor=broken', 400]]) {
    const api = load('app/api/store/orders/route.ts', {
      'api-auth': { requireOsSession: async () => session }, 'store-order-pagination': pagination,
      'store-order-access': { getStoreOrderAccess: async () => ({ stores: [] }), getScopedStoreFilter: () => scope },
      db: { sql: () => { throw Error('Unauthorized database read'); } }
    });
    assert.equal((await api.GET(new Request(`http://test/api/store/orders${query}`))).status, status);
  }
});
test('single-item progress projects blobs and preserves all commands in the four runs', async () => {
  const api = load('app/api/store/menu-sync-runs/route.ts', {
    'api-auth': { requireOsSession: async () => owner },
    'store-order-access': { getStoreOrderAccess: async () => ({ stores: [{ id: 'store' }] }), getScopedStoreFilter: () => 'store' },
    db: { sql: async parts => {
      const query = parts.join('?'); assert.match(query, /limit 4/); assert.doesNotMatch(query, /limit 60/);
      assert.match(query, /result->'progress'->'phase'/); assert.doesNotMatch(query, /\n\s*(payload|result),/);
      return ['succeeded', 'processing', 'failed'].map((status, i) => ({ id: `command-${i}`, platform: ['uber_eats', 'rocket_now', 'demae_can'][i], status,
        payload: { syncRunId: 'run', feedbackLabel: 'Test', isAvailable: true, syncSource: 'siri' },
        result: { progress: { phase: i === 1 ? 'retrying' : null, attempt: 2, maxAttempts: 3 } }, lastError: i === 2 ? 'timeout' : '', attempts: 2, createdAt: '2026-09-16', updatedAt: '2026-09-16' }));
    } }
  });
  const body = await (await api.GET(new Request('http://test/api/store/menu-sync-runs?storeId=store'))).json();
  assert.deepEqual(body.runs[0].platforms.map(p => p.status), ['succeeded', 'succeeded', 'retrying', 'timed_out']);
  assert.equal(body.runs[0].source, 'siri'); assert.equal(body.runs[0].platforms[2].attempt, 2);
});
test('menu progress is scoped, read-only and excludes catalog and full observed payloads', async () => {
  let queries = 0;
  const helper = load('lib/menu-progress.ts', { db: { sql: async (parts, ...values) => {
    queries++; const query = parts.join('?');
    assert.doesNotMatch(query, /\b(insert|update|delete)\b/i);
    assert.doesNotMatch(query, /from menu_catalog_items|current_value|projected_value|observed_payload as/);
    if (!query.includes('menu_availability_links')) { assert.ok(values.includes('brand')); assert.ok(values.includes('store')); }
    else assert.equal(values[0], false);
    return [];
  } } });
  const result = await helper.readMenuProgress('brand', 'store'); assert.equal(queries, 6); assert.equal(result.items, undefined);
  for (const [session, permission, storeAllowed, expected] of [[null, true, true, 403], [owner, false, true, 403], [owner, true, false, 403], [owner, true, true, 200]]) {
    const api = load('app/api/menus/progress/route.ts', { 'api-auth': { requireOsSession: async () => session, canAccessStore: async () => storeAllowed }, 'role-permissions': { roleHasPermission: async () => permission }, 'menu-progress': { readMenuProgress: async (brand, store) => { assert.equal(brand, 'brand'); assert.equal(store, 'store'); return result; } } });
    assert.equal((await api.GET(new Request('http://test/api/menus/progress?brandId=brand&storeId=store'))).status, expected);
  }
});
