import type { EmployeeSession } from "./auth";
import { getSessionStoreScope, requireOsSession } from "./api-auth";
import { getPermissionsForRole } from "./role-permissions";

const scopedAssignableRoles = new Set(["staff", "store_terminal"]);
const headquarterAssignableRoles = new Set(["owner", "manager"]);

export type StaffAdminAccess = {
  session: EmployeeSession;
  allStores: boolean;
  storeIds: string[];
  permissions: Set<string>;
};

async function resolveStaffAccess(requiredPermission: "module.staff" | "staff.manage"): Promise<StaffAdminAccess | null> {
  const session = await requireOsSession();
  if (!session) return null;
  const permissions = await getPermissionsForRole(session.role);

  if (!permissions.has(requiredPermission)) return null;

  if (session.role === "owner" || session.role === "manager") {
    return { session, allStores: true, storeIds: [], permissions };
  }

  const scope = await getSessionStoreScope(session);
  if (scope.allStores || scope.storeIds.length > 0) {
    return { session, allStores: scope.allStores, storeIds: scope.storeIds, permissions };
  }

  return null;
}

export async function requireStaffViewSession(): Promise<StaffAdminAccess | null> {
  return resolveStaffAccess("module.staff");
}

export async function requireStaffAdminSession(): Promise<StaffAdminAccess | null> {
  return resolveStaffAccess("staff.manage");
}

export function canAssignStaffRole(access: StaffAdminAccess, role: string) {
  if (!access.permissions.has("staff.manage")) return false;
  if (access.session.role === "owner") return true;
  if (access.permissions.has("staff.assignHeadquarterRoles")) return role !== "owner";
  if (headquarterAssignableRoles.has(role)) return false;
  return scopedAssignableRoles.has(role);
}

export function canManageTargetRole(access: StaffAdminAccess, role: string) {
  if (!access.permissions.has("staff.manage")) return false;
  if (access.session.role === "owner") return true;
  if (access.permissions.has("staff.assignHeadquarterRoles")) return role !== "owner";
  if (headquarterAssignableRoles.has(role)) return false;
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
