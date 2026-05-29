import { sql } from "./db";

type AuditLogInput = {
  actorEmployeeId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  request?: Request;
};

function getClientIp(request?: Request) {
  return request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request?.headers.get("x-real-ip")
    || null;
}

export async function writeAuditLog(input: AuditLogInput) {
  try {
    await sql`
      insert into ops_audit_logs (
        actor_employee_id,
        action,
        target_type,
        target_id,
        metadata,
        ip_address,
        user_agent
      )
      values (
        ${input.actorEmployeeId ?? null},
        ${input.action},
        ${input.targetType ?? null},
        ${input.targetId ?? null},
        ${JSON.stringify(input.metadata ?? {})},
        ${getClientIp(input.request)},
        ${input.request?.headers.get("user-agent") ?? null}
      )
    `;
  } catch (error) {
    console.error("Failed to write audit log", error);
  }
}
