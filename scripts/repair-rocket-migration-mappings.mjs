// Remove obsolete legacy aliases only after independent native cutover proof.
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {BrowserSession} from '../desktop-bridge/src/browser-session.mjs';
import {connectMerchantMenuClient} from '../desktop-bridge/src/merchant-menu-client.mjs';
import {RocketMenuClient} from '../desktop-bridge/src/rocket-menu-client.mjs';
loadLocalEnv();
const sql=neon(process.env.DATABASE_URL),config=await loadConfig(),brandId=process.argv[2];
if(!brandId)throw Error('Brand required');
const sources=await sql`select * from menu_uber_sources where brand_id::text=${brandId} and store_id::text=${config.storeId}`;
const source=sources[0];
if(sources.length!==1||source.enabled||source.auto_publish||String(source.publish_config?.rocket_now?.merchantId)!==String(config.platforms.rocket_now.storeId))throw Error('repair_scope_invalid');
const platforms=await sql`select id from menu_external_platforms where brand_id::text=${brandId} and store_id is null and platform_key='rocket_now' and is_active=true`;
if(platforms.length!==1)throw Error('repair_platform_invalid');
const platformId=platforms[0].id;
const records=await sql`select state from menu_uber_option_migrations where source_id=${source.id} and platform='rocket_now'`;
if(records.some(row=>row.state.phase!=='complete'))throw Error('repair_migration_pending');
const mappings=await sql`select m.*,o.is_active,exists(select 1 from menu_uber_objects u where u.source_id=${source.id} and u.target_id=m.target_id and not u.archived) as source_owned from menu_platform_object_mappings m left join menu_options o on o.id=m.target_id where m.external_platform_id=${platformId} and m.target_type='option'`;
const transport=await connectMerchantMenuClient(new BrowserSession(config,'rocket_now'),'https://store.rocketnow.co.jp','SUCCESS');
try {
 const catalog=await new RocketMenuClient(transport,config.platforms.rocket_now.storeId).catalog();
 const entries=catalog.groups.flatMap(g=>(g.optionItems??[]).map(item=>({group:String(g.optionId),item})));
 for(const {state:s} of records) {
  const next=entries.filter(row=>String(row.item.optionItemId)===s.newId);
  if(next.length!==1||next[0].group!==s.toParentId||next[0].item.optionItemName!==s.name||Number(next[0].item.salePrice)!==s.price
   ||next[0].item.displayStatus!==s.displayStatus||next[0].item.forceNotExpose||entries.some(row=>String(row.item.optionItemId)===s.fromId)
   ||!mappings.some(row=>row.target_id===s.targetId&&row.external_id===`sub_checkbox_${s.toParentId}_${s.newId}`))throw Error('repair_cutover_unverified');
 }
 const obsolete=new Map(records.map(({state:s})=>[s.fromExternalId,s]));
 const changes=mappings.flatMap(row=>{
  const tokens=row.external_id.split(',').map(s=>s.trim()),removed=tokens.filter(id=>obsolete.has(id));
  if(!removed.length)return [];
  if(removed.some(id=>obsolete.get(id).targetId!==row.target_id)&&(row.is_active!==false||row.source_owned))throw Error('repair_foreign_active_owner');
  // This repair never guesses surviving ownership or rewrites a mixed row.
  if(tokens.some(id=>!obsolete.has(id)))throw Error('repair_partial_legacy_row_requires_review');
  return [{row,removed}];
 });
 console.log(JSON.stringify({apply:process.argv.includes('--apply'),obsoleteRows:changes.length,obsoleteOccurrences:changes.reduce((n,c)=>n+c.removed.length,0)}));
 if(process.argv.includes('--apply')&&changes.length)await sql.transaction([
  sql`with locked as materialized(select id from menu_uber_sources where id=${source.id} and revision=${source.revision} and enabled=false and auto_publish=false for update) select 1/count(*)::int from locked`,
  sql`insert into menu_platform_snapshots(brand_id,store_id,external_platform_id,snapshot_type,rule_version,payload) values(${brandId},${config.storeId},${platformId},'baseline','migration-alias-repair-v1',${JSON.stringify({mappings:changes.map(c=>c.row)})}::jsonb)`,
  ...changes.map(({row})=>sql`with removed as (delete from menu_platform_object_mappings where id=${row.id} and external_id=${row.external_id} and target_id=${row.target_id} and external_platform_id=${platformId} returning 1) select 1/count(*)::int from removed`)
 ]);
}finally{transport.close();}
