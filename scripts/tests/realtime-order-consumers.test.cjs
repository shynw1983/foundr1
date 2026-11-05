const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

function environment() {
  let now = 1_800_000_000_000, timerId = 0, cursor = 0, dirty = false, renderBody, tree;
  const timers = new Map(), slots = [], modules = new Map(), calls = [], announcements = [], prints = [];
  let printBridge = async () => ({ ok: true });
  const storage = new Map(), window = new EventTarget(), document = new EventTarget();
  const channels = new Map();
  function emitter() {
    const handlers = new Map();
    return { bind(event, fn) { const list = handlers.get(event) || []; list.push(fn); handlers.set(event, list); },
      unbind(event, fn) { handlers.set(event, (handlers.get(event) || []).filter(item => item !== fn)); },
      emit(event, ...args) { for (const fn of [...(handlers.get(event) || [])]) fn(...args); } };
  }
  const connection = { ...emitter(), state: 'connected' };
  let releases = 0;
  const pusher = { connection, subscribe(name) { if (!channels.has(name)) channels.set(name, { ...emitter(), subscribed: false, name }); return channels.get(name); },
    unsubscribe() {}, disconnect() { releases++; } };
  function setTimeoutFake(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + Math.max(0, ms || 0) }); return id; }
  function clearTimeoutFake(id) { timers.delete(id); }
  const setIntervalFake = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: now + ms, repeat: ms }); return id; };
  Object.assign(window, { setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake, setInterval: setIntervalFake, clearInterval: clearTimeoutFake,
    queueMicrotask, location: { search: '?storeId=store-a', pathname: '/store/display/pickup', href: 'https://example.test/store/display/pickup?storeId=store-a' },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, history: { replaceState() {} } });
  document.visibilityState = 'visible';
  const navigator = { onLine: true };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => { const value = typeof next === 'function' ? next(slots[index].value) : next; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { current: initial }; return slots[index]; },
    useCallback(fn, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: fn, deps }; return slots[index].value; },
    useMemo(fn, deps) { return react.useCallback(fn, deps)(); },
    useEffect(fn, deps) { const index = cursor++; const old = slots[index]; if (!old || !same(old.deps, deps)) slots[index] = { ...old, deps, effect: fn, pending: true }; }
  };
  let request = async url => {
    if (url.includes('realtime-config')) return Response.json({ key: 'key', cluster: 'jp', channels: ['private-store-orders-a', 'private-store-orders-b'] });
    return Response.json({ selectedStoreId: 'store-a', access: { stores: [{ id: 'store-a', name: 'A' }] }, preparing: [], ready: [] });
  };
  const fetchFake = async (url, options = {}) => { calls.push({ url: String(url), options, at: now }); return request(String(url), options); };
  const FakeDate = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  const context = vm.createContext({ console, Promise, Map, Set, Math: Object.assign(Object.create(Math), { random: () => 0 }), Date: FakeDate, Intl, URL, URLSearchParams, AbortController, DOMException, Response, Event, CustomEvent, window, document, navigator,
    fetch: fetchFake, setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake, setInterval: setIntervalFake, clearInterval: clearTimeoutFake });
  const displayMode = { activateDisplayMode() {}, fullscreenActive: false, wakeLockActive: false, wakeLockSupported: true };
  function load(filename) {
    filename = path.resolve(filename);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const requireFake = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === 'lucide-react') return new Proxy({}, { get: (_, name) => name });
      if (name.endsWith('.css')) return {};
      if (name.endsWith('pos-printer')) return { getKitchenPrinterForBrand: () => ({ host: 'printer' }), hasPosPrinterDestination: () => true, resolvePosKitchenTicketTemplate: () => ({}), printWithAndroidBridge: payload => { prints.push(payload); return printBridge(payload); } };
      if (name.endsWith('shared-pusher-client')) return { acquireSharedPusher: () => pusher };
      if (name.endsWith('store-business-hours')) return { getStoreCashBusinessDayState: () => ({ status: 'business_open' }) };
      if (name.endsWith('useDisplayMode')) return { useDisplayMode: () => displayMode };
      if (name.endsWith('store-selection')) return { getStoredStoreSelection: () => 'store-a', setStoredStoreSelection() {} };
      if (name.endsWith('ReadStatusNotice')) return { ReadStatusNotice: 'ReadStatusNotice' };
      if (name.endsWith('PickupBoard')) return { PickupBoard: 'PickupBoard' };
      if (name.endsWith('pickup-voice-client')) return { PickupVoicePlayer: class { prepare() { return Promise.resolve(); } stop() {} dispose() {} activate() {} enabled() {} announce(code) { announcements.push(code); } } };
      let target = path.resolve(path.dirname(filename), name);
      if (!path.extname(target)) target += fs.existsSync(target + '.ts') ? '.ts' : '.tsx';
      return load(target);
    };
    const fn = vm.runInContext('(function(require,module,exports){' + source + '\n})', context, { filename }); fn(requireFake, module, module.exports); return module.exports;
  }
  function render() { dirty = false; cursor = 0; tree = renderBody(); for (const slot of slots) if (slot?.pending) { slot.pending = false; slot.cleanup?.(); slot.cleanup = slot.effect(); } }
  async function flush() { for (let i = 0; i < 80; i++) { await Promise.resolve(); if (dirty && renderBody) render(); } }
  async function advance(ms) { const end = now + ms; await flush(); for (let i = 0; i < 300; i++) { const entry = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a,b) => a[1].at-b[1].at)[0]; if (!entry) break; const [id, timer] = entry; now = timer.at; timers.delete(id); if (timer.repeat) timers.set(id, { ...timer, at: now + timer.repeat }); timer.fn(); await flush(); } now = end; await flush(); }
  function find(type, value) { if (arguments.length === 1) value = tree; if (!value || typeof value !== 'object') return null; if (value.type === type) return value; for (const child of Object.values(value)) { if (Array.isArray(child)) { for (const item of child) { const hit = find(type, item); if (hit) return hit; } } else { const hit = find(type, child); if (hit) return hit; } } return null; }
  return { load, storage, prints, printer(fn) { printBridge = fn; window.Foundr1Printer = { print() {} }; }, mount(fn) { renderBody = fn; render(); }, unmount() { for (const slot of slots) slot?.cleanup?.(); renderBody = null; }, flush, advance, find, calls, announcements, channels, pusher, window, document, timers,
    request(fn) { request = fn; }, get releases() { return releases; }, readyAll() { for (const channel of channels.values()) { channel.subscribed = true; channel.emit('pusher:subscription_succeeded'); } },
    disconnect() { connection.state = 'disconnected'; for (const ch of channels.values()) ch.subscribed = false; connection.emit('state_change', { current: 'disconnected' }); },
    connect() { connection.state = 'connected'; connection.emit('state_change', { current: 'connected' }); } };
}
const snapshot = (ready = []) => Response.json({ selectedStoreId: 'store-a', access: { stores: [{ id: 'store-a', name: 'A' }] }, preparing: [], ready });
const config = () => Response.json({ key: 'key', cluster: 'jp', channels: ['private-store-orders-a', 'private-store-orders-b'] });
const reads = env => env.calls.filter(call => call.url.includes('/display/pickup?'));
async function pickup(env) { const Page = env.load(path.join(root, 'app/store/display/pickup/page.tsx')).default; env.mount(Page); await env.flush(); }

test('pickup requires every subscription and retains healthy missed-event reconciliation', async () => {
  const env = environment(); await pickup(env);
  assert.equal(reads(env).length, 1);
  const first = [...env.channels.values()][0]; first.subscribed = true; first.emit('pusher:subscription_succeeded'); await env.flush();
  await env.advance(30_100); assert.equal(reads(env).length, 2, 'partial health stays on fallback');
  env.readyAll(); await env.flush(); const healthy = reads(env).length;
  env.request(url => url.includes('realtime-config') ? config() : snapshot([{ pickupCode: '017', status: 'ready', orderType: 'dine_in', createdTime: '' }]));
  await env.advance(59_000); assert.equal(reads(env).length, healthy, 'healthy connection does not poll at 30 seconds');
  await env.advance(2_000); assert.equal(reads(env).length, healthy + 1);
  assert.equal(env.find('PickupBoard').props.ready[0].pickupCode, '017', 'lost push recovered by integrity read');
  env.unmount();
});

test('pickup rereads event received during HTTP; repeated reads do not repeat voice calls', async () => {
  const env = environment(); env.storage.set('store:pickup-display-voice-enabled', '1'); await pickup(env); env.readyAll(); await env.flush();
  let release; let pending = true;
  env.request(url => url.includes('realtime-config') ? config() : pending ? new Promise(resolve => { release = resolve; }) : snapshot([{ pickupCode: '018', status: 'ready', createdTime: '' }]));
  const channel = [...env.channels.values()][0]; channel.emit('order.updated', {}); await env.flush(); const before = reads(env).length;
  channel.emit('order.updated', {}); pending = false; release(snapshot()); await env.flush();
  assert.equal(reads(env).length, before + 1, 'in-flight event triggers trailing authoritative read');
  assert.equal(env.find('PickupBoard').props.ready[0].pickupCode, '018');
  channel.emit('order.updated', {}); await env.flush(); assert.deepEqual(env.announcements, ['018'], 'unchanged refresh must not repeat voice call');
  env.unmount();
});

test('pickup reconnect and visible/focus wake reconcile and coalesce; hidden view does not poll', async () => {
  const env = environment(); await pickup(env); env.readyAll(); await env.flush();
  env.disconnect(); await env.advance(30_100); const disconnected = reads(env).length;
  env.connect(); env.readyAll(); await env.flush(); assert.equal(reads(env).length, disconnected + 1, 'subscription recovery reads immediately');
  env.document.visibilityState = 'hidden'; env.document.dispatchEvent(new Event('visibilitychange')); await env.advance(10 * 60_000); const hiddenCount = reads(env).length;
  env.document.visibilityState = 'visible'; env.document.dispatchEvent(new Event('visibilitychange')); env.window.dispatchEvent(new Event('focus')); env.window.dispatchEvent(new Event('online'));
  await env.advance(100); assert.equal(reads(env).length, hiddenCount + 1, 'lifecycle burst uses one request'); env.unmount();
});

test('pickup 403 clears display and halts unauthorized retries', async () => {
  const env = environment(); env.request(url => url.includes('realtime-config') ? config() : snapshot([{ pickupCode: '019', status: 'ready' }]));
  await pickup(env); env.readyAll(); await env.flush(); assert.equal(env.find('PickupBoard').props.ready.length, 1);
  env.request(url => url.includes('realtime-config') ? config() : Response.json({ error: 'forbidden' }, { status: 403 }));
  [...env.channels.values()][0].emit('order.updated', {}); await env.flush();
  assert.equal(env.find('PickupBoard').props.ready.length, 0); const deniedCount = reads(env).length;
  await env.advance(10 * 60_000); assert.equal(reads(env).length, deniedCount, 'no hook private retry or coordinator retry after auth denial'); assert.ok(env.releases > 0); env.unmount();
});

test('useReadRequest propagates HTTP status and Retry-After without private retry', async () => {
  const env = environment(); const { useReadRequest, readJson } = env.load(path.join(root, 'components/useReadRequest.ts')); let reader;
  env.mount(() => { reader = useReadRequest(15_000, 0, true); return null; });
  env.request(() => Response.json({ error: 'slow' }, { status: 429, headers: { 'Retry-After': '90' } }));
  await assert.rejects(reader.run('a', signal => readJson('/a', signal), () => assert.fail('cannot apply failure')), error => error.status === 429 && error.retryAfterMs === 90_000);
  await env.advance(60_000); assert.equal(env.calls.length, 1); env.unmount();
});

test('useReadRequest abort and old-scope response cannot apply or start retries', async () => {
  const env = environment(); const { useReadRequest } = env.load(path.join(root, 'components/useReadRequest.ts')); let reader, finish, applied = [];
  env.mount(() => { reader = useReadRequest(15_000, 0, true); return null; });
  const external = new AbortController(); const old = reader.run('store-a', () => new Promise(resolve => { finish = resolve; }), body => applied.push(body), external.signal);
  external.abort(); await reader.run('store-b', async () => 'B', body => applied.push(body)); finish('A'); await old; assert.deepEqual(applied, ['B']); env.unmount();
});

function station(env, onRead) {
  let state = 'none';
  const transitions = [];
  const job = { taskId: 'task-1', brandId: 'brand', pickupCode: '001', storeName: 'Store', itemSummary: 'Bowl x1', note: '', createdTime: '' };
  env.request((url, options) => {
    if (url.includes('realtime-config')) return config();
    if (options.method === 'PATCH') {
      const body = JSON.parse(options.body); transitions.push(body.printStatus);
      if (body.printStatus === 'printing' && state !== 'pending') return Response.json({ ok: false }, { status: 409 });
      state = body.printStatus; return Response.json({ ok: true });
    }
    onRead?.(options);
    return Response.json({ selectedStoreId: 'store-a', printerSettings: { enabled: true, kitchenEnabled: true, kitchenPrinter: { host: 'printer' }, brandKitchenPrinters: [], kitchenCopies: 1 }, jobs: state === 'pending' ? [job] : [] });
  });
  const Component = env.load(path.join(root, 'app/store/components/StorePrintStation.tsx')).StorePrintStation; env.mount(Component);
  return { pending() { state = 'pending'; }, get state() { return state; }, transitions };
}

test('legacy native print station keeps healthy integrity claim/print/ACK without duplicate output', async () => {
  const env = environment(); env.printer(async () => ({ ok: true })); const ledger = station(env); await env.flush(); env.readyAll(); await env.flush();
  ledger.pending(); await env.advance(61_000); assert.equal(env.prints.length, 1); assert.deepEqual(ledger.transitions, ['printing', 'printed']);
  for (const channel of env.channels.values()) channel.emit('order.updated', {}); await env.flush(); await env.advance(65_000);
  assert.equal(env.prints.length, 1); env.unmount();
});

test('native physical print longer than read timeout is not aborted or claimed twice', async () => {
  const env = environment(); let finish; env.printer(() => new Promise(resolve => { finish = resolve; })); const ledger = station(env); await env.flush(); env.readyAll(); await env.flush();
  ledger.pending(); [...env.channels.values()][0].emit('order.created', {}); await env.flush(); await env.advance(35_000);
  assert.equal(env.prints.length, 1); assert.equal(ledger.state, 'printing');
  for (const channel of env.channels.values()) channel.emit('order.updated', {}); await env.flush(); assert.equal(env.prints.length, 1);
  finish({ ok: true }); await env.flush(); assert.equal(ledger.state, 'printed'); env.unmount();
});

test('unknown native print result preserves server claim; refresh cannot duplicate physical print', async () => {
  const env = environment(); env.printer(async () => { throw new Error('transport result unknown'); }); const ledger = station(env); await env.flush(); env.readyAll(); await env.flush();
  ledger.pending(); [...env.channels.values()][0].emit('order.created', {}); await env.flush();
  assert.equal(ledger.state, 'printing'); assert.deepEqual(ledger.transitions, ['printing']);
  await env.advance(5 * 60_000); for (const channel of env.channels.values()) channel.emit('order.updated', {}); await env.flush();
  assert.equal(env.prints.length, 1); assert.equal(ledger.state, 'printing'); env.unmount();
});

for (const status of [401, 403]) test(`subscription ${status} clears pickup immediately, aborts old read and stops without identity fallback`, async () => {
  const env = environment(); env.request(url => url.includes('realtime-config') ? config() : snapshot([{ pickupCode: '021', status: 'ready' }]));
  await pickup(env); env.readyAll(); await env.flush(); assert.equal(env.find('PickupBoard').props.ready.length, 1);
  let finish; env.request(() => new Promise(resolve => { finish = resolve; })); const channel = [...env.channels.values()][0];
  channel.emit('order.updated', {}); await env.flush(); const before = reads(env).length;
  channel.emit('pusher:subscription_error', { type: 'AuthError', status }); await env.flush();
  assert.equal(env.find('PickupBoard').props.ready.length, 0);
  assert.equal(env.find('ReadStatusNotice').props.state.failureStatus, status);
  finish(snapshot([{ pickupCode: 'OLD', status: 'ready' }])); await env.flush();
  assert.equal(env.find('PickupBoard').props.ready.length, 0, 'denied in-flight response cannot restore sensitive state');
  for (const item of env.channels.values()) item.emit('order.updated', {});
  await env.advance(10 * 60_000); assert.equal(reads(env).length, before); assert.ok(env.releases > 0); env.unmount();
});

test('useReadRequest exposes failure status for auth pause and clears it on success/cancel', async () => {
  const env = environment(); const { useReadRequest, readJson } = env.load(path.join(root, 'components/useReadRequest.ts')); let reader;
  env.mount(() => { reader = useReadRequest(15_000, 0, true); return null; });
  env.request(() => Response.json({}, { status: 403 }));
  await assert.rejects(reader.run('a', signal => readJson('/a', signal), () => {})); await env.flush();
  assert.equal(reader.failureStatus, 403); assert.equal(reader.failed, true);
  env.request(() => Response.json({ ok: true })); await reader.run('a', signal => readJson('/a', signal), () => {}); await env.flush(); assert.equal(reader.failureStatus, undefined);
  reader.reportFailure(401); await env.flush(); assert.equal(reader.failureStatus, 401); reader.cancel(); await env.flush(); assert.equal(reader.failureStatus, undefined); env.unmount();
});
