import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOrderTemplate, filterOrderTemplateItems } from "./order-template-policy.ts";
const storeId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const item = { productId, quantity: 2, purchaseUnit: "袋" };
test("templates retain explicit whole purchase-unit quantities and reject blank, fractional, repeated or forged SKU data", () => {
  assert.deepEqual(normalizeOrderTemplate({ storeId, name: " 常用 ", items: [item] }), { storeId, name: "常用", items: [item] });
  for (const quantity of [0,1.5,1000,"2",null]) assert.equal(normalizeOrderTemplate({ storeId, name: "A", items: [{ ...item, quantity }] }), null);
  assert.equal(normalizeOrderTemplate({ storeId, name: "A", items: [item,item] }), null);
  assert.equal(normalizeOrderTemplate({ storeId: "A", name: "A", items: [item] }), null);
});
test("current catalog and exact units redact hidden, stopped or changed-unit template items without borrowing same-name SKU", () => {
  const other = { ...item, productId: "00000000-0000-4000-8000-000000000003" };
  assert.deepEqual(filterOrderTemplateItems([item,other],new Map([[productId,"袋"]])), { items: [item], unavailableItemCount: 1 });
  assert.deepEqual(filterOrderTemplateItems([item],new Map([[productId,"箱"]])), { items: [], unavailableItemCount: 1 });
});
