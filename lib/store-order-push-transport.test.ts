import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("./store-order-push-transport.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function fixture() {
  const env = {
    STORE_ORDER_PUSH_ENABLED: "true", FCM_PROJECT_ID: "test-project", FCM_ANDROID_APP_ID: "test-app",
    FCM_ANDROID_API_KEY: "public-client-key", FCM_SENDER_ID: "123",
    FCM_CLIENT_EMAIL: "test@test-project.iam.gserviceaccount.com",
    FCM_WIF_PROVIDER: "projects/123/locations/global/workloadIdentityPools/test-pool/providers/vercel"
  };
  let now = Date.now(), oidcCalls = 0, oidcError = false;
  let responseOverride: ((url: string) => Response | undefined) | undefined;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const exports: any = {};
  class Clock extends Date { static now() { return now; } }
  runInNewContext(code, {
    exports, process: { env }, Date: Clock, URLSearchParams, AbortSignal,
    require: (name: string) => {
      assert.equal(name, "@vercel/oidc");
      return { getVercelOidcToken: async () => {
        oidcCalls++;
        if (oidcError) throw new Error("sensitive-provider-token");
        return "vercel-runtime-token";
      } };
    },
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const overridden = responseOverride?.(url);
      if (overridden) return overridden;
      if (url.includes("sts.googleapis.com")) return Response.json({ access_token: "federated-token" });
      if (url.includes("iamcredentials.googleapis.com")) return Response.json({ accessToken: "fcm-scoped-token", expireTime: new Date(now + 900_000).toISOString() });
      return Response.json({ name: "test-message" });
    }
  });
  const send = () => exports.sendOrderPush({ provider: "fcm", sessionId: "session", registration: { token: "device-token" } }, { type: "store_bridge_order", body: "Test" });
  return { exports, env, calls, send, oidcCalls: () => oidcCalls,
    advance: (ms: number) => { now += ms; },
    failOidc: () => { oidcError = true; },
    override: (handler: (url: string) => Response | undefined) => { responseOverride = handler; }
  };
}

test("FCM exchanges the runtime identity for a send-scoped token and caches it for concurrent sends", async () => {
  const h = fixture();
  const config = h.exports.getOrderPushConfig();
  assert.equal(config.fcm, true);
  assert.equal(config.firebase.projectId, "test-project");
  assert.ok(!JSON.stringify(config).includes("gserviceaccount"));
  assert.ok(!JSON.stringify(config).includes("workloadIdentityPools"));
  assert.equal(h.oidcCalls(), 0);
  await Promise.all([h.send(), h.send()]);
  assert.equal(h.oidcCalls(), 1);
  const exchange = new URLSearchParams(h.calls[0].init.body as URLSearchParams);
  assert.equal(h.calls[0].url, "https://sts.googleapis.com/v1/token");
  assert.equal(exchange.get("subject_token"), "vercel-runtime-token");
  assert.equal(exchange.get("audience"), "//iam.googleapis.com/" + h.env.FCM_WIF_PROVIDER);
  assert.equal(exchange.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
  assert.equal(exchange.get("subject_token_type"), "urn:ietf:params:oauth:token-type:jwt");
  assert.equal(exchange.get("scope"), "https://www.googleapis.com/auth/cloud-platform");
  const impersonation = h.calls[1];
  assert.equal(impersonation.url, "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/test%40test-project.iam.gserviceaccount.com:generateAccessToken");
  assert.equal(new Headers(impersonation.init.headers).get("Authorization"), "Bearer federated-token");
  assert.deepEqual(JSON.parse(String(impersonation.init.body)), { scope: ["https://www.googleapis.com/auth/firebase.messaging"], lifetime: "900s" });
  const delivery = h.calls[2];
  assert.equal(new Headers(delivery.init.headers).get("Authorization"), "Bearer fcm-scoped-token");
  const message = JSON.parse(String(delivery.init.body)).message;
  assert.equal(message.android.priority, "high"); assert.equal(message.android.ttl, "60s");
  assert.equal(message.android.restricted_package_name, "jp.foundr1.store");
  assert.equal(message.data.sessionId, "session"); assert.equal(message.notification, undefined);
  assert.ok(!JSON.stringify(message).includes("runtime-token"));
  await h.send(); assert.equal(h.oidcCalls(), 1);
  h.advance(850_000);
  await h.send(); assert.equal(h.oidcCalls(), 2);
});

test("missing runtime identity is redacted and prevents downstream requests", async () => {
  const h = fixture(); h.failOidc();
  await assert.rejects(h.send(), { message: "FCM_OIDC_UNAVAILABLE" });
  assert.equal(h.calls.length, 0);
});

test("deployment verification always uses validate_only with a fixed target and no device token", async () => {
  const h = fixture();
  await h.exports.verifyOrderPushTransport();
  const body = JSON.parse(String(h.calls[2].init.body));
  assert.equal(body.validate_only, true);
  assert.equal(body.message.topic, "foundr1-store-transport-validation");
  assert.equal(body.message.token, undefined);
  assert.equal(body.message.notification, undefined);
});

test("rejected federation or impersonation never sends and does not cache failed authentication", async (t) => {
  for (const [endpoint, error] of [["sts.googleapis.com", "FCM_STS_403"], ["iamcredentials.googleapis.com", "FCM_AUTH_403"]]) {
    await t.test(endpoint, async () => {
      const h = fixture();
      h.override(url => url.includes(endpoint) ? Response.json({ error: "sensitive-provider-token" }, { status: 403 }) : undefined);
      await assert.rejects(h.send(), { message: error });
      assert.ok(h.calls.every(call => !call.url.startsWith("https://fcm.googleapis.com")));
      h.override(() => undefined);
      await h.send(); assert.equal(h.oidcCalls(), 2);
    });
  }
});

test("invalid expiry and malformed identity configuration fail closed", async () => {
  const h = fixture();
  h.override(url => url.includes("iamcredentials") ? Response.json({ accessToken: "token", expireTime: "invalid" }) : undefined);
  await assert.rejects(h.send(), { message: "FCM_AUTH_200" });
  assert.ok(h.calls.every(call => !call.url.startsWith("https://fcm.googleapis.com")));
  const missing = fixture(); missing.env.FCM_WIF_PROVIDER = "";
  assert.equal(missing.exports.getOrderPushConfig().fcm, false);
  await assert.rejects(missing.send(), { message: "FCM_NOT_CONFIGURED" });
  assert.equal(missing.oidcCalls(), 0);
});

test("FCM authentication rejection refreshes the token and unregistered devices are identified", async () => {
  const h = fixture();
  h.override(url => url.startsWith("https://fcm.googleapis.com") ? Response.json({}, { status: 401 }) : undefined);
  await assert.rejects(h.send(), { message: "FCM_SEND_401" });
  h.override(() => undefined); await h.send(); assert.equal(h.oidcCalls(), 2);
  h.override(url => url.startsWith("https://fcm.googleapis.com") ? Response.json({ error: { details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 }) : undefined);
  await assert.rejects(h.send(), (error: any) => error.message === "FCM_SEND_404" && error.expired === true);
});
