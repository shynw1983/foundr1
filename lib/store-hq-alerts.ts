import type { EmployeeSession } from './auth';
import { canAccessStore, getSessionStoreScope, requireOsSession } from './api-auth';
import { sql } from './db';
import { getPusher } from './order-realtime';
import { readPosOperatorContext } from './pos-operator-access';
import { canUseFullStoreWorkbench } from './store-inventory-policy';
import { canSendHqAlert, hqAlertChannel, hqAlertUuid } from './store-hq-alert-policy';

export const hqJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function authorizeHqAlertStore(storeId: unknown, headquarters = false) {
  const session = await requireOsSession();
  if (!session) return { error: hqJson({ error: 'ログインしてください。' }, 401) };
  if ((headquarters ? !canSendHqAlert(session.role) : !canUseFullStoreWorkbench(session.role))) return { error: hqJson({ error: '権限がありません。' }, 403) };
  if (typeof storeId !== 'string' || !hqAlertUuid.test(storeId)) return { error: hqJson({ error: '店舗を選択してください。' }, 400) };
  if (!await canAccessStore(session, storeId)) return { error: hqJson({ error: '権限がありません。' }, 403) };
  const stores = await sql`select id from stores where id=${storeId}::uuid and status='active'`;
  if (!stores[0]) return { error: hqJson({ error: '有効な店舗が見つかりません。' }, 404) };
  return { session, storeId };
}
export async function hqAlertStores(session: EmployeeSession) {
  const scope = await getSessionStoreScope(session);
  return sql`select id::text,name from stores where status='active' and (${scope.allStores} or id::text=any(${scope.storeIds}::text[])) order by name,id`;
}
export function hqAlertRealtime(storeId: string) {
  return { key: process.env.PUSHER_KEY || '', cluster: process.env.PUSHER_CLUSTER || '', channel: hqAlertChannel(storeId) };
}
export async function publishHqAlertChange(storeId: string) {
  try { await getPusher()?.trigger(hqAlertChannel(storeId), 'hq-alert.updated', { updatedAt: new Date().toISOString() }); }
  catch { console.warn('[hq-alert] realtime unavailable; polling will recover'); }
}
export async function hqAlertReader(session: EmployeeSession, storeId: string) {
  const context = await readPosOperatorContext(session, storeId);
  if (context.operator) return { id: context.operator.id, name: context.operator.name };
  return { id: session.id, name: session.role === 'store_terminal' ? '店舗端末（担当者未確認）' : session.name };
}
export const alertProjection = `a.id::text,a.store_id::text as "storeId",a.message,a.sender_name as "senderName",a.created_at as "createdAt",
  (select min(r.delivered_at) from store_hq_alert_receipts r where r.alert_id=a.id) as "deliveredAt",
  receipt.read_at as "readAt",receipt.reader_name as "readerName",receipt.device_label as "readerDevice"`;
export const alertReadJoin = `left join lateral (select read_at,reader_name,device_label from store_hq_alert_receipts where alert_id=a.id and read_at is not null order by read_at,device_id limit 1) receipt on true`;
