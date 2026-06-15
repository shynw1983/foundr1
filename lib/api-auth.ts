import { cookies } from "next/headers";
import { authCookieName, readSessionToken, type EmployeeSession } from "./auth";
import { sql } from "./db";
import { touchEmployeeSession } from "./employee-sessions";

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
    select
      id::text,
      name,
      coalesce(login_id, email, '') as "loginId",
      role,
      session_version as "sessionVersion"
    from employees
    where id = ${session.id}
      and status = 'active'
    limit 1
  `;
  const employee = rows[0] as EmployeeSession | undefined;
  if (!employee) return null;
  if (employee.sessionVersion !== session.sessionVersion) return null;
  const sessionIsActive = await touchEmployeeSession(session.sessionId, employee.id, employee.sessionVersion);
  if (!sessionIsActive) return null;

  await touchEmployeeLastSeen(employee.id);
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
