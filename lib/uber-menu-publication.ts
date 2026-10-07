import { createHash } from 'node:crypto';
import { deliveryPlatformRules, projectDeliveryName, projectDeliveryDescription } from './delivery-menu-publishing.ts';
import { authoritativeDeliveryPrice } from './uber-menu-authority.ts';
import {resolveUberOptionPlacement} from './uber-option-placement.ts';
import type {MenuNameAdaptation} from './menu-name-adaptation.ts';
import {isCreationHoldReleased,type UberCreationHoldRelease} from '../desktop-bridge/src/uber-authority-hold-release.mjs';

export type UberPublicationNode = {
  sourceKey: string; kind: string; targetId: string; parentId: string | null;
  name: string; displayNames: Record<string,string>; uberPrice: number|null; price: number|null;
  description: string; imageUrl: string; sortOrder: number; archived?: boolean;
  payload: Record<string,unknown>;
};
export type UberPublicationMapping = {kind:string; targetId:string; externalId:string; externalParentId:string};
export type UberCreationIdentity = {sourceKey:string;status:string;externalId:string;externalParentId:string};
export type UberMenuNameAdaptation = MenuNameAdaptation & {
  sourceName:string; verified:boolean; attemptedNames:string[]; rejectionReason:string; createdAt:string;
};

// A Demae carrier retains its creation marker when its option moves between
// Uber groups. Recover it only from an exact, persisted external identity.
function creationSourceKey(node:UberPublicationNode, mappings:UberPublicationMapping[], attempts:UberCreationIdentity[]) {
  const staged=mappings.filter(row=>row.kind===node.kind&&row.targetId===node.targetId&&row.externalParentId.startsWith('stage:'));
  const originals=staged.flatMap(mapping=>attempts.filter(row=>row.status==='identified'
    &&row.externalId===mapping.externalId&&row.externalParentId===mapping.externalParentId
    &&row.sourceKey.startsWith('option:')&&row.sourceKey.split(':').at(-1)===node.sourceKey.split(':').at(-1)).map(row=>row.sourceKey));
  const keys=[...new Set(originals)];
  if(keys.length>1)throw Error(`uber_creation_identity_ambiguous:${node.sourceKey}`);
  if(staged.length&&keys.length!==1)throw Error(`uber_creation_identity_missing:${node.sourceKey}`);
  return keys[0]??node.sourceKey;
}

export function isUberPublicationRetired(node:UberPublicationNode) {
  return node.archived===true||(node.kind==='item'&&node.payload.attached===false);
}

// Keep image ingestion in OS, but never give a downstream publisher image
// instructions (including images nested inside the captured source object).
function publicationSource(value: unknown): unknown {
  if(Array.isArray(value))return value.map(publicationSource);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!/image|photo|picture|thumbnail/i.test(key))
    .map(([key,entry])=>[key,publicationSource(entry)]));
  return value;
}

function nativePublicationName(platform:'rocket_now'|'demae_can',node:UberPublicationNode) {
  const rule=deliveryPlatformRules[platform];
  const full=projectDeliveryName(platform,node.name,node.displayNames,undefined,rule,node.kind==='option'?'option':'item');
  const limit=node.kind==='option_group'?50:255;
  if(platform!=='demae_can'||full.length<=limit)return full;
  // The merchant group form limits names to 50 characters. Keep the complete
  // source Japanese name; omit optional appended translations before ever
  // truncating the source name. An overlong source itself stays an error.
  const bilingual=projectDeliveryName(platform,node.name,{zh:node.displayNames.zh},undefined,rule);
  return bilingual.length<=limit?bilingual:projectDeliveryName(platform,node.name,{},undefined,rule);
}

export function buildUberPublication(input: {
  sourceId:string; storeId:string; brandId:string; revision:number;
  platform:'rocket_now'|'demae_can'; merchantId:string; menuPatternCode?:string; draftPatternCode?:string; draftCarrierItemCode?:string; selectionPolicy?:'strict'|'preserve_native';
  nodes:UberPublicationNode[]; mappings:UberPublicationMapping[];
  quarantinedSourceKeys?:string[];
  excludedSourceKeys?:string[];
  optionMigrationPolicy?:'preserve_stock';
  creationIdentities?:UberCreationIdentity[];
  nameAdaptations?:Record<string,UberMenuNameAdaptation>;
  creationHoldReleases?:UberCreationHoldRelease[];
}) {
  // Explicit, persisted owner decisions only; never infer exclusions from price.
  // Retain the source in OS while omitting it from downstream relationships.
  // Determine presentation aliases before exclusions remove their real primary.
  // An excluded normal group must not turn its alias into a new ingredient.
  const placements=resolveUberOptionPlacement(input.nodes.filter(n=>!input.quarantinedSourceKeys?.includes(n.sourceKey)),input.mappings);
  const excluded=new Set(input.excludedSourceKeys??[]);
  const excludedGroupIds=new Set((input.excludedSourceKeys??[])
    .filter(key=>key.startsWith('option_group:')).map(key=>key.slice('option_group:'.length)));
  const excludedParentIds=new Set(input.nodes.filter(node=>node.kind==='option_group'&&excluded.has(node.sourceKey))
    .map(node=>node.targetId));
  // A group policy covers its exact descendants, including options introduced
  // in a later capture. Parent identities, never names or prices, define scope.
  let added=true;
  while(added) {
    added=false;
    for(const node of input.nodes)if(node.kind==='option'&&node.parentId!==null&&excludedParentIds.has(node.parentId)) {
      if(!excluded.has(node.sourceKey)){excluded.add(node.sourceKey);added=true;}
      if(!excludedParentIds.has(node.targetId)){excludedParentIds.add(node.targetId);added=true;}
    }
  }
  for(const alias of placements)excluded.add(alias.sourceKey);
  const targets=input.nodes.filter(node=>!excluded.has(node.sourceKey)).map(node=>{
    const source=publicationSource(node.payload) as Record<string,unknown>;
    if(node.kind==='item'&&Array.isArray(source.groupIds))
      source.groupIds=source.groupIds.filter(id=>!excludedGroupIds.has(String(id)));
    const nameProjection=nativePublicationName(input.platform,node);
    const saved=input.nameAdaptations?.[node.sourceKey];
    const adaptation=saved?.verified===true&&saved.sourceKey===node.sourceKey&&saved.targetId===node.targetId
      &&saved.sourceName===node.name&&saved.inputName===nameProjection?saved:undefined;
    return {
    sourceKey:node.sourceKey,kind:node.kind,targetId:node.targetId,parentId:node.parentId,
    marker:`FS${createHash('sha256').update(`${input.sourceId}:${input.platform==='demae_can'&&input.creationIdentities?creationSourceKey(node,input.mappings,input.creationIdentities):node.sourceKey}`).digest('hex').slice(0,14)}`,
    name:adaptation?.name??nameProjection,sourceName:node.name,nameProjection,
    ...(adaptation?{nameAdaptation:adaptation}:{}),
    price:['item','option'].includes(node.kind) && !isUberPublicationRetired(node)
      ? authoritativeDeliveryPrice(input.platform,node.uberPrice as number,node.price as number) : null,
    description:projectDeliveryDescription(input.platform,node.description),sortOrder:node.sortOrder,
    archived:isUberPublicationRetired(node),source,
    quarantined:input.quarantinedSourceKeys?.includes(node.sourceKey)===true,
    mappings:input.mappings.filter(mapping=>mapping.kind===node.kind && mapping.targetId===node.targetId)
      .flatMap(mapping=>mapping.externalId.split(',').map(id=>id.trim()).filter(Boolean).map(externalId=>{
        const occurrence:{externalId:string;externalParentId:string;created?:boolean;creationHoldRelease?:UberCreationHoldRelease}={externalId,externalParentId:mapping.externalParentId};
        const proofs=input.creationHoldReleases?.filter(proof=>proof.sourceKey===node.sourceKey&&proof.externalId===externalId)??[];
        if(proofs.length===1&&isCreationHoldReleased({sourceId:input.sourceId,storeId:input.storeId,platformKey:input.platform,merchantId:input.merchantId},
          {sourceKey:node.sourceKey,kind:node.kind,targetId:node.targetId,archived:isUberPublicationRetired(node),quarantined:input.quarantinedSourceKeys?.includes(node.sourceKey)},
          {...occurrence,creationHoldRelease:proofs[0]})) {
          // The release loader proved this precise creation receipt, not all
          // historical creations. Preserve provenance without re-arming a
          // review hold which an explicit inventory operation already released.
          occurrence.created=true;occurrence.creationHoldRelease=proofs[0];
        }
        return occurrence;
      }))
  };});
  return {authoritativePublication:true,sourceId:input.sourceId,brandId:input.brandId,
    storeId:input.storeId,revision:input.revision,platformKey:input.platform,
    merchantId:input.merchantId,menuPatternCode:input.menuPatternCode??'',
    ...(input.platform==='demae_can'&&input.draftPatternCode?{draftPatternCode:input.draftPatternCode}:{}),
    ...(input.platform==='demae_can'&&input.draftCarrierItemCode?{draftCarrierItemCode:input.draftCarrierItemCode}:{}),
    selectionPolicy:input.selectionPolicy??'strict',
    ...(input.platform==='rocket_now'&&input.optionMigrationPolicy?{optionMigrationPolicy:input.optionMigrationPolicy}:{}),
    ruleVersion:'uber-authority-v1',imagePolicy:'read_only',newItemsHidden:true,targets};
}

/** Only independently read platform observations can satisfy a publication. */
export function verifyUberPublication(payload: Record<string,unknown>, result: Record<string,unknown>) {
  if(Array.isArray(payload.pendingRemovals)&&payload.pendingRemovals.length)throw Error('uber_publication_pending_removal_not_applied');
  const expected=payload.targets as Array<Record<string,unknown>>;
  const observed=result.observations as Array<Record<string,unknown>>;
  if (!Array.isArray(expected) || !Array.isArray(observed)) throw new Error('uber_publication_observations_missing');
  let quarantined=0;
  for(const target of expected) {
    const rows=observed.filter(row=>row.sourceKey===target.sourceKey);
    if (!rows.length) throw new Error(`uber_publication_unverified:${target.sourceKey}`);
    if(target.quarantined===true) {
      if(rows.length!==1||rows[0].quarantined!==true||rows[0].created||rows[0].hidden===false)throw Error(`uber_publication_quarantine_violated:${target.sourceKey}`);
      quarantined++;
      continue;
    }
    for(const row of rows) {
      if(target.archived) {
        if(row.exists!==false && row.hidden!==true) throw new Error(`uber_publication_not_retired:${target.sourceKey}`);
      } else {
        if(!row.externalId || row.name!==target.name || (target.price!==null && row.price!==target.price)) throw new Error(`uber_publication_content_mismatch:${target.sourceKey}`);
        const mapped=Array.isArray(target.mappings)?target.mappings as Array<Record<string,unknown>>:[];
        const newEntity=['item','option'].includes(String(target.kind))&&(!mapped.length||mapped.some(mapping=>mapping.externalId===row.externalId&&mapping.created===true));
        const occurrence=mapped.find(mapping=>mapping.externalId===row.externalId);
        if((row.created===true||newEntity) && !isCreationHoldReleased(payload,target,occurrence) && row.hidden!==true) throw new Error(`uber_publication_draft_exposed:${target.sourceKey}`);
        if(row.structureVerified!==true) throw new Error(`uber_publication_structure_unverified:${target.sourceKey}`);
      }
    }
    const mapped=Array.isArray(target.mappings)?target.mappings as Array<Record<string,unknown>>:[];
    for(const mapping of mapped) if(!rows.some(row=>row.externalId===mapping.externalId)) throw new Error(`uber_publication_occurrence_missing:${target.sourceKey}:${mapping.externalId}`);
  }
  return {verified:expected.length-quarantined,observed:observed.length,...(quarantined?{quarantined}:{})};
}
