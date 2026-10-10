import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import * as units from "./product-unit-conversions.ts";
const policy:Record<string,any>={};
runInNewContext(ts.transpileModule(readFileSync(new URL("./product-packaging-policy.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports:policy,require:(name:string)=>{if(name==="./product-unit-conversions")return units;throw Error(name);}});
const pack={purchaseUnit:"袋",contentQuantity:800,contentUnit:"g",countUnit:"g",stockQuantityPerPurchase:800};
test("batch packaging records actual edible content without a product master or freight weight",()=>{
 assert.equal(policy.normalizeProductBatchPackaging(pack).stockQuantityPerPurchase,800);
 assert.equal(policy.productBatchPackagingEquals(pack,{...pack,templateId:"00000000-0000-4000-8000-000000000001"}),true);
 assert.equal(policy.productBatchPackagingEquals(pack,{...pack,contentQuantity:1000,stockQuantityPerPurchase:1000}),false);
});
test("invalid or internally conflicting packaging cannot silently reinterpret quantity",()=>{
 for(const bad of [{...pack,contentQuantity:0},{...pack,stockQuantityPerPurchase:1000},{...pack,stockQuantityPerPurchase:Infinity},{...pack,countUnit:""},{...pack,templateId:"same name"}]) assert.throws(()=>policy.normalizeProductBatchPackaging(bad));
});
