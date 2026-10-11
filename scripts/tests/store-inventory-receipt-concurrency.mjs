// Real PostgreSQL concurrency in a disposable schema on the explicitly authorized test branch.
// Authentication is a fixed scoped test identity. Never reads .env or public business relations.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const require=createRequire(import.meta.url),{Pool,neonConfig}=require("@neondatabase/serverless");
neonConfig.webSocketConstructor=require("ws");
const ts=require("typescript"),root=new URL("../../",import.meta.url);
const source=path=>readFileSync(new URL(path,root),"utf8");
const target=new URL(readFileSync(process.env.FOUNDR1_STORE_INVENTORY_TEST_URL_FILE||"/private/tmp/foundr1-orders-branch-url","utf8").trim());
assert.ok(["ep-dark-heart-apkqrtnx-pooler.c-7.us-east-1.aws.neon.tech","ep-dark-heart-apkqrtnx.c-7.us-east-1.aws.neon.tech"].includes(target.hostname),"Authorized test host mismatch");
assert.equal(target.pathname,"/neondb","Authorized test database mismatch");
target.hostname=target.hostname.replace("-pooler.",".");
const output=process.env.FOUNDR1_STORE_INVENTORY_CONCURRENCY_PROOF||"/private/tmp/foundr1-store-receipts-concurrency-proof.json";
const schema=`store_receipt_concurrency_${randomUUID().replaceAll("-","")}`;
const pool=new Pool({connectionString:target.toString(),max:3,connectionTimeoutMillis:15000});
const uuid=n=>`00000000-0000-4000-8000-${String(600+n).padStart(12,"0")}`;
const ids=Object.fromEntries([
  "store","otherStore","employee","product","privateProduct","unrelatedPrivateProduct",
  "location","secondLocation","thirdLocation","otherLocation","stock","legacyStock","privateStock",
  "unknownStock","wrongLocationStock","order","otherOrder","line","privateLine","otherLine",
  "requestedLine","unknownQuantityLine","unknownUnitLine","mismatchedActualLine",
  "actual","privateActual","otherActual","mismatchedActual","check","deliveryBatch","otherBatch","actualOnlyLine","actualOnlyActual"
].map((key,index)=>[key,uuid(index+1)]));
const conversion={purchaseUnit:"箱",countUnit:"袋",unitsPerPurchase:12};
const employee={id:ids.employee,name:"Scoped concurrency employee",role:"staff"};
const proof={target:"authorized-isolated-Neon-branch",branchId:"br-young-bread-apuv771q",host:target.hostname,schema,
  actualApis:["Store stock receipts POST","Store procurement receiving PATCH arrival-only and legacy batch"],
  authentication:"fixed scoped helper test identity; no production HTTP/login",groups:[],cleanup:false,sourceHashes:{}};
for(const path of ["app/api/store/inventory/receipts/route.ts","app/api/store/procurement-receiving/route.ts","lib/inventory-receipt-data.ts","lib/inventory-receipt-policy.ts","lib/replenishment-order-locks.ts","lib/procurement-delivery-transition.ts"])
  proof.sourceHashes[path]=createHash("sha256").update(source(path)).digest("hex");
const clean=error=>String(error?.message||error).replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted]").replaceAll(target.password,"[redacted]").replaceAll(decodeURIComponent(target.password),"[redacted]");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
function together(){const gate=deferred();let arrived=0;return async()=>{if(++arrived===2)gate.resolve();await gate.promise;};}

function runtime(client,hooks={}) {
  const execute=async query=>{const rows=(await client.query(query.text,query.values)).rows;
    if(/select\s+(?:batches\.)?id\s+from\s+delivery_batches[\s\S]*for update/i.test(query.text))await hooks.afterBatchLock?.();
    return rows;
  };
  const sql=Object.assign((parts,...values)=>({text:parts.reduce((text,part,index)=>text+part+(index<values.length?`$${index+1}`:""),""),values,
    then(resolve,reject){return execute(this).then(resolve,reject);}
  }),{transaction:async queries=>{await hooks.beforeTransaction?.();await client.query("begin");
    try{const rows=[];for(const query of queries)rows.push(await execute(query));await client.query("commit");return rows;}
    catch(error){await client.query("rollback");throw error;}
  }});
  function load(path,modules={}){
    const exports={};runInNewContext(ts.transpileModule(source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports,Request,Response,URL,console,require:name=>{
        if(name.endsWith("/db")||name==="./db")return{sql};
        if(name.endsWith("/api-auth"))return{requireOsSession:async()=>employee,requireWritableOsSession:async()=>employee,
          canAccessStore:async(_,storeId)=>storeId===ids.store,getSessionStoreScope:async()=>({allStores:false,storeIds:[ids.store]})};
        if(name.endsWith("/role-permissions"))return{roleHasPermission:async()=>true};
        if(name.endsWith("/product-catalog-access"))return{assertProductViewable:async()=>({ok:true}),assertProductViewableAtStore:async()=>({ok:true})};
        if(name.endsWith("/store-inventory-access"))return{
          requireStoreInventoryAccess:async storeId=>storeId===ids.store?{ok:true,baseSession:employee,actor:employee,storeId,operator:{id:employee.id,name:employee.name,role:employee.role,expiresAt:null}}:{ok:false,response:Response.json({error:"store_scope"},{status:403})},
          assertExpectedStoreInventoryOperator:(access,expected)=>expected===access.actor.id?null:Response.json({error:"operator_changed"},{status:409}),
          assertStoreInventorySameOrigin:request=>request.headers.get("origin")===new URL(request.url).origin?null:Response.json({error:"invalid_origin"},{status:403})
        };
        if(name in modules)return modules[name];throw Error(`Unmocked concurrency dependency: ${name}`);
      }});return exports;
  }
  const units=load("lib/product-unit-conversions.ts"),packaging=load("lib/product-packaging-policy.ts",{"./product-unit-conversions":units});
  const packagingData=load("lib/product-packaging-data.ts",{"./product-packaging-policy":packaging});
  const policy=load("lib/inventory-receipt-policy.ts",{"./product-unit-conversions":units,"./product-packaging-policy":packaging}),locks=load("lib/replenishment-order-locks.ts");
  const data=load("lib/inventory-receipt-data.ts",{"./product-unit-conversions":units,"./inventory-receipt-policy":policy,"./replenishment-order-locks":locks,"./product-packaging-policy":packaging,"./product-packaging-data":packagingData});
  const transition=load("lib/procurement-delivery-transition.ts");
  return{data,receipt:load("app/api/store/inventory/receipts/route.ts",{"../../../../../lib/inventory-receipt-policy":policy,"../../../../../lib/inventory-receipt-data":data}),
    receiving:load("app/api/store/procurement-receiving/route.ts",{"../../../../lib/procurement-delivery-transition":transition,"../../../../lib/replenishment-order-locks":locks})};
}
const request=(path,method,body)=>new Request(`https://isolated.test${path}`,{method,headers:{Origin:"https://isolated.test","Content-Type":"application/json"},body:JSON.stringify(body)});
const receiptPost=(api,body)=>api.receipt.POST(request("/api/store/inventory/receipts","POST",body));
const receivingPatch=(api,body)=>api.receiving.PATCH(request("/api/store/procurement-receiving","PATCH",body));
let clients=[],created=false;
try{
  clients=await Promise.all([pool.connect(),pool.connect(),pool.connect()]);const[a,b,observer]=clients;
  const pids=await Promise.all(clients.map(client=>client.query("select pg_backend_pid() pid").then(result=>result.rows[0].pid)));
  assert.equal(new Set(pids).size,3);proof.independentConnections=3;proof.connectionPids=pids;
  await observer.query(`create schema ${schema}`);created=true;
  for(const client of clients){await client.query(`set search_path=${schema},pg_catalog`);await client.query("set statement_timeout='12s'");await client.query("set lock_timeout='8s'");
    assert.equal((await client.query("select current_schema() schema")).rows[0].schema,schema);}
  const fixture=source("scripts/tests/inventory-receipts-db.mjs").match(/async function createOldDatabase\(\) \{[\s\S]*?\n\}\n\nconst stock/)[0].replace(/\n\nconst stock$/,"");
  await runInNewContext(`(async()=>{${fixture};await createOldDatabase();})()`,{db:{exec:sql=>observer.query(sql)},ids,conversion});
  for(const migration of ["20261009_inventory_receipts.sql","20261009_inventory_receipt_unknown_balance.sql","20261011_product_packaging.sql"])
    await observer.query(source(`db/migrations/${migration}`));
  await observer.query(source("db/migrations/20261011_inventory_order_usage.sql").match(/create table if not exists inventory_movements[\s\S]+?\n\);/)[0]);
  const plain=runtime(observer);
  async function reset(mixed=false){await observer.query("truncate inventory_movements,inventory_stock_receipts restart identity");
    await observer.query("update purchase_order_items set status='delivered',store_feedback_confirmed_at=null,store_feedback_confirmed_by=null where id=any($1::uuid[])",[[ids.line,ids.unknownQuantityLine]]);
    await observer.query("update delivery_batches set status='delivered',store_confirmed_at=null,store_confirmed_by=null where id=$1",[ids.deliveryBatch]);
    await observer.query("delete from delivery_batch_items where purchase_order_item_id=$1",[ids.unknownQuantityLine]);
    if(mixed)await observer.query("insert into delivery_batch_items values($1,$2)",[ids.deliveryBatch,ids.unknownQuantityLine]);
    await observer.query("update inventory_items set stock_quantity=6,current_quantity=6,stock_revision=0,last_received_at=null,stock_conversion_snapshot=$2::jsonb,exception_code='',exception_note='' where id=$1",[ids.stock,JSON.stringify(conversion)]);
  }
  async function body(quantity=4,requestId=randomUUID()){const source=await plain.data.readInventoryReceiptSource(ids.line),target=(await observer.query("select stock_revision from inventory_items where id=$1",[ids.stock])).rows[0];
    return{requestId,purchaseOrderItemId:ids.line,inventoryItemId:ids.stock,purchaseQuantity:quantity,mode:"add",expectedSource:source.expectedSource,
      expectedStockRevision:target.stock_revision,expectedConversion:conversion,expectedOperatorId:employee.id,confirmStoreReceiving:true};}
  async function facts(){return(await observer.query(`select stock.stock_quantity::text book,stock.current_quantity::text physical,stock.stock_revision revision,
    (select count(*)::int from inventory_stock_receipts) receipts,(select count(*)::int from inventory_movements) movements,
    (select status from purchase_order_items where id=$2) as "knownStatus",(select status from purchase_order_items where id=$3) as "unknownStatus",
    (select actual_quantity from purchase_order_items where id=$3) as "unknownActual",(select status from delivery_batches where id=$4) as "batchStatus"
    from inventory_items stock where stock.id=$1`,[ids.stock,ids.line,ids.unknownQuantityLine,ids.deliveryBatch])).rows[0];}
  async function waitBlocked(pid){for(let attempt=0;attempt<80;attempt++){if((await observer.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0]?.wait_event_type==="Lock")return;await sleep(50);}throw Error("Expected the second actual API transaction to block on the held lock");}
  await reset();let gate=together(),payload=await body();
  let responses=await Promise.all([receiptPost(runtime(a,{beforeTransaction:gate}),payload),receiptPost(runtime(b,{beforeTransaction:gate}),payload)]);
  assert.deepEqual(responses.map(response=>response.status),[200,200]);let saved=await facts();
  assert.equal(saved.receipts,1);assert.equal(saved.movements,1);assert.equal(saved.revision,1);assert.equal(Number(saved.book),54);assert.equal(Number(saved.physical),6);assert.equal(saved.knownStatus,"received");assert.equal(saved.batchStatus,"received");
  proof.groups.push({name:"same nonce actual receipt API concurrency",statuses:responses.map(response=>response.status),facts:saved});console.log("PASS same nonce, one receipt/movement/book addition");
  await reset();gate=together();const first=await body(2),second={...first,requestId:randomUUID()};
  responses=await Promise.all([receiptPost(runtime(a,{beforeTransaction:gate}),first),receiptPost(runtime(b,{beforeTransaction:gate}),second)]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);saved=await facts();
  assert.equal(saved.receipts,1);assert.equal(saved.movements,1);assert.equal(saved.revision,1);assert.equal(Number(saved.book),30);assert.equal(saved.knownStatus,"delivered");assert.equal(saved.batchStatus,"delivered");
  assert.equal((await receiptPost(runtime(a),await body(2))).status,200);const completed=await facts();assert.equal(completed.receipts,2);assert.equal(Number(completed.book),54);assert.equal(completed.batchStatus,"received");
  proof.groups.push({name:"different nonce same stock revision actual receipt API",statuses:responses.map(response=>response.status),facts:saved,refreshedContinuation:completed});console.log("PASS different nonce CAS and refreshed remainder");
  const mixedRuns=[];
  for(const firstKind of ["arrival","receipt"]){await reset(true);const held=deferred(),release=deferred();let firstLock=true;
    const afterBatchLock=async()=>{if(!firstLock)return;firstLock=false;held.resolve();await release.promise;};
    const full=await body(),arrival={type:"items",itemIds:[ids.unknownQuantityLine],storeId:ids.store,expectedOperatorId:employee.id,confirmArrivalOnly:true};
    const firstApi=runtime(a,{afterBatchLock}),secondApi=runtime(b);
    const firstCall=firstKind==="arrival"?receivingPatch(firstApi,arrival):receiptPost(firstApi,full);await held.promise;
    const secondCall=firstKind==="arrival"?receiptPost(secondApi,full):receivingPatch(secondApi,arrival);
    await waitBlocked(pids[1]);release.resolve();responses=await Promise.all([firstCall,secondCall]);assert.deepEqual(responses.map(response=>response.status),[200,200]);
    saved=await facts();assert.equal(saved.receipts,1);assert.equal(saved.movements,1);assert.equal(Number(saved.book),54);assert.equal(saved.unknownActual,null);assert.equal(saved.unknownStatus,"received");assert.equal(saved.knownStatus,"received");assert.equal(saved.batchStatus,"received");
    mixedRuns.push({firstKind,secondObservedWaitingOnLock:true,statuses:responses.map(response=>response.status),facts:saved});
  }
  proof.groups.push({name:"actual mixed-batch arrival-only and known receipt in both held-lock orderings",runs:mixedRuns});console.log("PASS mixed batch in both held-lock orderings");
  await reset();payload=await body();const held=deferred(),release=deferred();
  const pendingReceipt=receiptPost(runtime(a,{afterBatchLock:async()=>{held.resolve();await release.promise;}}),payload);await held.promise;
  const pendingLegacy=receivingPatch(runtime(b),{type:"batch",batchId:ids.deliveryBatch,storeId:ids.store,expectedOperatorId:employee.id});
  await waitBlocked(pids[1]);release.resolve();responses=await Promise.all([pendingReceipt,pendingLegacy]);assert.deepEqual(responses.map(response=>response.status),[200,200]);
  saved=await facts();assert.equal(saved.receipts,1);assert.equal(saved.movements,1);assert.equal(Number(saved.book),54);assert.equal(Number(saved.physical),6);assert.equal(saved.knownStatus,"received");assert.equal(saved.batchStatus,"received");
  proof.groups.push({name:"actual legacy batch transition waits behind the held combined receipt batch lock",secondObservedWaitingOnLock:true,statuses:responses.map(response=>response.status),facts:saved});console.log("PASS legacy batch transition and combined receipt without deadlock or duplicate stock");
  proof.passed=true;proof.completedAt=new Date().toISOString();
}catch(error){proof.passed=false;proof.error=clean(error);console.error(proof.error);process.exitCode=1;}
finally{for(const client of clients)await client.query("rollback").catch(()=>{});
  if(created&&clients[2])try{await clients[2].query(`drop schema ${schema} cascade`);proof.cleanup=(await clients[2].query("select count(*)::int n from pg_namespace where nspname=$1",[schema])).rows[0].n===0;assert.equal(proof.cleanup,true);}
  catch(error){proof.cleanup=false;proof.cleanupError=clean(error);process.exitCode=1;}
  for(const client of clients)client.release();await pool.end();writeFileSync(output,JSON.stringify(proof,null,2),{mode:0o600});
  console.log(JSON.stringify({passed:proof.passed,groups:proof.groups.length,cleanup:proof.cleanup,proof:output}));
}
