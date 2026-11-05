import type { ReplenishmentDemand, ReplenishmentDemandOrder } from "./replenishment-demand-types";
import type { ReplenishmentSource } from "./replenishment-policy";

export const demandUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const demandManagerRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
export function validDemandQuantity(value: unknown, nullable = false): value is number | null {
  return nullable && value === null || typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 999;
}
export function demandProgress(status: ReplenishmentDemand["status"], orders: ReplenishmentDemandOrder[]): ReplenishmentDemand["progress"] {
  if (status === "resolved" || status === "dismissed" || status === "deferred" || status === "reviewing") return status;
  if (status !== "ordered") return "reported";
  if (!orders.length || orders.some(order => ["deleted", "changed", "unavailable", "cancelled"].includes(order.status) || order.actualQuantity !== null && order.actualQuantity > 0 && order.actualUnit !== order.unit)) return "needs_review";
  const requested = orders.reduce((total, order) => total + order.requestedQuantity, 0);
  const received = orders.reduce((total, order) => total + Math.min(order.requestedQuantity, order.receivedQuantity), 0);
  if (requested > 0 && received >= requested) return "received";
  if (received > 0) return "partial_received";
  if (orders.some(order => ["delivered", "received"].includes(order.status))) return "awaiting_receipt";
  return "purchasing";
}
/** Excludes age-derived freshness, display labels and translations: time alone must not reopen a dismissed risk. */
export function demandSignalBasis(sources: ReplenishmentSource[]) {
  return sources.map(source => ({
    kind: source.kind, id: source.id, stockStatus: source.stockStatus, note: source.note ?? "",
    countUnit: source.countUnit ?? null, quantity: source.quantity ?? null, lastCountedAt: source.lastCountedAt ?? null,
    stockRevision: source.stockRevision ?? null, lastReceivedAt: source.lastReceivedAt ?? null,
    quickCheck: source.quickCheck ? { status: source.quickCheck.status, checkedAt: source.quickCheck.checkedAt, estimate: source.quickCheck.estimate } : null
  })).sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

/** Calendar-only and local inputs are Japanese store time, independent of server TZ. */
export function demandDateAt(value: unknown): string | null {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value))return null;
  const [year,month,day]=value.slice(0,10).split("-").map(Number);
  if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return null;
  const normalized=value.length===10?`${value}T00:00:00+09:00`:/Z$|[+-]\d{2}:\d{2}$/.test(value)?value:`${value}+09:00`;
  return Number.isFinite(Date.parse(normalized))?normalized:null;
}
