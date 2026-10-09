import assert from "node:assert/strict";
import test from "node:test";
import { scopeProcurementCatalogResponse } from "./procurement-catalog-response.ts";

const data = {
  products: [
    { id: "published", name: "Shared name", unit: "袋", inventoryUnitConversions: [{ unit: "個", unitsPerPurchase: 20 }], referencePrice: 100, importOriginalPrice: 20, mainSupplier: "upstream", mainPurchaseUrl: "private", futureSecret: "must not escape" },
    { id: "hidden", name: "Shared name", referencePrice: 200 }
  ],
  productBrandUsages: [{ productId: "published", product: "Shared name" }, { productId: "hidden", product: "Shared name" }],
  productSupplierOptions: [{ productId: "published", options: [{ referencePrice: 90 }] }],
  suppliers: [{ name: "upstream" }], supplierLocations: [{ name: "warehouse" }],
  priceSignals: [{ productId: "hidden", price: 120 }],
  purchaseOrderItems: [{ productId: "hidden", actualQuantity: 2, actualPrice: "70" }]
};
const access = { visibleProductIds: ["published"], orderableStoreIdsByProductId: { published: ["store-a"] } };

test("store catalog removes unpublished IDs and upstream information even for duplicate names", () => {
  const scoped = scopeProcurementCatalogResponse(data, access, false);
  assert.deepEqual(scoped.products?.map((product) => product.id), ["published"]);
  assert.equal(scoped.products?.[0].referencePrice, null);
  assert.deepEqual(scoped.products?.[0].inventoryUnitConversions, data.products[0].inventoryUnitConversions);
  assert.equal("importOriginalPrice" in scoped.products![0], false);
  assert.equal("futureSecret" in scoped.products![0], false);
  assert.equal("mainPurchaseUrl" in scoped.products![0], false);
  assert.deepEqual(scoped.products?.[0].orderableStoreIds, ["store-a"]);
  assert.deepEqual(scoped.productBrandUsages, [data.productBrandUsages[0]]);
  assert.deepEqual(scoped.productSupplierOptions, []);
  assert.deepEqual(scoped.suppliers, []);
  assert.deepEqual(scoped.supplierLocations, []);
  assert.deepEqual(scoped.priceSignals, []);
  assert.equal(scoped.purchaseOrderItems[0].actualQuantity, 2);
  assert.equal(scoped.purchaseOrderItems[0].actualPrice, "70");
  assert.equal(scoped.purchaseOrderItems[0].referencePrice, null);
});

test("HQ catalog retains procurement details and store-only grants cannot widen orderability", () => {
  const scoped = scopeProcurementCatalogResponse(data, access, true);
  assert.equal(scoped.products?.[0].importOriginalPrice, 20);
  assert.deepEqual(scoped.productSupplierOptions, data.productSupplierOptions);
  assert.equal(scoped.procurementDetailsVisible, true);
});

test("live transaction refresh does not invent or clear cached master arrays", () => {
  const scoped = scopeProcurementCatalogResponse({ products: undefined, suppliers: undefined }, access, false);
  assert.equal(scoped.products, undefined);
  assert.equal(scoped.suppliers, undefined);
});
