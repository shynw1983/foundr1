import assert from "node:assert/strict";
import test from "node:test";
import {
  canViewCatalogProduct,
  canViewCatalogProductAtStore,
  convertPurchaseQuantityToStockUnit,
  evaluateProductOrderability,
  resolveProductCatalogConfiguration,
  type CatalogPolicyProduct
} from "./product-catalog-policy.ts";

const storeA = { id: "store-a", brandIds: ["brand-a"] };
const storeB = { id: "store-b", brandIds: ["brand-a"] };
const otherBrandStore = { id: "store-c", brandIds: ["brand-c"] };
const base: CatalogPolicyProduct = {
  id: "sku-a", brandScope: "specific", brandUsages: [{ brandId: "brand-a", isOrderable: true }],
  catalogVisibility: "internal", isOrderable: true, catalogStoreIds: []
};

test("internal products are visible and orderable by headquarters within target store and brand scope", () => {
  for (const role of ["owner", "manager"]) {
    assert.equal(canViewCatalogProduct(base, role, []), true);
    assert.deepEqual(evaluateProductOrderability(base, storeA, role, true), { allowed: true });
    assert.deepEqual(evaluateProductOrderability(base, storeA, role, false), { allowed: false, reason: "store_scope" });
    assert.deepEqual(evaluateProductOrderability(base, otherBrandStore, role, true), { allowed: false, reason: "brand_scope" });
  }
});

test("store roles require independent publication and matching brand", () => {
  for (const role of ["store_owner", "store_manager", "staff", "store_terminal"]) {
    assert.equal(canViewCatalogProduct(base, role, [storeA]), false);
    const published = { ...base, catalogVisibility: "brand_stores" as const };
    assert.equal(canViewCatalogProduct(published, role, [storeA]), true);
    assert.equal(canViewCatalogProduct(published, role, [otherBrandStore]), false);
    assert.deepEqual(evaluateProductOrderability(published, storeB, role, true), { allowed: true });
  }
});

test("selected-store grants do not grant access outside the employee scope or product brand", () => {
  const product = { ...base, catalogVisibility: "selected_stores" as const, catalogStoreIds: [storeA.id, otherBrandStore.id] };
  assert.equal(canViewCatalogProduct(product, "store_owner", [storeA]), true);
  assert.equal(canViewCatalogProduct(product, "store_owner", [storeB]), false);
  assert.equal(canViewCatalogProduct(product, "store_owner", [otherBrandStore]), false);
  assert.deepEqual(evaluateProductOrderability(product, storeA, "store_owner", false), { allowed: false, reason: "store_scope" });
  assert.deepEqual(evaluateProductOrderability(product, storeB, "store_owner", true), { allowed: false, reason: "unpublished" });
});

test("global and matching brand stop flags block procurement without hiding a published product", () => {
  for (const product of [
    { ...base, catalogVisibility: "brand_stores" as const, isOrderable: false },
    { ...base, catalogVisibility: "brand_stores" as const, brandUsages: [{ brandId: "brand-a", isOrderable: false }] },
    { ...base, brandScope: "common", catalogVisibility: "brand_stores" as const, brandUsages: [{ brandId: "brand-a", isOrderable: false }] }
  ]) {
    assert.equal(canViewCatalogProduct(product, "store_owner", [storeA]), true);
    for (const role of ["owner", "store_owner"]) {
      assert.deepEqual(evaluateProductOrderability(product, storeA, role, true), { allowed: false, reason: "not_orderable" });
    }
  }
});

test("exact-store inventory visibility retains stopped products but requires store, brand and publication scope", () => {
  const product = { ...base, catalogVisibility: "selected_stores" as const, catalogStoreIds: [storeA.id], isOrderable: false };
  assert.equal(canViewCatalogProductAtStore(product, storeA, "store_owner", true), true);
  assert.equal(canViewCatalogProductAtStore(product, storeB, "store_owner", true), false);
  assert.equal(canViewCatalogProductAtStore(product, storeA, "store_owner", false), false);
  assert.equal(canViewCatalogProductAtStore(base, storeA, "owner", true), true);
  assert.equal(canViewCatalogProductAtStore(base, otherBrandStore, "owner", true), false);
  assert.equal(canViewCatalogProductAtStore(base, storeA, "owner", false), false);
});

test("multi-brand stores use a matching orderable usage and unset products remain unconfigured", () => {
  const store = { ...storeA, brandIds: ["brand-a", "brand-b"] };
  const product = { ...base, brandUsages: [{ brandId: "brand-a", isOrderable: false }, { brandId: "brand-b", isOrderable: true }] };
  assert.deepEqual(evaluateProductOrderability(product, store, "owner", true), { allowed: true });
  assert.deepEqual(evaluateProductOrderability({ ...base, brandScope: "unset" }, store, "owner", true), { allowed: false, reason: "brand_scope" });
  assert.deepEqual(evaluateProductOrderability({ ...base, brandScope: "common" }, otherBrandStore, "owner", true), { allowed: true });
});

test("omitted publication fields preserve the existing policy; new products default to internal", () => {
  const current = { catalogVisibility: "selected_stores" as const, isOrderable: false, catalogStoreIds: ["store-a"] };
  assert.deepEqual(resolveProductCatalogConfiguration({}, current), current);
  assert.deepEqual(resolveProductCatalogConfiguration({ isOrderable: true }, current), { ...current, isOrderable: true });
  const copy = resolveProductCatalogConfiguration({ ...current });
  assert.deepEqual(copy, current);
  copy.catalogStoreIds.push("store-b");
  assert.deepEqual(current.catalogStoreIds, ["store-a"]);
  assert.deepEqual(resolveProductCatalogConfiguration({}), { catalogVisibility: "internal", isOrderable: true, catalogStoreIds: [] });
});

test("quantity conversions use explicit package relation and reject unknown or invalid conversions", () => {
  const product = { unit: "箱", packageQuantity: 12, packageQuantityUnit: "袋" };
  assert.equal(convertPurchaseQuantityToStockUnit(2, product, "袋"), 24);
  assert.equal(convertPurchaseQuantityToStockUnit(0.5, product, "箱"), 0.5);
  assert.equal(convertPurchaseQuantityToStockUnit(2, product, "kg"), null);
  assert.equal(convertPurchaseQuantityToStockUnit(2, { unit: "kg" }, "g"), null);
  assert.equal(convertPurchaseQuantityToStockUnit(-1, product, "袋"), null);
  assert.equal(convertPurchaseQuantityToStockUnit(2, { ...product, packageQuantity: 0 }, "袋"), null);
});

test("stock conversion reuses explicit piece and fraction relations", () => {
  const product = { unit: "袋", inventoryUnitConversions: [{ unit: "個", unitsPerPurchase: 20 }, { unit: "1/3袋", unitsPerPurchase: 3, fractionalDenominator: 3 }] };
  assert.equal(convertPurchaseQuantityToStockUnit(2, product, "個"), 40);
  assert.equal(convertPurchaseQuantityToStockUnit(2, product, "1/3袋"), 6);
  assert.equal(convertPurchaseQuantityToStockUnit(2, product, "箱"), null);
});
