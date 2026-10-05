import {sql} from './db.ts';
import {findRejectedMenuNameTarget, requestMenuNameAdaptation} from './menu-name-adaptation.ts';
import type {UberMenuNameAdaptation} from './uber-menu-publication.ts';

/** Only an explicitly rejected name can be rewritten. Keep the same command,
 * physical identities and creation receipts; ambiguous writes are not replayed. */
export class MenuNameAdaptationConflict extends Error {
  constructor(){super('menu_name_adaptation_command_changed');}
}

export async function adaptRejectedUberMenuName(input:{commandId:string;storeId:string;platform:string;error:string;status:'processing'|'failed';
  claim?:{deviceId:string;claimedAt:string};result?:Record<string,unknown>}) {
  if(input.status==='processing'&&!input.claim?.claimedAt)throw new MenuNameAdaptationConflict();
  const rows=await sql`select c.payload,c.attempts,s.id::text as "sourceId",s.revision,s.publish_config as config
    from local_bridge_commands c join menu_uber_sources s on s.id::text=c.payload->>'sourceId'
    where c.id::text=${input.commandId} and c.store_id::text=${input.storeId} and s.store_id=c.store_id
      and c.platform=${input.platform} and c.status=${input.status} and s.enabled=true and s.auto_publish=true
      and (${input.status==='failed'} or (c.claimed_at=${input.claim?.claimedAt??null}::timestamptz
        and (${input.claim?.deviceId??''}='' or c.claimed_by_device_id::text=${input.claim?.deviceId??''})))
      and c.payload->>'authoritativePublication'='true' and c.payload->>'revision'=s.revision::text
      and not exists(select 1 from local_bridge_commands newer where newer.store_id=c.store_id
        and newer.payload->>'sourceId'=c.payload->>'sourceId' and newer.id<>c.id
        and ((newer.platform=c.platform and newer.created_at>c.created_at)
          or (newer.status in ('pending','processing') and (${input.status==='failed'}
            or newer.platform=c.platform or newer.payload->>'authoritativeSource'='true'))))`;
  if(!rows.length) {
    if(input.status==='processing')throw new MenuNameAdaptationConflict();
    return false;
  }
  const scope=rows[0],originalPayload=scope.payload as Record<string,unknown>;
  const rejected=findRejectedMenuNameTarget(originalPayload,input.error);
  if(!rejected)return false;
  // A late name rejection must not claim a retry the queue cannot execute.
  if(input.status==='processing'&&Number(scope.attempts)>=3)return false;
  const payload=structuredClone(originalPayload);
  const target=(payload.targets as Array<Record<string,unknown>>).find(row=>row.sourceKey===rejected.sourceKey)!;
  // Never repair an unidentified create or alter a migration's saved intent.
  if(!Array.isArray(target.mappings)||!target.mappings.length
    ||Object.values((payload.migrationState??{}) as Record<string,Record<string,unknown>>)
      .some(state=>state.sourceKey===rejected.sourceKey&&state.phase!=='complete'))return false;
  const context=JSON.stringify({name:target.sourceName??rejected.originalName??target.name,platform:input.platform,sourceKey:rejected.sourceKey});
  const sourceName=String(target.sourceName??rejected.originalName??target.name);
  const inputName=String(target.nameProjection??target.name);
  const config=scope.config as Record<string,{nameAdaptations?:Record<string,UberMenuNameAdaptation>}>;
  const saved=config?.[input.platform]?.nameAdaptations?.[rejected.sourceKey];
  const previous=saved?.sourceKey===rejected.sourceKey&&saved.sourceName===sourceName
    &&saved.inputName===inputName&&saved.targetId===rejected.targetId&&Array.isArray(saved.attemptedNames)
    ?saved.attemptedNames:[];
  if(previous.length>=2)throw Error(`menu_name_ai_exhausted:${context}`);
  let candidate;
  try {candidate=await requestMenuNameAdaptation({...rejected,inputName,originalName:sourceName,
    previousCandidates:[...new Set([...previous,String(target.name)])]});}
  catch(error) {
    const code=error instanceof Error&&/^menu_name_ai_(unavailable|timeout|invalid|unsafe)$/.test(error.message)
      ?error.message:'menu_name_ai_invalid';
    throw Error(`${code}:${context}`);
  }
  const adaptation:UberMenuNameAdaptation={...candidate,sourceName,verified:false,
    attemptedNames:[...previous,candidate.name],rejectionReason:input.error,createdAt:new Date().toISOString()};
  target.nameProjection=inputName;
  target.sourceName=sourceName;
  target.name=candidate.name;
  target.nameAdaptation=adaptation;
  const prepared={name:sourceName,adaptedName:candidate.name,sourceKey:rejected.sourceKey,platform:input.platform};
  try {await sql.transaction([
    sql`select lock_menu_uber_revision(${scope.sourceId},${scope.revision})`,
    sql`select 1/count(*)::int from (select c.id from local_bridge_commands c join menu_uber_sources s on s.id::text=c.payload->>'sourceId'
      where c.id::text=${input.commandId} and c.store_id::text=${input.storeId} and c.platform=${input.platform}
        and c.status=${input.status} and c.payload=${JSON.stringify(originalPayload)}::jsonb
        and s.enabled=true and s.auto_publish=true and c.payload->>'revision'=s.revision::text
        and (${input.status==='failed'} or (c.attempts<3 and c.claimed_at=${input.claim?.claimedAt??null}::timestamptz
          and (${input.claim?.deviceId??''}='' or c.claimed_by_device_id::text=${input.claim?.deviceId??''})))
        and not exists(select 1 from local_bridge_commands newer where newer.store_id=c.store_id
          and newer.payload->>'sourceId'=c.payload->>'sourceId' and newer.id<>c.id
          and ((newer.platform=c.platform and newer.created_at>c.created_at)
            or (newer.status in ('pending','processing') and (${input.status==='failed'}
              or newer.platform=c.platform or newer.payload->>'authoritativeSource'='true')))) for update of c) locked`,
    sql`update menu_uber_sources set publish_config=jsonb_set(publish_config,array[${input.platform}],
      coalesce(publish_config->${input.platform},'{}'::jsonb)||jsonb_build_object('nameAdaptations',
        coalesce(publish_config->${input.platform}->'nameAdaptations','{}'::jsonb)
          ||jsonb_build_object(${rejected.sourceKey}::text,${JSON.stringify(adaptation)}::jsonb)),true),updated_at=now()
      where id=${scope.sourceId}`,
    sql`update local_bridge_commands set payload=${JSON.stringify(payload)}::jsonb,
      status=case when ${input.status==='processing'} then 'pending' else status end,
      available_at=case when ${input.status==='processing'} then now()+least(120,15*power(2,greatest(0,attempts-1)))*interval '1 second' else available_at end,
      result=case when ${input.status==='processing'} then result||${JSON.stringify({...input.result,nameAdaptation:prepared})}::jsonb else result end,
      last_error=case when ${input.status==='processing'} then ${`menu_name_ai_retry_prepared:${JSON.stringify(prepared)}`} else last_error end,
      claimed_by_device_id=case when ${input.status==='processing'} then null else claimed_by_device_id end,
      claimed_at=case when ${input.status==='processing'} then null else claimed_at end,
      claim_expires_at=case when ${input.status==='processing'} then null else claim_expires_at end,
      completed_at=case when ${input.status==='processing'} then null else completed_at end,updated_at=now()
      where id::text=${input.commandId} and status=${input.status}`
  ]);} catch(error) {
    if(error&&typeof error==='object'&&['22012','P0001'].includes(String((error as {code?:string}).code)))throw new MenuNameAdaptationConflict();
    throw error;
  }
  return prepared;
}

/** A generated name is reusable across runs only after native observations
 * have passed the ordinary full publication verifier. */
export async function confirmUberMenuNameAdaptations(input:{sourceId:string;revision:number;platform:string;payload:Record<string,unknown>}) {
  const adapted=(input.payload.targets as Array<Record<string,unknown>>)
    .filter(target=>target.nameAdaptation&&target.name===(target.nameAdaptation as UberMenuNameAdaptation).name);
  if(!adapted.length)return;
  await sql.transaction([
    sql`select lock_menu_uber_revision(${input.sourceId},${input.revision})`,
    ...adapted.map(target=>{
      const candidate=target.nameAdaptation as UberMenuNameAdaptation;
      return sql`update menu_uber_sources set publish_config=jsonb_set(publish_config,
        array[${input.platform},'nameAdaptations',${String(target.sourceKey)},'verified'],'true'::jsonb),updated_at=now()
        where id=${input.sourceId}
          and publish_config->${input.platform}->'nameAdaptations'->${String(target.sourceKey)}->>'name'=${candidate.name}
          and publish_config->${input.platform}->'nameAdaptations'->${String(target.sourceKey)}->>'inputName'=${candidate.inputName}
          and publish_config->${input.platform}->'nameAdaptations'->${String(target.sourceKey)}->>'sourceName'=${candidate.sourceName}
          and publish_config->${input.platform}->'nameAdaptations'->${String(target.sourceKey)}->>'targetId'=${candidate.targetId}`;
    })
  ]);
}
