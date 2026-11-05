// Actual transient transport, realtime authorization and display settings routes.
// PostgreSQL is isolated in PGlite; Pusher and signed-in identity are injected.
// This suite never opens production credentials or contacts an external endpoint.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createPrintDocumentFixture } from './pos-print-document-fixture.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, i, values) => { if (value.startsWith('--')) all.push([value.slice(2), values[i + 1]]); return all; }, []));
const source = resolve(args.source || process.cwd()), output = resolve(args.output || 'outputs/pos-debug-display-api');
await mkdir(output, { recursive: true });
const f = await createPrintDocumentFixture(source), { db, ids, state, sql } = f;
const require = createRequire(join(source, 'package.json')), ts = require('typescript');
const sessionId = '00000000-0000-4000-8000-000000004001', otherSessionId = '00000000-0000-4000-8000-000000004002';
const origin = 'http://isolated.test';
const events = [], authorizations = [], queries = [], usageCalls = [], results = [];
let pusherAvailable = true, triggerFails = false, authCalls = 0;
const validSession = state.session;
const realQuery = db.query.bind(db);
const normalOrderEvents = [];
const modules = {
  'api-auth': {
    requireOsSession: async () => { authCalls++; return state.session; },
    getSessionStoreScope: async () => ({ allStores: false, storeIds: [ids.store] }),
    canAccessStore: async (_session, storeId) => storeId === ids.store
  },
  db: { sql },
  'role-permissions': { roleHasPermission: async () => true },
  'external-service-usage': { recordExternalServiceUsage: async (...args) => { usageCalls.push(args); throw new Error('Usage persistence is forbidden in debug tests'); } },
  'order-realtime': {
    getPusher: () => pusherAvailable ? {
      trigger: async (channel, event, payload) => { if (triggerFails) throw new Error('Injected Pusher outage'); events.push(JSON.parse(JSON.stringify({ channel, event, payload }))); },
      authorizeChannel: (socketId, channel, presence) => { authorizations.push({ socketId, channel, presence }); return { auth: 'test-signature' }; }
    } : null,
    publishPosCustomerDisplayEvent: async (...args) => { normalOrderEvents.push(args); throw new Error('Production display publishing is forbidden'); }
  }
};
const loaded = new Map();
function load(path) {
  const absolute = resolve(source, path);
  if (loaded.has(absolute)) return loaded.get(absolute);
  const exports = {}; loaded.set(absolute, exports);
  const code = ts.transpileModule(readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, Request, Response, URL, URLSearchParams, FormData, Buffer, structuredClone, performance, console, Error, Date, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: 'test', PUSHER_KEY: 'isolated-key', PUSHER_CLUSTER: 'ap3' } },
    require: name => {
      if (name === 'node:crypto') return require(name);
      if (name === 'server-only') return {};
      const key = name.split('/').at(-1);
      if (modules[key]) return modules[key];
      if (name.startsWith('.')) return load(resolve(dirname(absolute), name) + '.ts');
      throw new Error(`Unmocked dependency ${name} in ${path}`);
    }
  }, { filename: absolute });
  return exports;
}
function request(path, value, extraHeaders = {}, method = 'POST') {
  return new Request(origin + path, { method, headers: { origin, 'content-type': 'application/json', ...extraHeaders }, ...(method === 'GET' ? {} : { body: typeof value === 'string' ? value : JSON.stringify(value) }) });
}
const validState = { status: 'cash_change', storeName: '桜並木 test', orderType: 'eat_in', paymentMethod: 'cash', paymentLabel: '現金', pickupCode: 'TEST-0001', preferredLanguage: 'ja', subtotal: 1450, taxAmount: 131, cashTenderedAmount: 2000, cashChangeAmount: 550,
  items: [{ name: '麻辣湯', quantity: 1, unitPrice: 1450, amount: 1450, optionLabel: '牛筋 50g', weightLabel: '250g' }],
  weighing: { itemName: '麻辣湯', optionLabel: '中辛 / 牛筋 50g x2', quantity: 250, unit: 'g', unitPrice: 4, amount: 1000 }
};
const message = (overrides = {}) => ({ storeId: ids.store, sessionId, kind: 'state', sequence: 1, state: validState, ...overrides });
async function json(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message); }
}
async function snapshot() {
  const tables = (await realQuery("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(row => row.tablename), data = {};
  for (const table of tables) data[table] = (await realQuery(`select to_jsonb(t) as row from "${table}" t order by to_jsonb(t)::text`)).rows;
  return JSON.parse(JSON.stringify(data));
}
function formRequest(channel, socketId = '123.456', requestOrigin = origin) {
  return new Request(origin + '/api/store/realtime-auth', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(requestOrigin === null ? {} : { origin: requestOrigin }) }, body: new URLSearchParams({ channel_name: channel, socket_id: socketId }) });
}

try {
  await db.exec('create table pos_customer_display_states(store_id uuid primary key,display_state jsonb,updated_at timestamptz default now())');
  await realQuery('insert into pos_customer_display_states(store_id,display_state) values($1,$2::jsonb)', [ids.store, JSON.stringify({ status: 'complete', pickupCode: 'REAL-SECRET-99', memberDisplayName: 'LIVE-MEMBER-SECRET', items: [{ name: 'LIVE-ITEM-SECRET', amount: 815 }] })]);
  const before = await snapshot();
  db.query = async (text, values, ...rest) => {
    queries.push(String(text));
    assert.match(String(text), /^\s*select\b/i, 'Debug handler attempted a database mutation');
    return realQuery(text, values, ...rest);
  };
  const route = load('app/api/store/pos/debug-display/route.ts'), auth = load('app/api/store/realtime-auth/route.ts');
  const display = load('app/api/store/pos/customer-display/route.ts'), config = load('app/api/store/realtime-config/route.ts');
  const policy = load('lib/pos-debug-display.ts');
  const channel = policy.posDebugChannel(ids.store, sessionId);

  await check('transient-state-is-scoped-sanitized-and-never-persists', async () => {
    const response = await route.POST(request('/api/store/pos/debug-display', message()));
    assert.equal(response.headers.get('cache-control'), 'no-store'); await json(response);
    const sent = events.at(-1); assert.equal(sent.channel, channel); assert.equal(sent.event, 'pos.debug-display');
    assert.equal(sent.payload.state.subtotal, 1450); assert.equal(sent.payload.state.weighing.amount, 1000);
    assert.deepEqual(await snapshot(), before); assert.equal(usageCalls.length, 0); assert.equal(normalOrderEvents.length, 0);
  });
  await check('weighing-selected-option-names-survive-transient-broadcast-without-group-metadata', async () => {
    for (const [language, optionLabel] of [['ja', '中辛 / 牛筋 50g x2'], ['en', 'Medium hot / Beef tendon 50g x2'], ['zh', '中辣 / 牛筋 50g x2']]) {
      await json(await route.POST(request('/api/store/pos/debug-display', message({ state: { ...validState, preferredLanguage: language,
        weighing: { ...validState.weighing, optionLabel, groupName: 'GROUP-MUST-NOT-LEAK', groupDisplayNames: { en: 'SECRET-GROUP' } } } }))));
      const sent = events.at(-1).payload.state;
      assert.equal(sent.preferredLanguage, language); assert.equal(sent.weighing.optionLabel, optionLabel);
      assert.equal(sent.weighing.quantity, 250); assert.equal(sent.weighing.amount, 1000); assert.equal(sent.subtotal, 1450);
      assert.ok(!JSON.stringify(sent).includes('GROUP-MUST-NOT-LEAK')); assert.ok(!JSON.stringify(sent).includes('SECRET-GROUP'));
    }
    assert.deepEqual(await snapshot(), before);
  });
  await check('weighing-option-text-is-bounded-and-does-not-coerce-non-string-input', async () => {
    for (const [optionLabel, expected] of [['名'.repeat(700), '名'.repeat(500)], [null, ''], [{ name: 'must-not-stringify' }, ''], [undefined, '']]) {
      await json(await route.POST(request('/api/store/pos/debug-display', message({ state: { ...validState, weighing: { ...validState.weighing, optionLabel } } }))));
      assert.equal(events.at(-1).payload.state.weighing.optionLabel, expected);
      assert.equal(events.at(-1).payload.state.weighing.amount, 1000);
    }
    assert.deepEqual(await snapshot(), before);
  });
  await check('sensitive-member-order-print-and-native-fields-are-stripped', async () => {
    await json(await route.POST(request('/api/store/pos/debug-display', message({ state: { ...validState, memberId: 'secret-member-id', memberDisplayName: 'secret-member-name', memberMessage: 'secret-member-message', memberScanCommand: { id: 'scan-secret' }, memberScanRequest: { code: 'qr-secret' }, couponName: 'secret-coupon', couponDiscountAmount: 700, orderId: 'secret-order', printer: { openCashDrawer: true }, printDocuments: { secret: true }, clientOrderId: 'offline-secret', items: [{ ...validState.items[0], id: 'secret-item-id', memberToken: 'token-secret' }], weighing: { ...validState.weighing, scaleCaptureId: 'scale-secret' } } }))));
    const sent = events.at(-1).payload.state, encoded = JSON.stringify(sent);
    for (const secret of ['secret-member', 'scan-secret', 'qr-secret', 'secret-coupon', 'secret-order', 'openCashDrawer', 'printDocuments', 'offline-secret', 'secret-item', 'token-secret', 'scale-secret']) assert.ok(!encoded.includes(secret), secret);
    assert.equal(sent.memberDisplayName, ''); assert.equal(sent.memberScanCommand, null); assert.equal(sent.couponDiscountAmount, 0);
  });
  await check('real-pickup-code-is-never-shown-as-a-test-ticket', async () => {
    await json(await route.POST(request('/api/store/pos/debug-display', message({ state: { ...validState, pickupCode: 'D042' } }))));
    assert.equal(events.at(-1).payload.state.pickupCode, '');
  });
  await check('origin-denials-run-before-auth-sql-or-broadcast', async () => {
    for (const requestOrigin of ['https://untrusted.example', 'null', '']) {
      const previous = { authCalls, queries: queries.length, events: events.length };
      await json(await route.POST(request('/api/store/pos/debug-display', message(), { origin: requestOrigin })), 403);
      assert.deepEqual({ authCalls, queries: queries.length, events: events.length }, previous);
    }
    const previous = events.length;
    await json(await route.POST(new Request(origin + '/api/store/pos/debug-display', { method: 'POST', body: JSON.stringify(message()) })), 403);
    assert.equal(events.length, previous);
  });
  await check('authentication-and-store-scope-deny-untrusted-broadcasts', async () => {
    const previous = events.length; state.session = null;
    await json(await route.POST(request('/api/store/pos/debug-display', message())), 401);
    state.session = validSession;
    await json(await route.POST(request('/api/store/pos/debug-display', message({ storeId: ids.other }))), 403);
    assert.equal(events.length, previous);
  });
  await check('malformed-json-identity-sequence-kind-and-state-are-rejected', async () => {
    const previous = events.length;
    for (const invalid of ['{', 'null', '[]', '7', '"text"', message({ storeId: 'not-uuid' }), message({ sessionId: '' }), message({ kind: 'print' }), message({ sequence: -1 }), message({ sequence: 1.25 }), message({ sequence: '1' }), message({ state: null }), message({ state: { items: Array.from({ length: 51 }, () => ({})) } })]) await json(await route.POST(request('/api/store/pos/debug-display', invalid)), 400);
    assert.equal(events.length, previous);
  });
  await check('raw-and-normalized-message-size-limits-prevent-pusher-overflow', async () => {
    const previous = events.length;
    await json(await route.POST(request('/api/store/pos/debug-display', ' '.repeat(12001))), 413);
    const oversized = message({ state: { ...validState, items: Array.from({ length: 14 }, () => ({ name: 'n'.repeat(160), optionLabel: 'o'.repeat(400), weightLabel: 'w'.repeat(100) })) } });
    assert.ok(Buffer.byteLength(JSON.stringify(oversized), 'utf8') <= 12000);
    await json(await route.POST(request('/api/store/pos/debug-display', oversized)), 413); assert.equal(events.length, previous);
  });
  await check('hello-ack-and-end-contain-no-cart-and-use-only-explicit-session-channel', async () => {
    for (const kind of ['hello', 'ack', 'end']) {
      await json(await route.POST(request('/api/store/pos/debug-display', message({ kind, sessionId: otherSessionId }))));
      const sent = events.at(-1); assert.equal(sent.channel, policy.posDebugChannel(ids.store, otherSessionId)); assert.equal(sent.payload.kind, kind); assert.equal(sent.payload.state, undefined);
    }
    assert.ok(events.every(event => event.channel.startsWith('private-pos-debug-')));
  });
  await check('pusher-missing-or-failed-is-truthfully-reported-without-fallback-writes', async () => {
    const previous = events.length;
    pusherAvailable = false; await json(await route.POST(request('/api/store/pos/debug-display', message())), 503);
    pusherAvailable = true; triggerFails = true; await json(await route.POST(request('/api/store/pos/debug-display', message())), 503); triggerFails = false;
    assert.equal(events.length, previous); assert.deepEqual(await snapshot(), before);
  });
  await check('private-debug-channel-authorizes-only-the-matching-store-and-session', async () => {
    const previous = authorizations.length;
    await json(await auth.POST(formRequest(channel))); assert.equal(authorizations.at(-1).channel, channel);
    await json(await auth.POST(formRequest(policy.posDebugChannel(ids.store, otherSessionId)))); assert.notEqual(authorizations.at(-1).channel, channel);
    const denied = await auth.POST(formRequest(policy.posDebugChannel(ids.other, sessionId))); assert.ok([400, 403].includes(denied.status));
    assert.equal(authorizations.length, previous + 2);
  });
  await check('debug-channel-rejects-cross-origin-malformed-sockets-and-arbitrary-channel-names', async () => {
    const previous = authorizations.length;
    for (const requestOrigin of [null, 'https://untrusted.example']) await json(await auth.POST(formRequest(channel, '123.456', requestOrigin)), 403);
    for (const invalidSocket of ['', 'arbitrary', '123', '../socket']) assert.ok([400, 403].includes((await auth.POST(formRequest(channel, invalidSocket))).status));
    for (const invalidChannel of ['private-pos-debug-bad-bad', channel + '-other', channel.replace(sessionId, 'z'.repeat(36)), 'private-anything', 'public-pos-debug-' + ids.store]) assert.ok([400, 403].includes((await auth.POST(formRequest(invalidChannel))).status));
    assert.equal(authorizations.length, previous);
  });
  await check('realtime-auth-requires-login-and-truthfully-reports-missing-pusher', async () => {
    const previous = authorizations.length;
    state.session = null; await json(await auth.POST(formRequest(channel)), 401); state.session = validSession;
    pusherAvailable = false; await json(await auth.POST(formRequest(channel)), 503); pusherAvailable = true;
    assert.equal(authorizations.length, previous);
  });
  await check('normal-realtime-store-notification-and-bridge-channels-retain-existing-auth', async () => {
    for (const ordinary of [`private-store-orders-${ids.store}`, `private-os-notifications-${ids.employee}`, `presence-store-bridge-${ids.store}`]) { await json(await auth.POST(formRequest(ordinary))); assert.equal(authorizations.at(-1).channel, ordinary); }
  });
  await check('debug-display-settings-read-never-reads-live-customer-display-state', async () => {
    queries.length = 0;
    const response = await display.GET(request(`/api/store/pos/customer-display?storeId=${ids.store}&debug=1`, undefined, {}, 'GET'));
    const body = await json(response); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(body.debugMode, true); assert.equal(body.selectedStoreId, ids.store);
    assert.equal(body.state.pickupCode, ''); assert.deepEqual(body.state.items, []); assert.ok(!JSON.stringify(body).includes('SECRET'));
    assert.ok(!queries.some(query => /\bpos_customer_display_states\b/.test(query))); assert.deepEqual(await snapshot(), before);
  });
  await check('normal-display-settings-still-read-live-state', async () => {
    queries.length = 0;
    const body = await json(await display.GET(request(`/api/store/pos/customer-display?storeId=${ids.store}`, undefined, {}, 'GET')));
    assert.equal(body.debugMode, undefined); assert.equal(body.state.pickupCode, 'REAL-SECRET-99'); assert.ok(queries.some(query => /\bpos_customer_display_states\b/.test(query)));
  });
  await check('debug-display-settings-and-realtime-config-remain-scoped-read-only', async () => {
    state.session = null; await json(await display.GET(request(`/api/store/pos/customer-display?storeId=${ids.store}&debug=1`, undefined, {}, 'GET')), 401);
    await json(await config.GET(request(`/api/store/realtime-config?storeId=${ids.store}`, undefined, {}, 'GET')), 401);
    state.session = validSession;
    await json(await display.GET(request(`/api/store/pos/customer-display?storeId=${ids.other}&debug=1`, undefined, {}, 'GET')), 403);
    await json(await config.GET(request(`/api/store/realtime-config?storeId=${ids.other}`, undefined, {}, 'GET')), 403);
    const response = await config.GET(request(`/api/store/realtime-config?storeId=${ids.store}`, undefined, {}, 'GET')), body = await json(response);
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(body.key, 'isolated-key'); assert.deepEqual(await snapshot(), before);
  });
  assert.equal(usageCalls.length, 0); assert.equal(normalOrderEvents.length, 0); assert.deepEqual(await snapshot(), before);
  const hashes = {};
  for (const path of ['lib/pos-debug-display.ts', 'app/api/store/pos/debug-display/route.ts', 'app/api/store/realtime-auth/route.ts', 'app/api/store/realtime-config/route.ts', 'app/api/store/pos/customer-display/route.ts', 'scripts/tests/pos-debug-display-api.mjs']) hashes[path] = createHash('sha256').update(await readFile(join(source, path))).digest('hex');
  const failed = results.filter(result => !result.passed);
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results, hashes, actualHandlers: true, isolatedDatabase: 'PGlite', allDatabaseTablesUnchanged: true, pusherBroadcasts: events.length, pusherAuthorizations: authorizations.length, productionDisplayEvents: normalOrderEvents.length, usageWrites: usageCalls.length, liveWrites: 0, limitation: 'Signed-in identity and Pusher are injected. Real route validation, scope-filter logic and PostgreSQL reads execute locally; no physical display or external Pusher service is contacted.' }, null, 2) + '\n');
  assert.equal(failed.length, 0, failed.map(result => result.name).join(', '));
  console.log(JSON.stringify({ passed: results.length, output }));
} finally { await db.close(); }
