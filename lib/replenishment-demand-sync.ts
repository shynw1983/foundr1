import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { syncInventoryReplenishmentDemands } from "./replenishment-demand-data";

// Only the authenticated cron uses this read context. Automatic demand events
// have a NULL employee; it never impersonates an employee or submits an order.
const systemReadContext: EmployeeSession = {
  id: "", name: "", loginId: "", role: "owner", sessionVersion: 0
};

/** Reconcile saved inventory/menu signals even while no employee has a page open. */
export async function sweepReplenishmentDemands() {
  const stores = await sql`select id::text from stores where status = 'active' order by id`;
  const failures: string[] = [];
  let synced = 0;
  // Bound simultaneous database work; one failed store must not stop others.
  for (let offset = 0; offset < stores.length; offset += 3) {
    const batch = stores.slice(offset, offset + 3);
    const results = await Promise.allSettled(batch.map(store =>
      syncInventoryReplenishmentDemands(systemReadContext, String(store.id))));
    results.forEach((result, index) => {
      if (result.status === "fulfilled") synced += 1;
      else failures.push(String(batch[index].id));
    });
  }
  return { ok: failures.length === 0, storeCount: stores.length, synced, failedStoreIds: failures };
}
