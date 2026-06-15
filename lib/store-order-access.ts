import type { EmployeeSession } from "./auth";
import { getSessionStoreScope } from "./api-auth";
import { sql } from "./db";
import { roleHasPermission } from "./role-permissions";

const salesStatsRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const allStoreViewRoles = new Set(["owner", "manager"]);

export type StoreOrderAccess = {
  role: string;
  allStores: boolean;
  canViewSalesStats: boolean;
  canCancelOrders: boolean;
  canUseAllStoreView: boolean;
  stores: Array<{ id: string; name: string }>;
  storeIds: string[];
};

export async function getStoreOrderAccess(session: EmployeeSession): Promise<StoreOrderAccess> {
  const scope = await getSessionStoreScope(session);
  const stores = scope.allStores
    ? await sql`
        select id::text, name
        from stores
        where status = 'active'
        order by name
      `
    : scope.storeIds.length
      ? await sql`
          select id::text, name
          from stores
          where status = 'active'
            and id::text = any(${scope.storeIds})
          order by name
        `
      : [];

  return {
    role: session.role,
    allStores: scope.allStores,
    canViewSalesStats: salesStatsRoles.has(session.role),
    canCancelOrders: await roleHasPermission(session.role, "pos.refund"),
    canUseAllStoreView: allStoreViewRoles.has(session.role),
    stores: stores as Array<{ id: string; name: string }>,
    storeIds: scope.allStores ? [] : scope.storeIds
  };
}

export function getScopedStoreFilter(access: StoreOrderAccess, requestedStoreId?: string | null) {
  const storeId = String(requestedStoreId ?? "").trim();
  if (!storeId) return null;
  if (access.allStores) return storeId;
  return access.storeIds.includes(storeId) ? storeId : "__forbidden__";
}

export function canChangeOrderStatus(access: StoreOrderAccess, status: string) {
  if (status === "cancelled") return access.canCancelOrders;
  return ["preparing", "ready", "completed"].includes(status);
}
