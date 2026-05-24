import { cookies } from "next/headers";
import { authCookieName, readSessionToken, type EmployeeSession } from "./auth";
import { sql } from "./db";

const writableRoles = new Set(["owner", "manager", "buyer", "store_owner", "staff"]);
const allStoreAccessRoles = new Set(["owner", "manager", "buyer"]);

export type StoreScope = {
  allStores: boolean;
  storeIds: string[];
};

export async function requireOpsSession(): Promise<EmployeeSession | null> {
  const cookieStore = await cookies();
  return readSessionToken(cookieStore.get(authCookieName)?.value);
}

export async function requireWritableOpsSession() {
  const session = await requireOpsSession();
  if (!session || !writableRoles.has(session.role)) return null;

  return session;
}

export async function requireMasterOpsSession() {
  const session = await requireOpsSession();
  if (!session || !allStoreAccessRoles.has(session.role)) return null;

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
