import { requireOsSession } from '../../../../../lib/api-auth';
import { sql } from '../../../../../lib/db';
import { roleHasPermission } from '../../../../../lib/role-permissions';
import { getScopedStoreFilter, getStoreOrderAccess } from '../../../../../lib/store-order-access';
import type { PosSavedPrintDocument, PosSavedPrintOrder } from '../../../../../lib/pos-saved-print-preview';

export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (!await roleHasPermission(session.role, 'pos.manageSettings')) return Response.json({ error: '権限がありません。' }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const requestedStore = params.get('storeId') || '', orderId = params.get('orderId') || '';
  const query = (params.get('query') || '').trim();
  if (!uuid.test(requestedStore) || (orderId && !uuid.test(orderId)) || !/^[a-z0-9 -]{0,40}$/i.test(query)) {
    return Response.json({ error: '店舗・注文番号を確認してください。' }, { status: 400, headers });
  }
  const access = await getStoreOrderAccess(session);
  const storeId = getScopedStoreFilter(access, requestedStore);
  if (!storeId || storeId === '__forbidden__' || !access.stores.some(store => store.id === storeId)) {
    return Response.json({ error: '権限がありません。' }, { status: 403, headers });
  }
  try {
    const orders = await sql`
      select o.id::text as "orderId", o.pickup_code as "pickupCode", o.created_at::text as "createdAt",
        (select count(*)::int from pos_print_documents d where d.store_id=o.store_id and d.order_id=o.id) as "documentCount",
        case when o.customer_summary->>'memberLanguage' in ('ja','en','zh','zh-Hans','zh-Hant','ko','vi','ne')
          then o.customer_summary->>'memberLanguage' else 'ja' end as "memberLanguage"
      from store_customer_orders o
      where o.store_id::text=${storeId}
        and exists(select 1 from pos_print_documents d where d.store_id=o.store_id and d.order_id=o.id
          and (${query}='' or d.pickup_code ilike ${'%' + query + '%'} or o.pickup_code ilike ${'%' + query + '%'}))
      order by o.created_at desc, o.id desc limit 21
    `;
    let documents: PosSavedPrintDocument[] = [];
    if (orderId) {
      const order = await sql`select id from store_customer_orders where id::text=${orderId} and store_id::text=${storeId} limit 1`;
      if (!order.length) return Response.json({ error: 'この店舗の注文が見つかりません。' }, { status: 404, headers });
      documents = await sql`
        select d.id::text, d.order_id::text as "orderId", d.kind, d.sequence, d.copy_number as "copyNumber",
          d.pickup_code as "pickupCode", d.state, d.created_at::text as "createdAt",
          jsonb_build_object('jobType',d.payload->'jobType','documentRole',d.payload->'documentRole',
            'storeName',d.payload->'storeName','printedAt',d.payload->'printedAt',
            'kitchenTicketTemplate',d.payload->'kitchenTicketTemplate','receiptTemplate',d.payload->'receiptTemplate',
            'order',d.payload->'order','paperWidth',coalesce(d.payload#>>'{printer,paperWidth}','80mm')) as content
        from pos_print_documents d join store_customer_orders o on o.id=d.order_id and o.store_id=d.store_id
        where d.store_id::text=${storeId} and d.order_id::text=${orderId}
        order by d.sequence, d.id limit 101
      ` as PosSavedPrintDocument[];
    }
    return Response.json({ selectedStoreId: storeId, orders: (orders as PosSavedPrintOrder[]).slice(0,20),
      documents: documents.slice(0,100), hasMoreDocuments: documents.length>100, hasMoreOrders: orders.length>20 }, { headers });
  } catch (error) {
    console.error('pos saved print preview', error);
    return Response.json({ error: '保存済み伝票を読み込めませんでした。もう一度お試しください。' }, { status: 503, headers });
  }
}
