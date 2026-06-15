import { authCookieName, readSessionToken } from "./auth";
import { sql } from "./db";

const rollingSessionIntervalSql = "14 days";
const limitedEmployeeSessionRoles = new Set(["store_manager", "staff"]);
const maxLimitedEmployeeSessions = 2;

function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return valueParts.join("=");
  }
  return "";
}

export function shouldLimitConcurrentEmployeeSessions(role: string) {
  return limitedEmployeeSessionRoles.has(role);
}

export function sessionCookieMaxAge() {
  return 60 * 60 * 24 * 400;
}

export async function createEmployeeSession(input: {
  employeeId: string;
  role: string;
  sessionVersion: number;
  surface: string;
  request: Request;
}) {
  const rows = await sql`
    insert into employee_sessions (
      employee_id,
      session_version,
      surface,
      user_agent,
      ip_address,
      expires_at
    )
    values (
      ${input.employeeId},
      ${input.sessionVersion},
      ${input.surface},
      ${input.request.headers.get("user-agent") || ""},
      ${getClientIp(input.request)},
      now() + (${rollingSessionIntervalSql})::interval
    )
    returning id::text
  `;
  const sessionId = String(rows[0]?.id ?? "");

  if (sessionId && shouldLimitConcurrentEmployeeSessions(input.role)) {
    await sql`
      with ranked as (
        select
          id,
          row_number() over (order by last_seen_at desc, created_at desc) as active_rank
        from employee_sessions
        where employee_id = ${input.employeeId}
          and session_version = ${input.sessionVersion}
          and revoked_at is null
          and expires_at > now()
      )
      update employee_sessions
      set revoked_at = now(),
          revoked_reason = 'concurrent_limit'
      where id in (
        select id
        from ranked
        where active_rank > ${maxLimitedEmployeeSessions}
      )
    `;
  }

  return sessionId;
}

export async function touchEmployeeSession(sessionId: string, employeeId: string, sessionVersion: number) {
  const rows = await sql`
    update employee_sessions
    set last_seen_at = now(),
        expires_at = now() + (${rollingSessionIntervalSql})::interval
    where id::text = ${sessionId}
      and employee_id = ${employeeId}
      and session_version = ${sessionVersion}
      and revoked_at is null
      and expires_at > now()
    returning id::text
  `;
  return rows.length > 0;
}

export async function revokeEmployeeSession(sessionId: string, reason = "logout") {
  if (!sessionId) return;
  await sql`
    update employee_sessions
    set revoked_at = coalesce(revoked_at, now()),
        revoked_reason = coalesce(revoked_reason, ${reason})
    where id::text = ${sessionId}
  `;
}

export async function revokeRequestEmployeeSession(request: Request, reason = "logout") {
  const token = getCookieValue(request, authCookieName);
  const session = readSessionToken(token);
  if (session?.sessionId) {
    await revokeEmployeeSession(session.sessionId, reason);
  }
}
