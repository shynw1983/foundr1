import { canAccessStore, requireOsSession } from './api-auth';
import { getPermissionsForRole } from './role-permissions';
import { sql } from './db';
export const gbpHeaders = { 'Cache-Control': 'no-store' };
export const gbpJson = (body: unknown, status = 200) => Response.json(body, { status, headers: gbpHeaders });
export function googleBusinessSameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin;
}
export async function requireGoogleBusinessAccess(storeId: string) {
  const session = await requireOsSession();
  if (!session) return { error: gbpJson({ error: 'ログインしてください。' }, 401) };
  const permissions = await getPermissionsForRole(session.role, { fresh: true });
  if (!['owner','manager','store_owner','store_manager'].includes(session.role) || !permissions.has('module.timecard') || !await canAccessStore(session, storeId)) return { error: gbpJson({ error: 'この店舗を操作する権限がありません。' }, 403) };
  const stores = await sql`select id from stores where id::text=${storeId} and status='active'`;
  if (!stores[0]) return { error: gbpJson({ error: '店舗が見つかりません。' }, 404) };
  return { session };
}
