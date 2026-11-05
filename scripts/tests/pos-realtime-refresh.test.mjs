import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
const root = resolve(new URL('../..', import.meta.url).pathname);
const storeA = '11111111-1111-4111-8111-111111111111', storeB = '22222222-2222-4222-8222-222222222222';
const initial = { orderCount: 0, total: 0, pendingSync: false };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(component = 'summary') {
  const slots = [], modules = new Map(), requests = [], timers = new Map(), listeners = new Map(), docListeners = new Map();
  let index = 0, dirty = false, effects = [], time = 0, timerId = 0, id = storeA, enabled = true, disconnects = 0;
  const add = (map, name, fn) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); };
  const remove = (map, name, fn) => map.get(name)?.delete(fn);
  const dispatch = (map, name, detail = {}) => [...map.get(name) || []].forEach(fn => fn(detail));
  const setTimer = (fn, delay, repeat = false) => { const value = ++timerId; timers.set(value, { fn, at: time + delay, delay, repeat }); return value; };
  const window = {
    setTimeout: (fn, delay) => setTimer(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => setTimer(fn, delay, true), clearInterval: id => timers.delete(id),
    addEventListener: (name, fn) => add(listeners, name, fn), removeEventListener: (name, fn) => remove(listeners, name, fn),
    localStorage: { getItem: () => null, setItem() {} }, queueMicrotask,
  };
  const document = { visibilityState: 'visible', hasFocus: () => true,
    addEventListener: (name, fn) => add(docListeners, name, fn), removeEventListener: (name, fn) => remove(docListeners, name, fn) };
  const navigator = { onLine: true };
  const channels = new Map(), connectionListeners = new Map();
  const connection = { state: 'connected', bind: (n, fn) => add(connectionListeners, n, fn), unbind: (n, fn) => remove(connectionListeners, n, fn) };
  const pusher = { connection, subscribe(name) {
    if (!channels.has(name)) {
      const handlers = new Map();
      channels.set(name, { name, subscribed: false, bind: (n, fn) => add(handlers, n, fn), unbind: (n, fn) => remove(handlers, n, fn), emit: (n, payload) => dispatch(handlers, n, payload) });
    }
    return channels.get(name);
  }, disconnect() { disconnects++; }, unsubscribe() {} };
  function memo(run, deps) { const i = index++, old = slots[i]; if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) slots[i] = { value: run(), deps }; return slots[i].value; }
  const react = { useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; }, useCallback: (fn, deps) => memo(() => fn, deps), useMemo: memo,
    useEffect(fn, deps) { const i = index++, old = slots[i]; if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); } };
  const FakeDate = class extends Date { constructor(...args) { super(...(args.length ? args : [1700000000000 + time])); } static now() { return 1700000000000 + time; } };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const dependency = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === 'pusher-js') return { default: class { constructor() { return pusher; } } };
      if (name.includes('shared-pusher-client')) return { acquireSharedPusher: () => pusher };
      if (name.includes('store-business-hours')) return { getStoreCashBusinessDayState: () => ({ status: 'business_open' }) };
      if (name.endsWith('OsTranslationProvider')) return { useOsTranslation: () => ({ t: x => x }) };
      if (name.endsWith('StoreThemeProvider')) return { useStoreTheme: () => ({}) };
      if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => key });
      if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => String(key) });
      let path = resolve(dirname(file), name); if (!/\.[tj]sx?$/.test(path)) path += '.ts';
      if (name.endsWith('useHqAlertRealtime')) return load(path);
      return load(path);
    };
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    runInNewContext(compiled, { exports, require: dependency, window, document, navigator, Date: FakeDate, Math: { ...Math, random: () => 0, min: Math.min, max: Math.max, round: Math.round, ceil: Math.ceil },
      AbortController, AbortSignal, DOMException, URLSearchParams, Set, Map, Promise, Error, TypeError, Number, Array, Object, JSON, console,
      setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, setInterval: window.setInterval, clearInterval: window.clearInterval,
      crypto: { randomUUID: () => storeB }, localStorage: window.localStorage, IntersectionObserver: class { observe() {} disconnect() {} },
      fetch: (url, options = {}) => new Promise(resolve => requests.push({ url, options, respond(body, status = 200) { resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })); } })) });
    return exports;
  }
  const moduleFile = component === 'summary' ? 'app/store/pos/usePosDailySummary.ts' : component === 'fulfillment' ? 'app/store/pos/usePosFulfillmentQueue.ts' : 'app/store/components/StoreHqAlert.tsx';
  const entry = load(resolve(root, moduleFile));
  let state;
  function render() { for (let pass = 0; pass < 15; pass++) { index = 0; dirty = false; effects = [];
    state = component === 'summary' ? entry.usePosDailySummary(id, enabled, initial) : component === 'fulfillment' ? entry.usePosFulfillmentQueue({ storeId: id, enabled }) : entry.StoreHqAlertInbox({ storeId: id });
    effects.forEach(fn => fn()); if (!dirty) return state;
  } throw Error('effects failed to settle'); }
  async function settle() { for (let pass = 0; pass < 4; pass++) { await turn(); render(); } }
  async function advance(ms) { const until = time + ms; let count = 0; while (true) { const next = [...timers].filter(([, v]) => v.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; assert(++count < 1000, 'timer budget'); time = next[1].at; timers.delete(next[0]); if (next[1].repeat) next[1].at = time + next[1].delay, timers.set(next[0], next[1]); next[1].fn(); await settle(); } time = until; await settle(); }
  function pending(path) { return requests.filter(r => r.url.includes(path) && !r.done); }
  function respond(path, body, status = 200) { const r = pending(path)[0]; assert(r, `expected request ${path}`); r.done = true; r.respond(body, status); return r; }
  function summary(count, target = id) { return { selectedStoreId: target, todaySummary: { orderCount: count, total: count * 1000 } }; }
  async function ready(count = 1) { render(); await settle(); if (component === 'summary') respond('/summary?', summary(count)); else if (component === 'fulfillment') respond('/fulfillment?', { selectedStoreId: id, tasks: [], ok: true }); else respond('/hq-alerts?', { storeId: id, alerts: [], realtime: { key: 'fixture', cluster: 'fixture', channel: 'hq' } });
    if (component !== 'hq') respond('/realtime-config?', { key: 'fixture', cluster: 'fixture', channels: ['a', 'b'] }); await settle(); }
  return { render, settle, advance, requests, pending, respond, summary, ready, window, document, navigator, disconnects: () => disconnects,
    state: () => state, select(next) { id = next; render(); }, enable(value) { enabled = value; render(); },
    subscribe(name) { const channel = channels.get(name); assert(channel, `channel ${name}`); channel.subscribed = true; channel.emit('pusher:subscription_succeeded'); },
    event(name = 'order.created') { channels.values().next().value.emit(name); },
    subscriptionError(name, status) { channels.get(name).emit('pusher:subscription_error', { status }); },
    disconnect() { connection.state = 'disconnected'; dispatch(connectionListeners, 'state_change', { current: 'disconnected' }); },
    reconnect() { connection.state = 'connected'; dispatch(connectionListeners, 'state_change', { current: 'connected' }); },
    wake() { dispatch(listeners, 'focus'); dispatch(listeners, 'online'); dispatch(docListeners, 'visibilitychange'); },
    dispose() { slots.forEach(s => s?.cleanup?.()); } };
}

test('POS summary counts HTTP reads: healthy integrity is five minutes, partial channels use one-minute fallback', async () => {
  const f = fixture(); await f.ready(); f.subscribe('a'); await f.settle();
  await f.advance(59_999); assert.equal(f.pending('/summary?').length, 0);
  await f.advance(1); f.respond('/summary?', f.summary(2)); await f.settle(); assert.equal(f.state().summary.orderCount, 2);
  f.subscribe('b'); await f.settle(); f.respond('/summary?', f.summary(3)); await f.settle();
  await f.advance(299_999); assert.equal(f.pending('/summary?').length, 0);
  await f.advance(1); f.respond('/summary?', f.summary(4)); await f.settle(); assert.equal(f.state().summary.orderCount, 4); f.dispose();
});
test('POS summary event in-flight gets a trailing read and older read cannot overwrite a checkout snapshot', async () => {
  const f = fixture(); await f.ready(); f.event(); await f.settle(); const first = f.pending('/summary?')[0];
  f.event(); f.event(); await f.settle(); assert.equal(f.pending('/summary?').length, 1);
  first.done = true; first.respond(f.summary(2)); await f.settle(); assert.equal(f.pending('/summary?').length, 1);
  f.state().setSummary({ orderCount: 9, total: 9000 }); f.render(); f.respond('/summary?', f.summary(3)); await f.settle(); assert.equal(f.state().summary.orderCount, 9); f.dispose();
});
test('POS summary reconnect and browser wake reconcile once; old-store responses are fenced', async () => {
  const f = fixture(); await f.ready(); f.subscribe('a'); f.subscribe('b'); await f.settle(); f.respond('/summary?', f.summary(2)); await f.settle();
  f.disconnect(); f.reconnect(); f.subscribe('a'); f.subscribe('b'); await f.settle(); assert.equal(f.pending('/summary?').length, 1); f.respond('/summary?', f.summary(3)); await f.settle();
  f.wake(); await f.advance(75); assert.equal(f.pending('/summary?').length, 1); const old = f.pending('/summary?')[0];
  f.select(storeB); await f.settle(); const next = f.pending('/summary?').at(-1); next.done = true; next.respond(f.summary(7, storeB)); await f.settle(); old.done = true; old.respond(f.summary(4, storeA)); await f.settle(); assert.equal(f.state().summary.orderCount, 7); f.dispose();
});
test('POS summary auth denial clears values, stops automatic reads, and debug mode does not query', async () => {
  const f = fixture(); await f.ready(); f.event(); await f.settle(); f.respond('/summary?', { error: 'denied' }, 403); await f.settle(); assert.equal(f.state().summary.orderCount, 0); assert(f.disconnects() >= 1); const reads = f.requests.length; f.wake(); await f.advance(900_000); assert.equal(f.requests.length, reads); f.dispose();
  const debug = fixture(); debug.enable(false); await debug.settle(); assert.equal(debug.requests.length, 0); debug.dispose();
});
test('POS summary manual retry bypasses failure backoff while push events do not hammer failures', async () => {
  const f = fixture(); await f.ready(); f.event(); await f.settle(); f.respond('/summary?', { error: 'failed' }, 503); await f.settle(); assert.equal(f.state().summary.orderCount, 1); f.event(); await f.settle(); assert.equal(f.pending('/summary?').length, 0);
  const retry = f.state().refresh(); await f.settle(); f.respond('/summary?', f.summary(5)); await retry; await f.settle(); assert.equal(f.state().summary.orderCount, 5); f.dispose();
});
test('fulfillment preserves in-flight event, all-channel health, and the read projection never posts', async () => {
  const f = fixture('fulfillment'); f.render(); await f.settle(); f.respond('/fulfillment?', { selectedStoreId: storeA, tasks: [], ok: true }); f.respond('/realtime-config?', { key: 'fixture', cluster: 'fixture', channels: ['a', 'b'] }); await f.settle();
  // Initial refresh-key invalidation can legitimately request one trailing snapshot.
  if (f.pending('/fulfillment?').length) { f.respond('/fulfillment?', { selectedStoreId: storeA, tasks: [], ok: true }); await f.settle(); }
  f.subscribe('a'); await f.settle(); assert.equal(f.state().realtimeConnected, false); f.subscribe('b'); await f.settle(); assert.equal(f.state().realtimeConnected, true);
  f.event(); f.respond('/fulfillment?', { selectedStoreId: storeA, tasks: [], ok: true }); await f.settle(); assert.equal(f.pending('/fulfillment?').length, 1); f.respond('/fulfillment?', { selectedStoreId: storeA, tasks: [], ok: true }); await f.settle();
  assert(f.requests.every(r => !r.options.method || r.options.method === 'GET')); f.dispose();
});
test('HQ push during a read gets a trailing snapshot, keeps local delivery checking, and never marks read automatically', async () => {
  const f = fixture('hq'); await f.ready(); f.subscribe('hq'); await f.settle();
  f.event('hq-alert.updated'); f.respond('/hq-alerts?', { storeId: storeA, alerts: [], realtime: { key: 'fixture', cluster: 'fixture', channel: 'hq' } }); await f.settle(); assert.equal(f.pending('/hq-alerts?').length, 1);
  f.respond('/hq-alerts?', { storeId: storeA, alerts: [], realtime: { key: 'fixture', cluster: 'fixture', channel: 'hq' } }); await f.settle();
  await f.advance(59_999); assert.equal(f.pending('/hq-alerts?').length, 0); await f.advance(1); assert.equal(f.pending('/hq-alerts?').length, 1);
  assert(f.requests.every(r => !r.options.method || r.options.method === 'GET')); f.dispose();
});


test('POS summary hidden pages pause reads and one visible wake reconciles missing changes', async () => {
  const f = fixture(); await f.ready(); f.document.visibilityState = 'hidden'; f.wake(); await f.advance(600_000);
  assert.equal(f.pending('/summary?').length, 0);
  f.document.visibilityState = 'visible'; f.wake(); await f.advance(75); assert.equal(f.pending('/summary?').length, 1);
  f.respond('/summary?', f.summary(8)); await f.settle(); assert.equal(f.state().summary.orderCount, 8); f.dispose();
});
test('fulfillment and HQ auth denial dispose subscriptions and do not revive from queued events', async () => {
  for (const kind of ['fulfillment', 'hq']) {
    const f = fixture(kind); await f.ready();
    if (kind === 'fulfillment' && f.pending('/fulfillment?').length) { f.respond('/fulfillment?', { selectedStoreId: storeA, tasks: [], ok: true }); await f.settle(); }
    const path = kind === 'hq' ? '/hq-alerts?' : '/fulfillment?';
    f.event(kind === 'hq' ? 'hq-alert.updated' : 'order.created'); await f.settle(); f.respond(path, { error: 'Unauthorized' }, 401); await f.settle();
    assert(f.disconnects() >= 1); const count = f.requests.length; f.event(kind === 'hq' ? 'hq-alert.updated' : 'order.created'); f.wake(); await f.advance(180_000); assert.equal(f.requests.length, count); f.dispose();
  }
});

test('explicit channel authorization denial stops summary, fulfillment and HQ reads before another HTTP response', async () => {
  for (const kind of ['summary', 'fulfillment', 'hq']) {
    const f = fixture(kind); await f.ready();
    if (kind === 'fulfillment' && f.pending('/fulfillment?').length) { f.respond('/fulfillment?', { selectedStoreId: storeA, tasks: [], ok: true }); await f.settle(); }
    f.subscriptionError(kind === 'hq' ? 'hq' : 'a', 403); await f.settle();
    if (kind === 'summary') assert.equal(f.state().summary.orderCount, 0);
    if (kind === 'fulfillment') assert.equal(f.state().realtimeConnected, false);
    assert(f.disconnects() >= 1); const count = f.requests.length; f.event(kind === 'hq' ? 'hq-alert.updated' : 'order.created'); f.wake(); await f.advance(900_000); assert.equal(f.requests.length, count); f.dispose();
  }
});
