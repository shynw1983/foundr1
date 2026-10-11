import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as policy from "./inventory-observation-policy.ts";

test("shortage observations remain actionable when counts are unknown or older than the observation", () => {
  for (const currentQuantity of [null, 8]) {
    for (const exceptionCode of ["low", "out"]) {
      assert.equal(policy.inventoryNeedsOrder({ currentQuantity, safetyStock: 1, exceptionCode }), true);
    }
  }
  assert.equal(policy.inventoryNeedsOrder({ currentQuantity: null, safetyStock: 1, exceptionCode: "" }), false);
  assert.equal(policy.inventoryNeedsOrder({ currentQuantity: 1, safetyStock: 1, exceptionCode: "" }), true);
  assert.equal(policy.inventoryNeedsOrder({ currentQuantity: 8, safetyStock: 1, exceptionCode: "quality" }), false);
});

test("an absent or malformed count is never converted to zero", () => {
  for (const value of [null, undefined, "", "  ", false, [], {}, "0x10", "1.234", -1, Infinity, 10_000_000_000]) {
    assert.equal(policy.normalizeInventoryCount(value), null, String(value));
  }
  for (const [value, expected] of [[0, 0], ["0", 0], [" 2.75 ", 2.75], [".5", 0.5], [5, 5]] as const) {
    assert.equal(policy.normalizeInventoryCount(value), expected);
  }
  assert.equal(policy.inventoryCountException(0, 1), "out");
  assert.equal(policy.inventoryCountException(0.5, 1), "low");
  assert.equal(policy.inventoryCountException(6.25, 1), "");
});

// Physical count/observation persistence and transaction failures are exercised
// with the real shared SQL in scripts/tests/inventory-{usage,quick-checks}-db.mjs.
function managementRoute(role: string | null, granted = true) {
  const calls: Array<{ kind: string; role: string; body?: unknown }> = [];
  const session = role ? { id: "employee", name: "Operator", role } : null;
  const modules: Record<string, unknown> = {
    "../../../lib/api-auth": { requireOsSession: async () => session },
    "../../../lib/role-permissions": { roleHasPermission: async () => granted },
    "../../../lib/inventory-execution-data": {
      readInventoryResponse: async (actor: { role: string }) => { calls.push({ kind: "read", role: actor.role }); return Response.json({ items: [] }); },
      handleInventoryOperation: async (actor: { role: string }, body: unknown) => { calls.push({ kind: "write", role: actor.role, body }); return Response.json({ ok: true }); }
    }
  };
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/inventory/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, Response, URL, require: (name: string) => modules[name] });
  return { calls, get: () => exports.GET(new Request("https://example.test/api/inventory?storeId=store")),
    post: () => exports.POST(new Request("https://example.test/api/inventory", { method: "POST", body: JSON.stringify({ action: "configure", storeId: "store", expectedOperatorId: "employee" }) })) };
}

test("a shared terminal cannot use OS writes even with a nominal inventory grant or an operator assertion", async () => {
  const route = managementRoute("store_terminal");
  assert.equal((await route.post()).status, 403);
  assert.equal(route.calls.length, 0);
  assert.equal((await route.get()).status, 200);
  assert.deepEqual(route.calls, [{ kind: "read", role: "store_terminal" }]);
});

test("staff execution permission does not become OS management permission", async () => {
  const route = managementRoute("staff");
  assert.equal((await route.post()).status, 403);
  assert.equal(route.calls.length, 0);
});

test("management module denial and missing sessions fail before calling the shared stock service", async () => {
  for (const route of [managementRoute(null), managementRoute("owner", false)]) {
    assert.equal((await route.get()).status, 403);
    assert.equal((await route.post()).status, 403);
    assert.equal(route.calls.length, 0);
  }
  const owner = managementRoute("owner");
  const response = await owner.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(owner.calls[0].role, "owner");
});
