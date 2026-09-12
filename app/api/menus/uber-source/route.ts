import { requireMasterOsSession } from '../../../../lib/api-auth';
import { sql } from '../../../../lib/db';
import { scheduleUberSourceScans } from '../../../../lib/uber-menu-source-sync';
import { nextMenuCheck } from '../../../../lib/menu-sync-status';
import { publishBridgeCommandAvailable } from '../../../../lib/local-bridge-realtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!await requireMasterOsSession()) return Response.json({error:'権限がありません。'},{status:403});
  const brandId = new URL(request.url).searchParams.get('brandId') ?? '';
  const sources = await sql`select id::text,brand_id::text,store_id::text,uber_store_uuid,enabled,auto_publish,revision,last_checked_at,last_error from menu_uber_sources where brand_id::text=${brandId}`;
  const runs = sources.length ? await sql`select r.id::text,r.revision,r.summary,r.created_at,coalesce(c.payload->>'trigger','unknown') as trigger from menu_uber_sync_runs r left join local_bridge_commands c on c.id=r.command_id where r.source_id=${sources[0].id} order by r.created_at desc limit 20` : [];
  const jobHistory = sources.length ? await sql`select id::text,platform,status,created_at,updated_at,last_error,attempts,available_at,payload->>'revision' as revision,result->'progress'->>'phase' as phase,result->'progress' as progress,payload->'manualRetryHistory' as retries from local_bridge_commands where store_id=${sources[0].store_id} and payload->>'sourceId'=${sources[0].id}::text and (payload->>'authoritativePublication'='true' or payload->>'authoritativeSource'='true') order by created_at desc limit 80` : [];
  const jobs=jobHistory.filter((row,index)=>jobHistory.findIndex(other=>other.platform===row.platform)===index);
  // Resolve only the current target name, never return the full command payload.
  for(const job of jobs.filter(row=>row.status==='processing')) {
    const progress=(job.progress??{}) as Record<string,unknown>;
    if(!progress.targetName) {
      const names=await sql`select target->>'name' as name from local_bridge_commands c cross join lateral jsonb_array_elements(coalesce(c.payload->'targets','[]'::jsonb)) target where c.id::text=${job.id} and c.store_id=${sources[0].store_id} and target->>'sourceKey'=coalesce(c.result->'progress'->>'sourceKey',c.result->'progress'->'authorityOperation'->>'sourceKey') limit 1`;
      job.progress={...progress,targetName:names[0]?.name??''};
    }
  }
  const successes=sources.length?await sql`select distinct on(platform) platform,payload->>'revision' as revision,completed_at from local_bridge_commands where store_id=${sources[0].store_id} and payload->>'sourceId'=${sources[0].id}::text and status='succeeded' order by platform,created_at desc`:[];
  const devices=sources.length?await sql`select platform,max(last_seen_at) as last_seen_at from local_bridge_devices where store_id=${sources[0].store_id} and is_enabled=true group by platform`:[];
  const prices = sources.length ? await sql`select o.target_id::text as id,o.kind,o.price_mode as mode,o.last_uber_price::float as "uberPrice",coalesce(i.name,p.name) as name,case when o.kind='item' then i.base_price else p.price_delta end::float as price from menu_uber_objects o left join menu_catalog_items i on o.kind='item' and i.id=o.target_id left join menu_options p on o.kind='option' and p.id=o.target_id where o.source_id=${sources[0].id} and o.kind in ('item','option') and not o.archived order by o.kind,name` : [];
  return Response.json({source:sources[0]??null,runs,jobs,jobHistory,successes,devices,prices,nextCheck:nextMenuCheck()},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request: Request) {
  if (!await requireMasterOsSession()) return Response.json({error:'権限がありません。'},{status:403});
  const body = await request.json().catch(()=>({}));
  const sources = await sql`select id::text,store_id::text,revision from menu_uber_sources where brand_id::text=${String(body.brandId??'')} and enabled=true`;
  if (!sources.length) return Response.json({error:'Uber メニュー連携はまだ有効になっていません。'},{status:409});
  if(body.action==='scan') return Response.json(await scheduleUberSourceScans(sources[0].store_id));
  if(body.action==='retry') {
    // Reuse the exact command ID: creation receipts and uncertain writes belong
    // to it. Never replay an older publication over a newer one.
    const source=sources[0],id=String(body.jobId??'');
    const result=await sql.transaction([
      sql`select lock_menu_uber_revision(${source.id},${source.revision})`,
      sql`update local_bridge_commands c set status='pending',attempts=0,available_at=now(),completed_at=null,claimed_by_device_id=null,claimed_at=null,claim_expires_at=null,
        payload=jsonb_set(c.payload,'{manualRetryHistory}',coalesce(c.payload->'manualRetryHistory','[]'::jsonb)||jsonb_build_array(jsonb_build_object('at',now(),'error',c.last_error,'attempts',c.attempts)))
          ||jsonb_build_object('authorityState',coalesce((select jsonb_object_agg(a.source_key,jsonb_build_object('sourceKey',a.source_key,'status',a.status,'externalId',a.external_id,'externalParentId',a.external_parent_id)) from menu_uber_creation_attempts a where a.source_id=${source.id} and a.platform=c.platform),'{}'::jsonb),'migrationState',coalesce((select jsonb_object_agg(m.migration_key,m.state) from menu_uber_option_migrations m where m.source_id=${source.id} and m.platform=c.platform),'{}'::jsonb)),
        last_error='',updated_at=now()
        where c.id::text=${id} and c.store_id=${source.store_id} and c.payload->>'sourceId'=${source.id} and c.payload->>'authoritativePublication'='true'
          and c.platform in ('rocket_now','demae_can') and c.status='failed'
          and coalesce(c.payload->'pendingRemovals','[]'::jsonb)='[]'::jsonb
          and c.payload->>'revision'=${String(source.revision)}
          and not exists(select 1 from local_bridge_commands newer where newer.store_id=c.store_id and newer.payload->>'sourceId'=c.payload->>'sourceId' and ((newer.platform=c.platform and newer.created_at>c.created_at) or newer.status in ('pending','processing')))
        returning c.id::text`
    ]);
    if(!result[1].length)return Response.json({error:'新しい同期または実行中の処理があります。状態を更新してください。'},{status:409});
    await publishBridgeCommandAvailable(String(source.store_id)).catch(()=>undefined);
    return Response.json({queued:1});
  }
  if(body.action==='price') {
    const price=Number(body.price);
    if(!['manual','automatic'].includes(body.mode) || (body.mode==='manual' && (body.price===null||body.price===undefined||String(body.price).trim()===''||!Number.isSafeInteger(price)||price<0))) return Response.json({error:'価格を確認してください。'},{status:400});
    const rows=await sql`select kind,target_id::text,last_uber_price::float from menu_uber_objects where source_id=${sources[0].id} and target_id::text=${String(body.targetId)} and kind in ('item','option') and not archived`;
    if(rows.length!==1) return Response.json({error:'商品が見つかりません。'},{status:404});
    const value=body.mode==='manual'?price:Math.round(Number(rows[0].last_uber_price)*0.8/10)*10;
    if(rows[0].last_uber_price===null || !Number.isSafeInteger(value) || value<0) return Response.json({error:'Uber の確定価格がありません。'},{status:409});
    await sql.transaction([
      sql`select lock_menu_uber_revision(${sources[0].id},${sources[0].revision})`,
      sql`update menu_uber_objects set price_mode=${body.mode},updated_at=now() where source_id=${sources[0].id} and target_id::text=${String(body.targetId)}`,
      rows[0].kind==='item' ? sql`update menu_catalog_items set base_price=${value},updated_at=now() where id=${rows[0].target_id}` : sql`update menu_options set price_delta=${value},updated_at=now() where id=${rows[0].target_id}`,
      sql`update menu_uber_sources set revision=revision+1,last_content_hash='',updated_at=now() where id=${sources[0].id}`
    ]);
    await scheduleUberSourceScans(sources[0].store_id);
    return Response.json({ok:true,price:value,mode:body.mode});
  }
  return Response.json({error:'操作が不正です。'},{status:400});
}
