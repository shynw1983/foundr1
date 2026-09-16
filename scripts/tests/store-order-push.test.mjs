import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// A real local PostgreSQL engine, isolated from DATABASE_URL. See docs/store-order-phone-alerts.md.
const require = createRequire(import.meta.url);
const { PGlite } = await import(process.env.PGLITE_MODULE || '/tmp/foundr1-order-push-test/node_modules/@electric-sql/pglite/dist/index.js');
const root = resolve(dirname(new URL(import.meta.url).pathname), '../..');
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table employees(id uuid primary key, name text, role text, status text default 'active', session_version int default 1);
    create table stores(id uuid primary key, name text, status text default 'active', attendance_latitude float, attendance_longitude float);
    create table employee_sessions(id uuid primary key, employee_id uuid, session_version int default 1, revoked_at timestamptz, expires_at timestamptz default now()+interval '14 days');
    create table employee_scopes(employee_id uuid, scope_type text, store_id uuid);
    create table store_customer_orders(id uuid primary key, store_id uuid, order_source text, status text, payment_status text default 'paid', created_at timestamptz default now(), customer_summary jsonb default '{}', pickup_code text default 'T123', amount numeric default 3605);
    create table order_production_tasks(id uuid default gen_random_uuid(), order_id uuid, status text default 'new');
    create table store_order_alert_events(id uuid primary key default gen_random_uuid(), order_id uuid references store_customer_orders(id), store_id uuid references stores(id), alert_phase text, due_at timestamptz, status text default 'pending', workflow_run_id text default '', attempt_count int default 0, acknowledged_at timestamptz, acknowledged_by uuid references employees(id), last_error text default '', created_at timestamptz default now(), updated_at timestamptz default now(), unique(order_id,alert_phase));
  `);
  await db.exec(readFileSync(resolve(root, 'db/migrations/20260915-store-order-push.sql'), 'utf8'));
  const ids = { employee: randomUUID(), store: randomUUID(), order: randomUUID(), session: randomUUID(), device: randomUUID() };
  await db.query("insert into employees(id,name,role) values ($1,'Test owner','owner')", [ids.employee]);
  await db.query("insert into stores(id,name,attendance_latitude,attendance_longitude) values ($1,'Test store',35.1,138.1)", [ids.store]);
  await db.query('insert into employee_sessions(id,employee_id) values ($1,$2)', [ids.session, ids.employee]);
  await db.query("insert into store_customer_orders(id,store_id,order_source,status) values ($1,$2,'rocket_now','preparing')", [ids.order, ids.store]);
  await db.query('insert into order_production_tasks(order_id) values ($1)', [ids.order]);
  await db.query('insert into store_order_push_preferences(employee_id,store_id,enabled) values ($1,$2,true)', [ids.employee, ids.store]);
  await db.query("insert into store_order_push_devices(id,employee_id,session_id,endpoint_hash,presence_token_hash,registration) values ($1,$2,$3,'test','secret','{\"token\":\"test-token\"}')", [ids.device, ids.employee, ids.session]);
  let currentSession = { id: ids.employee, role: 'owner', sessionId: ids.session };
  let allowed = true, failSend = false;
  const sends = [], cache = new Map();
  const sql = async (parts, ...params) => (await db.query(parts.map((part, i) => part + (i < params.length ? `$${i + 1}` : '')).join(''), params)).rows;
  class TransportError extends Error {}
  const mocks = {
    'lib/db.ts': { sql },
    'lib/api-auth.ts': { requireOsSession: async () => currentSession, canAccessStore: async () => allowed },
    'lib/store-order-access.ts': { getStoreOrderAccess: async () => ({ allStores: allowed, storeIds: [], stores: [{ id: ids.store, name: 'Test store' }] }) },
    'lib/store-order-push-transport.ts': { getOrderPushConfig: () => ({ enabled: true, fcm: true }), OrderPushTransportError: TransportError,
      sendOrderPush: async (device, payload) => { if (failSend) throw new TransportError('FCM_SEND_503'); sends.push({ device, payload }); } }
  };
  function load(relative) {
    if (mocks[relative]) return mocks[relative];
    if (cache.has(relative)) return cache.get(relative);
    const exports = {}; cache.set(relative, exports);
    const source = ts.transpileModule(readFileSync(resolve(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(source, { exports, Date, Response, URL, console, process,
      require: (name) => name.startsWith('.') ? load(resolve(dirname(relative), name).slice(process.cwd().length + 1) + '.ts') : require(name) });
    return exports;
  }
  const service = load('lib/store-order-push.ts');
  const api = load('app/api/store/order-notifications/route.ts');
  const presenceApi = load('app/api/store/order-notifications/presence/route.ts');
  const alarmApi = load('app/api/store/order-notifications/alarm/route.ts');
  async function outside() {
    const [rule] = await service.getOrderPushRules(ids.employee);
    await db.query("insert into store_order_push_presence(device_id,store_id,rule_key,state,observed_at) values ($1,$2,$3,'outside',now()) on conflict(device_id,store_id) do update set state='outside',rule_key=excluded.rule_key", [ids.device, ids.store, rule.key]);
  }
  const post = (body) => api.POST(new Request('https://test.invalid/api/store/order-notifications', { method: 'POST', body: JSON.stringify(body) }));
  return { db, ids, service, api, presenceApi, alarmApi, outside, sends, post, setAllowed: (value) => { allowed = value; }, setSession: (value) => { currentSession = value; }, setFail: (value) => { failSend = value; } };
}

test('accepted preparing order with kitchen task creates exactly one alert; replay/history does not create another', async () => {
  const h = await fixture();
  try {
    const event = await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date()); assert.ok(event);
    assert.equal(await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date()), event);
    assert.equal(await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date(Date.now() - 300_000)), null);
    assert.equal((await h.db.query('select count(*)::int n from store_order_alert_events')).rows[0].n, 1);
  } finally { await h.db.close(); }
});

test('only outside devices receive; concurrent replays do not duplicate; acknowledgement preserves order status', async () => {
  const h = await fixture();
  try {
    const event = await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date());
    await h.service.dispatchBridgeOrderPush(event, 0); assert.equal(h.sends.length, 0);
    await h.outside();
    await Promise.all([h.service.dispatchBridgeOrderPush(event, 0), h.service.dispatchBridgeOrderPush(event, 0)]);
    assert.equal(h.sends.length, 1); assert.equal(h.sends[0].payload.orderId, h.ids.order);
    assert.equal((await h.post({ action: 'acknowledge', eventId: event })).status, 200);
    assert.equal((await h.service.dispatchBridgeOrderPush(event, 1)).stop, true); assert.equal(h.sends.length, 1);
    assert.equal((await h.db.query('select status from store_customer_orders')).rows[0].status, 'preparing');
  } finally { await h.db.close(); }
});

test('old rule, revoked login, changed scope, disabled recipient and inside presence suppress delivery', async () => {
  const h = await fixture();
  try {
    const event = await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date()); await h.outside();
    await h.db.exec('update store_order_push_preferences set rule_version=gen_random_uuid()');
    await h.service.dispatchBridgeOrderPush(event, 0); assert.equal(h.sends.length, 0); await h.outside();
    await h.db.exec('update employee_sessions set revoked_at=now()');
    await h.service.dispatchBridgeOrderPush(event, 0); assert.equal(h.sends.length, 0);
    await h.db.exec("update employee_sessions set revoked_at=null; update employees set role='store_terminal'");
    await h.service.dispatchBridgeOrderPush(event, 0); assert.equal(h.sends.length, 0);
    await h.db.exec("update employees set role='owner'; update store_order_push_preferences set enabled=false");
    await h.service.dispatchBridgeOrderPush(event, 0); assert.equal(h.sends.length, 0);
    await h.db.exec("update store_order_push_preferences set enabled=true; update store_order_push_presence set state='inside'");
    await h.service.dispatchBridgeOrderPush(event, 0); assert.equal(h.sends.length, 0);
  } finally { await h.db.close(); }
});

test('cancelled or started kitchen task stops reminders; failed delivery can retry without treating provider failure as success', async () => {
  const h = await fixture();
  try {
    const event = await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date()); await h.outside();
    h.setFail(true); await h.service.dispatchBridgeOrderPush(event, 0);
    assert.equal((await h.db.query('select status from store_order_push_deliveries')).rows[0].status, 'failed');
    h.setFail(false); await h.service.dispatchBridgeOrderPush(event, 0); assert.equal(h.sends.length, 1);
    await h.db.exec("update order_production_tasks set status='preparing'");
    assert.equal((await h.service.dispatchBridgeOrderPush(event, 1)).stop, true);
    assert.equal(await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date()), null);
    await h.db.exec("update order_production_tasks set status='new'; update store_customer_orders set status='cancelled'");
    assert.equal((await h.service.dispatchBridgeOrderPush(event, 2)).stop, true);
  } finally { await h.db.close(); }
});

test('API enforces login, store scope and configuration roles', async () => {
  const h = await fixture();
  try {
    const event = await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date());
    h.setAllowed(false); assert.equal((await h.post({ action: 'acknowledge', eventId: event })).status, 403);
    h.setSession({ id: h.ids.employee, role: 'store_terminal', sessionId: h.ids.session });
    assert.equal((await h.post({ action: 'save_rule' })).status, 403);
    h.setSession(null); assert.equal((await h.post({ action: 'test' })).status, 401);
    assert.equal((await h.presenceApi.POST(new Request('https://test.invalid/presence', { method: 'POST', body: '{}' }))).status, 401);
  } finally { await h.db.close(); }
});

test('device registration binds the login, presence ignores older updates and stores no GPS coordinates', async () => {
  const h = await fixture();
  try {
    const response = await h.post({ action: 'register', deviceId: h.ids.device, token: 'test-fcm-token-with-enough-characters', language: 'zh-Hans' });
    assert.equal(response.status, 200);
    const binding = await response.json(); assert.equal(binding.sessionId, h.ids.session); assert.equal(binding.rules.length, 1);
    const now = Date.now(), rule = binding.rules[0];
    const presenceRequest = (state, observedAt, secret = binding.presenceToken) => h.presenceApi.POST(new Request('https://test.invalid/presence', {
      method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ presence: [{ storeId: h.ids.store, ruleKey: rule.key, state, observedAt, latitude: 1, longitude: 2 }] })
    }));
    assert.equal((await presenceRequest('outside', now)).status, 200);
    await presenceRequest('inside', now - 1000);
    let row = (await h.db.query('select * from store_order_push_presence')).rows[0];
    assert.equal(row.state, 'outside'); assert.equal('latitude' in row, false); assert.equal('longitude' in row, false);
    await presenceRequest('inside', now + 1); row = (await h.db.query('select * from store_order_push_presence')).rows[0]; assert.equal(row.state, 'inside');
    await h.db.exec('update employee_sessions set revoked_at=now()');
    assert.equal((await presenceRequest('outside', now + 2)).status, 401);
  } finally { await h.db.close(); }
});

test('stale order or absent kitchen task never generates an alert; settings validate return radius and coordinates', async () => {
  const h = await fixture();
  try {
    await h.db.exec("update store_customer_orders set created_at=now()-interval '1 day'");
    assert.equal(await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date()), null);
    await h.db.exec('update store_customer_orders set created_at=now(); delete from order_production_tasks');
    assert.equal(await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date()), null);
    const body = { action: 'save_rule', employeeId: h.ids.employee, storeId: h.ids.store, exitRadius: 500, enterRadius: 300, enabled: true };
    assert.equal((await h.post({ ...body, enterRadius: 600 })).status, 400);
    await h.db.exec('update stores set attendance_latitude=null');
    const missingLocation = await h.post(body); assert.equal(missingLocation.status, 400);
    assert.match((await missingLocation.json()).error, /打刻用の位置情報がありません/);
    assert.equal((await h.post({ ...body, enabled: false })).status, 200);
  } finally { await h.db.close(); }
});

test('saving a rule returns persisted values; readback lists enabled and disabled records without duplicates', async () => {
  const h = await fixture();
  try {
    await h.db.exec('delete from store_order_push_preferences');
    const body = { action: 'save_rule', employeeId: h.ids.employee, storeId: h.ids.store, enabled: true, exitRadius: 650, enterRadius: 250 };
    const response = await h.post(body); assert.equal(response.status, 200);
    const { preference } = await response.json();
    assert.equal(preference.employeeName, 'Test owner'); assert.equal(preference.storeName, 'Test store');
    assert.equal(preference.exitRadius, 650); assert.equal(preference.enterRadius, 250); assert.equal(preference.enabled, true);
    assert.ok(Number.isFinite(Date.parse(preference.updatedAt)));
    const get = () => h.api.GET(new Request('https://test.invalid/api/store/order-notifications')).then((r) => r.json());
    let data = await get(); assert.equal(data.preferences.length, 1); assert.equal(data.rules.length, 1);
    assert.equal(data.preferences[0].employeeName, preference.employeeName); assert.equal(data.preferences[0].updatedAt, preference.updatedAt);
    const disabled = await h.post({ ...body, enabled: false, enterRadius: 300 }); assert.equal(disabled.status, 200);
    assert.equal((await disabled.json()).preference.enabled, false);
    data = await get(); assert.equal(data.preferences.length, 1); assert.equal(data.preferences[0].enabled, false);
    assert.equal(data.preferences[0].enterRadius, 300); assert.equal(data.rules.length, 0);
    assert.equal((await h.db.query('select count(*)::int n from store_order_push_preferences')).rows[0].n, 1);
    assert.equal((await h.db.query('select status from store_customer_orders')).rows[0].status, 'preparing');
  } finally { await h.db.close(); }
});

test('saved rule listing and writes enforce manager ownership and store scope', async () => {
  const h = await fixture();
  try {
    const managerId = randomUUID();
    await h.db.query("insert into employees(id,name,role) values ($1,'Test manager','manager')", [managerId]);
    h.setSession({ id: managerId, role: 'manager', sessionId: h.ids.session });
    const body = { action: 'save_rule', employeeId: h.ids.employee, storeId: h.ids.store, enabled: true, exitRadius: 700, enterRadius: 300 };
    assert.equal((await h.post(body)).status, 400);
    let data = await (await h.api.GET(new Request('https://test.invalid/api/store/order-notifications'))).json();
    assert.equal(data.preferences.length, 0);
    assert.equal((await h.post({ ...body, employeeId: managerId })).status, 200);
    data = await (await h.api.GET(new Request('https://test.invalid/api/store/order-notifications'))).json();
    assert.equal(data.preferences.length, 1); assert.equal(data.preferences[0].employeeId, managerId);
    h.setAllowed(false);
    assert.equal((await h.post({ ...body, employeeId: managerId })).status, 403);
    data = await (await h.api.GET(new Request('https://test.invalid/api/store/order-notifications'))).json();
    assert.equal(data.preferences.length, 0);
  } finally { await h.db.close(); }
});

async function alarmFixture() {
  const h = await fixture();
  const registration = await h.post({ action: 'register', deviceId: h.ids.device, token: 'alarm-test-device-token-123456', language: 'zh-Hans' });
  const binding = await registration.json();
  await h.outside();
  const event = await h.service.ensureBridgeOrderPushEvent(h.ids.order, new Date());
  await h.service.dispatchBridgeOrderPush(event, 0);
  const request = (body, secret = binding.presenceToken) => h.alarmApi.POST(new Request('https://test.invalid/api/store/order-notifications/alarm', {
    method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body)
  }));
  return { ...h, event, request };
}

test('continuous alarm remains active after FCM delivery window and acknowledgement changes only alert state', async () => {
  const h = await alarmFixture();
  try {
    await h.db.exec("update store_order_alert_events set due_at=now()-interval '30 minutes', status='cancelled'");
    const status = await h.request({ action: 'status', eventIds: [h.event] });
    assert.equal(status.status, 200); assert.deepEqual((await status.json()).activeIds, [h.event]);
    assert.equal((await h.request({ action: 'acknowledge', eventIds: [h.event] })).status, 200);
    assert.deepEqual((await (await h.request({ action: 'status', eventIds: [h.event] })).json()).activeIds, []);
    assert.equal((await h.db.query('select status from store_customer_orders')).rows[0].status, 'preparing');
    assert.equal((await h.db.query('select status from order_production_tasks')).rows[0].status, 'new');
    assert.equal((await h.request({ action: 'acknowledge', eventIds: [h.event] })).status, 200);
  } finally { await h.db.close(); }
});

test('continuous alarm stops for web acknowledgement, cancelled order, started kitchen task, return to store or changed rule', async () => {
  const h = await alarmFixture();
  const active = async () => (await (await h.request({ action: 'status', eventIds: [h.event] })).json()).activeIds;
  try {
    assert.deepEqual(await active(), [h.event]);
    await h.post({ action: 'acknowledge', eventId: h.event }); assert.deepEqual(await active(), []);
    await h.db.exec('update store_order_alert_events set acknowledged_at=null');
    await h.db.exec("update store_customer_orders set status='cancelled'"); assert.deepEqual(await active(), []);
    await h.db.exec("update store_customer_orders set status='preparing'; update order_production_tasks set status='preparing'"); assert.deepEqual(await active(), []);
    await h.db.exec("update order_production_tasks set status='new'; update store_order_push_presence set state='inside'"); assert.deepEqual(await active(), []);
    await h.outside(); assert.deepEqual(await active(), [h.event]);
    await h.db.exec('update store_order_push_preferences set rule_version=gen_random_uuid()'); assert.deepEqual(await active(), []);
  } finally { await h.db.close(); }
});

test('alarm device token cannot acknowledge another recipient, lost scope or revoked login; invalid payload fails closed', async () => {
  const h = await alarmFixture();
  try {
    assert.equal((await h.request({ action: 'status', eventIds: [h.event] }, 'invalid')).status, 401);
    assert.equal((await h.request({ action: 'acknowledge', eventIds: [h.event, randomUUID()] })).status, 403);
    assert.equal((await h.db.query('select acknowledged_at from store_order_alert_events')).rows[0].acknowledged_at, null);
    assert.equal((await h.request({ action: 'status', eventIds: ["not-a-uuid"] })).status, 400);
    assert.equal((await h.request({ action: 'status', eventIds: Array(51).fill(h.event) })).status, 400);
    await h.db.exec('delete from store_order_push_deliveries');
    assert.deepEqual((await (await h.request({ action: 'status', eventIds: [h.event] })).json()).activeIds, []);
    assert.equal((await h.request({ action: 'acknowledge', eventIds: [h.event] })).status, 403);
    await h.db.exec("update employees set role='store_terminal'");
    assert.equal((await h.request({ action: 'acknowledge', eventIds: [h.event] })).status, 403);
    await h.db.exec('update employee_sessions set revoked_at=now()');
    assert.equal((await h.request({ action: 'status', eventIds: [h.event] })).status, 401);
  } finally { await h.db.close(); }
});
