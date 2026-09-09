import test from 'node:test';
import assert from 'node:assert/strict';
import {canRetryMenuJob,menuSyncIssue,nextMenuCheck} from './menu-sync-status.ts';
import {uberMenuChanges} from './uber-menu-diff.ts';
import type {UberSourceCatalog} from './uber-menu-authority.ts';
import {canonicalMenuValue,meaningfulMenuChanges,menuChangeValue} from './menu-change-display.ts';

const catalog=():UberSourceCatalog=>({version:1,storeUuid:'s',menuId:'m',capturedAt:'2026-09-09T00:00:00Z',sections:[],categories:[],groups:[{id:'g',name:'Base',optionIds:['a'],min:0,max:10}],entities:[{id:'a',name:'Tofu',price:200,description:'',imageUrl:'',groupIds:[],contextPrices:[]}]});
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
