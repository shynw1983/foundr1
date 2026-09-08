// Explicit, narrow live smoke test. Default is read-only; --apply creates only
// the requested, source-verified missing item, with no customer-facing links.
import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {BrowserSession} from '../desktop-bridge/src/browser-session.mjs';
import {CdpPage} from '../desktop-bridge/src/cdp-page.mjs';
import {captureUberAuthoritativeCatalog} from '../desktop-bridge/src/uber-authoritative-catalog.mjs';
import {connectMerchantMenuClient} from '../desktop-bridge/src/merchant-menu-client.mjs';
import {DemaeMenuClient} from '../desktop-bridge/src/demae-menu-client.mjs';
import {DemaeDraftClient} from '../desktop-bridge/src/demae-draft-client.mjs';
import {ensureUberAuthorityObject} from '../desktop-bridge/src/uber-authority-create.mjs';
import {buildUberPublication} from '../lib/uber-menu-publication.ts';
import {authorityPhysicalId} from '../desktop-bridge/src/uber-authority-parents.mjs';
loadLocalEnv();
const {ingestUberMenuSource}=await import('../lib/uber-menu-source-sync.ts');
const sql=neon(process.env.DATABASE_URL),config=await loadConfig();
const [brandId,chainId,pattern,sourceKey]=process.argv.slice(2);
if(!brandId||!chainId||!pattern||!/^item:|^option:/.test(sourceKey??''))throw Error('Usage: ... <brand UUID> <Demae chain> <pattern> <source key> [--apply]');
const kind=sourceKey.startsWith('item:')?'item':'option';
const sources=await sql`select * from menu_uber_sources where brand_id::text=${brandId} and store_id::text=${config.storeId}`;
const source=sources[0];
if(sources.length!==1||source.uber_store_uuid!==config.platforms.uber_eats.storeUuid||source.enabled||source.auto_publish)throw Error('smoke_test_requires_disabled_matching_source');
const commandId=randomUUID(),page=await CdpPage.connect(9331,'https://merchants.ubereats.com/');
let catalog;
try {
 const raw=await page.evaluate(`fetch('/manager/menumaker/api/getMenuData?localeCode=ja-JP',{method:'POST',credentials:'include',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-csrf-token':'x'},body:JSON.stringify({storeUUID:${JSON.stringify(source.uber_store_uuid)},shouldLoadItems:true})}).then(async r=>{if(!r.ok)throw Error('Uber read failed:'+r.status);return r.json()})`);
 catalog=captureUberAuthoritativeCatalog(raw,source.uber_store_uuid);
}finally{page.close();}
const preview=await ingestUberMenuSource({sourceId:source.id,storeId:config.storeId,commandId,catalog,dryRun:true});
const node=preview.nodes?.find(row=>row.sourceKey===sourceKey);
if(!node||node.isNew||node.kind!==kind)throw Error('smoke_test_requires_existing_os_item');
const platforms=await sql`select id::text from menu_external_platforms where brand_id::text=${brandId} and store_id is null and platform_key='demae_can' and is_active=true`;
if(platforms.length!==1)throw Error('platform_scope_invalid');
const platformId=platforms[0].id;
const mappings=await sql`select target_type as kind,target_id::text as "targetId",external_id as "externalId",external_parent_id as "externalParentId" from menu_platform_object_mappings where external_platform_id=${platformId} and target_type=${kind} and target_id::text=${node.targetId}`;
const payload=buildUberPublication({sourceId:source.id,storeId:config.storeId,brandId,revision:source.revision,platform:'demae_can',merchantId:chainId,menuPatternCode:pattern,quarantinedSourceKeys:source.publish_config?.demae_can?.quarantinedSourceKeys,nodes:[node],mappings});
const target=payload.targets[0];
if(target.quarantined)throw Error('user_quarantined_object_do_not_create_or_link');
const attempts=await sql`select status,external_id as "externalId" from menu_uber_creation_attempts where source_id=${source.id} and platform='demae_can' and source_key=${sourceKey}`;
if(attempts.length)payload.authorityState={[sourceKey]:attempts[0]};
const transport=await connectMerchantMenuClient(new BrowserSession(config,'demae_can'),'https://partner.demae-can.com','MSA0000');
try {
 const draftConfig=source.publish_config?.demae_can??{};
 const draftClient=new DemaeDraftClient(transport,chainId,pattern);
 const client=new DemaeMenuClient(transport,chainId,pattern,{draftPatternCode:draftConfig.draftPatternCode});
 const useDraft=process.argv.includes('--draft-area')&&kind==='item';
 if(useDraft) {
  if(!draftConfig.draftPatternCode||!draftConfig.draftCategory)throw Error('verified_draft_area_required');
  await draftClient.assertHiddenPattern(draftConfig.draftPatternCode);
 }
 const allRows=async()=>{
  const live=kind==='item'?await client.allItems():await client.options();
  if(!useDraft)return live;
  const drafts=await transport.request(`/merchant-admin/api/v2/product/suggest/chain/${chainId}/menu-pattern/${draftConfig.draftPatternCode}/item-list-with-unlinked`);
  if(!Array.isArray(drafts))throw Error('draft_items_incomplete');
  return [...new Map([...live,...drafts].map(row=>[row.itemCode,row])).values()];
 };
 const remoteName=row=>kind==='item'?row.itemName:row.optionName;
 const remoteCode=row=>kind==='item'?row.itemCode:row.optionCode;
 const read=async id=>kind==='item'?client.item(id):(await client.options()).find(row=>String(row.optionCode)===String(id));
 const hidden=async(id,detail)=>useDraft?Boolean(await draftClient.assertHiddenItem(draftConfig.draftPatternCode,id)):kind==='item'?detail.categoryItemLinkList?.length===0&&(await client.itemOccurrences(id)).length===0:(await client.optionOccurrences(id)).length===0;
 const all=await allRows();
 const duplicate=all.filter(row=>remoteName(row)===target.name);
 if(!mappings.length&&duplicate.length)throw Error(`existing_unmapped_item_requires_identity_review:${duplicate.map(row=>row.itemCode).join(',')}`);
 const baseline=(await client.catalog()).items.categoryList;
 // Reuse the verified tax classification of this store's normal food items;
 // a mixed tax classification requires explicit metadata instead.
 const sample=baseline.flatMap(category=>category.itemList??[])[0];
 if(!sample)throw Error('smoke_tax_reference_missing');
 const reference=await client.item(sample.itemCode);
 if(reference.itemType!=='REDUCED_RATE_NORMAL_ITEM')throw Error('smoke_tax_reference_unsupported');
 const findMarker=async marker=>{
  const matches=(await allRows()).filter(row=>remoteName(row)===marker);
  return Promise.all(matches.map(async row=>{
   const id=remoteCode(row),detail=await read(id);
   return {externalId:`itemList_${chainId}${id}${kind==='option'?'true':'false'}`,hidden:await hidden(id,detail)};
  }));
 };
 console.log(JSON.stringify({readOnly:!process.argv.includes('--apply'),sourceKey,name:target.name,price:target.price,mapped:mappings.length,markerMatches:(await findMarker(target.marker)).length}));
 if(!process.argv.includes('--apply'))process.exitCode=0;
 else {
  if(!useDraft&&!target.mappings.length && !(await findMarker(target.marker)).length)throw Error('live_create_paused_until_unlinked_recovery_is_verified');
  const progress=async({authorityOperation:op})=>{
   const statements=[sql`with locked as materialized (select id from menu_uber_sources where id=${source.id} and enabled=false and auto_publish=false and revision=${source.revision} for update) select 1/count(*)::int from locked`];
   if(op.status==='creating')statements.push(sql`insert into menu_uber_creation_attempts(source_id,platform,source_key,status,command_id) values(${source.id},'demae_can',${sourceKey},'creating',${commandId}) on conflict(source_id,platform,source_key) do update set status=case when menu_uber_creation_attempts.status='rejected' then 'creating' else null end,command_id=excluded.command_id,updated_at=now()`);
   else if(op.status==='rejected')statements.push(sql`update menu_uber_creation_attempts set status='rejected',updated_at=now() where source_id=${source.id} and platform='demae_can' and source_key=${sourceKey} and command_id=${commandId} and status='creating' and external_id=''`);
   else if(op.status==='received')statements.push(sql`update menu_uber_creation_attempts set external_id=${op.externalId},updated_at=now() where source_id=${source.id} and platform='demae_can' and source_key=${sourceKey} and command_id=${commandId} and status='creating' and external_id=''`);
   else {
    statements.push(sql`insert into menu_uber_creation_attempts(source_id,platform,source_key,status,external_id,command_id) values(${source.id},'demae_can',${sourceKey},'identified',${op.externalId},${commandId}) on conflict(source_id,platform,source_key) do update set status='identified',external_id=case when menu_uber_creation_attempts.external_id in ('',excluded.external_id) then excluded.external_id else null end,updated_at=now()`);
    statements.push(sql`insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_parent_id,external_name) values(${brandId},${platformId},${kind},${target.targetId},${op.externalId},'',${target.name}) on conflict(external_platform_id,target_type,external_id) do update set target_id=case when menu_platform_object_mappings.target_id=excluded.target_id then excluded.target_id else null end`);
    statements.push(sql`insert into menu_platform_availability_settings(brand_id,store_id,target_kind,target_id,platform,availability) values(${brandId},${config.storeId},${kind},${target.targetId},'demae_can','unavailable') on conflict(store_id,target_kind,target_id,platform) do update set availability='unavailable',updated_at=now()`);
   }
   await sql.transaction(statements);
  };
  let creates=0;
  const driver={findMarker,
   findById:useDraft?async externalId=>{
    const id=authorityPhysicalId('demae_can',kind,externalId,chainId),actual=await draftClient.assertHiddenItem(draftConfig.draftPatternCode,id);
    return {externalId,marker:actual.itemName,hidden:true};
   }:undefined,
   isDefiniteRejection:error=>String(error.message).includes('merchant_menu_request_failed:400:MWA0012:'),
   createHidden:async()=>{
    creates++;
    const args={marker:target.marker,price:target.price,description:target.description,itemType:reference.itemType};
    const receipt=useDraft?await draftClient.createItem({...args,patternId:draftConfig.draftPatternCode,category:draftConfig.draftCategory},async receipt=>{
     await progress({authorityOperation:{sourceKey,status:'received',externalId:`itemList_${chainId}${receipt.externalId}false`}});
    }):kind==='item'?await client.createUnlinkedItem(args):await client.createUnlinkedOption(args);
    const id=kind==='item'?receipt?.itemCode:receipt?.optionCode;
    if(!id)throw Error('smoke_create_receipt_missing');
    return {externalId:`itemList_${chainId}${id}${kind==='option'?'true':'false'}`};
   }
  };
  const [mapping]=await ensureUberAuthorityObject(target,payload,driver,progress);
  const id=authorityPhysicalId('demae_can',kind,mapping.externalId,chainId);
  const detail=await read(id);
  if(!await hidden(id,detail))throw Error('smoke_item_not_hidden');
  if(kind==='item')await client.updateItem(id,{name:target.name,price:target.price,description:target.description});
  else await client.updateOption(id,{name:target.name,price:target.price});
  await ensureUberAuthorityObject(target,payload,driver,progress);
  const actual=await read(id);
  if(remoteName(actual)!==target.name||!await hidden(id,actual))throw Error('smoke_final_verification_failed');
  console.log(JSON.stringify({verified:true,kind,externalId:mapping.externalId,name:remoteName(actual),prices:kind==='item'?actual.sizeInfoList.map(size=>size.price):[actual.price],hiddenByNoSalesLinks:true,creates,retryCreatedNothing:true,imagePolicy:'read_only',groupsPending:true}));
 }
}finally{transport.close();}
