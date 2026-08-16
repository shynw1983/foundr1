import assert from "node:assert/strict";
import test from "node:test";

import { DemaeCanAdapter } from "../src/adapters/demae-can.mjs";

test("refreshes the Demae inventory page and retries matching when an expired page returns no rows", async () => {
  let reloadCount = 0;
  let inventoryReadCount = 0;
  const page = {
    async evaluate(_script, argument) {
      if (argument === undefined) {
        return {
          url: "https://partner.demae-can.com/merchant-admin/shop/stockout",
          title: "品切れ終売設定",
          text: "品切れ終売設定"
        };
      }
      inventoryReadCount += 1;
      if (inventoryReadCount === 1) return [{ label: "半熟卵", names: ["半熟卵"], matches: [] }];
      return [{
        label: "半熟卵",
        names: ["半熟卵"],
        matches: [{ rowId: "row-1", unavailable: false, permanentlyUnavailable: false }]
      }];
    },
    async waitForSelector() {
      return {};
    },
    async reload() {
      reloadCount += 1;
    },
    async waitForNetworkIdle() {}
  };
  const adapter = new DemaeCanAdapter({
    async goto() {
      return page;
    }
  });

  const result = await adapter.locateTargets([{ label: "半熟卵", aliases: [] }]);

  assert.equal(reloadCount, 1);
  assert.equal(inventoryReadCount, 2);
  assert.equal(result[0].matches.length, 1);
});
