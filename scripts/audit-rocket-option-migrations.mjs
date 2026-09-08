// Independent, read-only acceptance of every durable replacement migration.
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {BrowserSession} from '../desktop-bridge/src/browser-session.mjs';
import {connectMerchantMenuClient} from '../desktop-bridge/src/merchant-menu-client.mjs';
import {RocketMenuClient} from '../desktop-bridge/src/rocket-menu-client.mjs';

loadLocalEnv();
const sql=neon(process.env.DATABASE_URL),config=await loadConfig(),brandId=process.argv[2];
if(!brandId)throw Error('Usage: node scripts/audit-rocket-option-migrations.mjs <brand UUID>');
const sources=await sql`select id,publish_config from menu_uber_sources where brand_id::text=${brandId} and store_id::text=${config.storeId}`;
if(sources.length!==1||String(sources[0].publish_config?.rocket_now?.merchantId)!==String(config.platforms.rocket_now.storeId))throw Error('migration_audit_scope_invalid');
const records=await sql`select state from menu_uber_option_migrations where source_id=${sources[0].id} and platform='rocket_now'`;
const mappings=await sql`select m.target_id::text,m.external_id,m.external_parent_id from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id where p.brand_id::text=${brandId} and p.store_id is null and p.platform_key='rocket_now' and m.target_type='option'`;
const transport=await connectMerchantMenuClient(new BrowserSession(config,'rocket_now'),'https://store.rocketnow.co.jp','SUCCESS');
try {
  const catalog=await new RocketMenuClient(transport,config.platforms.rocket_now.storeId).catalog();
  const entries=catalog.groups.flatMap(group=>(group.optionItems??[]).map(item=>({groupId:String(group.optionId),item})));
  const issues=[],counts={ON_SALE:0,NOT_EXPOSE:0};
  for(const {state} of records) {
    const replacements=entries.filter(row=>String(row.item.optionItemId)===state.newId);
    const next=replacements[0],newExternalId=`sub_checkbox_${state.toParentId}_${state.newId}`;
    const owned=mappings.filter(row=>row.target_id===state.targetId&&row.external_id===newExternalId&&row.external_parent_id===state.toParentId);
    if(state.phase!=='complete'||replacements.length!==1||next?.groupId!==state.toParentId
      ||next?.item.optionItemName!==state.name||Number(next?.item.salePrice)!==state.price
      ||next?.item.displayStatus!==state.displayStatus||next?.item.forceNotExpose
      ||entries.some(row=>String(row.item.optionItemId)===state.fromId)
      ||owned.length!==1||mappings.some(row=>row.external_id===state.fromExternalId))issues.push({sourceKey:state.sourceKey,phase:state.phase,name:state.name,
        fromId:state.fromId,newId:state.newId,replacements:replacements.length,ownedMappings:owned.length,
        expected:{group:state.toParentId,price:state.price,status:state.displayStatus},
        actual:next?{group:next.groupId,name:next.item.optionItemName,price:next.item.salePrice,status:next.item.displayStatus,temporaryHold:next.item.forceNotExpose}:null,
        oldExists:entries.some(row=>String(row.item.optionItemId)===state.fromId),oldMapped:mappings.some(row=>row.external_id===state.fromExternalId)});
    else counts[state.displayStatus]++;
  }
  console.log(JSON.stringify({readOnly:true,migrations:records.length,verified:counts.ON_SALE+counts.NOT_EXPOSE,stockPreserved:counts,issues}));
  if(issues.length)process.exitCode=1;
}finally{transport.close();}
