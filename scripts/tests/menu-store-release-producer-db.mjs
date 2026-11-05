// Actual inventory producer and local Postgres queue. No environment, live
// credentials, merchant transport, or device is loaded.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const {PGlite}=await import(process.env.FOUNDR1_PGLITE_MODULE||'@electric-sql/pglite');
const root=new URL('../../',import.meta.url);
function load(path,modules={}) {
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL(path,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,Date,Error,console,require:name=>name.startsWith('node:')?require(name):modules[name.split('/').at(-1)]??assert.fail(`Unexpected import ${name}`)});
  return exports;
}

test('normal Rocket Store commands persist explicit native readback, including both target kinds and shortage',async()=>{
  const db=new PGlite(),store=randomUUID(),brand=randomUUID(),actor=randomUUID(),option=randomUUID(),item=randomUUID();
  try {
    await db.exec(`
      create table store_sales_sources(store_id uuid,source_platform text,is_enabled bool);
      create table local_bridge_commands(id uuid primary key,store_id uuid,platform text,command_type text,idempotency_key text,payload jsonb,status text default 'pending',completed_at timestamptz,result jsonb,updated_at timestamptz);
      create table menu_inventory_sync_runs(id uuid primary key,store_id uuid,run_type text,action text,item_label text,inventory_key text,source text,requested_by uuid,details jsonb);
    `);
    for(const platform of ['rocket_now','demae_can','uber_eats'])await db.query('insert into store_sales_sources values($1,$2,true)',[store,platform]);
    const sql=(parts,...values)=>({text:parts.map((part,index)=>part+(index<values.length?`$${index+1}`:'')).join(''),values,
      then(resolve,reject){return db.query(this.text,this.values).then(result=>result.rows).then(resolve,reject);}});
    sql.query=async(_query,values)=>{
      // Supersession is not the behavior under test, but must run only after
      // real replacement commands have been inserted for this exact store.
      assert.equal(values[0],store);
      assert.ok((await db.query('select id from local_bridge_commands where store_id=$1 and platform=$2',[store,values[1][0]])).rows.length);
      return [];
    };
    const mappings=new Map(['rocket_now','demae_can','uber_eats'].flatMap(platform=>[
      [`${platform}:option:${option}`,[platform==='rocket_now'?'sub_checkbox_1711079_8284486':`${platform}-option`]],
      [`${platform}:item:${item}`,[platform==='rocket_now'?'314':`${platform}-item`]]
    ]));
    const noop=async()=>{};
    const producer=load('lib/inventory-availability.ts',{
      db:{sql},'inventory-operation-lock':{assertNoWholeStoreSync:noop,withInventoryOperationLock:async(id,operation)=>{assert.equal(id,store);return operation();}},
      'inventory-target-identity':{},'uber-inventory-targets':{},'menu-availability-links':{},
      'inventory-command-supersession':{reconcileInventoryCommandsSql:'isolated supersession'},
      'local-bridge-realtime':{publishBridgeCommandAvailable:noop,publishBridgeInventorySyncStarted:noop},
      'order-realtime':{publishPublicMenuUpdatedEvent:noop},
      'inventory-platform-targets':load('lib/inventory-platform-targets.ts'),
      'inventory-availability-policy':load('lib/inventory-availability-policy.ts'),
      'inventory-platform-object-mappings':{loadInventoryPlatformExternalIdMap:async()=>mappings,
        inventoryPlatformExternalIds:(map,platform,target)=>map.get(`${platform}:${target.kind}:${target.targetId}`)??[],loadDemaeStagingHints:async()=>[]}
    });
    const targets=[{kind:'option',targetId:option,menuOptionId:option,brandId:brand,label:'Exact choice',aliases:[],groupKey:'group'},
      {kind:'item',targetId:item,menuCatalogItemId:item,brandId:brand,label:'Exact product',aliases:[]}];
    const apply=async(patch={})=>{
      await db.exec('delete from local_bridge_commands;delete from menu_inventory_sync_runs');
      await producer.applyInventoryAvailability({storeId:store,resolution:{inventoryKey:'isolated',ingredientLabel:'Exact choice',targets},
        isAvailable:true,persistOverall:false,statusSource:'販売状態',syncSource:'store',updatedBy:actor,...patch});
      return (await db.query('select platform,status,payload,result from local_bridge_commands order by platform,payload->>\'operation\'')).rows;
    };
    for(const isAvailable of [true,false]) {
      const commands=await apply({isAvailable});
      const rocket=commands.filter(row=>row.platform==='rocket_now');
      assert.equal(rocket.length,2);
      assert.deepEqual(rocket.flatMap(row=>row.payload.targets.map(target=>[target.kind,target.targetId])).sort(),[['item',item],['option',option]].sort());
      for(const command of rocket) {
        assert.equal(command.status,'pending');assert.equal(command.payload.verifyAvailability,true);
        assert.equal(command.payload.isAvailable,isAvailable);assert.equal(command.payload.syncSource,'store');
        assert.equal(command.payload.targets.length,1);
        assert.deepEqual(command.payload.targets[0].knownExternalIds,mappings.get(`rocket_now:${command.payload.targets[0].kind}:${command.payload.targets[0].targetId}`));
      }
      assert.equal(commands.find(row=>row.platform==='demae_can').payload.verifyAvailability,true);
      assert.equal(commands.find(row=>row.platform==='uber_eats').payload.verifyAvailability,undefined);
    }
    const siri=await apply({syncSource:'siri',statusSource:'Siri',platforms:['rocket_now']});
    assert.ok(siri.every(row=>row.payload.verifyAvailability===undefined),'the new default is scoped to explicit Store operations');
    mappings.set(`rocket_now:option:${option}`,[]);mappings.set(`rocket_now:item:${item}`,[]);
    const absent=await apply({platforms:['rocket_now']});
    assert.equal(absent.length,1);assert.equal(absent[0].status,'succeeded');assert.equal(absent[0].result.outcome,'not_applicable');
    assert.deepEqual(absent[0].payload.targets,[]);assert.equal(absent[0].payload.verifyAvailability,undefined);
  } finally {await db.close();}
});
