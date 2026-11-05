const terminalLoginApproverRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);

// Shared by the scanned page's access guard and the approval API.
export function canApproveTerminalLoginRole(role: string) {
  return terminalLoginApproverRoles.has(role);
}
