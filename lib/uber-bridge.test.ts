import assert from "node:assert/strict";
import test from "node:test";

import { parseUberBridgeSnapshot, toUberBridgeOperationalItem } from "./uber-bridge.ts";

test("parses an Uber order detail accessibility snapshot", () => {
  const parsed = parseUberBridgeSnapshot([
    { viewId: "com.uber.restaurants:id/ub__ueo_order_details_header_title", text: "上 哲. • 8577F" },
    { viewId: "com.uber.restaurants:id/ub__ueo_handed_off_delivery_subtitle_text", text: "2026年7月27日 21:49" },
    { viewId: "com.uber.restaurants:id/ub__ueo_details_courier_status", text: "" },
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
  assert.equal(parsed.orderType, "delivery");
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].quantity, 1);
  assert.equal(parsed.items[0].unitPrice, 1880);
  assert.equal(parsed.items[0].optionTotal, 266);
  assert.equal(parsed.items[0].lineTotal, 2146);
  assert.deepEqual(parsed.items[0].modifiers, [
    { group: "辛さを選ぶ", name: "中辛", quantity: 1, price: 50 },
    { group: "麺を選ぶ", name: "トウモロコシ麺", quantity: 1, price: 216 }
  ]);
});

test("parses repeated Uber modifier quantities and their extended price", () => {
  const parsed = parseUberBridgeSnapshot([
    { viewId: "com.uber.restaurants:id/ub__ueo_order_details_header_title", text: "田中, 小. • E495A" },
    { viewId: "com.uber.restaurants:id/ub__ueo_handed_off_delivery_subtitle_text", text: "2026年7月28日 01:00" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_quantity", text: "1 ×" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_name", text: "豚肉マーラータン" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_price", text: "￥1,880" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_item_name", text: "辛さレベルをお選びください" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "普通辛🔥｜普通辣" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥0" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_item_name", text: "追加トッピング" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_quantity", text: "2 ×" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "ブンモジャ1本｜粉耗子" },
    { viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥226 ￥452" }
  ], new Date("2026-07-28T01:01:00+09:00"));

  assert.ok(parsed);
  assert.equal(parsed.orderType, "delivery");
  assert.equal(parsed.items[0].optionTotal, 452);
  assert.equal(parsed.items[0].lineTotal, 2332);
  assert.deepEqual(parsed.items[0].modifiers, [
    { group: "辛さレベルをお選びください", name: "普通辛🔥｜普通辣", quantity: 1, price: 0 },
    { group: "追加トッピング", name: "ブンモジャ1本｜粉耗子", quantity: 2, price: 226 }
  ]);
  assert.deepEqual(toUberBridgeOperationalItem(parsed.items[0]), {
    itemName: "豚肉マーラータン",
    quantity: 1,
    amount: 2332,
    sizeKey: "maamaa_buildable",
    optionLabel: "辛さ：普通辛🔥, ブンモジャ1本 x2",
    toppingLabels: ["辛さ：普通辛🔥", "ブンモジャ1本", "ブンモジャ1本"]
  });
});

test("parses modifier quantity when Uber shifts the name after the quantity node", () => {
  const itemPath = "0.0.0.0.7.0";
  const modifierPath = `${itemPath}.3`;
  const parsed = parseUberBridgeSnapshot([
    { path: "0.0.0.0.1", viewId: "com.uber.restaurants:id/ub__ueo_order_details_header_title", text: "顧客 • 75AE6" },
    { path: `${itemPath}.0`, viewId: "com.uber.restaurants:id/ub__ueo_cart_item_quantity", text: "1 ×" },
    { path: `${itemPath}.1`, viewId: "com.uber.restaurants:id/ub__ueo_cart_item_name", text: "旨味マーラータンスープ" },
    { path: `${itemPath}.2`, viewId: "com.uber.restaurants:id/ub__ueo_cart_item_price", text: "￥415" },
    { path: `${modifierPath}.8.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_item_name", text: "ベーシックトッピング" },
    { path: `${modifierPath}.9.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_quantity", text: "2 ×" },
    { path: `${modifierPath}.9.1`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "うずらの卵1個｜鹌鹑蛋" },
    { path: `${modifierPath}.9.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥120 ￥240" }
  ], new Date("2026-07-30T01:58:00+09:00"));

  assert.ok(parsed);
  assert.equal(parsed.items[0].modifiers[0].quantity, 2);
  assert.equal(parsed.items[0].optionTotal, 240);
  assert.deepEqual(toUberBridgeOperationalItem(parsed.items[0]).toppingLabels, [
    "うずらの卵1個",
    "うずらの卵1個"
  ]);
});

test("does not treat the active-order mark-ready button as a completed order", () => {
  const parsed = parseUberBridgeSnapshot([
    { viewId: "com.uber.restaurants:id/ub__ueo_order_details_header_title", text: "安藤, 総. • 83033" },
    { viewId: "com.uber.restaurants:id/ub__ueo_details_preparing_preptime_text", text: "あと 7 分で準備完了" },
    { viewId: "com.uber.restaurants:id/ub__order_details_action_secondary_button", text: "準備完了" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_quantity", text: "1 ×" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_name", text: "旨味マーラータンスープ" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_price", text: "￥415" }
  ], new Date("2026-07-29T16:24:00+09:00"));

  assert.ok(parsed);
  assert.equal(parsed.status, "preparing");
});

test("keeps equal-priced Uber modifiers separate by node path and reads the displayed total", () => {
  const itemPath = "0.0.0.0.7.0";
  const modifierPath = `${itemPath}.3`;
  const parsed = parseUberBridgeSnapshot([
    { path: "0.0.0.0.1", viewId: "com.uber.restaurants:id/ub__ueo_order_details_header_title", text: "河野, ぱ. • CB3E7" },
    { path: `${itemPath}.0`, viewId: "com.uber.restaurants:id/ub__ueo_cart_item_quantity", text: "1 ×" },
    { path: `${itemPath}.1`, viewId: "com.uber.restaurants:id/ub__ueo_cart_item_name", text: "豚肉マーラータン" },
    { path: `${itemPath}.2`, viewId: "com.uber.restaurants:id/ub__ueo_cart_item_price", text: "￥1,880" },
    { path: `${modifierPath}.0.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_item_name", text: "追加トッピング" },
    { path: `${modifierPath}.2.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥176" },
    { path: `${modifierPath}.1.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "さつまいも麺" },
    { path: `${modifierPath}.1.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥176" },
    { path: `${modifierPath}.2.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "山クラゲ" },
    { path: `${modifierPath}.3.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "牛筋麺" },
    { path: `${modifierPath}.3.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥276" },
    { path: `${modifierPath}.4.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "生腐竹" },
    { path: `${modifierPath}.4.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥276" },
    { path: `${modifierPath}.5.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "彩虹巻" },
    { path: `${modifierPath}.5.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥216" },
    { path: `${modifierPath}.6.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "小籠包" },
    { path: `${modifierPath}.6.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥216" },
    { path: `${modifierPath}.7.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "結びゆば" },
    { path: `${modifierPath}.7.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥149" },
    { path: `${modifierPath}.8.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "白きくらげ" },
    { path: `${modifierPath}.8.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥326" },
    { path: `${modifierPath}.9.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "油あげ" },
    { path: `${modifierPath}.9.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥100" },
    { path: `${modifierPath}.10.0`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_name", text: "ブンモジャ" },
    { path: `${modifierPath}.10.2`, viewId: "com.uber.restaurants:id/ub__ueo_modifier_option_item_price", text: "￥226" },
    { path: "0.0.0.0.9", text: "合計" },
    { path: "0.0.0.0.11", text: "￥4,017" }
  ], new Date("2026-07-28T19:05:00+09:00"));

  assert.ok(parsed);
  assert.deepEqual(parsed.items[0].modifiers.map((modifier) => modifier.price), [
    176, 176, 276, 276, 216, 216, 149, 326, 100, 226
  ]);
  assert.equal(parsed.items[0].optionTotal, 2137);
  assert.equal(parsed.items[0].lineTotal, 4017);
  assert.equal(parsed.total, 4017);
});

test("requires a stable Uber order number", () => {
  assert.equal(parseUberBridgeSnapshot([
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_name", text: "商品" }
  ], new Date()), null);
});

test("parses an Uber customer pickup order", () => {
  const parsed = parseUberBridgeSnapshot([
    { viewId: "com.uber.restaurants:id/ub__ueo_order_details_header_title", text: "佐藤, 花. • P1CK9" },
    { viewId: "com.uber.restaurants:id/ub__ueo_customer_pickup_status_text", text: "お客様が店頭で受け取ります" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_quantity", text: "1 ×" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_name", text: "牛肉マーラータン" },
    { viewId: "com.uber.restaurants:id/ub__ueo_cart_item_price", text: "￥1,880" }
  ], new Date("2026-07-29T15:00:00+09:00"));

  assert.ok(parsed);
  assert.equal(parsed.orderType, "takeout");
});
