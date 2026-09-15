import assert from "node:assert/strict";
import test from "node:test";
import { isPosSellableItem } from "./pos-catalog-policy.ts";

test("POS excludes the explicitly marked information card while retaining free and weight-priced products", () => {
  const items = [
    { name: "【※こちら商品ではありません】まぁ麻 ブランド紹介", basePrice: 0 },
    { name: "無料プレゼント", basePrice: 0 },
    { name: "自選マーラータン", basePrice: 0, posPricingMode: "weight" },
    { name: "牛肉マーラータン", basePrice: 1200 }
  ];
  assert.deepEqual(items.filter(isPosSellableItem), items.slice(1));
});
