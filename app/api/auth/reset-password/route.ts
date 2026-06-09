import { hashPassword, shouldRequirePasswordChangeForRole, validatePasswordStrength, verifyPassword } from "../../../../lib/auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";

type EmployeeRow = {
  id: string;
  email: string | null;
  role: string;
  password_hash: string | null;
};

const resetAttempts = new Map<string, { count: number; resetAt: number }>();
const resetAttemptWindowMs = 10 * 60 * 1000;
const maxResetAttempts = 6;

function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

function getResetRateLimitKey(request: Request, loginId: string) {
  return `${getClientIp(request)}:${loginId.toLowerCase()}`;
}

function checkResetRateLimit(key: string) {
  const now = Date.now();
  const attempt = resetAttempts.get(key);

  if (!attempt || attempt.resetAt <= now) {
    resetAttempts.set(key, { count: 1, resetAt: now + resetAttemptWindowMs });
    return null;
  }

  if (attempt.count >= maxResetAttempts) {
    const retryAfterSeconds = Math.ceil((attempt.resetAt - now) / 1000);
    return Response.json(
      { error: "パスワード再設定の試行が多すぎます。時間をおいて再試行してください。" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  attempt.count += 1;
  return null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { loginId?: string; email?: string; newPassword?: string; newPasswordConfirmation?: string };
  const loginId = String(body.loginId ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const newPassword = String(body.newPassword ?? "");
  const newPasswordConfirmation = String(body.newPasswordConfirmation ?? "");

  if (!loginId || !email || !newPassword || !newPasswordConfirmation) {
    return Response.json({ error: "ログインID、登録メールアドレス、新しいパスワード、確認用パスワードを入力してください。" }, { status: 400 });
  }

  if (newPassword !== newPasswordConfirmation) {
    return Response.json({ error: "新しいパスワードと確認用パスワードが一致しません。" }, { status: 400 });
  }

  const rateLimitKey = getResetRateLimitKey(request, loginId);
  const rateLimitResponse = checkResetRateLimit(rateLimitKey);
  if (rateLimitResponse) {
    await writeAuditLog({
      action: "auth.password_reset_rate_limited",
      targetType: "employee_login",
      targetId: loginId,
      request
    });
    return rateLimitResponse;
  }

  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) {
    return Response.json({ error: passwordError }, { status: 400 });
  }

  const rows = await sql`
    select id, email, role, password_hash
    from employees
    where status = 'active'
      and (login_id = ${loginId} or email = ${loginId})
    limit 1
  ` as EmployeeRow[];
  const employee = rows[0];

  if (!employee?.email || employee.email.toLowerCase() !== email) {
    await writeAuditLog({
      action: "auth.password_reset_failed",
      targetType: "employee_login",
      targetId: loginId,
      metadata: { reason: employee ? "email_mismatch_or_missing" : "unknown_login" },
      request
    });
    return Response.json({ error: "ログインIDまたは登録メールアドレスが正しくありません。登録メールがない場合は管理者に初期パスワードの再発行を依頼してください。" }, { status: 400 });
  }

  if (employee.password_hash && verifyPassword(newPassword, employee.password_hash)) {
    return Response.json({ error: "現在のパスワードとは別のパスワードを設定してください。" }, { status: 400 });
  }

  await sql`
    update employees
    set password_hash = ${hashPassword(newPassword)},
        password_must_change = false,
        password_changed_at = now(),
        session_version = session_version + 1,
        updated_at = now()
    where id = ${employee.id}
  `;
  resetAttempts.delete(rateLimitKey);

  await writeAuditLog({
    actorEmployeeId: employee.id,
    action: "auth.password_reset_succeeded",
    targetType: "employee",
    targetId: employee.id,
    metadata: { role: employee.role, requiresInitialChangeRole: shouldRequirePasswordChangeForRole(employee.role) },
    request
  });

  return Response.json({ ok: true });
}
