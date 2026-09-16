import { sql } from "./db";
import { hashPushValue } from "./store-order-push";

// The native token is bound to one device and its still-valid employee login.
export async function authenticateOrderPushDevice(request: Request) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  const rows = await sql`
    select d.id::text, d.employee_id::text as "employeeId" from store_order_push_devices d
    join employees e on e.id = d.employee_id and e.status = 'active'
    join employee_sessions es on es.id = d.session_id and es.employee_id = e.id
      and es.session_version = e.session_version and es.revoked_at is null and es.expires_at > now()
    where d.presence_token_hash = ${hashPushValue(secret)} and d.revoked_at is null
  `;
  return rows[0] as { id: string; employeeId: string } | undefined ?? null;
}
