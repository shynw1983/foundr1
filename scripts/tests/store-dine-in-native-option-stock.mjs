// Actual inventory policy and shortage handler; no database, credentials, sales,
// payment or stock writes. POS persistence/print coverage lives in the UI fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
const args = Object.fromEntries(process.argv.slice(2).reduce((out,value,index,all) => {if(value.startsWith('--'))out.push([value.slice(2),all[index+1]]);return out;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/store-dine-in-native-option-stock');mkdirSync(output,{recursive:true});
const require=createRequire(resolve(source,'package.json')),ts=require('typescript'),cache=new Map(),sourceHashes={};
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
function load(file,overrides={}) {
  const absolute=resolve(source,file);if(!Object.keys(overrides).length&&cache.has(absolute))return cache.get(absolute);
  const raw=readFileSync(absolute,'utf8'),exports={};sourceHashes[absolute.slice(source.length+1)]=hash(absolute);if(!Object.keys(overrides).length)cache.set(absolute,exports);
  const javascript=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(javascript,{exports,structuredClone,Date,require:name=>Object.hasOwn(overrides,name)?overrides[name]:name.startsWith('.')?load(resolve(dirname(absolute),name)+'.ts'):require(name)},{filename:absolute});return exports;
}
const policy=load('lib/inventory-order-usage-policy.ts');
const clone=x=>JSON.parse(JSON.stringify(x));
const uuid=index=>'00000000-0000-4000-8000-'+String(index).padStart(12,'0');
const native={storeMenuOptionId:uuid(10),localOriginId:uuid(11),name:'店内 牛筋',displayNames:{en:'Store beef'},quantity:1,unitPrice:190,portionGrams:50};
const localGroup={groupId:uuid(12),storeMenuGroupId:uuid(12),storeMenuOptionIds:[native.storeMenuOptionId],groupName:'追加',groupKey:'topping',optionIds:[],optionKeys:['store-native'],optionLabels:[native.name],optionPrices:[190],localOptions:[native]};
const canonical={groupId:uuid(13),groupName:'追加',optionIds:[uuid(14),uuid(14)],optionKeys:['canonical','canonical'],optionLabels:['定番50g','定番50g'],optionPrices:[200,200]};
const linked={groupId:uuid(15),groupName:'飲みもの',optionIds:[],optionLabels:['緑茶'],optionPrices:[350],linkedItems:[{menuCatalogItemId:uuid(16),storeMenuItemId:uuid(17),name:'緑茶',displayNames:{},quantity:1,unitPrice:350}]};
const raw=customizations=>({sourceItemId:uuid(1),menuCatalogItemId:uuid(2),quantity:2,measuredQuantity:200,measuredUnit:'g',refundStatus:'',customizations});
const normalize=(groups,channel='store_pos',extra={})=>policy.normalizeInventoryOrderSource([raw(groups)],channel,extra);
const results=[];
async function check(name,run){await run();results.push({name,passed:true});console.log('PASS '+name);}
await check('native-choice-is-unresolved-without-fake-canonical-or-linked-product-identities',()=>{
  const result=normalize([localGroup,canonical,linked]);assert.equal(result.identityConfidence,'unresolved');assert.deepEqual(clone(result.issueCodes),['local_option_unmapped']);assert.deepEqual(clone(result.items[0].options),[{id:uuid(14),quantity:2}]);assert.deepEqual(clone(result.items[0].linkedItems),[{id:uuid(16),quantity:1}]);assert.ok(!JSON.stringify(result.items[0].options).includes(native.storeMenuOptionId));assert.deepEqual(clone(result.rawItems[0]),raw([localGroup,canonical,linked]));
});
await check('repeated-native-portions-retain-snapshot-quantities-and-produce-one-explicit-issue',()=>{
  const repeated={...clone(localGroup),storeMenuOptionIds:Array(3).fill(native.storeMenuOptionId),localOptions:Array.from({length:3},()=>clone(native)),optionKeys:Array(3).fill('store-native'),optionLabels:Array(3).fill(native.name),optionPrices:Array(3).fill(190)};const result=normalize([repeated]);assert.equal(result.identityConfidence,'unresolved');assert.deepEqual(clone(result.issueCodes),['local_option_unmapped']);assert.equal(result.rawItems[0].customizations[0].localOptions.length,3);assert.deepEqual(clone(result.items[0].options),[]);
});
await check('unresolved-native-usage-never-produces-any-stock-movement-even-with-matching-guessed-recipes',()=>{
  const result=normalize([localGroup,canonical,linked]);const plan=policy.planInventoryOrderUsage({source:result,recipes:[{id:uuid(30),brandId:uuid(31),targetType:'option',targetId:native.storeMenuOptionId,versionId:uuid(32),snapshot:{basis:'serving',inputs:[]}}],products:[],stocks:[],explicitLocations:new Map(),occurredAt:'2026-10-22T00:00:00Z'});assert.deepEqual(clone(plan.lines),[]);assert.equal(plan.unmappedItems,1);assert.ok(plan.issues.some(issue=>issue.code==='local_option_unmapped'));
});
await check('ordinary-canonical-and-linked-product-normalization-remains-exact',()=>{
  const result=normalize([canonical,linked]);assert.equal(result.identityConfidence,'exact');assert.deepEqual(clone(result.issueCodes),[]);assert.deepEqual(clone(result.items[0].options),[{id:uuid(14),quantity:2}]);assert.deepEqual(clone(result.items[0].linkedItems),[{id:uuid(16),quantity:1}]);
});
await check('native-metadata-on-public-or-delivery-channel-is-explicitly-unresolved',()=>{
  for(const channel of ['maamaa_web','nanacha_web','table_qr','uber_eats']){const result=normalize([localGroup],channel);assert.equal(result.identityConfidence,'unresolved');assert.ok(result.issueCodes.includes('invalid_local_option_identity'));assert.deepEqual(clone(result.items[0].options),[]);}
});
await check('malformed-native-identity-quantity-price-or-portion-is-not-silently-exact',()=>{
  const malformed=[{}, {...native,storeMenuOptionId:'bad'}, {...native,localOriginId:'bad'}, {...native,quantity:0}, {...native,quantity:1.5}, {...native,quantity:1_000_001}, {...native,unitPrice:-1}, {...native,unitPrice:190.5}, {...native,unitPrice:'190'}, {...native,portionGrams:0}, {...native,portionGrams:100_000}, {...native,portionGrams:undefined}];
  for(const value of malformed){const result=normalize([{...localGroup,localOptions:[value]}]);assert.equal(result.identityConfidence,'unresolved');assert.ok(result.issueCodes.includes('invalid_local_option_identity'));}
  for(const value of [null,{},'native',[]])assert.ok(normalize([{...localGroup,localOptions:value}]).issueCodes.includes('invalid_local_option_identity'));
});
await check('unknown-portion-and-explicit-zero-price-remain-native-unmapped-instead-of-free-stock-assumption',()=>{
  const result=normalize([{...localGroup,localOptions:[{...native,unitPrice:0,portionGrams:null}]}]);assert.deepEqual(clone(result.issueCodes),['local_option_unmapped']);assert.equal(result.identityConfidence,'unresolved');
});
await check('trusted-complete-per-order-mapping-can-resolve-native-raw-identity-with-explicit-canonical-quantities',()=>{
  const mapping={sourceItemId:uuid(1),menuCatalogItemId:uuid(2),quantity:2,options:[{id:uuid(40),quantity:3}]};for(const localOptions of [[native],null]){const result=normalize([{...localGroup,localOptions}],'store_pos',{reliableIdentity:true,mappedItems:[mapping]});assert.equal(result.identityConfidence,'exact');assert.deepEqual(clone(result.issueCodes),[]);assert.deepEqual(clone(result.items[0].options),mapping.options);}
});
function shortageFixture(group=localGroup){
  let reads=0,effects=0;const forbidden=()=>{effects++;throw Error('No payment or business mutation allowed');};const target={paymentStatus:'paid',status:'new',refundStatus:'',amount:1500,grossAmount:1500,paidAmount:1500,itemName:'麻辣湯',shortagePreference:'substitute_or_refund',customizations:[group]};
  const api=load('lib/store-order-shortages.ts',{'./db':{sql:async()=>{reads++;return[target];}},'./customer-orders':{findCustomerOrderById:forbidden,refundCustomerOrderPayment:forbidden},'./loyalty':{reverseLoyaltyForRefundedOrderItem:forbidden},'./order-production':{ensureProductionTasksForOrder:forbidden},'./sales-orders':{syncWebReservationToSalesOrder:forbidden},'./inventory-order-usage':{markInventoryOrderReady:forbidden},'./store-order-shortage-rules':load('lib/store-order-shortage-rules.ts')});return{api,counts:()=>({reads,effects})};
}
await check('shortage-candidates-retain-whole-item-and-canonical-choice-without-native-or-linked-index-candidates',()=>{
  const {api}=shortageFixture();const candidates=api.buildShortageCandidates({id:uuid(1),itemName:'麻辣湯',amount:1500,customizations:[localGroup,canonical,linked]});assert.equal(candidates.length,3);assert.equal(candidates[0].key,'item');assert.ok(candidates.slice(1).every(candidate=>candidate.key.startsWith('option:1:')));assert.ok(!candidates.some(candidate=>candidate.name===native.name));
});
await check('forged-native-option-refund-and-replacement-stop-before-financial-or-business-side-effects',async()=>{
  for(const actionType of ['refund','replace']){const {api,counts}=shortageFixture();const result=await api.handleStoreOrderShortage({orderId:uuid(50),orderItemId:uuid(1),targetKey:'option:0:0',actionType,replacementName:'代わり',employeeId:uuid(51),employeeName:'Test'});assert.equal(result.ok,false);assert.equal(result.status,400);assert.match(result.error,/商品全体/);assert.deepEqual(counts(),{reads:1,effects:0});}
});
await check('malformed-native-metadata-cannot-bypass-shortage-index-protection',async()=>{
  for(const value of [undefined,null,[]]){const {api,counts}=shortageFixture({...localGroup,localOptions:value});const result=await api.handleStoreOrderShortage({orderId:uuid(50),orderItemId:uuid(1),targetKey:'option:0:0',actionType:'refund',employeeId:uuid(51),employeeName:'Test'});assert.equal(result.ok,false);assert.equal(result.status,400);assert.deepEqual(counts(),{reads:1,effects:0});}
});
for(const file of ['app/api/store/pos/route.ts','lib/inventory-order-usage.ts','components/InventoryUsagePanel.tsx','scripts/tests/store-dine-in-native-option-stock.mjs'])sourceHashes[file]=hash(resolve(source,file));
for(const [file,before]of Object.entries(sourceHashes))assert.equal(hash(resolve(source,file)),before,'Source drift during native stock tests');
writeFileSync(resolve(output,'report.json'),JSON.stringify({passed:results.length,results,source,sourceHashes,actualInventoryPolicy:true,actualShortageHandler:true,productionWrites:0,financialActions:0,stockWrites:0},null,2)+'\n');
