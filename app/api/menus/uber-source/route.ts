import { requireMasterOsSession } from '../../../../lib/api-auth';
import { sql } from '../../../../lib/db';
import { scheduleUberSourceScans } from '../../../../lib/uber-menu-source-sync';
import { nextMenuCheck, menuSyncIssue, menuSyncIssueContext } from '../../../../lib/menu-sync-status';
import { reconcileUberPublications } from '../../../../lib/uber-menu-publication-reconcile';
import { publishBridgeCommandAvailable } from '../../../../lib/local-bridge-realtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!await requireMasterOsSession()) return Response.json({error:'権限がありません。'},{status:403});
  const brandId = new URL(request.url).searchParams.get('brandId') ?? '';
  const sources = await sql`select id::text,brand_id::text,store_id::text,uber_store_uuid,enabled,auto_publish,revision,last_checked_at,last_error from menu_uber_sources where brand_id::text=${brandId}`;
  const runs = sources.length ? await sql`select r.id::text,r.revision,r.summary,r.created_at,coalesce(c.payload->>'trigger','unknown') as trigger from menu_uber_sync_runs r left join local_bridge_commands c on c.id=r.command_id where r.source_id=${sources[0].id} order by r.created_at desc limit 20` : [];
  const history = sources.length ? await sql`select id::text,platform,status,created_at,updated_at,last_error,attempts,available_at,payload->>'revision' as revision,result->'progress'->>'phase' as phase,result->'progress' as progress,payload->'manualRetryHistory' as retries,
    case when last_error<>'' then (select jsonb_object_agg(target->>'sourceKey',coalesce(target->>'sourceName',target->>'name'))
      from jsonb_array_elements(coalesce(payload->'targets','[]'::jsonb)) target where target->>'sourceKey' is not null) else '{}'::jsonb end as "targetNames"
    from local_bridge_commands where store_id=${sources[0].store_id} and payload->>'sourceId'=${sources[0].id}::text
      and ((platform='uber_eats' and command_type='capture_menu_snapshot' and payload->'authoritativeSource'='true'::jsonb)
        or (platform in ('rocket_now','demae_can') and command_type='publish_menu_changes' and payload->'authoritativePublication'='true'::jsonb))
    order by created_at desc,id desc limit 80` : [];
  const jobHistory=history.map(({targetNames,...job})=>Object.assign(job,menuSyncIssueContext(String(job.last_error??''),(targetNames??{}) as Record<string,string>)));
  const jobs=jobHistory.filter((row,index)=>jobHistory.findIndex(other=>other.platform===row.platform)===index);
  // Resolve only the current target name, never return the full command payload.
  for(const job of jobs.filter(row=>row.status==='processing')) {
    const progress=(job.progress??{}) as Record<string,unknown>;
    if(!progress.targetName) {
      const names=await sql`select target->>'name' as name from local_bridge_commands c cross join lateral jsonb_array_elements(coalesce(c.payload->'targets','[]'::jsonb)) target where c.id::text=${job.id} and c.store_id=${sources[0].store_id} and target->>'sourceKey'=coalesce(c.result->'progress'->>'sourceKey',c.result->'progress'->'authorityOperation'->>'sourceKey') limit 1`;
      job.progress={...progress,targetName:names[0]?.name??''};
    }
  }
  // Inventory/audit commands also carry sourceId. Their successful read or
  // stock change is not a full menu publication, nor an authoritative capture.
  const successes=sources.length?await sql`select distinct on(platform) platform,payload->>'revision' as revision,completed_at
    from local_bridge_commands where store_id=${sources[0].store_id} and payload->>'sourceId'=${sources[0].id}::text
      and status='succeeded' and completed_at is not null
      and ((platform='uber_eats' and command_type='capture_menu_snapshot' and payload->'authoritativeSource'='true'::jsonb)
        or (platform in ('rocket_now','demae_can') and command_type='publish_menu_changes' and payload->'authoritativePublication'='true'::jsonb))
    order by platform,completed_at desc,created_at desc,id desc`:[];
  const devices=sources.length?await sql`select platform,max(last_seen_at) as last_seen_at from local_bridge_devices where store_id=${sources[0].store_id} and is_enabled=true group by platform`:[];
  const prices = sources.length ? await sql`select o.target_id::text as id,o.kind,o.price_mode as mode,o.last_uber_price::float as "uberPrice",coalesce(i.name,p.name) as name,case when o.kind='item' then i.base_price else p.price_delta end::float as price from menu_uber_objects o left join menu_catalog_items i on o.kind='item' and i.id=o.target_id left join menu_options p on o.kind='option' and p.id=o.target_id where o.source_id=${sources[0].id} and o.kind in ('item','option') and not o.archived order by o.kind,name` : [];
  return Response.json({source:sources[0]??null,runs,jobs,jobHistory,successes,devices,prices,nextCheck:nextMenuCheck()},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request: Request) {
  if (!await requireMasterOsSession()) return Response.json({error:'権限がありません。'},{status:403});
  const value:unknown=await request.json().catch(()=>({}));
  const body=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const sources = await sql`select id::text,store_id::text,revision from menu_uber_sources where brand_id::text=${String(body.brandId??'')} and enabled=true`;
  if (!sources.length) return Response.json({error:'Uber メニュー連携はまだ有効になっていません。'},{status:409});
  if(body.action==='scan') return Response.json(await scheduleUberSourceScans(sources[0].store_id));
  if(body.action==='retry') {
    const source=sources[0],id=typeof body.jobId==='string'?body.jobId.trim():'';
    const language=typeof body.language==='string'?body.language:'ja';
    const humanIssue=(detail:string)=>{
      const issue=menuSyncIssue(detail,language);
      return {reason:`${issue?.title??''} ${issue?.action??''}`.trim()
        .replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu,' ').slice(0,800),retry:issue?.retry===true};
    };
    if(!id||id.length>80) {
      const blocked=humanIssue('uber_publication_reconcile_conflict');
      return Response.json({error:blocked.reason,queued:0,blocked:[blocked],jobs:[]},{status:409});
    }
    // AI preparation is permitted only for the exact latest failed command.
    // The shared reconciler rechecks these guards atomically before requeueing.
    // Do not fetch a payload into this API response or infer native rejection
    // details from an older AI-only error string.
    const failures=await sql`select c.platform,c.last_error,
      coalesce(c.result ? 'nameAdaptationDiagnostic',false) as "hasNameDiagnostic"
      from local_bridge_commands c join menu_uber_sources s on s.id::text=c.payload->>'sourceId'
      where c.id::text=${id} and c.store_id::text=${source.store_id} and s.store_id=c.store_id
        and s.id::text=${source.id} and s.enabled=true and s.auto_publish=true
        and s.revision=${Number(source.revision)} and c.payload->>'revision'=s.revision::text
        and c.status='failed' and c.command_type='publish_menu_changes' and c.payload->>'authoritativePublication'='true'
        and c.platform in ('rocket_now','demae_can')
        and coalesce(c.payload->'pendingRemovals','[]'::jsonb)='[]'::jsonb
        and not exists(select 1 from local_bridge_commands newer where newer.store_id=c.store_id
          and newer.payload->>'sourceId'=c.payload->>'sourceId' and newer.id<>c.id
          and ((newer.platform=c.platform and newer.command_type='publish_menu_changes' and (newer.created_at>c.created_at
            or (newer.created_at=c.created_at and newer.id>c.id))) or newer.status in ('pending','processing')))`;
    const failure=failures[0];
    const nativeFailure=failure&&/^uber_authority_(?:content_failed|preflight_blocked):/.test(String(failure.last_error??''));
    if(failure&&(failure.hasNameDiagnostic===true||nativeFailure)) {
      const {adaptRejectedUberMenuName,MenuNameAdaptationConflict}=await import('../../../../lib/uber-menu-name-adaptation-store');
      try {await adaptRejectedUberMenuName({commandId:id,storeId:source.store_id,platform:String(failure.platform),error:String(failure.last_error),status:'failed'});}
      catch(error) {
        const message=error instanceof Error?error.message:'';
        const detail=error instanceof MenuNameAdaptationConflict?'uber_publication_reconcile_conflict'
          :/^menu_name_ai_(?:unavailable|timeout|invalid|unsafe|exhausted|recovery_unavailable)(?::|$)/.test(message)?message:'menu_name_ai_unavailable';
        const blocked={platform:String(failure.platform),...humanIssue(detail)};
        return Response.json({error:blocked.reason,queued:0,blocked:[blocked],jobs:[]},{status:409});
      }
    }
    let reconciled;
    try {reconciled=await reconcileUberPublications({sourceId:String(source.id),storeId:String(source.store_id),
      revision:Number(source.revision),mode:'manual',jobId:id});}
    catch {
      const blocked=humanIssue('uber_publication_reconcile_conflict');
      return Response.json({error:blocked.reason,queued:0,blocked:[blocked],jobs:[]},{status:409});
    }
    const blocked=reconciled.blocked.slice(0,2).map(row=>({
      ...(['rocket_now','demae_can'].includes(String(row.platform))?{platform:String(row.platform)}:{}),...humanIssue(row.code)
    }));
    const jobs=reconciled.jobs.slice(0,2).map(row=>({id:String(row.id).slice(0,80),platform:String(row.platform)}));
    if(!reconciled.queued&&!blocked.length)blocked.push(humanIssue('uber_publication_reconcile_conflict'));
    if(reconciled.queued)await publishBridgeCommandAvailable(String(source.store_id)).catch(()=>undefined);
    return Response.json({queued:reconciled.queued,blocked,jobs,
      ...(!reconciled.queued?{error:blocked[0].reason}:{})},{status:reconciled.queued?200:409});
  }
  if(body.action==='price') return Response.json({error:'価格は Uber で変更し、最新メニューを読み取ってください。'},{status:409});
  return Response.json({error:'操作が不正です。'},{status:400});
}
