import { createHash } from 'node:crypto';
import { requireOsSession } from '../../../../../lib/api-auth';
import { roleHasPermission } from '../../../../../lib/role-permissions';
import { getStoreOrderAccess } from '../../../../../lib/store-order-access';
import { sql } from '../../../../../lib/db';
import { dineInUuid, parseDineInChange } from '../../../../../lib/store-dine-in-menu-policy';
import { mutateDineInMenu, readDineInEditor } from '../../../../../lib/store-dine-in-menu';
export const dynamic = 'force-dynamic';
function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
function errorResponse(error: unknown) {
  const e = error as { status?: number; code?: string; message?: string };
  if (e.code === '42P01' || e.code === '42703') return Response.json({ error: '店内メニューのデータベース更新が必要です。' }, { status: 503 });
  if (e.code === '22012' || e.code === '23505') return Response.json({ error: '設定が変更されました。再読込して確認してください。' }, { status: 409 });
  if (!e.status) console.error('store dine-in menu', error);
  return Response.json({ error: e.status ? e.message : '店内メニューの処理に失敗しました。' }, { status: e.status || 500 });
}
async function access(storeId: string, brandId: string) {
  const session = await requireOsSession(); if (!session) fail('ログインしてください。', 401);
  if (!await roleHasPermission(session.role, 'menus.edit')) fail('権限がありません。', 403);
  if (!dineInUuid.test(storeId) || !dineInUuid.test(brandId)) fail('店舗とブランドを選択してください。', 400);
  const scope = await getStoreOrderAccess(session);
  if (!scope.stores.some(store => store.id === storeId)) fail('権限がありません。', 403);
  const brand = await sql`select 1 from store_brands sb join brands b on b.id=sb.brand_id join stores s on s.id=sb.store_id
    where sb.store_id::text=${storeId} and sb.brand_id::text=${brandId} and b.status='active' and s.status='active'`;
  if (!brand.length) fail('この店舗のブランドを選択してください。', 403);
  return session;
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, storeId = params.get('storeId') || '', brandId = params.get('brandId') || '';
    await access(storeId, brandId);
    return Response.json(await readDineInEditor(storeId, brandId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') fail('アクセス元を確認できません。', 403);
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { fail('入力内容を確認してください。', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('入力内容を確認してください。', 400);
    const storeId = String(body.storeId || ''), brandId = String(body.brandId || '');
    const session = await access(storeId, brandId), change = parseDineInChange(body);
    // Parsed fixed field order makes equivalent JSON key ordering replay safely.
    const fingerprint = createHash('sha256').update(JSON.stringify({ storeId, brandId, ...change })).digest('hex');
    const result = await mutateDineInMenu(storeId, brandId, session.id, change, fingerprint);
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
