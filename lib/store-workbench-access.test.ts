import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const environment = { AUTH_SECRET: "isolated-store-workbench-access-test", NODE_ENV: "test" };
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function load(path: string, modules: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports, Buffer, Response, Request, URL, Headers, TextEncoder, TextDecoder, atob, btoa,
    crypto: crypto.webcrypto, process: { env: environment },
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected workbench dependency: ${name}`);
      return modules[name];
    }
  });
  return exports;
}

const policy = load("./store-inventory-policy.ts") as unknown as typeof import("./store-inventory-policy");
const auth = load("./auth.ts", { "node:crypto": crypto }) as unknown as typeof import("./auth");
const navigation = load("../app/store/components/store-navigation.ts", {
  "lucide-react": {}, "../../../lib/store-inventory-policy": policy
}) as unknown as typeof import("../app/store/components/store-navigation");
const permissions = load("./role-permissions.ts", {
  "./db": { sql: async () => [] }
}) as unknown as typeof import("./role-permissions");

type ProxyResult = { kind: string; pathname?: string; search?: string };
const proxy = load("../proxy.ts", {
  "next/server": { NextResponse: {
    next: () => ({ kind: "next" }),
    redirect: (url: URL) => ({ kind: "redirect", pathname: url.pathname, search: url.search }),
    json: (body: unknown, init: ResponseInit) => ({ kind: "json", body, status: init.status })
  } },
  "./lib/store-terminal-login-policy": load("./store-terminal-login-policy.ts", {}),
  "./lib/store-inventory-policy": policy,
  "./lib/role-permissions": permissions
}).default as (request: unknown) => Promise<ProxyResult>;

function employee(role: string) {
  return { id: uuid(1), sessionId: uuid(2), name: "Store Owner", loginId: "store-owner", role, sessionVersion: 1 };
}

function signed(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", environment.AUTH_SECRET).update(payload).digest("base64url")}`;
}

function proxyRequest(path: string, token?: string) {
  const nextUrl = new URL(`https://example.test${path}`) as URL & { clone: () => URL };
  nextUrl.clone = () => new URL(nextUrl.href);
  return { nextUrl, method: "GET", headers: new Headers(), cookies: { get: () => token ? { value: token } : undefined } };
}

test("signed franchise-owner sessions reach every Store workbench entry, including older inventory-only navigation grants", async () => {
  const paths = new Set([
    ...navigation.storeNavigationItems.map(item => item.href),
    "/store/kitchen", "/store/pickup-display", "/store/logout", "/store/settings/appearance"
  ]);
  for (const permittedNavPaths of [undefined, ["/store/inventory", "/store/replenishment", "/store/receiving"]]) {
    const token = auth.createSessionToken({ ...employee("store_owner"), permittedNavPaths });
    for (const path of paths) assert.equal((await proxy(proxyRequest(path, token))).kind, "next", path);
  }
});

test("store managers and staff retain the inventory-only personal Store boundary", async () => {
  for (const role of ["store_manager", "staff"]) {
    const token = auth.createSessionToken(employee(role));
    for (const path of ["/store/inventory", "/store/inventory/history", "/store/replenishment", "/store/receiving", "/store/logout"]) {
      assert.equal((await proxy(proxyRequest(path, token))).kind, "next", `${role}:${path}`);
    }
    for (const path of ["/store", "/store/pos", "/store/orders?pending=1", "/store/kitchen", "/store/display/pickup", "/store/menu", "/store/devices", "/store/procedures", "/store/inventory-other"]) {
      const result = await proxy(proxyRequest(path, token));
      assert.equal(result.kind, "redirect", `${role}:${path}`);
      assert.equal(result.pathname, "/store/inventory", `${role}:${path}`);
      assert.equal(result.search, "", `${role}:${path}`);
    }
  }
});

test("anonymous, expired and forged Store sessions still require login and preserve the requested destination", async () => {
  const valid = auth.createSessionToken(employee("store_owner"));
  const expired = signed({ ...employee("store_owner"), expiresAt: Date.now() - 1 });
  const forged = `${valid.split(".")[0]}.forged`;
  for (const token of [undefined, expired, forged]) {
    const result = await proxy(proxyRequest("/store/orders?pending=1", token));
    assert.equal(result.kind, "redirect");
    assert.equal(result.pathname, "/store/login");
    assert.equal(new URLSearchParams(result.search).get("next"), "/store/orders?pending=1");
  }
});

test("franchise owners see the complete Store navigation while inventory permission and restricted roles retain their limits", () => {
  const allPaths = navigation.storeNavigationItems.map(item => item.href);
  assert.deepEqual(Array.from(navigation.getVisibleStoreNavigation("store_owner", true), item => item.href), Array.from(allPaths));
  const inventoryPaths = ["/store/inventory", "/store/replenishment", "/store/receiving"];
  for (const role of ["store_manager", "staff"]) {
    assert.deepEqual(Array.from(navigation.getVisibleStoreNavigation(role, true), item => item.href), inventoryPaths);
    assert.equal(navigation.getVisibleStoreNavigation(role, false).length, 0);
  }
  const withoutInventory = navigation.getVisibleStoreNavigation("store_owner", false).map(item => item.href);
  assert.equal(withoutInventory.length, allPaths.length - inventoryPaths.length);
  for (const path of inventoryPaths) assert.equal(withoutInventory.includes(path as typeof allPaths[number]), false, path);
  assert.equal(navigation.getVisibleStoreNavigation(null, false).length, 0);
});

type Query = { text: string; values: unknown[] };
function scopeFixture(role: string | null = "store_owner") {
  const queries: Query[] = [];
  const person = employee(role ?? "store_owner");
  const sql = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join("?");
    queries.push({ text, values });
    if (text.includes("with active_session")) return [{ ...person }];
    if (text.includes("from employee_scopes")) return [{ storeId: uuid(3) }];
    if (text.includes("from stores")) {
      assert.match(text, /id::text = any/);
      assert.deepEqual(Array.from(values[0] as string[]), [uuid(3)]);
      return [{ id: uuid(3), name: "Own Store", businessHours: {} }];
    }
    throw new Error(`Unexpected scope query: ${text}`);
  };
  const apiAuth = load("./api-auth.ts", {
    "next/headers": { cookies: async () => ({ get: (key: string) => role && key === auth.authCookieName ? { value: auth.createSessionToken(person) } : undefined }) },
    "./auth": auth, "./db": { sql }
  }) as unknown as typeof import("./api-auth");
  const storeAccess = load("./store-order-access.ts", {
    "./api-auth": apiAuth, "./db": { sql }, "./role-permissions": { roleHasPermission: async () => false }
  }) as unknown as typeof import("./store-order-access");
  return { queries, person, apiAuth, storeAccess };
}

test("full Store workbench access does not grant headquarters OS rights or all-store scope", async () => {
  const fixture = scopeFixture();
  assert.equal(await fixture.apiAuth.requireMasterOsSession(), null);
  assert.equal(await fixture.apiAuth.requireOwnerOsSession(), null);
  const scope = await fixture.apiAuth.getSessionStoreScope(fixture.person);
  assert.equal(scope.allStores, false);
  assert.deepEqual(Array.from(scope.storeIds), [uuid(3)]);
  assert.equal(await fixture.apiAuth.canAccessStore(fixture.person, uuid(3)), true);
  assert.equal(await fixture.apiAuth.canAccessStore(fixture.person, uuid(4)), false);
  assert.equal(await fixture.apiAuth.canAccessStore(fixture.person), false);
  const access = await fixture.storeAccess.getStoreOrderAccess(fixture.person);
  assert.equal(access.allStores, false);
  assert.equal(access.canUseAllStoreView, false);
  assert.equal(fixture.storeAccess.getScopedStoreFilter(access, uuid(4)), "__forbidden__");
  assert.equal(fixture.storeAccess.getScopedStoreFilter(access, uuid(3)), uuid(3));
  const defaultPermissions = permissions.getDefaultPermissionsForRole("store_owner");
  assert.equal(defaultPermissions.has("module.pos"), true);
  for (const permission of ["module.settings", "module.masterData", "module.menu", "products.manage", "settings.managePermissions"]) {
    assert.equal(defaultPermissions.has(permission), false, permission);
  }
});

function deviceFixture(role: string | null = "store_owner") {
  const fixture = scopeFixture(role);
  const serviceCalls: string[] = [];
  const route = load("../app/api/store/devices/route.ts", {
    "../../../../lib/api-auth": fixture.apiAuth,
    "../../../../lib/store-order-access": fixture.storeAccess,
    "../../../../lib/store-inventory-policy": policy,
    "../../../../lib/store-devices": {
      StoreDeviceError: class extends Error { status = 503; },
      getStoreDevices: async (storeId: string) => { serviceCalls.push(`read:${storeId}`); return { devices: [] }; },
      requestStoreDeviceCommand: async (storeId: string) => { serviceCalls.push(`command:${storeId}`); return {}; },
      saveStoreDeviceOrder: async (storeId: string) => { serviceCalls.push(`order:${storeId}`); return {}; }
    }
  }) as unknown as {
    GET: (request: Request) => Promise<Response>;
    POST: (request: Request) => Promise<Response>;
    PATCH: (request: Request) => Promise<Response>;
  };
  return { ...fixture, serviceCalls, route };
}

test("franchise owners can read their own Store devices and cannot read or control another store", async () => {
  const fixture = deviceFixture();
  assert.equal((await fixture.route.GET(new Request(`https://example.test/api/store/devices?storeId=${uuid(3)}`))).status, 200);
  assert.deepEqual(fixture.serviceCalls, [`read:${uuid(3)}`]);
  assert.equal((await fixture.route.GET(new Request(`https://example.test/api/store/devices?storeId=${uuid(4)}`))).status, 403);
  assert.equal((await fixture.route.POST(new Request("https://example.test/api/store/devices", {
    method: "POST", body: JSON.stringify({ storeId: uuid(4), device: "a".repeat(24), requestId: uuid(5), action: "turnOn", confirmed: true })
  }))).status, 403);
  assert.equal((await fixture.route.PATCH(new Request("https://example.test/api/store/devices", {
    method: "PATCH", body: JSON.stringify({ storeId: uuid(4), order: [] })
  }))).status, 403);
  assert.deepEqual(fixture.serviceCalls, [`read:${uuid(3)}`]);
});

test("Store device API keeps anonymous and restricted personal roles out before accessing device services", async () => {
  for (const role of [null, "store_manager", "staff"]) {
    const fixture = deviceFixture(role);
    const response = await fixture.route.GET(new Request(`https://example.test/api/store/devices?storeId=${uuid(3)}`));
    assert.equal(response.status, role === null ? 401 : 403, String(role));
    assert.equal(fixture.serviceCalls.length, 0);
    assert.equal(fixture.queries.some(query => query.text.includes("from stores")), false);
  }
});

test("loaded Store timecard keeps full workbench roles in Store and redirects restricted personal roles", () => {
  const source = ts.transpileModule(readFileSync(new URL("../app/store/timecard/page.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  for (const [role, destination] of [
    ["store_owner", null], ["owner", null], ["manager", null], ["store_terminal", null],
    ["staff", "/staff/timecard"], ["store_manager", "/os/timecard"]
  ] as const) {
    const redirects: string[] = [];
    const effects: Array<{ callback: () => void; dependencies: unknown[] }> = [];
    const payload = {
      month: "2026-10", currentEmployeeId: uuid(1), currentEmployeeRole: role,
      stores: [{ id: uuid(3), name: "Own Store" }], selectedStoreId: uuid(3),
      latestPunch: null, latestPunches: [],
      employees: [{ id: uuid(7), name: "Store Staff", role: "staff", storeIds: [uuid(3)] }]
    };
    const states = [payload, uuid(3), uuid(7), false, "", "", null];
    let stateIndex = 0;
    const jsx = (type: unknown, props: unknown) => ({ type, props });
    const modules: Record<string, unknown> = {
      react: {
        useState: () => [states[stateIndex++], () => {}],
        useMemo: (calculate: () => unknown) => calculate(),
        useEffect: (callback: () => void, dependencies: unknown[]) => effects.push({ callback, dependencies })
      },
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "lucide-react": { Clock3: "Clock3", Coffee: "Coffee", LogIn: "LogIn", LogOut: "LogOut", RefreshCw: "RefreshCw" },
      "../components/StoreNavTabs": { StoreNavTabs: "StoreNavTabs" },
      "../components/store-selection": { getStoredStoreSelection: () => uuid(3), setStoredStoreSelection() {} },
      "../components/useVisibleRefresh": { useVisibleRefresh() {} },
      "../../../lib/timecard": { formatJstDateTime: () => "time", getJstMonthLabel: () => "2026-10" },
      "../../../components/timecard/FarewellDialog": { FarewellDialog: "FarewellDialog" },
      "../../../lib/store-inventory-policy": policy
    };
    const exports: { default?: () => unknown } = {};
    runInNewContext(source, {
      exports, window: { location: { replace: (path: string) => redirects.push(path) } },
      require: (name: string) => {
        if (!(name in modules)) throw new Error(`Unexpected timecard dependency: ${name}`);
        return modules[name];
      }
    });
    const tree = exports.default!();
    const roleEffects = effects.filter(effect => effect.dependencies.length === 1 && effect.dependencies[0] === role);
    assert.equal(roleEffects.length, 1, role);
    roleEffects[0].callback();
    assert.deepEqual(redirects, destination ? [destination] : [], role);
    function renderedText(value: unknown): string {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object") return "";
      if (Array.isArray(value)) return value.map(renderedText).join(" ");
      return renderedText((value as { props?: { children?: unknown } }).props?.children);
    }
    if (destination === null) {
      assert.ok(renderedText(tree).includes("店舗端末で打刻操作を選択してください"), role);
      assert.equal(renderedText(tree).includes("本日の打刻を開始できます"), false, role);
    }
  }
});
