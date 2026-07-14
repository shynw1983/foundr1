import { cookies } from "next/headers";
import { authCookieName, readSessionToken, type EmployeeSession } from "./auth";
import { sql } from "./db";

const writableRoles = new Set(["owner", "manager", "store_owner", "store_manager", "staff"]);
const allStoreAccessRoles = new Set(["owner", "manager"]);

export type StoreScope = {
  allStores: boolean;
  storeIds: string[];
};

export async function requireOsSession(): Promise<EmployeeSession | null> {
  const cookieStore = await cookies();
  const session = readSessionToken(cookieStore.get(authCookieName)?.value);
  if (!session) return null;
  if (!session.sessionId) return null;

  const rows = await sql`
    with active_session as (
      select
        employee_sessions.id as session_id,
        employees.id,
        employees.name,
        coalesce(employees.login_id, employees.email, '') as "loginId",
        employees.role,
        employees.session_version as "sessionVersion"
      from employee_sessions
      join employees on employees.id = employee_sessions.employee_id
      where employee_sessions.id = ${session.sessionId}::uuid
        and employees.id = ${session.id}::uuid
        and employees.status = 'active'
        and employee_sessions.session_version = ${session.sessionVersion}
        and employees.session_version = ${session.sessionVersion}
        and employee_sessions.revoked_at is null
        and employee_sessions.expires_at > now()
      limit 1
    ), touched_session as (
      update employee_sessions
      set
        last_seen_at = now(),
        expires_at = now() + interval '14 days'
      from active_session
      where employee_sessions.id = active_session.session_id
        and (
          employee_sessions.last_seen_at is null
          or employee_sessions.last_seen_at < now() - interval '1 minute'
        )
      returning employee_sessions.id
    ), touched_employee as (
      update employees
      set last_seen_at = now()
      from active_session
      where employees.id = active_session.id
        and (
          employees.last_seen_at is null
          or employees.last_seen_at < now() - interval '1 minute'
        )
      returning employees.id
    )
    select
      id::text,
      name,
      "loginId",
      role,
      "sessionVersion"
    from active_session
  `;
  const employee = rows[0] as EmployeeSession | undefined;
  if (!employee) return null;
  return { ...employee, sessionId: session.sessionId };
}

export async function touchEmployeeLastSeen(employeeId: string) {
  await sql`
    update employees
    set last_seen_at = now()
    where id = ${employeeId}
      and (
        last_seen_at is null
        or last_seen_at < now() - interval '1 minute'
      )
  `;
}

export async function requireWritableOsSession() {
  const session = await requireOsSession();
  if (!session || !writableRoles.has(session.role)) return null;

  return session;
}

export async function requireMasterOsSession() {
  const session = await requireOsSession();
  if (!session || !allStoreAccessRoles.has(session.role)) return null;

  return session;
}

export async function requireOwnerOsSession() {
  const session = await requireOsSession();
  if (!session || session.role !== "owner") return null;

  return session;
}

export async function getSessionStoreScope(session: EmployeeSession): Promise<StoreScope> {
  if (allStoreAccessRoles.has(session.role)) {
    return { allStores: true, storeIds: [] };
  }

  const rows = await sql`
    select store_id::text as "storeId"
    from employee_scopes
    where employee_id = ${session.id}
      and scope_type = 'store'
      and store_id is not null
  `;

  return {
    allStores: false,
    storeIds: rows.map((row) => String(row.storeId))
  };
}

export async function canAccessStore(session: EmployeeSession, storeId?: string | null) {
  if (!storeId) return false;

  const scope = await getSessionStoreScope(session);
  return scope.allStores || scope.storeIds.includes(String(storeId));
}
