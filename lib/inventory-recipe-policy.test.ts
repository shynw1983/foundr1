import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import * as units from "./product-unit-conversions.ts";
const policy:Record<string,any>={};
runInNewContext(ts.transpileModule(readFileSync(new URL("./inventory-recipe-policy.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports:policy,require:(name:string)=>{if(name==="./product-unit-conversions")return units;throw Error(name);}});
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const menu={action:"save",requestId:id(9),expectedVersionId:null,name:"配合",brandId:id(1),kind:"menu",targetType:"item",targetId:id(2),outputProductId:null,
 snapshot:{basis:"serving",inputs:[{productId:id(3),quantity:0.125,unit:"g",mode:"exact"}]}};
test("menu rules distinguish explicit no independent use from an absent rule; production needs real inputs",()=>{
 assert.equal(policy.normalizeInventoryRecipePayload({...menu,snapshot:{basis:"serving",inputs:[]}}).snapshot.inputs.length,0);
 assert.throws(()=>policy.normalizeInventoryRecipePayload({...menu,snapshot:undefined}));
 assert.throws(()=>policy.normalizeInventoryRecipePayload({...menu,kind:"production",targetType:null,targetId:null,outputProductId:id(4),snapshot:{basis:"serving",inputs:[],output:{productId:id(4),quantity:1,unit:"g"}}}));
});
test("unknown and estimated ingredients cannot turn into measured zero; quantities retain fractions",()=>{
 assert.equal(policy.normalizeInventoryRecipePayload(menu).snapshot.inputs[0].quantity,0.125);
 const unknown=policy.normalizeInventoryRecipePayload({...menu,snapshot:{basis:"serving",inputs:[{productId:id(3),quantity:null,unit:"g",mode:"unmeasured"}]}});
 assert.equal(unknown.snapshot.inputs[0].quantity,null);
 for(const quantity of [0,-1,Infinity,"1/3",null]) assert.throws(()=>policy.normalizeInventoryRecipePayload({...menu,snapshot:{basis:"serving",inputs:[{productId:id(3),quantity,unit:"g",mode:"exact"}]}}));
 assert.throws(()=>policy.normalizeInventoryRecipePayload({...menu,snapshot:{basis:"serving",inputs:[{productId:id(3),quantity:0,unit:"g",mode:"unmeasured"}]}}));
});
test("recipe source IDs, output identity and CAS are explicit, never names",()=>{
 assert.throws(()=>policy.normalizeInventoryRecipePayload({...menu,requestId:undefined}),(error:any)=>error.code==="request_id_required");
 assert.equal(policy.normalizeInventoryRecipePayload(menu).requestId,id(9));
 const normalized=policy.normalizeInventoryRecipePayload({...menu,name:" 配合 ",snapshot:{basis:"serving",inputs:[{...menu.snapshot.inputs[0],quantity:"1/8",unit:" g "}]}});
 assert.deepEqual(JSON.parse(JSON.stringify(policy.inventoryRecipeCreateRequestPayload(normalized))),JSON.parse(JSON.stringify(policy.inventoryRecipeCreateRequestPayload(policy.normalizeInventoryRecipePayload(menu)))));
 assert.throws(()=>policy.normalizeInventoryRecipePayload({...menu,id:id(5)}), (error:any)=>error.code==="version_changed");
 assert.throws(()=>policy.normalizeInventoryRecipePayload({...menu,snapshot:{basis:"measured",inputs:menu.snapshot.inputs}}));
 assert.throws(()=>policy.normalizeInventoryRecipePayload({...menu,snapshot:{basis:"serving",inputs:[...menu.snapshot.inputs,...menu.snapshot.inputs]}}));
 assert.throws(()=>policy.normalizeInventoryRecipePayload({...menu,kind:"production",targetType:null,targetId:null,outputProductId:id(3),snapshot:{...menu.snapshot,output:{productId:id(3),quantity:1,unit:"g"}}}));
});
test("store formula visibility never reveals a hidden component through an otherwise public output",()=>{
 const recipe={snapshot:menu.snapshot,outputProductId:id(4)};
 assert.equal(policy.inventoryRecipeIsVisible(recipe,new Set([id(4)])),false);
 assert.equal(policy.inventoryRecipeIsVisible(recipe,new Set([id(3),id(4)])),true);
});
