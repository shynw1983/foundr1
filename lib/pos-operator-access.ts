import { cookies } from "next/headers";
import type { EmployeeSession } from "./auth";
import { canAccessStore } from "./api-auth";
import { sql } from "./db";
import { roleHasPermission } from "./role-permissions";
import { canonicalPosOperatorIntent, isSensitivePosOperatorOperation, normalizePosOperatorSettings, posOperatorUuid, type PosOperatorOperation, type PosOperatorSettings } from "./pos-operator-policy";
import { hashPosOperatorSecret, posOperatorCookieName, posOperatorFailure, readPosOperatorCookie } from "./pos-operator-credentials";

export type PosOperatorActor = EmployeeSession;
export type PosOperatorPerson = { id: string; name: string; role: string };
export type PosOperatorContext = {
  storeId: string; enabled: boolean; settings: PosOperatorSettings;
  operator: (PosOperatorPerson & { sessionId: string; expiresAt: string; lastVerifiedAt: string; lastActivityAt: string; idleExpiresAt: string }) | null;
  employees: (PosOperatorPerson & { pinReady: boolean; canApproveRefund: boolean; canAdminCash: boolean })[];
  serverNow: string;
};
type SessionRow = EmployeeSession & { operatorSessionId: string; tokenHash: string; pinRevision: string; expiresAt: string; lastVerifiedAt: string; lastActivityAt: string; idleExpiresAt: string };
export function posOperatorIntentHash(body: unknown) { return hashPosOperatorSecret(canonicalPosOperatorIntent(body)); }
export async function readPosOperatorSettings(storeId: string) {
  // Existing deployments omit this column until their PIN migration; absent means disabled.
  // Remove the optional projection once every runtime target has applied that migration.
  const rows = await sql`select to_jsonb(pos_store_settings)->'operator_settings' as settings from pos_store_settings where store_id=${storeId}::uuid`;
  return normalizePosOperatorSettings(rows[0]?.settings);
}
export async function validatePosOperatorStore(base: EmployeeSession, storeId: string) {
  if (!posOperatorUuid.test(storeId)) return posOperatorFailure("店舗を指定してください。", 400, "store_required");
  if (!base.sessionId) return posOperatorFailure("ログインしてください。", 401, "session_required");
  if (!await roleHasPermission(base.role, "pos.operate", { fresh: true }) || !await canAccessStore(base, storeId)) return posOperatorFailure("この店舗の POS を操作する権限がありません。", 403, "operator_scope");
  const stores = await sql`select id from stores where id=${storeId}::uuid and status='active'`;
  return stores[0] ? null : posOperatorFailure("有効な店舗が見つかりません。", 404, "store_inactive");
}
async function currentPosOperator(base: EmployeeSession, storeId: string, settings: PosOperatorSettings): Promise<SessionRow | null> {
  const cookieStore = await cookies();
  const proof = readPosOperatorCookie(cookieStore.get(posOperatorCookieName)?.value);
  if (!proof || !base.sessionId) return null;
  const rows = await sql`select e.id::text,e.name,coalesce(e.login_id,e.email,'') as "loginId",e.role,e.session_version as "sessionVersion",
      s.id::text as "operatorSessionId",s.token_hash as "tokenHash",s.pin_revision::text as "pinRevision",
      s.expires_at::text as "expiresAt",s.verified_at::text as "lastVerifiedAt",s.last_activity_at::text as "lastActivityAt",
      (s.last_activity_at+make_interval(mins=>${settings.idleMinutes}))::text as "idleExpiresAt"
    from pos_operator_sessions s join employees e on e.id=s.employee_id
      join employee_pos_pin_credentials c on c.employee_id=e.id
    where s.id=${proof.id}::uuid and s.token_hash=${proof.hash} and s.store_id=${storeId}::uuid
      and s.base_employee_id=${base.id}::uuid and s.base_session_id=${base.sessionId}::uuid and s.base_session_version=${base.sessionVersion}
      and s.revoked_at is null and s.expires_at>now() and s.last_activity_at>now()-make_interval(mins=>${settings.idleMinutes})
      and e.status='active' and e.role in ('owner','manager','store_owner','store_manager','staff')
      and e.role=s.employee_role and e.session_version=s.employee_session_version and not coalesce(e.password_must_change,false)
      and c.pin_hash is not null and c.revision=s.pin_revision and pos_operator_has_scope(e.id,${storeId}::uuid) and pos_operator_has_permission(e.role,'pos.operate')`;
  return rows[0] as SessionRow | undefined ?? null;
}
export async function readPosOperatorContext(base: EmployeeSession, storeId: string): Promise<PosOperatorContext> {
  const settings = await readPosOperatorSettings(storeId);
  const row = settings.enabled ? await currentPosOperator(base, storeId, settings) : null;
  const rows = settings.enabled ? await sql`select e.id::text,e.name,e.role,(c.pin_hash is not null) as "pinReady",
      pos_operator_has_permission(e.role,'pos.refund') as "canApproveRefund",(e.role in ('owner','manager')) as "canAdminCash"
    from employees e left join employee_pos_pin_credentials c on c.employee_id=e.id
    where e.status='active' and e.role in ('owner','manager','store_owner','store_manager','staff')
      and not coalesce(e.password_must_change,false) and pos_operator_has_scope(e.id,${storeId}::uuid) and pos_operator_has_permission(e.role,'pos.operate')
    order by e.name,e.id` : [];
  return { storeId, enabled: settings.enabled, settings,
    operator: row ? { id: row.id, name: row.name, role: row.role, sessionId: row.operatorSessionId, expiresAt: new Date(row.expiresAt).toISOString(), lastVerifiedAt: new Date(row.lastVerifiedAt).toISOString(), lastActivityAt: new Date(row.lastActivityAt).toISOString(), idleExpiresAt: new Date(row.idleExpiresAt).toISOString() } : null,
    employees: rows as PosOperatorContext["employees"], serverNow: new Date().toISOString() };
}
export async function requirePosOperatorForWrite(base: EmployeeSession, storeId: string, exactBody: unknown, operation: PosOperatorOperation, auditWrite = true) {
  const storeFailure = await validatePosOperatorStore(base, storeId); if (storeFailure) return storeFailure;
  const settings = await readPosOperatorSettings(storeId);
  if (!settings.enabled) return { ok: true as const, enabled: false, actor: base, operatorSessionId: null, approver: null, writeGuards: [] as ReturnType<typeof sql>[] };
  const record = exactBody && typeof exactBody === "object" ? exactBody as Record<string, unknown> : {};
  const proof = record.posOperator && typeof record.posOperator === "object" ? record.posOperator as Record<string, unknown> : {};
  const row = await currentPosOperator(base, storeId, settings);
  if (!row) return posOperatorFailure("レジ担当者の本人確認をしてください。", 401, "operator_required");
  if (proof.sessionId !== row.operatorSessionId || proof.employeeId !== row.id) return posOperatorFailure("操作担当者が変わりました。入力内容を確認してください。", 409, "operator_changed");
  let authorizationId: string | null = null, approver: PosOperatorPerson | null = null;
  const hash = posOperatorIntentHash(exactBody);
  if (isSensitivePosOperatorOperation(operation)) {
    if (typeof proof.authorizationId !== "string" || !posOperatorUuid.test(proof.authorizationId)) return posOperatorFailure("この操作を PIN で再確認してください。", 401, "authorization_required");
    const grants = await sql`select g.id::text,e.id::text as "employeeId",e.name,e.role from pos_operator_authorizations g join employees e on e.id=g.approver_employee_id
      where g.id=${proof.authorizationId}::uuid and g.operator_session_id=${row.operatorSessionId}::uuid and g.operation=${operation}
        and g.intent_hash=${hash} and g.consumed_at is null and g.expires_at>now()`;
    const grant = grants[0];
    if (!grant) return posOperatorFailure("この操作の確認が期限切れ、または内容が変わりました。", 401, "authorization_required");
    authorizationId = String(grant.id); approver = { id: String(grant.employeeId), name: String(grant.name), role: String(grant.role) };
  }
  const actor: EmployeeSession = { id: row.id, name: row.name, loginId: row.loginId, role: row.role, sessionVersion: row.sessionVersion };
  return { ok: true as const, enabled: true, actor, operatorSessionId: row.operatorSessionId, approver,
    writeGuards: [sql`select pos_operator_assert_write(${row.operatorSessionId}::uuid,${row.tokenHash},${base.id}::uuid,${base.sessionId!}::uuid,${base.sessionVersion},${storeId}::uuid,${row.id}::uuid,${operation},${authorizationId}::uuid,${hash},${auditWrite})`] };
}
