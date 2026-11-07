import { createHash, randomUUID } from 'node:crypto';
import { sql } from './db';
import { relayPrintLock } from './store-relay-print-policy';
import { applyPosReceiptTaxBreakdown, normalizePosPrinterSettings, resolvePosReceiptTemplate, type PosPrintPayload } from './pos-printer';
import { invoiceRecipientStem, validateInvoiceDetails } from './pos-invoice';

const validId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function failure(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
export async function readInvoiceIssuance(storeId: string, orderId: string) {
  if (!validId(orderId)) failure('取引番号を確認してください。', 400);
  const orders = await sql`select id::text,payment_status,status from store_customer_orders where store_id::text=${storeId} and id::text=${orderId}`;
  if (!orders[0]) failure('取引が見つかりません。', 404);
  const docs = await sql`select id::text,payload,brand_id::text,sequence,created_at::text from pos_print_documents where store_id::text=${storeId} and order_id::text=${orderId} and kind='receipt' order by sequence,id`;
  const existing = docs.find(row => (row.payload as PosPrintPayload)?.order?.receiptRequested);
  const original = docs.find(row => !(row.payload as PosPrintPayload)?.order?.receiptRequested);
  const paid = orders[0].payment_status === 'paid' && !['cancelled','refund_pending'].includes(String(orders[0].status));
  const reason = !paid ? '返金・キャンセルされた取引には領収書を発行できません。' : !original && !existing ? 'この取引には保存されたレシートがありません。' : '';
  return { orderId, eligible: !reason, reason, existing, original };
}

/** The original receipt and money records are immutable. A fixed document key
 * plus the same lock used by refunds makes issuance one-per-order and retry safe. */
export async function issuePosInvoice(input: { storeId: string; orderId: string; operationId: string; receiptRecipientName?: unknown; receiptPurposeText?: unknown }, employeeId: string) {
  if (!validId(input.operationId)) failure('操作番号を確認してください。', 400);
  const details = validateInvoiceDetails(input);
  const state = await readInvoiceIssuance(input.storeId, input.orderId);
  if (!state.eligible) failure(state.reason);
  if (state.existing) return { ok: true, alreadyIssued: true, orderId: input.orderId, documentId: String(state.existing.id) };
  const original = state.original!;
  const settingsRows = await sql`select printer_settings from pos_store_settings where store_id::text=${input.storeId}`;
  const settings = normalizePosPrinterSettings(settingsRows[0]?.printer_settings);
  const template = structuredClone(resolvePosReceiptTemplate(settings, original.brand_id as string | undefined, 'invoice'));
  for (const key of ['logoUrl', 'promotionImageUrl'] as const) if (template[key]) template[key] = new URL(template[key], 'https://www.foundr1.jp').toString();
  const source = original.payload as PosPrintPayload;
  const fingerprint = createHash('sha256').update(JSON.stringify({ orderId: input.orderId, ...details })).digest('hex');
  const documentId = randomUUID();
  const receipt = applyPosReceiptTaxBreakdown(template, { ...source.order!, receiptRequested: true, receiptTitle: template.invoiceTitle,
    receiptRecipientName: invoiceRecipientStem(details.receiptRecipientName ?? template.invoiceRecipientName),
    receiptPurposeText: details.receiptPurposeText ?? template.invoicePurposeText });
  const payload = { ...structuredClone(source), ...receipt, printer: { ...source.printer, openCashDrawer: false },
    invoiceIssuance: { originalDocumentId: original.id, operationId: input.operationId, employeeId, issuedAt: new Date().toISOString(), requestFingerprint: fingerprint } };
  await sql.transaction([
    relayPrintLock(input.storeId),
    sql`select 1 / case when exists(select 1 from store_customer_orders where id::text=${input.orderId} and store_id::text=${input.storeId}
      and payment_status='paid' and status not in ('cancelled','refund_pending')) then 1 else 0 end as invoice_sale_current`,
    sql`insert into pos_print_documents(id,store_id,order_id,brand_id,document_key,kind,sequence,copy_number,pickup_code,target,payload,mode,state)
      select ${documentId}::uuid,${input.storeId}::uuid,${input.orderId}::uuid,original.brand_id,'invoice:order:1','receipt',
      (select coalesce(max(sequence),0)+1 from pos_print_documents where order_id::text=${input.orderId}),1,original.pickup_code,'receipt',${JSON.stringify(payload)}::jsonb,'deferred','pending'
      from pos_print_documents original where original.id::text=${String(original.id)} and original.store_id::text=${input.storeId}
      and original.payload=${JSON.stringify(source)}::jsonb
      and not exists(select 1 from pos_print_documents issued where issued.order_id::text=${input.orderId} and issued.payload->'order'->>'receiptRequested'='true')
      on conflict(order_id,document_key) do nothing`
  ]);
  const current = await readInvoiceIssuance(input.storeId, input.orderId);
  if (!current.existing) failure('取引の状態が変わりました。最新の状態を確認してください。');
  return { ok: true, alreadyIssued: current.existing.id !== documentId, orderId: input.orderId, documentId: String(current.existing.id) };
}
