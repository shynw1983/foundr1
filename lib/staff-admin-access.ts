import type { EmployeeSession } from "./auth";
import { getSessionStoreScope, requireOsSession } from "./api-auth";

const globalStaffAdminRoles = new Set(["owner", "manager"]);
const scopedStaffAdminRoles = new Set(["store_owner", "store_manager"]);
const scopedAssignableRoles = new Set(["staff", "store_terminal"]);

export type StaffAdminAccess = {
  session: EmployeeSession;
  allStores: boolean;
  storeIds: string[];
};

export async function requireStaffAdminSession(): Promise<StaffAdminAccess | null> {
  const session = await requireOsSession();
  if (!session) return null;

  if (globalStaffAdminRoles.has(session.role)) {
    return { session, allStores: true, storeIds: [] };
  }

  if (!scopedStaffAdminRoles.has(session.role)) return null;

  const scope = await getSessionStoreScope(session);
  if (scope.allStores || scope.storeIds.length > 0) {
    return { session, allStores: scope.allStores, storeIds: scope.storeIds };
  }

  return null;
}

export function canAssignStaffRole(access: StaffAdminAccess, role: string) {
  if (access.session.role === "owner") return true;
  if (access.session.role === "manager") return role !== "owner";
  return scopedAssignableRoles.has(role);
}

export function canManageTargetRole(access: StaffAdminAccess, role: string) {
  if (access.session.role === "owner") return true;
  if (access.session.role === "manager") return role !== "owner";
  return scopedAssignableRoles.has(role);
}

export function filterStoreIdsForStaffAdmin(access: StaffAdminAccess, storeIds: string[]) {
  const uniqueStoreIds = Array.from(new Set(storeIds.map(String).filter(Boolean)));
  if (access.allStores) return uniqueStoreIds;
  return uniqueStoreIds.filter((storeId) => access.storeIds.includes(storeId));
}

export function hasValidScopedStoreSelection(access: StaffAdminAccess, visibleStoreIds: string[], workStoreIds: string[]) {
  if (access.allStores) return true;
  const selectedStoreIds = new Set([...visibleStoreIds, ...workStoreIds]);
  if (selectedStoreIds.size === 0) return false;
  return Array.from(selectedStoreIds).every((storeId) => access.storeIds.includes(storeId));
}
