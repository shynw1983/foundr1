import { invoiceRecipientStem } from './pos-invoice';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from './db';
import type { EmployeeSession } from './auth';
import type { PosPrintDocumentSnapshot } from './pos-print-document-builder';
import type { PosCheckoutPrintDocuments, PosPrintDocument, PosPrintDocumentClaim, PosPrintDocumentMutation, PosPrintDocumentQueue, PosPrintMode } from './pos-print-document-contract';
import { getKitchenPrinterForBrand, getReceiptPrinter, hasPosPrinterDestination, normalizePosPrinterSettings, type PosPrintPayload } from './pos-printer';
import { ownerGuardSql, relayStations, requireRelayOwner } from './store-relay';
import { relayPrintLock, relayReceiptWithRefundNotice } from './store-relay-print-policy';

// Eligibility and state fragments are fixed SQL, shared by reads and guarded writes.
export const posPrintDocumentEligibleSql = `(o.payment_status in ('paid','partial_refunded')
  and o.status not in ('cancelled','refund_pending') and (d.kind='receipt' or (
    o.status in ('new','preparing','ready') and (
      (d.item_id is not null and exists(select 1 from store_customer_order_items pi
        where pi.id=d.item_id and pi.order_id=o.id and pi.refund_status<>'refunded' and cardinality(pi.refunded_option_keys)=0)
        and not exists(select 1 from order_production_tasks pt where pt.order_item_id=d.item_id and pt.handed_off_at is not null))
      or (d.item_id is null and not exists(select 1 from store_customer_order_items pi where pi.order_id=o.id and (pi.refund_status='refunded' or cardinality(pi.refunded_option_keys)>0))
        and not exists(select 1 from order_production_tasks pt where pt.order_id=o.id
          and (d.brand_id is null or pt.brand_id=d.brand_id) and pt.handed_off_at is not null))
    )
  )))`;
// Transport ownership is encoded in the immutable job key, including superseded
// jobs no longer linked from a document. Old manual endpoints must not own them.
export const posPrintDocumentRelayOwnedSql = `(j.document_key like 'ledger:%' or j.document_key like 'ledger-reprint:%')`;
export const posPrintDocumentRelayEligibleSql = `exists(select 1 from pos_print_documents d
  join store_customer_orders o on o.id=d.order_id where d.relay_job_id=j.id
    and d.store_id=j.store_id and ${posPrintDocumentEligibleSql})`;
const effectiveStateSql = `case when coalesce(j.state,d.state)='sending'
  and coalesce(j.claimed_at,d.claimed_at)<clock_timestamp()-interval '2 minutes'
  then 'uncertain' else coalesce(j.state,d.state) end`;
const mutationStateSql = `case when coalesce((select pj.state from store_relay_print_jobs pj where pj.id=d.relay_job_id),d.state)='sending'
  and coalesce((select pj.claimed_at from store_relay_print_jobs pj where pj.id=d.relay_job_id),d.claimed_at)<clock_timestamp()-interval '2 minutes'
  then 'uncertain' else coalesce((select pj.state from store_relay_print_jobs pj where pj.id=d.relay_job_id),d.state) end`;
const selectSql = `select d.*,d.id::text as id,d.order_id::text as "orderId",d.item_id::text as "itemId",
  d.brand_id::text as "brandId",d.copy_number as "copyNumber",d.pickup_code as "pickupCode",
  d.created_at::text as "createdAt",o.created_at::text as "orderCreatedAt",
  o.payment_status as "paymentStatus",o.status as "orderStatus",o.customer_summary as "customerSummary",o.offline_client_order_id as "checkoutRequestId",
  ${effectiveStateSql} as "effectiveState",${posPrintDocumentEligibleSql} as eligible,
  j.state as "relayState",j.claimed_at::text as "relayClaimedAt",coalesce(j.error,d.error) as "effectiveError"
  from pos_print_documents d join store_customer_orders o on o.id=d.order_id
  left join store_relay_print_jobs j on j.id=d.relay_job_id`;
type Row = Record<string, unknown> & { id: string; orderId: string; itemId: string | null; brandId: string | null; payload: PosPrintPayload; eligible: boolean; effectiveState: PosPrintDocument['state']; revision: number };
const text = (value: unknown) => String(value ?? '').trim();
const uuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value));
export function posPrintDocumentError(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
export function posPrintDocumentResponse(error: unknown) {
  const e = error as { code?: string; status?: number; message?: string };
  if (e.code === '42P01' || e.code === '42703') return Response.json({ error: '伝票管理のデータベース更新が必要です。' }, { status: 503 });
  if (e.code === '22012') return Response.json({ error: '伝票または会計の状態が変わりました。最新の状態を確認してください。' }, { status: 409 });
  if (!e.status) console.error('pos print documents', error);
  return Response.json({ error: e.status ? e.message : '伝票の処理に失敗しました。' }, { status: e.status || 500 });
}
function document(row: Row): PosPrintDocument {
  const state = !row.eligible && ['pending', 'not_requested'].includes(row.effectiveState) ? 'cancelled' : row.effectiveState;
  return { id: row.id, orderId: row.orderId, itemId: row.itemId, kind: row.kind as PosPrintDocument['kind'], sequence: Number(row.sequence),
    copyNumber: Number(row.copyNumber), pickupCode: text(row.pickupCode), label: row.kind === 'receipt' && row.payload?.order?.receiptRequested ? '領収書' : ({ kitchen: '厨房伝票', finishing: '出品伝票', pickup: 'お客様番号札', receipt: 'レシート' } as Record<string, string>)[text(row.kind)] || '伝票',
    createdAt: text(row.createdAt), orderCreatedAt: text(row.orderCreatedAt), state, error: text(row.effectiveError), eligible: row.eligible,
    blockedReason: row.eligible ? '' : '返金・内容変更・お渡し済みのため、この旧伝票は印刷できません。厨房画面で最新内容を確認してください。', revision: Number(row.revision),
    transport: row.transport as PosPrintDocument['transport'] };
}
async function readRow(storeId: string, documentId: string) {
  const rows = await sql`${sql.unsafe(selectSql)} where d.store_id::text=${storeId} and d.id::text=${documentId} limit 1`;
  return rows[0] as Row | undefined;
}
export async function readPosCheckoutPrintDocuments(storeId: string, orderId: string): Promise<PosCheckoutPrintDocuments | undefined> {
  const orders = await sql`select customer_summary->'printDocuments' as metadata from store_customer_orders where id::text=${orderId} and store_id::text=${storeId}`;
  const metadata = orders[0]?.metadata as PosCheckoutPrintDocuments | undefined;
  if (!metadata || metadata.version !== 1) return undefined;
  const rows = await sql`select count(*)::int as count, count(*) filter(where ${sql.unsafe(effectiveStateSql)}='pending' and ${sql.unsafe(posPrintDocumentEligibleSql)})::int as pending
    from pos_print_documents d join store_customer_orders o on o.id=d.order_id left join store_relay_print_jobs j on j.id=d.relay_job_id
    where d.order_id::text=${orderId} and d.store_id::text=${storeId}`;
  return { version: 1, orderId, mode: metadata.mode, documentCount: Number(rows[0]?.count || 0), pendingCount: Number(rows[0]?.pending || 0) };
}
export async function readPosPrintDocumentQueue(storeId: string, params: URLSearchParams): Promise<PosPrintDocumentQueue> {
  const orderId = text(params.get('orderId')), cursor = text(params.get('cursor'));
  if (orderId && !uuid(orderId)) posPrintDocumentError('会計番号を確認してください。', 400);
  if (cursor && !uuid(cursor)) posPrintDocumentError('ページ番号を確認してください。', 400);
  const limit = Math.max(1, Math.min(100, Math.floor(Number(params.get('limit')) || 30)));
  const rows = await sql`${sql.unsafe(selectSql)} where d.store_id::text=${storeId}
    and (${orderId}='' or d.order_id::text=${orderId})
    and (${orderId}<>'' or ${sql.unsafe(effectiveStateSql)}='uncertain'
      or (${sql.unsafe(posPrintDocumentEligibleSql)} and ${sql.unsafe(effectiveStateSql)} in ('pending','sending')))
    and (${cursor}='' or (d.created_at,d.order_id,d.sequence,d.id) > (select c.created_at,c.order_id,c.sequence,c.id from pos_print_documents c where c.id::text=${cursor} and c.store_id::text=${storeId}))
    order by d.created_at,d.order_id,d.sequence,d.id limit ${limit + 1}`;
  const summaryRows = await sql`select
    count(*) filter(where ${sql.unsafe(effectiveStateSql)}='pending' and ${sql.unsafe(posPrintDocumentEligibleSql)})::int as pending,
    count(distinct d.order_id) filter(where ${sql.unsafe(effectiveStateSql)}='pending' and ${sql.unsafe(posPrintDocumentEligibleSql)})::int as orders,
    count(*) filter(where ${sql.unsafe(effectiveStateSql)}='uncertain')::int as review,
    count(*) filter(where ${sql.unsafe(effectiveStateSql)}='sending' and ${sql.unsafe(posPrintDocumentEligibleSql)})::int as sending
    from pos_print_documents d join store_customer_orders o on o.id=d.order_id left join store_relay_print_jobs j on j.id=d.relay_job_id
    where d.store_id::text=${storeId}`;
  const stations = (await relayStations(storeId)).filter(s => s.enabled && s.print_enabled);
  const page = rows.slice(0, limit) as Row[];
  return { version: 1, selectedStoreId: storeId, documents: page.map(document), summary: {
    pendingDocuments: Number(summaryRows[0]?.pending || 0), pendingOrders: Number(summaryRows[0]?.orders || 0),
    needsReview: Number(summaryRows[0]?.review || 0), sendingDocuments: Number(summaryRows[0]?.sending || 0) },
    hasMore: rows.length > limit, cursor: rows.length > limit ? page.at(-1)?.id || null : null,
    relay: { available: stations.length > 0, online: stations.some(s => s.device_online), stationId: stations[0]?.id as string | undefined }, serverNow: new Date().toISOString() };
}

// Snapshots are never rewritten. A retry reads the original metadata and rows.
export function posPrintSnapshotWrites(input: { storeId: string; orderId: string; mode: PosPrintMode; snapshots: PosPrintDocumentSnapshot[]; relayStationId?: string; employeeId: string }) {
  const writes = [];
  for (const snapshot of input.snapshots) {
    const documentId = randomUUID(), relayId = input.relayStationId && snapshot.requested && input.mode === 'auto' ? randomUUID() : null;
    if (relayId) {
      if (snapshot.payload.printer.deviceType !== 'escpos_network' || !hasPosPrinterDestination(snapshot.payload.printer)) posPrintDocumentError('中継印刷の Wi-Fi / LAN プリンターを設定してください。');
      writes.push(sql`insert into store_relay_print_jobs(id,station_id,store_id,order_id,document_key,sequence,kind,payload,created_by)
        select ${relayId}::uuid,${input.relayStationId}::uuid,${input.storeId}::uuid,${input.orderId}::uuid,${`ledger:${input.orderId}:${snapshot.documentKey}`},${snapshot.sequence},
          ${snapshot.kind === 'finishing' ? 'kitchen' : snapshot.kind},${JSON.stringify(snapshot.payload)}::jsonb,${input.employeeId}::uuid
        where exists(select 1 from store_customer_orders where id=${input.orderId}::uuid) on conflict(document_key) do nothing`);
    }
    writes.push(sql`insert into pos_print_documents(id,store_id,order_id,item_id,brand_id,document_key,kind,sequence,copy_number,pickup_code,target,payload,mode,state,transport,relay_job_id)
      select ${documentId}::uuid,${input.storeId}::uuid,${input.orderId}::uuid,${snapshot.itemId}::uuid,${snapshot.brandId}::uuid,${snapshot.documentKey},${snapshot.kind},${snapshot.sequence},${snapshot.copyNumber},${snapshot.pickupCode},
        ${snapshot.target},${JSON.stringify(snapshot.payload)}::jsonb,${input.mode},${snapshot.requested ? 'pending' : 'not_requested'},${relayId ? 'relay' : null},${relayId}::uuid
      where exists(select 1 from store_customer_orders where id=${input.orderId}::uuid) on conflict(order_id,document_key) do nothing`);
  }
  return writes;
}

async function currentPayload(storeId: string, row: Row, allowInitialDrawer = false) {
  const settingsRows = await sql`select printer_settings from pos_store_settings where store_id::text=${storeId}`;
  const settings = normalizePosPrinterSettings(settingsRows[0]?.printer_settings);
  const printer = row.target === 'kitchen' ? getKitchenPrinterForBrand(settings, row.brandId) : getReceiptPrinter(settings);
  if (!hasPosPrinterDestination(printer)) posPrintDocumentError('印刷先プリンターを設定してください。');
  const original = row.payload.order?.receiptRequested ? { ...row.payload, order: { ...row.payload.order, receiptRecipientName: invoiceRecipientStem(row.payload.order.receiptRecipientName ?? row.payload.receiptTemplate?.invoiceRecipientName) } } : row.payload;
  const payload = { ...original, printer: { ...printer, openCashDrawer: Boolean(allowInitialDrawer && row.payload.printer.openCashDrawer && printer.openCashDrawer) } };
  return row.kind === 'receipt' && row.paymentStatus === 'partial_refunded' ? relayReceiptWithRefundNotice(payload) : payload;
}
export function guardPosPrintRefund(storeId: string, orderId: string) {
  // A short active send lease prevents printing and refunding the same sale at
  // once. Uncertain or expired output remains history; it cannot block refunds forever.
  return sql`select 1 / case when not exists(select 1 from pos_print_documents d where d.store_id::text=${storeId} and d.order_id::text=${orderId}
    and d.transport='direct' and d.state='sending' and d.claimed_at>clock_timestamp()-interval '2 minutes') then 1 else 0 end as direct_print_resolved`;
}
export function cancelIneligiblePosPrintDocuments(storeId: string, orderId: string) {
  return sql`update pos_print_documents d set state='cancelled',revision=revision+1,error='返金・キャンセルにより未送信の伝票を終了しました。',updated_at=now()
    from store_customer_orders o where o.id=d.order_id and d.store_id::text=${storeId} and d.order_id::text=${orderId}
    and d.state in ('pending','not_requested') and not ${sql.unsafe(posPrintDocumentEligibleSql)}
    and (d.relay_job_id is null or exists(select 1 from store_relay_print_jobs j where j.id=d.relay_job_id and j.state in ('pending','cancelled')))
    returning d.id`;
}

// Run under relayPrintLock before dequeueing. Never resolve uncertain output
// automatically; an ineligible pending snapshot is safe to cancel without paper.
export function cancelIneligiblePosPrintRelayJobs(storeId: string, stationId = '') {
  return sql`with cancelled as (update store_relay_print_jobs j set state='cancelled',claim_token=null,
      error='返金・キャンセル・お渡し済みにより未送信の伝票を終了しました。',updated_at=now()
    where j.store_id::text=${storeId} and (${stationId}='' or j.station_id::text=${stationId})
      and j.state='pending' and ${sql.unsafe(posPrintDocumentRelayOwnedSql)}
      and not ${sql.unsafe(posPrintDocumentRelayEligibleSql)} returning j.id)
    update pos_print_documents d set state='cancelled',revision=revision+1,
      error='返金・キャンセル・お渡し済みにより未送信の伝票を終了しました。',updated_at=now()
    from store_customer_orders o where o.id=d.order_id and d.store_id::text=${storeId}
      and d.state='pending' and not ${sql.unsafe(posPrintDocumentEligibleSql)}
      and (d.relay_job_id in (select id from cancelled) or exists(select 1 from store_relay_print_jobs j
        where j.id=d.relay_job_id and j.state='cancelled' and (${stationId}='' or j.station_id::text=${stationId})))
    returning d.id`;
}

export async function mutatePosPrintDocument(body: PosPrintDocumentMutation, session: EmployeeSession): Promise<PosPrintDocumentClaim | { ok: true; document: PosPrintDocument; alreadyDone?: boolean }> {
  const storeId = text(body.storeId), documentId = text(body.documentId), operationId = text(body.operationId);
  if (!uuid(documentId) || !uuid(operationId) || !['claim','ack','confirmPrinted','voidIneligible'].includes(body.action)) posPrintDocumentError('伝票の操作内容を確認してください。', 400);
  const requestFingerprint = createHash('sha256').update(JSON.stringify({ action: body.action, storeId, documentId, operationId,
    transport: body.transport || 'direct', reprint: body.reprint === true, physicalConfirmed: body.physicalConfirmed === true,
    expectedRevision: body.expectedRevision ?? null, claimToken: text(body.claimToken), result: text(body.result), error: text(body.error).slice(0,500),
    relayOwner: body.relayOwner || null, initialCheckout: body.initialCheckout === true, checkoutRequestId: text(body.checkoutRequestId) })).digest('hex');
  let row = await readRow(storeId, documentId);
  if (!row) posPrintDocumentError('伝票が見つかりません。', 404);
  const previous = await sql`select action,employee_id::text as employee_id,request_fingerprint,result from pos_print_document_operations where document_id::text=${documentId} and operation_id::text=${operationId}`;
  if (previous[0]) {
    if (previous[0].action !== body.action || previous[0].employee_id !== session.id || previous[0].request_fingerprint !== requestFingerprint) posPrintDocumentError('操作番号が別の処理で使用されています。');
    if (body.action === 'claim') return { document: document(row), transport: row.transport === 'relay' ? 'relay' : 'direct', shouldPrint: false, alreadyDone: true };
    return { ok: true, document: document(row), alreadyDone: true };
  }
  const locks = [relayPrintLock(storeId), sql`select id from store_customer_orders where id::text=${row.orderId} and store_id::text=${storeId} for update`];
  const operationAbsent = `not exists(select 1 from pos_print_document_operations op where op.document_id=d.id and op.operation_id='${operationId}'::uuid)`;
  let token = '', payload: PosPrintPayload | undefined, relayId: string | null = null;
  const writes = [...locks];
  if (body.action === 'ack') {
    if (!uuid(body.claimToken) || !['sent','uncertain'].includes(text(body.result))) posPrintDocumentError('印刷結果を確認してください。', 400);
    token = text(body.claimToken);
    writes.push(sql`update pos_print_documents d set state=${body.result},error=${text(body.error).slice(0,500)},revision=revision+1,updated_at=now()
      where d.id::text=${documentId} and d.store_id::text=${storeId} and d.transport='direct' and d.claim_token::text=${token}
        and d.claimed_by::text=${session.id} and d.state in ('sending','uncertain') and ${sql.unsafe(operationAbsent)} returning d.id`);
  } else if (body.action === 'voidIneligible') {
    if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) posPrintDocumentError('最新の伝票一覧を読み込んでください。', 400);
    if (body.physicalConfirmed !== true) posPrintDocumentError('現物と返金・キャンセル・お渡し済みを確認してください。', 400);
    if (row.eligible || row.effectiveState !== 'uncertain') posPrintDocumentError('印刷結果が不明で、印刷対象外になった伝票だけを終了できます。');
    // Update the document while its linked transport still proves an uncertain
    // result. Then fence that exact old token in the same transaction. A late
    // Android ACK either wins first (and rejects this action) or is rejected.
    writes.push(sql`select id from store_relay_print_jobs where id::text=${text(row.relay_job_id)} for update`);
    writes.push(sql`update pos_print_documents d set state='cancelled',transport=null,claim_token=null,
      claim_operation_id=${operationId}::uuid,claimed_by=${session.id}::uuid,error='現物確認により印刷対象外の伝票を終了しました。',
      revision=revision+1,updated_at=now()
      from store_customer_orders o where o.id=d.order_id and d.id::text=${documentId} and d.store_id::text=${storeId}
        and d.revision=${Number(body.expectedRevision)} and ${sql.unsafe(operationAbsent)}
        and not ${sql.unsafe(posPrintDocumentEligibleSql)} and ${sql.unsafe(mutationStateSql)}='uncertain'
      returning d.id`);
    writes.push(sql`update store_relay_print_jobs j set state='cancelled',claim_token=null,
      error='現物確認により印刷対象外の伝票を終了しました。',updated_at=now()
      where j.id::text=${text(row.relay_job_id)} and (j.state='uncertain'
        or (j.state='sending' and j.claimed_at<clock_timestamp()-interval '2 minutes'))
        and exists(select 1 from pos_print_documents d where d.id::text=${documentId}
          and d.claim_operation_id::text=${operationId} and d.revision=${Number(body.expectedRevision) + 1})`);
  } else {
    if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) posPrintDocumentError('最新の伝票一覧を読み込んでください。', 400);
    if (body.action === 'claim' && !row.eligible) posPrintDocumentError('返金・キャンセル・お渡し済みの伝票は印刷できません。');
    if (body.action === 'confirmPrinted' && !row.eligible) posPrintDocumentError('印刷対象外の伝票は、現物を確認して終了してください。');
    if (row.effectiveState === 'sending') posPrintDocumentError('印刷中です。完了を確認してください。');
    if (body.action === 'confirmPrinted' && body.physicalConfirmed !== true) posPrintDocumentError('印刷した実物を確認してください。', 400);
    if (body.action === 'claim' && row.effectiveState !== 'pending' && !(body.physicalConfirmed && body.reprint)) posPrintDocumentError('実物を確認し、再印刷を選択してください。');
    if (row.effectiveState === 'cancelled') posPrintDocumentError('終了した伝票は印刷できません。');
    const transport = body.transport === 'relay' ? 'relay' : 'direct';
    if (body.action === 'claim') {
      const originalSummary = row.customerSummary as Record<string, unknown> | undefined;
      const initialDrawer = transport === 'direct' && body.initialCheckout === true && text(body.checkoutRequestId) !== ''
        && text(body.checkoutRequestId) === text(row.checkoutRequestId) && row.kind === 'receipt' && Number(row.copyNumber) === 1
        && row.mode === 'auto' && Number(row.revision) === 0 && row.effectiveState === 'pending'
        && originalSummary?.cashierId === session.id && Date.now() - Date.parse(text(row.orderCreatedAt)) < 120000;
      payload = await currentPayload(storeId, row, initialDrawer);
      if (transport === 'direct' && row.relayState === 'pending') posPrintDocumentError('中継端末で印刷待ちです。重複印刷を防ぐため完了を確認してください。');
      if (transport === 'relay') {
        if (!body.relayOwner) posPrintDocumentError('印刷するレジを取得してください。');
        const station = (await relayStations(storeId)).find(s => s.id === body.relayOwner?.stationId && s.enabled && s.print_enabled && s.device_online);
        if (!station) posPrintDocumentError('中継端末の接続を確認してください。');
        await requireRelayOwner(storeId, body.relayOwner, session);
        writes.push(ownerGuardSql(storeId, body.relayOwner, session));
        if (payload.printer.deviceType !== 'escpos_network') posPrintDocumentError('中継印刷は Wi-Fi / LAN のプリンターに対応しています。');
        relayId = randomUUID();
      } else token = randomUUID();
    }
    // A physically reviewed uncertain send is fenced before another transport can
    // own it. The Android agent's old token can no longer acknowledge that job.
    writes.push(sql`update store_relay_print_jobs j set state='cancelled',claim_token=null,error='実物確認により実行権を終了しました。',updated_at=now()
      where j.id::text=${text(row.relay_job_id)} and j.state in ('pending','uncertain','sending')
        and ${body.physicalConfirmed === true} and ((j.state='pending' and ${body.action === 'confirmPrinted'}) or j.state='uncertain' or j.claimed_at<clock_timestamp()-interval '2 minutes')
        and exists(select 1 from pos_print_documents d where d.id::text=${documentId} and d.revision=${Number(body.expectedRevision)} and ${sql.unsafe(operationAbsent)})`);
    const mayReplace = body.action === 'confirmPrinted' ? true : Boolean(body.physicalConfirmed && body.reprint);
    writes.push(sql`update pos_print_documents d set state=${body.action === 'confirmPrinted' ? 'sent' : relayId ? 'pending' : 'sending'},
      transport=${body.action === 'confirmPrinted' ? null : transport},relay_job_id=null,claim_token=${token || null}::uuid,
      claim_operation_id=${operationId}::uuid,claimed_by=${session.id}::uuid,claimed_at=now(),error='',revision=revision+1,updated_at=now()
      from store_customer_orders o where o.id=d.order_id and d.id::text=${documentId} and d.store_id::text=${storeId}
        and d.revision=${Number(body.expectedRevision)} and ${sql.unsafe(operationAbsent)} and ${sql.unsafe(posPrintDocumentEligibleSql)}
        and (${body.action === 'confirmPrinted'} or o.payment_status=${text(row.paymentStatus)})
        and (${sql.unsafe(mutationStateSql)}='pending' or (${mayReplace} and ${sql.unsafe(mutationStateSql)} in ('not_requested','sent','uncertain','cancelled')))
        and not exists(select 1 from store_relay_print_jobs active where active.id=d.relay_job_id and active.state in ('pending','sending')
          and not (active.state='sending' and active.claimed_at<clock_timestamp()-interval '2 minutes' and ${body.physicalConfirmed === true}))
      returning d.id`);
    if (relayId && payload && body.relayOwner) {
      writes.push(sql`insert into store_relay_print_jobs(id,station_id,store_id,order_id,document_key,sequence,kind,payload,created_by)
        select ${relayId}::uuid,${body.relayOwner.stationId}::uuid,${storeId}::uuid,d.order_id,${`ledger-reprint:${documentId}:${operationId}`},d.sequence,
          case when d.kind='finishing' then 'kitchen' else d.kind end,${JSON.stringify(payload)}::jsonb,${session.id}::uuid from pos_print_documents d
        where d.id::text=${documentId} and d.claim_operation_id::text=${operationId} and d.revision=${Number(body.expectedRevision) + 1}
        on conflict(document_key) do nothing`);
      writes.push(sql`update pos_print_documents set relay_job_id=${relayId}::uuid where id::text=${documentId} and claim_operation_id::text=${operationId} and revision=${Number(body.expectedRevision) + 1}
        and exists(select 1 from store_relay_print_jobs where id=${relayId}::uuid)`);
    }
  }
  writes.push(sql`insert into pos_print_document_operations(document_id,operation_id,action,employee_id,request_fingerprint,result)
    select d.id,${operationId}::uuid,${body.action},${session.id}::uuid,${requestFingerprint},${JSON.stringify({ result: body.result, transport: body.transport, physicalConfirmed: body.physicalConfirmed === true, reprint: body.reprint === true })}::jsonb
    from pos_print_documents d where d.id::text=${documentId} and d.store_id::text=${storeId}
      and (${body.action === 'ack'} and d.claim_token::text=${token} and d.claimed_by::text=${session.id} and d.state=${body.result || ''}
        or ${body.action !== 'ack'} and d.claim_operation_id::text=${operationId} and d.revision=${Number(body.expectedRevision || 0) + 1})
    on conflict(document_id,operation_id) do nothing returning id`);
  writes.push(sql`select 1 / case when exists(select 1 from pos_print_document_operations
    where document_id::text=${documentId} and operation_id::text=${operationId} and action=${body.action} and employee_id::text=${session.id} and request_fingerprint=${requestFingerprint})
    then 1 else 0 end as print_operation_committed`);
  const results = await sql.transaction(writes);
  const completed = results.at(-2)?.length;
  if (!completed) {
    const raced = await sql`select action,employee_id::text as employee_id,request_fingerprint from pos_print_document_operations where document_id::text=${documentId} and operation_id::text=${operationId}`;
    if (!raced[0] || raced[0].action !== body.action || raced[0].employee_id !== session.id || raced[0].request_fingerprint !== requestFingerprint) posPrintDocumentError('伝票の実行権または状態が変わりました。最新の状態を確認してください。');
    row = (await readRow(storeId, documentId))!;
    if (body.action === 'claim') return { document: document(row), transport: row.transport === 'relay' ? 'relay' : 'direct', shouldPrint: false, alreadyDone: true };
    return { ok: true, document: document(row), alreadyDone: true };
  }
  row = (await readRow(storeId, documentId))!;
  if (body.action !== 'claim') return { ok: true, document: document(row) };
  return { document: document(row), transport: relayId ? 'relay' : 'direct', shouldPrint: !relayId, queued: Boolean(relayId),
    ...(relayId ? {} : { claimToken: token, payload }) };
}
