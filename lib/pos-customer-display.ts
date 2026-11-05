/** Live preparation is separate from cart lines and never contributes to the paid total. */
export type PosCustomerDisplayWeighingDraft = {
  previewId: string;
  itemId: string;
  itemName: string;
  optionLabel: string;
  source: "manual" | "capture" | "waiting";
  status: "waiting" | "stable" | "manual";
  quantity: number | null;
  unit: "g" | "kg";
  unitPrice: number;
  optionsAmount: number;
  amount: number | null;
  priceTaxMode: "tax_included" | "tax_excluded";
  captureId?: string;
  grossGrams?: number;
  tareGrams?: number;
  tarePresetId?: "small" | "large";
};
export type PosCustomerDisplayWeighing = PosCustomerDisplayWeighingDraft & {
  receivedAt: string;
  expiresAt: string;
};
export const customerDisplayWeighingTtlMs = 8_000;
export const customerDisplayUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function customerDisplayRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function customerDisplayRevision(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
const text = (value: unknown, limit: number) => String(value ?? "").trim().slice(0, limit);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Prices are the same explicit POS menu snapshot used by Add (menu updates are manual). */
export function normalizeCustomerDisplayWeighing(value: unknown, now = Date.now()): PosCustomerDisplayWeighing | null {
  if (value === null || value === undefined) return null;
  const row = customerDisplayRecord(value);
  if (!customerDisplayUuidPattern.test(String(row.previewId)) || !customerDisplayUuidPattern.test(String(row.itemId))
    || !text(row.itemName, 240) || !["g", "kg"].includes(String(row.unit))
    || !["waiting", "manual", "capture"].includes(String(row.source))
    || !finite(row.unitPrice) || row.unitPrice <= 0 || row.unitPrice > 10_000_000
    || !finite(row.optionsAmount) || !Number.isSafeInteger(row.optionsAmount) || Math.abs(row.optionsAmount) > 100_000_000) return null;
  const waiting = row.source === "waiting";
  if (waiting && (row.quantity !== null || row.status !== "waiting")) return null;
  if (!waiting && (!finite(row.quantity) || row.quantity <= 0 || row.quantity > (row.unit === "kg" ? 1000 : 1_000_000))) return null;
  if (row.source === "capture" && (row.status !== "stable" || !customerDisplayUuidPattern.test(String(row.captureId)))) return null;
  if (row.source === "manual" && row.status !== "manual") return null;
  const quantity = waiting ? null : Math.round(Number(row.quantity) * 1000) / 1000;
  if (quantity !== null && quantity <= 0) return null;
  const amount = quantity === null ? null : Math.round(quantity * row.unitPrice) + row.optionsAmount;
  if (amount !== null && (!Number.isSafeInteger(amount) || amount > 1_000_000_000)) return null;
  return {
    previewId: String(row.previewId), itemId: String(row.itemId), itemName: text(row.itemName, 240),
    optionLabel: text(row.optionLabel, 1500), source: row.source as PosCustomerDisplayWeighing["source"],
    status: waiting ? "waiting" : row.source === "capture" ? "stable" : "manual", quantity,
    unit: row.unit as "g" | "kg", unitPrice: row.unitPrice, optionsAmount: row.optionsAmount, amount,
    priceTaxMode: row.priceTaxMode === "tax_excluded" ? "tax_excluded" : "tax_included",
    ...(row.source === "capture" ? { captureId: String(row.captureId) } : {}),
    ...(finite(row.grossGrams) && row.grossGrams >= 0 && row.grossGrams <= 3000 ? { grossGrams: row.grossGrams } : {}),
    ...(finite(row.tareGrams) && row.tareGrams >= 0 && row.tareGrams <= 3000 ? { tareGrams: row.tareGrams } : {}),
    ...(row.tarePresetId === "small" || row.tarePresetId === "large" ? { tarePresetId: row.tarePresetId } : {}),
    receivedAt: new Date(now).toISOString(), expiresAt: new Date(now + customerDisplayWeighingTtlMs).toISOString()
  };
}

/** Receivers also call this on a local clock tick; a silent disconnect must not freeze a number. */
export function readCustomerDisplayWeighing(value: unknown, now = Date.now()): PosCustomerDisplayWeighing | null {
  const row = customerDisplayRecord(value);
  const receivedAt = Date.parse(String(row.receivedAt ?? "")), expiresAt = Date.parse(String(row.expiresAt ?? ""));
  if (!Number.isFinite(receivedAt) || !Number.isFinite(expiresAt) || receivedAt > now || expiresAt <= now
    || expiresAt - receivedAt > customerDisplayWeighingTtlMs || expiresAt <= receivedAt) return null;
  const normalized = normalizeCustomerDisplayWeighing(row, receivedAt);
  return normalized ? { ...normalized, expiresAt: new Date(expiresAt).toISOString() } : null;
}
