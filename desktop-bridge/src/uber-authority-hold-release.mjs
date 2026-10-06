const nonempty=value=>typeof value==='string'&&value.length>0&&value.length<=240;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// This is a policy/proof check, not an instruction to change stock. A released
// creation hold may subsequently be sold out normally by store operations.
export function isCreationHoldReleased(payload,target,mapping) {
  const proof=mapping?.creationHoldRelease;
  if(!proof||proof.validation!=='persisted-native-audit-v1'||proof.verified!==true||proof.isAvailable!==true
    ||!['item','option'].includes(target?.kind)||target.archived||target.quarantined)return false;
  for(const [key,value] of Object.entries({sourceId:payload?.sourceId,storeId:payload?.storeId,
    platform:payload?.platformKey,merchantId:payload?.merchantId,sourceKey:target.sourceKey,
    kind:target.kind,targetId:target.targetId,externalId:mapping.externalId}))
    if(!nonempty(proof[key])||proof[key]!==String(value??''))return false;
  if(typeof proof.externalParentId!=='string'||proof.externalParentId.length>240
    ||proof.externalParentId!==String(mapping.externalParentId??''))return false;
  if(!uuid(proof.inventoryCommandId)||!uuid(proof.auditCommandId)||proof.inventoryCommandId===proof.auditCommandId)return false;
  const completed=Date.parse(proof.completedAt),captured=Date.parse(proof.capturedAt);
  return Number.isFinite(completed)&&Number.isFinite(captured)&&captured>=completed&&captured<=Date.now()+5*60*1000;
}

export function creationHoldPhysicalId(platform,kind,externalId,merchantId) {
  const value=String(externalId??'');
  if(platform==='rocket_now') {
    const id=value.match(/^sub_checkbox_[0-9]+_([0-9]+)$/)?.[1]??value;
    if(!/^[0-9]+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<1)throw Error('uber_creation_hold_identity_invalid');
    return id;
  }
  if(platform!=='demae_can'||!['item','option'].includes(kind))throw Error('uber_creation_hold_identity_invalid');
  const prefix=`itemList_${merchantId}`,suffix=kind==='option'?'true':'false';
  if(!value.startsWith(prefix)||!value.endsWith(suffix))throw Error('uber_creation_hold_identity_invalid');
  const id=value.slice(prefix.length,-suffix.length);
  if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error('uber_creation_hold_identity_invalid');
  return id;
}
