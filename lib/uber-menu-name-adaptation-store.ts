import {sql} from './db.ts';
import {findRejectedMenuNameTarget, requestMenuNameAdaptation} from './menu-name-adaptation.ts';
import type {UberMenuNameAdaptation} from './uber-menu-publication.ts';

const AI_FAILURE_CODE=/^menu_name_ai_(unavailable|timeout|invalid|unsafe|exhausted)$/;
const AI_STAGES=new Set(['input_validation','configuration','http','response_json','response_status','output_incomplete',
  'output_refusal','output_json','output_schema','candidate_name','candidate_unchanged','candidate_repeated',
  'candidate_quantities','candidate_identity','candidate_unsafe','request','deadline','completed','candidate_limit']);
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown,limit:number)=>typeof value==='string'?value.replace(/\bBearer\s+[^\s,;]+/gi,'Bearer [redacted]')
  .replace(/\bsk-[a-z0-9_-]+/gi,'[redacted]').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,limit):'';

/** Only bounded operational metadata is retained; never provider response bodies,
 * tokens, headers or reasoning. These records are written only by this service. */
function safeAiDiagnostic(value:unknown) {
  const metadata=(value:unknown)=>{
    const row=record(value),out:Record<string,unknown>={stage:AI_STAGES.has(String(row.stage))?String(row.stage):'request'};
    for(const [key,limit] of [['model',200],['responseStatus',60],['incompleteReason',80],['candidateName',512],['candidateReason',512]] as const)
      if(text(row[key],limit))out[key]=text(row[key],limit);
    if(Number.isInteger(row.httpStatus)&&Number(row.httpStatus)>=100&&Number(row.httpStatus)<=599)out.httpStatus=row.httpStatus;
    const usage=record(row.usage),safeUsage:Record<string,number>={};
    for(const key of ['inputTokens','outputTokens','totalTokens','reasoningTokens'])
      if(Number.isInteger(usage[key])&&Number(usage[key])>=0&&Number(usage[key])<=1e9)safeUsage[key]=Number(usage[key]);
    if(Object.keys(safeUsage).length)out.usage=safeUsage;
    return out;
  };
  const row=record(value);
  return {...metadata(row),stage:AI_STAGES.has(String(row.stage))?String(row.stage):'request',
    attempts:Array.isArray(row.attempts)?row.attempts.slice(0,2).map((attempt,index)=>({...metadata(attempt),attempt:index+1})):[]};
}

type SavedNameDiagnostic={
  version:1;commandId:string;sourceId:string;revision:number;platform:string;sourceKey:string;targetId:string;
  sourceName:string;inputName:string;rejectedName:string;platformRejection:string;errorCode:string;
  ai:ReturnType<typeof safeAiDiagnostic>;createdAt:string;
};

export class MenuNameAdaptationFailure extends Error {
  constructor(public diagnostic:SavedNameDiagnostic) {
    super(`${diagnostic.errorCode}:${JSON.stringify({name:diagnostic.sourceName,platform:diagnostic.platform,
      sourceKey:diagnostic.sourceKey,stage:diagnostic.ai.stage})}`);
  }
}

/** Only an explicitly rejected name can be rewritten. Keep the same command,
 * physical identities and creation receipts; ambiguous writes are not replayed. */
export class MenuNameAdaptationConflict extends Error {
  constructor(){super('menu_name_adaptation_command_changed');}
}
export class MenuNameAdaptationRecoveryUnavailable extends Error {
  constructor(){super('menu_name_ai_recovery_unavailable');}
}

export async function adaptRejectedUberMenuName(input:{commandId:string;storeId:string;platform:string;error:string;status:'processing'|'failed';
  claim?:{deviceId:string;claimedAt:string};result?:Record<string,unknown>}) {
  if(input.status==='processing'&&!input.claim?.claimedAt)throw new MenuNameAdaptationConflict();
  const rows=await sql`select c.payload,c.result,c.last_error,c.attempts,s.id::text as "sourceId",s.revision,s.publish_config as config
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
  let platformRejection=input.status==='failed'?String(scope.last_error??''):input.error;
  let matched=findRejectedMenuNameTarget(originalPayload,platformRejection);
  // AI failures replace last_error for readable status, but not the native
  // rejection. Resolve that saved rejection against the exact current payload;
  // IDs or names supplied in last_error JSON never determine a write target.
  if(!matched&&input.status==='failed'&&AI_FAILURE_CODE.test(platformRejection.split(':',1)[0])) {
    const result=record(scope.result);
    if(!Object.prototype.hasOwnProperty.call(result,'nameAdaptationDiagnostic'))throw new MenuNameAdaptationRecoveryUnavailable();
    const saved=record(result.nameAdaptationDiagnostic);
    const recovered=findRejectedMenuNameTarget(originalPayload,saved.platformRejection);
    const target=Array.isArray(originalPayload.targets)?originalPayload.targets.map(record)
      .find(row=>row.sourceKey===recovered?.sourceKey&&row.targetId===recovered?.targetId):undefined;
    if(saved.version!==1||saved.commandId!==input.commandId||saved.sourceId!==scope.sourceId
      ||saved.revision!==Number(scope.revision)||saved.platform!==input.platform
      ||!AI_FAILURE_CODE.test(String(saved.errorCode))||!recovered||!target
      ||saved.sourceKey!==recovered.sourceKey||saved.targetId!==recovered.targetId
      ||saved.rejectedName!==target.name||saved.sourceName!==String(target.sourceName??recovered.originalName??target.name)
      ||saved.inputName!==String(target.nameProjection??target.name))throw new MenuNameAdaptationConflict();
    platformRejection=String(saved.platformRejection);
    matched=recovered;
  }
  if(!matched)return false;
  const rejected=matched;
  if(rejected.platform!==input.platform)throw new MenuNameAdaptationConflict();
  // A late name rejection must not claim a retry the queue cannot execute.
  if(input.status==='processing'&&Number(scope.attempts)>=3)return false;
  const payload=structuredClone(originalPayload);
  const target=(payload.targets as Array<Record<string,unknown>>).find(row=>row.sourceKey===rejected.sourceKey)!;
  // Never repair an unidentified create or alter a migration's saved intent.
  if(!Array.isArray(target.mappings)||!target.mappings.length
    ||Object.values((payload.migrationState??{}) as Record<string,Record<string,unknown>>)
      .some(state=>state.sourceKey===rejected.sourceKey&&state.phase!=='complete'))return false;
  const sourceName=String(target.sourceName??rejected.originalName??target.name);
  const inputName=String(target.nameProjection??target.name);
  const config=scope.config as Record<string,{nameAdaptations?:Record<string,UberMenuNameAdaptation>}>;
  const saved=config?.[input.platform]?.nameAdaptations?.[rejected.sourceKey];
  const previous=saved?.sourceKey===rejected.sourceKey&&saved.sourceName===sourceName
    &&saved.inputName===inputName&&saved.targetId===rejected.targetId&&Array.isArray(saved.attemptedNames)
    ?saved.attemptedNames:[];
  // Both successful preparation and failed AI generation use the same lease,
  // payload and revision compare-and-swap. A late result cannot overwrite a new
  // source read, reclaimed command, receipt or disabled integration.
  const commandGuard=()=>sql`select 1/count(*)::int from (select c.id from local_bridge_commands c join menu_uber_sources s on s.id::text=c.payload->>'sourceId'
    where c.id::text=${input.commandId} and c.store_id::text=${input.storeId} and c.platform=${input.platform}
      and c.status=${input.status} and c.payload=${JSON.stringify(originalPayload)}::jsonb and s.store_id=c.store_id
      and s.enabled=true and s.auto_publish=true and c.payload->>'revision'=s.revision::text
      and (${input.status==='failed'} or (c.attempts<3 and c.claimed_at=${input.claim?.claimedAt??null}::timestamptz
        and (${input.claim?.deviceId??''}='' or c.claimed_by_device_id::text=${input.claim?.deviceId??''})))
      and not exists(select 1 from local_bridge_commands newer where newer.store_id=c.store_id
        and newer.payload->>'sourceId'=c.payload->>'sourceId' and newer.id<>c.id
        and ((newer.platform=c.platform and newer.created_at>c.created_at)
          or (newer.status in ('pending','processing') and (${input.status==='failed'}
            or newer.platform=c.platform or newer.payload->>'authoritativeSource'='true')))) for update of c) locked`;
  const transaction=async(statements:Array<ReturnType<typeof sql>>)=>{
    try {await sql.transaction([sql`select lock_menu_uber_revision(${scope.sourceId},${scope.revision})`,commandGuard(),...statements]);}
    catch(error) {
      if(error&&typeof error==='object'&&['22012','P0001'].includes(String((error as {code?:string}).code)))throw new MenuNameAdaptationConflict();
      throw error;
    }
  };
  const fail=async(code:string,metadata:unknown):Promise<never>=>{
    const diagnostic:SavedNameDiagnostic={version:1,commandId:input.commandId,sourceId:String(scope.sourceId),revision:Number(scope.revision),
      platform:input.platform,sourceKey:rejected.sourceKey,targetId:rejected.targetId,sourceName,inputName,
      rejectedName:String(target.name),platformRejection:platformRejection.slice(0,4000),errorCode:code,
      ai:safeAiDiagnostic(metadata),createdAt:new Date().toISOString()};
    const failure=new MenuNameAdaptationFailure(diagnostic);
    // Keep receipts and previously recorded progress; the final ACK also
    // preserves this server-only field instead of replacing it with Bridge JSON.
    await transaction([sql`update local_bridge_commands set
      result=coalesce(result,'{}'::jsonb)||${JSON.stringify({nameAdaptationDiagnostic:diagnostic})}::jsonb,
      last_error=${failure.message},updated_at=now() where id::text=${input.commandId} and status=${input.status}`]);
    throw failure;
  };
  if(previous.length>=2)return fail('menu_name_ai_exhausted',{stage:'candidate_limit',attempts:[]});
  let candidate;
  try {candidate=await requestMenuNameAdaptation({...rejected,inputName,originalName:sourceName,
    previousCandidates:[...new Set([...previous,String(target.name)])]});}
  catch(error) {
    const failure=error as {code?:unknown;message?:unknown;diagnostic?:unknown};
    const reported=String(failure?.code??failure?.message??'');
    return fail(AI_FAILURE_CODE.test(reported)?reported:'menu_name_ai_invalid',failure?.diagnostic);
  }
  if(candidate.sourceKey!==rejected.sourceKey||candidate.targetId!==rejected.targetId||candidate.inputName!==inputName)
    return fail('menu_name_ai_invalid',{stage:'candidate_identity'});
  const adaptation:UberMenuNameAdaptation={...candidate,sourceName,verified:false,
    attemptedNames:[...previous,candidate.name],rejectionReason:platformRejection,createdAt:new Date().toISOString()};
  target.nameProjection=inputName;
  target.sourceName=sourceName;
  target.name=candidate.name;
  target.nameAdaptation=adaptation;
  const prepared={name:sourceName,adaptedName:candidate.name,sourceKey:rejected.sourceKey,platform:input.platform};
  const preparedCode=input.status==='processing'?'menu_name_ai_retry_prepared':'menu_name_ai_candidate_prepared';
  const bridgeResult={...input.result};
  delete bridgeResult.nameAdaptationDiagnostic;
  delete bridgeResult.nameAdaptation;
  await transaction([
    sql`update menu_uber_sources set publish_config=jsonb_set(publish_config,array[${input.platform}],
      coalesce(publish_config->${input.platform},'{}'::jsonb)||jsonb_build_object('nameAdaptations',
        coalesce(publish_config->${input.platform}->'nameAdaptations','{}'::jsonb)
          ||jsonb_build_object(${rejected.sourceKey}::text,${JSON.stringify(adaptation)}::jsonb)),true),updated_at=now()
      where id=${scope.sourceId}`,
    sql`update local_bridge_commands set payload=${JSON.stringify(payload)}::jsonb,
      status=case when ${input.status==='processing'} then 'pending' else status end,
      available_at=case when ${input.status==='processing'} then now()+least(120,15*power(2,greatest(0,attempts-1)))*interval '1 second' else available_at end,
      result=coalesce(result,'{}'::jsonb)||${JSON.stringify({...bridgeResult,nameAdaptation:prepared})}::jsonb,
      last_error=${`${preparedCode}:${JSON.stringify(prepared)}`},
      claimed_by_device_id=case when ${input.status==='processing'} then null else claimed_by_device_id end,
      claimed_at=case when ${input.status==='processing'} then null else claimed_at end,
      claim_expires_at=case when ${input.status==='processing'} then null else claim_expires_at end,
      completed_at=case when ${input.status==='processing'} then null else completed_at end,updated_at=now()
      where id::text=${input.commandId} and status=${input.status}`
  ]);
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
