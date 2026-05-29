import { authCookieName, createSessionToken, sessionCookieMaxAge, verifyPassword } from "../../../../lib/auth";
import { touchEmployeeLastSeen } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";

type EmployeeRow = {
  id: string;
  name: string;
  login_id: string | null;
  email: string | null;
  role: string;
  password_hash: string | null;
  session_version: number;
};

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const loginAttemptWindowMs = 10 * 60 * 1000;
const maxLoginAttempts = 8;

function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

function getLoginRateLimitKey(request: Request, loginId: string) {
  return `${getClientIp(request)}:${loginId.toLowerCase()}`;
}

function checkLoginRateLimit(key: string) {
  const now = Date.now();
  const attempt = loginAttempts.get(key);

  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + loginAttemptWindowMs });
    return null;
  }

  if (attempt.count >= maxLoginAttempts) {
    const retryAfterSeconds = Math.ceil((attempt.resetAt - now) / 1000);
    return Response.json(
      { error: "ログイン試行が多すぎます。時間をおいて再試行してください。" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  attempt.count += 1;
  return null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { loginId?: string; password?: string };
  const loginId = String(body.loginId ?? "").trim();
  const password = String(body.password ?? "");

  if (!loginId || !password) {
    return Response.json({ error: "ログインIDとパスワードを入力してください。" }, { status: 400 });
  }

  const rateLimitKey = getLoginRateLimitKey(request, loginId);
  const rateLimitResponse = checkLoginRateLimit(rateLimitKey);
  if (rateLimitResponse) {
    await writeAuditLog({
      action: "auth.login_rate_limited",
      targetType: "employee_login",
      targetId: loginId,
      request
    });
    return rateLimitResponse;
  }

  const rows = await sql`
    select id, name, login_id, email, role, password_hash, session_version
    from employees
    where status = 'active'
      and (login_id = ${loginId} or email = ${loginId})
    limit 1
  ` as EmployeeRow[];
  const employee = rows[0];

  if (!employee?.password_hash || !verifyPassword(password, employee.password_hash)) {
    await writeAuditLog({
      action: "auth.login_failed",
      targetType: "employee_login",
      targetId: loginId,
      metadata: { reason: employee ? "invalid_password" : "unknown_login" },
      request
    });
    return Response.json({ error: "ログイン情報が正しくありません。" }, { status: 401 });
  }
  loginAttempts.delete(rateLimitKey);

  const token = createSessionToken({
    id: employee.id,
    name: employee.name,
    loginId: employee.login_id || employee.email || loginId,
    role: employee.role,
    sessionVersion: employee.session_version
  });
  await touchEmployeeLastSeen(employee.id);
  await writeAuditLog({
    actorEmployeeId: employee.id,
    action: "auth.login_succeeded",
    targetType: "employee",
    targetId: employee.id,
    request
  });

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
