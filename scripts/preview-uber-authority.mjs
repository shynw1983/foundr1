import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {CdpPage} from '../desktop-bridge/src/cdp-page.mjs';
import {captureUberAuthoritativeCatalog} from '../desktop-bridge/src/uber-authoritative-catalog.mjs';
loadLocalEnv();
const sql=neon(process.env.DATABASE_URL);
const config=await loadConfig();
const brandId=process.argv[2];
if(!brandId)throw Error('Usage: node --experimental-strip-types scripts/preview-uber-authority.mjs <brand UUID>');
const sources=await sql`select id::text,uber_store_uuid from menu_uber_sources where brand_id::text=${brandId} and store_id::text=${config.storeId}`;
if(sources.length!==1)throw Error('Configure an explicitly scoped Uber source first.');
if(sources[0].uber_store_uuid!==config.platforms.uber_eats.storeUuid)throw Error('Source store mismatch');
const page=await CdpPage.connect(9331,'https://merchants.ubereats.com/');
try{
 const raw=await page.evaluate(`fetch('/manager/menumaker/api/getMenuData?localeCode=ja-JP',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-csrf-token':'x'},body:JSON.stringify({storeUUID:${JSON.stringify(sources[0].uber_store_uuid)},shouldLoadItems:true})}).then(async r=>{if(!r.ok)throw Error('Uber read failed:'+r.status);return r.json()})`);
 const catalog=captureUberAuthoritativeCatalog(raw,sources[0].uber_store_uuid);
 if(process.argv.includes('--price-contexts')) {
  console.log(JSON.stringify(catalog.entities.filter(e=>e.contextPrices.some(p=>p.contextType!=='CUSTOMIZATION_UUID'||!catalog.groups.some(g=>g.id===p.contextId))).map(e=>({name:e.name,contexts:e.contextPrices})),null,2));
  process.exitCode=0;
  page.close();
 } else {
 if(process.argv.includes('--structure')) {
  console.log(JSON.stringify({groups:catalog.groups.map(g=>({name:g.name,min:g.min,max:g.max,count:g.optionIds.length})),multipleCategories:catalog.entities.filter(e=>catalog.categories.filter(c=>c.itemIds.includes(e.id)).length>1).map(e=>({name:e.name,categories:catalog.categories.filter(c=>c.itemIds.includes(e.id)).map(c=>c.name)}))},null,2));
 }
 const {ingestUberMenuSource}=await import('../lib/uber-menu-source-sync.ts');
 const verifyRollback=process.argv.includes('--verify-transaction');
 const bootstrap=process.argv.includes('--bootstrap');
 const result=await ingestUberMenuSource({sourceId:sources[0].id,storeId:config.storeId,commandId:randomUUID(),catalog,dryRun:!verifyRollback&&!bootstrap,verifyRollback,bootstrap});
 const {nodes,prices,...summary}=result;
 console.log(JSON.stringify({...summary,priceCount:prices?.length},null,2));
 }
}finally{page.close();}
