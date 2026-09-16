import { randomBytes, randomUUID } from "node:crypto";
import { canAccessStore, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getStoreOrderAccess } from "../../../../lib/store-order-access";
import { getOrderPushRules, hashPushValue } from "../../../../lib/store-order-push";
import { bridgeOrderAlertPhase } from "../../../../lib/store-order-push-policy";
import { getOrderPushConfig, sendOrderPush, type OrderPushDevice } from "../../../../lib/store-order-push-transport";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (error: string, status = 400) => Response.json({ error }, { status });
async function schemaReady() {
  const rows = await sql`select to_regclass('public.store_order_push_presence') is not null as ready`;
  return rows[0]?.ready === true;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return fail("ログインしてください。", 401);
  const config = getOrderPushConfig();
  const access = await getStoreOrderAccess(session);
  const ready = await schemaReady();
  const canManage = ["owner", "manager"].includes(session.role);
  if (!ready) return Response.json({ config, ready, canManage, stores: access.stores, rules: [], alerts: [], device: null });
  const rules = await getOrderPushRules(session.id);
  const deviceId = new URL(request.url).searchParams.get("deviceId") || "";
  const devices = await sql`
    select id::text, last_success_at as "lastSuccessAt", last_error as "lastError", revoked_at as "revokedAt"
    from store_order_push_devices where id::text = ${deviceId} and employee_id::text = ${session.id} and session_id::text = ${session.sessionId!}
  `;
  const presence = devices[0] ? await sql`
    select store_id::text as "storeId", rule_key as "ruleKey", state, observed_at as "observedAt"
    from store_order_push_presence where device_id::text = ${deviceId}
  ` : [];
  const alerts = await sql`
    select a.id::text, a.order_id::text as "orderId", a.store_id::text as "storeId", s.name as "storeName",
      o.pickup_code as "pickupCode", o.order_source as source, o.amount::float, a.due_at as "createdAt",
      a.acknowledged_at as "acknowledgedAt", a.last_error as "lastError"
    from store_order_alert_events a join store_customer_orders o on o.id = a.order_id join stores s on s.id = a.store_id
    where a.alert_phase = ${bridgeOrderAlertPhase} and a.created_at > now() - interval '24 hours'
      and (${access.allStores} or a.store_id::text = any(${access.storeIds}))
      and o.status in ('new', 'preparing') and a.acknowledged_at is null
      and coalesce(o.customer_summary ->> 'initialAlertAcknowledgedAt', '') = ''
      and not exists (select 1 from order_production_tasks t where t.order_id = o.id and t.status <> 'new')
    order by a.due_at desc limit 50
  `;
  const employees = canManage ? await sql`
    select e.id::text, e.name from employees e where e.status = 'active' and e.role in ('owner', 'manager', 'store_terminal')
      and (${session.role === "owner"} or e.role <> 'owner')
      and (e.role in ('owner', 'manager') or exists (
        select 1 from employee_scopes sc where sc.employee_id = e.id and sc.scope_type = 'store'
          and (${access.allStores} or sc.store_id::text = any(${access.storeIds}))
      )) order by e.name
  ` : [];
  const preferences = canManage ? await sql`
    select p.employee_id::text as "employeeId", e.name as "employeeName", p.store_id::text as "storeId", s.name as "storeName", p.enabled,
      p.exit_radius_m as "exitRadius", p.enter_radius_m as "enterRadius", p.updated_at as "updatedAt"
    from store_order_push_preferences p join employees e on e.id = p.employee_id join stores s on s.id = p.store_id
    where (${access.allStores} or p.store_id::text = any(${access.storeIds})) and (${session.role === "owner"} or e.role <> 'owner')
    order by p.updated_at desc, e.name, s.name
  ` : [];
  return Response.json({ config, ready, canManage, stores: access.stores, employees, preferences, rules, alerts, device: devices[0] ? { ...devices[0], presence } : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return fail("ログインしてください。", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("権限がありません。", 403);
  const body = await request.json().catch(() => ({}));
  if (!await schemaReady()) return fail("通知機能は準備中です。", 503);
  if (body.action === "save_rule") {
    if (!["owner", "manager"].includes(session.role)) return fail("権限がありません。", 403);
    const { employeeId, storeId, exitRadius, enterRadius, enabled } = body;
    if (!uuid.test(employeeId || "") || !uuid.test(storeId || "") || typeof enabled !== "boolean"
      || !Number.isInteger(exitRadius) || !Number.isInteger(enterRadius) || exitRadius < 150 || exitRadius > 10000 || enterRadius < 100 || enterRadius >= exitRadius) return fail("通知設定を確認してください。");
    if (!await canAccessStore(session, storeId)) return fail("権限がありません。", 403);
    const target = await sql`
      select e.id, e.name as "employeeName", s.name as "storeName",
        s.attendance_latitude is not null and s.attendance_longitude is not null as "locationReady"
      from employees e join stores s on s.id::text = ${storeId} and s.status = 'active'
      where e.id::text = ${employeeId} and e.status = 'active' and e.role in ('owner', 'manager', 'store_terminal') and (${session.role === "owner"} or e.role <> 'owner')
        and (e.role in ('owner', 'manager') or exists (select 1 from employee_scopes sc where sc.employee_id = e.id and sc.scope_type = 'store' and sc.store_id = s.id))
    `;
    if (!target.length) return fail("対象ユーザーの店舗権限を確認してください。");
    if (enabled && !target[0].locationReady) return fail("この店舗には打刻用の位置情報がありません。店舗設定で位置情報を登録してください。");
    const saved = await sql`
      insert into store_order_push_preferences (employee_id, store_id, enabled, exit_radius_m, enter_radius_m)
      values (${employeeId}, ${storeId}, ${enabled}, ${exitRadius}, ${enterRadius})
      on conflict (employee_id, store_id) do update set enabled = excluded.enabled, exit_radius_m = excluded.exit_radius_m,
        enter_radius_m = excluded.enter_radius_m, rule_version = gen_random_uuid(), updated_at = now()
      returning employee_id::text as "employeeId", store_id::text as "storeId", enabled,
        exit_radius_m as "exitRadius", enter_radius_m as "enterRadius", updated_at as "updatedAt"
    `;
    return Response.json({ ok: true, preference: { ...saved[0], employeeName: target[0].employeeName, storeName: target[0].storeName } });
  }
  if (body.action === "acknowledge") {
    if (!uuid.test(body.eventId || "")) return fail("通知を確認してください。");
    const target = await sql`select store_id::text as "storeId" from store_order_alert_events where id::text = ${body.eventId} and alert_phase = ${bridgeOrderAlertPhase}`;
    if (!target[0] || !await canAccessStore(session, String(target[0].storeId))) return fail("権限がありません。", 403);
    // Acknowledging changes only alert state; it never accepts, prepares or completes an order.
    await sql`
      update store_order_alert_events set acknowledged_at = coalesce(acknowledged_at, now()),
        acknowledged_by = coalesce(acknowledged_by, ${session.id}::uuid), updated_at = now()
      where id::text = ${body.eventId} and alert_phase = ${bridgeOrderAlertPhase}
    `;
    return Response.json({ ok: true });
  }
  if (body.action === "disable_device") {
    if (!uuid.test(body.deviceId || "")) return fail("端末を確認してください。");
    await sql`update store_order_push_devices set revoked_at = now() where id::text = ${body.deviceId} and employee_id::text = ${session.id}`;
    return Response.json({ ok: true });
  }
  const config = getOrderPushConfig();
  if (!config.enabled || !config.fcm) return fail("通知機能は準備中です。", 503);
  if (body.action === "register") {
    if (!uuid.test(body.deviceId || "") || typeof body.token !== "string" || body.token.length < 20 || body.token.length > 4096) return fail("端末を確認してください。");
    const rules = await getOrderPushRules(session.id);
    if (!rules.length) return fail("このユーザーには離店通知が設定されていません。", 403);
    const secret = randomBytes(32).toString("base64url");
    const tokenHash = hashPushValue(body.token);
    const language = ["ja", "zh-Hans", "zh-Hant"].includes(body.language) ? body.language : "ja";
    // Endpoint possession rebinds the physical phone to its current account, so old accounts no longer receive it.
    const existing = await sql`select id::text from store_order_push_devices where endpoint_hash = ${tokenHash}`;
    const deviceId = String(existing[0]?.id || body.deviceId);
    const collision = await sql`select employee_id::text as "employeeId" from store_order_push_devices where id::text = ${deviceId} and endpoint_hash <> ${tokenHash}`;
    if (collision[0] && collision[0].employeeId !== session.id) return fail("端末登録をやり直してください。", 409);
    await sql`
      insert into store_order_push_devices (id, employee_id, session_id, endpoint_hash, presence_token_hash, registration, language)
      values (${deviceId}, ${session.id}, ${session.sessionId!}, ${tokenHash}, ${hashPushValue(secret)}, ${JSON.stringify({ token: body.token })}::jsonb, ${language})
      on conflict (id) do update set employee_id = excluded.employee_id, session_id = excluded.session_id,
        endpoint_hash = excluded.endpoint_hash, presence_token_hash = excluded.presence_token_hash, registration = excluded.registration,
        language = excluded.language, revoked_at = null, last_error = '', updated_at = now()
    `;
    await sql`delete from store_order_push_presence where device_id::text = ${deviceId}`;
    return Response.json({ ok: true, deviceId, presenceToken: secret, sessionId: session.sessionId, rules });
  }
  if (body.action === "test") {
    const rows = await sql`
      select id::text, employee_id::text as "employeeId", session_id::text as "sessionId", provider, registration, language
      from store_order_push_devices where id::text = ${String(body.deviceId || "")} and employee_id::text = ${session.id}
        and session_id::text = ${session.sessionId!} and revoked_at is null
    `;
    const device = rows[0] as OrderPushDevice | undefined;
    if (!device) return fail("先にこの端末を登録してください。");
    await sendOrderPush(device, { type: "store_push_test", title: "Foundr1 STORE", body: "通知テスト / 通知测试", deliveryKey: randomUUID(), expiresAt: String(Date.now() + 60_000), href: "/store/notifications" });
    return Response.json({ ok: true, acceptedByProvider: true });
  }
  return fail("更新内容が不正です。");
}
