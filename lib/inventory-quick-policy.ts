/** Visual observations are separate from physical counts and book quantities. */
export type InventoryQuickCheckStatus = "enough" | "low" | "out";
export type InventoryQuickCheckBasis = {
  storeId: string;
  productId: string;
  locationId: string;
  stockRevision: number;
  quickRevision: number;
  countUnit: string;
  safetyStock: number | null;
  unitConfiguration: {
    unit: string;
    packageQuantity: number | null;
    packageQuantityUnit: string | null;
    inventoryUnitConversions: unknown;
  };
};
export type InventoryQuickCheckEstimate =
  | { kind: "quantity"; quantity: number; purchaseUnit: string }
  | { kind: "small"; purchaseUnit: string | null };
export type InventoryQuickCheck = {
  status: InventoryQuickCheckStatus;
  checkedAt: string;
  checkedBy: string;
  estimate: InventoryQuickCheckEstimate | null;
  state: "fresh" | "recheck" | "superseded";
};
export type InventoryQuickCheckSubmission = {
  itemId: string;
  status: InventoryQuickCheckStatus;
  expectedBasis: InventoryQuickCheckBasis;
  estimate?: InventoryQuickCheckEstimate | null;
};
export type InventoryQuickCheckFacts = {
  quickStatus?: unknown;
  quickCheckedAt?: unknown;
  quickCheckedBy?: unknown;
  quickEstimate?: unknown;
  quickBasis?: unknown;
  quickSupersededAt?: unknown;
};

export const inventoryQuickCheckFreshnessMs = 24 * 60 * 60 * 1000;
const writableRoles = new Set(["owner", "manager", "store_owner", "store_manager", "staff"]);
export function canQuickCheckInventoryRole(role: string) { return writableRoles.has(role); }

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Keep raw values and array order: configuration changes invalidate an observation. */
export function inventoryQuickCheckBasesEqual(a: unknown, b: unknown): boolean {
  return Boolean(a && b && stableJson(a) === stableJson(b));
}

export function createInventoryQuickCheckBasis(row: Record<string, unknown>): InventoryQuickCheckBasis {
  return {
    storeId: String(row.storeId ?? ""), productId: String(row.productId ?? ""), locationId: String(row.locationId ?? ""),
    stockRevision: Number(row.stockRevision ?? 0), quickRevision: Number(row.quickRevision ?? 0),
    countUnit: String(row.countUnit ?? ""), safetyStock: row.safetyStock === null || row.safetyStock === undefined ? null : Number(row.safetyStock),
    unitConfiguration: {
      unit: String(row.purchaseUnit ?? ""),
      packageQuantity: row.packageQuantity === null || row.packageQuantity === undefined ? null : Number(row.packageQuantity),
      packageQuantityUnit: Object.prototype.hasOwnProperty.call(row, "rawPackageQuantityUnit")
        ? row.rawPackageQuantityUnit === null ? null : String(row.rawPackageQuantityUnit)
        : row.packageQuantityUnit === null || row.packageQuantityUnit === undefined ? null : String(row.packageQuantityUnit),
      inventoryUnitConversions: row.inventoryUnitConversions ?? []
    }
  };
}

export function validInventoryQuickCheckBasis(value: unknown): value is InventoryQuickCheckBasis {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const basis = value as InventoryQuickCheckBasis;
  const config = basis.unitConfiguration;
  return [basis.storeId, basis.productId, basis.locationId].every(id => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    && Number.isInteger(basis.stockRevision) && basis.stockRevision >= 0
    && Number.isInteger(basis.quickRevision) && basis.quickRevision >= 0
    && typeof basis.countUnit === "string" && Boolean(basis.countUnit.trim())
    && (basis.safetyStock === null || Number.isFinite(basis.safetyStock) && basis.safetyStock >= 0)
    && Boolean(config && typeof config === "object" && typeof config.unit === "string"
      && (config.packageQuantity === null || Number.isFinite(config.packageQuantity))
      && (config.packageQuantityUnit === null || typeof config.packageQuantityUnit === "string")
      && Array.isArray(config.inventoryUnitConversions));
}

export function normalizeInventoryQuickCheckEstimate(value: unknown, purchaseUnit: string): InventoryQuickCheckEstimate | null | false {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const estimate = value as Record<string, unknown>;
  if (estimate.kind === "small") {
    return estimate.purchaseUnit === null || estimate.purchaseUnit === purchaseUnit
      ? { kind: "small", purchaseUnit: estimate.purchaseUnit === null ? null : purchaseUnit } : false;
  }
  if (estimate.kind !== "quantity" || estimate.purchaseUnit !== purchaseUnit || !purchaseUnit.trim()
    || typeof estimate.quantity !== "number" || !Number.isFinite(estimate.quantity) || estimate.quantity < 0
    || estimate.quantity >= 1_000_000_000_000 || Math.abs(estimate.quantity * 1e6 - Math.round(estimate.quantity * 1e6)) > 0.0001) return false;
  return { kind: "quantity", quantity: estimate.quantity, purchaseUnit };
}

export function readInventoryQuickCheck(facts: InventoryQuickCheckFacts, currentBasis: InventoryQuickCheckBasis, now = Date.now()): InventoryQuickCheck | null {
  if (!["enough", "low", "out"].includes(String(facts.quickStatus)) || !facts.quickCheckedAt) return null;
  const checkedAt = String(facts.quickCheckedAt);
  const time = Date.parse(checkedAt);
  const estimate = normalizeInventoryQuickCheckEstimate(facts.quickEstimate, (facts.quickBasis as InventoryQuickCheckBasis | null)?.unitConfiguration?.unit ?? "");
  return {
    status: facts.quickStatus as InventoryQuickCheckStatus, checkedAt, checkedBy: String(facts.quickCheckedBy ?? ""),
    estimate: estimate === false ? null : estimate,
    state: facts.quickSupersededAt ? "superseded"
      : Number.isFinite(time) && time <= now && now - time <= inventoryQuickCheckFreshnessMs
        && inventoryQuickCheckBasesEqual(facts.quickBasis, currentBasis) ? "fresh" : "recheck"
  };
}

export function effectiveQuickInventoryStockStatus(input: {
  quantity: number | null;
  safetyStock: number | null;
  exceptionCode: string;
  lastCountedAt: string | null;
  countUnit: string;
  quickCheck?: InventoryQuickCheck | null;
}): "available" | "low_stock" | "unavailable" {
  const check = input.quickCheck;
  // Negative reports remain actionable after arrival/config changes until a
  // person checks again. An old Enough must never hide a newer shortage.
  if (check && check.state !== "superseded") {
    if (check.status === "out") return "unavailable";
    if (check.status === "low") return "low_stock";
    if (check.state === "fresh") return "available";
  }
  if (input.exceptionCode === "out") return "unavailable";
  if (input.exceptionCode === "low") return "low_stock";
  if (input.quantity !== null && Number.isFinite(input.quantity)
    && input.safetyStock !== null && Number.isFinite(input.safetyStock) && input.safetyStock >= 0
    && input.lastCountedAt && input.countUnit.trim() && input.quantity <= input.safetyStock) {
    return input.quantity <= 0 ? "unavailable" : "low_stock";
  }
  return "available";
}
