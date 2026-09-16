import { sql } from "../../../../../lib/db";
import { getOrderPushRules, hashPushValue } from "../../../../../lib/store-order-push";
import { getOrderPushConfig } from "../../../../../lib/store-order-push-transport";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!getOrderPushConfig().enabled) return Response.json({ error: "disabled" }, { status: 503 });
  const secret = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const devices = await sql`
    select d.id::text, d.employee_id::text as "employeeId" from store_order_push_devices d
    join employees e on e.id = d.employee_id and e.status = 'active'
    join employee_sessions es on es.id = d.session_id and es.employee_id = e.id
      and es.session_version = e.session_version and es.revoked_at is null and es.expires_at > now()
    where d.presence_token_hash = ${hashPushValue(secret)} and d.revoked_at is null
  `;
  const device = devices[0];
  if (!device) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rules = await getOrderPushRules(String(device.employeeId));
  const body = await request.json().catch(() => ({}));
  if (typeof body.token === "string" && body.token.length >= 20 && body.token.length <= 4096) {
    await sql`update store_order_push_devices set registration = ${JSON.stringify({ token: body.token })}::jsonb, endpoint_hash = ${hashPushValue(body.token)}, updated_at = now() where id::text = ${String(device.id)}`;
  }
  if (Array.isArray(body.presence)) {
    for (const presence of body.presence.slice(0, 50)) {
      const rule = rules.find((rule) => rule.storeId === presence.storeId && rule.key === presence.ruleKey);
      const observed = Number(presence.observedAt);
      if (!rule || !["inside", "outside", "unknown"].includes(presence.state) || !Number.isFinite(observed) || observed > Date.now() + 60_000 || observed < Date.now() - 86_400_000) continue;
      await sql`
        insert into store_order_push_presence (device_id, store_id, rule_key, state, observed_at)
        values (${String(device.id)}, ${rule.storeId}, ${rule.key}, ${presence.state}, ${new Date(observed).toISOString()}::timestamptz)
        on conflict (device_id, store_id) do update set rule_key = excluded.rule_key, state = excluded.state, observed_at = excluded.observed_at
        where store_order_push_presence.observed_at <= excluded.observed_at
      `;
    }
  }
  return Response.json({ ok: true, rules });
}
