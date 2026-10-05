import {createHash} from 'node:crypto';
import {authorityPhysicalId} from './uber-authority-parents.mjs';
import {DemaeDraftClient} from './demae-draft-client.mjs';

const code=value=>{
  const text=String(value??'');
  if(!/^[A-Za-z0-9_-]+$/.test(text))throw Error('demae_internal_carrier_identity_invalid');
  return text;
};
const marker=(sourceId,sourceKey)=>`FS${createHash('sha256').update(`${sourceId}:${sourceKey}`).digest('hex').slice(0,14)}`;

/** A carrier is a separate native relationship, not an Uber option group.
 * Old source keys remain valid evidence only for the exact recorded physical
 * option/group pair. Names and an FS prefix never establish its ownership. */
export function collectDemaeInternalCarriers(payload) {
  const identities=new Map();
  const add=(sourceKey,mapping,creationMarker)=>{
    const parent=String(mapping.externalParentId??'');
    if(!parent.startsWith('stage:')||parent==='stage:__creating__')return;
    if(!payload.sourceId||!/^option:[^:]+:[^:]+$/.test(sourceKey))throw Error('demae_internal_carrier_receipt_invalid');
    const groupId=code(parent.slice(6));
    const optionId=code(authorityPhysicalId('demae_can','option',mapping.externalId,payload.merchantId));
    const previous=identities.get(groupId);
    if(previous&&previous.optionId!==optionId)throw Error('demae_internal_carrier_receipt_conflict');
    const identity=previous??{groupId,optionId,markers:new Set(),sourceKeys:new Set()};
    identity.markers.add(creationMarker);identity.sourceKeys.add(sourceKey);
    identities.set(groupId,identity);
  };
  for(const [sourceKey,state] of Object.entries(payload.authorityState??{})) {
    if(state?.status!=='identified'||!sourceKey.startsWith('option:'))continue;
    if(state.sourceKey&&state.sourceKey!==sourceKey)throw Error('demae_internal_carrier_receipt_invalid');
    add(sourceKey,state,marker(payload.sourceId,sourceKey));
  }
  for(const target of payload.targets.filter(target=>target.kind==='option'))for(const mapping of target.mappings??[]) {
    const parent=String(mapping.externalParentId??'');
    if(!parent.startsWith('stage:')||parent==='stage:__creating__')continue;
    const original=identities.get(parent.slice(6));
    // A move changes the logical source key, never the existing carrier's
    // creation marker. Only a matching persisted receipt permits that case.
    if(original&&original.optionId===authorityPhysicalId('demae_can','option',mapping.externalId,payload.merchantId)) {
      if(!original.markers.has(target.marker))throw Error('demae_internal_carrier_marker_conflict');
      original.sourceKeys.add(target.sourceKey);
    } else {
      const expected=marker(payload.sourceId,target.sourceKey);
      if(target.marker!==expected)throw Error('demae_internal_carrier_marker_conflict');
      add(target.sourceKey,mapping,expected);
    }
  }
  return identities;
}

/** Read each native carrier once within this phase, reusing already-read
 * business groups. Only the configured, independently verified private draft
 * item may consume it. A published option may still have this private link. */
export async function readDemaeInternalCarriers(client,payload,{identities=collectDemaeInternalCarriers(payload),groups=[],liveGroupIds=[],liveItemIds=[]}={}) {
  if(!identities.size)return new Map();
  const carrierId=code(payload.draftCarrierItemCode);
  if(!payload.draftPatternCode||String(payload.draftPatternCode)===String(payload.menuPatternCode)
    ||liveItemIds.map(String).includes(carrierId))throw Error('demae_internal_carrier_scope_invalid');
  const nativeGroups=new Map(groups.map(group=>[String(group.detail.optionGroupCode),group]));
  const missing=[...identities.keys()].filter(id=>!nativeGroups.has(id));
  for(let i=0;i<missing.length;i+=4)for(const group of await Promise.all(missing.slice(i,i+4).map(id=>client.group(id)))) {
    nativeGroups.set(String(group.detail.optionGroupCode),group);
  }
  const verified=new Map();
  for(const identity of identities.values()) {
    if(payload.targets.some(target=>target.kind==='option_group'&&(target.mappings??[]).some(mapping=>
      authorityPhysicalId('demae_can','option_group',mapping.externalId,payload.merchantId)===identity.groupId)))throw Error('demae_internal_carrier_business_mapping_conflict');
    const group=nativeGroups.get(identity.groupId);
    if(!group||String(group.detail.chainId)!==String(payload.merchantId)
      ||String(group.detail.optionGroupCode)!==identity.groupId
      ||!identity.markers.has(group.detail.optionGroupName)
      ||group.detail.adminOptionGroupName!==group.detail.optionGroupName)throw Error('demae_internal_carrier_group_identity_invalid');
    if(liveGroupIds.map(String).includes(identity.groupId))throw Error('demae_internal_carrier_is_live');
    if(!Array.isArray(group.options)||group.options.length>1
      ||group.options.some(option=>String(option.chainId)!==String(payload.merchantId)||String(option.optionCode)!==identity.optionId))throw Error('demae_internal_carrier_member_invalid');
    if(!Array.isArray(group.items)||group.items.length!==1||String(group.items[0].chainId)!==String(payload.merchantId)
      ||String(group.items[0].itemCode)!==carrierId||!Array.isArray(group.items[0].sizeList)||!group.items[0].sizeList.length
      ||group.items[0].sizeList.some(size=>!size.sizeCode))throw Error('demae_internal_carrier_consumer_invalid');
    verified.set(identity.groupId,{...identity,carrierId,native:group});
  }
  // Verify the real item/category/pattern graph after the group reads. A stock
  // flag or absence from the live catalog is not proof of private placement.
  const carrier=await new DemaeDraftClient(client.transport,payload.merchantId,payload.menuPatternCode)
    .assertHiddenItem(payload.draftPatternCode,carrierId);
  for(const {native,groupId} of verified.values()) {
    const reported=[...new Set(native.items[0].sizeList.map(size=>String(size.sizeCode)))].sort();
    const actual=[...new Set((carrier.sizeInfoList??[]).filter(size=>size.sizeOptionGroupLinkList?.some(link=>String(link.optionGroupCode)===groupId))
      .map(size=>String(size.sizeCode)))].sort();
    if(reported.length!==actual.length||reported.some((size,index)=>size!==actual[index]))throw Error('demae_internal_carrier_size_link_invalid');
  }
  return verified;
}
