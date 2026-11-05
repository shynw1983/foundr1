import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(path, modules, env = {}) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports, Response, Promise, process: { env }, console: { error() {} },
    require(name) {
      assert.ok(name in modules, `Unexpected dependency ${name}`);
      return modules[name];
    }
  });
  return exports;
}

test("automatic sweep limits concurrent work and continues after a store fails", async () => {
  const calls = [];
  let inflight = 0, maximum = 0;
  const data = load("../../lib/replenishment-demand-sync.ts", {
    "./db": { sql: async () => Array.from({ length: 7 }, (_, index) => ({ id: String(index) })) },
    "./replenishment-demand-data": {
      async syncInventoryReplenishmentDemands(context, storeId) {
        calls.push(storeId);
        assert.equal(context.role, "owner");
        assert.equal(context.id, "");
        maximum = Math.max(maximum, ++inflight);
        await Promise.resolve();
        inflight -= 1;
        if (storeId === "1") throw new Error("database unavailable");
      }
    }
  });
  const result = await data.sweepReplenishmentDemands();
  assert.deepEqual(calls, ["0", "1", "2", "3", "4", "5", "6"]);
  assert.equal(maximum, 3);
  assert.equal(result.ok, false);
  assert.equal(result.synced, 6);
  assert.deepEqual(Array.from(result.failedStoreIds), ["1"]);
});

test("cron rejects missing/incorrect secrets before any work, and exposes partial failure", async () => {
  let calls = 0;
  const modules = { "../../../../lib/replenishment-demand-sync": {
    async sweepReplenishmentDemands() { calls++; return { ok: false, failedStoreIds: ["store-a"] }; }
  } };
  const noSecret = load("../../app/api/cron/replenishment-demands/route.ts", modules);
  assert.equal((await noSecret.GET(new Request("https://example.test/api/cron/replenishment-demands"))).status, 401);
  const cron = load("../../app/api/cron/replenishment-demands/route.ts", modules, { CRON_SECRET: "test-only" });
  assert.equal((await cron.GET(new Request("https://example.test/api/cron/replenishment-demands", { headers: { authorization: "Bearer wrong" } }))).status, 401);
  assert.equal(calls, 0);
  const response = await cron.GET(new Request("https://example.test/api/cron/replenishment-demands", { headers: { authorization: "Bearer test-only" } }));
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
