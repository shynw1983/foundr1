import {createHash} from 'node:crypto';

export function validateUberOptionMigration(payload:Record<string,unknown>,state:Record<string,unknown>,previous?:Record<string,unknown>) {
  if(payload.platformKey!=='rocket_now'||payload.optionMigrationPolicy!=='preserve_stock')throw Error('uber_migration_policy_required');
  const targets=payload.targets as Array<Record<string,unknown>>;
  const target=targets.find(row=>row.sourceKey===state.sourceKey&&row.targetId===state.targetId&&row.kind==='option'&&!row.archived&&!row.quarantined);
  const parent=targets.find(row=>row.targetId===target?.parentId&&row.kind==='option_group'&&!row.archived&&!row.quarantined);
  if(!target||!parent||!(parent.mappings as Array<Record<string,unknown>>).some(row=>String(row.externalId)===state.toParentId))throw Error('uber_migration_target_invalid');
  for(const key of ['fromId','fromParentId','toParentId'])if(!/^[1-9]\d*$/.test(String(state[key])))throw Error('uber_migration_identity_invalid');
  if(state.fromExternalId!==state.fromId&&state.fromExternalId!==`sub_checkbox_${state.fromParentId}_${state.fromId}`)throw Error('uber_migration_predecessor_identity_invalid');
  const hash=createHash('sha256').update([payload.sourceId,state.sourceKey,state.fromId,state.toParentId].join(':')).digest('hex');
  if(state.key!==hash||state.marker!==`FS${hash.slice(0,14)}`||state.name!==target.name||state.price!==target.price
    ||!['ON_SALE','NOT_EXPOSE'].includes(String(state.displayStatus)))throw Error('uber_migration_intent_invalid');
  const phases=['reserved','received','prepared','complete'];
  const index=phases.indexOf(String(state.phase));
  if(index<0||index>0&&!/^[1-9]\d*$/.test(String(state.newId))||state.newId===state.fromId)throw Error('uber_migration_phase_invalid');
  if(previous) {
    for(const key of ['key','sourceKey','targetId','fromExternalId','fromId','fromParentId','toParentId','marker','name','price','displayStatus'])
      if(previous[key]!==state[key])throw Error('uber_migration_intent_changed');
    const prior=phases.indexOf(String(previous.phase));
    if(index<prior||index>prior+1||previous.newId&&previous.newId!==state.newId)throw Error('uber_migration_transition_invalid');
  }else {
    if(index!==0||state.newId!=='')throw Error('uber_migration_reservation_required');
    if(!(target.mappings as Array<Record<string,unknown>>).some(row=>row.externalId===state.fromExternalId))throw Error('uber_migration_unowned_predecessor');
  }
  return target;
}
