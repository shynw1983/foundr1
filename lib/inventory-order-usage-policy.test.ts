import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type {
  InventoryOrderSourceSnapshot, InventoryUsageProduct, InventoryUsageRecipe, InventoryUsageSettings, InventoryUsageStock
} from "./inventory-order-usage-policy";

function load(path: string, modules: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected policy dependency ${name}`);
    return modules[name];
  } });
  return exports;
}
const units = load("./product-unit-conversions.ts") as unknown as typeof import("./product-unit-conversions");
const policy = load("./inventory-order-usage-policy.ts", { "./product-unit-conversions": units }) as unknown as typeof import("./inventory-order-usage-policy");
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const sourceItemId = uuid(1), menuId = uuid(2), optionId = uuid(3), brandId = uuid(4), productId = uuid(5), stockId = uuid(6);
const occurredAt = "2026-10-11T12:00:00Z";
const product: InventoryUsageProduct = {
  id: productId, unit: "袋", packageQuantity: 20, packageQuantityUnit: "個", inventoryUnitConversions: [],
  brandScope: "specific", brandIds: [brandId]
};
const stock: InventoryUsageStock = {
  id: stockId, productId, countUnit: "個", quantity: 20, stockRevision: 2,
  conversionSnapshot: { purchaseUnit: "袋", countUnit: "個", unitsPerPurchase: 20 }, lastCountedAt: "2026-10-11T10:00:00Z"
};
const recipe: InventoryUsageRecipe = {
  id: uuid(7), brandId, targetType: "item", targetId: menuId, versionId: uuid(8),
  snapshot: { basis: "serving", inputs: [{ productId, quantity: 1, unit: "個", mode: "exact" }] }
};
function raw(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { sourceItemId, menuCatalogItemId: menuId, quantity: 3, measuredQuantity: null, measuredUnit: "", customizations: [], refundStatus: "", ...patch };
}
function source(patch: Record<string, unknown> = {}) {
  return policy.normalizeInventoryOrderSource([raw(patch)], "store_pos");
}
function plan(patch: Partial<Parameters<typeof policy.planInventoryOrderUsage>[0]> = {}) {
  return policy.planInventoryOrderUsage({ source: source(), recipes: [recipe], products: [product], stocks: [stock], explicitLocations: new Map(), occurredAt, ...patch });
}

test("exact OS UUIDs preserve repeated options as per-serving quantities multiplied by outer servings", () => {
  const normalized = source({ customizations: [{ groupId: uuid(9), optionIds: [optionId, optionId] }, { groupId: uuid(10), optionIds: [optionId] }] });
  assert.equal(normalized.identityConfidence, "exact");
  assert.equal(normalized.items[0].quantity, 3);
  assert.equal(normalized.items[0].options.length, 1);
  assert.equal(normalized.items[0].options[0].quantity, 3);
  const optionRecipe = { ...recipe, id: uuid(11), targetType: "option" as const, targetId: optionId, versionId: uuid(12), snapshot: { basis: "serving" as const, inputs: [{productId, quantity: 0.5, unit: "個", mode: "exact" as const}] } };
  const result = plan({ source: normalized, recipes: [recipe, optionRecipe] });
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].quantity, -3);
  assert.equal(result.lines[1].exposure, 9);
  assert.equal(result.lines[1].quantity, -4.5);
  assert.equal(result.lines[1].beforeQuantity, 17);
  assert.equal(result.lines[1].afterQuantity, 12.5);
  assert.equal(result.mappedServings, 3);
});

test("missing identity, label-only selections and unresolved replacements produce issues without guessed stock use", () => {
  for (const [patch, code] of [
    [{ sourceItemId: "same-name" }, "invalid_source_item_identity"],
    [{ menuCatalogItemId: "Tea" }, "missing_menu_identity"],
    [{ quantity: null }, "invalid_serving_quantity"],
    [{ quantity: 1.5 }, "invalid_serving_quantity"],
    [{ customizations: [{optionLabels: ["Pearl"]}] }, "missing_option_identity"],
    [{ customizations: [{optionIds: ["Pearl"]}] }, "invalid_option_identity"],
    [{ customizations: [], toppingKeys: ["pearl"] }, "missing_structured_options"]
  ] as const) {
    const normalized = source(patch);
    assert.equal(normalized.identityConfidence, "unresolved");
    assert.ok(normalized.issueCodes.includes(code));
    assert.equal(plan({ source: normalized }).lines.length, 0);
  }
  const replacement = policy.normalizeInventoryOrderSource([raw()], "store_pos", {issueCodes: ["unresolved_replacement"]});
  assert.equal(plan({ source: replacement }).lines.length, 0);
  assert.equal(replacement.identityConfidence, "unresolved");
});

test("Bridge remains unresolved until a trusted integration provides explicit OS mappings", () => {
  const bridgeRaw = [raw({ menuCatalogItemId: null, toppingKeys: ["Pearl"] })];
  const unresolved = policy.normalizeInventoryOrderSource(bridgeRaw, "uber_eats", {reliableIdentity: false});
  assert.ok(unresolved.issueCodes.includes("unsupported_bridge_identity"));
  assert.equal(plan({source: unresolved}).lines.length, 0);
  const mapped = policy.normalizeInventoryOrderSource(bridgeRaw, "uber_eats", {
    reliableIdentity: true, mappedItems: [{sourceItemId, menuCatalogItemId: menuId, options: [{id: optionId, quantity: 2}, {id: optionId, quantity: 1}]}]
  });
  assert.equal(mapped.identityConfidence, "exact");
  assert.equal(mapped.items[0].menuCatalogItemId, menuId);
  assert.equal(mapped.items[0].options[0].quantity, 3);
  const invalid = policy.normalizeInventoryOrderSource(bridgeRaw, "uber_eats", {
    reliableIdentity: true, mappedItems: [{sourceItemId, menuCatalogItemId: menuId, options: [{id: "same-name", quantity: 2}]}]
  });
  assert.equal(invalid.identityConfidence, "unresolved");
  assert.ok(invalid.issueCodes.includes("invalid_option_identity"));
});

test("human option mapping honors brand, parent menu, global group categories and option categories", () => {
  const menu = {id: menuId, name: "Tea", brandId, category: "Tea"};
  const option = {id: optionId, name: "Extra", brandId, groupId: uuid(9), groupName: "Extras",
    menuCatalogItemId: null, groupApplicableCategories: [], applicableCategories: []};
  assert.equal(policy.isInventoryMappedOptionAllowed(option, menu), true);
  assert.equal(policy.isInventoryMappedOptionAllowed({...option, brandId: uuid(30)}, menu), false);
  assert.equal(policy.isInventoryMappedOptionAllowed({...option, menuCatalogItemId: uuid(31)}, menu), false);
  assert.equal(policy.isInventoryMappedOptionAllowed({...option, menuCatalogItemId: menuId, groupApplicableCategories: ["Food"]}, menu), true);
  assert.equal(policy.isInventoryMappedOptionAllowed({...option, groupApplicableCategories: ["Food"]}, menu), false);
  assert.equal(policy.isInventoryMappedOptionAllowed({...option, groupApplicableCategories: ["Tea"]}, menu), true);
  assert.equal(policy.isInventoryMappedOptionAllowed({...option, applicableCategories: ["Food"]}, menu), false);
  assert.equal(policy.isInventoryMappedOptionAllowed({...option, groupApplicableCategories: ["未分類"], applicableCategories: ["未分類"]}, {...menu, category: ""}), true);
});

test("measured recipes explicitly use matching measurement units while serving recipes ignore measured weight", () => {
  const measuredSource = source({quantity: 2, measuredQuantity: 0.5, measuredUnit: "kg"});
  assert.equal(plan({source: measuredSource}).lines[0].quantity, -2);
  const measuredRecipe = {...recipe, snapshot: {basis: "measured" as const, measuredUnit: "kg", inputs: [{productId, quantity: 4, unit: "個", mode: "exact" as const}]}};
  const result = plan({source: measuredSource, recipes: [measuredRecipe]});
  assert.equal(result.lines[0].exposure, 1);
  assert.equal(result.lines[0].quantity, -4);
  for (const patch of [{measuredQuantity: null}, {measuredQuantity: 0}, {measuredQuantity: 0.5, measuredUnit: "g"}]) {
    const failed = plan({source: source({quantity: 2, measuredUnit: "kg", ...patch}), recipes: [measuredRecipe]});
    assert.equal(failed.lines.length, 0);
    assert.ok(failed.issues.some((issue) => issue.code === "measured_basis_unknown"));
  }
});

test("exact quantities use rational conversion and reject nonterminating six-decimal results", () => {
  assert.equal(policy.exactInventoryUsageQuantity(0.1, 3), 0.3);
  assert.equal(policy.exactInventoryUsageQuantity(1, 1, 8, 1), 0.125);
  assert.equal(policy.exactInventoryUsageQuantity(1, 1, 1_000_000, 1), 0.000001);
  assert.equal(policy.exactInventoryUsageQuantity(1, 3, 3, 1), 1);
  assert.equal(policy.exactInventoryUsageQuantity(1, 1, 3, 1), null);
  assert.equal(policy.exactInventoryUsageQuantity(0.0000001, 1), null);
  for (const values of [[-1, 1], [1, Infinity], [1, 1, 0], [1, 1, 1, -1], [1_000_000_000_000, 1]]) {
    assert.equal(policy.exactInventoryUsageQuantity(values[0], values[1], values[2], values[3]), null);
  }
  const nonterminating = {...recipe, snapshot: {basis: "serving" as const, inputs: [{productId, quantity: 1, unit: "third", mode: "exact" as const}]}};
  const thirdsProduct = {...product, inventoryUnitConversions: [{unit: "third", unitsPerPurchase: 3}]};
  const bagsStock = {...stock, countUnit: "袋", quantity: 10, conversionSnapshot: {purchaseUnit: "袋", countUnit: "袋", unitsPerPurchase: 1}};
  const failed = plan({source: source({quantity: 1}), recipes: [nonterminating], products: [thirdsProduct], stocks: [bagsStock]});
  assert.equal(failed.lines[0].quantity, null);
  assert.equal(failed.lines[0].changesStock, false);
  assert.ok(failed.issues.some((issue) => issue.code === "unit_conversion_unknown"));
});

test("one SKU location is selected automatically but multiple locations require an explicit exact target", () => {
  assert.equal(plan().lines[0].inventoryItemId, stockId);
  const second = {...stock, id: uuid(13), quantity: 50};
  const ambiguous = plan({stocks: [stock, second]});
  assert.equal(ambiguous.lines[0].inventoryItemId, null);
  assert.equal(ambiguous.lines[0].changesStock, false);
  assert.ok(ambiguous.issues.some((issue) => issue.code === "usage_location_ambiguous"));
  const selected = plan({stocks: [stock, second], explicitLocations: new Map([[productId, second.id]])});
  assert.equal(selected.lines[0].inventoryItemId, second.id);
  assert.equal(selected.lines[0].afterQuantity, 47);
  const stale = plan({stocks: [stock], explicitLocations: new Map([[productId, uuid(14)]])});
  assert.equal(stale.lines[0].inventoryItemId, null);
  assert.ok(stale.issues.some((issue) => issue.code === "usage_location_missing"));
});

test("exact, estimated and unmeasured exposures never conflate standard usage with measured counts", () => {
  for (const [mode, quantity, expectedQuantity, changesStock] of [
    ["exact", 1, -3, true], ["estimate", 1, -3, false], ["unmeasured", null, null, false]
  ] as const) {
    const configured = {...recipe, snapshot: {basis: "serving" as const, inputs: [{productId, quantity, unit: "個", mode}]}};
    const before = JSON.stringify(stock);
    const result = plan({recipes: [configured]});
    assert.equal(result.lines[0].confidence, mode);
    assert.equal(result.lines[0].quantity, expectedQuantity);
    assert.equal(result.lines[0].changesStock, changesStock);
    assert.equal(result.lines[0].afterQuantity, changesStock ? 17 : 20);
    assert.equal(result.lines[0].metadata.measurement, "recipe_standard");
    assert.equal(result.lines[0].exposure, 3);
    assert.equal(JSON.stringify(stock), before);
  }
});

test("unknown book balances stay null and exact theoretical deficits are not clipped", () => {
  const unknown = plan({stocks: [{...stock, quantity: null}]});
  assert.equal(unknown.lines[0].quantity, -3);
  assert.equal(unknown.lines[0].beforeQuantity, null);
  assert.equal(unknown.lines[0].afterQuantity, null);
  assert.equal(unknown.lines[0].changesStock, false);
  assert.ok(unknown.issues.some((issue) => issue.code === "stock_balance_unknown"));
  const deficient = plan({stocks: [{...stock, quantity: 1}]});
  assert.equal(deficient.lines[0].afterQuantity, -2);
  assert.equal(deficient.lines[0].changesStock, true);
  const negative = plan({stocks: [{...stock, quantity: -2}]});
  assert.equal(negative.lines[0].afterQuantity, -5);
});

test("late orders already covered by a real count keep exposure without deducting its fresh balance", () => {
  for (const lastCountedAt of [occurredAt, "2026-10-11T13:00:00Z"]) {
    const result = plan({stocks: [{...stock, lastCountedAt}]});
    assert.equal(result.lines[0].quantity, -3);
    assert.equal(result.lines[0].changesStock, false);
    assert.equal(result.lines[0].afterQuantity, 20);
    assert.equal(result.lines[0].metadata.reason, "count_anchor_includes_order");
    assert.equal(result.lines[0].metadata.anchorIncludesOrder, true);
  }
  assert.equal(plan({stocks: [{...stock, lastCountedAt: "2026-10-11T11:59:59Z"}]}).lines[0].changesStock, true);
});

test("batch packaging permits literal stock units but blocks cross-unit assumptions", () => {
  const batch = {...stock, hasBatchPackaging: true, conversionSnapshot: null};
  const literal = plan({stocks: [batch]});
  assert.equal(literal.lines[0].quantity, -3);
  assert.equal(literal.lines[0].changesStock, true);
  const bagsRecipe = {...recipe, snapshot: {basis: "serving" as const, inputs: [{productId, quantity: 0.1, unit: "袋", mode: "exact" as const}]}};
  const converted = plan({recipes: [bagsRecipe], stocks: [batch]});
  assert.equal(converted.lines[0].quantity, null);
  assert.equal(converted.lines[0].changesStock, false);
  assert.ok(converted.issues.some((issue) => issue.code === "batch_unit_identity_required"));
  const validConversion = plan({recipes: [bagsRecipe]});
  assert.equal(validConversion.lines[0].quantity, -6);
  assert.equal(validConversion.lines[0].changesStock, true);
  const staleConversion = plan({recipes: [bagsRecipe], stocks: [{...stock, conversionSnapshot: {...stock.conversionSnapshot!, unitsPerPurchase: 21}}]});
  assert.equal(staleConversion.lines[0].changesStock, false);
  assert.ok(staleConversion.issues.some((issue) => issue.code === "stock_unit_snapshot_unknown"));
});

test("preparation and confirmed sale honor activation cutoff while unpaid table orders use actual preparation", () => {
  const settings: InventoryUsageSettings = {storeId: uuid(20), enabled: true, enabledFrom: occurredAt, triggerMode: "preparation", revision: 1};
  const order = {status: "new", paymentStatus: "paid", orderSource: "store_pos", firstPreparedAt: null, preparingAt: null, readyAt: null, completedAt: null, paidAt: occurredAt};
  assert.equal(policy.inventoryOrderUsageOccurredAt(order, settings), null);
  assert.equal(policy.inventoryOrderUsageOccurredAt(order, {...settings, triggerMode: "confirmed_sale"}), occurredAt);
  assert.equal(policy.inventoryOrderUsageOccurredAt({...order, firstPreparedAt: occurredAt}, settings), occurredAt);
  assert.equal(policy.inventoryOrderUsageOccurredAt({...order, firstPreparedAt: "2026-10-11T11:59:59Z", readyAt: "2026-10-11T13:00:00Z"}, settings), null);
  assert.equal(policy.inventoryOrderUsageOccurredAt({...order, completedAt: occurredAt}, settings), occurredAt);
  assert.equal(policy.inventoryOrderUsageOccurredAt({...order, firstPreparedAt: occurredAt}, {...settings, enabled: false}), null);
  assert.equal(policy.inventoryOrderUsageOccurredAt({...order, firstPreparedAt: occurredAt}, {...settings, enabledFrom: null}), null);
  for (const triggerMode of ["preparation", "confirmed_sale"] as const) {
    assert.equal(policy.inventoryOrderUsageOccurredAt({...order, orderSource: "table_qr", paymentStatus: "unpaid", firstPreparedAt: occurredAt}, {...settings, triggerMode}), occurredAt);
    assert.equal(policy.inventoryOrderUsageOccurredAt({...order, paymentStatus: "unpaid", firstPreparedAt: occurredAt}, {...settings, triggerMode}), occurredAt);
    assert.equal(policy.inventoryOrderUsageOccurredAt({...order, status: "cancelled"}, {...settings, triggerMode}), null);
    assert.equal(policy.inventoryOrderUsageOccurredAt({...order, status: "refund_pending"}, {...settings, triggerMode}), null);
  }
});

test("cancellation and financial refund after actual preparation retain physical eligibility and the first preparation time", () => {
  const settings: InventoryUsageSettings = {storeId: uuid(20), enabled: true, enabledFrom: occurredAt, triggerMode: "preparation", revision: 1};
  const order = {status: "cancelled", paymentStatus: "refunded", orderSource: "nanacha_web", firstPreparedAt: occurredAt,
    preparingAt: "2026-10-11T12:10:00Z", readyAt: "2026-10-11T12:20:00Z", completedAt: null, paidAt: "2026-10-11T11:55:00Z"};
  for (const triggerMode of ["preparation", "confirmed_sale"] as const) {
    assert.equal(policy.inventoryOrderUsageOccurredAt(order, {...settings, triggerMode}), occurredAt);
    assert.equal(policy.inventoryOrderUsageOccurredAt({...order, status: "refund_pending"}, {...settings, triggerMode}), occurredAt);
    assert.equal(policy.inventoryOrderUsageOccurredAt({...order, firstPreparedAt: "2026-10-11T11:59:59Z"}, {...settings, triggerMode}), null);
    assert.equal(policy.inventoryOrderUsageOccurredAt({...order, firstPreparedAt: null, preparingAt: null, readyAt: null}, {...settings, triggerMode}), null);
  }
});

test("a frozen prepared source still plans original servings after the mutable source is refunded or renamed", () => {
  const preparedSource = source({quantity: 3});
  const mutableSource = source({quantity: 1, refundStatus: "refunded", itemName: "Replacement"});
  assert.equal(plan({source: mutableSource}).lines.length, 0);
  const frozen = plan({source: preparedSource});
  assert.equal(frozen.lines[0].quantity, -3);
  assert.equal(frozen.mappedServings, 3);
  assert.equal(preparedSource.items[0].refundStatus, "");
  assert.equal(preparedSource.items[0].quantity, 3);
});

test("explicit recipes with no inputs are legal no-usage mappings and refunded source items are omitted", () => {
  const emptyRecipe = {...recipe, snapshot: {basis: "serving" as const, inputs: []}};
  const noUsage = plan({recipes: [emptyRecipe]});
  assert.equal(noUsage.lines.length, 0);
  assert.equal(noUsage.issues.length, 0);
  assert.equal(noUsage.mappedServings, 3);
  assert.equal(noUsage.unmappedItems, 0);
  const refunded = plan({source: source({refundStatus: "refunded"})});
  assert.equal(refunded.lines.length, 0);
  assert.equal(refunded.issues.length, 0);
  const changedScope = plan({products: [{...product, brandIds: []}]});
  assert.equal(changedScope.lines.length, 0);
  assert.ok(changedScope.issues.some((issue) => issue.code === "recipe_product_scope_changed"));
});
