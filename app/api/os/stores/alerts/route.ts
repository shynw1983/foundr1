import { requireMasterOsSession } from '../../../../../lib/api-auth';
import { sql } from '../../../../../lib/db';
import { alertProjection, alertReadJoin, authorizeHqAlertStore, hqAlertRealtime, hqAlertStores, hqJson, publishHqAlertChange } from '../../../../../lib/store-hq-alerts';
import { hqAlertUuid, parseHqAlertDraft } from '../../../../../lib/store-hq-alert-policy';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return hqJson({ error: '権限がありません。' }, 403);
  const params = new URL(request.url).searchParams;
  const stores = await hqAlertStores(session);
  const storeId = params.get('storeId') || String(stores[0]?.id || '');
  if (!storeId) return hqJson({ stores, storeId: '', alerts: [], hasMore: false });
  const auth = await authorizeHqAlertStore(storeId, true); if (auth.error) return auth.error;
  const cursor = params.get('before');
  if (cursor && !hqAlertUuid.test(cursor)) return hqJson({ error: '通知IDが不正です。' }, 400);
  const alerts = await sql.query(`select ${alertProjection} from store_hq_alerts a ${alertReadJoin}
    where a.store_id=$1::uuid and ($2::uuid is null or (a.created_at,a.id)<(select created_at,id from store_hq_alerts where id=$2::uuid and store_id=$1::uuid))
    order by a.created_at desc,a.id desc limit 51`, [storeId, cursor]);
  return hqJson({ stores, storeId, alerts: alerts.slice(0, 50), hasMore: alerts.length > 50, realtime: hqAlertRealtime(storeId) });
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  // Authorize before validating content; no store message may be sent by franchise accounts.
  const auth = await authorizeHqAlertStore(body?.storeId, true); if (auth.error) return auth.error;
  const draft = parseHqAlertDraft(body);
  if (!draft) return hqJson({ error: '連絡内容を1〜1000文字で入力してください。' }, 400);
  const rows = await sql`insert into store_hq_alerts (store_id,sender_employee_id,sender_name,request_id,message)
    values (${auth.storeId}::uuid,${auth.session.id}::uuid,${auth.session.name},${draft.requestId}::uuid,${draft.message})
    on conflict (sender_employee_id,request_id) do update set request_id=store_hq_alerts.request_id
    where store_hq_alerts.store_id=excluded.store_id and store_hq_alerts.message=excluded.message
    returning id::text`;
  if (!rows[0]) return hqJson({ error: '送信内容が変わりました。画面を再読み込みしてください。' }, 409);
  await publishHqAlertChange(auth.storeId);
  return hqJson({ ok: true, id: rows[0].id });
}
