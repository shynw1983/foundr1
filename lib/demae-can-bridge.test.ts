import assert from "node:assert/strict";
import test from "node:test";

import { parseDemaeCanBridgeSnapshot, toDemaeCanBridgeOperationalItem } from "./demae-can-bridge.ts";

test("parses the current Demae-can Order detail accessibility structure", () => {
  const capturedAt = new Date("2026-08-12T01:30:00+09:00");
  const parsed = parseDemaeCanBridgeSnapshot([{
    contentDescription: [
      "注文情報",
      "注文状況",
      "キャンセル (2026/08/11 22:02)",
      "受注確認がされなかったためキャンセル",
      "注文番号",
      "12600971680",
      "受取用番号",
      "DC543"
    ].join("\n")
  }, {
    contentDescription: [
      "注文詳細",
      "1. 旨味ベースの特別仕立てスープ",
      "【自由にカスタム】旨味マーラータンスープ｜麻辣烫汤底｜Mala Tang Broth 330円",
      "x1",
      "2,110円",
      "薬膳の有無を選ぶ 薬膳スパイスあり【超おすすめ】｜With Herbal Spice Blend --",
      "【桁違いの風味】辛さレベルをお選びください（ジョロキア唐辛子使用） 大辛｜Very Spicy 60円",
      "🍜麺の種類を選ぶ 【おすすめ】もちもち板春雨50g｜Wide Noodles 170円",
      "🟢ベーシックトッピング 魚卵入り蟹団子1個｜Crab Roe Ball 220円",
      "◆ポイント利用割引◆ 割引金額： -500円"
    ].join("\n")
  }], capturedAt);

  assert.ok(parsed);
  assert.equal(parsed.orderNo, "12600971680");
  assert.equal(parsed.pickupCode, "DC543");
  assert.equal(parsed.status, "cancelled");
  assert.equal(parsed.orderedAt, capturedAt);
  assert.equal(parsed.total, 2110);
  assert.deepEqual(toDemaeCanBridgeOperationalItem(parsed.items[0]), {
    itemName: "【自由にカスタム】旨味マーラータンスープ",
    quantity: 1,
    amount: 2110,
    sizeKey: "maamaa_buildable",
    optionLabel: "薬膳スパイスあり【超おすすめ】, 大辛, 【おすすめ】もちもち板春雨50g, 魚卵入り蟹団子1個",
    toppingLabels: [
      "薬膳スパイスあり【超おすすめ】",
      "大辛",
      "【おすすめ】もちもち板春雨50g",
      "魚卵入り蟹団子1個"
    ]
  });
});

test("requires a full Demae-can order number", () => {
  assert.equal(parseDemaeCanBridgeSnapshot([
    { contentDescription: "注文詳細\n受取用番号\nDC543" }
  ], new Date()), null);
});
