// Execute one fully preflighted, committed OS revision while automatic
// synchronization remains OFF. Every create receipt is durable before rename.
import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {BrowserSession} from '../desktop-bridge/src/browser-session.mjs';
import {CdpPage} from '../desktop-bridge/src/cdp-page.mjs';
import {captureUberAuthoritativeCatalog} from '../desktop-bridge/src/uber-authoritative-catalog.mjs';
import {connectMerchantMenuClient} from '../desktop-bridge/src/merchant-menu-client.mjs';
import {AuthorityNativeDriver} from '../desktop-bridge/src/uber-authority-native-driver.mjs';
import {runUberAuthorityPublication} from '../desktop-bridge/src/uber-authority-runner.mjs';
import {buildUberPublication,verifyUberPublication} from '../lib/uber-menu-publication.ts';
import {uberSourceContentHash} from '../lib/uber-menu-authority.ts';

loadLocalEnv();const {ingestUberMenuSource}=await import('../lib/uber-menu-source-sync.ts');
const sql=neon(process.env.DATABASE_URL),config=await loadConfig();
const [brandId,platform]=process.argv.slice(2);
if(!brandId||!['rocket_now','demae_can'].includes(platform))throw Error('Usage: ... <brand> <platform> [--apply]');
const sources=await sql`select * from menu_uber_sources where brand_id::text=${brandId} and store_id::text=${config.storeId}`;
const source=sources[0],commandId=randomUUID();
if(sources.length!==1||source.enabled||source.auto_publish||source.revision<1||source.uber_store_uuid!==config.platforms.uber_eats.storeUuid)throw Error('acceptance_source_scope_invalid');
const settings=source.publish_config?.[platform];
if(!settings?.merchantId||platform==='demae_can'&&!settings.menuPatternCode)throw Error('acceptance_merchant_missing');
if(platform==='rocket_now'&&String(settings.merchantId)!==String(config.platforms.rocket_now.storeId))throw Error('acceptance_merchant_mismatch');
const page=await CdpPage.connect(9331,'https://merchants.ubereats.com/');let catalog;
try {
 const raw=await page.evaluate(`fetch('/manager/menumaker/api/getMenuData?localeCode=ja-JP',{method:'POST',credentials:'include',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','x-csrf-token':'x'},body:JSON.stringify({storeUUID:${JSON.stringify(source.uber_store_uuid)},shouldLoadItems:true})}).then(r=>{if(!r.ok)throw Error('Uber read failed');return r.json()})`);
 catalog=captureUberAuthoritativeCatalog(raw,source.uber_store_uuid);
}finally{page.close();}
if(uberSourceContentHash(catalog)!==source.last_content_hash)throw Error('acceptance_uber_changed_reimport_required');
const preview=await ingestUberMenuSource({sourceId:source.id,storeId:config.storeId,commandId,catalog,dryRun:true});
if(preview.added||!preview.nodes?.length)throw Error('acceptance_uncommitted_source_nodes');
const platforms=await sql`select id from menu_external_platforms where brand_id::text=${brandId} and store_id is null and platform_key=${platform} and is_active=true`;
if(platforms.length!==1)throw Error('acceptance_platform_scope_invalid');const platformId=platforms[0].id;
const mappings=await sql`select target_type as kind,target_id::text as "targetId",external_id as "externalId",external_parent_id as "externalParentId" from menu_platform_object_mappings where external_platform_id=${platformId}`;
const payload=buildUberPublication({sourceId:source.id,storeId:config.storeId,brandId,revision:source.revision,platform,...settings,nodes:preview.nodes,mappings});
const attempts=await sql`select source_key as "sourceKey",status,external_id as "externalId",external_parent_id as "externalParentId" from menu_uber_creation_attempts where source_id=${source.id} and platform=${platform}`;
payload.authorityState=Object.fromEntries(attempts.map(row=>[row.sourceKey,row]));
const transport=await connectMerchantMenuClient(new BrowserSession(config,platform),platform==='rocket_now'?'https://store.rocketnow.co.jp':'https://partner.demae-can.com',platform==='rocket_now'?'SUCCESS':'MSA0000');
try {
 const driver=new AuthorityNativeDriver(transport,payload),preflight=await driver.preflight(payload);
 console.log(JSON.stringify({platform,revision:source.revision,targets:payload.targets.length,preflight}));
 if(preflight.issues.length)throw Error('acceptance_preflight_blocked');
 if(process.argv.includes('--apply')) {
  const locked=()=>sql`with locked as materialized(select id from menu_uber_sources where id=${source.id} and revision=${source.revision} and enabled=false and auto_publish=false for update) select 1/count(*)::int from locked`;
  await sql.transaction([locked(),sql`insert into menu_platform_snapshots(brand_id,store_id,external_platform_id,snapshot_type,rule_version,content_hash,payload) values(${brandId},${config.storeId},${platformId},'pre_publish','uber-authority-v1',${source.last_content_hash},${JSON.stringify({commandId,revision:source.revision,rows:driver.contentSnapshot})}::jsonb)`]);
  let completed=0,lastPhase='';
  const result=await runUberAuthorityPublication(payload,driver,async progress=>{
   if(progress.phase!==lastPhase||progress.phase==='content'&&++completed%10===0) {console.log(JSON.stringify({phase:progress.phase,completed,sourceKey:progress.sourceKey}));lastPhase=progress.phase;}
   const op=progress.authorityOperation;if(!op)return;
   const target=payload.targets.find(row=>row.sourceKey===op.sourceKey);
   if(!target||target.quarantined)throw Error('acceptance_operation_invalid');
   const statements=[locked()];
   if(op.status==='creating')statements.push(sql`insert into menu_uber_creation_attempts(source_id,platform,source_key,status,command_id) values(${source.id},${platform},${op.sourceKey},'creating',${commandId}) on conflict(source_id,platform,source_key) do update set status=case when menu_uber_creation_attempts.status='rejected' then 'creating' else null end,command_id=excluded.command_id,updated_at=now()`);
   else if(op.status==='received')statements.push(sql`update menu_uber_creation_attempts set external_id=case when external_id in ('',${op.externalId}) then ${op.externalId} else null end,external_parent_id=${op.externalParentId},updated_at=now() where source_id=${source.id} and platform=${platform} and source_key=${op.sourceKey} and status='creating'`);
   else if(op.status==='identified') {
    statements.push(sql`insert into menu_uber_creation_attempts(source_id,platform,source_key,status,external_id,external_parent_id,command_id) values(${source.id},${platform},${op.sourceKey},'identified',${op.externalId},${op.externalParentId},${commandId}) on conflict(source_id,platform,source_key) do update set status='identified',external_id=case when menu_uber_creation_attempts.external_id in ('',excluded.external_id) then excluded.external_id else null end,external_parent_id=excluded.external_parent_id,updated_at=now()`);
    statements.push(sql`insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_parent_id,external_name) values(${brandId},${platformId},${target.kind},${target.targetId},${op.externalId},${op.externalParentId},${target.name}) on conflict(external_platform_id,target_type,external_id) do update set target_id=case when menu_platform_object_mappings.target_id=excluded.target_id then excluded.target_id else null end,external_parent_id=excluded.external_parent_id`);
    if(['item','option'].includes(target.kind))statements.push(sql`insert into menu_platform_availability_settings(brand_id,store_id,target_kind,target_id,platform,availability) values(${brandId},${config.storeId},${target.kind},${target.targetId},${platform},'unavailable') on conflict(store_id,target_kind,target_id,platform) do update set availability='unavailable',updated_at=now()`);
   }else throw Error('acceptance_status_invalid');
   await sql.transaction(statements);
  });
  const verification=verifyUberPublication(payload,result);
  await sql.transaction([locked(),sql`insert into menu_platform_snapshots(brand_id,store_id,external_platform_id,snapshot_type,rule_version,content_hash,payload) values(${brandId},${config.storeId},${platformId},'verification','uber-authority-v1',${source.last_content_hash},${JSON.stringify({commandId,revision:source.revision,verification,...result})}::jsonb)`]);
  console.log(JSON.stringify({platform,verified:true,revision:source.revision,...verification,imagePolicy:'read_only'}));
 }
}finally{transport.close();}
