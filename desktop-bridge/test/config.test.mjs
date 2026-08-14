import assert from "node:assert/strict";
import test from "node:test";

import { expandHome } from "../src/config.mjs";
import { normalizeText, targetNames } from "../src/adapters/common.mjs";

test("normalizes platform labels before exact matching", () => {
  assert.equal(normalizeText("  牛肉\u3000マーラータン\n"), "牛肉 マーラータン");
  assert.deepEqual(targetNames({ label: "豆乳", aliases: ["豆乳", "Soy milk"] }), ["豆乳", "Soy milk"]);
});

test("expands a home-relative Chrome profile path", () => {
  assert.ok(expandHome("~/Library/Application Support/Foundr1").endsWith("/Library/Application Support/Foundr1"));
});
