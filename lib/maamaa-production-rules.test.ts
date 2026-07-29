import assert from "node:assert/strict";
import test from "node:test";

import {
  findMaamaaProductionRule,
  formatMaamaaProductionRule,
  formatMaamaaSeasoningSelection,
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

test("shows repeated kitchen ingredients as their total physical quantity", () => {
  const quailEgg = findMaamaaProductionRule("うずらの卵1個");
  const sausage = findMaamaaProductionRule("ウインナー1個");
  assert.ok(quailEgg);
  assert.ok(sausage);
  assert.match(formatMaamaaProductionRule(quailEgg, 2), /うずらの卵 2個/);
  assert.match(formatMaamaaProductionRule(sausage, 2), /ウインナー 2個/);
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
