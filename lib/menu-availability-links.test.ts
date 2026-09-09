import assert from "node:assert/strict";
import test from "node:test";
import { resolveLinkedTargetKeys, resolveSharedInventoryKeys, type MenuAvailabilityLink } from "./menu-availability-link-graph.ts";

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

test("every noodle peer restores the same stock family and uses the same blocker key", () => {
  const expected = ["option:cold-corn", "option:corn-100", "option:corn-50"];
  for (const source of expected) {
    assert.deepEqual(resolveSharedInventoryKeys(links, [source as `option:${string}`]), expected);
  }
});

test("one-way dependent blockers remain independent of shared stock peers", () => {
  const graph: MenuAvailabilityLink[] = [...links,
    { sourceKind: "option", sourceId: "corn-100", dependentKind: "item", dependentId: "beef-set", isBidirectional: false }
  ];
  assert(!resolveSharedInventoryKeys(graph, ["option:corn-50"]).includes("item:beef-set"));
  assert(resolveLinkedTargetKeys(graph, ["option:corn-50"]).includes("item:beef-set"));
  assert.deepEqual(resolveSharedInventoryKeys(graph, ["item:beef-set"]), ["item:beef-set"]);
});
