import assert from "node:assert/strict";
import test from "node:test";
import { resolveLinkedTargetKeys, type MenuAvailabilityLink } from "./menu-availability-link-graph.ts";

const links: MenuAvailabilityLink[] = [
  { sourceKind: "option", sourceId: "beef", dependentKind: "item", dependentId: "beef-set", isBidirectional: false },
  { sourceKind: "option", sourceId: "corn-50", dependentKind: "option", dependentId: "corn-100", isBidirectional: true },
  { sourceKind: "option", sourceId: "corn-100", dependentKind: "option", dependentId: "cold-corn", isBidirectional: true }
];

test("one-way links do not run backwards", () => {
  assert.deepEqual(resolveLinkedTargetKeys(links, ["option:beef"]), ["item:beef-set"]);
  assert.deepEqual(resolveLinkedTargetKeys(links, ["item:beef-set"]), []);
});

test("bidirectional menu links traverse a family without looping", () => {
  assert.deepEqual(
    resolveLinkedTargetKeys(links, ["option:cold-corn"]),
    ["option:corn-100", "option:corn-50"]
  );
});
