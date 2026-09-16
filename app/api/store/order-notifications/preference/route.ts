import { canAccessStore, requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { getOrderPushRules } from "../../../../../lib/store-order-push";
import { getOrderPushConfig } from "../../../../../lib/store-order-push-transport";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status = 400) => json({ error }, status);
async function schemaReady() {
  const rows = await sql`select to_regclass('public.store_order_push_preferences') is not null as ready`;
  return rows[0]?.ready === true;
}
async function preference(employeeId: string, storeId: string) {
  const rows = await sql`
    select p.store_id::text as "storeId", p.enabled, p.exit_radius_m as "exitRadius",
      p.enter_radius_m as "enterRadius", p.rule_version::text as "version"
    from store_order_push_preferences p join stores s on s.id = p.store_id and s.status = 'active'
    where p.employee_id::text = ${employeeId} and p.store_id::text = ${storeId}
  `;
  return rows[0] ?? null;
}

/** A widget can change only its viewer's existing rule, under the same roles as the settings page. */
export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return fail("ログインしてください。", 401);
  const storeId = new URL(request.url).searchParams.get("storeId") || "";
  if (!uuid.test(storeId)) return fail("店舗を確認してください。");
  if (!await canAccessStore(session, storeId)) return fail("権限がありません。", 403);
  const ready = await schemaReady();
  const config = getOrderPushConfig();
  return json({ storeId, sessionId: session.sessionId, canManage: ["owner", "manager"].includes(session.role),
    ready, deliveryReady: config.enabled && config.fcm,
    preference: ready ? await preference(session.id, storeId) : null,
    rules: ready ? await getOrderPushRules(session.id) : [] });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return fail("ログインしてください。", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("権限がありません。", 403);
  if (!["owner", "manager"].includes(session.role)) return fail("通知設定を変更する権限がありません。", 403);
  const body = await request.json().catch(() => null);
  if (!body || !uuid.test(body.storeId || "") || typeof body.enabled !== "boolean" || !uuid.test(body.expectedVersion || "")
    || Object.keys(body).some(key => !["storeId", "enabled", "expectedVersion"].includes(key))) return fail("通知設定を再読み込みしてください。");
  if (!await canAccessStore(session, body.storeId)) return fail("権限がありません。", 403);
  if (!await schemaReady()) return fail("通知機能は準備中です。", 503);
  // Atomic compare-and-set: a stale widget, duplicate tap or concurrent distance edit cannot overwrite a newer rule.
  // Distances, the recipient, and all other users' rules are deliberately absent from this update.
  const saved = await sql`
    update store_order_push_preferences p
    set enabled = ${body.enabled}, rule_version = gen_random_uuid(), updated_at = now()
    from stores s
    where p.store_id = s.id and s.status = 'active'
      and p.employee_id::text = ${session.id} and p.store_id::text = ${body.storeId}
      and p.rule_version::text = ${body.expectedVersion} and p.enabled is distinct from ${body.enabled}
      and (not ${body.enabled} or (s.attendance_latitude is not null and s.attendance_longitude is not null))
    returning p.store_id::text as "storeId", p.enabled, p.exit_radius_m as "exitRadius",
      p.enter_radius_m as "enterRadius", p.rule_version::text as "version"
  `;
  if (!saved[0]) return fail("設定が変更されたか、未設定です。再読み込みして確認してください。", 409);
  const config = getOrderPushConfig();
  return json({ ok: true, storeId: body.storeId, sessionId: session.sessionId, ready: true, canManage: true,
    deliveryReady: config.enabled && config.fcm, preference: saved[0], rules: await getOrderPushRules(session.id) });
}
