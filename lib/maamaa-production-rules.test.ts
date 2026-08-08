import assert from "node:assert/strict";
import test from "node:test";

import {
  findMaamaaProductionRule,
  formatMaamaaProductionRule,
  formatMaamaaSeasoningSelection,
  localizeMaamaaCustomerLabel,
  localizeMaamaaProductionSummary
} from "./maamaa-production-rules.ts";

test("matches Uber seasoning labels that include decorative emoji or suffixes", () => {
  assert.equal(
    formatMaamaaSeasoningSelection("辛さ：普通辛🔥"),
    "辛さ：普通辛（追加なし）"
  );
  assert.equal(
    formatMaamaaSeasoningSelection("痺れ：微シビレ"),
    "痺れ：微シビ（メニュー掲載。厨房分量/処理は要確認。）"
  );
  assert.equal(
    formatMaamaaSeasoningSelection("薬膳スパイスあり【超おすすめ🏮】"),
    "薬膳スパイスあり（メニュー掲載。標準投入か追加扱いか要確認）"
  );
});

test("shows repeated kitchen ingredients as the customer's selected count", () => {
  const quailEgg = findMaamaaProductionRule("うずらの卵1個");
  const sausage = findMaamaaProductionRule("ウインナー1個");
  assert.ok(quailEgg);
  assert.ok(sausage);
  assert.match(formatMaamaaProductionRule(quailEgg, 2), /うずらの卵 1個 x2/);
  assert.match(formatMaamaaProductionRule(sausage, 2), /ウインナー 1個 x2/);
});

test("prefers exact ingredient names over longer rules that contain the same text", () => {
  assert.equal(findMaamaaProductionRule("豆腐")?.id, "tofu");
  assert.equal(findMaamaaProductionRule("干し豆腐")?.id, "dried-tofu");
  assert.equal(findMaamaaProductionRule("ほうれん草")?.id, "spinach");
  assert.equal(findMaamaaProductionRule("ほうれん草えび餃子1個")?.id, "spinach-shrimp-dumpling");
});

test("uses the longest contained rule name only after exact matching fails", () => {
  assert.equal(findMaamaaProductionRule("【大サイズ】老豆皮1枚")?.id, "old-tofu-skin");
  assert.equal(findMaamaaProductionRule("国産プチトマト1個")?.id, "tomato");
});

test("localizes kitchen summaries with the Chinese labels preserved from Uber", () => {
  const summary = [
    "旨味マーラータンスープ x1",
    "・辛さ：普通辛（追加なし）",
    "・具材：ブンモジャ1本 x2（最低1分加熱）",
    "・具材：れんこん1個（加熱不要。容器に入れる）"
  ].join("\n");
  const customerSummary = {
    bridge: {
      items: [{
        name: "旨味マーラータンスープ｜鲜味麻辣烫汤底｜감칠맛 마라탕",
        modifiers: [
          { group: "辛さ｜辣度｜맵기", name: "普通辛｜普通辣｜보통 매운맛" },
          { group: "具材｜配料｜토핑", name: "ブンモジャ1本｜粉耗子1根｜분모자 1개" },
          { group: "具材｜配料｜토핑", name: "れんこん1個｜莲藕1个｜연근 1개" }
        ]
      }]
    }
  };

  assert.equal(
    localizeMaamaaProductionSummary(summary, customerSummary, "zh"),
    [
      "鲜味麻辣烫汤底 x1",
      "・辣度：普通辣（不追加）",
      "・配料：粉耗子1根 x2（至少1分钟加热）",
      "・配料：莲藕1个（无需加热。放入容器）"
    ].join("\n")
  );
});

test("keeps kitchen summaries unchanged when Japanese is selected", () => {
  const summary = "・具材：ブンモジャ1本 x2（最低1分加熱）";
  assert.equal(localizeMaamaaProductionSummary(summary, {}, "ja"), summary);
});

test("uses the Uber-provided Chinese labels for kitchen heat and numbness", () => {
  const customerSummary = {
    bridge: {
      items: [{
        modifiers: [
          { name: "中辛🔥🔥｜中辣｜중간 매운맛｜Medium Spicy" },
          { name: "ちょいシビ⚡️｜微麻｜약한 얼얼함｜Mild Numbing" }
        ]
      }]
    }
  };

  assert.equal(localizeMaamaaCustomerLabel("辛さ：中辛🔥🔥", customerSummary, "zh"), "辣度：中辣");
  assert.equal(localizeMaamaaCustomerLabel("痺れ：ちょいシビ⚡️", customerSummary, "zh"), "麻度：微麻");
  assert.equal(localizeMaamaaCustomerLabel("中辣", customerSummary, "zh", "辛さ：中辛🔥🔥"), "辣度：中辣");
  assert.equal(localizeMaamaaCustomerLabel("微麻", customerSummary, "zh", "痺れ：ちょいシビ⚡️"), "麻度：微麻");
});
