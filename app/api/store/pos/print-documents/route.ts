import { requireOsSession } from '../../../../../lib/api-auth';
import { getScopedStoreFilter, getStoreOrderAccess } from '../../../../../lib/store-order-access';
import { mutatePosPrintDocument, posPrintDocumentResponse, readPosPrintDocumentQueue } from '../../../../../lib/pos-print-document-ledger';
import type { PosPrintDocumentMutation } from '../../../../../lib/pos-print-document-contract';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const access = await getStoreOrderAccess(session);
  const storeId = getScopedStoreFilter(access, params.get('storeId')) || access.stores[0]?.id || '';
  if (!storeId || storeId === '__forbidden__') return Response.json({ error: '権限がありません。' }, { status: 403 });
  try { return Response.json(await readPosPrintDocumentQueue(storeId, params), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return posPrintDocumentResponse(error); }
}
export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'アクセス元を確認できません。' }, { status: 403 });
  const body = await request.json().catch(() => ({})) as PosPrintDocumentMutation;
  const access = await getStoreOrderAccess(session);
  const storeId = getScopedStoreFilter(access, body.storeId);
  if (!storeId || storeId === '__forbidden__' || !access.stores.some(store => store.id === storeId)) return Response.json({ error: '権限がありません。' }, { status: 403 });
  try { return Response.json(await mutatePosPrintDocument({ ...body, storeId }, session), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return posPrintDocumentResponse(error); }
}
