import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import {createRequire} from 'node:module';
import ts from 'typescript';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {buildInventoryComparison} from './inventory-comparison.ts';
const require=createRequire(import.meta.url);
test('preview renders destination-only difference with before/after and platform count',()=>{
 const exports:Record<string,unknown>={};
 const source=readFileSync(new URL('../app/store/menu/InventoryComparisonPreview.tsx',import.meta.url),'utf8');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require});
 const target={kind:'option',targetId:'1',label:'干腐竹',isAvailable:false,wasAvailable:false};
 const comparison=buildInventoryComparison({comparisonVersion:1,comparisonPlatforms:['rocket_now'],preview:[target]},[{platform:'rocket_now',status:'succeeded',payload:{comparisonAudit:true,targets:[target]},result:{items:[{...target,found:true,isAvailable:true,status:'available'}]}}]);
 const html=renderToStaticMarkup(createElement(exports.InventoryComparisonPreview as React.ComponentType<{comparison:typeof comparison;language:string}>,{comparison,language:'zh-Hans'}));
 for(const text of ['干腐竹','OS: 0','Rocket Now: 1','永久缺货','可售','缺货'])assert.ok(html.includes(text),text);
});
