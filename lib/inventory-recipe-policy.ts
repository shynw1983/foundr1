import { parseInventoryCountQuantity, type ProductInventoryUnitConversion } from "./product-unit-conversions";

export type InventoryRecipeInput = { productId: string; quantity: number | null; unit: string; mode: "exact" | "estimate" | "unmeasured" };
export type InventoryRecipeSnapshot = {
  basis: "serving" | "measured"; measuredUnit?: string;
  inputs: InventoryRecipeInput[]; output?: { productId: string; quantity: number; unit: string };
};
export type InventoryRecipe = {
  id: string; name: string; brandId: string; kind: "menu" | "production";
  targetType: "item" | "option" | null; targetId: string | null; outputProductId: string | null;
  currentVersionId: string; version: number; snapshot: InventoryRecipeSnapshot; status: "active" | "inactive";
};
export type InventoryRecipeProduct = { id: string; name: string; unit: string; packageQuantity: number | null; packageQuantityUnit: string; inventoryUnitConversions: ProductInventoryUnitConversion[] };
export type InventoryRecipesResponse = {
  recipes: InventoryRecipe[]; products: InventoryRecipeProduct[];
  menuTargets: Array<{ id: string; type: "item" | "option"; name: string; brandId: string }>;
  brands: Array<{ id: string; name: string }>; canManage: boolean;
};
export type InventoryRecipePayload = {
  action: "save" | "inactivate"; id?: string; requestId?: string; expectedVersionId: string | null;
  name: string; brandId: string; kind: "menu" | "production";
  targetType: "item" | "option" | null; targetId: string | null; outputProductId: string | null;
  snapshot: InventoryRecipeSnapshot;
};
export class InventoryRecipeError extends Error {
  constructor(message: string, public status = 400, public code = "invalid_recipe") { super(message); }
}
export const inventoryUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function recipeId(value: unknown) {
  if (typeof value !== "string" || !inventoryUuid.test(value.trim())) throw new InventoryRecipeError("商品・メニュー・版を正しく指定してください。");
  return value.trim().toLowerCase();
}
export function recipeUnit(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 64 || /[\u0000-\u001f\u007f]/.test(value)) throw new InventoryRecipeError("数量の単位を64文字以内で明示してください。");
  return value.trim();
}
export function normalizeInventoryRecipeSnapshot(value: unknown): InventoryRecipeSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryRecipeError("配合を確認してください。");
  const raw = value as Record<string, unknown>;
  if (raw.basis !== "serving" && raw.basis !== "measured") throw new InventoryRecipeError("1食または実測単位の基準を選択してください。");
  if (!Array.isArray(raw.inputs) || raw.inputs.length > 100) throw new InventoryRecipeError("投入商品は100件以内で設定してください。");
  const seen = new Set<string>();
  const inputs = raw.inputs.map((value): InventoryRecipeInput => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryRecipeError("投入商品が不正です。");
    const line = value as Record<string, unknown>;
    const productId = recipeId(line.productId);
    if (seen.has(productId)) throw new InventoryRecipeError("同じ商品を重複して設定できません。");
    seen.add(productId);
    if (!["exact", "estimate", "unmeasured"].includes(String(line.mode))) throw new InventoryRecipeError("投入数量の確かさを選択してください。");
    const mode = line.mode as InventoryRecipeInput["mode"];
    const quantity = mode === "unmeasured" ? null : parseInventoryCountQuantity(line.quantity);
    if ((mode === "unmeasured" && line.quantity !== null) || (mode !== "unmeasured" && (quantity === null || quantity <= 0))) throw new InventoryRecipeError("未計量は数量を空欄にし、標準・概算は正の数量を明示してください。");
    return { productId, quantity, unit: recipeUnit(line.unit), mode };
  });
  const snapshot: InventoryRecipeSnapshot = { basis: raw.basis, inputs };
  if (raw.basis === "measured") snapshot.measuredUnit = recipeUnit(raw.measuredUnit);
  if (raw.output !== undefined) {
    if (!raw.output || typeof raw.output !== "object" || Array.isArray(raw.output)) throw new InventoryRecipeError("産出商品を確認してください。");
    const output = raw.output as Record<string, unknown>;
    const quantity = parseInventoryCountQuantity(output.quantity);
    if (quantity === null || quantity <= 0) throw new InventoryRecipeError("標準産出量を正の数量で入力してください。");
    const productId = recipeId(output.productId);
    if (seen.has(productId)) throw new InventoryRecipeError("産出商品を同じ配合の投入商品には設定できません。");
    snapshot.output = { productId, quantity, unit: recipeUnit(output.unit) };
  }
  return snapshot;
}
export function normalizeInventoryRecipePayload(value: unknown): InventoryRecipePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InventoryRecipeError("配合情報が不正です。");
  const raw = value as Record<string, unknown>;
  const action = raw.action ?? "save";
  if (action !== "save" && action !== "inactivate") throw new InventoryRecipeError("操作を確認してください。");
  const id = raw.id ? recipeId(raw.id) : undefined;
  const expectedVersionId = raw.expectedVersionId === null || raw.expectedVersionId === undefined ? null : recipeId(raw.expectedVersionId);
  if (id && !expectedVersionId) throw new InventoryRecipeError("現在の配合版を再取得してください。", 409, "version_changed");
  if (!id && expectedVersionId) throw new InventoryRecipeError("新しい配合には既存の版を指定できません。");
  if (action === "inactivate") {
    if (!id) throw new InventoryRecipeError("停止する配合を指定してください。");
    return { action, id, expectedVersionId, name: "", brandId: "", kind: "menu", targetType: null, targetId: null, outputProductId: null, snapshot: { basis: "serving", inputs: [] } };
  }
  if (!id && !raw.requestId) throw new InventoryRecipeError("新しい配合の送信IDを指定してください。", 400, "request_id_required");
  const requestId = id ? undefined : recipeId(raw.requestId);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 160) throw new InventoryRecipeError("配合名は160文字以内で入力してください。");
  if (raw.kind !== "menu" && raw.kind !== "production") throw new InventoryRecipeError("用途を選択してください。");
  const snapshot = normalizeInventoryRecipeSnapshot(raw.snapshot);
  if(raw.kind==="production" && snapshot.inputs.length===0) throw new InventoryRecipeError("製造配合には少なくとも1件の投入商品を明示してください。");
  const targetType = raw.targetType === "item" || raw.targetType === "option" ? raw.targetType : null;
  const targetId = raw.targetId ? recipeId(raw.targetId) : null;
  const outputProductId = raw.outputProductId ? recipeId(raw.outputProductId) : null;
  if (raw.kind === "menu" && (!targetType || !targetId || outputProductId || snapshot.output)) throw new InventoryRecipeError("メニュー配合には対象商品または選択肢を指定してください。");
  if (raw.kind === "production" && (targetType || targetId || !outputProductId || snapshot.output?.productId !== outputProductId)) throw new InventoryRecipeError("製造配合には一致する産出商品と数量を指定してください。");
  return { action, id, requestId, expectedVersionId, name, brandId: recipeId(raw.brandId), kind: raw.kind, targetType, targetId, outputProductId, snapshot };
}
/** Freeze only normalized creation facts; later revisions never rewrite this request. */
export function inventoryRecipeCreateRequestPayload(payload: InventoryRecipePayload) {
  return { name: payload.name, brandId: payload.brandId, kind: payload.kind, targetType: payload.targetType,
    targetId: payload.targetId, outputProductId: payload.outputProductId, snapshot: payload.snapshot };
}
/** Hide the entire formula when any component would disclose an unpublished SKU. */
export function inventoryRecipeIsVisible(recipe: InventoryRecipe, allowedIds: Set<string>) {
  return recipe.snapshot.inputs.every(input => allowedIds.has(input.productId)) && (!recipe.outputProductId || allowedIds.has(recipe.outputProductId));
}
