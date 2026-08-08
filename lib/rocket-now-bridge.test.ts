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
  assert.equal(parsed.customerNote, "");
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

test("extracts the Rocket customer request before the menu", () => {
  const parsed = parseRocketNowBridgeSnapshot([
    { contentDescription: "新規注文" },
    { contentDescription: "26SE6W" },
    { contentDescription: "注文時間 : 午後 11:55" },
    { contentDescription: "[カトラリーX] 辛いのが少し苦手なので可能であればできるだけ辛くないようにお願いします！" },
    { contentDescription: "メニュー" },
    { contentDescription: "旨味マーラータンスープ" },
    { contentDescription: "1" },
    { contentDescription: "415円" }
  ], new Date("2026-08-09T00:07:00+09:00"));

  assert.ok(parsed);
  assert.equal(
    parsed.customerNote,
    "辛いのが少し苦手なので可能であればできるだけ辛くないようにお願いします！"
  );
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

test("keeps zero-price modifiers and ignores Rocket overview counters", () => {
  const parsed = parseRocketNowBridgeSnapshot([
    { contentDescription: "新規注文\n10NCC7\n注文時間 : 午後 04:33" },
    { contentDescription: "メニュー\n数量\n金額" },
    { contentDescription: "【自由にカスタム】旨味マーラータンスープ\n1\n415円" },
    { contentDescription: "薬膳スパイスあり【超おすすめ】\n普通辛\n微シビレ\n0円" },
    { contentDescription: "【おすすめ!】もちもち板春雨\n+216円" },
    { contentDescription: "小松菜\n+196円" },
    { contentDescription: "ブンモジャ1本\n+226円" },
    { contentDescription: "処理中 1\n完了\n10NCC7\n午後 04:33\n[メニュー 1個] 1,053円" },
    { contentDescription: "注文金額\n1,053円" }
  ], new Date("2026-08-08T16:37:00+09:00"));

  assert.ok(parsed);
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.items[0].modifiers.map((modifier) => modifier.name), [
    "薬膳スパイスあり【超おすすめ】",
    "普通辛",
    "微シビレ",
    "【おすすめ!】もちもち板春雨",
    "小松菜",
    "ブンモジャ1本"
  ]);
  assert.equal(parsed.items[0].lineTotal, 1053);
  assert.equal(parsed.total, 1053);
});

test("parses Rocket inline x quantities on buildable options", () => {
  const parsed = parseRocketNowBridgeSnapshot([
    { contentDescription: "新規注文\n10NCC7\n注文時間 : 午後 04:33" },
    { contentDescription: "メニュー\n数量\n金額" },
    { contentDescription: "【自由にカスタム】旨味マーラータンスープ\n1\n415円" },
    { contentDescription: "うずらの卵1個 x2\n+240円" },
    { contentDescription: "ベビーコーン1本 × 2\n+532円" },
    { contentDescription: "白きくらげ Ｘ２\n+652円" },
    { contentDescription: "注文金額\n1,839円" }
  ], new Date("2026-08-08T16:37:00+09:00"));

  assert.ok(parsed);
  assert.deepEqual(parsed.items[0].modifiers, [
    { name: "うずらの卵1個", quantity: 2, price: 240 },
    { name: "ベビーコーン1本", quantity: 2, price: 532 },
    { name: "白きくらげ", quantity: 2, price: 652 }
  ]);
  assert.deepEqual(toRocketNowBridgeOperationalItem(parsed.items[0]).toppingLabels, [
    "うずらの卵1個",
    "うずらの卵1個",
    "ベビーコーン1本",
    "ベビーコーン1本",
    "白きくらげ",
    "白きくらげ"
  ]);
});
