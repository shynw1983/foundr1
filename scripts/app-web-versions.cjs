/* Build-time application release fingerprints. No environment values or deployment IDs. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ts = require("typescript");

const APPS = ["os", "store", "staff", "member", "studio"];
const OUTPUT = "lib/generated/app-web-versions.json";
const SKIP = /(?:^|\/)(?:node_modules|\.git|\.next[^/]*|build|dist|outputs?|tests?|__tests__|\.gradle)(?:\/|$)|\.(?:test|spec)\.[^/]+$/;
const SHARED_INPUTS = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "proxy.ts", "middleware.ts", "instrumentation.ts", "instrumentation-client.ts", "public/sw.js", "scripts/app-web-versions.cjs"];
// This existing optional feature-detection probe intentionally tolerates 404.
// If its route is added later it is resolved normally before this exception is considered.
const OPTIONAL_MISSING_API_PROBES = new Set(["app/store/components/StoreNavTabs.tsx:/api/sns"]);
// RocketMenuClient passes these relative paths to the merchant browser transport.
// connectMerchantMenuClient / executeMenuRequest verify the browser origin, and
// Rocket requests run at https://store.rocketnow.co.jp, never this app's origin.
// Keep this file+prefix binding finite: other URLs in this module still resolve
// as Foundr1 APIs (and fail explicitly if an actual local handler is missing).
const EXTERNAL_ORIGIN_API_PREFIXES = {
  "desktop-bridge/src/rocket-menu-client.mjs": [
    "/api/v1/merchant/web/stores/",
    "/api/v1/merchant/web/catalog/stores/"
  ]
};

function slash(value) { return value.split(path.sep).join("/"); }
function canonicalPath(value) { return path.posix.normalize(slash(value)).replace(/\/+$/, ""); }
function isReleaseAsset(file) {
  return !/^(?:PhotoStudio\/)?public\/downloads(?:\/|$)/.test(file)
    && !/\.(?:apk|aab|ipa)$/i.test(file);
}

function isNextEntry(file) {
  // Co-located components are dependencies only when a real route imports them.
  // In particular an unfinished, unreferenced editor draft cannot change a release.
  if (file.split("/").some((segment) => segment.startsWith("_"))) return false;
  const name = path.posix.basename(file);
  return /^(?:page|layout|template|loading|error|global-error|not-found|default|route)\.[cm]?[jt]sx?$/.test(name)
    || /^(?:robots|sitemap|manifest|opengraph-image\d*|twitter-image\d*|icon\d*|apple-icon\d*)\.(?:[cm]?[jt]sx?|xml|txt|json|webmanifest|png|jpe?g|svg|gif|ico)$/.test(name)
    || name === "favicon.ico";
}

function createGraph(root) {
  const sourceCache = new Map();
  const dependencyCache = new Map();
  const warnings = new Set();
  const exists = (file) => { try { return fs.statSync(path.join(root, file)).isFile(); } catch { return false; } };
  const isDirectory = (file) => { try { return fs.statSync(path.join(root, file)).isDirectory(); } catch { return false; } };
  function list(directory, accept = () => true) {
    const result = [];
    function visit(relative) {
      if (SKIP.test(relative)) return;
      let stat;
      try { stat = fs.lstatSync(path.join(root, relative)); } catch { return; }
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(path.join(root, relative)).sort()) visit(relative ? `${relative}/${name}` : name);
      } else if (accept(relative)) result.push(relative);
    }
    visit(canonicalPath(directory));
    return result;
  }
  const apiRoutes = list("app/api", (file) => /\/route\.[cm]?[jt]s$/.test(file)).map((file) => {
    const route = "/" + file.replace(/^app\//, "").replace(/\/route\.[cm]?[jt]s$/, "").split("/").filter((part) => !/^\(.+\)$/.test(part)).join("/");
    const expression = new RegExp("^" + route.split("/").filter(Boolean).map((part) => /^\[\[\.\.\./.test(part) ? "(?:/.*)?" : /^\[\.\.\./.test(part) ? "/.+" : /^\[/.test(part) ? "/[^/]+" : "/" + part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("") + "/?$");
    return { file, route, expression };
  });
  let compilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true, allowJs: true, baseUrl: root };
  if (exists("tsconfig.json")) {
    const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
    if (config.error) throw new Error("Cannot read tsconfig for app release fingerprints");
    compilerOptions = { ...compilerOptions, ...ts.convertCompilerOptionsFromJson(config.config.compilerOptions || {}, root).options };
  }
  function source(file) {
    if (!sourceCache.has(file)) sourceCache.set(file, fs.readFileSync(path.join(root, file)));
    return sourceCache.get(file);
  }
  function resolveImport(from, specifier) {
    if (!(specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("~/"))) return null;
    const base = specifier.startsWith(".") ? path.posix.join(path.posix.dirname(from), specifier) : specifier.replace(/^[@~]\//, "");
    // TS resolves explicit JS imports to a declaration sidecar when one exists.
    // The deployed executable is still the JS file and must be copied/hashed.
    if (/\.(?:[cm]?js|json|css)$/.test(base) && exists(base)) return base;
    const resolved = ts.resolveModuleName(specifier, path.join(root, from), compilerOptions, ts.sys).resolvedModule;
    if (resolved) {
      const relative = slash(path.relative(root, resolved.resolvedFileName));
      if (!relative.startsWith("../") && !relative.includes("node_modules/")) {
        const runtime = relative.replace(/\.d\.mts$/, ".mjs").replace(/\.d\.cts$/, ".cjs").replace(/\.d\.ts$/, ".js");
        return runtime !== relative && exists(runtime) ? runtime : relative;
      }
    }
    for (const candidate of [base, ...[".ts", ".tsx", ".js", ".jsx", ".json", ".css", "/index.ts", "/index.tsx"].map((suffix) => base + suffix)]) if (exists(candidate)) return candidate;
    if (base === OUTPUT) return OUTPUT;
    throw new Error(`Unresolved local import in release fingerprint: ${from} -> ${specifier}`);
  }
  function urlDependencies(value, dynamic, from) {
    const studioAsset = from.startsWith("PhotoStudio/") && value.startsWith("./");
    if ((!value.startsWith("/") && !studioAsset) || value.startsWith("//")) return [];
    const endpoint = value.split(/[?#]/, 1)[0];
    const queryIsComplete = /[?#]/.test(value);
    if (endpoint === "/api" || endpoint === "/api/") {
      if (dynamic) throw new Error(`Unbounded dynamic API prefix in ${from}: add an explicit finite endpoint binding`);
      return [];
    }
    if (endpoint.startsWith("/api/")) {
      if (EXTERNAL_ORIGIN_API_PREFIXES[from]?.some((prefix) => endpoint.startsWith(prefix))) return [];
      // Next middleware matchers describe path patterns, not network dependencies.
      if ((from === "proxy.ts" || from === "middleware.ts") && /[:*]/.test(endpoint)) return [];
      const prefix = dynamic && !queryIsComplete;
      const routes = apiRoutes.filter(({ route, expression }) => expression.test(endpoint) || (prefix && (route.startsWith(endpoint) || endpoint.startsWith(route.replace(/\/.?\[.*$/, "/"))))).map(({ file }) => file);
      if (!routes.length) {
        if (OPTIONAL_MISSING_API_PROBES.has(`${from}:${endpoint}`)) warnings.add(`${from}: optional missing feature probe ${endpoint}`);
        else throw new Error(`Unresolved API dependency in ${from}: ${endpoint}${dynamic ? "…" : ""}; add the route or an explicit finite binding`);
      }
      return routes;
    }
    if (/^\/downloads(?:\/|$)/.test(endpoint)) return [];
    const assetRoot = from.startsWith("PhotoStudio/") ? "PhotoStudio/public" : "public";
    const asset = canonicalPath(`${assetRoot}/${endpoint.replace(/^(?:\.\/|\/)/, "")}`);
    // '/${id}' is often an API suffix or a hyperlink, not a reference to every
    // public file. Never expand an unbounded prefix or escape the public root.
    if (asset === assetRoot || !asset.startsWith(`${assetRoot}/`) || !isReleaseAsset(asset)) return [];
    if (exists(asset)) return [asset];
    if (dynamic && !queryIsComplete) {
      if (isDirectory(asset)) return list(asset, isReleaseAsset);
      const folder = canonicalPath(path.posix.dirname(asset));
      if (folder !== assetRoot) return list(folder, (file) => file.startsWith(asset) && isReleaseAsset(file));
    }
    return [];
  }
  function dependencies(file) {
    if (dependencyCache.has(file)) return dependencyCache.get(file);
    const result = new Set();
    dependencyCache.set(file, result);
    // This build-time policy is an input itself, not a network consumer of its
    // example/prefix strings. Its complete bytes are still included in every hash.
    if (file === "scripts/app-web-versions.cjs") return result;
    if (/\.[cm]?js$/.test(file)) {
      const sidecar = file.replace(/\.mjs$/, ".d.mts").replace(/\.cjs$/, ".d.cts").replace(/(?<!\.d)\.js$/, ".d.ts");
      if (sidecar !== file && exists(sidecar)) result.add(sidecar);
    }
    if (!/\.(?:[cm]?[jt]sx?|css|html|json|webmanifest)$/.test(file)) return result;
    const text = source(file).toString("utf8");
    const addImport = (specifier) => { const target = resolveImport(file, specifier); if (target) result.add(target); };
    if (/\.(?:json|webmanifest)$/.test(file)) {
      const visitValue = (value) => {
        if (typeof value === "string") for (const target of urlDependencies(value, false, file)) result.add(target);
        else if (Array.isArray(value)) value.forEach(visitValue);
        else if (value && typeof value === "object") Object.values(value).forEach(visitValue);
      };
      visitValue(JSON.parse(text));
      return result;
    }
    if (/\.(?:css|html)$/.test(file)) {
      for (const match of text.matchAll(/(?:@import\s+["']|url\(\s*["']?)([^"')\s;]+)/g)) {
        if (match[1].startsWith(".")) addImport(match[1]);
        else for (const target of urlDependencies(match[1], false, file)) result.add(target);
      }
      return result;
    }
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) addImport(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) addImport(node.arguments[0].text);
      if (ts.isStringLiteralLike(node)) for (const target of urlDependencies(node.text, false, file)) result.add(target);
      if (ts.isTemplateExpression(node)) for (const target of urlDependencies(node.head.text, true, file)) result.add(target);
      ts.forEachChild(node, visit);
    }
    visit(tree);
    return result;
  }
  function fingerprint(app) {
    const initial = [...SHARED_INPUTS.filter(exists)];
    if (app === "studio") {
      initial.push(...["PhotoStudio/src/main.tsx", "PhotoStudio/package.json", "PhotoStudio/package-lock.json", "PhotoStudio/tsconfig.json", "PhotoStudio/index.html", "PhotoStudio/scripts/build.mjs"].filter(exists), ...list("app/api/studio", isNextEntry));
    } else {
      initial.push(...list(`app/${app}`, isNextEntry));
      if (fs.existsSync(path.join(root, "app"))) for (const name of fs.readdirSync(path.join(root, "app"))) {
        const file = `app/${name}`;
        if (exists(file) && isNextEntry(file)) initial.push(file);
      }
      if (exists(`public/manifest-${app}.webmanifest`)) initial.push(`public/manifest-${app}.webmanifest`);
    }
    const files = new Set();
    const queue = initial;
    while (queue.length) {
      const file = canonicalPath(queue.pop());
      if (file === OUTPUT || files.has(file) || SKIP.test(file)) continue;
      if (/^(?:PhotoStudio\/)?public\//.test(file) && !isReleaseAsset(file)) continue;
      // Root metadata/PwaRegister list all app identities but select just one at runtime.
      const identityAsset = file.match(/^(?:PhotoStudio\/)?public\/(?:manifest-(os|store|staff|member)\.webmanifest|icons\/foundr1-(os|store|staff|member)-)/);
      if (identityAsset && (identityAsset[1] || identityAsset[2]) !== app) continue;
      if (!exists(file)) throw new Error(`Missing release fingerprint dependency ${file}`);
      files.add(file);
      for (const dependency of dependencies(file)) queue.push(dependency);
    }
    const hash = crypto.createHash("sha256");
    hash.update(`foundr1-app-web-version-v1\0${app}\0`);
    for (const file of Array.from(files).sort()) {
      const bytes = source(file);
      hash.update(`${file.length}:${file}:${bytes.length}:`); hash.update(bytes);
    }
    return { version: hash.digest("hex"), files: Array.from(files).sort() };
  }
  return { fingerprint, warnings };
}

function generateAppVersions(root = process.cwd(), options = {}) {
  root = path.resolve(root);
  const graph = createGraph(root);
  const versions = {};
  const inputs = {};
  for (const app of APPS) { const result = graph.fingerprint(app); versions[app] = result.version; inputs[app] = result.files; }
  const manifest = { schema: 1, versions };
  if (options.write !== false) {
    const destination = path.join(root, OUTPUT);
    const bytes = JSON.stringify(manifest, null, 2) + "\n";
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination) || fs.readFileSync(destination, "utf8") !== bytes) {
      const temporary = `${destination}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, destination);
    }
  }
  return { manifest, inputs, warnings: Array.from(graph.warnings).sort() };
}

module.exports = { APPS, OUTPUT, generateAppVersions };
if (require.main === module) {
  const result = generateAppVersions(process.argv[2] || process.cwd());
  console.log(JSON.stringify({ versions: result.manifest.versions, counts: Object.fromEntries(APPS.map((app) => [app, result.inputs[app].length])), warnings: result.warnings }, null, 2));
}
