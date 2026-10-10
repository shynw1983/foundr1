import { parseInventoryCountQuantity, resolveProductUnitConversion, unitConversionSnapshotsEqual, type ProductUnitConfigurationInput, type ProductUnitConversionSnapshot } from "./product-unit-conversions";
import type { InventoryRecipe, InventoryRecipeSnapshot } from "./inventory-recipe-policy";

export type ProductionInputMode = "exact" | "estimate" | "unmeasured";
export type InventoryProductionInput = { productId: string; inventoryItemId: string; quantity: number | null; unit: string; mode: ProductionInputMode; expectedStockRevision: number };
export type InventoryProductionPayload = { action: "produce"; requestId: string; storeId: string; recipeVersionId: string; outputInventoryItemId: string; outputQuantity: number; inputs: InventoryProductionInput[]; expectedOutputStockRevision: number };
export type InventoryTransferPayload = { action: "transfer_dispatch"; requestId: string; sourceStoreId: string; targetStoreId: string; productId: string; sourceInventoryItemId: string; targetInventoryItemId: string; quantity: number; unit: string; expectedSourceStockRevision: number; costPriceJpy: number | null; supplyPriceJpy: number | null };
export type InventoryTransferReceivePayload = { action: "transfer_receive"; requestId: string; transferId: string; quantity: number; expectedTargetStockRevision: number };
export type InventoryTransferRecord = { id: string; sourceStoreId: string; targetStoreId: string; productId: string; productName: string; targetInventoryItemId: string; quantity: number; receivedQuantity: number; remainingQuantity: number; unit: string; status: "in_transit" | "received"; supplyPriceJpy: number | null; costPriceJpy?: number | null };
export type InventoryProductionTarget = { id: string; storeId: string; storeName?: string; productId: string; productName: string; locationId: string; locationName: string; countUnit: string; stockQuantity: number | null; stockRevision: number; currentConversion: ProductUnitConversionSnapshot | null; stockConversionSnapshot: ProductUnitConversionSnapshot | null };
export type InventoryProductionRecord = { id: string; requestId: string; action: "produce" | "transfer_dispatch" | "transfer_receive"; recipeVersionId: string | null; recipeName: string; outputInventoryItemId: string | null; outputQuantity: number | null; outputUnit: string; inputs: InventoryProductionInput[]; createdAt: string; recordedBy: string; snapshot: Record<string, unknown> };
export type InventoryProductionResponse = { store: { id: string; name: string }; recipes: InventoryRecipe[]; inventoryItems: InventoryProductionTarget[]; recent: InventoryProductionRecord[]; transfers: InventoryTransferRecord[]; canProduce: boolean; canTransfer: boolean; canReceive: boolean; transferInventoryItems?: InventoryProductionTarget[] };
export class InventoryProductionError extends Error {
  constructor(message: string, public status = 400, public code = "invalid_production") { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function productionId(value: unknown) {
  if (typeof value !== "string" || !uuid.test(value.trim())) throw new InventoryProductionError("店舗・商品・庫位を正しく指定してください。");
  return value.trim().toLowerCase();
}
function unit(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 64 || /[\u0000-\u001f\u007f]/.test(value)) throw new InventoryProductionError("数量の単位を明示してください。");
  return value.trim();
}
function revision(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= 2_147_483_647) throw new InventoryProductionError("在庫情報を再取得してください。", 409, "stock_changed");
  return Number(value);
}
function quantity(value: unknown) {
  const result = parseInventoryCountQuantity(value);
  if (result === null || result <= 0) throw new InventoryProductionError("数量は小数点以下6桁以内の正の数で入力してください。");
  return result;
}
function price(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 9_999_999_999.99 || Math.round(value * 100) / 100 !== value) throw new InventoryProductionError("価格は小数点以下2桁以内の数値で入力してください。");
  return value;
}
export function normalizeInventoryProductionPayload(value: unknown): InventoryProductionPayload | InventoryTransferPayload | InventoryTransferReceivePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryProductionError("製造・移動内容を確認してください。");
  const raw = value as Record<string, unknown>;
  const requestId = productionId(raw.requestId);
  if (raw.action === "transfer_receive") return { action: "transfer_receive", requestId, transferId: productionId(raw.transferId), quantity: quantity(raw.quantity), expectedTargetStockRevision: revision(raw.expectedTargetStockRevision) };
  if (raw.action === "transfer_dispatch") {
    const sourceInventoryItemId = productionId(raw.sourceInventoryItemId), targetInventoryItemId = productionId(raw.targetInventoryItemId);
    if (sourceInventoryItemId === targetInventoryItemId) throw new InventoryProductionError("異なる出庫元と入庫先を選択してください。");
    const sourceStoreId = productionId(raw.sourceStoreId), targetStoreId = productionId(raw.targetStoreId);
    if (sourceStoreId === targetStoreId) throw new InventoryProductionError("配送先の店舗を選択してください。");
    return { action: "transfer_dispatch", requestId, sourceStoreId, targetStoreId, productId: productionId(raw.productId), sourceInventoryItemId, targetInventoryItemId, quantity: quantity(raw.quantity), unit: unit(raw.unit), expectedSourceStockRevision: revision(raw.expectedSourceStockRevision), costPriceJpy: price(raw.costPriceJpy), supplyPriceJpy: price(raw.supplyPriceJpy) };
  }
  if (raw.action !== undefined && raw.action !== "produce") throw new InventoryProductionError("操作を確認してください。");
  if (!Array.isArray(raw.inputs) || raw.inputs.length < 1 || raw.inputs.length > 100) throw new InventoryProductionError("投入商品を1〜100件で指定してください。");
  const seen = new Set<string>();
  const inputs = raw.inputs.map((value): InventoryProductionInput => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryProductionError("投入商品を確認してください。");
    const line = value as Record<string, unknown>, productId = productionId(line.productId);
    if (seen.has(productId)) throw new InventoryProductionError("投入商品を重複指定できません。");
    seen.add(productId);
    if (!["exact", "estimate", "unmeasured"].includes(String(line.mode))) throw new InventoryProductionError("投入量が実測・標準目安・未計量のどれかを選択してください。");
    const mode = line.mode as ProductionInputMode;
    if (mode === "unmeasured" && line.quantity !== null) throw new InventoryProductionError("未計量の投入量は空欄にしてください。");
    return { productId, inventoryItemId: productionId(line.inventoryItemId), quantity: mode === "unmeasured" ? null : quantity(line.quantity), unit: unit(line.unit), mode, expectedStockRevision: revision(line.expectedStockRevision) };
  }).sort((a, b) => a.productId.localeCompare(b.productId));
  return { action: "produce", requestId, storeId: productionId(raw.storeId), recipeVersionId: productionId(raw.recipeVersionId), outputInventoryItemId: productionId(raw.outputInventoryItemId), outputQuantity: quantity(raw.outputQuantity), inputs, expectedOutputStockRevision: revision(raw.expectedOutputStockRevision) };
}

function rational(value: number | string): [bigint, bigint] {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new InventoryProductionError("数量を正確に換算できません。");
  const places = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  let n = BigInt(`${match[2]}${match[3] ?? ""}`) * (match[1] ? BigInt(-1) : BigInt(1));
  const d = places >= 0 ? BigInt(10) ** BigInt(places) : BigInt(1);
  if (places < 0) n *= BigInt(10) ** BigInt(-places);
  return [n, d];
}
function fixed(n: bigint, d: bigint) {
  const scaled = n * BigInt(1_000_000);
  if (d <= BigInt(0) || scaled % d !== BigInt(0)) throw new InventoryProductionError("換算数量を小数点以下6桁まで正確に保存できません。", 400, "unrepresentable_quantity");
  const amount = scaled / d, absolute = amount < BigInt(0) ? -amount : amount;
  if (absolute > BigInt("999999999999999999")) throw new InventoryProductionError("在庫量が保存範囲を超えています。", 400, "stock_overflow");
  const digits = absolute.toString().padStart(7, "0");
  return `${amount < BigInt(0) ? "-" : ""}${digits.slice(0, -6)}.${digits.slice(-6)}`;
}
export function scaleProductionQuantity(value: number, outputQuantity: number, standardOutputQuantity: number) {
  const a = rational(value), b = rational(outputQuantity), c = rational(standardOutputQuantity);
  return Number(fixed(a[0] * b[0] * c[1], a[1] * b[1] * c[0]));
}
export function convertProductionQuantity(value: number, product: ProductUnitConfigurationInput, sourceUnit: string, countUnit: string, context: { hasBatchPackaging?: boolean } = {}) {
  if (sourceUnit === countUnit) {
    const amount = rational(value);
    return { quantity: fixed(amount[0], amount[1]), conversion: { purchaseUnit: sourceUnit, countUnit, unitsPerPurchase: 1 } };
  }
  if (context.hasBatchPackaging) throw new InventoryProductionError("異なる包装の入庫履歴があります。基準単位の実数または具体的な入庫批次を指定してください。", 409, "batch_unit_identity_required");
  const source = resolveProductUnitConversion(product, sourceUnit), target = resolveProductUnitConversion(product, countUnit);
  if (!source || !target) throw new InventoryProductionError("投入・産出単位と庫位の単位対応を設定してください。", 409, "conversion_unknown");
  const a = rational(value), b = rational(target.unitsPerPurchase), c = rational(source.unitsPerPurchase);
  return { quantity: fixed(a[0] * b[0] * c[1], a[1] * b[1] * c[0]), conversion: target };
}
export function changeProductionBook(before: string | null, delta: string) {
  if (before === null) return null;
  const a = rational(before), b = rational(delta);
  return fixed(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
}
export function validateProductionInputs(payload: InventoryProductionPayload, snapshot: InventoryRecipeSnapshot) {
  if (!snapshot.output || snapshot.output.quantity <= 0 || snapshot.inputs.length !== payload.inputs.length) throw new InventoryProductionError("製造配合の投入商品と産出商品を確認してください。", 409, "recipe_changed");
  for (const configured of snapshot.inputs) {
    const actual = payload.inputs.find(input => input.productId === configured.productId);
    if (!actual || actual.unit !== configured.unit) throw new InventoryProductionError("配合の投入商品と単位をすべて明示してください。", 409, "recipe_changed");
    if (actual.mode === "estimate" && (configured.quantity === null || actual.quantity !== scaleProductionQuantity(configured.quantity, payload.outputQuantity, snapshot.output.quantity))) throw new InventoryProductionError("標準目安は産出量に対応する配合数量を明示してください。");
  }
}
export function requireProductionBookSnapshot(before: string | null, saved: ProductUnitConversionSnapshot | null, current: ProductUnitConversionSnapshot) {
  if (before !== null && saved !== null && saved.countUnit !== current.countUnit) throw new InventoryProductionError("在庫の清点単位を再確認してください。", 409, "stock_conversion_changed");
}
