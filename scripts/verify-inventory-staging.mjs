// Read-only regression against a saved audit and fresh merchant draft data.
import {readFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {statusDirectory} from '../desktop-bridge/src/local-status.mjs';
import {BrowserSession} from '../desktop-bridge/src/browser-session.mjs';
import {connectMerchantMenuClient} from '../desktop-bridge/src/merchant-menu-client.mjs';
import {verifyDemaeInventoryStaging} from '../desktop-bridge/src/demae-inventory-staging.mjs';
import {planDemaeRelease} from '../desktop-bridge/src/demae-inventory-release.mjs';
loadLocalEnv();
const config=await loadConfig(),sql=neon(process.env.DATABASE_URL);
const status=JSON.parse(await readFile(`${statusDirectory}/status.json`,'utf8'));
if(status.current?.platform==='demae_can')throw Error('Bridge is busy on Demae; do not race its browser');
const [audit]=await sql`select payload,result from local_bridge_commands where id='189dedc2-c265-4a09-a41e-c627d5f270ff' and store_id=${config.storeId} and platform='demae_can' and status='succeeded'`;
if(!audit)throw Error('Audit scope mismatch');
const pubs=await sql`select distinct on (payload->>'sourceId') payload,result from local_bridge_commands where store_id=${config.storeId} and platform='demae_can' and status='succeeded' and payload->>'authoritativePublication'='true' order by payload->>'sourceId',created_at desc`;
const mappings=await sql`select m.brand_id::text as "brandId",m.target_type as kind,m.target_id::text as "targetId",m.external_id as "externalId",m.external_parent_id as "externalParentId" from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id join store_brands b on b.brand_id=m.brand_id and b.store_id=${config.storeId} where p.platform_key='demae_can' and (m.store_id is null or m.store_id=${config.storeId})`;
for(const pub of pubs)for(const target of pub.payload.targets)target.mappings=mappings.filter(m=>m.brandId===pub.payload.brandId&&m.kind===target.kind&&m.targetId===target.targetId).flatMap(m=>String(m.externalId).split(',').filter(Boolean).map(externalId=>({externalId,externalParentId:m.externalParentId})));
const hints=pubs.map(({payload:p,result:r})=>({storeId:config.storeId,merchantId:p.merchantId,menuPatternCode:p.menuPatternCode,draftPatternCode:p.draftPatternCode,draftCarrierItemCode:p.draftCarrierItemCode,targets:p.targets.filter(t=>!t.archived&&!t.quarantined&&['item','option'].includes(t.kind)&&r.observations.some(o=>o.sourceKey===t.sourceKey&&o.exists===true&&o.hidden===true&&o.placement==='staged'))}));
const transport=await connectMerchantMenuClient(new BrowserSession(config,'demae_can'),'https://partner.demae-can.com','MSA0000');
const request=transport.request.bind(transport);let requests=0;
transport.request=async(path,method='GET',...args)=>{
 const live=JSON.parse(await readFile(`${statusDirectory}/status.json`,'utf8'));
 if(live.current?.platform==='demae_can')throw Error('Bridge started a Demae task; stop diagnostic');
 if(method!=='GET'&&!(method==='POST'&&['/merchant-admin/api/v1/product/search/menu-pattern','/merchant-admin/api/v1/stock/stockout/target-list'].includes(path)))throw Error('Read-only guard rejected request');
 const result=await request(path,method,...args);requests++;
 if(requests%20===0)console.log(JSON.stringify({readRequests:requests}));return result;
};
try {
 const items=structuredClone(audit.result.items);
 for(let i=0;i<hints.length;i++)hints[i].graph=pubs[i].payload.targets.filter(t=>!t.archived&&!t.quarantined);
 await verifyDemaeInventoryStaging(transport,{...audit.payload,demaeStaging:hints},items,config.storeId);
 if(process.argv.includes('--release-plan')) {
  const plans=[],blocked=[],cache=new Map();
  for(const row of items.filter(r=>r.status==='staged')) {
   const scope=hints.find(s=>s.targets.some(t=>t.kind===row.kind&&t.targetId===row.targetId));
   try{plans.push(await planDemaeRelease(transport,scope,row,cache));}
   catch(error){blocked.push({targetId:row.targetId,reason:error.message});}
  }
  console.log(JSON.stringify({releaseEligible:plans.length,blocked}));
 }
 console.log(JSON.stringify({readOnly:true,total:items.length,confirmed:items.filter(r=>typeof r.isAvailable==='boolean').length,staged:items.filter(r=>r.status==='staged').length,unknown:items.filter(r=>!r.found).map(r=>({kind:r.kind,label:r.label,reason:r.reason})),requests}));
}finally{transport.close();}
