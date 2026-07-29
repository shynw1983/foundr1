import assert from "node:assert/strict";
import test from "node:test";

import { mergeDuplicateToppingGroups } from "./menu-customization-groups.ts";

test("merges duplicate topping groups and keeps other topping-related groups separate", () => {
  const groups = mergeDuplicateToppingGroups([
    {
      id: "condensed",
      groupKey: "condensed",
      name: "トッピング",
      selectionType: "single",
      ruleJson: { minSelections: 0, maxSelections: 1 },
      options: [{ id: "milk", optionKey: "milk" }]
    },
    {
      id: "remove",
      groupKey: "remove",
      name: "トッピング抜き",
      selectionType: "single",
      ruleJson: { minSelections: 0, maxSelections: 1 },
      options: [{ id: "no-tapioca", optionKey: "no-tapioca" }]
    },
    {
      id: "original",
      groupKey: "original",
      name: "トッピング",
      selectionType: "multiple",
      ruleJson: { minSelections: 0, maxSelections: 4 },
      options: [
        { id: "cream", optionKey: "cream" },
        { id: "tapioca", optionKey: "tapioca" }
      ]
    }
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, "トッピング");
  assert.equal(groups[0].selectionType, "multiple");
  assert.equal(groups[0].ruleJson.maxSelections, 3);
  assert.deepEqual(groups[0].options.map((option) => option.optionKey), ["milk", "cream", "tapioca"]);
  assert.equal(groups[1].name, "トッピング抜き");
});

test("deduplicates the same topping option while preserving first-seen order", () => {
  const groups = mergeDuplicateToppingGroups([
    {
      id: "first",
      label: "トッピング",
      selectionType: "single",
      minSelections: 0,
      maxSelections: 1,
      options: [{ id: "first-tapioca", optionKey: "tapioca" }]
    },
    {
      id: "second",
      label: "トッピング",
      selectionType: "multiple",
      minSelections: 0,
      maxSelections: 2,
      options: [
        { id: "second-tapioca", optionKey: "tapioca" },
        { id: "cream", optionKey: "cream" }
      ]
    }
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].options.map((option) => option.id), ["first-tapioca", "cream"]);
  assert.equal(groups[0].maxSelections, 2);
});
