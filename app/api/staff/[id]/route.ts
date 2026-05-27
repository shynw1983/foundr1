import { cookies } from "next/headers";
import { authCookieName, hashPassword, readSessionToken } from "../../../../lib/auth";
import { sql } from "../../../../lib/db";

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
  return session?.role === "owner" ? session : null;
}

function normalizeRole(role?: string) {
  return ["owner", "manager", "buyer", "store_owner", "staff"].includes(role ?? "") ? role as string : "staff";
}

function normalizeStatus(status?: string) {
  return status === "inactive" ? "inactive" : "active";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOwner();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as StaffPayload;
  const name = String(body.name ?? "").trim();
  const loginId = String(body.loginId ?? "").trim();
  const email = String(body.email ?? "").trim();
  const larkOpenId = String(body.larkOpenId ?? "").trim();
  const larkUserId = String(body.larkUserId ?? "").trim();
  const password = String(body.password ?? "");
  const role = normalizeRole(body.role);
  const status = id === session.id ? "active" : normalizeStatus(body.status);
  const storeIds = Array.isArray(body.storeIds) ? body.storeIds.map(String) : [];

  if (!name || !loginId) {
    return Response.json({ error: "氏名とログインIDを入力してください。" }, { status: 400 });
  }

  if (password) {
    await sql`
      update employees
      set name = ${name},
          login_id = ${loginId},
          email = ${email || null},
          lark_open_id = ${larkOpenId || null},
          lark_user_id = ${larkUserId || null},
          role = ${role},
          status = ${status},
          password_hash = ${hashPassword(password)},
          updated_at = now()
      where id = ${id}
    `;
  } else {
    await sql`
      update employees
      set name = ${name},
          login_id = ${loginId},
          email = ${email || null},
          lark_open_id = ${larkOpenId || null},
          lark_user_id = ${larkUserId || null},
          role = ${role},
          status = ${status},
          updated_at = now()
      where id = ${id}
    `;
  }

  await sql`delete from employee_scopes where employee_id = ${id} and scope_type = 'store'`;

  for (const storeId of storeIds) {
    await sql`
      insert into employee_scopes (employee_id, scope_type, store_id)
      values (${id}, 'store', ${storeId})
      on conflict do nothing
    `;
  }

  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOwner();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const { id } = await context.params;
  if (id === session.id) {
    return Response.json({ error: "自分自身は削除できません。" }, { status: 409 });
  }

  await sql`delete from employees where id = ${id}`;
  return Response.json({ ok: true });
}
