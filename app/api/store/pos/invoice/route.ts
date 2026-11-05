import { requireOsSession } from '../../../../../lib/api-auth';
import { getScopedStoreFilter, getStoreOrderAccess } from '../../../../../lib/store-order-access';
import { readInvoiceIssuance, issuePosInvoice } from '../../../../../lib/pos-invoice-issuance';
import { posPrintDocumentResponse } from '../../../../../lib/pos-print-document-ledger';
import { rejectDebugWrite } from '../../../../../lib/pos-debug-write';
export const dynamic = 'force-dynamic';
async function scope(storeId: string, existingSession?: Awaited<ReturnType<typeof requireOsSession>>) {
  const session = existingSession === undefined ? await requireOsSession() : existingSession;
  if (!session) return { response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  const access = await getStoreOrderAccess(session), scoped = getScopedStoreFilter(access, storeId);
  if (!storeId || !scoped || scoped === '__forbidden__' || !access.stores.some(store => store.id === scoped)) return { response: Response.json({ error: '権限がありません。' }, { status: 403 }) };
  return { session, storeId: scoped };
}
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, auth = await scope(params.get('storeId') || '');
  if (auth.response) return auth.response;
  try {
    const state = await readInvoiceIssuance(auth.storeId!, params.get('orderId') || '');
    const order = (state.existing?.payload as { order?: { receiptRecipientName?: string; receiptPurposeText?: string } })?.order;
    return Response.json({ eligible: state.eligible, reason: state.reason, issued: Boolean(state.existing), documentId: state.existing?.id,
      receiptRecipientName: order?.receiptRecipientName || '', receiptPurposeText: order?.receiptPurposeText || '飲食代' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return posPrintDocumentResponse(error); }
}
export async function POST(request: Request) {
  const debug = rejectDebugWrite(request); if (debug) return debug;
  const session = await requireOsSession(); if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'アクセス元を確認できません。' }, { status: 403 });
  const body = await request.json().catch(() => ({})); const auth = await scope(String(body.storeId || ''), session);
  if (auth.response) return auth.response;
  try { return Response.json(await issuePosInvoice({ storeId: auth.storeId!, orderId: String(body.orderId || ''), operationId: String(body.operationId || ''),
    receiptRecipientName: body.receiptRecipientName, receiptPurposeText: body.receiptPurposeText }, session.id)); }
  catch (error) { return posPrintDocumentResponse(error); }
}
