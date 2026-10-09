export type ProductInventoryUnitConversion = {
  unit: string;
  unitsPerPurchase: number;
  fractionalDenominator?: number | null;
};

export type ProductUnitConfigurationInput = {
  unit: string;
  packageQuantity?: number | string | null;
  packageQuantityUnit?: string | null;
  inventoryUnitConversions?: unknown;
};

export type ProductUnitConfigurationSnapshot = {
  unit: string;
  packageQuantity: number | null;
  packageQuantityUnit: string;
  inventoryUnitConversions: ProductInventoryUnitConversion[];
};

export type ProductUnitConversionSnapshot = {
  purchaseUnit: string;
  countUnit: string;
  unitsPerPurchase: number;
};

export const maxInventoryUnitConversions = 20;
export const maxUnitConversionFactor = 1_000_000_000;
export const minUnitConversionFactor = 0.000_000_001;
const maxFractionalDenominator = 1_000_000;
const maxScaledCountQuantity = BigInt("999999999999999999"); // numeric(18, 6)
const countScale = BigInt(1_000_000);
const bigintZero = BigInt(0);

function cleanUnit(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 64 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("単位は64文字以内で入力してください。");
  }
  return value.trim();
}

function explicitPackaging(product: ProductUnitConfigurationInput) {
  const quantity = product.packageQuantity === null || product.packageQuantity === undefined || String(product.packageQuantity).trim() === ""
    ? null : Number(product.packageQuantity);
  const unit = String(product.packageQuantityUnit ?? "").trim();
  return quantity !== null && Number.isFinite(quantity) && quantity > 0 && unit && unit !== product.unit.trim()
    ? { unit, unitsPerPurchase: quantity } : null;
}

/** One purchased unit contains this many explicitly named count/usage units. */
export function normalizeInventoryUnitConversions(value: unknown, product: ProductUnitConfigurationInput): ProductInventoryUnitConversion[] {
  const purchaseUnit = cleanUnit(product.unit);
  if (!Array.isArray(value) || value.length > maxInventoryUnitConversions) {
    throw new Error("使用・棚卸単位の対応は20件以内で設定してください。");
  }
  const packaging = explicitPackaging(product);
  const units = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("単位の対応が不正です。");
    const entry = raw as Record<string, unknown>;
    const unit = cleanUnit(entry.unit);
    const unitsPerPurchase = entry.unitsPerPurchase;
    if (units.has(unit)) throw new Error("同じ使用・棚卸単位を重複して設定できません。");
    units.add(unit);
    if (typeof unitsPerPurchase !== "number" || !Number.isFinite(unitsPerPurchase) || unitsPerPurchase < minUnitConversionFactor || unitsPerPurchase > maxUnitConversionFactor) {
      throw new Error("1購入単位あたりの数量は0.000000001から1000000000の範囲で入力してください。");
    }
    if (unit === purchaseUnit && unitsPerPurchase !== 1) throw new Error("購入単位自身の換算数量は1です。");
    const denominator = entry.fractionalDenominator;
    if (denominator !== undefined && denominator !== null) {
      if (typeof denominator !== "number" || !Number.isInteger(denominator) || denominator < 2 || denominator > maxFractionalDenominator ||
        unit !== `1/${denominator}${purchaseUnit}` || unitsPerPurchase !== denominator) {
        throw new Error("分割単位は購入単位と分母・換算数量を一致させてください。");
      }
    } else if (/^1\/\d+/.test(unit)) {
      throw new Error("分割単位の分母を設定してください。");
    }
    if (packaging?.unit === unit && packaging.unitsPerPurchase !== unitsPerPurchase) {
      throw new Error("包装数量と使用・棚卸単位の換算数量が一致していません。");
    }
    return { unit, unitsPerPurchase, ...(denominator !== undefined && denominator !== null ? { fractionalDenominator: denominator as number } : {}) };
  }).sort((left, right) => left.unit.localeCompare(right.unit, "ja"));
}

export function createProductUnitConfigurationSnapshot(product: ProductUnitConfigurationInput): ProductUnitConfigurationSnapshot {
  const unit = cleanUnit(product.unit);
  const rawQuantity = product.packageQuantity;
  const quantity = rawQuantity === null || rawQuantity === undefined || String(rawQuantity).trim() === "" ? null : Number(rawQuantity);
  return {
    unit,
    packageQuantity: quantity !== null && Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    packageQuantityUnit: String(product.packageQuantityUnit ?? "").trim(),
    inventoryUnitConversions: normalizeInventoryUnitConversions(product.inventoryUnitConversions ?? [], { ...product, unit })
  };
}

export function productUnitConfigurationSnapshotsEqual(left: unknown, right: unknown) {
  try {
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    const a = createProductUnitConfigurationSnapshot(left as ProductUnitConfigurationInput);
    const b = createProductUnitConfigurationSnapshot(right as ProductUnitConfigurationInput);
    return JSON.stringify(a) === JSON.stringify(b);
  } catch { return false; }
}

export function listProductUnitConversions(product: ProductUnitConfigurationInput): ProductUnitConversionSnapshot[] {
  try {
    const configuration = createProductUnitConfigurationSnapshot(product);
    const counts = new Map<string, number>([[configuration.unit, 1]]);
    const packaging = explicitPackaging(configuration);
    if (packaging) counts.set(packaging.unit, packaging.unitsPerPurchase);
    for (const entry of configuration.inventoryUnitConversions) counts.set(entry.unit, entry.unitsPerPurchase);
    return [...counts].map(([countUnit, unitsPerPurchase]) => ({ purchaseUnit: configuration.unit, countUnit, unitsPerPurchase }));
  } catch { return []; }
}

export function resolveProductUnitConversion(product: ProductUnitConfigurationInput, countUnit: string): ProductUnitConversionSnapshot | null {
  return listProductUnitConversions(product).find((snapshot) => snapshot.countUnit === countUnit.trim()) ?? null;
}

function isValidSnapshot(value: unknown): value is ProductUnitConversionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as ProductUnitConversionSnapshot;
  return typeof snapshot.purchaseUnit === "string" && Boolean(snapshot.purchaseUnit.trim()) &&
    typeof snapshot.countUnit === "string" && Boolean(snapshot.countUnit.trim()) &&
    typeof snapshot.unitsPerPurchase === "number" && Number.isFinite(snapshot.unitsPerPurchase) && snapshot.unitsPerPurchase > 0;
}

/** Null historical snapshots are unknown, including where the current master has a relation. */
export function unitConversionSnapshotsEqual(left: unknown, right: unknown) {
  return isValidSnapshot(left) && isValidSnapshot(right) && left.purchaseUnit === right.purchaseUnit &&
    left.countUnit === right.countUnit && left.unitsPerPurchase === right.unitsPerPurchase;
}

export function convertCountToPurchaseQuantity(quantity: number, snapshot: ProductUnitConversionSnapshot | null | undefined): number | null {
  if (!Number.isFinite(quantity) || quantity < 0 || !isValidSnapshot(snapshot)) return null;
  const result = quantity / snapshot.unitsPerPurchase;
  return Number.isFinite(result) ? result : null;
}

export function convertPurchaseToCountQuantity(quantity: number, snapshot: ProductUnitConversionSnapshot | null | undefined): number | null {
  if (!Number.isFinite(quantity) || quantity < 0 || !isValidSnapshot(snapshot)) return null;
  const result = quantity * snapshot.unitsPerPurchase;
  return Number.isFinite(result) ? result : null;
}

function decimalScaled(value: string): bigint | null {
  const match = value.match(/^(\d+)(?:\.(\d{1,6}))?$|^\.(\d{1,6})$/);
  if (!match) return null;
  return BigInt(match[1] ?? "0") * countScale + BigInt((match[2] ?? match[3] ?? "").padEnd(6, "0") || "0");
}

/** Reject non-terminating fractions and numbers that cannot survive numeric(18,6) without rounding. */
export function parseInventoryCountQuantity(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return null;
  const text = String(value).trim();
  if (text.length > 64) return null;
  let scaled: bigint | null;
  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const numerator = BigInt(fraction[1]), denominator = BigInt(fraction[2]);
    if (denominator === bigintZero || (numerator * countScale) % denominator !== bigintZero) return null;
    scaled = numerator * countScale / denominator;
  } else scaled = decimalScaled(text);
  if (scaled === null || scaled > maxScaledCountQuantity) return null;
  const quantity = Number(scaled) / 1_000_000;
  // JS cannot represent every 18-digit fixed-point number; do not silently lose the entered fraction.
  if (!Number.isFinite(quantity) || decimalScaled(quantity.toFixed(6)) !== scaled) return null;
  return quantity;
}

export function formatInventoryCountQuantity(value: number | null | undefined, locale = "ja-JP") {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return "";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
}
