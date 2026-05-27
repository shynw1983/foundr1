import { cookies } from "next/headers";
import { touchEmployeeLastSeen } from "../../../lib/api-auth";
import { authCookieName, hashPassword, readSessionToken } from "../../../lib/auth";
import { sql } from "../../../lib/db";

type StaffPayload = {
  name?: string;
  loginId?: string;
  email?: string;
  larkOpenId?: string;
  larkUserId?: string;
  password?: string;
  role?: string;
  status?: string;
  storeIds?: string[];
};

async function requireOwner() {
  const cookieStore = await cookies();
  const session = readSessionToken(cookieStore.get(authCookieName)?.value);
  if (session) await touchEmployeeLastSeen(session.id);
  return session?.role === "owner" ? session : null;
}

function normalizeRole(role?: string) {
  return ["owner", "manager", "buyer", "store_owner", "staff"].includes(role ?? "") ? role as string : "staff";
}

function normalizeStatus(status?: string) {
  return status === "inactive" ? "inactive" : "active";
}

export async function GET() {
  const session = await requireOwner();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const employees = await sql`
    select
      employees.id,
      employees.name,
      employees.login_id as "loginId",
      employees.email,
      employees.lark_open_id as "larkOpenId",
      employees.lark_user_id as "larkUserId",
      employees.role,
      employees.status,
      employees.last_seen_at as "lastSeenAt",
      coalesce(
        json_agg(
          json_build_object('id', stores.id, 'name', stores.name)
          order by stores.name
        ) filter (where stores.id is not null),
        '[]'::json
      ) as stores
    from employees
    left join employee_scopes
      on employee_scopes.employee_id = employees.id
      and employee_scopes.scope_type = 'store'
    left join stores on stores.id = employee_scopes.store_id
    group by employees.id
    order by employees.created_at desc
  `;

  const stores = await sql`
    select id, name
    from stores
    where status = 'active'
    order by name
  `;

  return Response.json({ employees, stores, currentUserId: session.id });
}

export async function POST(request: Request) {
  const session = await requireOwner();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as StaffPayload;
  const name = String(body.name ?? "").trim();
  const loginId = String(body.loginId ?? "").trim();
  const email = String(body.email ?? "").trim();
  const larkOpenId = String(body.larkOpenId ?? "").trim();
  const larkUserId = String(body.larkUserId ?? "").trim();
  const password = String(body.password ?? "");
  const role = normalizeRole(body.role);
  const status = normalizeStatus(body.status);
  const storeIds = Array.isArray(body.storeIds) ? body.storeIds.map(String) : [];

  if (!name || !loginId || !password) {
    return Response.json({ error: "氏名、ログインID、初期パスワードを入力してください。" }, { status: 400 });
  }

  const rows = await sql`
    insert into employees (name, login_id, email, lark_open_id, lark_user_id, role, status, password_hash, updated_at)
    values (${name}, ${loginId}, ${email || null}, ${larkOpenId || null}, ${larkUserId || null}, ${role}, ${status}, ${hashPassword(password)}, now())
    returning id
  `;
  const employeeId = rows[0]?.id;

  for (const storeId of storeIds) {
    await sql`
      insert into employee_scopes (employee_id, scope_type, store_id)
      values (${employeeId}, 'store', ${storeId})
      on conflict do nothing
    `;
  }

  return Response.json({ ok: true });
}
