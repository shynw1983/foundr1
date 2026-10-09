import assert from "node:assert/strict";
import test from "node:test";
import { canManageMenuProductLinks, normalizeMenuProductIds, normalizeMenuProductLinkTarget } from "./menu-product-link-policy.ts";
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
test("menu SKU maintenance requires an HQ role and menu editing permission", () => {
  for (const role of ["owner", "manager"]) {
    assert.equal(canManageMenuProductLinks(role, true), true);
    assert.equal(canManageMenuProductLinks(role, false), false);
  }
  for (const role of ["store_owner", "store_manager", "staff", "store_terminal"]) assert.equal(canManageMenuProductLinks(role, true), false);
});
test("only exact item/option UUIDs are accepted as targets", () => {
  assert.deepEqual(normalizeMenuProductLinkTarget("option", a), { kind: "option", targetId: a });
  for (const [kind, id] of [["group", a], ["item", "同名商品"], ["item", null]]) assert.throws(() => normalizeMenuProductLinkTarget(kind, id));
});
test("SKU IDs and expected IDs are explicit sets; missing, duplicate or guessed names fail", () => {
  assert.deepEqual(normalizeMenuProductIds([b, a]), [a, b]);
  assert.deepEqual(normalizeMenuProductIds([]), []);
  for (const ids of [undefined, null, [a, a], ["同名商品"], Array(51).fill(a)]) assert.throws(() => normalizeMenuProductIds(ids));
});
