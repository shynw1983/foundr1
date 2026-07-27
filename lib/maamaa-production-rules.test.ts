import assert from "node:assert/strict";
import test from "node:test";

import { formatMaamaaSeasoningSelection } from "./maamaa-production-rules.ts";

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
