import assert from "node:assert/strict";
import test from "node:test";
import { chunkMenuTranslationEntries } from "./menu-translation-batching.ts";

test("splits menu translation batches by source length", () => {
  const entries = [
    { key: "long-a", sourceText: "あ".repeat(2200) },
    { key: "long-b", sourceText: "い".repeat(2200) },
    { key: "short", sourceText: "商品名" }
  ];
  const chunks = chunkMenuTranslationEntries(entries, 16, 3500);
  assert.deepEqual(chunks.map((chunk) => chunk.map((entry) => entry.key)), [
    ["long-a"],
    ["long-b", "short"]
  ]);
});

test("splits menu translation batches by entry count", () => {
  const entries = Array.from({ length: 5 }, (_, index) => ({ key: String(index), sourceText: "短い名前" }));
  const chunks = chunkMenuTranslationEntries(entries, 2, 3500);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [2, 2, 1]);
});
