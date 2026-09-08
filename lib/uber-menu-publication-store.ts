import {sql} from './db';
import {verifyUberPublication} from './uber-menu-publication';

export async function recordUberPublicationProgress(input:{commandId:string;storeId:string;platform:string;progress:Record<string,unknown>;result?:Record<string,unknown>}) {
  const rows=await sql`select c.payload,s.id::text as "sourceId",s.brand_id::text as "brandId",s.revision,p.id::text as "platformId" from local_bridge_commands c join menu_uber_sources s on s.id::text=c.payload->>'sourceId' join menu_external_platforms p on p.brand_id=s.brand_id and p.store_id is null and p.platform_key=c.platform where c.id::text=${input.commandId} and c.store_id::text=${input.storeId} and s.store_id=c.store_id and c.platform=${input.platform} and c.status='processing' and s.enabled=true and s.auto_publish=true and c.payload->>'authoritativePublication'='true'`;
  const scope=rows[0];
  if(!scope)throw new Error('uber_publication_scope_invalid');
  const payload=scope.payload as Record<string,unknown>;
  if(Number(payload.revision)!==Number(scope.revision))throw new Error('uber_publication_superseded');
  if(input.result) return verifyUberPublication(payload,input.result);
  const operation=input.progress.authorityOperation as Record<string,unknown>|undefined;
  if(!operation)return;
  const targets=payload.targets as Array<Record<string,unknown>>;
  const target=targets.find(row=>row.sourceKey===operation.sourceKey);
  if(!target || !['creating','identified','rejected','received'].includes(String(operation.status)))throw new Error('uber_publication_operation_invalid');
  if(target.quarantined===true)throw Error('uber_publication_object_quarantined');
  const state=(payload.authorityState??{}) as Record<string,Record<string,unknown>>;
  const previous=state[String(target.sourceKey)];
  if(operation.status==='creating' && previous && previous.status!=='rejected')throw new Error('uber_publication_creation_already_attempted');
  if(operation.status==='rejected' && previous?.status!=='creating')throw new Error('uber_publication_rejection_without_attempt');
  if(operation.status==='received' && previous?.status!=='creating')throw new Error('uber_publication_receipt_without_attempt');
  const externalId=String(operation.externalId??'');
  const externalParentId=String(operation.externalParentId??'');
  if(['identified','received'].includes(String(operation.status)) && (!externalId || externalId.length>240 || externalParentId.length>240))throw new Error('uber_publication_mapping_invalid');
  if(previous?.externalId && previous.externalId!==externalId)throw new Error('uber_publication_mapping_changed');
  state[String(target.sourceKey)]={status:operation.status==='received'?'creating':operation.status,externalId,externalParentId};
  payload.authorityState=state;
  const statements=[sql`select lock_menu_uber_revision(${scope.sourceId},${scope.revision})`];
  // This guard survives command retries AND later source revisions. A marker
  // alone is insufficient when an earlier create may still be in flight.
  if(operation.status==='creating')statements.push(sql`insert into menu_uber_creation_attempts(source_id,platform,source_key,status,command_id) values(${scope.sourceId},${input.platform},${String(target.sourceKey)},'creating',${input.commandId}) on conflict(source_id,platform,source_key) do update set status=case when menu_uber_creation_attempts.status='rejected' then 'creating' else null end,command_id=excluded.command_id,updated_at=now()`);
  if(operation.status==='rejected')statements.push(sql`update menu_uber_creation_attempts set status='rejected',updated_at=now() where source_id=${scope.sourceId} and platform=${input.platform} and source_key=${String(target.sourceKey)} and status='creating' and command_id=${input.commandId} and external_id=''`);
  if(operation.status==='received')statements.push(sql`update menu_uber_creation_attempts set external_id=case when external_id in ('',${externalId}) then ${externalId} else null end,external_parent_id=${externalParentId},updated_at=now() where source_id=${scope.sourceId} and platform=${input.platform} and source_key=${String(target.sourceKey)} and status='creating' and command_id=${input.commandId}`);
  if(operation.status==='identified') {
    statements.push(sql`insert into menu_uber_creation_attempts(source_id,platform,source_key,status,external_id,external_parent_id,command_id) values(${scope.sourceId},${input.platform},${String(target.sourceKey)},'identified',${externalId},${externalParentId},${input.commandId}) on conflict(source_id,platform,source_key) do update set status='identified',external_id=case when menu_uber_creation_attempts.external_id in ('',excluded.external_id) then excluded.external_id else null end,external_parent_id=excluded.external_parent_id,updated_at=now()`);
    const mappings=(target.mappings??[]) as Array<Record<string,unknown>>;
    if(!mappings.some(row=>row.externalId===externalId))mappings.push({externalId,externalParentId,created:true});
    target.mappings=mappings;
    // No upsert/reassignment: conflicting ownership must fail, not silently
    // attach a remote object to a different source target.
    statements.push(sql`insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_parent_id,external_name) values(${scope.brandId},${scope.platformId},${String(target.kind)},${String(target.targetId)},${externalId},${externalParentId},${String(target.name)}) on conflict(external_platform_id,target_type,external_id) do update set target_id=case when menu_platform_object_mappings.target_id=excluded.target_id then excluded.target_id else null end,external_parent_id=excluded.external_parent_id`);
    if(['item','option'].includes(String(target.kind)))statements.push(sql`insert into menu_platform_availability_settings(brand_id,store_id,target_kind,target_id,platform,availability) values(${scope.brandId},${input.storeId},${String(target.kind)},${String(target.targetId)},${input.platform},'unavailable') on conflict(store_id,target_kind,target_id,platform) do update set availability='unavailable',updated_at=now()`);
  }
  statements.push(sql`update local_bridge_commands set payload=${JSON.stringify(payload)}::jsonb,updated_at=now() where id::text=${input.commandId} and status='processing'`);
  await sql.transaction(statements);
}
