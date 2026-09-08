// Narrow live smoke flow for one owner-approved existing OS option. No source
// activation, parent edits, image writes, or sales-state restoration.
import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {BrowserSession} from '../desktop-bridge/src/browser-session.mjs';
import {CdpPage} from '../desktop-bridge/src/cdp-page.mjs';
import {captureUberAuthoritativeCatalog} from '../desktop-bridge/src/uber-authoritative-catalog.mjs';
import {connectMerchantMenuClient,sameMenuValue} from '../desktop-bridge/src/merchant-menu-client.mjs';
import {AuthorityNativeDriver} from '../desktop-bridge/src/uber-authority-native-driver.mjs';
import {ensureUberAuthorityObject} from '../desktop-bridge/src/uber-authority-create.mjs';
import {buildUberPublication} from '../lib/uber-menu-publication.ts';

loadLocalEnv();
const {ingestUberMenuSource}=await import('../lib/uber-menu-source-sync.ts');
const sql=neon(process.env.DATABASE_URL),config=await loadConfig();
const [brandId,merchantId,sourceKey]=process.argv.slice(2);
if(!brandId||!/^\d+$/.test(merchantId??'')||!/^option:[^:]+:[^:]+$/.test(sourceKey??''))throw Error('Usage: ... <brand UUID> <Rocket store> <option source key> [--apply]');
const sources=await sql`select * from menu_uber_sources where brand_id::text=${brandId} and store_id::text=${config.storeId}`;
const source=sources[0];
if(sources.length!==1||source.uber_store_uuid!==config.platforms.uber_eats.storeUuid||source.enabled||source.auto_publish)throw Error('smoke_requires_disabled_matching_source');
if(String(config.platforms.rocket_now?.storeId)!==merchantId
 || (source.publish_config?.rocket_now?.merchantId && String(source.publish_config.rocket_now.merchantId)!==merchantId))throw Error('smoke_merchant_scope_mismatch');
const commandId=randomUUID(),page=await CdpPage.connect(9331,'https://merchants.ubereats.com/');
let catalog;
try {
 const raw=await page.evaluate(`fetch('/manager/menumaker/api/getMenuData?localeCode=ja-JP',{method:'POST',credentials:'include',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-csrf-token':'x'},body:JSON.stringify({storeUUID:${JSON.stringify(source.uber_store_uuid)},shouldLoadItems:true})}).then(async r=>{if(!r.ok)throw Error('Uber read failed:'+r.status);return r.json()})`);
 catalog=captureUberAuthoritativeCatalog(raw,source.uber_store_uuid);
}finally{page.close();}
const preview=await ingestUberMenuSource({sourceId:source.id,storeId:config.storeId,commandId,catalog,dryRun:true});
const node=preview.nodes.find(row=>row.sourceKey===sourceKey);
if(!node||node.kind!=='option'||node.isNew)throw Error('smoke_requires_existing_os_option');
const parent=preview.nodes.find(row=>row.kind==='option_group'&&row.targetId===node.parentId);
if(!parent)throw Error('smoke_parent_missing');
const platforms=await sql`select id::text from menu_external_platforms where brand_id::text=${brandId} and store_id is null and platform_key='rocket_now' and is_active=true`;
if(platforms.length!==1)throw Error('smoke_platform_scope_invalid');
const platformId=platforms[0].id;
const mappings=await sql`select target_type as kind,target_id::text as "targetId",external_id as "externalId",external_parent_id as "externalParentId" from menu_platform_object_mappings where external_platform_id=${platformId} and (target_id::text=${node.targetId} or target_id::text=${parent.targetId})`;
const payload=buildUberPublication({sourceId:source.id,storeId:config.storeId,brandId,revision:source.revision,platform:'rocket_now',merchantId,nodes:[parent,node],mappings});
const target=payload.targets.find(row=>row.sourceKey===sourceKey);
const attempts=await sql`select status,external_id as "externalId",external_parent_id as "externalParentId" from menu_uber_creation_attempts where source_id=${source.id} and platform='rocket_now' and source_key=${sourceKey}`;
if(attempts.length)payload.authorityState={[sourceKey]:attempts[0]};
const transport=await connectMerchantMenuClient(new BrowserSession(config,'rocket_now'),'https://store.rocketnow.co.jp','SUCCESS');
try {
 const driver=new AuthorityNativeDriver(transport,payload);
 const before=await driver.snapshot();driver.contentSnapshot=before;
 const parentId=driver.hiddenOptionParent(target,before);
 if(!parentId)throw Error('smoke_requires_verified_parent_mapping');
 const candidates=before.filter(row=>row.kind==='option'&&row.name===target.name);
 if(!target.mappings.length&&candidates.length)throw Error('smoke_existing_unmapped_candidate');
 console.log(JSON.stringify({readOnly:!process.argv.includes('--apply'),sourceKey,name:target.name,price:target.price,parentId,mappings:target.mappings.length}));
 if(process.argv.includes('--apply')) {
  const progress=async({authorityOperation:op})=>{
   if(!op)return;
   const statements=[sql`with locked as materialized (select id from menu_uber_sources where id=${source.id} and enabled=false and auto_publish=false and revision=${source.revision} for update) select 1/count(*)::int from locked`];
   if(op.status==='creating')statements.push(sql`insert into menu_uber_creation_attempts(source_id,platform,source_key,status,command_id) values(${source.id},'rocket_now',${sourceKey},'creating',${commandId}) on conflict(source_id,platform,source_key) do update set status=case when menu_uber_creation_attempts.status='rejected' then 'creating' else null end,command_id=excluded.command_id,updated_at=now()`);
   else if(op.status==='received')statements.push(sql`update menu_uber_creation_attempts set external_id=${op.externalId},external_parent_id=${op.externalParentId},updated_at=now() where source_id=${source.id} and platform='rocket_now' and source_key=${sourceKey} and command_id=${commandId} and status='creating' and external_id=''`);
   else if(op.status==='identified') {
    statements.push(sql`insert into menu_uber_creation_attempts(source_id,platform,source_key,status,external_id,external_parent_id,command_id) values(${source.id},'rocket_now',${sourceKey},'identified',${op.externalId},${op.externalParentId},${commandId}) on conflict(source_id,platform,source_key) do update set status='identified',external_id=case when menu_uber_creation_attempts.external_id in ('',excluded.external_id) then excluded.external_id else null end,external_parent_id=excluded.external_parent_id,updated_at=now()`);
    statements.push(sql`insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_parent_id,external_name) values(${brandId},${platformId},'option',${node.targetId},${op.externalId},${op.externalParentId},${target.name}) on conflict(external_platform_id,target_type,external_id) do update set target_id=case when menu_platform_object_mappings.target_id=excluded.target_id then excluded.target_id else null end,external_parent_id=excluded.external_parent_id`);
    statements.push(sql`insert into menu_platform_availability_settings(brand_id,store_id,target_kind,target_id,platform,availability) values(${brandId},${config.storeId},'option',${node.targetId},'rocket_now','unavailable') on conflict(store_id,target_kind,target_id,platform) do update set availability='unavailable',updated_at=now()`);
   } else throw Error('smoke_unexpected_progress');
   await sql.transaction(statements);
  };
  let creates=0;const create=driver.createHidden.bind(driver);
  driver.createHidden=async target=>{creates++;return create(target);};
  await ensureUberAuthorityObject(target,payload,driver,progress);
  const found=await driver.findById(target.mappings[0].externalId,target);
  if(!found?.hidden)throw Error('smoke_option_not_permanently_hidden');
  await driver.updateContent(target);
  await ensureUberAuthorityObject(target,payload,driver,progress);
  await driver.beginPhase('verifying');
  const actual=(await driver.observe(target))[0];
  if(!actual?.exists||actual.hidden!==true||actual.name!==target.name||actual.price!==target.price||!actual.structureVerified)throw Error('smoke_final_verification_failed');
  const after=driver.observationSnapshot,id=driver.id('option',actual.externalId);
  const preserved=rows=>rows.filter(row=>!(row.kind==='option'&&row.id===id)).map(row=>({kind:row.kind,id:row.id,name:row.name,price:row.price,hidden:row.hidden,parentIds:row.parentIds,groupIds:row.groupIds,childIds:row.childIds?.filter(child=>!(row.kind==='option_group'&&child===id))}));
  if(!sameMenuValue(preserved(before),preserved(after)))throw Error('smoke_unrelated_menu_change_detected');
  console.log(JSON.stringify({verified:true,creates,retryCreatedNothing:true,...actual,imagePolicy:'read_only'}));
 }
}finally{transport.close();}
