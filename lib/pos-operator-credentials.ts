import { createHash, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword, type EmployeeSession } from "./auth";
import { sql } from "./db";
import { posOperatorUuid } from "./pos-operator-policy";

export const posOperatorCookieName = "foundr1_pos_operator";
export const posOperatorHeaders = { "Cache-Control": "no-store, max-age=0" };
export function posOperatorFailure(error: string, status: number, code: string) {
  return { ok: false as const, response: Response.json({ error, code }, { status, headers: posOperatorHeaders }) };
}
export function assertPosOperatorSameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site"
    ? null : posOperatorFailure("不正なリクエスト元です。", 403, "invalid_origin").response;
}
export function posOperatorCookie(value: string, maxAge = 16 * 3600) {
  return `${posOperatorCookieName}=${value}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export function hashPosOperatorSecret(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function createPosOperatorSecret() { const secret = randomBytes(32).toString("base64url"); return { secret, hash: hashPosOperatorSecret(secret) }; }
export function readPosOperatorCookie(value?: string) {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !posOperatorUuid.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  return { id: parts[0], hash: hashPosOperatorSecret(parts[1]) };
}
export function posOperatorDatabaseFailure(error: unknown): Response | null {
  const match = String(error instanceof Error ? error.message : error).match(/pos_operator:([a-z_]+)/);
  if (!match) return null;
  const code = match[1];
  return posOperatorFailure("操作担当者の確認期限または権限が変わりました。もう一度本人確認してください。", code === "operator_changed" ? 409 : code === "operator_scope" ? 403 : 401, code).response;
}
export type PinEmployee = EmployeeSession & { pinHash: string | null; pinRevision: string; passwordMustChange: boolean };
export async function readPinEmployee(employeeId: string) {
  const rows = await sql`select e.id::text,e.name,coalesce(e.login_id,e.email,'') as "loginId",e.role,e.session_version as "sessionVersion",
      coalesce(e.password_must_change,false) as "passwordMustChange",c.pin_hash as "pinHash",c.revision::text as "pinRevision"
    from employees e left join employee_pos_pin_credentials c on c.employee_id=e.id
    where e.id=${employeeId}::uuid and e.status='active' and e.role in ('owner','manager','store_owner','store_manager','staff')`;
  return rows[0] as PinEmployee | undefined;
}
/** Atomic reservations are durable across processes and cannot be evaded by IP rotation. */
export async function reservePosPinAttempt(base: EmployeeSession, employeeId: string, purpose: "verify" | "self_set") {
  const result = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${`pos-pin:employee:${employeeId}`},0))`,
    sql`select pg_advisory_xact_lock(hashtextextended(${`pos-pin:base:${base.sessionId}`},0))`,
    sql`with employee_quota as materialized (
      select count(*) as attempts from pos_operator_pin_attempts where employee_id=${employeeId}::uuid and succeeded_at is null and created_at>now()-interval '10 minutes'
    ), base_quota as materialized (
      select count(*) as attempts from pos_operator_pin_attempts where base_session_id=${base.sessionId!}::uuid and succeeded_at is null and created_at>now()-interval '10 minutes'
    ) insert into pos_operator_pin_attempts(base_session_id,employee_id,purpose)
      select ${base.sessionId!}::uuid,${employeeId}::uuid,${purpose} from employee_quota,base_quota
      where employee_quota.attempts<8 and base_quota.attempts<12 returning id::text`
  ]);
  return String(result[2]?.[0]?.id ?? "");
}
export function succeedPosPinAttempt(attemptId: string) {
  return sql`update pos_operator_pin_attempts set succeeded_at=now() where id=${attemptId}::uuid and succeeded_at is null`;
}
export function validPersonalPin(pin: unknown): pin is string { return typeof pin === "string" && /^[0-9]{4,6}$/.test(pin); }
export function verifyPersonalPin(pin: string, employee: PinEmployee) { return Boolean(employee.pinHash && verifyPassword(pin, employee.pinHash)); }
export { hashPassword };
