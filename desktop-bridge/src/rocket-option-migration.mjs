import {createHash} from 'node:crypto';

export function rocketMigrationIdentity(sourceId,sourceKey,fromId,toParentId) {
  const key=createHash('sha256').update([sourceId,sourceKey,fromId,toParentId].join(':')).digest('hex');
  return {key,marker:`FS${key.slice(0,14)}`};
}

// A replacement is not a new product. Its original stock is explicitly
// approved and journaled; ordinary creations still remain permanently hidden.
export async function migrateRocketOption({client,sourceId,target,fromId,toParentId,state,save}) {
  const identity=rocketMigrationIdentity(sourceId,target.sourceKey,fromId,toParentId);
  const read=async()=>{
    const catalog=await client.catalog();
    const entries=catalog.groups.flatMap(group=>(group.optionItems??[]).map(item=>({groupId:String(group.optionId),item})));
    const one=id=>{
      const rows=entries.filter(row=>String(row.item.optionItemId)===String(id));
      if(rows.length>1)throw Error('rocket_migration_ambiguous_identity');
      return rows[0];
    };
    if(!catalog.groups.some(group=>String(group.optionId)===String(toParentId)))throw Error('rocket_migration_destination_missing');
    return {entries,old:one(fromId),next:state?.newId?one(state.newId):null};
  };
  let observed=await read();
  const matching=row=>row&&row.item.optionItemName===target.name&&Number(row.item.salePrice)===target.price;
  if(state&&(state.key!==identity.key||state.sourceKey!==target.sourceKey||state.targetId!==target.targetId
    ||state.fromId!==String(fromId)||state.toParentId!==String(toParentId)||state.name!==target.name||state.price!==target.price))throw Error('rocket_migration_intent_changed');
  const checkpoint=async patch=>{const next={...state,...patch};await save(next);state=next;};
  if(!state) {
    if(!matching(observed.old)||observed.old.groupId===String(toParentId)
      ||observed.old.item.forceNotExpose||!['ON_SALE','NOT_EXPOSE'].includes(observed.old.item.displayStatus))throw Error('rocket_migration_old_state_invalid');
    const fromExternalId=target.mappings.find(mapping=>mapping.externalId===String(fromId)||mapping.externalId.endsWith(`_${fromId}`))?.externalId;
    if(!fromExternalId)throw Error('rocket_migration_mapping_missing');
    await checkpoint({...identity,sourceKey:target.sourceKey,targetId:target.targetId,fromExternalId,fromId:String(fromId),fromParentId:observed.old.groupId,toParentId:String(toParentId),
      name:target.name,price:target.price,displayStatus:observed.old.item.displayStatus,phase:'reserved',newId:''});
    // Only this fresh, durably reserved call may issue the creation.
    const receipt=await client.createHiddenOption({marker:state.marker,price:state.price,groupId:state.toParentId});
    if(!receipt?.optionItemId)throw Error('rocket_migration_receipt_missing');
    await checkpoint({phase:'received',newId:String(receipt.optionItemId)});
  }else if(!state.newId) {
    // After an uncertain request, recover the merchant-origin receipt. Never
    // treat an empty list as permission to create the replacement again.
    const receipt=await client.transport.creationReceipt(`rocket:${client.storeId}:option:${state.marker}`);
    if(receipt?.status!=='received'||!receipt.data?.optionItemId)throw Error('rocket_migration_creation_uncertain');
    await checkpoint({phase:'received',newId:String(receipt.data.optionItemId)});
  }
  observed=await read();
  const next=observed.next;
  if(!next||next.groupId!==state.toParentId||Number(next.item.salePrice)!==state.price
    ||![state.marker,state.name].includes(next.item.optionItemName)||next.item.forceNotExpose)throw Error('rocket_migration_new_identity_invalid');
  const oldUnchanged=old=>matching(old)&&old.groupId===state.fromParentId&&!old.item.forceNotExpose&&old.item.displayStatus===state.displayStatus;
  if(!observed.old) {
    if(!['prepared','complete'].includes(state.phase)||!matching(next)||next.item.displayStatus!==state.displayStatus)throw Error('rocket_migration_old_disappeared');
    if(state.phase!=='complete')await checkpoint({phase:'complete'});
    return state;
  }
  if(!oldUnchanged(observed.old))throw Error('rocket_migration_old_changed');
  if(state.phase==='received') {
    if(next.item.displayStatus!=='NOT_EXPOSE')throw Error('rocket_migration_unprepared_exposure');
    if(next.item.optionItemName!==state.name)await client.updateOption(state.newId,{name:state.name,price:state.price});
    observed=await read();
    if(!matching(observed.next)||observed.next.item.displayStatus!=='NOT_EXPOSE'||!oldUnchanged(observed.old))throw Error('rocket_migration_prepare_unverified');
    await checkpoint({phase:'prepared'});
  }
  if(state.phase!=='prepared')throw Error('rocket_migration_phase_invalid');
  observed=await read();
  if(!matching(observed.next)||!oldUnchanged(observed.old))throw Error('rocket_migration_cutover_drift');
  if(observed.next.item.displayStatus!==state.displayStatus)
    await client.setMigratedOptionStatus(state.newId,{name:state.name,price:state.price,displayStatus:state.displayStatus,groupId:state.toParentId});
  observed=await read();
  if(!oldUnchanged(observed.old)) {
    if(observed.next?.item.displayStatus==='ON_SALE')await client.setMigratedOptionStatus(state.newId,{name:state.name,price:state.price,displayStatus:'NOT_EXPOSE',groupId:state.toParentId});
    throw Error('rocket_migration_old_changed');
  }
  if(!matching(observed.next)||observed.next.item.displayStatus!==state.displayStatus)throw Error('rocket_migration_cutover_unverified');
  await client.retireOption(state.fromId);
  observed=await read();
  if(observed.old||!matching(observed.next)||observed.next.item.displayStatus!==state.displayStatus)throw Error('rocket_migration_retirement_unverified');
  await checkpoint({phase:'complete'});
  return state;
}
