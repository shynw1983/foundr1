/** Store execution rights are separate from OS inventory/master permissions. */
export const storeInventoryPermission = "store.inventory";
export type StoreInventoryAction = "read" | "quick_check" | "count" | "receipt" | "exception_report";
const realEmployeeRoles=new Set(["owner","manager","store_owner","store_manager","staff"]);
const restrictedRoles=new Set(["store_owner","store_manager","staff"]);
const fullWorkbenchRoles=new Set(["owner","manager","store_terminal"]);
export const storeInventoryUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isStoreInventoryEmployeeRole(role:string) { return realEmployeeRoles.has(role); }
export function isRestrictedStorePersonalRole(role:string) { return restrictedRoles.has(role); }
export function canUseFullStoreWorkbench(role:string) { return fullWorkbenchRoles.has(role); }
export function canUseStoreInventory(role:string) { return isStoreInventoryEmployeeRole(role)||role==="store_terminal"; }
export function isRestrictedStoreExecutionPath(pathname:string) {
  return ["/store/inventory","/store/receiving"].some(path=>pathname===path||pathname.startsWith(`${path}/`))||pathname==="/store/logout";
}
