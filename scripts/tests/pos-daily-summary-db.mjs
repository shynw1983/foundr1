// Actual POS checkout/refund routes and daily SQL projection against isolated PostgreSQL.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPrintDocumentFixture } from './pos-print-document-fixture.mjs';
const out = process.env.POS_SUMMARY_OUTPUT || resolve('outputs/pos-daily-summary-db');
await mkdir(out,{recursive:true});
const f = await createPrintDocumentFixture(process.cwd());
const { db, ids, state } = f;
const { getTodaySummary } = f.load('lib/pos-daily-summary-data.ts');
const { summarizePosProducts } = f.load('lib/pos-daily-summary.ts');
const checks=[]; let seq=9000;
const uuid=()=>`00000000-0000-4000-8000-${String(seq++).padStart(12,'0')}`;
const body=async(r,code=200)=>{assert.equal(r.status,code,await r.clone().text());return r.json()};
async function checkout(patch={}) {return body(await f.postCheckout({offlineClientOrderId:uuid(),discountPresetKey:'',cashTenderedAmount:10000,...patch}));}
const stats=()=>getTodaySummary(ids.store);
try {
 assert.deepEqual(JSON.parse(JSON.stringify((await stats()).products)),[]);checks.push('empty_day_zero_summary');
 const two=await checkout({items:[{menuCatalogItemId:ids.menu,quantity:2,selectedOptions:[]}]});
 let s=await stats();assert.equal(s.orderCount,1);assert.equal(s.products[0].quantity,2);assert.equal(s.products[0].isBowl,true);assert.equal(s.products[0].total,s.total);assert.equal(s.products[0].average,815);checks.push('one_payment_two_bowls_counts_two_with_correct_average');
 const drink=uuid();await db.query(`insert into menu_catalog_items(id,brand_id,name,item_kind,base_price) values($1,$2,'烏龍茶','drink',200)`,[drink,ids.brand]);
 await db.query('update menu_options set price_delta=100 where id=$1',[ids.option]);
 const mixed=await checkout({items:[{menuCatalogItemId:ids.menu,quantity:1,selectedOptions:[{groupId:ids.optionGroup,optionIds:[ids.option]}]},{menuCatalogItemId:drink,quantity:2,selectedOptions:[]}]});
 s=await stats();const bowl=s.products.find(p=>p.isBowl),tea=s.products.find(p=>!p.isBowl);assert.equal(bowl.quantity,3);assert.equal(bowl.total,2545);assert.equal(bowl.average,848);assert.equal(tea.quantity,2);assert.equal(tea.total,400);assert.equal(tea.average,200);assert.equal(s.products.reduce((n,p)=>n+p.total,0),s.total);checks.push('paid_options_stay_on_bowl_and_standalone_drinks_remain_separate');
 const oldTotal=s.total;await db.query("update menu_catalog_items set name='新名',base_price=9999 where id=$1",[ids.menu]);s=await stats();assert.equal(s.total,oldTotal);assert.equal(s.products.find(p=>p.isBowl).name,'原メニュー 麻辣湯');checks.push('catalog_rename_and_price_edit_do_not_reprice_historical_sales');await db.query("update menu_catalog_items set name='原メニュー 麻辣湯',base_price=815 where id=$1",[ids.menu]);
 const before=s;for(const [status,payment,source,store,time] of [['new','pending','table_qr',ids.store,'now()'],['cancelled','paid','store_pos',ids.store,'now()'],['ready','refunded','store_pos',ids.store,'now()'],['refund_pending','paid','store_pos',ids.store,'now()'],['ready','paid','web',ids.store,'now()'],['ready','paid','store_pos',ids.other,'now()'],['ready','paid','store_pos',ids.store,"(date_trunc('day',now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo') - interval '1 millisecond'"],['ready','paid','store_pos',ids.store,"(date_trunc('day',now() at time zone 'Asia/Tokyo') + interval '1 day') at time zone 'Asia/Tokyo'"]]) {
  await db.query(`insert into store_customer_orders(id,store_id,pickup_code,pickup_date,pickup_time,status,payment_status,order_source,amount,created_at) values($1,$2,'X',current_date,'12:00',$3,$4,$5,99999,${time})`,[uuid(),store,status,payment,source]);
 }
 s=await stats();assert.equal(s.total,before.total);assert.equal(s.orderCount,before.orderCount);assert.deepEqual(JSON.parse(JSON.stringify(s.products)),JSON.parse(JSON.stringify(before.products)));checks.push('store_paid_source_cancel_refund_and_JST_end_boundaries');
 // Actual option refund updates amount without removing the remaining bowl.
 const itemRows=(await db.query('select id::text from store_customer_order_items where order_id=$1 order by sort_order',[mixed.orderId])).rows;
 const refund=await body(await f.refund({orderId:mixed.orderId,requestId:uuid(),itemIds:[],optionSelections:[{itemId:itemRows[0].id,key:'0:0'}],reason:'テスト',externalRefundConfirmed:false}));
 assert.equal(refund.todaySummary.products.find(p=>p.isBowl).quantity,3);assert.equal(refund.todaySummary.products.find(p=>p.isBowl).total,2445);checks.push('actual_option_refund_response_recomputes_amount_without_removing_bowl');
 const full=await body(await f.refund({orderId:two.orderId,requestId:uuid(),itemIds:[],optionSelections:[],reason:'テスト',externalRefundConfirmed:false}));
 assert.equal(full.todaySummary.orderCount,1);assert.equal(full.todaySummary.products.find(p=>p.isBowl).quantity,1);checks.push('actual_full_refund_removes_payment_and_bowl_quantities');
 // Tax-exclusive lines and 100% discount must use saved allocations, not nullif(paid,0).
 await db.query(`update pos_store_settings set price_tax_mode='exclusive' where store_id=$1`,[ids.store]);
 const taxed=await checkout({items:[{menuCatalogItemId:ids.menu,quantity:1,selectedOptions:[]},{menuCatalogItemId:drink,quantity:1,selectedOptions:[]}]});s=await stats();assert.equal(s.products.reduce((n,p)=>n+p.total,0),s.total);checks.push('exclusive_tax_allocations_sum_to_actual_order_total');
 const pureItem={id:'a',catalogId:'source',localId:'localA',name:'A',isBowl:true,quantity:1,refundedQuantity:0,refundedAmount:0,paidAmount:0};
 const free=summarizePosProducts([{id:'free',amount:0,items:[pureItem]}]);assert.equal(free[0].quantity,1);assert.equal(free[0].total,0);checks.push('fully_discounted_paid_bowl_stays_zero_yen_not_original_price');
 const versions=summarizePosProducts([{id:'v',amount:300,items:[{...pureItem,paidAmount:100},{...pureItem,id:'b',localId:'localB',name:'B',paidAmount:200}]}]);assert.equal(versions.length,2);checks.push('separate_store_menu_versions_do_not_merge_on_same_source_product');
 const snapshot=summarizePosProducts([{id:'s',amount:700,items:[{...pureItem,paidAmount:1000,refundedAmount:300,snapshotPaidAmount:1000}]}]);assert.equal(snapshot[0].total,700);assert.equal(snapshot[0].quantity,1);checks.push('saved_refund_snapshot_is_authoritative_for_partial_option_refund');
 const partial=summarizePosProducts([{id:'p',amount:500,items:[{...pureItem,quantity:3,refundedQuantity:1,paidAmount:900,refundedAmount:400,snapshotPaidAmount:900}]}]);assert.equal(partial[0].quantity,2);assert.equal(partial[0].average,250);checks.push('partial_refunded_quantity_and_rounding_are_respected');
 // A historical row without structured lines still counts as a settled payment.
 const legacy=uuid();await db.query(`insert into store_customer_orders(id,store_id,pickup_code,pickup_date,pickup_time,status,payment_status,order_source,amount) values($1,$2,'OLD',current_date,'12:00','ready','paid','store_pos',123)`,[legacy,ids.store]);const withLegacy=await stats();assert.equal(withLegacy.total,s.total+123);assert.equal(withLegacy.products.reduce((n,p)=>n+p.total,0),s.total);checks.push('legacy_unstructured_payment_does_not_invent_product_quantity');
 // Refund allocation uses stable item-ID order, not catalog/display sort order.
 const tieOrder=uuid(),firstId=uuid(),secondId=uuid();
 await db.query(`insert into store_customer_orders(id,store_id,pickup_code,pickup_date,pickup_time,status,payment_status,order_source,amount) values($1,$2,'TAX',current_date,'12:00','ready','partial_refunded','store_pos',10)`,[tieOrder,ids.store]);
 await db.query(`insert into store_customer_order_items(id,order_id,item_name,quantity,amount,gross_amount,paid_amount,refunded_amount,refund_snapshot,sort_order) values($1,$3,'Tax A',1,5,5,5,1,'{"version":1,"paidAmount":6}',1),($2,$3,'Tax B',1,5,5,5,0,null,0)`,[firstId,secondId,tieOrder]);
 const tied=await stats();assert.equal(tied.products.find(p=>p.name==='Tax A').total,5);assert.equal(tied.products.find(p=>p.name==='Tax B').total,5);checks.push('tax_rounding_tie_matches_refund_item_ID_order_not_display_order');
 const route=f.reload('app/api/store/pos/route.ts');await body(await route.GET(f.request('/api/store/pos?storeId='+ids.other)),403);const keep=state.session;state.session=null;await body(await route.GET(f.request('/api/store/pos?storeId='+ids.store)),401);state.session=keep;checks.push('API_scope_and_anonymous_guards_remain_intact');
 assert.equal(state.externalCalls,0);await writeFile(out+'/report.json',JSON.stringify({passed:true,checks,productionWrites:0,externalCalls:0},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{await db.close()}
