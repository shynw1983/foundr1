import test from 'node:test';
import assert from 'node:assert/strict';
import {canRetryMenuJob,menuSyncIssue,menuSyncIssueContext,nextMenuCheck} from './menu-sync-status.ts';
import {uberMenuChanges} from './uber-menu-diff.ts';
import type {UberSourceCatalog} from './uber-menu-authority.ts';
import {canonicalMenuValue,meaningfulMenuChanges,menuChangeValue} from './menu-change-display.ts';

const catalog=():UberSourceCatalog=>({version:1,storeUuid:'s',menuId:'m',capturedAt:'2026-09-09T00:00:00Z',sections:[],categories:[],groups:[{id:'g',name:'Base',optionIds:['a'],min:0,max:10}],entities:[{id:'a',name:'Tofu',price:200,description:'',imageUrl:'',groupIds:[],contextPrices:[]}]});

test('pending removal and carrier mismatch are explained without blaming Uber input',()=>{
 const error='uber_source_pending_removal:'+JSON.stringify([{sourceKey:'option:g:mango',name:'マンゴー'}]);
 for(const language of ['ja','zh-Hans','zh-Hant']) {
  const issue=menuSyncIssue(error,language)!;
  assert.match(issue.action,/マンゴー/);assert.equal(issue.retry,false);
 }
 assert.match(menuSyncIssue(error,'ja')!.action,/1分以上/);
 assert.match(menuSyncIssue(error,'zh-Hans')!.action,/未改变现有状态/);
 assert.equal(menuSyncIssue('uber_authority_preflight_blocked:1:item_group_migration_required')!.kind,'verify');
 assert.doesNotThrow(()=>menuSyncIssue('uber_source_pending_removal:[truncated'));
});
test('quantity key order is not a change, including historical records',()=>{
 const before=JSON.stringify([0,50,{overrides:null,defaultValue:{minPermitted:null,maxPermitted:50}}]);
 const after=JSON.stringify([0,50,{defaultValue:{maxPermitted:50,minPermitted:null},overrides:null}]);
 const change={kind:'updated',name:'新登場',field:'数量ルール',before,after,sourceKey:'g'};
 assert.equal(meaningfulMenuChanges([change]).length,0);
 assert.deepEqual(JSON.parse(canonicalMenuValue(JSON.parse(before))),JSON.parse(before));
 assert.match(menuChangeValue(change,after,'zh-Hans'),/可不选 · 最多 50 份/);
 assert.match(menuChangeValue(change,after,'ja'),/選択は任意 · 最大 50 個/);
 assert.equal(meaningfulMenuChanges([{...change,after:after.replace('50','20')}]).length,1);
 const a=catalog(),b=catalog();a.groups[0].quantityInfo=JSON.parse(before)[2];b.groups[0].quantityInfo=JSON.parse(after)[2];
 assert.deepEqual(uberMenuChanges(a,b),[]);
});
test('specific menu failures explain cause without blaming Uber settings',()=>{
 const rocket=menuSyncIssue('rocket_menu_group_quantity_invalid','zh-Hans');
 assert.match(rocket!.title,/可选数量/);assert.match(rocket!.action,/没有保存具体分组/);
 assert.match(menuSyncIssue('401:MWA0007','zh-Hans')!.action,/库存读取成功不代表/);
});
test('retirement errors identify the product despite a nested empty API error body',()=>{
 const error='demae_menu_item_retirement_failed:'+JSON.stringify({id:'00000006',name:'旧汤底',step:'move_to_hidden_category'})+':merchant_menu_operation_failed:PUT:/item/00000006:Error: merchant_menu_request_failed:400:MWA0012::{}';
 assert.match(menuSyncIssue(error,'zh-Hans')!.action,/旧汤底/);
 assert.match(menuSyncIssue(error,'ja')!.title,/非公開分類/);
 assert.match(menuSyncIssue('merchant_menu_request_failed:400:MWA0012::{}','zh-Hans')!.title,/输入校验/);
});
test('no changes produce an empty item diff',()=>assert.deepEqual(uberMenuChanges(catalog(),catalog()),[]));
test('rename is counted once and does not imply a membership change',()=>{
 const next=catalog();next.entities[0].name='New tofu';
 assert.deepEqual(uberMenuChanges(catalog(),next).map(row=>row.kind),['renamed']);
});
test('effective option price is counted once with its group',()=>{
 const next=catalog();next.entities[0].price=240;
 const changes=uberMenuChanges(catalog(),next);
 assert.equal(changes.length,1);assert.equal(changes[0].before,'200');assert.equal(changes[0].after,'240');assert.match(changes[0].name,/Base/);
});
test('image is not outbound content in the detailed diff',()=>{
 const next=catalog();next.entities[0].imageUrl='new-image';assert.deepEqual(uberMenuChanges(catalog(),next),[]);
});
test('login and unsafe content get different recovery actions',()=>{
 assert.equal(menuSyncIssue('401:MWA0007')?.kind,'login');
 assert.equal(menuSyncIssue('empty_projected_name')?.retry,false);
 assert.equal(menuSyncIssue('demae_stage_group_not_isolated')?.kind,'verify');
 assert.equal(menuSyncIssue('merchant_menu_request_failed:503')?.kind,'network');
});
test('AI adaptation failures name the affected group and give localized recovery advice',()=>{
 const detail=JSON.stringify({name:'お願い：商品合計1,600円〜で🙏',platform:'rocket_now',sourceKey:'option_group:g'});
 for(const language of ['ja','zh-Hans','zh-Hant']) {
  for(const code of ['unavailable','timeout','invalid','unsafe','exhausted']) {
   const issue=menuSyncIssue(`menu_name_ai_${code}:${detail}`,language)!;
   assert.match(issue.action,/お願い：商品合計1,600円〜で🙏/);
   assert.doesNotMatch(issue.title+issue.action,/menu_name_ai_|option_group:g/);
  }
 }
 assert.equal(menuSyncIssue(`menu_name_ai_timeout:${detail}`)!.kind,'network');
 assert.equal(menuSyncIssue(`menu_name_ai_unavailable:${detail}`)!.retry,true);
 assert.equal(menuSyncIssue(`menu_name_ai_unsafe:${detail}`)!.retry,false);
 assert.equal(menuSyncIssue(`menu_name_ai_exhausted:${detail}`)!.retry,false);
 assert.match(menuSyncIssue(`menu_name_ai_exhausted:${detail}`,'zh-Hans')!.action,/无需修改 Uber 原始菜单/);
});
test('a prepared AI retry does not claim platform acceptance',()=>{
 const issue=menuSyncIssue('menu_name_ai_retry_prepared:'+JSON.stringify({name:'请求组',adaptedName:'请求'}),'zh-Hans')!;
 assert.match(issue.title,/已生成/);assert.match(issue.action,/等待平台保存并回读确认/);
 assert.doesNotMatch(issue.title+issue.action,/同步成功|已完成|同步完成/);
});
test('structured preflight errors show affected names and association recovery',()=>{
 const error='uber_authority_preflight_blocked:2:'+JSON.stringify([
  {sourceKey:'option_group:g1',name:'选择面',code:'group_membership_migration_required'},
  {sourceKey:'item:i1',name:'牛筋套餐',code:'item_group_migration_required'}
 ]);
 const issue=menuSyncIssue(error,'zh-Hans')!;
 assert.equal(issue.kind,'verify');assert.equal(issue.retry,false);
 assert.match(issue.action,/选择面、牛筋套餐/);assert.match(issue.action,/修正同一商品的对应关系/);
 assert.doesNotMatch(issue.action,/option_group:g1|item:i1|group_membership_migration_required/);
});
test('preflight context resolves names from exact saved source keys and replaces stale legacy names',()=>{
 const error='uber_authority_preflight_blocked:2:'+JSON.stringify([
  {sourceKey:'option_group:g1',code:'group_membership_migration_required',name:'旧选择面'},
  {sourceKey:'item:i1',code:'item_group_migration_required'}
 ]);
 const context=menuSyncIssueContext(error,{'option_group:g1':'选择面','item:i1':'牛筋套餐','item:another':'不应出现'});
 assert.deepEqual(context,{issues:[
  {sourceKey:'option_group:g1',code:'group_membership_migration_required',name:'选择面'},
  {sourceKey:'item:i1',code:'item_group_migration_required',name:'牛筋套餐'}
 ]});
 const issue=menuSyncIssue(error,'zh-Hans',context)!;
 assert.match(issue.action,/选择面、牛筋套餐/);
 assert.doesNotMatch(issue.action,/旧选择面|不应出现/);
 assert.match(issue.action,/正确项目|对应关系/);
});
test('exact context also overrides a stale failed-content name and can intentionally leave unknown names absent',()=>{
 const error='uber_authority_content_failed:option_group:g1:旧选择面:merchant_menu_operation_failed:POST:/options/update:Error: special character';
 const issue=menuSyncIssue(error,'zh-Hans',{issues:[{sourceKey:'option_group:g1',name:'选择面'}]})!;
 assert.match(issue.action,/选择面/);assert.doesNotMatch(issue.action,/旧选择面/);
 const unknown=menuSyncIssue(error,'zh-Hans',{issues:[{sourceKey:'option_group:g1',code:'unknown_name'}]})!;
 assert.doesNotMatch(unknown.title+unknown.action,/旧选择面|option_group:g1|unknown_name/);
});
test('unknown or missing issue identities cannot be turned into display names',()=>{
 const error='uber_authority_preflight_blocked:5:'+JSON.stringify([
  {sourceKey:'item:unknown',code:'mapped_object_missing'},
  {sourceKey:'item:unknown',code:'mapped_object_missing',name:'item:unknown'},
  {sourceKey:'item:unknown',code:'mapped_object_missing',name:'mapped_object_missing'},
  {code:'mapped_object_missing'},
  {sourceKey:'item:another',code:'mapped_object_missing',name:'历史名称'}
 ]);
 const context=menuSyncIssueContext(error,{'item:known':'已有商品'});
 assert.deepEqual(context,{issues:[
  {sourceKey:'item:unknown',code:'mapped_object_missing'},
  {sourceKey:'item:unknown',code:'mapped_object_missing'},
  {sourceKey:'item:unknown',code:'mapped_object_missing'},
  {code:'mapped_object_missing'},
  {sourceKey:'item:another',code:'mapped_object_missing',name:'历史名称'}
 ]});
 assert.doesNotMatch(menuSyncIssue('mapped_object_missing','zh-Hans',context)!.action,/item:unknown|mapped_object_missing|已有商品/);
 assert.equal(menuSyncIssueContext('unrelated failure').issues.length,0);
 assert.equal(menuSyncIssueContext('preflight:[{"sourceKey":"item:missing"').issues.length,0);
});
test('issue enrichment exposes only names, source keys and error codes without raw command payload',()=>{
 const full={sourceKey:'item:i1',name:'旧牛筋',code:'item_group_migration_required',
  token:'private-token',headers:{authorization:'secret'},payload:{targets:[{name:'unrelated',price:990}]},sourceName:'历史牛筋',targetId:'internal-id'};
 const context=menuSyncIssueContext('wrapper:'+JSON.stringify(full)+':Error:{}',{'item:i1':'牛筋套餐'});
 assert.deepEqual(context,{issues:[{sourceKey:'item:i1',code:'item_group_migration_required',name:'牛筋套餐'}]});
 assert.doesNotMatch(JSON.stringify(context),/private-token|secret|headers|payload|targets|price|targetId/);
 const withoutSource=menuSyncIssueContext('wrapped:'+JSON.stringify({name:'番茄汤底',payload:full}));
 assert.deepEqual(withoutSource,{issues:[{name:'番茄汤底'}]});
});
test('existing-name collisions and missing mappings do not suggest creating duplicate products',()=>{
 for(const code of ['existing_unmapped_candidate','creation_existing_candidate','mapped_object_missing']) {
  const issue=menuSyncIssue(`uber_authority_${code}:`+JSON.stringify({name:'小竹笋 Pro Max'}),'zh-Hans')!;
  assert.equal(issue.kind,'verify');assert.equal(issue.retry,false);
  assert.match(issue.action,/小竹笋 Pro Max/);assert.match(issue.action,/正确项目后重试/);
  assert.doesNotMatch(issue.title+issue.action,new RegExp(code));
 }
});
test('nested platform name rejection shows the affected name without asking to edit Uber',()=>{
 const error='uber_authority_content_failed:option_group:b5187634-964d-459b-9f0d-42fc34d3d041:お願い：商品合計1,600円〜で:merchant_menu_operation_failed:POST:/options/update:Error: merchant_menu_request_failed:200:10036::"特殊文字は使用できません。"';
 const issue=menuSyncIssue(error,'zh-Hans')!;
 assert.equal(issue.retry,true);
 assert.match(issue.action,/お願い：商品合計1,600円〜で/);assert.match(issue.action,/无需修改 Uber 原名/);
 assert.doesNotMatch(issue.title+issue.action,/10036|merchant_menu_operation_failed|b5187634/);
});
test('known name-length failures expose retry while unrelated migrations remain blocked',()=>{
 const error='uber_authority_preflight_blocked:1:'+JSON.stringify([{sourceKey:'option_group:g',code:'native_group_name_too_long'}]);
 assert.equal(menuSyncIssue(error,'zh-Hans')!.retry,true);
 assert.equal(menuSyncIssue('uber_authority_preflight_blocked:1:group_membership_migration_required')!.retry,false);
 assert.equal(menuSyncIssue('empty_projected_name')!.retry,false);
 assert.equal(menuSyncIssue('merchant_menu_request_failed:400:MWA0012::{}')!.retry,false);
});
test('historical errors may use safe context but never invent an affected name',()=>{
 const issue=menuSyncIssue('uber_authority_content_unverified:item:i1','zh-Hans',{targetName:'番茄汤底'})!;
 assert.match(issue.action,/番茄汤底/);
 const missing=menuSyncIssue('uber_authority_preflight_blocked:1:[{"sourceKey":"item:i1","code":"item_group_migration_required"','zh-Hans')!;
 assert.doesNotMatch(missing.title+missing.action,/item:i1|migration_required/);
 assert.doesNotThrow(()=>menuSyncIssue('menu_name_ai_unsafe:{"name":"truncated','zh-Hans'));
 assert.doesNotMatch(menuSyncIssue('unrecognized_internal_code:item:id','zh-Hans')!.action,/unrecognized_internal_code|item:id/);
});
test('only latest failed downstream revision can retry',()=>{
 const job={id:'a',status:'failed',platform:'rocket_now',revision:'10'};
 assert.equal(canRetryMenuJob(job,'a',10),true);
 assert.equal(canRetryMenuJob(job,'b',10),false);
 assert.equal(canRetryMenuJob(job,'a',11),false);
 assert.equal(canRetryMenuJob({...job,platform:'uber_eats'},'a',10),false);
 assert.equal(canRetryMenuJob({...job,status:'succeeded'},'a',10),false);
});
test('next automatic check is noon Japan time, including day boundary',()=>{
 assert.equal(nextMenuCheck(new Date('2026-09-09T02:59:59Z')),'2026-09-09T03:00:00.000Z');
 assert.equal(nextMenuCheck(new Date('2026-09-09T03:00:00Z')),'2026-09-10T03:00:00.000Z');
});
