import assert from "node:assert/strict";
import test from "node:test";
import { expandPosBowls, offlineServingTickets, isDineInBowlOptionGroup } from "./pos-serving-policy.ts";

test("identical bowls stay separate while drink quantities and total money are preserved", () => {
  const bowls = expandPosBowls([
    { brandName: "まぁ麻", itemKind: "buildable_product", quantity: 3, amount: 3600, measuredQuantity: 300 },
    { brandName: "nanacha", itemKind: "fixed_product", quantity: 2, amount: 1000, measuredQuantity: 0 }
  ]);
  assert.equal(bowls.length, 4);
  assert.deepEqual(bowls.map((item) => item.quantity), [1, 1, 1, 2]);
  assert.equal(bowls.reduce((sum, item) => sum + item.amount, 0), 4600);
  assert.deepEqual(offlineServingTickets(bowls, "O1234ABCD").map((ticket) => ticket.pickupCode), ["O1234ABCD-1", "O1234ABCD-2", "O1234ABCD-3"]);
});

test("dine-in keeps production flavor/noodle choices without including every display ingredient", () => {
  for (const groupKey of ["heat", "numb", "medicinal-spice", "special-flavor", "noodle-replacement", "counter-ingredients"]) {
    assert.ok(isDineInBowlOptionGroup({ groupKey }));
  }
  assert.equal(isDineInBowlOptionGroup({ groupKey: "display-vegetables" }), false);
});
