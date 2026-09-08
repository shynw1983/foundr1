import test from 'node:test';
import assert from 'node:assert/strict';
import {canRetryMenuJob,menuSyncIssue,nextMenuCheck} from './menu-sync-status.ts';
import {uberMenuChanges} from './uber-menu-diff.ts';
import type {UberSourceCatalog} from './uber-menu-authority.ts';

const catalog=():UberSourceCatalog=>({version:1,storeUuid:'s',menuId:'m',capturedAt:'2026-09-09T00:00:00Z',sections:[],categories:[],groups:[{id:'g',name:'Base',optionIds:['a'],min:0,max:10}],entities:[{id:'a',name:'Tofu',price:200,description:'',imageUrl:'',groupIds:[],contextPrices:[]}]});
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
