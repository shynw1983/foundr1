type InventoryObservation = {
  currentQuantity: number | null;
  safetyStock: number;
  exceptionCode: string;
};

/** A staff shortage observation is actionable even without a recent count. */
export function inventoryNeedsOrder(item: InventoryObservation): boolean {
  return item.exceptionCode === "low"
    || item.exceptionCode === "out"
    || (item.currentQuantity !== null
      && Number.isFinite(item.currentQuantity)
      && item.currentQuantity <= item.safetyStock);
}

/** Blank or malformed quantities must never become a confirmed zero count. */
export function normalizeInventoryCount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value.trim())) return null;
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 9_999_999_999.99) return null;
  const rounded = Math.round(quantity * 100) / 100;
  if (Math.abs(rounded - quantity) > 0.000001) return null;
  return rounded;
}

export function inventoryCountException(quantity: number, safetyStock: number): "" | "low" | "out" {
  return quantity === 0 ? "out" : quantity <= safetyStock ? "low" : "";
}
