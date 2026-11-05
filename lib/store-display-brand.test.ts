import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const storeId = "00000000-0000-4000-8000-000000000001";
function fixture(rows: Array<{ name: unknown }> = [], failure?: Error) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("./store-display-brand.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, {
    exports,
    require: (name: string) => {
      assert.equal(name, "./db");
      return { sql: async (parts: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: parts.join("?"), values });
        if (failure) throw failure;
        return rows;
      } };
    }
  });
  return { brand: exports as unknown as typeof import("./store-display-brand"), calls };
}
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("the known display identities retain their original logo assets and colors", () => {
  const { brand } = fixture();
  for (const name of ["まぁ麻", "maamaa", "  MaaMaa  "]) {
    assert.deepEqual(plain(brand.resolveStoreDisplayBrand([name])), {
      name: name.trim(), logoUrl: "/brands/maamaa-slogan-landscape.png", primaryColor: "#c30d23"
    });
  }
  assert.deepEqual(plain(brand.resolveStoreDisplayBrand([" Nanacha "])), {
    name: "Nanacha", logoUrl: "/brands/nanacha-logo.png", primaryColor: "#231916"
  });
});

test("missing, unknown and multiple brands never silently select an identity", () => {
  const { brand } = fixture();
  for (const names of [[], [""], ["unknown"], ["maamaa annex"], [null], [42],
    ["maamaa", "nanacha"], ["maamaa", "unknown"], ["maamaa", "まぁ麻"]]) {
    assert.equal(brand.resolveStoreDisplayBrand(names), null);
  }
});

test("the server reads only the requested store's active associations using a bounded parameterized query", async () => {
  const { brand, calls } = fixture([{ name: "まぁ麻" }]);
  assert.equal((await brand.getStoreDisplayBrand(` ${storeId} `))?.primaryColor, "#c30d23");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [storeId]);
  assert.equal(calls[0].text.includes(storeId), false);
  assert.match(calls[0].text, /from store_brands\s+join brands on brands\.id = store_brands\.brand_id/);
  assert.match(calls[0].text, /store_brands\.store_id::text = \?\s+and brands\.status = 'active'/);
  assert.match(calls[0].text, /limit 2/);
  assert.doesNotMatch(calls[0].text, /\b(?:insert|update|delete)\b/i);
});

test("the server does not discard unknown rows to invent a unique known brand", async () => {
  for (const rows of [[], [{ name: "unknown" }], [{ name: "maamaa" }, { name: "unknown" }],
    [{ name: "maamaa" }, { name: "nanacha" }]]) {
    assert.equal(await fixture(rows).brand.getStoreDisplayBrand(storeId), null);
  }
});

test("a blank store cannot trigger an unscoped brand read", async () => {
  const { brand, calls } = fixture([{ name: "nanacha" }]);
  assert.equal(await brand.getStoreDisplayBrand("  "), null);
  assert.equal(calls.length, 0);
});

test("database failures remain distinguishable from a store without a known brand", async () => {
  const failure = new Error("database unavailable");
  const { brand } = fixture([], failure);
  await assert.rejects(brand.getStoreDisplayBrand(storeId), error => error === failure);
});
