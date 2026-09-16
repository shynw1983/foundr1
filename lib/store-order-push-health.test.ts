import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const code = ts.transpileModule(readFileSync(new URL("../app/api/cron/store-order-push/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(configured = true, failure = false) {
  let validations = 0;
  const exports: any = {};
  class TransportError extends Error {}
  runInNewContext(code, { exports, Response, process: { env: { CRON_SECRET: "deployment-secret" } }, require: (name: string) => {
    if (name.endsWith("store-order-push-transport")) return { OrderPushTransportError: TransportError, getOrderPushConfig: () => ({ fcm: configured, enabled: true }), verifyOrderPushTransport: async () => { validations++; if (failure) throw new TransportError("FCM_AUTH_403"); } };
    if (name.endsWith("/db")) return { sql: () => { throw new Error("Verification must not query or modify orders"); } };
    return {};
  } });
  return { post: (secret = "deployment-secret") => exports.POST(new Request("https://test.invalid/api/cron/store-order-push", { method: "POST", headers: { authorization: `Bearer ${secret}` } })), count: () => validations };
}
test("deployment verification requires cron authorization before touching transport", async () => {
  const h = fixture(); assert.equal((await h.post("wrong")).status, 401); assert.equal(h.count(), 0);
});
test("deployment verification reports configuration and provider failures without invoking order queries", async () => {
  const missing = fixture(false); assert.equal((await missing.post()).status, 503); assert.equal(missing.count(), 0);
  const failed = fixture(true, true); const response = await failed.post(); assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error: "FCM_AUTH_403" });
});
test("authorized deployment verification reports validation-only success", async () => {
  const h = fixture(); const response = await h.post(); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, validateOnly: true, enabled: true }); assert.equal(h.count(), 1);
});

const adminCode = ts.transpileModule(readFileSync(new URL("../app/api/store/order-notifications/health/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function adminFixture(role: string | null, configured = true, failure = false) {
  let validations = 0;
  const exports: any = {};
  class TransportError extends Error {}
  runInNewContext(adminCode, { exports, Response, require: (name: string) => {
    if (name.endsWith("api-auth")) return { requireOsSession: async () => role ? { role } : null };
    if (name.endsWith("store-order-push-transport")) return { OrderPushTransportError: TransportError, getOrderPushConfig: () => ({ fcm: configured, enabled: true }), verifyOrderPushTransport: async () => { validations++; if (failure) throw new TransportError("FCM_AUTH_403"); } };
    throw new Error("Unexpected dependency");
  } });
  return { get: () => exports.GET(), count: () => validations };
}
test("admin health denies missing login and non-management roles before checking transport", async () => {
  const anonymous = adminFixture(null); assert.equal((await anonymous.get()).status, 401); assert.equal(anonymous.count(), 0);
  for (const role of ["store_owner", "store_manager", "staff", "store_terminal"]) {
    const h = adminFixture(role); assert.equal((await h.get()).status, 403); assert.equal(h.count(), 0);
  }
});
test("admin health allows existing notification managers and returns uncached validation-only success", async () => {
  for (const role of ["owner", "manager"]) {
    const h = adminFixture(role); const response = await h.get(); assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true, validateOnly: true, enabled: true }); assert.equal(h.count(), 1);
  }
});
test("admin health reports configuration and sanitized provider failures", async () => {
  const missing = adminFixture("owner", false); assert.equal((await missing.get()).status, 503); assert.equal(missing.count(), 0);
  const response = await adminFixture("owner", true, true).get();
  assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error: "FCM_AUTH_403" });
});
