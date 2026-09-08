import {sql} from './db.ts';
import {validateUberOptionMigration} from './uber-option-migration-state.ts';

export async function recordUberOptionMigration(input:{sourceId:string;storeId:string;brandId:string;platformId:string;revision:number;payload:Record<string,unknown>;state:Record<string,unknown>;commandId?:string;acceptance?:boolean}) {
  const {state,payload}=input;
  const previousRows=await sql`select state from menu_uber_option_migrations where source_id=${input.sourceId} and platform='rocket_now' and migration_key=${String(state.key)}`;
  const previous=previousRows[0]?.state as Record<string,unknown>|undefined;
  const target=validateUberOptionMigration(payload,state,previous);
  const nextPayload=structuredClone(payload),nextTarget=(nextPayload.targets as Array<Record<string,unknown>>).find(row=>row.sourceKey===target.sourceKey)!;
  nextPayload.migrationState={...(nextPayload.migrationState as object??{}),[String(state.key)]:state};
  if(state.phase==='complete') {
    nextTarget.mappings=[...(nextTarget.mappings as Array<Record<string,unknown>>).filter(row=>row.externalId!==state.fromExternalId),
      {externalId:`sub_checkbox_${state.toParentId}_${state.newId}`,externalParentId:state.toParentId,migrated:true}]
      .filter((row,index,rows)=>rows.findIndex(other=>other.externalId===row.externalId)===index);
  }
  const guard=input.acceptance
    ?sql`with locked as materialized(select id from menu_uber_sources where id=${input.sourceId} and store_id=${input.storeId} and brand_id=${input.brandId} and revision=${input.revision} and enabled=false and auto_publish=false and publish_config->'rocket_now'->>'optionMigrationPolicy'='preserve_stock' for update) select 1/count(*)::int from locked`
    :sql`select lock_menu_uber_revision(${input.sourceId},${input.revision})`;
  const statements=[guard,
    sql`with saved as (insert into menu_uber_option_migrations(source_id,platform,migration_key,state) values(${input.sourceId},'rocket_now',${String(state.key)},${JSON.stringify(state)}::jsonb) on conflict(source_id,platform,migration_key) do update set state=excluded.state,updated_at=now() where menu_uber_option_migrations.state=${JSON.stringify(previous??null)}::jsonb returning 1) select 1/count(*)::int from saved`];
  if(state.phase==='complete') {
    statements.push(sql`insert into menu_platform_object_mappings(brand_id,external_platform_id,target_type,target_id,external_id,external_parent_id,external_name) values(${input.brandId},${input.platformId},'option',${String(target.targetId)},${`sub_checkbox_${state.toParentId}_${state.newId}`},${String(state.toParentId)},${String(target.name)}) on conflict(external_platform_id,target_type,external_id) do update set target_id=case when menu_platform_object_mappings.target_id=excluded.target_id then excluded.target_id else null end,external_parent_id=excluded.external_parent_id`);
    // Legacy mappings may contain several comma-separated physical IDs.
    // Remove only the retired occurrence, preserving and normalizing siblings.
    statements.push(sql`with removed as (
      delete from menu_platform_object_mappings where external_platform_id=${input.platformId} and target_type='option' and target_id=${String(target.targetId)}
        and ${String(state.fromExternalId)}=any(regexp_split_to_array(external_id,'\\s*,\\s*')) returning *
    ) insert into menu_platform_object_mappings(brand_id,store_id,external_platform_id,target_type,target_id,external_id,external_parent_id,external_name,last_observed_state,last_verified_at)
      select r.brand_id,r.store_id,r.external_platform_id,r.target_type,r.target_id,token,
        coalesce(substring(token from '^sub_checkbox_([0-9]+)_[0-9]+$'),r.external_parent_id),r.external_name,r.last_observed_state,r.last_verified_at
      from removed r cross join lateral unnest(regexp_split_to_array(r.external_id,'\\s*,\\s*')) as token
      where token<>${String(state.fromExternalId)} and token<>''
      on conflict(external_platform_id,target_type,external_id) do update set target_id=case when menu_platform_object_mappings.target_id=excluded.target_id then excluded.target_id else null end,external_parent_id=excluded.external_parent_id`);
  }
  if(input.commandId&&!input.acceptance)statements.push(sql`update local_bridge_commands set payload=${JSON.stringify(nextPayload)}::jsonb,updated_at=now() where id=${input.commandId} and status='processing'`);
  await sql.transaction(statements);
  return nextPayload;
}
