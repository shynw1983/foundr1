import { authCookieName, createSessionToken, sessionCookieMaxAge, verifyPassword } from "../../../../lib/auth";
import { touchEmployeeLastSeen } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

type EmployeeRow = {
  id: string;
  name: string;
  login_id: string | null;
  email: string | null;
  role: string;
  password_hash: string | null;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { loginId?: string; password?: string };
  const loginId = String(body.loginId ?? "").trim();
  const password = String(body.password ?? "");

  if (!loginId || !password) {
    return Response.json({ error: "ログインIDとパスワードを入力してください。" }, { status: 400 });
  }

  const rows = await sql`
    select id, name, login_id, email, role, password_hash
    from employees
    where status = 'active'
      and (login_id = ${loginId} or email = ${loginId})
    limit 1
  ` as EmployeeRow[];
  const employee = rows[0];

  if (!employee?.password_hash || !verifyPassword(password, employee.password_hash)) {
    return Response.json({ error: "ログイン情報が正しくありません。" }, { status: 401 });
  }

  const token = createSessionToken({
    id: employee.id,
    name: employee.name,
    loginId: employee.login_id || employee.email || loginId,
    role: employee.role
  });
  await touchEmployeeLastSeen(employee.id);

  const response = Response.json({
    ok: true,
    employee: {
      name: employee.name,
      loginId: employee.login_id || employee.email || loginId,
      role: employee.role
    }
  });
  response.headers.append(
    "Set-Cookie",
    `${authCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionCookieMaxAge()}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );

  return response;
}
