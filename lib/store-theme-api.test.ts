import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const storeId = "00000000-0000-4000-8000-000000000003";
class StoreThemeError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) { super(message); this.status = status; this.code = code; }
}
function fixture(options: { signedOut?: boolean; denied?: boolean; accessError?: StoreThemeError; conflict?: boolean; failure?: boolean } = {}) {
  let reads = 0, saves = 0;
  let savedInput: Record<string, unknown> | null = null;
  const selected: string[] = [];
  const readTargets: unknown[] = [];
  const accessOptions: Array<{freshPermissions?: boolean} | undefined> = [];
  const exports: Record<string, unknown> = {};
  const context = { storeId, storeName: "Store A", stores: [{id: storeId, name: "Store A"}], canManageTheme: !options.denied };
  const record = { theme: { primaryColor: "#245d49", mode:"custom", paletteVersion: 1 }, brand:null, revision: null, updatedAt: null };
  const modules: Record<string, unknown> = {
    "../../../../lib/api-auth": { requireOsSession: async () => options.signedOut ? null : ({ id: "actor", role: "owner" }) },
    "../../../../lib/store-theme": {
      normalizeStoreThemeColor: (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null,
      normalizeStoreThemeTarget: (value:unknown) => value === undefined ? "operations" : ["operations","pickup","customer","courier"].includes(String(value)) && typeof value === "string" ? value : null
    },
    "../../../../lib/store-theme-settings": {
      StoreThemeError,
      getStoreThemeAccess: async (_session: unknown, selectedStore: string, requestOptions?: {freshPermissions?: boolean}) => {
        selected.push(selectedStore);
        accessOptions.push(requestOptions);
        if (options.accessError) throw options.accessError;
        return context;
      },
      getStoreThemeSettings: async (_storeId:unknown,target:unknown) => { reads++;readTargets.push(target); return {...record,target}; },
      saveStoreThemeSettings: async (input: Record<string, unknown>) => {
        saves++; savedInput = input;
        if (options.failure) throw new Error("database error");
        return options.conflict ? null : { target:input.target,brand:null,theme: {primaryColor: input.primaryColor ?? "#c30d23", mode:input.mode,paletteVersion: 1}, revision: "new-revision", updatedAt: "2026-10-18T00:00:00.000Z" };
      }
    }
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/store/theme/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, Response, Request, URL, console: {error: () => {}}, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected theme API dependency: ${name}`);
    return modules[name];
  } });
  return { route: exports as unknown as typeof import("../app/api/store/theme/route"), selected, readTargets,accessOptions, reads: () => reads, saves: () => saves, savedInput: () => savedInput };
}
function post(body: unknown, origin: string | null = "https://example.test", secFetchSite = "same-origin") {
  return new Request("https://example.test/api/store/theme", { method: "POST", headers: {
    "content-type": "application/json", ...(origin ? {origin} : {}), "sec-fetch-site": secFetchSite
  }, body: JSON.stringify(body) });
}
const valid = { storeId, primaryColor: "#7A3399", expectedRevision: null };

test("theme reads require login, preserve explicit store selection, and are never cached", async () => {
  const out = fixture({ signedOut: true });
  assert.equal((await out.route.GET(new Request("https://example.test/api/store/theme"))).status, 401);
  assert.equal(out.reads(), 0);
  const f = fixture({ denied: true });
  const response = await f.route.GET(new Request(`https://example.test/api/store/theme?storeId=${storeId}`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal((await response.json()).canManageTheme, false);
  assert.deepEqual(f.selected, [storeId]);
  assert.equal(f.accessOptions[0], undefined);
  assert.equal(f.readTargets[0],"operations");
  await f.route.GET(new Request("https://example.test/api/store/theme"));
  assert.deepEqual(f.selected, [storeId, ""]);
});

test("same-origin proof is mandatory for theme writes and no access/save work happens on rejection", async () => {
  const f = fixture();
  for (const request of [post(valid, null), post(valid, "https://evil.test"), post(valid, "https://example.test", "cross-site")]) {
    const response = await f.route.POST(request);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "invalid_origin");
  }
  assert.equal(f.selected.length, 0);
  assert.equal(f.saves(), 0);
});

test("reads and writes echo an explicitly selected display target without defaulting an invalid target to operations", async () => {
  const f=fixture();
  for(const target of ["pickup","customer","courier"]) {
    const response=await f.route.GET(new Request(`https://example.test/api/store/theme?storeId=${storeId}&target=${target}`));
    assert.equal(response.status,200);
    assert.equal((await response.json()).target,target);
    assert.equal(f.readTargets.at(-1),target);
    const write=await f.route.POST(post({...valid,target,mode:"custom"}));
    assert.equal(write.status,200);
    assert.equal((await write.json()).target,target);
    assert.equal(f.savedInput()?.target,target);
  }
  const bad=fixture();
  for(const target of ["","unknown","Operations","store_theme","constructor","__proto__"]) {
    const read=await bad.route.GET(new Request(`https://example.test/api/store/theme?target=${encodeURIComponent(target)}`));
    assert.equal(read.status,400,target);
    assert.equal((await read.json()).code,"invalid_target",target);
  }
  for(const target of [null,"","unknown","constructor","__proto__",["pickup"],{},17]) {
    const write=await bad.route.POST(post({...valid,target,mode:"custom"}));
    assert.equal(write.status,400,JSON.stringify(target));
    assert.equal((await write.json()).code,"invalid_target",JSON.stringify(target));
  }
  assert.equal(bad.selected.length,0);
  assert.equal(bad.reads(),0);
  assert.equal(bad.saves(),0);
});

test("duplicate target query parameters are rejected before reading store access or a theme", async () => {
  const f=fixture();
  for(const query of ["target=pickup&target=operations","target=pickup&target=pickup","target=customer&%74arget=courier","target=&target=operations"]) {
    const response=await f.route.GET(new Request(`https://example.test/api/store/theme?${query}`));
    assert.equal(response.status,400,query);
    assert.equal((await response.json()).code,"invalid_target",query);
  }
  assert.equal(f.selected.length,0);
  assert.equal(f.reads(),0);
  assert.equal(f.saves(),0);
});

test("brand writes require explicit display mode, allow omitted color and never pass a submitted logo color to persistence", async () => {
  const f=fixture();
  for(const target of ["pickup","customer","courier"]) {
    const result=await f.route.POST(post({storeId,target,mode:"brand",expectedRevision:null}));
    assert.equal(result.status,200);
    assert.equal((await result.json()).theme.mode,"brand");
    assert.equal(f.savedInput()?.mode,"brand");
    assert.equal("primaryColor" in f.savedInput()!,false);
  }
  await f.route.POST(post({...valid,target:"pickup",mode:"brand"}));
  assert.equal("primaryColor" in f.savedInput()!,false);
  const bad=fixture();
  for(const input of [{...valid,mode:"brand"},{...valid,mode:"invalid"},{...valid,mode:null},{...valid,target:"pickup"},{...valid,target:"customer",mode:null},{...valid,target:"courier",mode:"invalid"}]) {
    const response=await bad.route.POST(post(input));
    assert.equal(response.status,400,JSON.stringify(input));
    assert.equal((await response.json()).code,"invalid_mode");
  }
  assert.equal(bad.selected.length,0);
  assert.equal(bad.saves(),0);
});

test("malformed colors, missing revisions and invalid bodies fail before any persistence", async () => {
  const f = fixture();
  for (const input of [null, [], "value", {...valid,storeId:""}, {...valid,primaryColor:"red"}, {...valid,primaryColor:"#fff"}, {...valid,expectedRevision:undefined}, {...valid,expectedRevision:17}, {...valid,expectedRevision:""}, {...valid,expectedRevision:"x".repeat(129)}]) {
    assert.equal((await f.route.POST(post(input))).status, 400, JSON.stringify(input));
  }
  assert.equal(f.saves(), 0);
});

test("unauthenticated, out-of-scope and unprivileged writes are denied without persistence", async () => {
  const cases = [
    { options: {signedOut:true}, code: "session_required", status: 401 },
    { options: {denied:true}, code: "theme_permission", status: 403 },
    { options: {accessError:new StoreThemeError("scope",403,"store_scope")}, code: "store_scope", status: 403 }
  ];
  for (const {options,code,status} of cases) {
    const f = fixture(options), response = await f.route.POST(post(valid));
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
    assert.equal(f.saves(), 0);
  }
});

test("authorized writes bind verified store and actor, canonicalize color and carry the revision", async () => {
  const f = fixture(), response = await f.route.POST(post({...valid,expectedRevision:"original-revision",actorId:"forged"}));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.theme.primaryColor, "#7a3399");
  assert.equal(body.revision, "new-revision");
  assert.equal(body.storeId, storeId);
  assert.equal(f.savedInput()?.actorId, "actor");
  assert.equal(f.savedInput()?.storeId, storeId);
  assert.equal(f.savedInput()?.expectedRevision, "original-revision");
  assert.equal(f.savedInput()?.target,"operations");
  assert.equal(f.savedInput()?.mode,"custom");
  assert.equal(f.accessOptions[0]?.freshPermissions, true);
  assert.equal(f.saves(), 1);
});

test("conflicts return 409 with no retry, and database errors cannot appear as saved", async () => {
  const conflict = fixture({ conflict: true });
  const conflictResponse = await conflict.route.POST(post(valid));
  assert.equal(conflictResponse.status, 409);
  assert.equal((await conflictResponse.json()).code, "theme_conflict");
  assert.equal(conflict.saves(), 1);
  const failure = fixture({ failure: true });
  assert.equal((await failure.route.POST(post(valid))).status, 500);
  assert.equal(failure.saves(), 1);
});
