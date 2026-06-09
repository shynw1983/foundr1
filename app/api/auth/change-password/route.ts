import { authCookieName, createSessionToken, readPasswordActionToken, sessionCookieMaxAge, shouldRequirePasswordChangeForRole, validatePasswordStrength, verifyPassword, hashPassword } from "../../../../lib/auth";
import { touchEmployeeLastSeen } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";
import { getNavPathsForPermissions, getPermissionsForRole } from "../../../../lib/role-permissions";

type EmployeeRow = {
  id: string;
  name: string;
  login_id: string | null;
  email: string | null;
  role: string;
  password_hash: string | null;
  password_must_change: boolean;
  session_version: number;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { token?: string; newPassword?: string };
  const token = String(body.token ?? "");
  const newPassword = String(body.newPassword ?? "");
  const action = readPasswordActionToken(token, "initial_change");

  if (!action) {
    return Response.json({ error: "パスワード変更の有効期限が切れました。もう一度ログインしてください。" }, { status: 401 });
  }

  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) {
    return Response.json({ error: passwordError }, { status: 400 });
  }

  const rows = await sql`
    select id, name, login_id, email, role, password_hash, coalesce(password_must_change, false) as password_must_change, session_version
    from employees
    where id = ${action.id}
      and status = 'active'
    limit 1
  ` as EmployeeRow[];
  const employee = rows[0];

  if (!employee || employee.session_version !== action.sessionVersion) {
    return Response.json({ error: "パスワード変更の有効期限が切れました。もう一度ログインしてください。" }, { status: 401 });
  }

  if (!employee.password_must_change || !shouldRequirePasswordChangeForRole(employee.role)) {
    return Response.json({ error: "このアカウントは初回パスワード変更の対象ではありません。" }, { status: 400 });
  }

  if (employee.password_hash && verifyPassword(newPassword, employee.password_hash)) {
    return Response.json({ error: "初期パスワードとは別のパスワードを設定してください。" }, { status: 400 });
  }

  const updatedRows = await sql`
    update employees
    set password_hash = ${hashPassword(newPassword)},
        password_must_change = false,
        password_changed_at = now(),
        session_version = session_version + 1,
        updated_at = now()
    where id = ${employee.id}
    returning session_version
  `;
  const sessionVersion = Number(updatedRows[0]?.session_version ?? employee.session_version + 1);
  const permissionSet = await getPermissionsForRole(employee.role);
  const permissions = Array.from(permissionSet);
  const loginId = employee.login_id || employee.email || "";
  const sessionToken = createSessionToken({
    id: employee.id,
    name: employee.name,
    loginId,
    role: employee.role,
    sessionVersion,
    permissions,
    permittedNavPaths: getNavPathsForPermissions(permissions)
  });

  await touchEmployeeLastSeen(employee.id);
  await writeAuditLog({
    actorEmployeeId: employee.id,
    action: "auth.initial_password_changed",
    targetType: "employee",
    targetId: employee.id,
    request
  });

  const response = Response.json({
    ok: true,
    employee: {
      name: employee.name,
      loginId,
      role: employee.role,
      permissions,
      permittedNavPaths: getNavPathsForPermissions(permissions)
    }
  });
  response.headers.append(
    "Set-Cookie",
    `${authCookieName}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionCookieMaxAge()}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );

  return response;
}
