// Read-only unless --apply. Creates an empty, unassigned draft area only.
import {createHash} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {loadLocalEnv} from './db-env.mjs';
import {loadConfig} from '../desktop-bridge/src/config.mjs';
import {BrowserSession} from '../desktop-bridge/src/browser-session.mjs';
import {connectMerchantMenuClient} from '../desktop-bridge/src/merchant-menu-client.mjs';
import {DemaeDraftClient} from '../desktop-bridge/src/demae-draft-client.mjs';
loadLocalEnv();
const [brandId,chainId,livePattern]=process.argv.slice(2);
if(!brandId||!chainId||!livePattern)throw Error('Usage: ... <brand UUID> <chain ID> <live pattern> [--apply]');
const config=await loadConfig(),sql=neon(process.env.DATABASE_URL);
const rows=await sql`select id::text,revision,enabled,auto_publish,uber_store_uuid,publish_config from menu_uber_sources where brand_id::text=${brandId} and store_id::text=${config.storeId}`;
if(rows.length!==1||rows[0].enabled||rows[0].auto_publish||rows[0].uber_store_uuid!==config.platforms.uber_eats.storeUuid)throw Error('draft_prepare_requires_disabled_matching_source');
const source=rows[0],areaMarker=`FS${createHash('sha256').update(`${source.id}:demae-drafts`).digest('hex').slice(0,14)}`;
const transport=await connectMerchantMenuClient(new BrowserSession(config,'demae_can'),'https://partner.demae-can.com','MSA0000');
try {
 const client=new DemaeDraftClient(transport,chainId,livePattern);
 const patterns=await client.patterns();
 if(!patterns.some(row=>row.menuPatternCode===livePattern))throw Error('draft_live_scope_missing');
 console.log(JSON.stringify({readOnly:!process.argv.includes('--apply'),areaMarker,patterns:patterns.map(row=>({code:row.menuPatternCode,name:row.menuPatternName,shops:row.shopCountPerMenuPattern}))}));
 if(process.argv.includes('--apply')) {
  const save=async receipt=>{
   const key=receipt.kind==='menu_pattern'?'draftPatternCode':'draftCategory';
   const value=receipt.kind==='menu_pattern'?receipt.externalId:receipt.receipt;
   await sql.transaction([
    sql`with locked as materialized(select id from menu_uber_sources where id=${source.id} and revision=${source.revision} and enabled=false and auto_publish=false for update) select 1/count(*)::int from locked`,
    sql`update menu_uber_sources set publish_config=jsonb_set(publish_config,'{demae_can}',coalesce(publish_config->'demae_can','{}'::jsonb)||jsonb_build_object(${key}::text,${JSON.stringify(value)}::jsonb)),updated_at=now() where id=${source.id}`
   ]);
  };
  const patternId=await client.ensurePattern(areaMarker,save);
  await save({kind:'menu_pattern',externalId:patternId});
  const category=await client.ensureCategory(patternId,areaMarker,save);
  await save({kind:'category',externalId:category.categoryCode,receipt:category});
  await client.assertHiddenPattern(patternId);
  console.log(JSON.stringify({draftAreaVerified:true,patternId,categoryCode:category.categoryCode,assignedShops:0,itemsCreated:0}));
 }
}finally{transport.close();}
