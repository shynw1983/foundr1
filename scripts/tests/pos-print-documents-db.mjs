// Actual checkout, document ledger, and refund handlers against fresh in-memory
// PostgreSQL. No production DB, network, hardware, or real financial actions.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createPrintDocumentFixture } from './pos-print-document-fixture.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, values) => { if (value.startsWith('--')) pairs.push([value.slice(2), values[i + 1]]); return pairs; }, []));
const source = resolve(args.source || process.cwd()), output = resolve(args.output || 'outputs/pos-print-documents-db');
await mkdir(output, { recursive: true });
const f = await createPrintDocumentFixture(source);
const { db, ids, state, postCheckout, getQueue, mutate, refund, counts, request, load } = f;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let nextId = 200, nextOperation = 1000;
const operation = () => uuid(nextOperation++);
const groups = [];
async function json(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
async function sale(patch = {}) { return json(await postCheckout({ offlineClientOrderId: uuid(nextId++), ...patch })); }
const orderDocs = async orderId => (await db.query('select * from pos_print_documents where order_id=$1 order by sequence', [orderId])).rows;
const current = async id => (await db.query('select * from pos_print_documents where id=$1', [id])).rows[0];
async function claim(document, patch = {}) { return mutate({ action: 'claim', documentId: document.id, operationId: operation(), expectedRevision: Number(document.revision), transport: 'direct', ...patch }); }
async function acknowledge(documentId, token, result = 'sent', patch = {}) { return mutate({ action: 'ack', documentId, operationId: operation(), claimToken: token, result, ...patch }); }
async function confirm(documentId) { const doc = await current(documentId); return json(await mutate({ action: 'confirmPrinted', documentId, operationId: operation(), expectedRevision: Number(doc.revision), physicalConfirmed: true })); }
const printConnection = { deviceType: 'escpos_network', connectionType: 'lan', host: '192.0.2.10', port: 9100, paperWidth: '80mm', identifier: '', characterEncoding: 'shift_jis', cutPaper: true, openCashDrawer: true };
async function configurePrinter(extra = {}) {
  await db.query(`update pos_store_settings set printer_settings=$1::jsonb where store_id=$2`, [JSON.stringify({ enabled: true, receiptEnabled: true, kitchenEnabled: false, receiptPrinter: printConnection, kitchenPrinter: printConnection, receiptTemplate: { footerMessage: '変更後レシート注記' }, kitchenTicketTemplate: { customMessage: '変更後厨房注記' }, ...extra }), ids.store]);
}
try {
  groups.push({ name: 'additive-migration-applies-twice-and-preserves-historical-paid-data', passed: true, historical: f.historicalPreserved });
  const first = await sale();
  assert.deepEqual([first.subtotalAmount, first.discountAmount, first.amount, first.taxAmount, first.cashTenderedAmount, first.cashChangeAmount], [815, 163, 652, 49, 2000, 1348]);
  assert.equal(first.printDocuments.version, 1); assert.equal(first.printDocuments.mode, 'deferred'); assert.equal(first.printDocuments.documentCount, 4); assert.equal(first.printDocuments.pendingCount, 3);
  const initialDocs = await orderDocs(first.orderId);
  assert.deepEqual(initialDocs.map(doc => doc.kind), ['kitchen', 'finishing', 'pickup', 'receipt']); assert.deepEqual(initialDocs.map(doc => doc.state), ['pending', 'pending', 'pending', 'not_requested']);
  assert.equal(initialDocs[3].payload.order.totalAmount, 652); assert.equal(initialDocs[3].payload.order.cashChangeAmount, 1348);
  assert.ok(JSON.stringify(initialDocs[0].payload).includes('原麻辣味')); assert.ok(JSON.stringify(initialDocs[0].payload).includes('原この杯メモ')); assert.ok(JSON.stringify(initialDocs[3].payload).includes('原レシート注記'));
  const financial = (await db.query('select amount::int,payment_status,customer_summary from store_customer_orders where id=$1', [first.orderId])).rows[0];
  assert.equal(financial.amount, 652); assert.equal(financial.payment_status, 'paid'); assert.equal(financial.customer_summary.printDocuments.version, 1);
  const persistedCounts = await counts(); assert.equal(persistedCounts.documents, 4); assert.equal(persistedCounts.relay_jobs, 0);
  groups.push({ name: 'paid-discounted-cash-checkout-and-four-immutable-snapshots-commit-together', passed: true, totals: [815, 163, 652, 2000, 1348], states: initialDocs.map(doc => doc.state) });

  const replay = await json(await postCheckout({ offlineClientOrderId: uuid(200) })); assert.equal(replay.orderId, first.orderId); assert.equal(replay.duplicate, true); assert.deepEqual(await counts(), persistedCounts); assert.deepEqual(await orderDocs(first.orderId), initialDocs);
  await json(await postCheckout({ offlineClientOrderId: uuid(200), note: 'different content' }), 409); assert.deepEqual(await counts(), persistedCounts);
  groups.push({ name: 'same-checkout-replay-keeps-single-sale-and-snapshots-changed-replay-rejects', passed: true });

  let queue = await json(await getQueue()); assert.equal(queue.summary.pendingDocuments, 3); assert.equal(queue.summary.pendingOrders, 1); assert.equal(queue.documents.length, 3);
  const originalSession = state.session; state.session = { id: ids.employee2, name: 'Another terminal', role: 'store_terminal', sessionId: uuid(21) };
  const otherTerminal = await json(await getQueue()); assert.deepEqual(otherTerminal.documents, queue.documents); state.session = originalSession;
  const reloadedHandler = f.reload('app/api/store/pos/print-documents/route.ts'); const restarted = await json(await reloadedHandler.GET(request(`/api/store/pos/print-documents?storeId=${ids.store}`))); assert.deepEqual(restarted.documents, queue.documents);
  const pageOne = await json(await getQueue('limit=2')); assert.equal(pageOne.documents.length, 2); assert.equal(pageOne.hasMore, true); const pageTwo = await json(await getQueue(`limit=2&cursor=${pageOne.cursor}`)); assert.equal(pageTwo.documents.length, 1); assert.ok(!pageOne.documents.some(doc => doc.id === pageTwo.documents[0].id));
  groups.push({ name: 'durable-queue-visible-to-other-scoped-terminal-and-read-handler-pagination', passed: true, pendingDocuments: queue.summary.pendingDocuments });

  const routes = load('app/api/store/pos/print-documents/route.ts');
  state.session = null; await json(await getQueue(), 401); await json(await claim(initialDocs[0]), 401); state.session = originalSession;
  await json(await routes.GET(request(`/api/store/pos/print-documents?storeId=${ids.other}`)), 403);
  await json(await mutate({ action: 'claim', documentId: initialDocs[0].id, operationId: operation(), expectedRevision: 0, storeId: ids.other }), 403);
  await json(await mutate({ action: 'claim', documentId: initialDocs[0].id, operationId: operation(), expectedRevision: 0 }, { origin: 'https://wrong.example' }), 403);
  await json(await mutate({ action: 'claim', documentId: initialDocs[0].id, operationId: operation(), expectedRevision: 0 }, { origin: 'http://isolated.test', 'sec-fetch-site': 'cross-site' }), 403);
  assert.deepEqual(await counts(), persistedCounts);
  groups.push({ name: 'actual-route-auth-origin-and-cross-store-scope-denials-do-not-write', passed: true });

  await json(await claim(initialDocs[0]), 409); assert.equal((await current(initialDocs[0].id)).state, 'pending'); assert.deepEqual(await counts(), persistedCounts);
  groups.push({ name: 'unconfigured-printer-rejects-with-pending-document-preserved', passed: true });
  await configurePrinter();
  await db.query(`update menu_catalog_items set base_price=9999,name='変更後メニュー' where id=$1`, [ids.menu]); await db.query(`update menu_options set name='変更後味',price_delta=999 where id=$1`, [ids.option]);
  const raceOperations = [operation(), operation()];
  const racing = await Promise.all(raceOperations.map(operationId => claim(initialDocs[0], { operationId })));
  assert.deepEqual(racing.map(response => response.status).sort(), [200, 409]);
  const winnerIndex = racing.findIndex(response => response.status === 200); const winner = await racing[winnerIndex].json(); assert.equal(winner.shouldPrint, true); assert.ok(winner.claimToken); assert.ok(winner.payload); assert.equal(winner.payload.printer.host, printConnection.host); assert.equal(winner.payload.printer.openCashDrawer, false);
  assert.ok(JSON.stringify(winner.payload).includes('原メニュー')); assert.ok(JSON.stringify(winner.payload).includes('原麻辣味')); assert.ok(!JSON.stringify(winner.payload).includes('変更後味')); assert.deepEqual((await current(initialDocs[0].id)).payload, initialDocs[0].payload);
  const requestOperation = raceOperations[winnerIndex];
  const duplicateClaim = await json(await claim(initialDocs[0], { operationId: requestOperation })); assert.equal(duplicateClaim.shouldPrint, false); assert.equal(duplicateClaim.payload, undefined); assert.equal(duplicateClaim.claimToken, undefined); await json(await claim(initialDocs[0], { operationId: requestOperation, transport: 'relay' }), 409);
  await json(await acknowledge(initialDocs[0].id, uuid(9998)), 409); assert.equal((await current(initialDocs[0].id)).state, 'sending');
  groups.push({ name: 'overlapping-claims-one-sender-snapshot-content-immutable-current-printer-used-bad-token-rejects', passed: true, limitation: 'PGlite serializes transactions on one connection; this tests guarded competing requests rather than multi-connection advisory-lock scheduling.' });

  await db.query(`update pos_print_documents set claimed_at=now()-interval '3 minutes' where id=$1`, [initialDocs[0].id]); queue = await json(await getQueue()); assert.equal(queue.documents.find(doc => doc.id === initialDocs[0].id).state, 'uncertain');
  await json(await claim(await current(initialDocs[0].id)), 409);
  await json(await acknowledge(initialDocs[0].id, winner.claimToken, 'uncertain', { error: 'Fixture: printer result unknown' })); assert.equal((await current(initialDocs[0].id)).state, 'uncertain');
  await confirm(initialDocs[0].id); const physicallyConfirmed = await current(initialDocs[0].id); assert.equal(physicallyConfirmed.state, 'sent');
  await json(await acknowledge(initialDocs[0].id, winner.claimToken, 'sent'), 409);
  const reprint = await json(await claim(physicallyConfirmed, { reprint: true, physicalConfirmed: true })); assert.equal(reprint.shouldPrint, true); assert.equal(reprint.payload.printer.openCashDrawer, false); assert.notEqual(reprint.claimToken, winner.claimToken);
  await json(await acknowledge(initialDocs[0].id, winner.claimToken, 'sent'), 409);
  const ackOperation = operation(); await json(await acknowledge(initialDocs[0].id, reprint.claimToken, 'sent', { operationId: ackOperation })); const ackReplay = await json(await acknowledge(initialDocs[0].id, reprint.claimToken, 'sent', { operationId: ackOperation })); assert.equal(ackReplay.alreadyDone, true);
  await json(await acknowledge(initialDocs[0].id, reprint.claimToken, 'uncertain', { operationId: ackOperation }), 409);
  groups.push({ name: 'lost-claim-or-ack-never-grants-second-send-expiry-is-uncertain-physical-confirmation-fences-old-token', passed: true });

  // Restore catalog for subsequent independent sales; saved original snapshots remain untouched.
  await db.query(`update menu_catalog_items set base_price=815,name='原メニュー 麻辣湯' where id=$1`, [ids.menu]); await db.query(`update menu_options set name='原麻辣味',price_delta=0 where id=$1`, [ids.option]);
  const two = await sale({ items: [{ ...f.baseBody.items[0], quantity: 2 }] }); const twoDocs = await orderDocs(two.orderId); assert.equal(two.amount, 1304); assert.equal(twoDocs.length, 7);
  const twoItems = (await db.query('select id from store_customer_order_items where order_id=$1 order by id', [two.orderId])).rows;
  const activeDoc = twoDocs.find(doc => doc.kind === 'kitchen'), activeClaim = await json(await claim(activeDoc));
  const otherBowlItemId = twoItems.find(item => item.id !== activeDoc.item_id).id;
  await json(await refund({ orderId: two.orderId, itemIds: [otherBowlItemId], reason: 'Fixture partial refund' }), 409);
  await json(await acknowledge(activeDoc.id, activeClaim.claimToken, 'uncertain'));
  await json(await refund({ orderId: two.orderId, itemIds: [otherBowlItemId], reason: 'Fixture partial refund' }));
  assert.equal((await current(activeDoc.id)).state, 'uncertain', 'Refund retains unknown output history'); await confirm(activeDoc.id);
  const receipt = twoDocs.find(doc => doc.kind === 'receipt'), receiptClaim = await json(await claim(await current(receipt.id)));
  assert.equal(receiptClaim.payload.order.totalAmount, 1304); assert.match(receiptClaim.payload.order.receiptTitle, /一部返金/); assert.match(receiptClaim.payload.order.note, /返金前/); assert.equal(receiptClaim.payload.printer.openCashDrawer, false); await json(await acknowledge(receipt.id, receiptClaim.claimToken));
  const refundedItem = otherBowlItemId; const refundedDocument = twoDocs.find(doc => doc.item_id === refundedItem && doc.kind === 'pickup'); await json(await claim(await current(refundedDocument.id)), 409);
  await json(await refund({ orderId: two.orderId, reason: 'Fixture remaining refund' })); await json(await claim(await current(receipt.id), { reprint: true, physicalConfirmed: true }), 409);
  groups.push({ name: 'active-direct-send-blocks-refund-uncertain-does-not-block-refund-history-kept-original-receipt-notice-no-drawer-full-refund-rejects', passed: true });

  const completed = await sale(); const completedDocs = await orderDocs(completed.orderId); await db.query(`update store_customer_orders set status='completed' where id=$1`, [completed.orderId]); await db.query(`update order_production_tasks set handed_off_at=now() where order_id=$1`, [completed.orderId]);
  await json(await claim(completedDocs.find(doc => doc.kind === 'kitchen')), 409); const completedReceipt = await json(await claim(completedDocs.find(doc => doc.kind === 'receipt'))); assert.equal(completedReceipt.payload.printer.openCashDrawer, false); await json(await acknowledge(completedReceipt.document.id, completedReceipt.claimToken));
  groups.push({ name: 'completed-handed-off-production-documents-reject-but-paid-original-receipt-remains-printable', passed: true, stateSetup: 'Fixture SQL applies completed/handoff persistence; actual ledger eligibility handler is exercised.' });

  const expired = await sale(); const expiredDoc = (await orderDocs(expired.orderId)).find(doc => doc.kind === 'kitchen'); await json(await claim(expiredDoc)); await db.query(`update pos_print_documents set claimed_at=now()-interval '3 minutes' where id=$1`, [expiredDoc.id]);
  await json(await refund({ orderId: expired.orderId, reason: 'Fixture expired send refund' })); assert.equal((await current(expiredDoc.id)).state, 'sending'); await json(await claim(await current(expiredDoc.id), { reprint: true, physicalConfirmed: true }), 409);
  groups.push({ name: 'expired-direct-send-permits-refund-retains-unknown-history-and-blocks-old-production-reprint', passed: true });

  const autoRequestId = uuid(nextId++); const auto = await json(await postCheckout({ offlineClientOrderId: autoRequestId, printMode: 'auto' })); const autoReceipt = (await orderDocs(auto.orderId)).find(doc => doc.kind === 'receipt');
  const firstAuto = await json(await claim(autoReceipt, { initialCheckout: true, checkoutRequestId: autoRequestId })); assert.equal(firstAuto.payload.printer.openCashDrawer, true); await json(await acknowledge(autoReceipt.id, firstAuto.claimToken));
  const autoReprint = await json(await claim(await current(autoReceipt.id), { initialCheckout: true, checkoutRequestId: autoRequestId, reprint: true, physicalConfirmed: true })); assert.equal(autoReprint.payload.printer.openCashDrawer, false); await json(await acknowledge(autoReceipt.id, autoReprint.claimToken));
  groups.push({ name: 'only-first-fresh-normal-auto-receipt-preserves-configured-drawer-manual-reprint-never-opens', passed: true });

  const legacyBefore = await counts(); const legacy = await sale({ printDocumentVersion: undefined }); assert.equal(legacy.printDocuments, undefined); const legacyAfter = await counts(); assert.equal(legacyAfter.documents, legacyBefore.documents); assert.equal(legacyAfter.orders, legacyBefore.orders + 1);
  groups.push({ name: 'old-checkout-body-version-does-not-create-server-ledger', passed: true });

  const relay = load('lib/store-relay.ts'), relayToken = 'fixture-owner-token';
  await db.query(`insert into store_relay_stations(id,store_id,name,enabled,print_enabled,epoch,owner_hash,owner_employee_id,owner_session_id,owner_until) values($1,$2,'Fixture A',true,true,1,$3,$4,$5,now()+interval '1 hour')`, [ids.station, ids.store, relay.relayHash(relayToken), ids.employee, state.session.sessionId]);
  await db.query(`insert into store_relay_devices(id,station_id,token_hash,heartbeat_at) values($1,$2,'paired',now())`, [ids.device, ids.station]);
  const relayOwner = { stationId: ids.station, epoch: 1, token: relayToken };
  const relayAuto = await sale({ printMode: 'auto', relayOwner }); const relayDocs = await orderDocs(relayAuto.orderId); const relayJobs = (await db.query('select * from store_relay_print_jobs where order_id=$1 order by sequence', [relayAuto.orderId])).rows;
  assert.equal(relayJobs.length, 4); assert.equal(relayDocs.length, 4); assert.ok(relayDocs.every(doc => doc.relay_job_id)); assert.deepEqual(relayJobs.map(job => job.kind), ['kitchen', 'kitchen', 'pickup', 'receipt']); assert.equal(relayJobs[1].payload.kitchenTicketTemplate.title, '出品伝票'); assert.deepEqual(relayJobs.map(job => job.payload.printer.openCashDrawer), [false, false, false, true]);
  await json(await claim(relayDocs[0]), 409);
  const relayDeferred = await sale({ printMode: 'deferred', relayOwner }); const deferredDocs = await orderDocs(relayDeferred.orderId); assert.equal((await db.query('select count(*)::int as count from store_relay_print_jobs where order_id=$1', [relayDeferred.orderId])).rows[0].count, 0);
  const relayOp = operation(); const queued = await json(await claim(deferredDocs[0], { transport: 'relay', relayOwner, operationId: relayOp })); assert.equal(queued.shouldPrint, false); assert.equal(queued.queued, true); assert.equal(queued.payload, undefined);
  const relayReplay = await json(await claim(deferredDocs[0], { transport: 'relay', relayOwner, operationId: relayOp })); assert.equal(relayReplay.shouldPrint, false); assert.equal((await db.query('select count(*)::int as count from store_relay_print_jobs where order_id=$1', [relayDeferred.orderId])).rows[0].count, 1);
  groups.push({ name: 'auto-relay-links-once-deferred-relay-queues-only-explicitly-using-existing-android-job-contract', passed: true, autoJobs: relayJobs.length, deferredExplicitJobs: 1 });

  // Exercise the actual pre-existing management and Android-agent routes too:
  // a new immutable ledger document must never also be controllable as a legacy job.
  const legacyRelay = load('app/api/store/device-relay/route.ts');
  const nativeRelay = load('app/api/store/device-relay/agent/route.ts');
  const nativeSecret = 'A'.repeat(43);
  await db.query('update store_relay_devices set token_hash=$1,heartbeat_at=now() where id=$2', [relay.relayHash(nativeSecret), ids.device]);
  const legacyMutation = body => legacyRelay.POST(request('/api/store/device-relay', { storeId: ids.store, owner: relayOwner, ...body }));
  const legacyQueue = () => legacyRelay.GET(request(`/api/store/device-relay?storeId=${ids.store}`));
  let nativePrintPayloads = 0;
  async function nativeMutation(body) { return nativeRelay.POST(request('/api/store/device-relay/agent', body, { authorization: `Bearer ${nativeSecret}` })); }
  async function nativeClaim() { const body = await json(await nativeMutation({ action: 'claim' })); if (body.job) nativePrintPayloads++; return body.job; }
  async function nativeAck(job, result = 'sent') { return json(await nativeMutation({ action: 'ack', jobId: job.id, claimToken: job.claim_token, result })); }
  const cancelRelayTestBacklog = () => db.query(`update store_relay_print_jobs set state='cancelled',claim_token=null where state in ('pending','sending','uncertain')`);
  await cancelRelayTestBacklog();
  const oldLinkedSale = await sale({ printMode: 'auto', relayOwner });
  const oldLinkedDoc = (await orderDocs(oldLinkedSale.orderId)).find(doc => doc.kind === 'kitchen');
  const oldLinkedJob = oldLinkedDoc.relay_job_id;
  await db.query(`update store_relay_print_jobs set state='sent' where id=$1`, [oldLinkedJob]);
  await json(await legacyMutation({ action: 'reprint', jobId: oldLinkedJob }), 409);
  const ledgerReprint = await json(await claim(await current(oldLinkedDoc.id), { transport: 'relay', relayOwner, reprint: true, physicalConfirmed: true }));
  assert.equal(ledgerReprint.queued, true); assert.equal(ledgerReprint.shouldPrint, false);
  assert.notEqual((await current(oldLinkedDoc.id)).relay_job_id, oldLinkedJob);
  const legacyGateCounts = await counts();
  await json(await legacyMutation({ action: 'reprint', jobId: oldLinkedJob }), 409);
  await db.query(`update store_relay_print_jobs set state='uncertain' where id=$1`, [oldLinkedJob]);
  await json(await legacyMutation({ action: 'confirmSent', jobId: oldLinkedJob }), 409);
  await db.query(`update store_customer_orders set payment_status='refunded',status='cancelled' where id=$1`, [oldLinkedSale.orderId]);
  await json(await legacyMutation({ action: 'voidRefunded', jobId: oldLinkedJob, confirmed: true }), 409);
  assert.deepEqual(await counts(), legacyGateCounts, 'Legacy actions must not create jobs or bypass document operation logging');
  const hiddenLegacy = await json(await legacyQueue());
  assert.ok(!hiddenLegacy.jobs.some(job => job.order_id === oldLinkedSale.orderId), 'Both currently linked and historical unlinked ledger jobs stay out of legacy controls');
  groups.push({ name: 'legacy-management-cannot-reprint-confirm-or-void-ledger-jobs-including-unlinked-historical-jobs', passed: true, nativePayloads: nativePrintPayloads });

  await cancelRelayTestBacklog();
  const handoffSale = await sale({ printMode: 'deferred', relayOwner });
  const handoffDoc = (await orderDocs(handoffSale.orderId)).find(doc => doc.kind === 'kitchen');
  await json(await claim(handoffDoc, { transport: 'relay', relayOwner }));
  const handoffQueued = await current(handoffDoc.id);
  await db.query('update order_production_tasks set handed_off_at=now() where order_item_id=$1', [handoffDoc.item_id]);
  const moneyBeforeHandoffClaim = (await db.query('select amount::int,payment_status from store_customer_orders where id=$1', [handoffSale.orderId])).rows[0];
  assert.equal(await nativeClaim(), null, 'A bowl handed off after queueing must not be delivered to Android');
  assert.equal((await current(handoffDoc.id)).state, 'cancelled');
  assert.equal((await db.query('select state from store_relay_print_jobs where id=$1', [handoffQueued.relay_job_id])).rows[0].state, 'cancelled');
  assert.equal(nativePrintPayloads, 0);
  assert.deepEqual((await db.query('select amount::int,payment_status from store_customer_orders where id=$1', [handoffSale.orderId])).rows[0], moneyBeforeHandoffClaim);
  groups.push({ name: 'android-dequeue-rechecks-per-bowl-handoff-and-cancels-ineligible-pending-without-paper-or-money-change', passed: true });

  const unknownSale = await sale({ printMode: 'deferred', relayOwner });
  const unknownDoc = (await orderDocs(unknownSale.orderId)).find(doc => doc.kind === 'kitchen');
  await json(await claim(unknownDoc, { transport: 'relay', relayOwner }));
  const unknownNative = await nativeClaim(); assert.ok(unknownNative); assert.equal(unknownNative.id, (await current(unknownDoc.id)).relay_job_id);
  await nativeAck(unknownNative, 'uncertain');
  await json(await mutate({ action: 'voidIneligible', documentId: unknownDoc.id, operationId: operation(), expectedRevision: Number((await current(unknownDoc.id)).revision), physicalConfirmed: true }), 409);
  await db.query('update order_production_tasks set handed_off_at=now() where order_item_id=$1', [unknownDoc.item_id]);
  const beforeVoid = await counts(), beforeVoidPayloads = nativePrintPayloads;
  const moneyBeforeVoid = (await db.query('select amount::int,payment_status from store_customer_orders where id=$1', [unknownSale.orderId])).rows[0];
  const unknownQueue = await json(await getQueue());
  const visibleUnknown = unknownQueue.documents.find(doc => doc.id === unknownDoc.id);
  assert.ok(visibleUnknown, 'Ineligible uncertainty must remain in the operational queue until reviewed');
  assert.equal(visibleUnknown.state, 'uncertain'); assert.equal(visibleUnknown.eligible, false); assert.ok(unknownQueue.summary.needsReview >= 1);
  await json(await claim(await current(unknownDoc.id), { transport: 'relay', relayOwner, reprint: true, physicalConfirmed: true }), 409);
  await json(await mutate({ action: 'confirmPrinted', documentId: unknownDoc.id, operationId: operation(), expectedRevision: Number((await current(unknownDoc.id)).revision), physicalConfirmed: true }), 409);
  const voidOperation = operation();
  const voidBody = { action: 'voidIneligible', documentId: unknownDoc.id, operationId: voidOperation, expectedRevision: Number((await current(unknownDoc.id)).revision), physicalConfirmed: true };
  await json(await mutate({ ...voidBody, operationId: operation(), physicalConfirmed: false }), 400);
  await json(await mutate({ ...voidBody, operationId: operation(), expectedRevision: voidBody.expectedRevision - 1 }), 409);
  const voided = await json(await mutate(voidBody)); assert.equal(voided.document.state, 'cancelled');
  const duplicateVoid = await json(await mutate(voidBody)); assert.equal(duplicateVoid.alreadyDone, true);
  await json(await mutate({ ...voidBody, physicalConfirmed: false }), 409);
  assert.equal((await current(unknownDoc.id)).state, 'cancelled');
  assert.equal((await db.query('select state,claim_token from store_relay_print_jobs where id=$1', [unknownNative.id])).rows[0].state, 'cancelled');
  assert.equal((await db.query('select claim_token from store_relay_print_jobs where id=$1', [unknownNative.id])).rows[0].claim_token, null);
  await json(await nativeMutation({ action: 'ack', jobId: unknownNative.id, claimToken: unknownNative.claim_token, result: 'sent' }), 409);
  assert.deepEqual((await db.query('select amount::int,payment_status from store_customer_orders where id=$1', [unknownSale.orderId])).rows[0], moneyBeforeVoid);
  assert.equal((await counts()).relay_jobs, beforeVoid.relay_jobs); assert.equal(nativePrintPayloads, beforeVoidPayloads);
  assert.ok(!(await json(await getQueue())).documents.some(doc => doc.id === unknownDoc.id));
  const futureSale = await sale({ printMode: 'deferred', relayOwner }), futureDoc = (await orderDocs(futureSale.orderId)).find(doc => doc.kind === 'kitchen');
  await json(await claim(futureDoc, { transport: 'relay', relayOwner })); const futureNative = await nativeClaim(); assert.ok(futureNative); assert.equal(futureNative.id, (await current(futureDoc.id)).relay_job_id); await nativeAck(futureNative);
  groups.push({ name: 'ineligible-unknown-stays-visible-physical-close-is-idempotent-fences-old-native-token-and-unblocks-next-valid-job', passed: true, noPaperOnClose: true, noFinancialChange: true });

  const expiredRelaySale = await sale({ printMode: 'deferred', relayOwner }), expiredRelayDoc = (await orderDocs(expiredRelaySale.orderId)).find(doc => doc.kind === 'kitchen');
  await json(await claim(expiredRelayDoc, { transport: 'relay', relayOwner })); const expiredNative = await nativeClaim(); assert.ok(expiredNative);
  await db.query('update order_production_tasks set handed_off_at=now() where order_item_id=$1', [expiredRelayDoc.item_id]);
  const expiryVoid = { action: 'voidIneligible', documentId: expiredRelayDoc.id, operationId: operation(), expectedRevision: Number((await current(expiredRelayDoc.id)).revision), physicalConfirmed: true };
  await json(await mutate(expiryVoid), 409); assert.equal((await db.query('select state from store_relay_print_jobs where id=$1', [expiredNative.id])).rows[0].state, 'sending');
  await db.query(`update store_relay_print_jobs set claimed_at=now()-interval '3 minutes' where id=$1`, [expiredNative.id]);
  assert.equal((await json(await getQueue())).documents.find(doc => doc.id === expiredRelayDoc.id).state, 'uncertain');
  const expiryBefore = await counts(), expiryNativeCount = nativePrintPayloads;
  await json(await mutate(expiryVoid)); assert.equal((await current(expiredRelayDoc.id)).state, 'cancelled');
  await json(await nativeMutation({ action: 'ack', jobId: expiredNative.id, claimToken: expiredNative.claim_token, result: 'sent' }), 409);
  assert.equal((await counts()).relay_jobs, expiryBefore.relay_jobs); assert.equal(nativePrintPayloads, expiryNativeCount);
  const expiredDirectBefore = await current(expiredDoc.id), expiredDirectToken = expiredDirectBefore.claim_token;
  await json(await mutate({ action: 'voidIneligible', documentId: expiredDoc.id, operationId: operation(), expectedRevision: Number(expiredDirectBefore.revision), physicalConfirmed: true }));
  await json(await acknowledge(expiredDoc.id, expiredDirectToken), 409);
  assert.equal((await current(expiredDoc.id)).state, 'cancelled');
  groups.push({ name: 'fresh-ineligible-send-cannot-be-closed-expired-direct-and-relay-send-can-close-with-late-ack-fenced', passed: true });

  await cancelRelayTestBacklog();
  const legacyJobId = uuid(nextId++), legacyPayload = { version: 1, jobType: 'receipt', printer: printConnection, storeName: 'Legacy fixture', order: { pickupCode: 'LEGACY-1', note: 'Original old job', totalAmount: 652, items: [] } };
  await db.query(`insert into store_relay_print_jobs(id,station_id,store_id,document_key,sequence,kind,payload,created_by) values($1,$2,$3,'legacy-fixture',1,'receipt',$4::jsonb,$5)`, [legacyJobId, ids.station, ids.store, JSON.stringify(legacyPayload), ids.employee]);
  assert.ok((await json(await legacyQueue())).jobs.some(job => job.id === legacyJobId));
  const legacyNative = await nativeClaim(); assert.equal(legacyNative.id, legacyJobId); await nativeAck(legacyNative, 'uncertain');
  await json(await legacyMutation({ action: 'confirmSent', jobId: legacyJobId }));
  await json(await legacyMutation({ action: 'reprint', jobId: legacyJobId }));
  const legacyRetry = await nativeClaim(); assert.ok(legacyRetry); assert.notEqual(legacyRetry.id, legacyJobId); assert.equal(legacyRetry.payload.printer.openCashDrawer, false); await nativeAck(legacyRetry);
  const legacyVoidId = uuid(nextId++);
  await db.query(`insert into store_relay_print_jobs(id,station_id,store_id,order_id,document_key,sequence,kind,payload,state,created_by) values($1,$2,$3,$4,'legacy-refunded-fixture',1,'receipt',$5::jsonb,'uncertain',$6)`, [legacyVoidId, ids.station, ids.store, oldLinkedSale.orderId, JSON.stringify(legacyPayload), ids.employee]);
  await json(await legacyMutation({ action: 'voidRefunded', jobId: legacyVoidId, confirmed: true }));
  assert.equal((await db.query('select state from store_relay_print_jobs where id=$1', [legacyVoidId])).rows[0].state, 'cancelled');
  groups.push({ name: 'ordinary-legacy-jobs-retain-native-send-manual-confirm-reprint-and-refunded-void-behavior', passed: true });

  for (const pattern of [/insert into store_customer_order_items/, /insert into pos_print_documents/]) {
    const before = await counts(); state.failPattern = pattern;
    let failure; try { const response = await postCheckout({ offlineClientOrderId: uuid(nextId++), relayOwner }); if (response.status >= 400) failure = await response.text(); } catch (error) { failure = error.message; }
    state.failPattern = null; assert.ok(failure, 'Injected persistence failure must fail checkout'); assert.deepEqual(await counts(), before, 'No partial paid order, item, task, ledger or relay job may survive');
  }
  groups.push({ name: 'item-or-document-persistence-failure-rolls-back-entire-paid-order-and-ledger-transaction', passed: true });

  const paths = ['app/api/store/pos/route.ts', 'app/api/store/pos/transactions/route.ts', 'app/api/store/pos/print-documents/route.ts', 'lib/pos-print-document-ledger.ts', 'lib/pos-print-document-builder.ts', 'lib/pos-print-document-contract.ts', 'app/api/store/device-relay/route.ts', 'app/api/store/device-relay/agent/route.ts', 'lib/store-relay-print-policy.ts', 'db/migrations/20261020_pos_print_documents.sql'];
  const hashes = Object.fromEntries(await Promise.all(paths.map(async file => [file, createHash('sha256').update(await readFile(resolve(source, file))).digest('hex')])));
  const result = { passed: true, source, isolatedInMemoryPGlite: true, productionDatabaseAccess: false, networkCalls: 0, nativeCalls: 0, groups, counts: await counts(), sourceHashes: hashes, limits: ['PGlite uses one connection, so competing guarded requests are checked; independent production database connections are not exercised.', 'Authentication and store scope are synthetic; production auth/session issuance, inventory, loyalty, sales mirror and realtime integrations are stubbed.', 'Eligibility states use fixture SQL for handoff/completion; real kitchen/hardware operations are not performed.'] };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2) + '\n'); await writeFile(resolve(output, 'executed-test.mjs'), await readFile(new URL(import.meta.url)));
  console.log(JSON.stringify({ passed: true, groups: groups.length, output }));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error.stack, groups, errors: state.errors, counts: await counts().catch(() => null) }, null, 2)); throw error;
} finally { await db.close(); }
