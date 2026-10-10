import { resolveProductUnitConversion, unitConversionSnapshotsEqual, type ProductUnitConfigurationInput, type ProductUnitConversionSnapshot } from "./product-unit-conversions";

export type InventoryUsageTriggerMode = "preparation" | "confirmed_sale";
export type InventoryUsageSettings = {
  storeId: string; enabled: boolean; enabledFrom: string | null; triggerMode: InventoryUsageTriggerMode; revision: number;
};
export type InventoryOrderSourceOption = { id: string; quantity: number };
export type InventoryOrderSourceItem = {
  sourceItemId: string; menuCatalogItemId: string | null; quantity: number;
  measuredQuantity: number | null; measuredUnit: string; options: InventoryOrderSourceOption[];
  refundStatus: string; identityIssues: string[];
};
export type InventoryOrderSourceSnapshot = {
  schema: 1; orderSource: string; identityConfidence: "exact" | "unresolved";
  items: InventoryOrderSourceItem[]; rawItems: unknown[]; issueCodes: string[];
  orderIdentity?: { orderId: string; storeId: string; orderNo: string; sourceExternalId: string | null; createdAt: string };
  preparationEvidence?: { kind: "internal_preparation" | "operator_confirmed"; occurredAt: string };
};
export type InventoryOrderUsageIssue = {
  id: string; orderId: string; orderNo: string; code: string; details: Record<string, unknown>;
  createdAt: string; updatedAt: string; resolvedAt: string | null;
};
export type InventoryUsageLocationChoice = {
  productId: string; productName: string; explicitInventoryItemId: string | null;
  inventoryItemId: string | null; selection: "explicit" | "single" | "missing" | "ambiguous";
  items: Array<{ id: string; locationName: string; countUnit: string; stockQuantity: number | null; stockRevision: number }>;
};
export type InventoryOrderUsageMovement = {
  id: string; productId: string; productName: string; inventoryItemId: string | null; locationName: string;
  quantity: number | null; countUnit: string; confidence: "exact" | "estimate" | "unmeasured";
  changesStock: boolean; beforeQuantity: number | null; afterQuantity: number | null;
};
export type InventoryOrderUsageRecord = {
  id: string; orderId: string; orderNo: string; occurredAt: string;
  items: InventoryOrderUsageMovement[]; restrictedItemCount: number;
};
export type InventoryOrderMappingItem = {
  sourceItemId: string; menuCatalogItemId: string; quantity: number;
  options: InventoryOrderSourceOption[]; measuredQuantity?: number | null; measuredUnit?: string;
};
export type InventoryOrderMappingTarget = { id: string; name: string; brandId: string; brandName?: string; category: string };
export type InventoryOrderMappingOption = {
  id: string; name: string; brandId: string; groupId: string; groupName: string;
  menuCatalogItemId: string | null; groupApplicableCategories: string[]; applicableCategories: string[];
};
export type InventoryOrderUsagePendingSource = {
  orderId: string; orderNo: string; orderSource: string; status: string; firstPreparedAt: string | null;
  orderedAt: string; requiresPreparationTime: boolean;
  identityWarnings: string[]; expectedSourceSnapshot: InventoryOrderSourceSnapshot;
  items: Array<{ sourceItemId: string; rawName: string; quantity: number | null;
    rawOptions: Array<{ name: string; quantity: number | null }>; rawSpecifications?: string[] }>;
};
/** Match the same parent/category boundary as the store POS. Never resolve by name. */
export function isInventoryMappedOptionAllowed(option: InventoryOrderMappingOption,menu: InventoryOrderMappingTarget): boolean {
  if(option.brandId!==menu.brandId || option.menuCatalogItemId && option.menuCatalogItemId!==menu.id)return false;
  const category=menu.category||"未分類";
  return Boolean((option.menuCatalogItemId || !option.groupApplicableCategories.length || option.groupApplicableCategories.includes(category))
    && (!option.applicableCategories.length || option.applicableCategories.includes(category)));
}
export type InventoryOrderUsageResponse = {
  settings: InventoryUsageSettings; locations: InventoryUsageLocationChoice[];
  issues: InventoryOrderUsageIssue[]; recentUsage: InventoryOrderUsageRecord[];
  canManage: boolean; pendingSources: InventoryOrderUsagePendingSource[];
  menuTargets: InventoryOrderMappingTarget[]; optionTargets: InventoryOrderMappingOption[];
};
export type InventoryOrderUsageRequest =
  | { action: "settings"; storeId: string; enabled: boolean; triggerMode: InventoryUsageTriggerMode; expectedRevision: number }
  | { action: "location"; storeId: string; productId: string; inventoryItemId: string | null; expectedInventoryItemId: string | null }
  | { action: "retry"; storeId: string }
  | { action: "map_source"; storeId: string; orderId: string; expectedSourceSnapshot: InventoryOrderSourceSnapshot;
    mappedItems: InventoryOrderMappingItem[]; confirmOriginalOrder: true; confirmedPreparedAt?: string };
export type InventoryUsageRecipeInput = { productId: string; quantity: number | null; unit: string; mode: "exact" | "estimate" | "unmeasured" };
export type InventoryUsageRecipe = {
  id: string; brandId: string; targetType: "item" | "option"; targetId: string; versionId: string;
  snapshot: { basis: "serving" | "measured"; measuredUnit?: string; inputs: InventoryUsageRecipeInput[] };
};
export type InventoryUsageProduct = ProductUnitConfigurationInput & { id: string; brandScope: string; brandIds: string[] };
export type InventoryUsageStock = {
  id: string; productId: string; countUnit: string; quantity: number | null; stockRevision: number;
  conversionSnapshot: ProductUnitConversionSnapshot | null; lastCountedAt: string | null;
  hasBatchPackaging?: boolean;
};
export type InventoryOrderUsagePlanLine = {
  sourceItemId: string; productId: string; inventoryItemId: string | null; recipeVersionId: string;
  quantity: number | null; countUnit: string; confidence: "exact" | "estimate" | "unmeasured";
  exposure: number; changesStock: boolean; beforeQuantity: number | null; afterQuantity: number | null;
  expectedStockRevision: number | null; productConfiguration: ProductUnitConfigurationInput;
  conversionSnapshot: ProductUnitConversionSnapshot | null; metadata: Record<string, unknown>;
};
export type InventoryOrderUsagePlan = {
  lines: InventoryOrderUsagePlanLine[];
  issues: Array<{ code: string; details: Record<string, unknown> }>;
  mappedServings: number; unmappedItems: number;
};

export type InventoryOrderReadyOptions = {
  reliableIdentity?: boolean;
  issueCodes?: string[];
  /** Only a trusted source integration may supply explicit OS UUID mappings. */
  mappedItems?: Array<{ sourceItemId: string; menuCatalogItemId: string; quantity?: number; options: InventoryOrderSourceOption[];
    measuredQuantity?: number | null; measuredUnit?: string }>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isInventoryUsageUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
export function nullableInventoryUsageNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value); return Number.isFinite(number) ? number : null;
}
export function normalizeInventoryOrderSource(rawItems: Array<Record<string, unknown>>, orderSource: string, options: InventoryOrderReadyOptions = {}): InventoryOrderSourceSnapshot {
  const supported = ["store_pos", "table_qr", "nanacha_web", "maamaa_web"].includes(orderSource);
  const mapped = new Map((options.mappedItems ?? []).map(item => [item.sourceItemId, item]));
  const issueCodes = new Set(options.issueCodes ?? []);
  if (!supported && options.reliableIdentity !== true) issueCodes.add("unsupported_bridge_identity");
  const items = rawItems.map(row => {
    const sourceItemId = String(row.sourceItemId ?? "");
    const explicit = mapped.get(sourceItemId);
    const identityIssues: string[] = [];
    const menuId = explicit?.menuCatalogItemId ?? row.menuCatalogItemId;
    const quantity = nullableInventoryUsageNumber(explicit?.quantity ?? row.quantity);
    if (!isInventoryUsageUuid(sourceItemId)) identityIssues.push("invalid_source_item_identity");
    if (!isInventoryUsageUuid(menuId)) identityIssues.push("missing_menu_identity");
    if (quantity === null || quantity <= 0 || !Number.isInteger(quantity)) identityIssues.push("invalid_serving_quantity");
    const counts = new Map<string, number>();
    if (explicit) {
      for (const option of explicit.options) {
        if (!isInventoryUsageUuid(option.id) || !Number.isInteger(option.quantity) || option.quantity <= 0) identityIssues.push("invalid_option_identity");
        else counts.set(option.id, (counts.get(option.id) ?? 0) + option.quantity);
      }
    } else {
      const customizations = Array.isArray(row.customizations) ? row.customizations as Array<Record<string, unknown>> : [];
      for (const customization of customizations) {
        if (!Array.isArray(customization.optionIds)) { identityIssues.push("missing_option_identity"); continue; }
        for (const id of customization.optionIds) {
          if (!isInventoryUsageUuid(id)) identityIssues.push("invalid_option_identity");
          else counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      if (!customizations.length && (String(row.optionKey ?? "").trim() || String(row.sizeKey ?? "").trim()
        || String(row.temperature ?? "").trim() || String(row.sweetness ?? "").trim() || String(row.ice ?? "").trim()
        || Array.isArray(row.toppingKeys) && row.toppingKeys.length)) identityIssues.push("missing_structured_options");
    }
    return {
      sourceItemId, menuCatalogItemId: isInventoryUsageUuid(menuId) ? menuId : null,
      quantity: quantity ?? 0, measuredQuantity: nullableInventoryUsageNumber(explicit&&Object.prototype.hasOwnProperty.call(explicit,"measuredQuantity") ? explicit.measuredQuantity : row.measuredQuantity),
      measuredUnit: String(explicit?.measuredUnit ?? row.measuredUnit ?? ""), refundStatus: String(row.refundStatus ?? ""),
      options: [...counts].map(([id, quantity]) => ({ id, quantity })), identityIssues: [...new Set(identityIssues)]
    };
  });
  for (const item of items) for (const code of item.identityIssues) issueCodes.add(code);
  return { schema: 1, orderSource, identityConfidence: issueCodes.size ? "unresolved" : "exact", items, rawItems, issueCodes: [...issueCodes] };
}

export function inventoryOrderUsageOccurredAt(order: {
  status: string; paymentStatus: string; orderSource: string; firstPreparedAt: string | null;
  preparingAt: string | null; readyAt: string | null; completedAt: string | null; paidAt: string | null;
}, settings: InventoryUsageSettings): string | null {
  if (!settings.enabled || !settings.enabledFrom) return null;
  const preparedAt=order.firstPreparedAt||order.preparingAt||order.readyAt||order.completedAt;
  // A financial refund cannot erase food already prepared while an inventory
  // retry was pending. Prior physical preparation wins over mutable status.
  const occurredAt=preparedAt || (settings.triggerMode==="confirmed_sale" && order.orderSource!=="table_qr"
    && ["paid","partial_refunded"].includes(order.paymentStatus)
    && !["cancelled","refund_pending","pending_payment","checkout_failed","payment_failed"].includes(order.status) ? order.paidAt : null);
  const time = occurredAt ? Date.parse(occurredAt) : NaN;
  const cutoff = Date.parse(settings.enabledFrom);
  return Number.isFinite(time) && Number.isFinite(cutoff) && time >= cutoff ? occurredAt : null;
}

function decimalFraction(value: number): [bigint,bigint] | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const [coefficient, exponentText = "0"] = value.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const exponent = Number(exponentText) - fraction.length;
  let numerator = BigInt(`${whole}${fraction}`), denominator = BigInt(1);
  if (exponent >= 0) numerator *= BigInt(10) ** BigInt(exponent);
  else denominator = BigInt(10) ** BigInt(-exponent);
  return [numerator,denominator];
}
export function exactInventoryUsageQuantity(quantity: number, exposure: number, inputFactor = 1, countFactor = 1): number | null {
  const fractions = [quantity,exposure,inputFactor,countFactor].map(decimalFraction);
  if (fractions.some(value => !value) || inputFactor <= 0 || countFactor <= 0) return null;
  const [q,e,i,c] = fractions as Array<[bigint,bigint]>;
  const numerator = q[0]*e[0]*i[1]*c[0]*BigInt(1_000_000);
  const denominator = q[1]*e[1]*i[0]*c[1];
  if (!denominator || numerator % denominator !== BigInt(0)) return null;
  const scaled = numerator / denominator;
  if (scaled > BigInt("999999999999999999")) return null;
  return Number(scaled)/1_000_000;
}

/** Explicit recipe quantities only. Names, estimated bags and production text never resolve identity. */
export function planInventoryOrderUsage(input: {
  source: InventoryOrderSourceSnapshot; recipes: InventoryUsageRecipe[]; products: InventoryUsageProduct[];
  stocks: InventoryUsageStock[]; explicitLocations: Map<string, string>; occurredAt: string;
}): InventoryOrderUsagePlan {
  const plan: InventoryOrderUsagePlan = { lines: [], issues: [], mappedServings: 0, unmappedItems: 0 };
  const issue = (code: string, details: Record<string, unknown>) => plan.issues.push({ code, details });
  if (input.source.identityConfidence !== "exact") {
    for (const code of input.source.issueCodes) issue(code, { itemCount: input.source.items.length });
    plan.unmappedItems = input.source.items.filter(item => item.refundStatus !== "refunded").length;
    return plan;
  }
  const recipes = new Map(input.recipes.map(recipe => [`${recipe.targetType}:${recipe.targetId}`, recipe]));
  const products = new Map(input.products.map(product => [product.id, product]));
  const balances = new Map(input.stocks.map(stock => [stock.id, stock.quantity]));
  for (const item of input.source.items) {
    if (item.refundStatus === "refunded") continue;
    let matched = false;
    for (const target of [
      { type: "item", id: item.menuCatalogItemId, multiplier: 1 },
      ...item.options.map(option => ({ type: "option", id: option.id, multiplier: option.quantity }))
    ]) {
      const recipe = recipes.get(`${target.type}:${target.id}`);
      if (!recipe) { issue("recipe_missing", { sourceItemId: item.sourceItemId, targetType: target.type, targetId: target.id }); continue; }
      let exposure = item.quantity * target.multiplier;
      if (recipe.snapshot.basis === "measured") {
        if (item.measuredQuantity === null || item.measuredQuantity <= 0 || item.measuredUnit !== recipe.snapshot.measuredUnit) {
          issue("measured_basis_unknown", { sourceItemId: item.sourceItemId, recipeVersionId: recipe.versionId }); continue;
        }
        exposure = item.measuredQuantity * item.quantity * target.multiplier;
      }
      matched = true;
      for (const ingredient of recipe.snapshot.inputs) {
        const product = products.get(ingredient.productId);
        if (!product || !(product.brandScope === "common" || product.brandIds.includes(recipe.brandId))) {
          issue("recipe_product_scope_changed", { productId: ingredient.productId, recipeVersionId: recipe.versionId }); continue;
        }
        const candidates = input.stocks.filter(stock => stock.productId === ingredient.productId);
        const explicitId = input.explicitLocations.get(ingredient.productId);
        const stock = explicitId ? candidates.find(candidate => candidate.id === explicitId) : candidates.length === 1 ? candidates[0] : undefined;
        if (!stock) issue(candidates.length > 1 ? "usage_location_ambiguous" : "usage_location_missing", { productId: ingredient.productId });
        const inputConversion = resolveProductUnitConversion(product, ingredient.unit);
        const countConversion = stock ? resolveProductUnitConversion(product, stock.countUnit) : null;
        const literalIdentity = Boolean(stock && ingredient.unit === stock.countUnit);
        const batchUnitUnknown = Boolean(stock?.hasBatchPackaging && !literalIdentity);
        const countQuantity = ingredient.quantity === null || batchUnitUnknown ? null
          : literalIdentity ? exactInventoryUsageQuantity(ingredient.quantity,exposure)
            : inputConversion && countConversion ? exactInventoryUsageQuantity(ingredient.quantity,exposure,inputConversion.unitsPerPurchase,countConversion.unitsPerPurchase) : null;
        const quantity = countQuantity === null ? null : -countQuantity;
        const anchorIncludesOrder = Boolean(stock?.lastCountedAt && Date.parse(stock.lastCountedAt) >= Date.parse(input.occurredAt));
        const confirmedConversion = literalIdentity || Boolean(countConversion && stock && unitConversionSnapshotsEqual(stock.conversionSnapshot, countConversion));
        const confidence = ingredient.mode === "unmeasured" || ingredient.quantity === null ? "unmeasured" : ingredient.mode === "estimate" ? "estimate" : "exact";
        const beforeQuantity = stock ? balances.get(stock.id) ?? null : null;
        const changesStock = Boolean(stock && confidence === "exact" && quantity !== null && confirmedConversion && beforeQuantity !== null && !anchorIncludesOrder);
        const afterQuantity = changesStock ? Number((beforeQuantity! + quantity!).toFixed(6)) : beforeQuantity;
        const reason = !stock ? "location_unconfigured" : anchorIncludesOrder ? "count_anchor_includes_order"
          : confidence !== "exact" ? "recipe_estimate" : batchUnitUnknown ? "batch_unit_identity_required" : quantity === null ? "unit_conversion_unknown"
            : !confirmedConversion ? "stock_unit_snapshot_unknown" : beforeQuantity === null ? "stock_balance_unknown" : "";
        if (reason && !["count_anchor_includes_order", "recipe_estimate", "location_unconfigured"].includes(reason)) issue(reason, { productId: ingredient.productId });
        if (stock) balances.set(stock.id, afterQuantity);
        plan.lines.push({
          sourceItemId: item.sourceItemId, productId: ingredient.productId, inventoryItemId: stock?.id ?? null,
          recipeVersionId: recipe.versionId, quantity, countUnit: stock?.countUnit ?? ingredient.unit, confidence,
          exposure, changesStock, beforeQuantity, afterQuantity, expectedStockRevision: stock?.stockRevision ?? null,
          productConfiguration: { unit: product.unit, packageQuantity: product.packageQuantity ?? null, packageQuantityUnit: product.packageQuantityUnit ?? null, inventoryUnitConversions: product.inventoryUnitConversions ?? [] },
          conversionSnapshot: countConversion, metadata: { reason, recipe: recipe.snapshot, recipeBasis: recipe.snapshot.basis,
            sourceTargetType: target.type, sourceTargetId: target.id, inputQuantity: ingredient.quantity, inputUnit: ingredient.unit,
            measurement: "recipe_standard", anchorIncludesOrder, bookUnknown: Boolean(stock && beforeQuantity === null) }
        });
      }
    }
    if (matched) plan.mappedServings += item.quantity; else plan.unmappedItems++;
  }
  return plan;
}
