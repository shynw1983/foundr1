import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createAppVersionHandlers } from "./app-version-http.ts";
import { appVersionScopes, appVersionChannel, appVersionEventName, type AppVersionScope } from "./app-version-protocol.ts";

const versions = Object.fromEntries(appVersionScopes.map((app, index) => [app, String(index + 1).repeat(64)])) as Record<AppVersionScope, string>;

function fixture(allowed = true, rejectPublish = false) {
  const published: Array<{ app: AppVersionScope; version: string }> = [];
  const authorized: AppVersionScope[] = [];
  const handlers = createAppVersionHandlers({
    getVersion: (app) => versions[app],
    authorizePublish: async (_request, app) => { authorized.push(app); return allowed; },
    publish: async (app, version) => {
      if (rejectPublish) throw new Error("Do not expose provider internals");
      published.push({ app, version });
    },
    realtime: () => ({ key: "public-key", cluster: "ap3" })
  });
  return { handlers, published, authorized };
}

test("each version/read/config/publication is scoped and uses only the authoritative server version", async () => {
  const { handlers, published } = fixture();
  for (const app of appVersionScopes) {
    const url = `https://example.test/api/app/version?app=${app}`;
    const response = handlers.get(new Request(url));
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    const body = await response.json();
    assert.equal(body.app, app);
    assert.equal(body.version, versions[app]);
    assert.equal(body.shortVersion, versions[app].slice(0, 7));
    assert.ok(!Number.isNaN(Date.parse(body.checkedAt)));
    const config = await handlers.realtime(new Request(url)).json();
    assert.deepEqual(config, { app, key: "public-key", cluster: "ap3", versionChannel: appVersionChannel(app), eventName: appVersionEventName });
    const posted = await handlers.post(new Request(url, { method: "POST", body: JSON.stringify({ version: "attacker", app: "another-app" }) }));
    assert.equal(posted.status, 200);
    assert.equal((await posted.json()).version, versions[app]);
  }
  assert.deepEqual(published, appVersionScopes.map((app) => ({ app, version: versions[app] })));
});

test("legacy endpoints retain OS default and fixed Store identity without mixing scopes", async () => {
  const { handlers, published } = fixture();
  assert.equal((await handlers.get(new Request("https://example.test/api/app/version")).json()).app, "os");
  assert.equal((await handlers.get(new Request("https://example.test/api/store/version"), "store").json()).app, "store");
  assert.equal(handlers.get(new Request("https://example.test/api/store/version?app=os"), "store").status, 400);
  assert.equal((await handlers.post(new Request("https://example.test/api/store/version", { method: "POST" }), "store")).status, 200);
  assert.deepEqual(published, [{ app: "store", version: versions.store }]);
});

test("unknown, duplicate, empty and case-changed application identifiers fail before authorization or publication", async () => {
  const { handlers, published, authorized } = fixture();
  for (const query of ["app=unknown", "app=", "app=Store", "app=store&app=os", "app=__proto__", "app=store%2Fos"]) {
    const request = new Request(`https://example.test/api/app/version?${query}`);
    assert.equal(handlers.get(request).status, 400);
    assert.equal(handlers.realtime(request).status, 400);
    assert.equal((await handlers.post(request)).status, 400);
  }
  assert.deepEqual(published, []);
  assert.deepEqual(authorized, []);
});

test("unauthorized publication is denied; public version metadata contains no store or employee data", async () => {
  const { handlers, published } = fixture(false);
  const request = new Request("https://example.test/api/app/version?app=store&storeId=other-store");
  assert.equal((await handlers.post(request)).status, 403);
  assert.deepEqual(published, []);
  assert.deepEqual(Object.keys(await handlers.get(request).json()).sort(), ["app", "checkedAt", "shortVersion", "version"]);
});

test("failed realtime publication reports failure without exposing the underlying error", async () => {
  const { handlers, published } = fixture(true, true);
  const response = await handlers.post(new Request("https://example.test/api/app/version?app=os"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Version notification unavailable." });
  assert.deepEqual(published, []);
  assert.equal(handlers.get(new Request("https://example.test/api/app/version?app=os")).status, 200);
});

function loadWithMocks(file: string, mocks: Record<string, unknown>, env: Record<string, string> = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", "process", compiled)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency ${name}`);
    return mocks[name];
  }, module, module.exports, { env });
  return module.exports;
}

test("actual realtime publisher never uses the former mixed channel, including legacy Store hooks", async () => {
  const triggers: Array<{ channel: string; event: string; payload: any }> = [];
  const usage: any[] = [];
  class Pusher {
    async trigger(channel: string, event: string, payload: unknown) { triggers.push({ channel, event, payload }); }
  }
  const publisher = loadWithMocks("./order-realtime.ts", {
    "pusher": Pusher,
    "./customer-orders": {},
    "./app-version": { getAppVersion: (app: AppVersionScope) => versions[app], getShortAppVersion: (version: string) => version.slice(0, 7) },
    "./app-version-protocol": { appVersionChannel, appVersionEventName, isContentAppVersion: (value: string) => /^[a-f0-9]{64}$/.test(value) },
    "./external-service-usage": { recordExternalServiceUsage: async (value: unknown) => { usage.push(value); } }
  }, { PUSHER_APP_ID: "test", PUSHER_KEY: "public-key", PUSHER_SECRET: "fake-test-secret", PUSHER_CLUSTER: "ap3" });
  for (const app of appVersionScopes) await publisher.publishAppVersionUpdatedEvent(app);
  await publisher.publishStoreVersionUpdatedEvent();
  await publisher.publishAppVersionUpdatedEvent("os", "local");
  await publisher.publishAppVersionUpdatedEvent("store", "old-deployment-id");
  assert.equal(triggers.length, 6);
  for (const trigger of triggers) {
    assert.equal(trigger.channel, appVersionChannel(trigger.payload.app));
    assert.equal(trigger.event, appVersionEventName);
    assert.equal(trigger.payload.version, versions[trigger.payload.app as AppVersionScope]);
    assert.notEqual(trigger.channel, "store-version");
  }
  assert.equal(usage.length, 6);
});

test("real server authorization preserves Store secret scope and requires an active session otherwise", async () => {
  let session: unknown = null;
  const calls: Array<{ app: AppVersionScope; version: string }> = [];
  const runtime = loadWithMocks("./app-version-server.ts", {
    "node:crypto": { timingSafeEqual: (a: Buffer, b: Buffer) => a.equals(b) },
    "./api-auth": { requireOsSession: async () => session },
    "./app-version": { getAppVersion: (app: AppVersionScope) => versions[app] },
    "./app-version-http": { createAppVersionHandlers },
    "./order-realtime": { publishAppVersionUpdatedEvent: async (app: AppVersionScope, version: string) => { calls.push({ app, version }); } }
  }, { STORE_VERSION_NOTIFY_SECRET: "store-hook-test" });
  const post = (app: string, secret?: string) => runtime.appVersionHandlers.post(new Request(`https://example.test/api/app/version?app=${app}`, { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {} }));
  assert.equal((await post("store")).status, 403);
  assert.equal((await post("store", "wrong")).status, 403);
  assert.equal((await post("store", "store-hook-test")).status, 200);
  assert.equal((await post("os", "store-hook-test")).status, 403);
  session = { id: "active-employee" };
  assert.equal((await post("os")).status, 200);
  assert.deepEqual(calls, [{ app: "store", version: versions.store }, { app: "os", version: versions.os }]);
});

test("production readers use content versions despite unrelated deployment changes and fail closed without a generated version", () => {
  const module = (manifest: unknown, env: Record<string, string>) => loadWithMocks("./app-version.ts", {
    "./generated/app-web-versions.json": manifest,
    "./app-version-protocol": { isContentAppVersion: (value: string) => /^[a-f0-9]{64}$/.test(value) }
  }, env);
  for (const deployment of ["studio-only-release", "os-only-release"]) {
    const reader = module({ schema: 1, versions }, { NODE_ENV: "production", VERCEL_GIT_COMMIT_SHA: deployment, VERCEL_DEPLOYMENT_ID: deployment });
    for (const app of appVersionScopes) assert.equal(reader.getAppVersion(app), versions[app]);
    assert.equal(reader.getShortAppVersion(versions.store), versions.store.slice(0, 7));
  }
  assert.equal(module({ schema: 1, versions }, { NODE_ENV: "development" }).getAppVersion("store"), "local");
  assert.throws(() => module({ schema: 1, versions: {} }, { NODE_ENV: "production" }).getAppVersion("store"), /Missing content version/);
  assert.throws(() => module({ schema: 2, versions }, { NODE_ENV: "production" }).getAppVersion("os"), /Missing content version/);
});
