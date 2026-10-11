import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";

const environment = { AUTH_SECRET: "isolated-store-identity-test", NODE_ENV: "production" };
function load(path: string, modules: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, {
    exports, Buffer, Response, Request, URL, TextEncoder, TextDecoder, atob, btoa, crypto: crypto.webcrypto,
    process: { env: environment }, require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected identity dependency ${name}`);
      return modules[name];
    }
  });
  return exports;
}
const policy = load("./store-inventory-policy.ts") as unknown as typeof import("./store-inventory-policy");
const auth = load("./auth.ts", { "node:crypto": crypto }) as unknown as typeof import("./auth");
const token = load("./store-inventory-operator-token.ts", { "node:crypto": crypto, "./store-inventory-policy": policy }) as unknown as typeof import("./store-inventory-operator-token");
const permissions = load("./role-permissions.ts", { "./db": { sql: async () => ["store.inventory", "module.staffPortal", "module.inventory", "module.orders", "module.products", "module.procurement", "module.settings"].map(permissionKey => ({permissionKey, isEnabled: true})) } }) as unknown as typeof import("./role-permissions");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const proofInput = {
  terminalEmployeeId: uuid(1), terminalSessionId: uuid(2), storeId: uuid(3),
  operatorEmployeeId: uuid(4), operatorRole: "staff", operatorSessionVersion: 7
};
function signed(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", environment.AUTH_SECRET).update(payload).digest("base64url")}`;
}
function sessionToken(role: string) {
  return auth.createSessionToken({ id: uuid(1), sessionId: uuid(2), name: "Person", loginId: "person", role, sessionVersion: 1 });
}

test("Store execution roles separate real employees, restricted personal surfaces and full workbenches", () => {
  for (const role of ["owner", "manager", "store_owner", "store_manager", "staff", "store_terminal", "supplier", "", "STAFF"]) {
    assert.equal(policy.canUseStoreInventory(role), ["owner", "manager", "store_owner", "store_manager", "staff", "store_terminal"].includes(role), role);
    assert.equal(policy.isStoreInventoryEmployeeRole(role), ["owner", "manager", "store_owner", "store_manager", "staff"].includes(role), role);
    assert.equal(policy.isRestrictedStorePersonalRole(role), ["store_owner", "store_manager", "staff"].includes(role), role);
    assert.equal(policy.canUseFullStoreWorkbench(role), ["owner", "manager", "store_terminal"].includes(role), role);
  }
});

test("restricted routes use exact inventory/receiving path boundaries and only the exact logout page", () => {
  for (const path of ["/store/inventory", "/store/inventory/history", "/store/receiving", "/store/receiving/123", "/store/logout"]) assert.equal(policy.isRestrictedStoreExecutionPath(path), true, path);
  for (const path of ["/store", "/store/orders", "/store/timecard", "/store/inventory-other", "/store/receiving-extra", "/store/logout/other", "/os/inventory"]) assert.equal(policy.isRestrictedStoreExecutionPath(path), false, path);
});

test("Store permission does not grant staff any OS module even with persisted forbidden grants", async () => {
  assert.equal(policy.storeInventoryPermission, "store.inventory");
  const staffPermissions = await permissions.getPermissionsForRole("staff");
  assert.equal(staffPermissions.has("store.inventory"), true);
  assert.equal(staffPermissions.has("module.staffPortal"), true);
  for (const key of ["module.inventory", "module.orders", "module.products", "module.procurement", "module.settings"]) assert.equal(staffPermissions.has(key), false, key);
  const definition = permissions.rolePermissionDefinitions.find(entry => entry.key === "store.inventory");
  assert.ok(definition);
  assert.equal(definition.defaultRoles.includes("staff"), true);
  assert.deepEqual(Array.from(permissions.getNavPathsForPermissions(["store.inventory"])), ["/store/inventory", "/store/receiving"]);
  assert.equal(permissions.rolePermissionDefinitions.find(entry => entry.key === "module.inventory")?.defaultRoles.includes("staff"), false);
});

test("operator proof has its own purpose, exact terminal/session/store/actor binding and 15-minute expiry", () => {
  const now = 1_800_000_000_000;
  const minted = token.createStoreInventoryOperatorToken(proofInput, now);
  const read = token.readStoreInventoryOperatorToken(minted.token, now);
  assert.equal(read.expired, false);
  assert.equal(JSON.stringify(read.value), JSON.stringify({ ...proofInput, purpose: "store_inventory_operator", expiresAt: now + 900_000 }));
  assert.equal(minted.expiresAt, new Date(now + 900_000).toISOString());
  assert.equal(token.readStoreInventoryOperatorToken(minted.token, now + 899_999).value?.operatorEmployeeId, proofInput.operatorEmployeeId);
  assert.equal(token.readStoreInventoryOperatorToken(minted.token, now + 900_000).value, null);
  assert.equal(token.readStoreInventoryOperatorToken(minted.token, now + 900_000).expired, true);
});

test("operator proof rejects credential substitution, forged payloads, malformed or oversized tokens", () => {
  const now = Date.now();
  const minted = token.createStoreInventoryOperatorToken(proofInput, now).token;
  const [payload, signature] = minted.split(".");
  const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), operatorEmployeeId: uuid(99) })).toString("base64url")}.${signature}`;
  for (const value of [forged, `${payload}.bad`, `${minted}.extra`, "", "x".repeat(3001), 12, null,
    sessionToken("staff"), auth.createPasswordActionToken({id: proofInput.operatorEmployeeId, sessionVersion: 7}, "initial_change")]) {
    const read = token.readStoreInventoryOperatorToken(value, now);
    assert.equal(read.value, null);
    assert.equal(read.expired, false);
  }
});

test("even valid signatures reject wrong purpose, terminal-as-person, invalid UUIDs and versions", () => {
  const now = Date.now(), value = { ...proofInput, purpose: "store_inventory_operator", expiresAt: now + 900_000 };
  for (const patch of [
    { purpose: "initial_change" }, { operatorRole: "store_terminal" }, { operatorRole: "supplier" },
    { terminalEmployeeId: "person" }, { terminalSessionId: "not-a-session" }, { storeId: "A" }, { operatorEmployeeId: "label" },
    { operatorSessionVersion: -1 }, { operatorSessionVersion: 1.5 }, { expiresAt: 1.5 }, { expiresAt: Number.MAX_SAFE_INTEGER + 1 }
  ]) assert.equal(token.readStoreInventoryOperatorToken(signed({ ...value, ...patch }), now).value, null, JSON.stringify(patch));
});

test("operator cookie is independent HttpOnly API-only SameSite and production Secure", () => {
  assert.notEqual(token.storeInventoryOperatorCookieName, auth.authCookieName);
  assert.equal(token.storeInventoryOperatorCookie("proof"), "foundr1_store_inventory_operator=proof; Path=/api; HttpOnly; SameSite=Lax; Max-Age=900; Secure");
  assert.equal(token.storeInventoryOperatorCookie("", 0), "foundr1_store_inventory_operator=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0; Secure");
  environment.NODE_ENV = "test";
  assert.equal(token.storeInventoryOperatorCookie("proof").includes("Secure"), false);
  environment.NODE_ENV = "production";
});

const NextResponse = {
  next: () => ({ kind: "next" }),
  redirect: (url: URL) => ({ kind: "redirect", pathname: url.pathname, search: url.search }),
  json: (body: unknown, init: ResponseInit) => ({ kind: "json", body, status: init.status })
};
const proxy = load("../proxy.ts", { "next/server": { NextResponse }, "./lib/store-inventory-policy": policy }).default as (request: unknown) => Promise<{kind: string; pathname?: string; search?: string}>;
function proxyRequest(path: string, proof?: string) {
  const url = new URL(`https://example.test${path}`) as URL & {clone: () => URL};
  url.clone = () => new URL(url.href);
  return { nextUrl: url, method: "GET", headers: new Headers(), cookies: { get: () => proof ? {value: proof} : undefined } };
}

for (const role of ["staff", "store_owner", "store_manager"]) {
  test(`${role} signed personal Store session reaches only inventory/receiving/logout`, async () => {
    for (const path of ["/store/inventory", "/store/inventory/history", "/store/receiving", "/store/receiving/item", "/store/logout"]) assert.equal((await proxy(proxyRequest(path, sessionToken(role)))).kind, "next", path);
    for (const path of ["/store", "/store/orders?pending=1", "/store/pos", "/store/kitchen", "/store/procedures", "/store/timecard", "/store/inventory-other"]) {
      const result = await proxy(proxyRequest(path, sessionToken(role)));
      assert.equal(result.kind, "redirect", path);
      assert.equal(result.pathname, "/store/inventory", path);
      assert.equal(result.search, "", path);
    }
  });
}

test("full Store roles retain operational routes and unsigned or forged sessions go to Store login", async () => {
  for (const role of ["owner", "manager", "store_terminal"]) for (const path of ["/store", "/store/orders", "/store/kitchen", "/store/pos", "/store/inventory", "/store/receiving"]) assert.equal((await proxy(proxyRequest(path, sessionToken(role)))).kind, "next", `${role}:${path}`);
  assert.equal((await proxy(proxyRequest("/os/inventory", sessionToken("store_terminal")))).pathname, "/store");
  for (const proof of [undefined, `${sessionToken("staff").split(".")[0]}.tampered`, "invalid"]) {
    assert.equal((await proxy(proxyRequest("/store/inventory", proof))).pathname, "/store/login");
  }
});

test("Store layout restricts notifier/printing/sync using a signed cookie without DB SSR", async () => {
  let role: string | null = null;
  const backgroundTypes = ["StoreNativeOrderNotifier", "StorePrintStation", "StoreInventorySyncStatus"];
  const jsx = (type: unknown, props: unknown) => ({type, props});
  const layout = load("../app/store/layout.tsx", {
    "next/headers": { cookies: async () => ({get: () => role ? {value: sessionToken(role)} : undefined}) },
    "../../lib/auth": auth, "../../lib/store-inventory-policy": policy,
    "../../lib/app-version": {getAppVersion: () => "test", getShortAppVersion: () => "test"},
    "react/jsx-runtime": {jsx, jsxs: jsx, Fragment: "Fragment"},
    "./components/StoreVersionNotice": {StoreVersionNotice: "StoreVersionNotice"},
    "./components/StoreNativeOrderNotifier": {StoreNativeOrderNotifier: backgroundTypes[0]},
    "./components/StorePrintStation": {StorePrintStation: backgroundTypes[1]},
    "./components/StoreInventorySyncStatus": {StoreInventorySyncStatus: backgroundTypes[2]},
    "./store-responsive.css": {}
  }).default as (input: {children: unknown}) => Promise<unknown>;
  function types(value: unknown): string[] {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(types);
    const node = value as {type: string; props?: {children?: unknown}};
    return [node.type, ...types(node.props?.children)];
  }
  for (const currentRole of [null, "staff", "store_owner", "store_manager", "owner", "manager", "store_terminal"]) {
    role = currentRole;
    const present = types(await layout({children: {type: "page"}}));
    assert.equal(present.includes("page"), true);
    assert.equal(present.includes("StoreVersionNotice"), true);
    for (const type of backgroundTypes) assert.equal(present.includes(type), currentRole !== null && ["owner", "manager", "store_terminal"].includes(currentRole), `${currentRole}:${type}`);
  }
});
