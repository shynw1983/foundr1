import assert from "node:assert/strict";
import test from "node:test";

import {
  existingMenuDisplayName,
  findMenuDisplayNameCandidate
} from "./menu-display-name-matcher.ts";

const candidates = [
  { id: "soup", name: "旨味マーラータンスープ", displayNames: { zh: "麻辣烫汤底" } },
  { id: "spice", name: "薬膳スパイスあり【超おすすめ🏮】", displayNames: { zh: "添加药膳香料" } },
  { id: "vinegar", name: "【別添容器】香酢👈️超おすすめです🤫", displayNames: { zh: "香醋" } },
  { id: "enoki", name: "えのき", displayNames: { zh: "金针菇" } }
];

test("matches Rocket labels to existing menu names without translating", () => {
  assert.equal(findMenuDisplayNameCandidate("自由にカスタム 旨味マーラータンスープ", candidates)?.id, "soup");
  assert.equal(findMenuDisplayNameCandidate("薬膳スパイスあり【超おすすめ】", candidates)?.id, "spice");
  assert.equal(findMenuDisplayNameCandidate("【別添容器】香酢超おすすめです", candidates)?.id, "vinegar");
  assert.equal(existingMenuDisplayName("えのき", candidates[3], "zh"), "金针菇");
});

test("keeps the source Japanese when the menu master has no Chinese", () => {
  assert.equal(existingMenuDisplayName("未登録の商品", null, "zh"), "未登録の商品");
});
