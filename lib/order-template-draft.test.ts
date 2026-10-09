import assert from "node:assert/strict";
import test from "node:test";
import { appendOrderTemplate, templateItemsFromDraft } from "./order-template-draft.ts";

const products = [
  { id: "a", name: "A", unit: "袋", category: "food" },
  { id: "b", name: "B", unit: "箱", category: "food" }
];
const existing = { id: 4, productId: "a", productName: "A", quantity: null, unit: "袋", category: "food", subcategory: "old", replenishment: true };

test("loading a template retains existing source blanks and quantities, adding exact absent SKUs once", () => {
  const result = appendOrderTemplate([existing], { id: "t", name: "weekly", unavailableItemCount: 1,
    items: [{ productId: "a", quantity: 8, purchaseUnit: "袋" }, { productId: "b", quantity: 3, purchaseUnit: "箱" }, { productId: "b", quantity: 3, purchaseUnit: "箱" }] }, products, 100);
  assert.equal(result.items[0], existing);
  assert.equal(result.items[0].quantity, null);
  assert.equal(result.items[0].replenishment, true);
  assert.equal(result.items[1].quantity, 3);
  assert.equal(result.items.length, 2);
  assert.deepEqual([result.added, result.retained, result.unavailable], [1, 2, 1]);
});

test("hidden identity, stale purchase unit and invalid quantities never become another product", () => {
  const result = appendOrderTemplate([], { id: "t", name: "weekly", unavailableItemCount: 0, items: [
    { productId: "hidden", quantity: 2, purchaseUnit: "袋" }, { productId: "a", quantity: 2, purchaseUnit: "個" },
    { productId: "b", quantity: 0, purchaseUnit: "箱" }
  ] }, products);
  assert.equal(result.items.length, 0);
  assert.equal(result.unavailable, 3);
});

test("saving a template requires every cart quantity explicit and current exact unit/orderable SKU", () => {
  assert.equal(templateItemsFromDraft([existing], products), null);
  assert.equal(templateItemsFromDraft([{ ...existing, quantity: 2, unit: "個" }], products), null);
  assert.equal(templateItemsFromDraft([{ ...existing, quantity: 2, productId: "hidden" }], products), null);
  assert.equal(templateItemsFromDraft([{ ...existing, quantity: 2 }, { ...existing, id: 5, quantity: 3 }], products), null);
  assert.deepEqual(templateItemsFromDraft([{ ...existing, quantity: 2 }], products), [{ productId: "a", quantity: 2, purchaseUnit: "袋" }]);
});
