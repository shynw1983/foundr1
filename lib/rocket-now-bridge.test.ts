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

test("groups Rocket buildable options including zero-price seasoning", () => {
  const parsed = parseRocketNowBridgeSnapshot([
    { contentDescription: "処理中 1" },
    { contentDescription: "1DRTG1\n午前 01:11\n[メニュー 1個] 3,355円\n自由にカスタム 旨味マーラータンスープx1" },
    { contentDescription: "メニュー" },
    { contentDescription: "数量" },
    { contentDescription: "金額" },
    { contentDescription: "自由にカスタム 旨味マーラータンスープ" },
    { contentDescription: "1" },
    { contentDescription: "415円" },
    { contentDescription: "薬膳スパイスあり【超おすすめ】" },
    { contentDescription: "0円" },
    { contentDescription: "普通辛" },
    { contentDescription: "0円" },
    { contentDescription: "微シビレ" },
    { contentDescription: "0円" },
    { contentDescription: "【別添容器】香酢超おすすめです" },
    { contentDescription: "+150円" },
    { contentDescription: "春雨" },
    { contentDescription: "+176円" }
  ], new Date("2026-08-08T01:18:00+09:00"));

  assert.ok(parsed);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].name, "自由にカスタム 旨味マーラータンスープ");
  assert.deepEqual(parsed.items[0].modifiers.map((modifier) => modifier.name), [
    "薬膳スパイスあり【超おすすめ】",
    "普通辛",
    "微シビレ",
    "【別添容器】香酢超おすすめです",
    "春雨"
  ]);
  assert.equal(parsed.items[0].lineTotal, 741);
  assert.equal(parsed.total, 3355);
});
