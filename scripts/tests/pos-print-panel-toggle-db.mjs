// Actual settings and print-document handlers share one isolated PostgreSQL fixture.
// No live credentials, network, devices, or production writes.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createPrintDocumentFixture} from './pos-print-document-fixture.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((p,v,i,a)=>{if(v.startsWith('--'))p.push([v.slice(2),a[i+1]]);return p;},[]));
const source=resolve(args.source||process.cwd()),output=resolve(args.output||'outputs/pos-print-panel-toggle-db');await mkdir(output,{recursive:true});
const verifiedFiles=['lib/pos-printer.ts','app/api/os/pos/settings/route.ts','app/api/store/pos/route.ts','lib/pos-print-document-ledger.ts','scripts/tests/pos-print-panel-toggle-db.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(verifiedFiles.map(async file=>[file,createHash('sha256').update(await readFile(resolve(source,file))).digest('hex')])));
const inputHashes=await hashes();await writeFile(resolve(output,'input-hashes.json'),JSON.stringify({recordedAt:new Date().toISOString(),sourceHashes:inputHashes},null,2)+'\n');
const results=[],f=await createPrintDocumentFixture(source);const {db,ids,state,modules}=f;
f.sql.query=(text,values=[])=>({text,values,then(ok,fail){return db.query(text,values).then(result=>result.rows).then(ok,fail);}});
const schema=await readFile(resolve(source,'db/schema.sql'),'utf8');
const categorySql=schema.match(/create table if not exists menu_categories \([\s\S]*?\n\);/)[0].replace(/references\s+[\w.]+\s*\([^)]*\)(?:\s+on\s+delete\s+(?:cascade|set\s+null|restrict|no\s+action))?/gi,'');await db.exec(categorySql);
for(const match of schema.matchAll(/alter table menu_categories add column[^;]*;/g))await db.exec(match[0]);
modules['role-permissions']={roleHasPermission:async role=>role==='store_manager'};
modules['order-realtime'].publishPosCustomerDisplayEvent=async()=>{};
const route=f.load('app/api/os/pos/settings/route.ts');
const json=async(response,status=200)=>{response=await response;assert.equal(response.status,status,await response.clone().text());return response.json();};
const post=(patch,status=200)=>json(route.POST(f.request('/api/os/pos/settings',{storeId:ids.store,...patch})),status);
const get=()=>json(route.GET(f.request(`/api/os/pos/settings?storeId=${ids.store}`)));
const stored=async()=>JSON.parse(JSON.stringify((await db.query('select * from pos_store_settings where store_id=$1',[ids.store])).rows[0]));
const ledgerSnapshot=async()=>{
  const out={};for(const table of ['store_customer_orders','store_customer_order_items','pos_print_documents','pos_print_document_operations','store_relay_print_jobs'])out[table]=(await db.query(`select to_jsonb(t) row from ${table} t order by to_jsonb(t)::text`)).rows.map(x=>x.row);return JSON.parse(JSON.stringify(out));
};
async function check(name,fn){await fn();results.push({name,passed:true});console.log(`PASS ${name}`);}
try{
  const printer=f.load('lib/pos-printer.ts'),normal=value=>JSON.parse(JSON.stringify(printer.normalizePosPrinterSettings(value)));
  await check('unconfigured-and-malformed-display-preference-defaults-visible-only-explicit-false-hides',async()=>{
    assert.equal(printer.defaultPosPrinterSettings.showPrintQueue,true);
    for(const value of [null,undefined,{},[],{showPrintQueue:null},{showPrintQueue:0},{showPrintQueue:'false'},{showPrintQueue:true}])assert.equal(normal(value).showPrintQueue,true);
    assert.equal(normal({showPrintQueue:false}).showPrintQueue,false);assert.equal((await get()).settings.printerSettings.showPrintQueue,true);
  });
  const paid=await json(f.postCheckout({printDocumentVersion:1,printMode:'deferred'})),queueBefore=await json(f.getQueue());assert.ok(queueBefore.documents.length>0);const ledgerBefore=await ledgerSnapshot();
  const before=await get(),printerBefore=before.settings.printerSettings;
  await check('false-display-setting-round-trips-real-post-get-and-pos-reader-with-no-ledger-or-print-change',async()=>{
    const saved=await post({section:'printing',printerSettings:{...printerBefore,showPrintQueue:false}});assert.equal(saved.settings.printerSettings.showPrintQueue,false);
    assert.equal((await get()).settings.printerSettings.showPrintQueue,false);assert.equal((await stored()).printer_settings.showPrintQueue,false);
    const runtime=await json(f.reload('app/api/store/pos/route.ts').GET(f.request(`/api/store/pos?storeId=${ids.store}`)));assert.equal(runtime.posSettings.printerSettings.showPrintQueue,false);
    assert.deepEqual({...saved.settings.printerSettings,showPrintQueue:true},printerBefore);assert.deepEqual(await ledgerSnapshot(),ledgerBefore);assert.equal((await json(f.getQueue())).summary.pendingDocuments,queueBefore.summary.pendingDocuments);
  });
  await check('missing-preference-from-an-identified-old-settings-client-preserves-explicit-hidden-choice',async()=>{
    const {showPrintQueue,...legacy}=printerBefore;await post({section:'printing',printerSettings:legacy});assert.equal((await get()).settings.printerSettings.showPrintQueue,false);assert.equal((await stored()).printer_settings.showPrintQueue,false);assert.deepEqual(await ledgerSnapshot(),ledgerBefore);
  });
  await check('explicit-show-and-hide-are-reversible-and-do-not-modify-another-store-or-printer-role',async()=>{
    const otherBefore=(await db.query('select * from pos_store_settings where store_id=$1',[ids.other])).rows;
    for(const showPrintQueue of [true,false,true]){const saved=await post({section:'printing',printerSettings:{...printerBefore,showPrintQueue}});assert.equal(saved.settings.printerSettings.showPrintQueue,showPrintQueue);assert.equal((await get()).settings.printerSettings.showPrintQueue,showPrintQueue);assert.deepEqual({...saved.settings.printerSettings,showPrintQueue:true},printerBefore);}
    assert.deepEqual((await db.query('select * from pos_store_settings where store_id=$1',[ids.other])).rows,otherBefore);assert.deepEqual(await ledgerSnapshot(),ledgerBefore);
  });
  await check('authentication-management-permission-and-store-scope-reject-display-setting-writes',async()=>{
    const snapshot=await stored(),session=state.session;state.session=null;await post({section:'printing',printerSettings:{showPrintQueue:false}},401);state.session={...session,role:'staff'};await post({section:'printing',printerSettings:{showPrintQueue:false}},403);state.session=session;await post({storeId:ids.other,section:'printing',printerSettings:{showPrintQueue:false}},400);assert.deepEqual(await stored(),snapshot);assert.deepEqual(await ledgerSnapshot(),ledgerBefore);
  });
  await check('hidden-home-panel-does-not-block-explicit-order-document-read',async()=>{
    await post({section:'printing',printerSettings:{...printerBefore,showPrintQueue:false}});const full=await json(f.getQueue(`orderId=${paid.orderId}`));assert.ok(full.documents.length>0);assert.ok(full.documents.every(x=>x.orderId===paid.orderId));
    assert.deepEqual(await ledgerSnapshot(),ledgerBefore);assert.equal(state.externalCalls,0);
  });
  await check('first-save-from-an-old-client-with-no-stored-display-preference-defaults-visible',async()=>{
    await db.query('delete from pos_store_settings where store_id=$1',[ids.store]);const {showPrintQueue,...legacy}=printerBefore;const saved=await post({section:'printing',printerSettings:legacy});assert.equal(saved.settings.printerSettings.showPrintQueue,true);assert.equal((await stored()).printer_settings.showPrintQueue,true);assert.deepEqual(await ledgerSnapshot(),ledgerBefore);
  });
  const sourceHashes=await hashes();assert.deepEqual(sourceHashes,inputHashes,'No tested source changed during the API/DB run');
  await writeFile(resolve(output,'report.json'),JSON.stringify({passed:results.length,results,source,sourceHashes,inputHashes,noSourceDrift:true,actualSettingsApi:true,actualPosReader:true,actualPrintLedger:true,isolatedDatabase:'PGlite',liveWrites:0,externalCalls:state.externalCalls},null,2)+'\n');
  console.log(JSON.stringify({passed:results.length,output}));
}catch(error){await writeFile(resolve(output,'failure.json'),JSON.stringify({error:error.stack,results,source},null,2)+'\n');throw error;}
finally{await db.close();}
