import assert from "node:assert/strict";
import test from "node:test";

import { parseRocketNowBridgeSnapshot, toRocketNowBridgeOperationalItem } from "./rocket-now-bridge.ts";

test("parses a Rocket Now new-order accessibility snapshot", () => {
  const capturedAt = new Date("2026-08-06T12:35:00+09:00");
  const parsed = parseRocketNowBridgeSnapshot([
    { path: "0.1", contentDescription: "B9103A\n午後12:30\n3回目のご注文" },
    { path: "0.2", contentDescription: "イタリアンLピザ" },
    { path: "0.3", contentDescription: "1個" },
    { path: "0.4", contentDescription: "4,000円" },
    { path: "0.5", contentDescription: "スイスチーズ追加" },
    { path: "0.6", contentDescription: "2個" },
    { path: "0.7", contentDescription: "1,000円" },
    { path: "0.8", contentDescription: "アメリカーノ" },
    { path: "0.9", contentDescription: "1個" },
    { path: "0.10", contentDescription: "1,000円" },
    { path: "0.11", contentDescription: "注文受諾\n予想調理時間 13分" },
    { path: "0.12", contentDescription: "合計\n6,000円" }
  ], capturedAt);

  assert.ok(parsed);
  assert.equal(parsed.orderNo, "B9103A");
  assert.equal(parsed.status, "new");
  assert.equal(parsed.total, 6000);
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(toRocketNowBridgeOperationalItem(parsed.items[0]), {
    itemName: "イタリアンLピザ",
    quantity: 1,
    amount: 5000,
    sizeKey: "",
    optionLabel: "スイスチーズ追加, スイスチーズ追加",
    toppingLabels: ["スイスチーズ追加", "スイスチーズ追加"]
  });
});

test("requires a stable Rocket Now order number", () => {
  assert.equal(parseRocketNowBridgeSnapshot([
    { contentDescription: "注文管理\n進行中の注文がありません。" }
  ], new Date()), null);
});
