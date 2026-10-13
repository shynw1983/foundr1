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
 for(const text of ['干腐竹','OS: 0','火箭: 1','永久缺货','可售','缺货'])assert.ok(html.includes(text),text);
});
function renderComparison(referencePlatform:string,language:string,staged=false) {
 const exports:Record<string,unknown>={};
 const source=readFileSync(new URL('../app/store/menu/InventoryComparisonPreview.tsx',import.meta.url),'utf8');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require});
 const target={kind:'option',targetId:'exact-option',label:'火鍋春雨（細）50g',isAvailable:false,wasAvailable:false};
 const comparison=buildInventoryComparison({comparisonVersion:1,referencePlatform,comparisonPlatforms:['rocket_now','demae_can'],preview:[target]},['rocket_now','demae_can'].map(platform=>({platform,status:'succeeded',payload:{comparisonAudit:true,targets:[target]},result:{items:[{...target,found:true,isAvailable:platform==='demae_can'&&staged?null:true,status:platform==='demae_can'&&staged?'staged':'available',...(platform==='demae_can'&&staged?{stagingVerified:true}:{})}]}})));
 return renderToStaticMarkup(createElement(exports.InventoryComparisonPreview as React.ComponentType<{comparison:typeof comparison;language:string}>,{comparison,language}));
}
test('alternative reference badge and before/after arrows come from selected source, including Uber destination',()=>{
 const html=renderComparison('rocket_now','zh-Hans');
 for(const text of ['火箭（基准）','Uber: 1','OS: 1','恢复销售','value="uber_eats"'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('Uber（基准）'));
 assert.ok(!html.includes('永久缺货'));
 assert.ok(!html.includes('value="rocket_now"'));
});
test('staged selected-source rows are skipped and never falsely listed as equal or fallback to Uber',()=>{
 const html=renderComparison('demae_can','zh-Hans',true);
 assert.ok(html.includes('本次不参与校正'));
 assert.ok(html.includes('所有参与平台均一致<!-- --> · <!-- -->0')||/所有参与平台均一致[^<]*.*0/.test(html));
 assert.ok(!html.includes(' → '));
});
test('Japanese and Traditional Chinese source labels, notices and restoration copy stay localized',()=>{
 const ja=renderComparison('rocket_now','ja'),tw=renderComparison('rocket_now','zh-Hant');
 assert.ok(ja.includes('Rocket Now（基準）'));assert.ok(ja.includes('販売再開'));
 assert.ok(tw.includes('火箭（基準）'));assert.ok(tw.includes('恢復銷售'));assert.ok(!tw.includes('（基准）'));
});
