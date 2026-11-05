import test from 'node:test';
import assert from 'node:assert/strict';
import {runMenuSyncRecovery,validateMenuSyncRecovery,recoveryDemaeStock} from '../src/menu-sync-recovery.mjs';
import {RocketMenuClient} from '../src/rocket-menu-client.mjs';

const now=()=>1803000000000;
const parent={sourceKey:'option_group:g',targetId:'group',kind:'option_group',name:'面类',price:null,marker:'FS0123456789abcd',mappings:[{externalId:'2',externalParentId:''}]};
function payload(kind='option',mode='inspect') {
 const target={sourceKey:kind==='option'?'option:g:o':'item:i',targetId:'target',parentId:'group',kind,name:'宽面｜Wide noodles',price:316,marker:'FS1123456789abcd',mappings:[{externalId:'sub_checkbox_2_12',externalParentId:'2',created:true}]};
 return {authoritativePublication:true,platformKey:'rocket_now',merchantId:'1',storeId:'store',brandId:'brand',sourceId:'source',revision:52,newItemsHidden:true,imagePolicy:'read_only',
 targets:[{...parent,...(kind==='item'?{kind:'category',sourceKey:'category:g'}:{})},target],
 recovery:{version:1,mode,failedJobId:'failed',sourceKey:target.sourceKey,externalId:target.mappings[0].externalId,externalParentId:'2',
 guard:{revision:52,checkedAt:now(),...(mode==='verify_release'?{releaseCommandId:'release',expectedAvailable:true}:{holdActive:true})}}};
}
function rocketHarness(p,{status='ON_SALE',ignoreWrite=false,writeError=false}={}) {
 const item={optionItemId:12,optionItemName:p.targets[1].name,salePrice:316,displayStatus:status};
 const sibling={optionItemId:13,optionItemName:'other',salePrice:99,displayStatus:'SOLD_OUT_TODAY'};
 const group={optionId:2,optionName:'面类',optionItems:[item,sibling]};
 const dish={dishId:12,dishName:p.targets[1].name,salePrice:316,description:'unchanged',displayStatus:status,
 mappingMenus:[{menuId:2,menuName:'面类'}],options:[{optionId:9,exposeOrder:0,optionItems:[{optionItemId:20,displayStatus:'NOT_EXPOSE'}]}],
 allDishImages:[{imageId:1}],allDetailImages:[{imageId:2}],moaExemption:true,dishDiscountPrice:10,koshiAttributes:{a:1}};
 const calls=[],writes=[];
 const transport={async request(path,method='GET',body) {
  calls.push({path,method,body});
  if(method==='POST') {
   writes.push({path,body});if(writeError)throw Error('network_write_outcome_unknown');
   if(!ignoreWrite) {
    if(path.includes('/option-items/')) {item.displayStatus=body.displayStatus;item.optionItemName=body.optionItemName;item.salePrice=body.salePrice;}
    else if(path.includes('/dishes/')) {dish.displayStatus=body.displayStatus;dish.dishName=body.dishName;dish.salePrice=body.salePrice;}
   }
   return {};
  }
  if(path.endsWith('/all-menu-dishes'))return {menus:[{menuId:2,menuName:'面类',dishes:[dish]}]};
  if(path.endsWith('/all-options?fetchDish=true'))return structuredClone([group,...(p.targets[1].kind==='item'?[{optionId:9,optionItems:[{optionItemId:20,displayStatus:'NOT_EXPOSE'}]}]:[])]);
  if(path.endsWith('/dishes/12/detail'))return structuredClone(dish);
  throw Error(`Unexpected path: ${path}`);
 }};
 return {client:new RocketMenuClient(transport,'1'),item,sibling,group,dish,calls,writes};
}
const run=(p,h,progress=async()=>{})=>runMenuSyncRecovery(p,h.client,progress,{now,merchantId:'1',storeId:'store'});

test('inspect returns native name, price, parent and state for the precise option, without writes',async()=>{
 const p=payload(),h=rocketHarness(p),result=await run(p,h);
 assert.equal(result.outcome,'inspected');assert.equal(result.changed,0);assert.deepEqual(result.blockers,[]);
 assert.equal(result.inspection.name,p.targets[1].name);assert.equal(result.inspection.price,316);
 assert.deepEqual(result.inspection.parentNames,['面类']);assert.equal(result.inspection.nativeStatus,'ON_SALE');
 assert.equal(result.inspection.hidden,false);assert.equal(result.inspection.isAvailable,true);
 assert.equal(result.inspection.externalId,'sub_checkbox_2_12');assert.equal(result.canRestoreHidden,true);
 assert.equal(h.writes.length,0);assert.equal(h.calls.length,2);
});
test('restore uses the actual option serializer, final guard ACK and independent readback',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p),events=[];
 const beforeSibling=structuredClone(h.sibling);
 const result=await run(p,h,async progress=>{events.push(progress);if(progress.recoveryGuard)assert.equal(h.writes.length,0);});
 assert.equal(result.outcome,'restored_hidden');assert.equal(result.changed,1);assert.equal(result.inspection.hidden,true);
 assert.equal(h.writes.length,1);assert.deepEqual(h.writes[0].body,{optionId:2,optionItemName:p.targets[1].name,displayStatus:'NOT_EXPOSE',salePrice:316,salePriceMoney:{currencyCode:'JPY',units:316,nanos:0}});
 assert.deepEqual(h.sibling,beforeSibling);
 assert.equal(events.filter(row=>row.recoveryGuard===true).length,1);
 assert.ok(h.calls.findLastIndex(row=>row.method==='GET')>h.calls.findIndex(row=>row.method==='POST'));
});
test('item restore uses the real dish serializer and preserves photos, options, category and prices',async()=>{
 const p=payload('item','restore_hidden'),h=rocketHarness(p),before=structuredClone(h.dish);
 let guardCalls=0;const result=await run(p,h,async progress=>{if(progress.recoveryGuard){guardCalls++;assert.equal(h.writes.length,0);}});
 assert.equal(guardCalls,1);assert.equal(result.outcome,'restored_hidden');assert.equal(h.writes.length,1);
 assert.equal(h.writes[0].body.displayStatus,'NOT_EXPOSE');assert.equal(h.writes[0].body.description,before.description);
 assert.equal(h.writes[0].body.salePrice,316);assert.equal(h.writes[0].body.moaExemption,true);
 assert.equal(Object.keys(h.writes[0].body).some(key=>/image/i.test(key)),false);
 assert.deepEqual(h.dish.allDishImages,before.allDishImages);assert.deepEqual(h.dish.allDetailImages,before.allDetailImages);
 assert.deepEqual(h.dish.options,before.options);assert.deepEqual(h.dish.mappingMenus,before.mappingMenus);
});
test('plain Rocket native item and option IDs retain exact parent verification',async()=>{
 for(const kind of ['item','option']) {
  const p=payload(kind,'restore_hidden');p.targets[1].mappings[0].externalId='12';p.recovery.externalId='12';
  const h=rocketHarness(p),result=await run(p,h);assert.equal(result.outcome,'restored_hidden');assert.equal(result.externalId,'12');assert.equal(h.writes.length,1);
  const wrong=payload(kind);wrong.targets[1].mappings[0].externalId='12';wrong.recovery.externalId='12';wrong.targets[1].mappings[0].externalParentId='99';wrong.recovery.externalParentId='99';
  const guard=rocketHarness(wrong);await assert.rejects(()=>run(wrong,guard),/parent_mismatch/);assert.equal(guard.calls.length,0);
 }
});
test('already hidden requires no write and remains unavailable',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p,{status:'NOT_EXPOSE'}),result=await run(p,h);
 assert.equal(result.outcome,'already_hidden');assert.equal(result.changed,0);assert.equal(result.inspection.isAvailable,false);assert.equal(h.writes.length,0);
});
test('verified release reads the exact native state and never mutates it',async()=>{
 const p=payload('option','verify_release'),h=rocketHarness(p),result=await run(p,h);
 assert.equal(result.outcome,'verified_release');assert.equal(result.changed,0);assert.equal(h.writes.length,0);
 assert.equal(result.capturedAt,new Date(result.inspectedAt).toISOString());
 const hidden=await run(p,rocketHarness(p,{status:'NOT_EXPOSE'}));
 assert.equal(hidden.outcome,'blocked');assert.ok(hidden.blockers.includes('release_not_available'));
});
test('a native unknown state is shown as unknown and cannot be repaired',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p,{status:'PENDING'}),result=await run(p,h);
 assert.equal(result.outcome,'blocked');assert.equal(result.inspection.nativeStatus,'UNKNOWN');assert.equal(result.inspection.hidden,null);assert.equal(h.writes.length,0);
});
test('unknown native moderation flags cannot be interpreted as available or repaired',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p);h.item.forceNotExpose='unknown';
 const result=await run(p,h);assert.equal(result.outcome,'blocked');assert.equal(result.inspection.nativeStatus,'UNKNOWN');assert.equal(h.writes.length,0);
});
test('missing native ID cannot adopt a same-name option',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p);h.item.optionItemId=99;
 const result=await run(p,h);assert.equal(result.outcome,'blocked');assert.equal(result.inspection.found,false);assert.equal(h.writes.length,0);
});
test('same native ID under multiple parent groups is rejected, including identical names',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p);h.client.catalog=async()=>({groups:[h.group,{...structuredClone(h.group),optionId:7}]});
 await assert.rejects(()=>run(p,h),/native_identity_ambiguous/);assert.equal(h.writes.length,0);
});
test('a changed native parent, name or price blocks repair without modifying another field',async()=>{
 for(const field of ['parent','name','price']) {
  const p=payload('option','restore_hidden'),h=rocketHarness(p);
  if(field==='parent')h.group.optionId=4;if(field==='name')h.item.optionItemName='renamed';if(field==='price')h.item.salePrice=100;
  const result=await run(p,h);assert.equal(result.outcome,'blocked');assert.equal(h.writes.length,0);
 }
});
test('server final guard rejection stops the native POST',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p);
 await assert.rejects(()=>run(p,h,async progress=>{if(progress.recoveryGuard)throw Error('newer_inventory_intent');}),/newer_inventory_intent/);
 assert.equal(h.writes.length,0);
});
test('a stale guard after inspection or its ACK stops the native write',async()=>{
 for(const stage of ['recovery_inspecting','recovery_guard']) {
  const p=payload('option','restore_hidden'),h=rocketHarness(p);
  await assert.rejects(()=>run(p,h,async progress=>{if(progress.phase===stage)p.recovery.guard.checkedAt-=121000;}),/guard_stale/);
  assert.equal(h.writes.length,0);
 }
});
test('native drift between inspect and serializer reread stops the native write',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p);let reads=0;const catalog=h.client.catalog.bind(h.client);
 h.client.catalog=async()=>{if(++reads===2)h.item.salePrice=999;return catalog();};
 await assert.rejects(()=>run(p,h),/native_changed/);assert.equal(h.writes.length,0);
});
test('successful HTTP save without final hidden state never becomes recovery success',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p,{ignoreWrite:true});
 await assert.rejects(()=>run(p,h),/verification_failed|readback_unverified/);assert.equal(h.writes.length,1);
});
test('unknown write outcome is not retried or followed by creation',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p,{writeError:true});
 await assert.rejects(()=>run(p,h),/network_write_outcome_unknown/);assert.equal(h.writes.length,1);
 assert.ok(h.calls.every(row=>!row.path.includes('/create')));
});
test('readback outside client verification is independently required',async()=>{
 const p=payload('option','restore_hidden'),h=rocketHarness(p);let reads=0;const catalog=h.client.catalog.bind(h.client);
 h.client.catalog=async()=>{if(++reads===4)h.item.displayStatus='ON_SALE';return catalog();};
 await assert.rejects(()=>run(p,h),/readback_unverified/);assert.equal(h.writes.length,1);
});
test('shared OS physical identity is rejected even with differing display IDs or names',()=>{
 const p=payload();p.targets.push({...p.targets[1],targetId:'other',sourceKey:'option:g:other',name:'another',mappings:[{externalId:'sub_checkbox_99_12',externalParentId:'99',created:true}]});
 assert.throws(()=>validateMenuSyncRecovery(p,'rocket_now','1','store'),/identity_shared/);
});
test('durable creation, source version, platform, merchant, store and parent scope are all mandatory',async()=>{
 const mutations=[p=>p.targets[1].mappings[0].created=false,p=>p.recovery.externalId='sub_checkbox_2_99',p=>p.recovery.externalParentId='9',p=>p.storeId='other',p=>p.merchantId='9',p=>p.platformKey='demae_can',p=>p.platformKey='unsupported',p=>p.targets[0].mappings=[],p=>p.targets[1].quarantined=true,p=>p.targets[1].archived=true,p=>p.migrationState={x:{targetId:'target'}}];
 for(const mutate of mutations) {const p=payload();mutate(p);const h=rocketHarness(p);await assert.rejects(()=>run(p,h));assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);}
});
test('repairs require fresh matching server hold proof; release verification needs explicit release proof',async()=>{
 const cases=[p=>delete p.recovery.guard,p=>p.recovery.guard.revision=51,p=>p.recovery.guard.checkedAt-=120001,p=>p.recovery.guard.checkedAt+=6000,p=>p.recovery.guard.holdActive=false,p=>p.recovery.guard.releaseCommandId='release'];
 for(const mutate of cases) {const p=payload('option','restore_hidden');mutate(p);const h=rocketHarness(p);await assert.rejects(()=>run(p,h),/guard_stale|hold_unverified/);assert.equal(h.calls.length,0);}
 for(const mutate of [p=>delete p.recovery.guard.releaseCommandId,p=>p.recovery.guard.expectedAvailable=false,p=>p.recovery.guard.holdActive=true]) {
  const p=payload('option','verify_release');mutate(p);const h=rocketHarness(p);await assert.rejects(()=>run(p,h),/release_unverified/);assert.equal(h.writes.length,0);
 }
});

function demaePayload(mode='inspect') {
 const p=payload('option',mode);p.platformKey='demae_can';p.menuPatternCode='live';p.draftPatternCode='draft';
 p.targets[0].mappings=[{externalId:'0002',externalParentId:''}];
 p.targets[1].mappings=[{externalId:'itemList_1007true',externalParentId:'stage:carrier',created:true}];
 p.recovery.externalId='itemList_1007true';p.recovery.externalParentId='stage:carrier';return p;
}
async function demaeHarness(p,{hold=false,missingStock=false}={}) {
 const {DemaeMenuClient}=await import('../src/demae-menu-client.mjs');
 const option={chainId:1,optionCode:'007',optionName:p.targets[1].name,price:316,applyStartDate:'2026/01/01',applyEndDate:'9999/12/31'};
 const shop={shopId:2,orderType:'DELIVERY'};
 const records=hold?[{...shop,optionCode:'007',isCurrentApplying:true,isEndSale:true,applyStartTime:'2026-10-19T00:00:00Z',applyEndTime:'2099-12-31T00:00:00Z'}]:[];
 const calls=[];
 const client=new DemaeMenuClient({async request(path,method='GET',body) {
  calls.push({path,method,body});
  if(path.endsWith('/chain-menu-pattern'))return [{chain:{chainId:1},menuPatternList:[{menuPatternCode:'live'}]}];
  if(path.endsWith('/live/item-list'))return {categoryList:[]};
  if(path.endsWith('/linked-option-group-list'))return [{chainId:1,optionGroupCode:'0002',optionGroupName:'面类'}];
  if(path.endsWith('/option-item-list'))return [structuredClone(option)];
  if(path.endsWith('/stockout/shop-list'))return {shopList:[{chainId:1,...shop}]};
  if(path.endsWith('/stockout/target-list'))return {hasOverOptionLimitChain:false,itemList:[],optionList:missingStock?[]:[{chainId:1,optionCode:'007',linkedShopList:[shop],stockoutOptionList:records}]};
  throw Error(`Unexpected native Demae request: ${method} ${path}`);
 }},'1','live',{today:'2026-10-20'});
 return {client,calls};
}
test('Demae inspection and explicit release verification use real scoped native clients without mutation',async()=>{
 for(const mode of ['inspect','verify_release']) {
  const p=demaePayload(mode),h=await demaeHarness(p),result=await run(p,h);
  assert.equal(result.outcome,mode==='inspect'?'inspected':'verified_release');
  assert.equal(result.inspection.nativeStatus,'AVAILABLE');assert.equal(result.inspection.identityVerified,true);
  assert.deepEqual(result.inspection.parentIds,['0002']);assert.equal(result.changed,0);
  assert.ok(h.calls.every(row=>row.method==='GET'||row.path.endsWith('/stockout/target-list')));
 }
});
test('Demae restores remain explicitly blocked until a safe native hide protocol exists',async()=>{
 const p=demaePayload('restore_hidden'),h=await demaeHarness(p),result=await run(p,h);
 assert.equal(result.outcome,'blocked');assert.deepEqual(result.blockers,['restore_unsupported']);assert.equal(result.changed,0);
 assert.ok(h.calls.every(row=>row.method==='GET'||row.path.endsWith('/stockout/target-list')));
});
test('Demae permanent hold is verified as already hidden, and an absent stock row stays unknown',async()=>{
 const p=demaePayload('restore_hidden'),h=await demaeHarness(p,{hold:true}),result=await run(p,h);
 assert.equal(result.outcome,'already_hidden');assert.equal(result.inspection.nativeStatus,'PERMANENT_HOLD');assert.equal(result.changed,0);
 const missing=await demaeHarness(p,{missingStock:true});await assert.rejects(()=>run(p,missing),/native_stock_unknown/);
});
test('Demae stock proof covers size holds, permanent holds and malformed/truncated states',()=>{
 const shop={shopId:2,orderType:'DELIVERY'},record={...shop,itemCode:'007',isCurrentApplying:true,isEndSale:true,applyStartTime:'2026-10-19T00:00:00Z',applyEndTime:'2099-12-31T00:00:00Z'};
 const state={listed:true,linkedShops:[shop],records:[record],sizes:[{sizeCode:'size',linkedShops:[shop],records:[]}]};
 assert.deepEqual(recoveryDemaeStock(state,'item','007'),{unavailable:true,permanentlyUnavailable:true});
 assert.deepEqual(recoveryDemaeStock({...state,records:[],sizes:[{...state.sizes[0],records:[{...record,sizeCode:'size'}]}]},'item','007'),{unavailable:true,permanentlyUnavailable:false});
 assert.deepEqual(recoveryDemaeStock({...state,records:[]},'item','007'),{unavailable:false,permanentlyUnavailable:false});
 for(const mutate of [s=>s.listed=false,s=>s.linkedShops=[],s=>s.records[0].isCurrentApplying=undefined,s=>s.records[0].itemCode='other',s=>s.records[0].applyStartTime='unknown',s=>s.records[0].shopId=99,s=>s.sizes=[],s=>s.sizes[0].records=undefined]) {
  const invalid=structuredClone(state);mutate(invalid);assert.throws(()=>recoveryDemaeStock(invalid,'item','007'),/native_stock_unknown/);
 }
});

test('actual main dispatcher keeps inspect commands read-only and explicitly routes recovery commands',async()=>{
 const {readFileSync}=await import('node:fs');const {Script}=await import('node:vm');
 const source=readFileSync(new URL('../src/main.mjs',import.meta.url),'utf8');
 const functionSource=source.slice(source.indexOf('async function executeMenuCommand(command) {'),source.indexOf('\nasync function executeAuditCommand(command) {'));
 const calls=[];const execute=new Script(`${functionSource};executeMenuCommand(command)`);
 const context={command:{platform:'rocket_now',type:'inspect_menu_sync',payload:{recovery:{mode:'restore_hidden'}}},
  adapters:new Map([['rocket_now',{recoverMenuSync:async(...args)=>{calls.push(args);return {ok:true};}}]]),reportProgress:async()=>{}};
 await assert.rejects(()=>execute.runInNewContext(context),/command_mode_mismatch/);assert.equal(calls.length,0);
 context.command.payload.recovery.mode='inspect';assert.equal((await execute.runInNewContext(context)).ok,true);
 context.command.type='repair_menu_sync';await assert.rejects(()=>execute.runInNewContext(context),/command_mode_mismatch/);
 context.command.payload.recovery.mode='verify_release';assert.equal((await execute.runInNewContext(context)).ok,true);
 assert.match(source,/menuSyncRecoveryVersion: 1/u);
});
