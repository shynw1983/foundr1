import { sql } from '../../../../lib/db';
import { alertProjection, alertReadJoin, authorizeHqAlertStore, hqAlertReader, hqAlertRealtime, hqJson, publishHqAlertChange } from '../../../../lib/store-hq-alerts';
import { hqAlertDeviceLabel, hqAlertUuid } from '../../../../lib/store-hq-alert-policy';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await authorizeHqAlertStore(new URL(request.url).searchParams.get('storeId')); if (auth.error) return auth.error;
  const alerts = await sql.query(`select ${alertProjection} from store_hq_alerts a ${alertReadJoin}
    where a.store_id=$1::uuid and receipt.read_at is null order by a.created_at,a.id limit 50`, [auth.storeId]);
  return hqJson({ storeId: auth.storeId, alerts, realtime: hqAlertRealtime(auth.storeId) });
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const auth = await authorizeHqAlertStore(body?.storeId); if (auth.error) return auth.error;
  if (!hqAlertUuid.test(String(body?.alertId || '')) || !hqAlertUuid.test(String(body?.deviceId || '')) || !['delivered', 'read'].includes(body?.action)) return hqJson({ error: '通知の確認内容が不正です。' }, 400);
  // Never accept a client-provided employee name or identity.
  const reader = body.action === 'read' ? await hqAlertReader(auth.session, auth.storeId) : null;
  const rows = await sql`insert into store_hq_alert_receipts (alert_id,device_id,device_label,read_at,reader_employee_id,reader_name)
    select a.id,${body.deviceId}::uuid,${hqAlertDeviceLabel(request.headers.get('user-agent') || '')},
      case when ${Boolean(reader)} then now() else null end,${reader?.id || null}::uuid,${reader?.name || null}
    from store_hq_alerts a where a.id=${body.alertId}::uuid and a.store_id=${auth.storeId}::uuid
    on conflict (alert_id,device_id) do update set
      read_at=coalesce(store_hq_alert_receipts.read_at,excluded.read_at),
      reader_employee_id=case when store_hq_alert_receipts.read_at is null then excluded.reader_employee_id else store_hq_alert_receipts.reader_employee_id end,
      reader_name=case when store_hq_alert_receipts.read_at is null then excluded.reader_name else store_hq_alert_receipts.reader_name end
    returning alert_id`;
  if (!rows[0]) return hqJson({ error: '通知が見つかりません。' }, 404);
  await publishHqAlertChange(auth.storeId);
  return hqJson({ ok: true });
}
