import assert from "node:assert/strict";
import test from "node:test";

import { parseUberBridgeSnapshot } from "./uber-bridge.ts";

test("parses an Uber order detail accessibility snapshot", () => {
  const parsed = parseUberBridgeSnapshot([
    { viewId: "com.uber.restaurants:id/ub__ueo_order_details_header_title", text: "上 哲. • 8577F" },
    { viewId: "com.uber.restaurants:id/ub__ueo_handed_off_delivery_subtitle_text", text: "2026年7月27日 21:49" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_quantity", text: "1 × " },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_name", text: "牛肉マーラータン" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_price", text: "￥1,880" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_item_name", text: "辛さを選ぶ" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "中辛" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥50" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_item_name", text: "麺を選ぶ" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "トウモロコシ麺" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥216" },
    { text: "完了" }
  ], new Date("2026-07-27T22:00:00+09:00"));

  assert.ok(parsed);
  assert.equal(parsed.orderNo, "8577F");
  assert.equal(parsed.customerName, "上 哲.");
  assert.equal(parsed.orderedAt.toISOString(), "2026-07-27T12:49:00.000Z");
  assert.equal(parsed.status, "completed");
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].quantity, 1);
  assert.equal(parsed.items[0].unitPrice, 1880);
  assert.equal(parsed.items[0].optionTotal, 266);
  assert.equal(parsed.items[0].lineTotal, 2146);
  assert.deepEqual(parsed.items[0].modifiers, [
    { group: "辛さを選ぶ", name: "中辛", price: 50 },
    { group: "麺を選ぶ", name: "トウモロコシ麺", price: 216 }
  ]);
});

test("requires a stable Uber order number", () => {
  assert.equal(parseUberBridgeSnapshot([
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_name", text: "商品" }
  ], new Date()), null);
});
