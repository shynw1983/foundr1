import { parseInventoryCountQuantity, unitConversionSnapshotsEqual, type ProductUnitConversionSnapshot } from "./product-unit-conversions";
import { normalizeProductBatchPackaging, productBatchPackagingEquals, type ProductBatchPackaging, type ProductPackagingTemplate } from "./product-packaging-policy";

export type InventoryReceiptMode = "add" | "included" | "unverified";
export type InventoryReceiptSourceSnapshot = {
  purchaseOrderItemId: string; purchaseOrderId: string; storeId: string; productId: string; status: string;
  actualQuantity: number | null; actualUnit: string | null;
  latestActualId: string | null; latestActualQuantity: number | null; latestActualUnit: string | null; latestActualRecordedAt: string | null;
  deliveryBatchId: string | null; deliveryBatchStatus: string | null;
  actualPackaging?: ProductBatchPackaging | null;
};
export type InventoryReceiptSource = {
  purchaseOrderItemId: string; purchaseOrderId: string; orderNo: string; storeId: string; productId: string; productName: string;
  status: string; purchaseUnit: string; actualQuantity: number | null; actualUnit: string | null;
  receivedPurchaseQuantity: number; receivedPurchaseUnits: Array<{ quantity: number; purchaseUnit: string }>;
  remainingPurchaseQuantity: number | null; blockedReason: string | null;
  unverifiedRemainingPurchaseQuantity: number | null; unverifiedBlockedReason: string | null;
  correctionHref: string; expectedSource: InventoryReceiptSourceSnapshot;
  actualPackaging?: ProductBatchPackaging | null;
};
export type InventoryReceiptInventoryItem = {
  id: string; storeId: string; productId: string; productName: string; locationId: string; locationName: string; countUnit: string;
  currentQuantity: number | null; stockQuantity: number | null; stockRevision: number;
  currentConversion: ProductUnitConversionSnapshot | null; stockConversionSnapshot: ProductUnitConversionSnapshot | null;
  countConversionSnapshot: ProductUnitConversionSnapshot | null; lastCountedAt: string | null; lastReceivedAt: string | null;
  addBlockedReason: string | null; includedBlockedReason: string | null;
  unverifiedBlockedReason: string | null;
  batchAddBlockedReason?: string | null; batchIncludedBlockedReason?: string | null;
};
export type InventoryReceiptRecord = {
  id: string; requestId: string; purchaseOrderItemId: string; inventoryItemId: string; storeId: string;
  orderNo: string; productName: string; locationName: string; purchaseQuantity: number; purchaseUnit: string;
  countQuantity: number | null; countUnit: string; mode: InventoryReceiptMode; beforeStockQuantity: number | null; afterStockQuantity: number | null;
  conversionSnapshot: ProductUnitConversionSnapshot | null;
  batchPackaging?: ProductBatchPackaging | null;
  recordedBy: string; createdAt: string;
};
export type InventoryReceiptResponse = {
  store: { id: string; name: string }; sources: InventoryReceiptSource[]; inventoryItems: InventoryReceiptInventoryItem[];
  recentReceipts: InventoryReceiptRecord[]; canReceive: boolean;
  packagingTemplates?: ProductPackagingTemplate[];
};
export type InventoryReceiptPayload = {
  requestId: string; purchaseOrderItemId: string; inventoryItemId: string; purchaseQuantity: number; mode: InventoryReceiptMode;
  expectedSource: InventoryReceiptSourceSnapshot; expectedStockRevision: number; expectedConversion: ProductUnitConversionSnapshot | null;
  batchPackaging?: ProductBatchPackaging;
};
export class InventoryReceiptError extends Error {
  status: number; code: string;
  constructor(message: string, status = 400, code = "invalid_receipt") { super(message); this.status = status; this.code = code; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function receiptPackaging(value:unknown) {
  try { return normalizeProductBatchPackaging(value); }
  catch(error) { throw new InventoryReceiptError(error instanceof Error ? error.message:"今回の包装仕様を確認してください。",400,"invalid_packaging"); }
}
function id(value: unknown) {
  if (typeof value !== "string" || !uuid.test(value.trim())) throw new InventoryReceiptError("入庫する明細・保管場所を確認してください。");
  return value.trim().toLowerCase();
}

export function normalizeInventoryReceiptPayload(value: unknown): InventoryReceiptPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryReceiptError("入庫内容が不正です。");
  const input = value as Record<string, unknown>;
  const quantity = parseInventoryCountQuantity(input.purchaseQuantity);
  if (quantity === null || quantity <= 0) throw new InventoryReceiptError("入庫数量は正の数で入力してください。", 400, "invalid_quantity");
  if (input.mode !== "add" && input.mode !== "included" && input.mode !== "unverified") throw new InventoryReceiptError("在庫への登録方法を選択してください。");
  if (!Number.isInteger(input.expectedStockRevision) || Number(input.expectedStockRevision) < 0 || Number(input.expectedStockRevision) > 2_147_483_647) {
    throw new InventoryReceiptError("在庫情報を更新して確認してください。", 409, "stock_changed");
  }
  const expected = input.expectedSource;
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) throw new InventoryReceiptError("購入内容を更新して確認してください。", 409, "source_changed");
  const source = expected as Record<string, unknown>;
  const keys: Array<keyof InventoryReceiptSourceSnapshot> = ["purchaseOrderItemId", "purchaseOrderId", "storeId", "productId", "status", "actualQuantity", "actualUnit", "latestActualId", "latestActualQuantity", "latestActualUnit", "latestActualRecordedAt", "deliveryBatchId", "deliveryBatchStatus"];
  if (keys.some(key => !Object.hasOwn(source, key))) throw new InventoryReceiptError("購入内容を更新して確認してください。", 409, "source_changed");
  const normalizedSource = Object.fromEntries(keys.map(key => [key, source[key]])) as InventoryReceiptSourceSnapshot;
  normalizedSource.actualPackaging = source.actualPackaging === null || source.actualPackaging === undefined ? null : receiptPackaging(source.actualPackaging);
  normalizedSource.purchaseOrderItemId = id(source.purchaseOrderItemId);
  normalizedSource.purchaseOrderId = id(source.purchaseOrderId);
  normalizedSource.storeId = id(source.storeId);
  normalizedSource.productId = id(source.productId);
  for (const key of ["latestActualId", "deliveryBatchId"] as const) normalizedSource[key] = source[key] === null ? null : id(source[key]);
  for (const key of ["actualQuantity", "latestActualQuantity"] as const) {
    if (source[key] !== null && (typeof source[key] !== "number" || !Number.isFinite(source[key]) || Number(source[key]) < 0)) throw new InventoryReceiptError("購入数量を確認してください。");
  }
  for (const key of ["status", "actualUnit", "latestActualUnit", "latestActualRecordedAt", "deliveryBatchStatus"] as const) {
    if (source[key] !== null && typeof source[key] !== "string") throw new InventoryReceiptError("購入内容が不正です。");
  }
  const conversion = input.expectedConversion as ProductUnitConversionSnapshot | null | undefined;
  const batchPackaging = input.batchPackaging === undefined ? undefined : receiptPackaging(input.batchPackaging);
  if ((batchPackaging || normalizedSource.actualPackaging) && conversion!==null && !unitConversionSnapshotsEqual(conversion,conversion)) throw new InventoryReceiptError("棚卸単位の対応を再確認してください。",409,"conversion_unknown");
  if (input.mode === "unverified" ? conversion !== null : (!batchPackaging && !normalizedSource.actualPackaging && !unitConversionSnapshotsEqual(conversion, conversion))) {
    throw new InventoryReceiptError(input.mode === "unverified" ? "今回の到着だけを記録する場合、換算数量は設定しません。" : "商品と棚卸単位の対応を確認してください。", 409, "conversion_unknown");
  }
  const purchaseOrderItemId = id(input.purchaseOrderItemId);
  if (normalizedSource.purchaseOrderItemId !== purchaseOrderItemId) throw new InventoryReceiptError("入庫する購入明細が変わりました。", 409, "source_changed");
  return {
    requestId: id(input.requestId), purchaseOrderItemId, inventoryItemId: id(input.inventoryItemId), purchaseQuantity: quantity,
    mode: input.mode, expectedSource: normalizedSource, expectedStockRevision: Number(input.expectedStockRevision),
    expectedConversion: conversion ? { purchaseUnit: conversion.purchaseUnit, countUnit: conversion.countUnit, unitsPerPurchase: conversion.unitsPerPurchase } : null,
    ...(batchPackaging ? { batchPackaging } : {})
  };
}

export function inventoryReceiptSourceSnapshotsEqual(left: InventoryReceiptSourceSnapshot, right: InventoryReceiptSourceSnapshot) {
  const {actualPackaging:a,...leftFacts}=left,{actualPackaging:b,...rightFacts}=right;
  return Object.keys(leftFacts).length===Object.keys(rightFacts).length && Object.entries(leftFacts).every(([key,value])=>rightFacts[key as keyof typeof rightFacts]===value)
    && (a == null && b == null || productBatchPackagingEquals(a,b));
}
export function inventoryReceiptSourceBlockedReason(source: Pick<InventoryReceiptSource, "actualQuantity" | "actualUnit" | "purchaseUnit" | "receivedPurchaseQuantity" | "receivedPurchaseUnits">, mode: InventoryReceiptMode = "add") {
  if (source.actualQuantity === null) return "actual_quantity_unknown";
  if (source.actualQuantity <= 0) return "actual_quantity_zero";
  if (!source.actualUnit) return "actual_unit_unknown";
  if (mode !== "unverified" && source.actualUnit !== source.purchaseUnit) return "purchase_unit_changed";
  if (source.receivedPurchaseUnits.some(group => group.quantity > 0 && group.purchaseUnit !== source.actualUnit)) return "purchase_unit_changed";
  if (source.receivedPurchaseQuantity >= source.actualQuantity) return "fully_received";
  return null;
}
export function inventoryReceiptTargetBlockedReason(target: InventoryReceiptInventoryItem, mode: InventoryReceiptMode) {
  if (mode === "unverified") return null;
  if (!target.currentConversion) return "conversion_unknown";
  if (target.stockQuantity === null) return "stock_unknown";
  if (!unitConversionSnapshotsEqual(target.stockConversionSnapshot, target.currentConversion)) return "stock_conversion_changed";
  if (mode === "included" && (target.currentQuantity === null || !target.lastCountedAt)) return "count_unknown";
  if (mode === "included" && !unitConversionSnapshotsEqual(target.countConversionSnapshot, target.currentConversion)) return "count_conversion_changed";
  return null;
}

function rational(value: number): [bigint, bigint] | null {
  if (!Number.isFinite(value)) return null;
  const match = String(Math.abs(value)).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const decimalPlaces = (match[2]?.length ?? 0) - Number(match[3] ?? 0);
  const numerator = BigInt(`${match[1]}${match[2] ?? ""}`) * BigInt(value<0 ? -1:1);
  return decimalPlaces >= 0 ? [numerator, BigInt(10) ** BigInt(decimalPlaces)] : [numerator * BigInt(10) ** BigInt(-decimalPlaces), BigInt(1)];
}
function fromScaled(scaled: bigint) {
  const negative=scaled<BigInt(0),text=(negative ? -scaled:scaled).toString().padStart(7,"0");
  const value=parseInventoryCountQuantity(`${text.slice(0,-6)}.${text.slice(-6)}`);
  return value===null ? null:negative ? -value:value;
}
export function exactInventoryReceiptCountQuantity(purchaseQuantity: number, unitsPerPurchase: number) {
  const a = rational(purchaseQuantity), b = rational(unitsPerPurchase);
  if (!a || !b || purchaseQuantity <= 0 || unitsPerPurchase <= 0) return null;
  const numerator = a[0] * b[0] * BigInt(1_000_000), denominator = a[1] * b[1];
  return numerator % denominator === BigInt(0) ? fromScaled(numerator / denominator) : null;
}
export function addInventoryReceiptQuantities(left: number, right: number) {
  const a = rational(left), b = rational(right);
  if (!a || !b) return null;
  const numerator = (a[0] * b[1] + b[0] * a[1]) * BigInt(1_000_000), denominator = a[1] * b[1];
  return numerator % denominator === BigInt(0) ? fromScaled(numerator / denominator) : null;
}

export function validateInventoryReceipt(payload: InventoryReceiptPayload, source: InventoryReceiptSource, target: InventoryReceiptInventoryItem) {
  if (payload.purchaseOrderItemId !== source.purchaseOrderItemId || payload.inventoryItemId !== target.id) throw new InventoryReceiptError("入庫する購入明細と保管場所を確認してください。", 409, "target_mismatch");
  if (source.storeId !== target.storeId || source.productId !== target.productId) throw new InventoryReceiptError("購入明細と同じ店舗・商品の保管場所を選択してください。", 409, "target_mismatch");
  if (!["delivered", "received"].includes(source.status) || !inventoryReceiptSourceSnapshotsEqual(payload.expectedSource, source.expectedSource)) {
    throw new InventoryReceiptError("購入内容が更新されました。再読み込みして確認してください。", 409, "source_changed");
  }
  const batchPackaging=source.actualPackaging ?? payload.batchPackaging;
  if(source.actualPackaging && payload.batchPackaging && !productBatchPackagingEquals(source.actualPackaging,payload.batchPackaging)) throw new InventoryReceiptError("記録済みの購入包装仕様は変更できません。",409,"batch_packaging_changed");
  if(batchPackaging && (batchPackaging.purchaseUnit!==source.actualUnit || batchPackaging.countUnit!==target.countUnit ||
    (payload.mode!=="unverified" && target.countUnit===source.actualUnit))) {
    throw new InventoryReceiptError("今回の購入単位と保管先の内容・棚卸単位を一致させてください。包装が混在する同じ袋・箱単位には換算できません。",409,"batch_unit_mismatch");
  }
  const sourceBlocked = inventoryReceiptSourceBlockedReason(source, batchPackaging ? "unverified":payload.mode);
  if (sourceBlocked) throw new InventoryReceiptError("実際の購入数量・単位と入庫済み数量を確認してください。", 409, sourceBlocked);
  const receivedTotal = addInventoryReceiptQuantities(source.receivedPurchaseQuantity, payload.purchaseQuantity);
  if (receivedTotal === null || receivedTotal > source.actualQuantity!) throw new InventoryReceiptError("実際の購入数量を超えて入庫できません。", 409, "over_receipt");
  if (target.stockRevision !== payload.expectedStockRevision || (payload.mode !== "unverified" && !batchPackaging && !unitConversionSnapshotsEqual(payload.expectedConversion, target.currentConversion))) {
    throw new InventoryReceiptError("在庫または単位の対応が更新されました。再読み込みして確認してください。", 409, "stock_changed");
  }
  const targetBlocked = batchPackaging && payload.mode!=="unverified"
    ? (target.stockQuantity===null ? "stock_unknown":payload.mode==="included" && (target.currentQuantity===null || !target.lastCountedAt) ? "count_unknown":null)
    : inventoryReceiptTargetBlockedReason(target, payload.mode);
  if (targetBlocked) throw new InventoryReceiptError("在庫量と棚卸単位を確認してから入庫してください。", 409, targetBlocked);
  if (payload.mode === "unverified") {
    if (payload.expectedConversion !== null) throw new InventoryReceiptError("今回の到着だけを記録する場合、換算数量は設定しません。", 409, "conversion_unknown");
    return { countQuantity: null, afterStockQuantity: null, conversionSnapshot: null };
  }
  if (!batchPackaging && source.actualUnit !== target.currentConversion!.purchaseUnit) throw new InventoryReceiptError("実際の購入単位と現在の商品単位を確認してください。", 409, "purchase_unit_changed");
  const conversionSnapshot=batchPackaging ? {purchaseUnit:batchPackaging.purchaseUnit,countUnit:batchPackaging.countUnit,unitsPerPurchase:batchPackaging.stockQuantityPerPurchase}:target.currentConversion!;
  const countQuantity = exactInventoryReceiptCountQuantity(payload.purchaseQuantity, conversionSnapshot.unitsPerPurchase);
  if (countQuantity === null) throw new InventoryReceiptError("入庫後の数量を小数点以下6桁まで正確に表せません。単位を確認してください。", 400, "unrepresentable_quantity");
  const afterStockQuantity = payload.mode === "add" ? addInventoryReceiptQuantities(target.stockQuantity!, countQuantity) : target.stockQuantity;
  if (afterStockQuantity === null) throw new InventoryReceiptError("入庫後の在庫量を保存できません。数量を確認してください。", 400, "stock_overflow");
  return { countQuantity, afterStockQuantity, conversionSnapshot };
}
