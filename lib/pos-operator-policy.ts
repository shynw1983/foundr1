/** Shared protocol only: credentials and cryptography remain server-side. */
export type PosOperatorSettings = { enabled: boolean; idleMinutes: number };
export type PosOperatorProof = { sessionId: string; employeeId: string; authorizationId?: string };
export const posOperatorOperations = ["checkout", "table_adjust", "cash_open", "cash_in", "cash_out", "cash_close", "refund", "cash_admin"] as const;
export type PosOperatorOperation = typeof posOperatorOperations[number];
export const posOperatorUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizePosOperatorSettings(value: unknown): PosOperatorSettings {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const minutes = Number(record.idleMinutes);
  return { enabled: record.enabled === true, idleMinutes: Number.isFinite(minutes) ? Math.max(2, Math.min(60, Math.round(minutes))) : 10 };
}
export function isPosOperatorOperation(value: unknown): value is PosOperatorOperation {
  return typeof value === "string" && (posOperatorOperations as readonly string[]).includes(value);
}
export function isSensitivePosOperatorOperation(operation: PosOperatorOperation) {
  return ["cash_out", "refund", "table_adjust", "cash_admin"].includes(operation);
}
/** Match the JSON wire representation. Only the top-level identity proof is excluded. */
export function canonicalPosOperatorIntent(value: unknown): string {
  const input = JSON.parse(JSON.stringify(value)) as unknown;
  function sorted(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted((item as Record<string, unknown>)[key])]));
    return item;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_intent");
  const { posOperator: _proof, ...body } = input as Record<string, unknown>;
  return JSON.stringify(sorted(body));
}
