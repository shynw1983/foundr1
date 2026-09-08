// Scoped smoke test: an existing OS option absent on Demae, held permanently
// in an unlinked carrier group. Source activation is deliberately forbidden.
import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {BrowserSession} from '../desktop-bridge/src/browser-session.mjs';
import {CdpPage} from '../desktop-bridge/src/cdp-page.mjs';
import {captureUberAuthoritativeCatalog} from '../desktop-bridge/src/uber-authoritative-catalog.mjs';
import {connectMerchantMenuClient,sameMenuValue} from '../desktop-bridge/src/merchant-menu-client.mjs';
import {DemaeMenuClient} from '../desktop-bridge/src/demae-menu-client.mjs';
import {DemaeStagedOption} from '../desktop-bridge/src/demae-staged-option.mjs';
import {authorityPhysicalId} from '../desktop-bridge/src/uber-authority-parents.mjs';
import {buildUberPublication} from '../lib/uber-menu-publication.ts';

loadLocalEnv();
const {ingestUberMenuSource}=await import('../lib/uber-menu-source-sync.ts');
const sql=neon(process.env.DATABASE_URL),config=await loadConfig();
const [brandId,chainId,pattern,sourceKey]=process.argv.slice(2);
if(!brandId||!/^\d+$/.test(chainId??'')||!pattern||!/^option:[^:]+:[^:]+$/.test(sourceKey??''))throw Error('Usage: ... <brand> <chain> <pattern> <option source key> [--apply]');
const sources=await sql`select * from menu_uber_sources where brand_id::text=${brandId} and store_id::text=${config.storeId}`;
const source=sources[0];
if(sources.length!==1||source.enabled||source.auto_publish||source.uber_store_uuid!==config.platforms.uber_eats.storeUuid)throw Error('smoke_scope_invalid');
if(source.publish_config?.demae_can?.quarantinedSourceKeys?.includes(sourceKey))throw Error('smoke_quarantined');
const configured=source.publish_config?.demae_can;
if(!configured?.draftPatternCode||(configured.merchantId&&String(configured.merchantId)!==chainId)||(configured.menuPatternCode&&configured.menuPatternCode!==pattern))throw Error('smoke_merchant_scope_invalid');
const commandId=randomUUID(),page=await CdpPage.connect(9331,'https://merchants.ubereats.com/');let catalog;
try {
 const raw=await page.evaluate(`fetch('/manager/menumaker/api/getMenuData?localeCode=ja-JP',{method:'POST',credentials:'include',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-csrf-token':'x'},body:JSON.stringify({storeUUID:${JSON.stringify(source.uber_store_uuid)},shouldLoadItems:true})}).then(r=>{if(!r.ok)throw Error('Uber read failed');return r.json()})`);
 catalog=captureUberAuthoritativeCatalog(raw,source.uber_store_uuid);
}finally{page.close();}
const preview=await ingestUberMenuSource({sourceId:source.id,storeId:config.storeId,commandId,catalog,dryRun:true});
const node=preview.nodes.find(row=>row.sourceKey===sourceKey);
if(!node||node.kind!=='option'||node.isNew||node.archived)throw Error('smoke_requires_existing_active_os_option');
const platforms=await sql`select id from menu_external_platforms where brand_id::text=${brandId} and store_id is null and platform_key='demae_can' and is_active=true`;
if(platforms.length!==1)throw Error('smoke_platform_invalid');const platformId=platforms[0].id;
const mappings=await sql`select target_type as kind,target_id::text as "targetId",external_id as "externalId",external_parent_id as "externalParentId" from menu_platform_object_mappings where external_platform_id=${platformId} and target_id::text=${node.targetId}`;
const target=buildUberPublication({sourceId:source.id,storeId:config.storeId,brandId,revision:source.revision,platform:'demae_can',merchantId:chainId,nodes:[node],mappings}).targets[0];
if(mappings.length>1||mappings.some(row=>!row.externalParentId.startsWith('stage:')))throw Error('smoke_existing_nonstaged_mapping');
const attempts=await sql`select status,external_id as "externalId",external_parent_id as "externalParentId" from menu_uber_creation_attempts where source_id=${source.id} and platform='demae_can' and source_key=${sourceKey}`;
const transport=await connectMerchantMenuClient(new BrowserSession(config,'demae_can'),'https://partner.demae-can.com','MSA0000');
try {
 const client=new DemaeMenuClient(transport,chainId,pattern,{draftPatternCode:source.publish_config.demae_can.draftPatternCode});
 const stage=new DemaeStagedOption(client),before=await client.catalog(),stockBefore=await client.stockCatalog(),options=await client.options();
 if(options.some(row=>row.optionName===target.name)||!options.length||options.some(row=>row.itemType!=='REDUCED_RATE_NORMAL_ITEM'))throw Error('smoke_existing_candidate_or_tax_unverified');
 console.log(JSON.stringify({readOnly:!process.argv.includes('--apply'),sourceKey,name:target.name,price:target.price,mapped:mappings.length>0}));
 if(!process.argv.includes('--apply'))process.exitCode=0;
 else {
  const locked=()=>sql`with locked as materialized(select id from menu_uber_sources where id=${source.id} and enabled=false and auto_publish=false and revision=${source.revision} for update) select 1/count(*)::int from locked`;
  let identity;
  if(mappings.length)identity={optionCode:authorityPhysicalId('demae_can','option',mappings[0].externalId,chainId),groupCode:mappings[0].externalParentId.slice(6),marker:target.marker};
  else {
   if(!attempts.length)await sql.transaction([locked(),sql`insert into menu_uber_creation_attempts(source_id,platform,source_key,status,command_id) values(${source.id},'demae_can',${sourceKey},'creating',${commandId})`]);
   const previous=attempts[0];
   const receipt=previous?.externalId?{optionCode:authorityPhysicalId('demae_can','option',previous.externalId,chainId),groupCode:previous.externalParentId?.startsWith('stage:')?previous.externalParentId.slice(6):''}:undefined;
   const actual=await stage.ensure({marker:target.marker,price:target.price,itemType:'REDUCED_RATE_NORMAL_ITEM',allowCreate:!attempts.length,receipt},async row=>{
    const externalId=`itemList_${chainId}${row.optionCode}true`,parent=row.groupCode?`stage:${row.groupCode}`:'';
    await sql.transaction([locked(),sql`update menu_uber_creation_attempts set external_id=case when external_id in ('',${externalId}) then ${externalId} else null end,external_parent_id=${parent},updated_at=now() where source_id=${source.id} and platform='demae_can' and source_key=${sourceKey} and status='creating'`]);
   });
   identity={optionCode:String(actual.option.optionCode),groupCode:actual.groupCode,marker:target.marker};
   const externalId=`itemList_${chainId}${identity.optionCode}true`,parent=`stage:${identity.groupCode}`;
   await sql.transaction([locked(),
    sql`update menu_uber_creation_attempts set status='identified',external_id=${externalId},external_parent_id=${parent},updated_at=now() where source_id=${source.id} and platform='demae_can' and source_key=${sourceKey}`,
    sql`insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_parent_id,external_name) values(${brandId},${platformId},'option',${node.targetId},${externalId},${parent},${target.name})`,
    sql`insert into menu_platform_availability_settings(brand_id,store_id,target_kind,target_id,platform,availability) values(${brandId},${config.storeId},'option',${node.targetId},'demae_can','unavailable') on conflict(store_id,target_kind,target_id,platform) do update set availability='unavailable',updated_at=now()`]);
  }
  await stage.update(identity,{name:target.name,price:target.price});
  const actual=await stage.read(identity);
  if(!sameMenuValue(before,await client.catalog())||!sameMenuValue(stockBefore,await client.stockCatalog()))throw Error('smoke_live_menu_or_stock_changed');
  console.log(JSON.stringify({verified:true,hidden:actual.hidden,optionCode:identity.optionCode,groupCode:identity.groupCode,name:actual.option.optionName,price:Number(actual.option.price),reused:mappings.length>0,liveMenuUnchanged:true,imagePolicy:'read_only'}));
 }
}finally{transport.close();}
