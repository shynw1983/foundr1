const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { APPS, generateAppVersions } = require("../app-web-versions.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundr1-app-versions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, value) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
  put("package.json", '{"dependencies":{"next":"16"}}');
  put("tsconfig.json", '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["./*"]}}}');
  put("app/layout.tsx", 'import "./globals.css";import "../components/common";export default function Layout(){return null}');
  put("app/globals.css", ":root{color:black}");
  put("components/common.ts", 'import "../lib/shared"; export const routes=["/api/shared","/icons/foundr1-os-192.png","/icons/foundr1-store-192.png"];');
  put("lib/shared.ts", "export const shared = 1;");
  put("app/api/shared/route.ts", "export const GET = () => 1;");
  for (const app of APPS.filter((app) => app !== "studio")) put(`app/${app}/page.tsx`, `export default function ${app}(){return null}`);
  put("PhotoStudio/src/main.tsx", "export const studio = 1;");
  put("app/api/studio/cutout/route.ts", "export const POST = () => 1;");
  put("PhotoStudio/package.json", '{"version":"1.0.0"}');
  put("public/icons/foundr1-os-192.png", "os-icon");
  put("public/icons/foundr1-store-192.png", "store-icon");
  const run = (write = false) => generateAppVersions(root, { write });
  const changed = (before, after) => APPS.filter((app) => before.manifest.versions[app] !== after.manifest.versions[app]);
  return { root, put, run, changed };
}

test("each app's own source changes only that application's release", (t) => {
  const f = fixture(t);
  for (const app of APPS) {
    const before = f.run();
    f.put(app === "studio" ? "PhotoStudio/src/main.tsx" : `app/${app}/page.tsx`, `export const changed${app}=2;`);
    assert.deepEqual(f.changed(before, f.run()), [app]);
  }
});

test("shared imported code and API changes reach actual consumers, not Studio", (t) => {
  const f = fixture(t);
  let before = f.run();
  f.put("lib/shared.ts", "export const shared=2;");
  assert.deepEqual(f.changed(before, f.run()), ["os", "store", "staff", "member"]);
  before = f.run();
  f.put("app/api/shared/route.ts", "export const GET=()=>2;");
  assert.deepEqual(f.changed(before, f.run()), ["os", "store", "staff", "member"]);
});

test("API dependencies follow cross-prefix consumers and transitive imports", (t) => {
  const f = fixture(t);
  f.put("app/store/page.tsx", 'fetch("/api/os/pos/settings");');
  f.put("app/api/os/pos/settings/route.ts", 'import "../../../../../lib/pos";export const GET=()=>1;');
  f.put("lib/pos.ts", "export const version=1;");
  const before = f.run();
  f.put("lib/pos.ts", "export const version=2;");
  assert.deepEqual(f.changed(before, f.run()), ["store"]);
});

test("dynamic API prefixes include matching parameter routes, new endpoints and nested suffixes", (t) => {
  const f = fixture(t);
  f.put("app/staff/page.tsx", 'fetch(`/api/staff/${id}/lifecycle/documents`);');
  f.put("app/api/staff/[id]/lifecycle/documents/route.ts", "export const GET=()=>1;");
  let before = f.run();
  f.put("app/api/staff/[id]/lifecycle/documents/route.ts", "export const GET=()=>2;");
  assert.deepEqual(f.changed(before, f.run()), ["staff"]);
  before = f.run();
  f.put("app/api/staff/[id]/lifecycle/ack/route.ts", "export const POST=()=>1;");
  assert.deepEqual(f.changed(before, f.run()), ["staff"]);
});

test("root styling and framework inputs update consumers; APK and deployment metadata do not", (t) => {
  const f = fixture(t);
  let before = f.run();
  f.put("app/globals.css", ":root{color:green}");
  assert.deepEqual(f.changed(before, f.run()), ["os", "store", "staff", "member"]);
  before = f.run();
  f.put("package.json", '{"dependencies":{"next":"17"}}');
  assert.deepEqual(f.changed(before, f.run()), APPS);
  before = f.run();
  f.put("public/downloads/studio/version.json", '{"versionCode":100}');
  f.put("public/downloads/store/test.apk", "different APK bytes");
  f.put(".vercel/project.json", '{"id":"new-deployment"}');
  const saved = process.env.VERCEL_DEPLOYMENT_ID;
  try { process.env.VERCEL_DEPLOYMENT_ID = "new"; assert.deepEqual(f.changed(before, f.run()), []); }
  finally { if (saved === undefined) delete process.env.VERCEL_DEPLOYMENT_ID; else process.env.VERCEL_DEPLOYMENT_ID = saved; }
});

test("identity assets only update their selected application", (t) => {
  const f = fixture(t);
  const before = f.run();
  f.put("public/icons/foundr1-os-192.png", "changed OS icon");
  assert.deepEqual(f.changed(before, f.run()), ["os"]);
});

test("new files, renamed files and deletions change their scope; test files are excluded", (t) => {
  const f = fixture(t);
  let before = f.run();
  f.put("app/store/new/page.tsx", "export default function New(){return null}");
  assert.deepEqual(f.changed(before, f.run()), ["store"]);
  before = f.run();
  fs.renameSync(path.join(f.root, "app/store/new"), path.join(f.root, "app/store/moved"));
  assert.deepEqual(f.changed(before, f.run()), ["store"]);
  before = f.run();
  fs.rmSync(path.join(f.root, "app/store/moved"), { recursive: true });
  assert.deepEqual(f.changed(before, f.run()), ["store"]);
  before = f.run();
  f.put("app/store/page.test.tsx", "a new test");
  assert.deepEqual(f.changed(before, f.run()), []);
});

test("dynamic imports, aliases, CSS imports and JSON references contribute to closure", (t) => {
  const f = fixture(t);
  f.put("app/store/page.tsx", 'import("@/components/store-lazy");');
  f.put("components/store-lazy.tsx", 'import "./store.css";import config from "./store.json";');
  f.put("components/store.css", '@import "./base.css";');
  f.put("components/base.css", ":root{color:black}");
  f.put("components/store.json", '{"photo":"/assets/item.png"}');
  f.put("public/assets/item.png", "original");
  let before = f.run();
  f.put("components/base.css", ":root{color:red}");
  assert.deepEqual(f.changed(before, f.run()), ["store"]);
  before = f.run();
  f.put("public/assets/item.png", "changed");
  assert.deepEqual(f.changed(before, f.run()), ["store"]);
});

test("repeated generation and generated-map imports do not self-invalidate", (t) => {
  const f = fixture(t);
  f.put("lib/app-version.ts", 'import versions from "./generated/app-web-versions.json";export {versions};');
  f.put("components/common.ts", 'import "../lib/app-version";');
  const before = f.run(true);
  const after = f.run(true);
  assert.deepEqual(before.manifest, after.manifest);
  assert.deepEqual(f.changed(before, after), []);
});

test("missing local imports and unbounded dynamic API references fail explicitly", (t) => {
  const f = fixture(t);
  f.put("app/store/page.tsx", 'import "../../missing";');
  assert.throws(() => f.run(), /Unresolved local import/);
  f.put("app/store/page.tsx", 'fetch(`/api/${unbounded}`);');
  assert.throws(() => f.run(), /Unbounded dynamic API prefix/);
  f.put("app/store/page.tsx", 'fetch("/api/not-implemented");');
  assert.throws(() => f.run(), /Unresolved API dependency/);
});

test("middleware matchers are patterns and the sole optional 404 probe resolves when its route appears", (t) => {
  const f = fixture(t);
  f.put("proxy.ts", 'export const config={matcher:["/api/:path*"]};');
  f.put("app/store/components/StoreNavTabs.tsx", 'fetch("/api/sns");');
  f.put("app/store/page.tsx", 'import "./components/StoreNavTabs";');
  let before=f.run();
  assert.equal(before.warnings.length,1);
  assert.match(before.warnings[0],/optional missing feature probe/);
  f.put("app/api/sns/route.ts", "export const GET=()=>1;");
  assert.deepEqual(f.changed(before,f.run()),["store"]);
  assert.deepEqual(f.run().warnings,[]);
});

test("dynamic execute endpoint includes its parameter handler and imported policy", (t) => {
  const f = fixture(t);
  f.put("app/store/page.tsx", 'fetch(`/api/os/inventory-items/${id}/execute`);');
  f.put("app/api/os/inventory-items/[id]/execute/route.ts", 'import "../../../../../../lib/execute";export const POST=()=>1;');
  f.put("lib/execute.ts", "export const policy=1;");
  const before=f.run();
  f.put("lib/execute.ts", "export const policy=2;");
  assert.deepEqual(f.changed(before,f.run()),["store"]);
});

test("standalone Studio assets resolve from its own public directory, including relative font URLs", (t) => {
  const f=fixture(t);
  f.put("PhotoStudio/src/main.tsx", 'const font=new URL(`./fonts/sns/${version}/${id}/400.ttf`,document.baseURI);const photo="/photos/item.png";');
  f.put("PhotoStudio/public/fonts/sns/v1/font/400.ttf", "font-original");
  f.put("PhotoStudio/public/photos/item.png", "studio-photo");
  f.put("public/photos/item.png", "root-photo");
  let before=f.run();
  f.put("public/photos/item.png", "changed root photo");
  assert.deepEqual(f.changed(before,f.run()),[]);
  before=f.run();
  f.put("PhotoStudio/public/fonts/sns/v1/font/400.ttf", "font-new");
  assert.deepEqual(f.changed(before,f.run()),["studio"]);
  before=f.run();
  f.put("PhotoStudio/public/photos/item.png", "new studio photo");
  assert.deepEqual(f.changed(before,f.run()),["studio"]);
});

test("optional catch-all API handlers cover both their root and nested requests", (t) => {
  const f=fixture(t);
  f.put("app/store/page.tsx", 'fetch("/api/optional");fetch("/api/optional/a/b");');
  f.put("app/api/optional/[[...slug]]/route.ts", "export const GET=()=>1;");
  const before=f.run();
  f.put("app/api/optional/[[...slug]]/route.ts", "export const GET=()=>2;");
  assert.deepEqual(f.changed(before,f.run()),["store"]);
});

test("unreferenced application and Studio drafts are excluded, including unresolved imports", (t) => {
  const f=fixture(t);
  const before=f.run();
  f.put("app/os/stores/alerts/HqAlertConsole.tsx", 'import "../../../../missing-policy";');
  f.put("app/store/components/Draft.tsx", 'fetch("/api/not-created");');
  f.put("PhotoStudio/src/components/Draft.tsx", 'import "../../missing-policy";');
  f.put("app/api/studio/unreferenced-handler.ts", 'import "../../missing-policy";');
  assert.deepEqual(f.changed(before,f.run()),[]);
  f.put("app/store/page.tsx", 'import "./components/Draft";');
  assert.throws(()=>f.run(),/Unresolved API dependency/);
});

test("Next metadata entries are roots and private folders are not routes", (t) => {
  const f=fixture(t);
  let before=f.run();
  f.put("app/store/opengraph-image.tsx", "export default function Image(){return null}");
  assert.deepEqual(f.changed(before,f.run()),["store"]);
  before=f.run();
  f.put("app/store/_private/page.tsx", 'import "../../missing-policy";');
  assert.deepEqual(f.changed(before,f.run()),[]);
});

test("runtime JS and its declaration sidecar both enter an API consumer's dependency closure", (t) => {
  const f=fixture(t);
  f.put("app/store/page.tsx", 'fetch("/api/store/authority");');
  for(const [extension,declaration] of [["mjs","d.mts"],["cjs","d.cts"],["js","d.ts"]]) {
    const runtime=`desktop-bridge/src/policy.${extension}`,sidecar=`desktop-bridge/src/policy.${declaration}`;
    f.put("app/api/store/authority/route.ts", `import {policy} from "../../../../${runtime}";export const GET=()=>policy;`);
    f.put(runtime, "export const policy=1;");
    f.put(sidecar, "export declare const policy:number;");
    let before=f.run();
    assert.ok(before.inputs.store.includes(runtime));
    assert.ok(before.inputs.store.includes(sidecar));
    f.put(runtime, "export const policy=2;");
    assert.deepEqual(f.changed(before,f.run()),["store"]);
    before=f.run();
    f.put(sidecar, "export declare const policy:1|2;");
    assert.deepEqual(f.changed(before,f.run()),["store"]);
  }
});

test("only verified Rocket module prefixes use the merchant origin; runtime and true local APIs remain tracked", (t) => {
  const f=fixture(t);
  f.put("app/store/page.tsx", 'import "../../desktop-bridge/src/rocket-menu-client.mjs";');
  const external='export const readBase=`/api/v1/merchant/web/stores/${id}`;export const writeBase=`/api/v1/merchant/web/catalog/stores/${id}`;';
  f.put("desktop-bridge/src/rocket-menu-client.mjs", external+'fetch("/api/local-merchant-link");');
  f.put("app/api/local-merchant-link/route.ts", "export const GET=()=>1;");
  let before=f.run();
  assert.ok(before.inputs.store.includes("desktop-bridge/src/rocket-menu-client.mjs"));
  assert.ok(before.inputs.store.includes("app/api/local-merchant-link/route.ts"));
  f.put("desktop-bridge/src/rocket-menu-client.mjs", external+'fetch("/api/local-merchant-link");export const changed=1;');
  assert.deepEqual(f.changed(before,f.run()),["store"]);
  before=f.run();
  f.put("app/api/local-merchant-link/route.ts", "export const GET=()=>2;");
  assert.deepEqual(f.changed(before,f.run()),["store"]);
  f.put("desktop-bridge/src/rocket-menu-client.mjs", external+'fetch("/api/not-a-local-handler");');
  assert.throws(()=>f.run(),/Unresolved API dependency/);
  f.put("desktop-bridge/src/rocket-menu-client.mjs", external);
  f.put("app/store/page.tsx", 'const other=`/api/v1/merchant/web/stores/${id}`;');
  assert.throws(()=>f.run(),/Unresolved API dependency/);
});

test("build-time fingerprint policy strings are inputs rather than local HTTP dependencies", (t) => {
  const f=fixture(t);
  f.put("scripts/app-web-versions.cjs", 'const policy=["/api/nonlocal-prefix/"];');
  const before=f.run();
  f.put("scripts/app-web-versions.cjs", 'const policy=["/api/nonlocal-prefix/","/api/another-prefix/"];');
  assert.deepEqual(f.changed(before,f.run()),APPS);
});

test("nested API suffixes and absolute-link normalization never fingerprint the public root", (t) => {
  const f=fixture(t);
  f.put("app/store/page.tsx", 'import "../../lib/links";const base="/api/store/templates";fetch(`${base}${update?`/${id}`:""}`);');
  f.put("app/os/page.tsx", 'import "../../lib/links";const base="/api/store/templates";fetch(`${base}${update?`/${id}`:""}`);const font=`/fonts/${name}.woff2`;const icon=`/icons/${id}.png`;');
  f.put("lib/links.ts", 'export function absolute(href:string){return href.startsWith("/")?href:`/${href}`;}');
  f.put("app/api/store/templates/route.ts", "export const GET=()=>1;");
  f.put("public/fonts/real.woff2", "font-v1");
  f.put("public/icons/foundr1-os-192.png", "os-v1");
  f.put("public/icons/foundr1-store-192.png", "store-v1");
  f.put("public/icons/foundr1-member-192.png", "member-v1");
  f.put("public/manifest-member.webmanifest", '{"name":"Member"}');
  let before=f.run();
  for(const app of APPS) assert.ok(before.inputs[app].every(file=>!file.includes("//")));
  const stable=()=>{
    const after=f.run();
    assert.equal(after.manifest.versions.os,before.manifest.versions.os);
    assert.equal(after.manifest.versions.store,before.manifest.versions.store);
    for(const app of APPS) assert.ok(after.inputs[app].every(file=>!file.includes("//")));
    before=after;
  };
  f.put("public/downloads/studio/version.json", '{"versionCode":200}');stable();
  f.put("public/downloads/studio/version.json", '{"versionCode":201}');stable();
  f.put("public/downloads/studio/app.apk", "downloaded APK");stable();
  f.put("public/icons/installer.apk", "APK beside referenced icons");stable();
  f.put("public/icons/installer.AAB", "AAB beside referenced icons");stable();
  f.put("public/fonts/installer.ipa", "IPA beside referenced fonts");stable();
  f.put("public/icons/foundr1-member-192.png", "member-v2");stable();
  f.put("public/manifest-member.webmanifest", '{"name":"Member 2"}');stable();
  f.put("public/.well-known/workflow/v1/manifest.json", '{"generated":"cloud"}');stable();
  f.put("public/fonts/real.woff2", "font-v2");
  assert.deepEqual(f.changed(before,f.run()),["os"]);
});

test("finite Studio asset prefixes canonicalize trailing slashes and exclude installers", (t) => {
  const f=fixture(t);
  f.put("PhotoStudio/src/main.tsx", 'const font=`./fonts/sns//${id}/400.ttf`;const link=`/${href}`;');
  f.put("PhotoStudio/public/fonts/sns/font/400.ttf", "font-v1");
  let before=f.run();
  assert.ok(before.inputs.studio.includes("PhotoStudio/public/fonts/sns/font/400.ttf"));
  assert.ok(before.inputs.studio.every(file=>!file.includes("//")));
  f.put("PhotoStudio/public/fonts/sns/installer.apk", "APK-v1");
  f.put("PhotoStudio/public/downloads/version.json", '{"version":100}');
  f.put("PhotoStudio/public/.well-known/generated.json", '{"cloud":true}');
  assert.deepEqual(f.changed(before,f.run()),[]);
  before=f.run();
  f.put("PhotoStudio/public/fonts/sns/font/400.ttf", "font-v2");
  assert.deepEqual(f.changed(before,f.run()),["studio"]);
});

test("a navigation path matching a public folder does not consume the folder's assets", (t) => {
  const f=fixture(t);
  f.put("components/common.ts", 'export const navigation="/store";');
  f.put("public/store/floor.svg", "floor-v1");
  let before=f.run();
  f.put("public/store/floor.svg", "floor-v2");
  assert.deepEqual(f.changed(before,f.run()),[]);
  f.put("app/store/page.tsx", 'const image="/store/floor.svg";');
  before=f.run();
  f.put("public/store/floor.svg", "floor-v3");
  assert.deepEqual(f.changed(before,f.run()),["store"]);
});
