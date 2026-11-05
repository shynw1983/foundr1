import { createHash, randomBytes, randomInt } from 'node:crypto';
import { sql } from './db';
import type { EmployeeSession } from './auth';
import { getStoreOrderAccess, getScopedStoreFilter } from './store-order-access';
import type { RelayOwner } from './store-relay-policy';
// Explicit register opening, never device time or scheduled business hours.
// All callers use the station alias s; this is a fixed SQL expression.
export const relayRegisterOpenSql = "exists(select 1 from pos_cash_sessions c where c.store_id=s.store_id and c.status='open')";
export const relayHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const relaySecret = () => randomBytes(32).toString('base64url');
export const relayPairingCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0');
export function relayError(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
export function relayResponse(error: unknown) {
  const e = error as { status?: number; code?: string; message?: string };
  if (e.code === '42P01' || e.code === '42703') return Response.json({ error: '設備中継のデータベース更新が必要です。' }, { status: 503 });
  if (!e.status) console.error('store relay', error);
  return Response.json({ error: e.status ? e.message : '設備中継の処理に失敗しました。' }, { status: e.status || 500 });
}
export function assertRelayOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) relayError('アクセス元を確認できません。', 403);
}
export async function relayStoreAccess(session: EmployeeSession, storeId: string) {
  const access = await getStoreOrderAccess(session);
  if (!storeId || getScopedStoreFilter(access, storeId) === '__forbidden__' || !access.stores.some(s => s.id === storeId)) relayError('権限がありません。', 403);
}
export async function relayStations(storeId: string) {
  try {
    return await sql`select s.id, s.name, s.enabled, s.print_enabled, s.scale_enabled, s.epoch,
      s.owner_until, s.owner_employee_id, (${sql.unsafe(relayRegisterOpenSql)}) as register_open,
      (${sql.unsafe(relayRegisterOpenSql)} and s.scale_enabled) as scale_operating,
      case when s.owner_until>now() and ${sql.unsafe(relayRegisterOpenSql)} then s.scale_session else null end as scale_session, s.scale_sequence, s.scale_reading, s.scale_received_at,
      case when s.owner_until>now() and s.scale_session is not null then s.scale_tare_context else '{}'::jsonb end as scale_tare_context,
      coalesce(p.scale_tare_settings,'{}'::jsonb) as scale_tare_settings,
      coalesce(p.scale_filter_settings,'{}'::jsonb) as scale_filter_settings,
      d.id as device_id, d.heartbeat_at, d.status as device_status,
      (d.token_hash <> '' and not d.revoked) as device_paired,
      (d.heartbeat_at > now()-interval '30 seconds' and not d.revoked and d.token_hash <> '') as device_online
      from store_relay_stations s left join store_relay_devices d on d.station_id=s.id
      left join pos_store_settings p on p.store_id=s.store_id
      where s.store_id::text=${storeId} order by s.name`;
  } catch (error) { if ((error as {code?:string}).code === '42P01') return []; throw error; }
}
export async function activeRelayDevice(request: Request) {
  const secret = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!secret) relayError('端末認証が必要です。', 401);
  const rows = await sql`select d.id, d.station_id, s.store_id, s.print_enabled, s.scale_enabled, s.scale_session, s.epoch
    from store_relay_devices d join store_relay_stations s on s.id=d.station_id
    where d.token_hash=${relayHash(secret)} and not d.revoked and s.enabled`;
  if (!rows[0]) relayError('端末認証が無効です。', 401);
  return rows[0];
}
export function ownerGuardSql(storeId: string, owner: RelayOwner, session: EmployeeSession) {
  return sql`select 1 / case when exists(select 1 from store_relay_stations
    where id::text=${owner.stationId || ''} and store_id::text=${storeId} and enabled
      and epoch=${Number.isSafeInteger(owner.epoch) ? owner.epoch : -1} and owner_hash=${relayHash(owner.token || '')}
      and owner_employee_id::text=${session.id} and owner_session_id=${session.sessionId || ''}
      and owner_until > now()) then 1 else 0 end as relay_owned`;
}
export async function requireRelayOwner(storeId: string, owner: RelayOwner, session: EmployeeSession) {
  try { await ownerGuardSql(storeId, owner, session); }
  catch (error) { if ((error as {code?: string}).code === '22012') relayError('レジの操作権がありません。レジを取得してください。'); throw error; }
}
