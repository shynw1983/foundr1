import assert from "node:assert/strict";
import test from "node:test";

import { DemaeCanAdapter, fillInput } from "../src/adapters/demae-can.mjs";

test("fills Demae login inputs without ElementHandle click or type calls", async () => {
  let disposed = false;
  let evaluatedWith = null;
  const page = {
    async waitForSelector() {
      return {
        async dispose() { disposed = true; },
        async click() { throw new Error("click should not be called"); },
        async type() { throw new Error("type should not be called"); }
      };
    },
    async evaluate(_function, argument) {
      evaluatedWith = argument;
      return true;
    }
  };

  assert.equal(await fillInput(page, 'input[name="handleCd"]', "shop-code"), true);
  assert.equal(disposed, true);
  assert.deepEqual(evaluatedWith, {
    selectorValue: 'input[name="handleCd"]',
    inputValue: "shop-code"
  });
});

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
