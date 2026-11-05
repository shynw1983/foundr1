// Actual POS fulfillment route/SQL and existing sales/dining/pickup projections in isolated PostgreSQL.
// No production DATABASE_URL, authentication cookie or external request is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { PGlite } = await import(process.env.FOUNDR1_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const root = new URL('../../', import.meta.url);
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const ids = { store:uuid(1), other:uuid(2), actor:uuid(3), baseSession:uuid(4), brand:uuid(5), dining:uuid(6) };
let session = { id:ids.actor, role:'store_manager', sessionId:ids.baseSession, sessionVersion:1 };
let mayOperate = true, pinReady = true, failGuard = false;
let events = [], inventory = [];
const schema = readFileSync(new URL('db/schema.sql', root),'utf8');
const stripRefs = source => source.replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi,'');
for (const table of ['stores','employees','pos_store_settings','store_customer_orders','store_customer_order_items','order_production_tasks','sales_orders','sales_order_items','menu_catalog_items','store_dining_sessions','store_dining_session_orders']) {
  const create=schema.match(new RegExp(`create table if not exists ${table} \\([\\s\\S]*?\\n\\);`));
  assert.ok(create,`actual schema: ${table}`);
  await db.exec(stripRefs(create[0]));
  for (const alter of schema.matchAll(new RegExp(`alter table ${table} add column[^;]*;`,'g'))) await db.exec(stripRefs(alter[0]));
}
// Apply the actual final dining-state constraint after its data-preserving schema conversion.
await db.exec(schema.match(/alter table store_dining_sessions drop constraint if exists store_dining_sessions_status_check;[\s\S]*?check \(status in \('seated', 'dining', 'cleaning', 'completed'\)\);/)[0]);
await db.query(`insert into stores(id,name) values($1,'桜並木テスト'),($2,'他店')`,[ids.store,ids.other]);
await db.query(`insert into employees(id,name,role) values($1,'担当','store_manager')`,[ids.actor]);
await db.query(`insert into pos_store_settings(store_id,printer_settings) values($1,'{"fulfillmentWorkspace":{"enabled":true,"overdueMinutes":15}}')`,[ids.store]);
await db.query(`insert into store_dining_sessions(id,store_id,table_group_label,status,order_status) values($1,$2,'A1','seated','cooking')`,[ids.dining,ids.store]);
const sql=Object.assign((parts,...values)=>{
  let text='',bound=[];
  for(let index=0;index<parts.length;index++){
    text+=parts[index];if(index>=values.length)continue;
    const value=values[index];if(value?.__fixtureUnsafe)text+=value.text;
    else{bound.push(value);text+=`$${bound.length}`;}
  }
  return {text,values:bound,then(resolve,reject){return db.query(this.text,this.values).then(result=>result.rows).then(resolve,reject);}};
},{unsafe:text=>({__fixtureUnsafe:true,text}),transaction:statements=>db.transaction(async connection=>{
  const results=[];for(const statement of statements)results.push((await connection.query(statement.text,statement.values)).rows);return results;
})});
const failure=(error,status)=>({ok:false,response:Response.json({error},{status})});
const validateStore=async(_base,storeId)=>storeId!==ids.store||!mayOperate?failure('権限がありません。',403):null;
const modules={
  db:{sql}, 'api-auth':{requireOsSession:async()=>session,canAccessStore:async(_base,id)=>id===ids.store},
  'pos-operator-access':{validatePosOperatorStore:validateStore,requirePosOperatorForWrite:async(base,storeId)=>{
    const denied=await validateStore(base,storeId); if(denied)return denied;
    return pinReady?{ok:true,actor:base,writeGuards:failGuard?[sql`select 1/0`]:[]}:failure('レジ担当者の本人確認をしてください。',401);
  }},
  'pos-operator-credentials':{assertPosOperatorSameOrigin:request=>request.headers.get('origin')==='http://test'?null:Response.json({error:'不正なリクエスト元です。'},{status:403}),posOperatorDatabaseFailure:()=>null},
  'inventory-order-usage':{safeSyncInventoryOrderUsage:async orderId=>{inventory.push(orderId);return 'already';}},
  'order-realtime':{publishCustomerOrderEvent:async(_event,order)=>events.push(order.id)},
  'customer-orders':{findCustomerOrderById:async id=>({id})},
  'role-permissions':{roleHasPermission:async()=>mayOperate},
  'store-order-access':{getStoreOrderAccess:async()=>({stores:[{id:ids.store}],canCancelOrders:true}),getScopedStoreFilter:(_a,id)=>id===ids.store?id:'__forbidden__',canChangeOrderStatus:(_a,status)=>['preparing','ready','completed','cancelled'].includes(status)},
  'store-order-alert-events':{cancelPendingStoreOrderAlerts:async()=>{},acknowledgePreparationDueAlert:async()=>{}},
  'order-production':{ensureProductionTasksForOrder:async()=>{},ensureOrderProductionEstimate:async()=>{}}
};
function load(path){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Request,Response,URL,console,require:name=>{if(name==='next/headers')return {cookies:async()=>({get:()=>undefined})};const dependency=modules[name.split('/').at(-1)];assert.ok(dependency,`unexpected dependency ${name}`);return dependency;}});return exports;}
for(const name of ['pos-serving-policy','pos-item-fulfillment','pos-production-task-filter','pos-operator-policy','pos-fulfillment-policy','pos-fulfillment-settings','store-order-pagination','sales-orders','store-dining-sessions','pos-fulfillment','pos-bowl-data']) modules[name]=load(`lib/${name}.ts`);
const route=load('app/api/store/pos/fulfillment/route.ts'),pickup=load('app/api/store/display/pickup/route.ts'),orders=load('app/api/store/orders/route.ts');
let counter=100, mutationCounter=1000, groups=0;
const makeSale=async(count=3,patch={})=>{
  const orderId=uuid(counter++),tickets=[];
  await db.query(`insert into store_customer_orders(id,store_id,brand_id,order_source,pickup_code,status,payment_status,pickup_date,pickup_time,amount,customer_summary,inventory_source_snapshot)
    values($1,$2,$3,'store_pos',$4,$5,$6,current_date,'12:00',3000,'{"orderType":"eat_in","note":"整单备注不要复制到每碗","diningSeatLabel":"A1"}', '{"identityConfidence":"verified"}')`,
    [orderId,patch.storeId||ids.store,ids.brand,`POS${counter}`,patch.status||'new',patch.paymentStatus||'paid']);
  for(let i=0;i<count;i++){
    const itemId=uuid(counter++),taskId=uuid(counter++),code=String(counter).padStart(3,'0');
    await db.query(`insert into store_customer_order_items(id,order_id,item_name,quantity,pickup_code,preparation_note,refund_status)
      values($1,$2,'マーラータン',1,$3,$4,$5)`,[itemId,orderId,code,i===0?'この碗のみ辛さなし':'',patch.refundStatus||'']);
    await db.query(`insert into order_production_tasks(id,order_id,store_id,order_item_id,pickup_code,item_summary)
      values($1,$2,$3,$4,$5,$6)`,[taskId,orderId,patch.storeId||ids.store,itemId,code,'マーラータン x1\n・春雨\n・牛すじ50g']);
    tickets.push({id:taskId,itemId,code});
  }
  return {orderId,tickets};
};
const read=async()=>{const response=await route.GET(new Request(`http://test/fulfillment?storeId=${ids.store}`));assert.equal(response.status,200);return response.json();};
const getTask=async id=>(await read()).tasks.find(task=>task.id===id);
const post=(body,origin='http://test')=>route.POST(new Request('http://test/fulfillment',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)}));
const payload=async(taskId,action,patch={})=>({storeId:ids.store,taskId,action,expectedVersion:(await getTask(taskId))?.version,mutationId:uuid(mutationCounter++),...patch});
const perform=async(taskId,action,patch={})=>{const body=await payload(taskId,action,patch);const response=await post(body);assert.equal(response.status,200,await response.clone().text());return {body,result:await response.json()};};
const orderState=async id=>(await db.query('select * from store_customer_orders where id=$1',[id])).rows[0];
const stateSnapshot=async()=>JSON.stringify((await db.query(`select (select jsonb_agg(t order by id) from store_customer_orders t) orders,
  (select jsonb_agg(t order by id) from order_production_tasks t) tasks,(select jsonb_agg(t order by id) from sales_orders t) sales`)).rows);
const denied=async(body,status)=>{const before=await stateSnapshot(),n=events.length;const response=await post(body);assert.equal(response.status,status,await response.clone().text());assert.equal(await stateSnapshot(),before);assert.equal(events.length,n);};
try{
  const sale=await makeSale();
  await db.query('insert into store_dining_session_orders(session_id,order_id) values($1,$2)',[ids.dining,sale.orderId]);
  let tasks=(await read()).tasks;assert.equal(tasks.length,3);assert.ok(tasks.every(t=>t.status==='waiting'));
  assert.equal(tasks[0].note,'整单备注不要复制到每碗 / この碗のみ辛さなし');assert.equal(tasks[1].note,'整单备注不要复制到每碗');
  assert.ok(!('customerSummary' in tasks[0]));
  groups++;
  const ready=await perform(sale.tickets[0].id,'ready');
  assert.equal(ready.result.tasks.filter(t=>t.status==='ready').length,1);
  assert.equal((await orderState(sale.orderId)).status,'preparing');
  assert.equal((await db.query('select status,total,payment_status from sales_orders where source_order_id=$1',[sale.orderId])).rows[0].status,'preparing');
  assert.ok((await orderState(sale.orderId)).inventory_first_prepared_at);
  assert.ok(inventory.includes(sale.orderId));assert.ok(events.includes(sale.orderId));
  let queue=await (await pickup.GET(new Request(`http://test/pickup?storeId=${ids.store}`))).json();
  assert.equal(queue.ready[0].pickupCode,sale.tickets[0].code);assert.equal(queue.ready[0].callVersion,1);
  groups++;
  const replayResponse=await post(ready.body);assert.equal(replayResponse.status,200);assert.equal((await replayResponse.json()).replayed,true);
  assert.equal((await getTask(sale.tickets[0].id)).version,ready.result.undo.version);
  await denied({...ready.body,action:'handoff'},409);
  await denied({...ready.body,mutationId:uuid(mutationCounter++)},409);
  groups++;
  const recall=await perform(sale.tickets[0].id,'recall');assert.equal(recall.result.undo,null);
  queue=await (await pickup.GET(new Request(`http://test/pickup?storeId=${ids.store}`))).json();
  assert.equal(queue.ready[0].callVersion,2);
  await perform(sale.tickets[0].id,'recall');
  queue=await (await pickup.GET(new Request(`http://test/pickup?storeId=${ids.store}`))).json();assert.equal(queue.ready[0].callVersion,3);
  await denied({...ready.body,mutationId:uuid(mutationCounter++),action:'undo',undoToken:ready.result.undo.token,expectedVersion:ready.result.undo.version},409);
  groups++;
  const handoff=await perform(sale.tickets[0].id,'handoff');assert.equal(handoff.result.tasks.length,2);
  assert.notEqual((await orderState(sale.orderId)).status,'completed');
  let response=await post({...handoff.body,action:'undo',mutationId:uuid(mutationCounter++),undoToken:handoff.result.undo.token,expectedVersion:handoff.result.undo.version});
  assert.equal(response.status,200,await response.clone().text());assert.equal((await getTask(sale.tickets[0].id)).status,'ready');
  groups++;
  // One parent's row lock and version guard admit only one different action from one displayed revision.
  const concurrentBody=await payload(sale.tickets[1].id,'ready');
  const concurrent=await Promise.all([post(concurrentBody),post({...concurrentBody,mutationId:uuid(mutationCounter++)})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const duplicateBody=await payload(sale.tickets[2].id,'ready');
  const duplicate=await Promise.all([post(duplicateBody),post(duplicateBody)]);assert.deepEqual(duplicate.map(r=>r.status),[200,200]);
  assert.equal((await orderState(sale.orderId)).status,'ready');
  assert.equal((await db.query('select status,order_status from store_dining_sessions where id=$1',[ids.dining])).rows[0].status,'dining');
  groups++;
  for(const ticket of sale.tickets.slice(0,2)) await perform(ticket.id,'handoff');
  const final=await perform(sale.tickets[2].id,'handoff');assert.equal((await orderState(sale.orderId)).status,'completed');
  assert.equal((await db.query('select status,total,payment_status from sales_orders where source_order_id=$1',[sale.orderId])).rows[0].status,'completed');
  assert.equal((await db.query('select count(*)::int n from store_customer_orders where id=$1',[sale.orderId])).rows[0].n,1);
  const firstPrepared=(await orderState(sale.orderId)).inventory_first_prepared_at;
  response=await post({...final.body,action:'undo',mutationId:uuid(mutationCounter++),undoToken:final.result.undo.token,expectedVersion:final.result.undo.version});
  assert.equal(response.status,200,await response.clone().text());assert.equal((await orderState(sale.orderId)).status,'ready');
  assert.equal((await orderState(sale.orderId)).completed_at,null);
  assert.deepEqual((await orderState(sale.orderId)).inventory_first_prepared_at,firstPrepared);
  assert.equal((await orderState(sale.orderId)).payment_status,'paid');assert.equal((await orderState(sale.orderId)).amount,3000);
  groups++;
  const undoSale=await makeSale(2);const undoReady=await perform(undoSale.tickets[0].id,'ready');
  const undoRequest={...undoReady.body,action:'undo',mutationId:uuid(mutationCounter++),undoToken:undoReady.result.undo.token,expectedVersion:undoReady.result.undo.version};
  const originalActor=session;session={...session,id:uuid(91)};await denied(undoRequest,409);session=originalActor;
  session={...session,sessionId:uuid(92)};await denied(undoRequest,409);session=originalActor;
  response=await post(undoRequest);assert.equal(response.status,200,await response.clone().text());
  assert.equal((await getTask(undoSale.tickets[0].id)).productionStatus,'new');
  assert.ok((await orderState(undoSale.orderId)).inventory_first_prepared_at);
  const afterUndoCall=(await orderState(undoSale.orderId)).customer_summary.posFulfillmentTasks[undoSale.tickets[0].id].callVersion;
  assert.equal(afterUndoCall,1);
  groups++;
  const staleUndo=await perform(undoSale.tickets[0].id,'ready');await perform(undoSale.tickets[1].id,'ready');
  queue=await (await pickup.GET(new Request(`http://test/pickup?storeId=${ids.store}`))).json();
  assert.equal(queue.ready.find(row=>row.pickupCode===undoSale.tickets[0].code).callVersion,2);
  await denied({...staleUndo.body,action:'undo',mutationId:uuid(mutationCounter++),undoToken:staleUndo.result.undo.token,expectedVersion:staleUndo.result.undo.version},409);
  const legacyRace=await makeSale(2),legacyUndo=await perform(legacyRace.tickets[0].id,'ready');
  // An older kitchen client does not know our metadata namespace; the full task-set digest still catches its write.
  await db.query("update order_production_tasks set status='preparing',started_at=now(),updated_at=clock_timestamp() where id=$1",[legacyRace.tickets[1].id]);
  await denied({...legacyUndo.body,action:'undo',mutationId:uuid(mutationCounter++),undoToken:legacyUndo.result.undo.token,expectedVersion:legacyUndo.result.undo.version},409);
  const expiring=await perform(undoSale.tickets[1].id,'handoff');
  await db.query(`update store_customer_orders set customer_summary=jsonb_set(customer_summary,ARRAY['posFulfillmentTasks',$1,'expiresAt'],to_jsonb((now()-interval '1 second')::text)) where id=$2`,[undoSale.tickets[1].id,undoSale.orderId]);
  await denied({...expiring.body,action:'undo',mutationId:uuid(mutationCounter++),undoToken:expiring.result.undo.token,expectedVersion:expiring.result.undo.version},409);
  groups++;
  const partial=await makeSale(2);const partialReady=await perform(partial.tickets[0].id,'ready');
  await db.query("update store_customer_order_items set refund_status='refunded' where id=$1",[partial.tickets[1].itemId]);
  await db.query("update store_customer_orders set payment_status='partial_refunded' where id=$1",[partial.orderId]);
  const refundedTask=(await db.query(`select md5(concat_ws('|',status,started_at::text,ready_at::text,handed_off_at::text,updated_at::text)) version from order_production_tasks where id=$1`,[partial.tickets[1].id])).rows[0];
  await denied({storeId:ids.store,taskId:partial.tickets[1].id,action:'ready',expectedVersion:refundedTask.version,mutationId:uuid(mutationCounter++)},409);
  await perform(partial.tickets[0].id,'handoff');assert.equal((await orderState(partial.orderId)).status,'completed');
  const refundUndoSale=await makeSale(1),refundUndo=await perform(refundUndoSale.tickets[0].id,'ready');
  await db.query("update store_customer_order_items set refund_status='refunded' where id=$1",[refundUndoSale.tickets[0].itemId]);
  await denied({...refundUndo.body,action:'undo',mutationId:uuid(mutationCounter++),undoToken:refundUndo.result.undo.token,expectedVersion:refundUndo.result.undo.version},409);
  const cancelled=await makeSale(1),pending=await payload(cancelled.tickets[0].id,'ready');
  await db.query("update store_customer_orders set status='cancelled' where id=$1",[cancelled.orderId]);await denied(pending,409);
  const unpaid=await makeSale(1,{paymentStatus:'pending'});
  await denied({...pending,taskId:unpaid.tickets[0].id,mutationId:uuid(mutationCounter++)},409);
  groups++;
  // Mixed sale: the grouped drink task calls independently of waiting bowls and refunded groups do not block completion.
  const mixed=await makeSale(1),drinkBrand=uuid(counter++),drinkMenu=uuid(counter++),drinkItem=uuid(counter++),drinkTask=uuid(counter++);
  await db.query(`insert into menu_catalog_items(id,brand_id,name) values($1,$2,'ミルクティー')`,[drinkMenu,drinkBrand]);
  await db.query(`insert into store_customer_order_items(id,order_id,menu_catalog_item_id,item_name,quantity) values($1,$2,$3,'ミルクティー',1)`,[drinkItem,mixed.orderId,drinkMenu]);
  await db.query(`insert into order_production_tasks(id,order_id,store_id,brand_id,item_summary) values($1,$2,$3,$4,'ミルクティー x1')`,[drinkTask,mixed.orderId,ids.store,drinkBrand]);
  const drinkReady=await perform(drinkTask,'ready');
  queue=await (await pickup.GET(new Request(`http://test/pickup?storeId=${ids.store}`))).json();
  const mixedCode=(await orderState(mixed.orderId)).pickup_code;
  assert.ok(queue.ready.some(row=>row.pickupCode===mixedCode&&row.callVersion===1));
  assert.ok(queue.preparing.some(row=>row.pickupCode===mixed.tickets[0].code));
  const otherGroupedTask=uuid(counter++);
  await db.query(`insert into order_production_tasks(id,order_id,store_id,brand_id,production_area,item_summary) values($1,$2,$3,$4,'dessert','デザート x1')`,[otherGroupedTask,mixed.orderId,ids.store,drinkBrand]);
  await perform(otherGroupedTask,'ready');
  await perform(drinkTask,'handoff');
  queue=await (await pickup.GET(new Request(`http://test/pickup?storeId=${ids.store}`))).json();
  assert.equal(queue.ready.find(row=>row.pickupCode===mixedCode).callVersion,2);
  await perform(otherGroupedTask,'recall');
  queue=await (await pickup.GET(new Request(`http://test/pickup?storeId=${ids.store}`))).json();
  assert.equal(queue.ready.find(row=>row.pickupCode===mixedCode).callVersion,3);
  await db.query("update store_customer_order_items set refund_status='refunded' where id=$1",[drinkItem]);
  await db.query("update store_customer_orders set payment_status='partial_refunded' where id=$1",[mixed.orderId]);
  assert.equal((await read()).tasks.some(task=>task.id===drinkTask),false);
  queue=await (await pickup.GET(new Request(`http://test/pickup?storeId=${ids.store}`))).json();assert.equal(queue.ready.some(row=>row.pickupCode===mixedCode),false);
  await perform(mixed.tickets[0].id,'ready');await perform(mixed.tickets[0].id,'handoff');
  assert.equal((await orderState(mixed.orderId)).status,'completed');
  // If the last outstanding grouped item is refunded after a bowl handoff, the existing refund finalizer closes it.
  const refundLast=await makeSale(1),lastItem=uuid(counter++),lastTask=uuid(counter++);
  await db.query(`insert into store_customer_order_items(id,order_id,menu_catalog_item_id,item_name,quantity) values($1,$2,$3,'ミルクティー',1)`,[lastItem,refundLast.orderId,drinkMenu]);
  await db.query(`insert into order_production_tasks(id,order_id,store_id,brand_id,item_summary) values($1,$2,$3,$4,'ミルクティー x1')`,[lastTask,refundLast.orderId,ids.store,drinkBrand]);
  await perform(refundLast.tickets[0].id,'ready');await perform(refundLast.tickets[0].id,'handoff');
  assert.notEqual((await orderState(refundLast.orderId)).status,'completed');
  await db.query("update store_customer_order_items set refund_status='refunded' where id=$1",[lastItem]);
  await modules['pos-bowl-data'].finishHandedOffPosOrder(refundLast.orderId);
  assert.equal((await orderState(refundLast.orderId)).status,'completed');
  // A null-item group's child refund changes no task row or fulfillment metadata, but still revokes an earlier bowl undo.
  const refundAfterReady=await makeSale(1),groupItem=uuid(counter++),groupTask=uuid(counter++);
  await db.query(`insert into store_customer_order_items(id,order_id,menu_catalog_item_id,item_name,quantity) values($1,$2,$3,'ミルクティー',1)`,[groupItem,refundAfterReady.orderId,drinkMenu]);
  await db.query(`insert into order_production_tasks(id,order_id,store_id,brand_id,item_summary) values($1,$2,$3,$4,'ミルクティー x1')`,[groupTask,refundAfterReady.orderId,ids.store,drinkBrand]);
  const beforeGroupRefund=await perform(refundAfterReady.tickets[0].id,'ready');
  const beforeRefundSummary=(await orderState(refundAfterReady.orderId)).customer_summary;
  await db.query("update store_customer_order_items set refund_status='refunded' where id=$1",[groupItem]);
  await db.query("update store_customer_orders set payment_status='partial_refunded' where id=$1",[refundAfterReady.orderId]);
  assert.deepEqual((await orderState(refundAfterReady.orderId)).customer_summary,beforeRefundSummary);
  await denied({...beforeGroupRefund.body,action:'undo',mutationId:uuid(mutationCounter++),undoToken:beforeGroupRefund.result.undo.token,expectedVersion:beforeGroupRefund.result.undo.version},409);
  assert.equal((await getTask(refundAfterReady.tickets[0].id)).productionStatus,'ready');
  assert.equal((await db.query('select refund_status from store_customer_order_items where id=$1',[groupItem])).rows[0].refund_status,'refunded');
  assert.equal((await orderState(refundAfterReady.orderId)).payment_status,'partial_refunded');
  groups++;
  // Existing whole-order endpoint cannot skip per-bowl preparation or delivery.
  for(const status of ['preparing','ready','completed']){
    response=await orders.PATCH(new Request('http://test/orders',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:undoSale.orderId,status})}));
    assert.equal(response.status,409);assert.equal((await response.json()).code,'per_bowl_fulfillment_required');
  }
  groups++;
  const scoped=await makeSale(1),scopedBody=await payload(scoped.tickets[0].id,'ready');
  await denied({...scopedBody,storeId:ids.other},403);
  const foreign=await makeSale(1,{storeId:ids.other});
  await denied({...scopedBody,taskId:foreign.tickets[0].id},409);
  mayOperate=false;await denied(scopedBody,403);mayOperate=true;
  pinReady=false;await denied(scopedBody,401);pinReady=true;
  const beforeOrigin=await stateSnapshot();response=await post(scopedBody,'https://other.test');assert.equal(response.status,403);assert.equal(await stateSnapshot(),beforeOrigin);
  failGuard=true;await denied(scopedBody,503);failGuard=false;
  await db.query(`update pos_store_settings set printer_settings='{"fulfillmentWorkspace":{"enabled":false}}' where store_id=$1`,[ids.store]);
  assert.equal((await read()).tasks.length,0);await denied(scopedBody,409);
  // The separately unpublished PIN migration is not required for this optional workspace.
  await db.exec('alter table pos_store_settings drop column if exists operator_settings');
  const realOperatorAccess=load('lib/pos-operator-access.ts');
  assert.equal((await realOperatorAccess.readPosOperatorSettings(ids.store)).enabled,false);
  const defaultOffOperator=await realOperatorAccess.requirePosOperatorForWrite(session,ids.store,scopedBody,'checkout',false);
  assert.equal(defaultOffOperator.ok,true);assert.equal(defaultOffOperator.enabled,false);
  assert.equal(defaultOffOperator.writeGuards.length,0);
  session=null;await denied(scopedBody,401);assert.equal((await route.GET(new Request(`http://test/fulfillment?storeId=${ids.store}`))).status,401);
  groups++;
  console.log(`PASS ${groups} POS fulfillment groups: actual route/SQL; scope/origin/PIN and atomic guard denial; paid three-bowl queue; no whole-order shortcut; partial refund/cancel; stale and duplicate actions; concurrent revisions; ready/callVersion/recall; 15s operator-bound undo; full handoff/undo sales projection; inventory evidence retained; dining sync.`);
}finally{await db.close();}
