import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {CdpPage} from '../desktop-bridge/src/cdp-page.mjs';
import {BrowserSession} from '../desktop-bridge/src/browser-session.mjs';
import {captureUberAuthoritativeCatalog} from '../desktop-bridge/src/uber-authoritative-catalog.mjs';
import {connectMerchantMenuClient} from '../desktop-bridge/src/merchant-menu-client.mjs';
import {RocketMenuClient} from '../desktop-bridge/src/rocket-menu-client.mjs';
import {DemaeMenuClient} from '../desktop-bridge/src/demae-menu-client.mjs';
import {planAuthorityParents} from '../desktop-bridge/src/uber-authority-parents.mjs';
import {reconcileAuthorityChildren} from '../desktop-bridge/src/uber-authority-reconcile.mjs';
import {AuthorityNativeDriver} from '../desktop-bridge/src/uber-authority-native-driver.mjs';
import {buildUberPublication} from '../lib/uber-menu-publication.ts';

loadLocalEnv();
const {ingestUberMenuSource}=await import('../lib/uber-menu-source-sync.ts');
const config=await loadConfig(),sql=neon(process.env.DATABASE_URL);
const [brandId,chainId,pattern]=process.argv.slice(2);
if(!brandId||!chainId||!pattern)throw Error('Usage: node --experimental-strip-types scripts/plan-uber-authority-publication.mjs <brand UUID> <Demae chain ID> <pattern>');
const sources=await sql`select * from menu_uber_sources where brand_id::text=${brandId} and store_id::text=${config.storeId}`;
if(sources.length!==1||sources[0].uber_store_uuid!==config.platforms.uber_eats.storeUuid)throw Error('source_scope_mismatch');
const source=sources[0],page=await CdpPage.connect(9331,'https://merchants.ubereats.com/');
let catalog;
try {
 const raw=await page.evaluate(`fetch('/manager/menumaker/api/getMenuData?localeCode=ja-JP',{method:'POST',credentials:'include',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-csrf-token':'x'},body:JSON.stringify({storeUUID:${JSON.stringify(source.uber_store_uuid)},shouldLoadItems:true})}).then(async r=>{if(!r.ok)throw Error('Uber read failed:'+r.status);return r.json()})`);
 catalog=captureUberAuthoritativeCatalog(raw,source.uber_store_uuid);
} finally {page.close();}
const preview=await ingestUberMenuSource({sourceId:source.id,storeId:config.storeId,commandId:randomUUID(),catalog,dryRun:true});
if(!preview.nodes)throw Error('source_preview_missing');
for(const platform of ['rocket_now','demae_can']) {
 const mappings=await sql`select m.target_type as kind,m.target_id::text as "targetId",m.external_id as "externalId",m.external_parent_id as "externalParentId" from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id where p.brand_id::text=${brandId} and p.store_id is null and p.platform_key=${platform}`;
 const merchantId=platform==='rocket_now'?config.platforms.rocket_now.storeId:chainId;
 const payload=buildUberPublication({...source.publish_config?.[platform],sourceId:source.id,storeId:config.storeId,brandId,revision:source.revision,platform,merchantId,menuPatternCode:pattern,nodes:preview.nodes,mappings});
 const transport=await connectMerchantMenuClient(new BrowserSession(config,platform),platform==='rocket_now'?'https://store.rocketnow.co.jp':'https://partner.demae-can.com',platform==='rocket_now'?'SUCCESS':'MSA0000');
 try {
  if(process.argv.includes('--native-preflight')) {
   const result=await new AuthorityNativeDriver(transport,payload).preflight(payload);
   const counts={};for(const issue of result.issues)counts[issue.code]=(counts[issue.code]??0)+1;
   console.log(JSON.stringify({platform,nativePreflight:process.argv.includes('--summary')?{count:result.issues.length,counts,examples:result.issues.slice(0,8).map(issue=>({...issue,name:payload.targets.find(row=>row.sourceKey===issue.sourceKey)?.name}))}:result}));
   continue;
  }
  let parents;const remoteObjects=[];
  if(platform==='rocket_now') {
   const remote=await new RocketMenuClient(transport,merchantId).catalog();
   for(const menu of remote.menus)for(const row of menu.dishes??[])remoteObjects.push({kind:'item',id:String(row.dishId),name:row.dishName,price:Number(row.salePrice),parentIds:[String(menu.menuId)]});
   for(const group of remote.groups)for(const row of group.optionItems??[])remoteObjects.push({kind:'option',id:String(row.optionItemId),name:row.optionItemName,price:Number(row.salePrice),parentIds:[String(group.optionId)]});
   parents=[...remote.menus.map(menu=>({kind:'category',externalId:String(menu.menuId),name:menu.menuName,childIds:(menu.dishes??[]).map(item=>String(item.dishId))})),...remote.groups.map(group=>({kind:'option_group',externalId:String(group.optionId),name:group.optionName,childIds:(group.optionItems??[]).map(option=>String(option.optionItemId))}))];
  } else {
   const client=new DemaeMenuClient(transport,chainId,pattern,{draftPatternCode:source.publish_config?.demae_can?.draftPatternCode}),remote=await client.catalog();
   parents=remote.items.categoryList.map(category=>({kind:'category',externalId:category.categoryCode,name:category.categoryName,childIds:category.itemList.map(item=>item.itemCode)}));
   for(const category of remote.items.categoryList)for(const row of category.itemList??[]) {
    const sizes=(row.sizeInfoList??[]).filter(size=>String(size.applyStartDate).replaceAll('/','-')<=client.today&&String(size.applyEndDate).replaceAll('/','-')>=client.today);
    if(sizes.length===1)remoteObjects.push({kind:'item',id:row.itemCode,name:row.itemName,price:Number(sizes[0].price),parentIds:[category.categoryCode]});
   }
   for(const group of remote.groups) {
    const rows=await transport.request(`${client.base}/option-group/${encodeURIComponent(group.optionGroupCode)}/option-item-list`);
    if(!Array.isArray(rows))throw Error('demae_group_members_incomplete');
    parents.push({kind:'option_group',externalId:group.optionGroupCode,name:group.optionGroupName,childIds:rows.map(row=>row.optionCode)});
    for(const row of rows)if(String(row.applyStartDate).replaceAll('/','-')<=client.today&&String(row.applyEndDate).replaceAll('/','-')>=client.today)remoteObjects.push({kind:'option',id:row.optionCode,name:row.optionName,price:Number(row.price),parentIds:[group.optionGroupCode]});
   }
  }
  const plan=planAuthorityParents(payload,parents);
  // Unmapped members prevent destructive replacement, not identification of a
  // parent whose known child IDs all prove the same unique logical owner.
  const safe=plan.bindings.filter(binding=>!plan.issues.some(issue=>issue.sourceKey===binding.sourceKey&&issue.code!=='unmapped_children')&&plan.bindings.filter(row=>row.targetId===binding.targetId).length===1);
  for(const binding of safe) {
   const target=payload.targets.find(row=>row.sourceKey===binding.sourceKey);
   if(target&&!target.mappings.length)target.mappings.push({externalId:binding.externalId,externalParentId:''});
  }
  const childBindings=reconcileAuthorityChildren(payload,remoteObjects);
  if(process.argv.includes('--unmapped-details')) {
   const unknown=new Set(plan.issues.flatMap(issue=>issue.unknownIds??[]).map(String));
   console.log(JSON.stringify({platform,unmappedObjects:remoteObjects.filter(row=>unknown.has(String(row.id)))}));
  }
  if(process.argv.includes('--save-safe-mappings')) {
   const platformRows=await sql`select id from menu_external_platforms where brand_id::text=${brandId} and store_id is null and platform_key=${platform} and is_active=true`;
   if(platformRows.length!==1)throw Error('platform_scope_invalid');
   await sql.transaction([
    sql`with locked as materialized (select id from menu_uber_sources where id=${source.id} and enabled=false and auto_publish=false and revision=${source.revision} for update) select 1/count(*)::int from locked`,
    ...[...safe,...childBindings].map(binding=>sql`insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_name,last_observed_state,last_verified_at) values(${brandId},${platformRows[0].id},${binding.kind},${binding.targetId},${binding.externalId},${binding.name},${JSON.stringify(binding.evidence??{evidenceIds:binding.evidenceIds,method:'stable-child-membership',capturedAt:catalog.capturedAt})}::jsonb,now()) on conflict(external_platform_id,target_type,external_id) do update set target_id=case when menu_platform_object_mappings.target_id=excluded.target_id then excluded.target_id else null end,last_observed_state=excluded.last_observed_state,last_verified_at=now(),updated_at=now()`)
   ]);
  }
  console.log(JSON.stringify({platform,readOnly:!process.argv.includes('--save-safe-mappings'),safeMappings:safe.length,childBindings,bindings:process.argv.includes('--verbose')?plan.bindings:undefined,issues:plan.issues,quarantined:payload.targets.filter(target=>target.quarantined).map(target=>({sourceKey:target.sourceKey,name:target.name})),missing:payload.targets.filter(target=>['item','option'].includes(target.kind)&&!target.archived&&!target.quarantined&&!target.mappings.length).map(target=>({sourceKey:target.sourceKey,targetId:target.targetId,kind:target.kind,name:target.name,price:target.price,parentId:target.parentId}))},null,2));
 } finally {transport.close();}
}
