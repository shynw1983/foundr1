// Isolated route and service-worker execution. No database or push provider access.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');

test('watchdog authentication fails closed and does not depend on an online Bridge', async () => {
  let scans = 0;
  const exports = {};
  const env = {};
  const source = ts.transpileModule(readFileSync('app/api/cron/inventory-sync-attention/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  runInNewContext(source, { exports, Response, process: { env }, require: name => {
    assert.equal(name, '../../../../lib/inventory-sync-notifications');
    return { notifyInventorySyncAttention: async () => { scans++; return { scanned: 3, delivered: 1 }; } };
  } });
  const invoke = token => exports.GET(new Request('https://test.invalid/api/cron/inventory-sync-attention', {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  }));
  assert.equal((await invoke('undefined')).status, 401);
  env.CRON_SECRET = 'test-monitor-secret';
  assert.equal((await invoke()).status, 401);
  assert.equal((await invoke('wrong')).status, 401);
  assert.equal(scans, 0);
  const response = await invoke(env.CRON_SECRET);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { scanned: 3, delivered: 1 });
  assert.equal(scans, 1);
});

test('service-worker inventory reminders replace the same intent without another audible alert', async () => {
  const handlers = {};
  const shown = [];
  const self = {
    addEventListener: (type, callback) => { handlers[type] = callback; },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } }
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, Date, URL, console });
  const push = async payload => {
    let work;
    handlers.push({ data: { json: () => payload }, waitUntil: promise => { work = promise; } });
    await work;
  };
  const payload = { type: 'inventory_sync_attention', deliveryKey: 'inventory-sync:command-a',
    title: 'Synchronization unconfirmed', body: 'Rocket Now', href: '/store/menu?syncAttention=1&storeId=store-a' };
  await push({ ...payload, sentAt: '2026-10-18T00:00:00Z' });
  await push({ ...payload, sentAt: '2026-10-18T00:01:00Z' });
  assert.equal(shown[0].options.tag, shown[1].options.tag);
  assert.equal(shown[1].options.renotify, false);
  assert.equal(shown[1].options.data.href, payload.href);
  await push({ ...payload, deliveryKey: 'inventory-sync:command-b' });
  assert.notEqual(shown[2].options.tag, shown[1].options.tag);
  assert.equal(shown[2].options.silent, false);
  await push({ type: 'other_notification', title: 'Order', sentAt: '2026-10-18T00:02:00Z' });
  assert.equal(shown[3].options.renotify, true);
  await push({ ...payload, priority: 'normal', deliveryKey: 'inventory-sync:resumption' });
  assert.equal(shown[4].options.silent, true);
});

test('a failed inventory ACK is saved and returned before a notification outage is handled', async () => {
  const exports = {}, callbacks = [], updates = [];
  let authorized = true, notificationCalls = 0;
  const code = ts.transpileModule(readFileSync('app/api/local-bridge/uber-eats/commands/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const sql = async parts => {
    const query = parts.join('?');
    if (query.includes('select command_type as')) return [{ commandType: 'set_inventory_availability',
      platform: 'rocket_now', payload: {}, attempts: 1, claimedAt: new Date().toISOString() }];
    if (query.includes('update local_bridge_commands')) {
      updates.push(query);
      return [{ id: 'command-a', commandType: 'set_inventory_availability', platform: 'rocket_now', status: 'failed' }];
    }
    throw new Error(`Unexpected database operation: ${query.slice(0, 70)}`);
  };
  runInNewContext(code, { exports, Response, Request, URL, console, require: name => {
    if (name === 'next/server') return { after: callback => callbacks.push(callback) };
    if (name.endsWith('/db')) return { sql };
    if (name.endsWith('/local-bridge-auth')) return { authorizeLocalBridge: async () => ({ authorized, deviceId: '', devicePlatform: 'desktop' }) };
    if (name.endsWith('/local-bridge-realtime')) return { publishBridgeCommandUpdated: async () => {} };
    if (name.endsWith('/inventory-sync-notifications')) return { notifyInventorySyncAttention: async storeId => {
      assert.equal(storeId, 'store-a'); notificationCalls++; throw new Error('provider offline');
    } };
    if (name.endsWith('/menu-sync-status')) return { menuSyncIssue: () => null };
    return {};
  } });
  const request = () => new Request('https://test.invalid/api/local-bridge/uber-eats/commands?storeId=store-a', {
    method: 'POST', body: JSON.stringify({ commandId: 'command-a', status: 'failed', error: 'network timeout' })
  });
  const response = await exports.POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(updates.length, 1);
  assert.equal(notificationCalls, 0);
  assert.equal(callbacks.length, 1);
  await callbacks[0](); // An outage is caught outside the command acknowledgement.
  assert.equal(notificationCalls, 1);
  authorized = false;
  assert.equal((await exports.POST(request())).status, 401);
  assert.equal(updates.length, 1);
  assert.equal(callbacks.length, 1);
});

test('native inventory capability is registered only through the authenticated device binding', async () => {
  let authorized = true;
  const saved = [];
  const exports = {};
  const code = ts.transpileModule(readFileSync('app/api/store/order-notifications/presence/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  runInNewContext(code, { exports, Response, Date, JSON, require: name => {
    if (name.endsWith('/db')) return { sql: async (_parts, ...values) => { saved.push(JSON.parse(values[0])); return []; } };
    if (name.endsWith('/store-order-push')) return { getOrderPushRules: async () => [], hashPushValue: () => 'test-hash' };
    if (name.endsWith('/store-order-push-transport')) return { getOrderPushConfig: () => ({ enabled: true }) };
    if (name.endsWith('/store-order-push-device-auth')) return { authenticateOrderPushDevice: async () => authorized ? { id: 'device', employeeId: 'employee' } : null };
    throw new Error(name);
  } });
  const invoke = version => exports.POST(new Request('https://test.invalid/presence', { method: 'POST',
    body: JSON.stringify({ token: 'test-token-with-enough-characters', inventorySyncVersion: version }) }));
  assert.equal((await invoke(1)).status, 200);
  assert.equal(saved[0].inventorySyncVersion, 1);
  await invoke(undefined);
  assert.equal(saved[1].inventorySyncVersion, 0);
  await invoke('1');
  assert.equal(saved[2].inventorySyncVersion, 0);
  authorized = false;
  assert.equal((await invoke(1)).status, 401);
  assert.equal(saved.length, 3);
});

test('notification store scope lookup is shared and bounded so an offline lookup cannot strand Menu and Nav', async () => {
  const exports = {}, timers = new Map();
  let requests = 0, signal;
  const code = ts.transpileModule(readFileSync('lib/inventory-sync-alert-client.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  runInNewContext(code, { exports, URLSearchParams, AbortController,
    window: { location: { search: '?syncAttention=1&storeId=store-b' },
      setTimeout: (callback, ms) => { assert.equal(ms, 10000); timers.set(1, callback); return 1; },
      clearTimeout: id => timers.delete(id) },
    fetch: (_url, options) => {
      requests++; signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('offline timeout'))));
    }
  });
  const menu = exports.getScopedInventorySyncNotificationStore();
  const nav = exports.getScopedInventorySyncNotificationStore();
  assert.equal(menu, nav);
  assert.equal(requests, 1);
  timers.get(1)();
  assert.equal(signal.aborted, true);
  assert.equal(await menu, '');
  assert.equal(await nav, '');
  assert.equal(timers.size, 0);
});
