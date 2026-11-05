import { readCustomerDisplayWeighing } from "./pos-customer-display";

/** Only an already observed, unexpired preview permits fast authoritative reads. */
export function customerDisplayRefreshInterval(weighing: unknown, realtimeHealthy: boolean, serverNow = Date.now()) {
  return readCustomerDisplayWeighing(weighing, serverNow) ? 2_000 : realtimeHealthy ? 5 * 60_000 : 60_000;
}
