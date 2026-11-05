// Executes the real live-display and scanner routes against isolated PostgreSQL.
// Authentication and realtime delivery are injected; no production data or device is contacted.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { createPrintDocumentFixture } from './pos-print-document-fixture.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, i, values) => { if (value.startsWith('--')) all.push([value.slice(2), values[i + 1]]); return all; }, []));
const source = resolve(args.source || process.cwd()), output = resolve(args.output || 'outputs/pos-customer-weighing-api');
await mkdir(output, { recursive: true });
const f = await createPrintDocumentFixture(source), { db, ids, state, sql } = f;
const validSession = state.session, events = [], checks = [], queries = [];
let realtimeFails = false;
f.modules['order-realtime'].publishPosCustomerDisplayEvent = async (storeId, value) => { if (realtimeFails) throw new Error('Realtime unavailable'); events.push({ storeId, state: JSON.parse(JSON.stringify(value)) }); };
const route = f.load('app/api/store/pos/customer-display/route.ts');
const scanner = f.load('app/api/store/pos/customer-display/member-scan/route.ts');
const policy = f.load('lib/pos-customer-display.ts');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const post = body => route.POST(f.request('/api/store/pos/customer-display', { storeId: ids.store, ...body }));
const get = (storeId = ids.store, debug = false) => route.GET(f.request(`/api/store/pos/customer-display?storeId=${storeId}${debug ? '&debug=1' : ''}`));
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
async function check(name, fn) { try { await fn(); checks.push({ name, passed: true }); console.log('PASS ' + name); } catch (error) { checks.push({ name, passed: false, error: error.stack }); console.log('FAIL ' + name + ': ' + error.message); } }
const preview = patch => ({ previewId: uuid(801), itemId: ids.menu, itemName: '量り売り麻辣湯', optionLabel: '牛筋 50g +¥500', source: 'manual', status: 'manual', quantity: 220, unit: 'g', unitPrice: 4, optionsAmount: 500, amount: 1380, priceTaxMode: 'tax_included', ...patch });
const display = patch => ({ status: 'review', subtotal: 400, items: [{ name: 'お茶', quantity: 1, unitPrice: 400, amount: 400 }], preferredLanguage: 'ja', memberDisplayName: '会員', discountAmount: 0, weighing: preview(), ...patch });
const stored = async () => (await db.query('select display_state from pos_customer_display_states where store_id=$1', [ids.store])).rows[0]?.display_state;
const claim = async owner => json(await post({ action: 'claim', expectedRevision: (await json(await get())).state.revision, ...(owner ? { owner } : {}) }));
let streamId, sequence = 0, owner;
const send = (value = display(), patch = {}) => post({ streamId, sequence: ++sequence, state: value, ...(owner ? { owner } : {}), ...patch });
async function snapshotExceptDisplay() { const tables = (await db.query("select tablename from pg_tables where schemaname='public' and tablename<>'pos_customer_display_states' order by tablename")).rows; return Object.fromEntries(await Promise.all(tables.map(async ({ tablename }) => [tablename, (await db.query(`select to_jsonb(t) as row from "${tablename}" t order by to_jsonb(t)::text`)).rows]))); }
try {
  await db.exec("create table pos_customer_display_states(store_id uuid primary key,display_state jsonb not null default '{}'::jsonb,updated_by uuid,updated_at timestamptz default now()); create table store_relay_scale_captures(id uuid primary key,station_id uuid,session_id uuid,epoch integer,employee_id uuid,grams numeric,reading jsonb,received_at timestamptz,order_id uuid)");
  const baseline = await snapshotExceptDisplay();
  const query = db.query.bind(db), transaction = sql.transaction.bind(sql);
  db.query = async (text, values, ...rest) => { queries.push(text); return query(text, values, ...rest); };
  sql.transaction = async statements => { queries.push(...statements.map(statement => statement.text)); return transaction(statements); };
  await check('authentication, scope, origin and malformed input reject without persistence', async () => {
    state.session = null; await json(await post({ action: 'claim', expectedRevision: 0 }), 401); await json(await get(), 401); state.session = validSession;
    await json(await post({ storeId: ids.other, action: 'claim', expectedRevision: 0 }), 403);
    await json(await get(ids.other), 403);
    await json(await route.POST(f.request('/api/store/pos/customer-display', { storeId: ids.store, action: 'claim', expectedRevision: 0 }, { origin: 'https://foreign.test' })), 403);
    for (const invalid of ['{', 'null', '[]', '7']) await json(await route.POST(new Request('http://isolated.test/api/store/pos/customer-display', { method: 'POST', headers: { origin: 'http://isolated.test' }, body: invalid })), 400);
    assert.equal(await stored(), undefined);
  });
  await check('legacy state works before claim; claim preserves cart and creates server ordered stream', async () => {
    const old = await json(await post({ state: display({ weighing: null }) })); assert.equal(old.state.subtotal, 400);
    const claimed = await claim(); streamId = claimed.streamId; assert.match(streamId, /^[0-9a-f-]{36}$/); assert.equal(claimed.state.subtotal, 400); assert.equal(claimed.state.weighing, null);
    await json(await post({ state: display() }), 409);
  });
  await check('manual accepted preview uses the POS snapshot and never enters cart totals', async () => {
    const result = await json(await send(display({ weighing: preview({ amount: 9999, quantity: 220.1234 }) })));
    assert.equal(result.state.weighing.quantity, 220.123); assert.equal(result.state.weighing.amount, 1380); assert.equal(result.state.subtotal, 400); assert.equal(result.state.items.length, 1);
    assert.equal(Date.parse(result.state.weighing.expiresAt) - Date.parse(result.state.weighing.receivedAt), 8000);
    assert.ok(!JSON.stringify(result.state).includes('_displayWriter'));
  });
  await check('product selection has a waiting preview with no fabricated zero-weight price', async () => {
    const result = await json(await send(display({ weighing: preview({ source: 'waiting', status: 'waiting', quantity: null, amount: null }) })));
    assert.equal(result.state.weighing.quantity, null); assert.equal(result.state.weighing.amount, null); assert.equal(result.state.weighing.optionsAmount, 500);
  });
  await check('invalid numeric, status and identity preview payloads are rejected without changing state', async () => {
    const before = await stored();
    for (const patch of [{ quantity: 0 }, { quantity: -3 }, { quantity: '220' }, { unitPrice: -1 }, { unitPrice: '4' }, { previewId: 'bad' }, { itemId: '' }, { source: 'relay' }, { status: 'stable' }, { optionsAmount: 1.1 }, { source: 'waiting' }]) await json(await send(display({ weighing: preview(patch) })), 400);
    assert.deepEqual(await stored(), before);
  });
  await check('Add atomically clears preview; old and duplicate packets cannot bring it back', async () => {
    const oldSequence = sequence + 1; await json(await send());
    const added = display({ weighing: null, subtotal: 1780, items: [...display().items, { name: '量り売り麻辣湯', quantity: 1, unitPrice: 1380, amount: 1380 }] });
    const result = await json(await send(added)); assert.equal(result.state.weighing, null); assert.equal(result.state.items.length, 2);
    const revision = result.state.revision;
    const stale = await json(await send(display(), { sequence: oldSequence })); assert.equal(stale.ignored, true); assert.equal(stale.state.weighing, null); assert.equal(stale.state.revision, revision);
    const duplicate = await json(await send(display(), { sequence: oldSequence })); assert.equal(duplicate.ignored, true);
  });
  await check('concurrent Add and older preview resolve by sequence in both arrival orders', async () => {
    const lower = sequence + 1, higher = sequence + 2; sequence = higher;
    await Promise.all([json(await post({ streamId, sequence: higher, state: display({ weighing: null }) })), json(await post({ streamId, sequence: lower, state: display() }))]);
    assert.equal((await stored()).weighing, null);
    const a = sequence + 1, b = sequence + 2; sequence = b;
    const responses = await Promise.all([post({ streamId, sequence: a, state: display() }), post({ streamId, sequence: b, state: display({ weighing: null }) })]);
    await Promise.all(responses.map(response => json(response))); assert.equal((await stored()).weighing, null);
  });
  await check('same revision simultaneous claims have one winner and superseded stream cannot publish', async () => {
    const expectedRevision = (await json(await get())).state.revision;
    const responses = await Promise.all([post({ action: 'claim', expectedRevision }), post({ action: 'claim', expectedRevision })]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const winner = await responses.find(response => response.status === 200).json();
    await json(await send(), 409); streamId = winner.streamId; sequence = 0;
    await json(await send());
  });
  await check('new claims fence old sessions and GET expires preview without writing data', async () => {
    const before = await stored();
    const stale = { ...before.weighing, receivedAt: new Date(Date.now() - 10000).toISOString(), expiresAt: new Date(Date.now() - 2000).toISOString() };
    await db.query("update pos_customer_display_states set display_state=jsonb_set(display_state,'{weighing}',$2::jsonb) where store_id=$1", [ids.store, JSON.stringify(stale)]);
    const saved = await stored(); const response = await json(await get()); assert.equal(response.state.weighing, null); assert.deepEqual(await stored(), saved);
    assert.equal(policy.readCustomerDisplayWeighing(stale), null);
    assert.equal(policy.readCustomerDisplayWeighing({ ...before.weighing, expiresAt: new Date(Date.now() + 60000).toISOString() }), null);
  });
  await check('realtime failure still persists authoritative preview for polling recovery', async () => {
    realtimeFails = true; const result = await json(await send()); realtimeFails = false;
    assert.equal(result.state.weighing.quantity, 220); assert.equal((await json(await get())).state.weighing.quantity, 220);
  });
  await check('debug display reads no ordinary draft or business display state', async () => {
    const previousQueries = queries.length; const result = await json(await get(ids.store, true));
    assert.equal(result.debugMode, true); assert.equal(result.state.weighing, null); assert.equal(result.state.items.length, 0);
    assert.ok(!queries.slice(previousQueries).some(text => /from\s+pos_customer_display_states/i.test(text)));
  });
  await check('manual previews and claims change only the display table', async () => { assert.deepEqual(await snapshotExceptDisplay(), baseline); });

  const ownerToken = 'owner-token-isolated'; const hash = f.load('lib/store-relay.ts').relayHash(ownerToken);
  owner = { stationId: ids.station, token: ownerToken, epoch: 2 };
  await db.query('insert into store_relay_stations(id,store_id,name,enabled,scale_enabled,print_enabled,epoch,owner_hash,owner_employee_id,owner_session_id,owner_until) values($1,$2,\'レジ A\',true,true,true,2,$3,$4,$5,now()+interval \'5 minutes\')', [ids.station, ids.store, hash, ids.employee, validSession.sessionId]);
  await db.query("insert into store_relay_scale_captures values($1,$2,$3,2,$4,220,'{}',now(),null)", [uuid(900), ids.station, uuid(901), ids.employee]);
  const relayBaseline = await snapshotExceptDisplay();
  await check('configured relay requires the current owner on claim and every whole-state post', async () => {
    await json(await post({ action: 'claim', expectedRevision: (await json(await get())).state.revision }), 409);
    await json(await post({ action: 'claim', expectedRevision: (await json(await get())).state.revision, owner: { ...owner, token: 'wrong' } }), 409);
    const result = await claim(owner); streamId = result.streamId; sequence = 0;
    await json(await send(display(), { owner: undefined }), 409);
    await json(await send());
  });
  await check('automatic accepted capture validates actor/epoch/quantity without redoing scale settling', async () => {
    const capture = preview({ source: 'capture', status: 'stable', captureId: uuid(900), grossGrams: 270, tareGrams: 50, tarePresetId: 'small' });
    const result = await json(await send(display({ weighing: capture }))); assert.equal(result.state.weighing.quantity, 220); assert.equal(result.state.weighing.tareGrams, 50);
    const mismatch = await json(await send(display({ weighing: { ...capture, quantity: 221 } }))); assert.equal(mismatch.state.weighing.status, 'waiting'); assert.equal(mismatch.state.weighing.amount, null);
    const unknown = await json(await send(display({ weighing: { ...capture, captureId: uuid(902) } }))); assert.equal(unknown.state.weighing.quantity, null);
    const kg = await json(await send(display({ weighing: { ...capture, quantity: 0.22, unit: 'kg', unitPrice: 4000 } }))); assert.equal(kg.state.weighing.amount, 1380);
  });
  await check('clear on Add remains final after a captured bowl is consumed by checkout', async () => {
    const old = sequence; await json(await send(display({ weighing: null })));
    await db.query('update store_relay_scale_captures set order_id=$1 where id=$2', [uuid(990), uuid(900)]);
    const result = await json(await send(display({ weighing: preview({ source: 'capture', status: 'stable', captureId: uuid(900) }) }), { sequence: old })); assert.equal(result.ignored, true); assert.equal(result.state.weighing, null);
    const consumed = await json(await send(display({ weighing: preview({ source: 'capture', status: 'stable', captureId: uuid(900) }) }))); assert.equal(consumed.state.weighing.status, 'waiting'); assert.equal(consumed.state.weighing.quantity, null); assert.equal(consumed.state.weighing.amount, null);
    const complete = await json(await send(display({ weighing: null, status: 'completed', subtotal: 1380 }))); assert.equal(complete.state.status, 'completed'); assert.equal(complete.state.weighing, null);
    await db.query('update store_relay_scale_captures set order_id=null where id=$1', [uuid(900)]);
  });
  await check('takeover immediately hides old accepted draft and rejects the former operator', async () => {
    await json(await send());
    await db.query('update store_relay_stations set epoch=3,owner_hash=$2 where id=$1', [ids.station, f.load('lib/store-relay.ts').relayHash('next-token')]);
    assert.equal((await json(await get())).state.weighing, null); await json(await send(), 409);
    owner = { ...owner, epoch: 3, token: 'next-token' }; const result = await claim(owner); streamId = result.streamId; sequence = 0; await json(await send());
  });
  await check('scanner atomic patches preserve the latest cart and sequence and cannot revive a cleared preview', async () => {
    const before = await stored();
    // Force a concurrent display update in the former vulnerable read/write window.
    const queryBeforeRace = db.query.bind(db); let intercepted = false;
    db.query = async (text, values, ...rest) => {
      if (!intercepted && /insert into pos_customer_display_states/i.test(text)) {
        intercepted = true; await json(await send(display({ weighing: null, subtotal: 444 })));
      }
      return queryBeforeRace(text, values, ...rest);
    };
    const response = await scanner.POST(f.request('/api/store/pos/customer-display/member-scan', { storeId: ids.store, code: 'test-member-qr' }));
    await json(response); db.query = queryBeforeRace;
    assert.equal(events.at(-1).state.memberScanRequest.code, 'test-member-qr'); assert.ok(events.at(-1).state.serverNow); assert.ok(events.at(-1).state.revision);
    const current = await stored(); assert.equal(current.subtotal, 444); assert.equal(current.weighing, null); assert.ok(current._displayWriter.sequence > before._displayWriter.sequence); assert.ok(current.revision > before.revision + 1); assert.equal(current.memberScanRequest.code, 'test-member-qr');
    await json(await send(display({ weighing: null }))); assert.equal((await stored()).memberScanRequest.code, 'test-member-qr');
  });
  await check('only display state is mutated by the routes, without schema, orders or money side effects', async () => {
    const routeMutations = queries.filter(text => /^\s*(insert|update|delete|create|alter|drop)\b/i.test(text));
    const excluded = /^(?:update store_relay_|insert into store_relay_|update pos_customer_display_states set display_state=jsonb_set)/i;
    assert.ok(routeMutations.filter(text => !excluded.test(text)).every(text => /^\s*(?:insert\s+into|update)\s+pos_customer_display_states\b/i.test(text)), routeMutations.join('\n'));
    const after = await snapshotExceptDisplay();
    for (const key of Object.keys(relayBaseline)) if (key !== 'store_relay_stations') assert.deepEqual(after[key], relayBaseline[key], key);
  });
  const files = ['lib/pos-customer-display.ts', 'lib/pos-customer-display-server.ts', 'app/api/store/pos/customer-display/route.ts', 'app/api/store/pos/customer-display/member-scan/route.ts', 'scripts/tests/pos-customer-weighing-api.mjs'];
  const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(join(source, file))).digest('hex')])));
  const failed = checks.filter(check => !check.passed);
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, checks, hashes, actualHandlers: true, isolatedDatabase: 'PGlite', liveWrites: 0, events: events.length, errors: state.errors }, null, 2));
  assert.equal(failed.length, 0, failed.map(check => check.name).join(', '));
  console.log(JSON.stringify({ passed: checks.length, output }));
} finally { await db.close(); }
