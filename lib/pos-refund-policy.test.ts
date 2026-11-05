import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allocateRefundYen,refundSnapshots,planPosRefund,activeRefundCustomizations,type RefundItem} from './pos-refund-policy.ts';
const item=(patch:Partial<RefundItem>={}):RefundItem=>({id:'bowl',quantity:1,amount:1350,grossAmount:1350,paidAmount:1350,discountAmount:0,couponDiscountAmount:0,couponId:'',refundStatus:'',refundedAmount:0,refundSnapshot:null,refundedOptionKeys:[],customizations:[{groupId:'drinks',groupKey:'addon',groupName:'飲料',optionIds:['cola'],optionKeys:['cola'],optionLabels:['コーラ'],optionPrices:[350],optionDisplayNames:[{en:'Cola'}]}],...patch});
test('one drink refunds only its immutable paid share and preserves the bowl',()=>{
 const p=planPosRefund([item()],1350,[],[{itemId:'bowl',key:'0:0'}]);assert.equal(p.amount,350);assert.equal(p.allRefunded,false);assert.equal(p.updates[0].quantity,0);assert.equal(p.updates[0].stampQuantity,0);assert.equal(p.updates[0].couponId,'');assert.deepEqual(p.updates[0].customizations,[]);
 const next=item({refundedAmount:350,refundStatus:'partial',refundSnapshot:p.updates[0].snapshot,refundedOptionKeys:['0:0'],customizations:[]});
 assert.equal(planPosRefund([next],1000,['bowl'],[]).amount,1000);assert.throws(()=>planPosRefund([next],1000,[],[{itemId:'bowl',key:'0:0'}]),/返金済み/);
});
test('discounts, regular coupons and tax are allocated once without extra refund',()=>{
 assert.equal(planPosRefund([item({discountAmount:270,paidAmount:1080})],1080,[],[{itemId:'bowl',key:'0:0'}]).amount,280);
 assert.equal(planPosRefund([item({couponDiscountAmount:675,couponId:'coupon',paidAmount:675})],675,[],[{itemId:'bowl',key:'0:0'}]).amount,175);
 assert.equal(planPosRefund([item()],1485,[],[{itemId:'bowl',key:'0:0'}]).amount,385);
});
test('exchange coupons remain on the base and restore only with its full return',()=>{
 const i=item({couponDiscountAmount:1000,couponId:'exchange',exchangeCoupon:true,paidAmount:350});
 const p=planPosRefund([i],350,[],[{itemId:'bowl',key:'0:0'}]);assert.equal(p.amount,350);assert.equal(p.updates[0].couponId,'');
 const full=planPosRefund([item({...i,refundedAmount:350,refundSnapshot:p.updates[0].snapshot,refundedOptionKeys:['0:0']})],0,['bowl'],[]);assert.equal(full.amount,0);assert.equal(full.updates[0].couponId,'exchange');assert.equal(full.allRefunded,true);
});
test('local, linked and repeated selections retain aligned identities after refund',()=>{
 const customizations=[{groupId:'g',groupKey:'addon',optionIds:[],storeMenuOptionIds:['local','local'],optionKeys:['local','local'],optionLabels:['ミルク','ミルク'],optionPrices:[100,100],localOptions:[{localOriginId:'a',quantity:1},{localOriginId:'a',quantity:1}]}];
 const i=item({amount:1200,grossAmount:1200,paidAmount:1200,customizations});const snapshot=refundSnapshots([i],1200)[0];const active=activeRefundCustomizations(snapshot,['0:0']);assert.deepEqual(active[0].storeMenuOptionIds,['local']);assert.deepEqual(active[0].optionPrices,[100]);assert.equal((active[0].localOptions as unknown[]).length,1);assert.deepEqual(snapshot.customizations,customizations);
 assert.equal(planPosRefund([i],1200,[],[{itemId:'bowl',key:'0:0'}]).amount,100);
});
test('no current menu lookup; missing historical prices never become guessed refunds',()=>{
 const i=item({customizations:[{optionLabels:['不明'],optionIds:['changed-menu-id']}]});assert.deepEqual(refundSnapshots([i],1350)[0].options,[]);assert.throws(()=>planPosRefund([i],1350,[],[{itemId:'bowl',key:'0:0'}]),/確認できない/);assert.equal(planPosRefund([i],1350,['bowl'],[]).amount,1350);
});
test('parent/option overlap, duplicates, nonexistent targets and spent balances are rejected',()=>{
 const s={itemId:'bowl',key:'0:0'};assert.throws(()=>planPosRefund([item()],1350,['bowl'],[s]),/同時/);assert.throws(()=>planPosRefund([item()],1350,[],[s,s]),/重複/);assert.throws(()=>planPosRefund([item()],1350,['other'],[]),/見つかりません/);assert.throws(()=>planPosRefund([item({refundStatus:'refunded'})],0,['bowl'],[]),/返金済み/);
});
test('multiple quantities and mixed whole/option selections use disjoint actual paid shares',()=>{
 const a=item({quantity:2,amount:2700,grossAmount:2700,paidAmount:2700});assert.equal(planPosRefund([a],2700,[],[{itemId:'bowl',key:'0:0'}]).amount,700);
 const b=item({id:'bowl-2'});const p=planPosRefund([item(),b],2700,['bowl-2'],[{itemId:'bowl',key:'0:0'}]);assert.equal(p.amount,1700);assert.equal(p.allRefunded,false);
});
test('yen rounding stays exact and total refunds never exceed a heavily discounted sale',()=>{
 for(let gross=1;gross<=150;gross++){for(const paid of [0,1,Math.floor(gross/3),gross]){
 const i=item({amount:gross,grossAmount:gross,paidAmount:paid,discountAmount:gross-paid,customizations:[{optionLabels:['A','B'],optionPrices:[1,Math.max(1,gross-1)]}]});const snap=refundSnapshots([i],paid)[0];assert.ok(snap.options.reduce((n,o)=>n+o.paidAmount,0)<=paid);
 assert.equal(allocateRefundYen(paid,[gross,1,1]).reduce((a,b)=>a+b,0),paid);
 }}
 assert.deepEqual(allocateRefundYen(2,[1,1,1]),[1,1,0]);assert.throws(()=>allocateRefundYen(1,[0,0]));
});
