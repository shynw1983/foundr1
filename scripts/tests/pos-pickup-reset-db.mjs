// Actual opening/checkout handlers and numbering SQL in isolated PostgreSQL only.
// No DATABASE_URL, production HTTP, browser, printer, or native device access.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDineInMenuFixture } from './store-dine-in-menu-fixture.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => {
  if (value.startsWith('--')) out.push([value.slice(2), all[index + 1]]);
  return out;
}, []));
const source = resolve(args.source || process.cwd());
const output = resolve(args.output || join(source, '../evidence/pickup-reset-db'));
await mkdir(output, { recursive: true });
async function sources(directory) {
  const found = [];
  for (const entry of await readdir(join(source, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = directory + '/' + entry.name;
    if (entry.isDirectory()) found.push(...await sources(path));
    else if (/\.(?:tsx?|jsx?|css|json|sql)$/.test(path)) found.push(path);
  }
  return found;
}
const inputFiles = [...await sources('app'), ...await sources('lib'), ...await sources('db'),
  'package.json', 'package-lock.json', 'scripts/tests/pos-pickup-reset-db.mjs',
  'scripts/tests/pos-print-document-fixture.mjs', 'scripts/tests/store-dine-in-menu-fixture.mjs', 'scripts/tests/pos-bowl-flow-db.mjs',
  'scripts/tests/pos-cash-open-api.mjs'].sort();
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHashes = async () => Object.fromEntries(await Promise.all(inputFiles.map(async path => [path, hash(await readFile(join(source, path)))])));
const inputHashes = await sourceHashes();
await writeFile(join(output, 'input-hashes.json'), JSON.stringify({ source, inputHashes }, null, 2) + '\n');
const f = await createDineInMenuFixture(source);
await f.installMigration();
const { db, ids, state, modules, sql } = f;
const clone = value => JSON.parse(JSON.stringify(value));
const results = [];
const trace = [];
const expectedInjectedErrors = [];
let businessAt = '2026-10-25T03:00:00.000Z';
let events = 0;
let rejectOpenTransaction = false;
let beforeCheckoutCommit = null;
let openingRace = null;
const originalTransaction = sql.transaction;
sql.transaction = async statements => {
  const text = statements.map(statement => statement.text).join('\n');
  trace.push(text);
  if (beforeCheckoutCommit && /insert\s+into\s+store_customer_orders/i.test(text)) {
    const hook = beforeCheckoutCommit;
    beforeCheckoutCommit = null;
    await hook();
  }
  if (openingRace && /insert\s+into\s+pos_cash_sessions/i.test(text)) {
    const race = openingRace;
    const position = ++race.calls;
    if (position === 1) {
      await race.bothArrived;
      try {
        const result = await originalTransaction(statements);
        const active = (await db.query("select id::text from pos_cash_sessions where store_id=$1 and status='open'", [ids.store])).rows[0];
        race.winnerCodes = await allocate(active.id);
        return result;
      } finally { race.releaseSecond(); }
    }
    race.arrived();
    await race.firstAllocated;
  }
  if (rejectOpenTransaction && /insert\s+into\s+pos_cash_sessions/i.test(text)) {
    rejectOpenTransaction = false;
    return originalTransaction([...statements, sql`select 1 / 0 as fixture_after_open_failure`]);
  }
  return originalTransaction(statements);
};
const scope = modules['store-order-access'];
let allowedStores = [ids.store];
scope.getStoreOrderAccess = async () => ({ stores: allowedStores.map(id => ({ id, name: id === ids.store ? '桜並木 isolated' : 'Other isolated' })), canCancelOrders: true });
scope.getScopedStoreFilter = (_access, id) => !id ? allowedStores[0] : allowedStores.includes(id) ? id : '__forbidden__';
modules['order-realtime'].publishStoreOperationalEvent = async () => { events++; };
const businessHours = f.load('lib/store-business-hours.ts');
modules['store-business-hours'] = { ...businessHours,
  getStoreCashBusinessDayState: value => businessHours.getStoreCashBusinessDayState(value, new Date(businessAt)) };
const pos = f.reload('app/api/store/pos/route.ts');
const reconciliation = f.load('app/api/store/pos/reconciliation/route.ts');
const bowl = f.load('lib/pos-bowl-data.ts');
const production = f.load('lib/order-production.ts');
const json = async (response, expected = 200) => {
  response = await response;
  assert.equal(response.status, expected, (await response.clone().text()).slice(0, 1800));
  return response.json();
};
const record = (name, detail = {}) => { results.push({ name, passed: true, ...detail }); console.log('PASS ' + name); };
const readCash = (storeId = ids.store) => json(reconciliation.GET(f.request('/api/store/pos/reconciliation?storeId=' + storeId)));
const postCash = patch => reconciliation.POST(f.request('/api/store/pos/reconciliation', { action: 'open', storeId: ids.store, openingAmount: 10000, note: '開店確認', ...patch }));
const counter = async (storeId = ids.store) => (await db.query('select last_number::text as n from pos_pickup_counters where store_id=$1', [storeId])).rows[0]?.n ?? null;
const rows = async table => (await db.query('select to_jsonb(t) as row from ' + table + ' t order by id')).rows.map(row => row.row);
const docs = async orderId => (await db.query('select to_jsonb(d) as row from pos_print_documents d where order_id=$1 order by id', [orderId])).rows.map(row => row.row);
const business = async () => ({ sessions: await rows('pos_cash_sessions'), counters: (await db.query('select to_jsonb(c) as row from pos_pickup_counters c order by store_id')).rows.map(row => row.row), orders: await rows('store_customer_orders'), items: await rows('store_customer_order_items'), tasks: await rows('order_production_tasks'), documents: await rows('pos_print_documents'), operations: await rows('pos_print_document_operations'), movements: await rows('pos_cash_movements') });
// Existing duplicate recovery refreshes production-task updated_at via its normal
// idempotent synchronization hook. Financial content, identities and snapshots stay exact.
const retryFacts = value => ({ ...value, tasks: value.tasks.map(({ updated_at, ...task }) => task) });
const allocate = (sessionId, count = 1, storeId = ids.store) => bowl.allocatePosBowlCodes(storeId, count, sessionId);
let requestNumber = 250000;
async function checkout(patch = {}) {
  const current = await json(pos.GET(f.request('/api/store/pos?storeId=' + (patch.storeId || ids.store))));
  return pos.POST(f.request('/api/store/pos', { ...f.baseBody, discountPresetKey: '',
    offlineClientOrderId: fUuid(requestNumber++), posMenuRevision: current.posMenuRevision,
    dineInMenuRevision: current.dineInMenuRevision, ...patch }));
}
function fUuid(n) { return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`; }
async function complete(sale) {
  for (const ticket of sale.servingTickets) {
    await production.setProductionTaskStatus(ticket.taskId, 'ready', ids.employee);
    await bowl.handoffPosBowl(ticket.taskId, ids.store);
  }
}
async function close(storeId = ids.store) {
  const active = (await readCash(storeId)).activeSession;
  assert.ok(active);
  return json(postCash({ action: 'close', storeId, countedCashAmount: active.expectedCashAmount,
    closingResponsibleEmployeeId: ids.employee, note: '閉店確認' }));
}
async function noWrite(request, expected) {
  const before = clone(await business()), beforeEvents = events;
  const response = await json(request(), expected);
  assert.deepEqual(await business(), before);
  assert.equal(events, beforeEvents);
  return response;
}
try {
  // Use the schema's deployed uniqueness rule; the shared fixture omits indexes.
  const schema = await readFile(join(source, 'db/schema.sql'), 'utf8');
  const oneOpen = schema.match(/create unique index if not exists idx_pos_cash_sessions_one_open_per_store[\s\S]*?;/)?.[0];
  assert.ok(oneOpen);
  await db.exec(oneOpen);
  await db.query("insert into employee_scopes(employee_id,scope_type,store_id) values($1,'store',$2),($1,'store',$3)", [ids.employee, ids.store, ids.other]);
  await db.query("update pos_cash_sessions set business_date='2026-10-24', status='closed', counted_cash_amount=10000, expected_cash_amount=10000, closed_by=$2,closed_at=now() where id=$1", [ids.register, ids.employee]);
  await db.query('insert into pos_pickup_counters(store_id,last_number) values($1,975),($2,87)', [ids.store, ids.other]);
  await db.query('insert into store_brands(store_id,brand_id,pos_pricing_mode) values($1,$2,\'fixed\')', [ids.other, ids.brand]);
  await db.query("update store_brands set pos_pricing_mode='fixed' where store_id=$1", [ids.store]);

  await noWrite(() => postCash({ openingAmount: 12000, note: '' }), 400);
  assert.equal(await counter(), '975');
  record('failed-opening-validation-preserves-last-number-and-all-business-records');

  rejectOpenTransaction = true;
  const rollbackBefore = clone(await business()), rollbackEvents = events;
  let rollbackError;
  try { const response = await postCash({}); assert.ok(response.status >= 400, await response.text()); }
  catch (error) { rollbackError = error; }
  assert.equal(rejectOpenTransaction, false, 'Injected error must run after actual opening/reset SQL inside one transaction');
  assert.deepEqual(await business(), rollbackBefore);
  assert.equal(events, rollbackEvents);
  expectedInjectedErrors.push(...state.errors.splice(0));
  record('opening-and-counter-reset-roll-back-together-when-final-transaction-statement-fails', { errorCode: rollbackError?.code || '' });

  const opened = await json(postCash({}));
  const firstSession = opened.activeSession.id;
  assert.notEqual(firstSession, ids.register);
  assert.equal(await counter(), '0');
  assert.deepEqual(await allocate(firstSession), ['001']);
  assert.equal(await counter(ids.other), '87');
  record('successful-opening-creates-new-session-and-first-allocation-is-001-only-for-selected-store');

  const persistedBeforeGet = clone(await business());
  for (let i = 0; i < 3; i++) assert.equal((await readCash()).activeSession.id, firstSession);
  businessAt = '2026-10-26T03:00:00.000Z';
  assert.equal((await readCash()).activeSession.id, firstSession);
  await json(pos.GET(f.request('/api/store/pos?storeId=' + ids.store)));
  assert.deepEqual(await business(), persistedBeforeGet);
  assert.deepEqual(await allocate(firstSession, 2), ['002', '003']);
  record('same-open-session-refresh-pos-get-and-calendar-day-change-never-reset-numbering');

  await noWrite(() => postCash({}), 400);
  assert.deepEqual(await allocate(firstSession), ['004']);
  record('duplicate-opening-cannot-reset-an-active-session-or-reuse-allocated-number');

  const sale = await json(checkout({ cashSessionId: firstSession, offlineClientOrderId: fUuid(250800) }));
  assert.deepEqual(sale.servingTickets.map(ticket => ticket.pickupCode), ['005']);
  const originalDocuments = clone(await docs(sale.orderId));
  assert.equal(originalDocuments.length, 4);
  const beforeRetry = clone(await business());
  const duplicate = await json(checkout({ cashSessionId: firstSession, offlineClientOrderId: fUuid(250800) }));
  assert.equal(duplicate.orderId, sale.orderId);
  assert.deepEqual(duplicate.servingTickets, sale.servingTickets);
  assert.deepEqual(retryFacts(await business()), retryFacts(beforeRetry));
  record('idempotent-online-checkout-retry-keeps-original-order-bowl-number-and-immutable-print-documents');
  const oldTicketRows = clone((await db.query('select to_jsonb(t) as row from order_production_tasks t where order_id=$1 order by id', [sale.orderId])).rows.map(row => row.row));

  const beforeCloseCounter = await counter();
  await close();
  assert.equal(await counter(), beforeCloseCounter);
  const closedBefore = clone(await business());
  await assert.rejects(() => allocate(firstSession), /レジ|営業|会計|session/i);
  assert.deepEqual(await business(), closedBefore);
  const next = await json(postCash({}));
  const nextSession = next.activeSession.id;
  assert.notEqual(nextSession, firstSession);
  assert.equal(await counter(), '0');
  assert.deepEqual(await allocate(nextSession, 6), ['001', '002', '003', '004', '006', '007']);
  assert.deepEqual(await docs(sale.orderId), originalDocuments);
  assert.deepEqual((await db.query('select to_jsonb(t) as row from order_production_tasks t where order_id=$1 order by id', [sale.orderId])).rows.map(row => row.row), oldTicketRows);
  record('new-session-resets-but-skips-outstanding-005-without-changing-old-task-or-print-snapshot');

  const mismatchBefore = clone(await business());
  await assert.rejects(() => allocate(firstSession), /レジ|営業|会計|session/i);
  await assert.rejects(() => allocate(fUuid(259999)), /レジ|営業|会計|session/i);
  assert.deepEqual(await business(), mismatchBefore);
  record('closed-and-foreign-session-allocation-is-rejected-without-counter-or-order-writes');

  const legacyId = fUuid(250810);
  await db.query(`insert into store_customer_orders(id,store_id,brand_id,order_source,pickup_code,status,payment_status,pickup_date,pickup_time)
    values($1,$2,$3,'maamaa_web','010','ready','paid',current_date,'12:00')`, [legacyId, ids.store, ids.brand]);
  await db.query("insert into store_customer_order_items(order_id,menu_catalog_item_id,item_name,quantity) values($1,$2,'旧予約',1)", [legacyId, ids.menu]);
  await db.query(`insert into order_production_tasks(order_id,store_id,brand_id,production_area,production_area_label,status)
    values($1,$2,$3,'general','旧予約','ready')`, [legacyId, ids.store, ids.brand]);
  const legacyBefore = clone((await db.query('select to_jsonb(o) as row from store_customer_orders o where id=$1', [legacyId])).rows[0].row);
  const concurrent = await Promise.all([allocate(nextSession, 2), allocate(nextSession, 3)]);
  const concurrentCodes = concurrent.flat();
  assert.equal(concurrentCodes.length, 5);
  assert.equal(new Set(concurrentCodes).size, 5);
  assert.deepEqual([...concurrentCodes].sort(), ['008','009','011','012','013']);
  assert.deepEqual((await db.query('select to_jsonb(o) as row from store_customer_orders o where id=$1', [legacyId])).rows[0].row, legacyBefore);
  record('concurrent-register-allocations-serialize-and-skip-unchanged-outstanding-legacy-order-code');

  const offlineKey = fUuid(250801), counterBeforeOffline = await counter();
  const offline = await json(checkout({ cashSessionId: nextSession, offlineClientOrderId: offlineKey,
    offlineQueued: true, offlinePickupCode: 'OABCDEF12' }));
  assert.deepEqual(offline.servingTickets.map(ticket => ticket.pickupCode), ['OABCDEF12-1']);
  assert.equal(await counter(), counterBeforeOffline);
  const offlineDocs = clone(await docs(offline.orderId)), beforeOfflineRetry = clone(await business());
  const offlineRetry = await json(checkout({ cashSessionId: nextSession, offlineClientOrderId: offlineKey,
    offlineQueued: true, offlinePickupCode: 'OABCDEF12' }));
  assert.equal(offlineRetry.orderId, offline.orderId);
  assert.deepEqual(offlineRetry.servingTickets, offline.servingTickets);
  assert.deepEqual(retryFacts(await business()), retryFacts(beforeOfflineRetry));
  record('genuine-offline-sync-and-retry-retain-already-issued-offline-number-without-counter-increment');

  const otherCounterBefore = await counter();
  allowedStores = [ids.store, ids.other];
  const otherOpen = await json(postCash({ storeId: ids.other }));
  assert.deepEqual(await allocate(otherOpen.activeSession.id, 2, ids.other), ['001', '002']);
  const foreignSessionBefore = clone(await business());
  await assert.rejects(() => allocate(otherOpen.activeSession.id), /レジ|営業|会計|session/i);
  assert.deepEqual(await business(), foreignSessionBefore);
  assert.equal(await counter(), otherCounterBefore);
  allowedStores = [ids.store];
  record('other-store-opening-and-allocation-use-independent-counter-and-session');

  await noWrite(() => postCash({ storeId: ids.other }), 403);
  await noWrite(() => reconciliation.GET(f.request('/api/store/pos/reconciliation?storeId=' + ids.other)), 403);
  await noWrite(() => pos.POST(f.request('/api/store/pos', { ...f.baseBody, storeId: ids.other })), 403);
  const authenticated = state.session;
  state.session = null;
  await noWrite(() => postCash({}), 401);
  await noWrite(() => reconciliation.GET(f.request('/api/store/pos/reconciliation?storeId=' + ids.store)), 401);
  await noWrite(() => pos.POST(f.request('/api/store/pos', f.baseBody)), 401);
  state.session = authenticated;
  record('unauthenticated-and-out-of-scope-open-read-checkout-reject-with-zero-business-writes');

  // Cross the close/open boundary after checkout has observed its cash session,
  // but before the actual order transaction executes its current-session guard.
  const beforeRaceCounts = await f.counts();
  beforeCheckoutCommit = async () => { await close(); await json(postCash({})); };
  const stale = await checkout({ cashSessionId: nextSession, offlineClientOrderId: fUuid(250802) });
  assert.equal(stale.status, 409, await stale.clone().text());
  assert.equal(beforeCheckoutCommit, null);
  assert.deepEqual(await f.counts(), beforeRaceCounts);
  assert.equal((await db.query('select count(*)::int as n from store_customer_orders where offline_client_order_id=$1', [fUuid(250802)])).rows[0].n, 0);
  assert.deepEqual(await docs(sale.orderId), originalDocuments);
  assert.deepEqual(await docs(offline.orderId), offlineDocs);
  record('checkout-close-open-race-returns409-without-paid-order-items-or-new-print-snapshots');

  // Another request commits this ID only after this request's early duplicate
  // lookup. Closing/reopening must recover that paid order instead of asking
  // staff to redo a sale that already succeeded.
  const sameId = fUuid(250803), sameIdBeforeCounts = await f.counts();
  let competingSale, competingDocuments;
  beforeCheckoutCommit = async () => {
    competingSale = await json(checkout({ offlineClientOrderId: sameId }));
    competingDocuments = clone(await docs(competingSale.orderId));
    await close();
    await json(postCash({}));
  };
  const racedDuplicate = await json(checkout({ offlineClientOrderId: sameId }));
  assert.equal(racedDuplicate.duplicate, true);
  assert.equal(racedDuplicate.orderId, competingSale.orderId);
  assert.deepEqual(racedDuplicate.servingTickets, competingSale.servingTickets);
  assert.deepEqual(await docs(competingSale.orderId), competingDocuments);
  const sameIdAfterCounts = await f.counts();
  assert.equal(sameIdAfterCounts.orders, sameIdBeforeCounts.orders + 1);
  assert.equal(sameIdAfterCounts.items, sameIdBeforeCounts.items + 1);
  assert.equal(sameIdAfterCounts.tasks, sameIdBeforeCounts.tasks + 1);
  assert.equal(sameIdAfterCounts.documents, sameIdBeforeCounts.documents + 4);
  assert.equal((await db.query('select count(*)::int as n from store_customer_orders where offline_client_order_id=$1', [sameId])).rows[0].n, 1);
  record('same-request-committed-after-early-lookup-recovers-original-sale-and-snapshots-across-close-open-race');

  // Finish the old bowl through actual production APIs before the next opening;
  // its old 005 can then safely be reused, while history remains immutable.
  await complete(sale);
  await complete(offline);
  await complete(competingSale);
  await close();
  const beforeConcurrentSessionCount = (await rows('pos_cash_sessions')).length;
  openingRace = { calls: 0, winnerCodes: null };
  openingRace.bothArrived = new Promise(done => { openingRace.arrived = done; });
  openingRace.firstAllocated = new Promise(done => { openingRace.releaseSecond = done; });
  const concurrentOpen = await Promise.all([postCash({}), postCash({})]);
  const finishedRace = openingRace;
  openingRace = null;
  const concurrentStatuses = concurrentOpen.map(response => response.status).sort();
  assert.deepEqual(concurrentStatuses, [200, 400]);
  const active = (await readCash()).activeSession;
  assert.equal((await rows('pos_cash_sessions')).length, beforeConcurrentSessionCount + 1);
  assert.equal(finishedRace.calls, 2);
  assert.deepEqual(finishedRace.winnerCodes, ['001']);
  assert.equal(await counter(), '1', 'Losing concurrent open must not reset a number already issued by the winner');
  assert.deepEqual(await allocate(active.id, 5), ['002','003','004','005','006']);
  assert.deepEqual(await docs(sale.orderId), originalDocuments);
  assert.deepEqual(await docs(offline.orderId), offlineDocs);
  record('concurrent-open-creates-one-session-once-and-reuses-only-fulfilled-historical-codes');

  // A late reply for an already committed sale remains recoverable after reset.
  const beforeLateRetry = clone(await business());
  const oldRetry = await json(checkout({ cashSessionId: firstSession, offlineClientOrderId: fUuid(250800) }));
  assert.equal(oldRetry.orderId, sale.orderId);
  assert.deepEqual(oldRetry.servingTickets.map(ticket => ticket.pickupCode), ['005']);
  const offlineLateRetry = await json(checkout({ cashSessionId: nextSession, offlineClientOrderId: offlineKey,
    offlineQueued: true, offlinePickupCode: 'OABCDEF12' }));
  assert.equal(offlineLateRetry.orderId, offline.orderId);
  assert.deepEqual(offlineLateRetry.servingTickets.map(ticket => ticket.pickupCode), ['OABCDEF12-1']);
  assert.deepEqual(retryFacts(await business()), retryFacts(beforeLateRetry));
  record('late-committed-online-and-offline-idempotent-retries-return-old-codes-after-later-opening');

  // Optional custom opening number changes only the newly opened session's
  // allocation point. Existing paid history and outstanding tickets stay intact.
  await close();
  const invalidOpeningNumbers = [null, '', '   ', 0, '0', -1, '-1', 1.5, '1.5', 1000, '1000', true, false, {}, [], ' 50 ', '1e2', '+1', '000'];
  for (const openingPickupNumber of invalidOpeningNumbers) {
    await noWrite(() => postCash({ openingPickupNumber }), 400);
  }
  record('explicit-invalid-opening-numbers-return400-without-session-counter-ticket-or-event-writes', { cases: invalidOpeningNumbers.length });

  const customOpened = await json(postCash({ openingPickupNumber: '050' }));
  const customSession = customOpened.activeSession.id;
  assert.equal(await counter(), '49');
  const customSale = await json(checkout({ offlineClientOrderId: fUuid(250820) }));
  assert.deepEqual(customSale.servingTickets.map(ticket => ticket.pickupCode), ['050']);
  assert.deepEqual(await allocate(customSession), ['051']);
  const customDocuments = clone(await docs(customSale.orderId));
  assert.equal(customDocuments.length, 4);
  const customTasks = clone((await db.query('select to_jsonb(t) as row from order_production_tasks t where order_id=$1 order by id', [customSale.orderId])).rows.map(row => row.row));
  record('string050-opening-atomically-seeds49-and-actual-checkout-issues050-followed-by051');

  await noWrite(() => postCash({ openingPickupNumber: 90 }), 400);
  assert.equal(await counter(), '51');
  record('duplicate-opening-with-a-different-custom-start-cannot-reset-active-session-number');

  await close();
  rejectOpenTransaction = true;
  const customRollbackBefore = clone(await business()), customRollbackEvents = events;
  try { const response = await postCash({ openingPickupNumber: 70 }); assert.ok(response.status >= 400, await response.text()); }
  catch (error) { assert.equal(error.code, '22012'); }
  assert.equal(rejectOpenTransaction, false);
  assert.deepEqual(await business(), customRollbackBefore);
  assert.equal(events, customRollbackEvents);
  expectedInjectedErrors.push(...state.errors.splice(0));
  record('custom-opening-session-and-start-minus-one-counter-roll-back-as-one-transaction');

  const collisionOpened = await json(postCash({ openingPickupNumber: 50 }));
  assert.equal(await counter(), '49');
  assert.deepEqual(await allocate(collisionOpened.activeSession.id, 2), ['051', '052']);
  assert.deepEqual(await docs(customSale.orderId), customDocuments);
  assert.deepEqual((await db.query('select to_jsonb(t) as row from order_production_tasks t where order_id=$1 order by id', [customSale.orderId])).rows.map(row => row.row), customTasks);
  assert.deepEqual(await docs(sale.orderId), originalDocuments);
  assert.deepEqual(await docs(offline.orderId), offlineDocs);
  record('numeric50-reopening-skips-still-outstanding050-without-rewriting-any-old-task-or-print-snapshot');

  const mainBeforeOtherOpening = clone(await business());
  allowedStores = [ids.store, ids.other];
  await close(ids.other);
  const boundaryOpened = await json(postCash({ storeId: ids.other, openingPickupNumber: 999 }));
  assert.equal(await counter(ids.other), '998');
  assert.deepEqual(await allocate(boundaryOpened.activeSession.id, 1, ids.other), ['999']);
  const mainAfterOtherOpening = await business();
  for (const key of ['sessions', 'counters']) {
    assert.deepEqual(mainAfterOtherOpening[key].filter(row => row.store_id === ids.store), mainBeforeOtherOpening[key].filter(row => row.store_id === ids.store));
  }
  for (const key of ['orders', 'items', 'tasks', 'documents', 'operations', 'movements']) {
    assert.deepEqual(mainAfterOtherOpening[key], mainBeforeOtherOpening[key]);
  }
  allowedStores = [ids.store];
  record('numeric999-upper-bound-is-valid-and-other-store-opening-never-changes-main-store-counter-or-history');

  const finalHashes = await sourceHashes();
  assert.deepEqual(finalHashes, inputHashes, 'Test source and runtime inputs must stay frozen throughout execution');
  assert.equal(state.externalCalls, 0);
  assert.deepEqual(state.errors, [], 'Only deliberately injected rollback failures may be logged');
  await writeFile(join(output, 'report.json'), JSON.stringify({ passed: results.length, results,
    source, sourceHashes: finalHashes, inputHashes, noSourceDrift: true,
    actualReconciliationApi: true, actualAllocationHelper: true, configurableOpeningPickupNumber: true, actualOsRoute: true,
    actualCheckout: true, actualPrintBuilder: true, immutablePrints: true,
    isolatedPostgreSQL: true, pgliteModule: f.pgliteModule, liveWrites: 0,
    hardwareOperations: 0, externalRequests: [], errors: state.errors, expectedInjectedErrors,
    transactionCount: trace.length, actualOneOpenIndex: oneOpen }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: results.length, output }));
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.stack, results, trace,
    capturedErrors: state.errors }, null, 2) + '\n');
  console.error(error.stack);
  throw error;
} finally {
  await db.close();
  await writeFile(join(output, 'cleanup-result.json'), JSON.stringify({ completed: true, isolatedPostgreSQLClosed: true }) + '\n');
}
