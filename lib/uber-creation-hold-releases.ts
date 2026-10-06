import {sql} from './db.ts';
import {creationHoldPhysicalId,isCreationHoldReleased,type UberCreationHoldRelease} from '../desktop-bridge/src/uber-authority-hold-release.mjs';
import type {UberPublicationMapping,UberPublicationNode} from './uber-menu-publication.ts';

type Row=Record<string,any>;
const object=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const sameTime=(a:unknown,b:unknown)=>typeof a==='string'&&typeof b==='string'&&Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
const ids=(values:unknown)=>Array.isArray(values)?values.flatMap(value=>typeof value==='string'?value.split(',').map(id=>id.trim()).filter(Boolean):[]):[];
const sameSet=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(id=>b.includes(id));
type HoldTarget=Pick<UberPublicationNode,'sourceKey'|'kind'|'targetId'|'archived'>;
type HoldScope={sourceId:string;storeId:string;platform:'rocket_now'|'demae_can';merchantId:string;nodes:HoldTarget[];mappings:UberPublicationMapping[]};

function commandProofValid(input:HoldScope,proof:Row,receipt:Row,inventory:Row,audit:Row,pending=false) {
  if(inventory.status!=='succeeded'||audit.status!==(pending?'processing':'succeeded')
    ||inventory.commandType!=='set_inventory_availability'||audit.commandType!=='audit_inventory')return false;
  if(inventory.payload?.syncSource!=='store'||inventory.payload.isAvailable!==true||inventory.payload.verifyAvailability!==true
    ||!['applied','already_applied'].includes(inventory.result?.outcome)
    ||inventory.result.matchedTargetCount!==inventory.payload.targets?.length||inventory.result.missingTargetCount!==0
    ||!Array.isArray(inventory.result.missingTargets)||inventory.result.missingTargets.length
    ||(input.platform==='rocket_now'&&inventory.result.desiredHidden!==false))return false;
  if(audit.payload?.creationHoldAuditForCommandId!==inventory.id||audit.payload.sourceId!==input.sourceId
    ||String(audit.payload.merchantId)!==input.merchantId)return false;
  if(!sameTime(proof.completedAt,inventory.completedAt)||!sameTime(proof.capturedAt,audit.result?.capturedAt)
    ||!Number.isFinite(Date.parse(audit.completedAt))||Date.parse(audit.completedAt)<Date.parse(proof.capturedAt)
    ||!Number.isFinite(Date.parse(audit.createdAt))||Date.parse(audit.createdAt)<Date.parse(inventory.completedAt)
    ||!Number.isFinite(Date.parse(inventory.createdAt))
    ||(receipt.identifiedAt&&Date.parse(inventory.createdAt)<Date.parse(String(receipt.identifiedAt))))return false;
  if(!commandTarget(inventory,proof,input.mappings)||!commandTarget(audit,proof,input.mappings))return false;
  const actuals=Array.isArray(audit.result.items)?audit.result.items.filter((row:Row)=>row.kind===proof.kind&&row.targetId===proof.targetId):[];
  const nativeBasis=input.platform==='rocket_now'?'external_id':'native_stock';
  if(actuals.length!==1||actuals[0].found!==true||actuals[0].isAvailable!==true
    ||actuals[0].nativeMatchBasis!==nativeBasis||!Array.isArray(actuals[0].nativeObservations))return false;
  const observations=actuals[0].nativeObservations as Row[];
  const expected=ids(commandTarget(audit,proof,input.mappings).knownExternalIds);
  if(!sameSet(ids(actuals[0].externalIds),expected)||!sameSet(observations.map(row=>row.externalId),expected)
    ||observations.some(row=>row.found!==true||row.isAvailable!==true||row.matchBasis!==nativeBasis
      ||row.physicalId!==creationHoldPhysicalId(input.platform,proof.kind,row.externalId,input.merchantId)))return false;
  if(input.platform==='rocket_now') {
    const native=observations.find(row=>row.externalId===proof.externalId);
    if(!native||native.externalId.match(/^sub_checkbox_([0-9]+)_[0-9]+$/)?.[1]!==proof.externalParentId)return false;
  }
  return isCreationHoldReleased({sourceId:input.sourceId,storeId:input.storeId,platformKey:input.platform,merchantId:input.merchantId},
    {kind:proof.kind,targetId:proof.targetId,sourceKey:proof.sourceKey},{externalId:proof.externalId,externalParentId:proof.externalParentId,
      creationHoldRelease:{...proof,validation:'persisted-native-audit-v1'}});
}

function demaeContext(payload:Row,proof:Row) {
  return Array.isArray(payload.demaeStaging)&&payload.demaeStaging.some((scope:Row)=>scope.storeId===proof.storeId
    &&String(scope.merchantId)===proof.merchantId&&Array.isArray(scope.graph)&&scope.graph.some((node:Row)=>
      node.kind===proof.kind&&node.targetId===proof.targetId&&node.sourceKey===proof.sourceKey
      &&Array.isArray(node.mappings)&&node.mappings.some((mapping:Row)=>mapping.externalId===proof.externalId
        &&String(mapping.externalParentId??'')===proof.externalParentId)));
}

function commandTarget(command:Row,proof:Row,mappings:UberPublicationMapping[]) {
  const targets=command.payload?.targets;
  if(!Array.isArray(targets))return null;
  const matches=targets.filter((target:Row)=>target.kind===proof.kind&&target.targetId===proof.targetId);
  if(matches.length!==1)return null;
  const expected=mappings.filter(mapping=>mapping.kind===proof.kind&&mapping.targetId===proof.targetId)
    .flatMap(mapping=>mapping.externalId.split(',').map(id=>id.trim()).filter(Boolean));
  if(!expected.length||!sameSet(ids(matches[0].knownExternalIds),expected))return null;
  if(proof.platform==='demae_can'&&!demaeContext(command.payload,proof))return null;
  return matches[0];
}

/** Read-only recognition of an explicit inventory release. A stored approval,
 * verified flag, native ON_SALE snapshot or old logical-only audit is not proof.
 * No command is queued and no availability setting is modified here. */
export async function loadVerifiedCreationHoldReleases(input:HoldScope&{releases:unknown}):Promise<UberCreationHoldRelease[]> {
  if(!Array.isArray(input.releases)||!input.releases.length)return [];
  if(input.releases.length>50)throw Error('uber_creation_hold_release_limit');
  const candidates=input.releases.map(object).filter(proof=>proof.verified===true&&proof.isAvailable===true
    &&proof.sourceId===input.sourceId&&proof.storeId===input.storeId&&proof.platform===input.platform
    &&proof.merchantId===input.merchantId&&uuid(proof.inventoryCommandId)&&uuid(proof.auditCommandId)
    &&proof.inventoryCommandId!==proof.auditCommandId
    &&input.nodes.some(node=>node.sourceKey===proof.sourceKey&&node.kind===proof.kind&&node.targetId===proof.targetId&&!node.archived)
    &&input.mappings.some(mapping=>mapping.kind===proof.kind&&mapping.targetId===proof.targetId
      &&mapping.externalId.split(',').map(id=>id.trim()).includes(proof.externalId)
      &&String(mapping.externalParentId??'')===proof.externalParentId));
  if(!candidates.length)return [];
  const commandIds=[...new Set(candidates.flatMap(proof=>[proof.inventoryCommandId,proof.auditCommandId]))];
  const commands=await sql`select id::text as id,store_id::text as "storeId",platform,command_type as "commandType",status,
    created_at::text as "createdAt",completed_at::text as "completedAt",
    jsonb_build_object('targets',payload->'targets','isAvailable',payload->'isAvailable','verifyAvailability',payload->'verifyAvailability',
      'syncSource',payload->'syncSource','demaeStaging',payload->'demaeStaging','sourceId',payload->'sourceId','merchantId',payload->'merchantId',
      'creationHoldAuditForCommandId',payload->'creationHoldAuditForCommandId') as payload,
    jsonb_build_object('outcome',result->'outcome','matchedTargetCount',result->'matchedTargetCount','missingTargetCount',result->'missingTargetCount',
      'missingTargets',result->'missingTargets','desiredHidden',result->'desiredHidden','items',result->'items','capturedAt',result->'capturedAt') as result
    from local_bridge_commands where id::text=any(${commandIds}::text[]) and store_id::text=${input.storeId} and platform=${input.platform}`;
  const receipts=await sql`select source_key as "sourceKey",external_id as "externalId",external_parent_id as "externalParentId",
    to_jsonb(a)->>'updated_at' as "identifiedAt" from menu_uber_creation_attempts a
    where source_id::text=${input.sourceId} and platform=${input.platform} and status='identified'`;
  const valid:UberCreationHoldRelease[]=[];
  for(const proof of candidates)try {
    // Conflicting duplicate policy records never choose a winner by order.
    if(candidates.filter(other=>other.sourceKey===proof.sourceKey&&other.externalId===proof.externalId).length!==1)continue;
    const receipt=receipts.filter(row=>row.sourceKey===proof.sourceKey&&row.externalId===proof.externalId
      &&String(row.externalParentId??'')===proof.externalParentId);
    if(receipt.length!==1)continue;
    const inventory=commands.find(row=>row.id===proof.inventoryCommandId) as Row|undefined;
    const audit=commands.find(row=>row.id===proof.auditCommandId) as Row|undefined;
    if(!inventory||!audit||!commandProofValid(input,proof,receipt[0],inventory,audit))continue;
    const verified={...proof,validation:'persisted-native-audit-v1'} as UberCreationHoldRelease;
    if(!isCreationHoldReleased({sourceId:input.sourceId,storeId:input.storeId,platformKey:input.platform,merchantId:input.merchantId},
      {kind:proof.kind,targetId:proof.targetId,sourceKey:proof.sourceKey},{externalId:proof.externalId,externalParentId:proof.externalParentId,creationHoldRelease:verified}))continue;
    // Persist/queue only this bounded allowlist, never a native response body.
    valid.push(Object.fromEntries(['sourceId','storeId','platform','merchantId','sourceKey','kind','targetId','externalId','externalParentId',
      'inventoryCommandId','auditCommandId','completedAt','capturedAt','verified','isAvailable','validation'].map(key=>[key,verified[key as keyof UberCreationHoldRelease]])) as UberCreationHoldRelease);
  } catch { /* Malformed, wrong-chain or partial evidence leaves the hold intact. */ }
  return valid;
}

/** Dedicated read-only audit ACK. The route already authenticated and claimed
 * this processing command; this validator grants no general audit permission,
 * writes no stock and does not release the hold before the ACK is persisted. */
export async function validateCreationHoldAuditAcknowledgement(input:{commandId:string;storeId:string;platform:string;payload:Row;result:Row}) {
  const fail=()=>{throw Error('creation_hold_audit_unverified');};
  const inventoryId=input.payload.creationHoldAuditForCommandId;
  if(!uuid(inventoryId)||!uuid(input.commandId)||!uuid(input.payload.sourceId)
    ||!['rocket_now','demae_can'].includes(input.platform)||!Array.isArray(input.payload.targets)
    ||!input.payload.targets.length||input.payload.targets.length>20)return fail();
  const scopeRows=await sql`select id::text as "sourceId",store_id::text as "storeId",brand_id::text as "brandId",
    publish_config->${input.platform}->>'merchantId' as "merchantId" from menu_uber_sources
    where id::text=${input.payload.sourceId} and store_id::text=${input.storeId} and enabled=true and auto_publish=true`;
  const scope=scopeRows[0];
  if(!scope||String(input.payload.merchantId)!==String(scope.merchantId))return fail();
  const commands=await sql`select id::text as id,store_id::text as "storeId",platform,command_type as "commandType",status,
    created_at::text as "createdAt",completed_at::text as "completedAt",payload,result
    from local_bridge_commands where store_id::text=${input.storeId} and platform=${input.platform}
      and id::text=any(${[inventoryId,input.commandId]}::text[])`;
  const inventory=commands.find(row=>row.id===inventoryId),audit=commands.find(row=>row.id===input.commandId);
  if(!inventory||!audit||audit.status!=='processing'||audit.commandType!=='audit_inventory'
    ||JSON.stringify(audit.payload)!==JSON.stringify(input.payload))return fail();
  const targetKeys=(targets:Row[])=>targets.map(target=>`${target.kind}:${target.targetId}`);
  if(!Array.isArray(inventory.payload?.targets)||!sameSet(targetKeys(input.payload.targets),targetKeys(inventory.payload.targets)))return fail();
  const nodes=await sql`select source_key as "sourceKey",kind,target_id::text as "targetId",archived from menu_uber_objects
    where source_id::text=${scope.sourceId} and not archived and kind in ('item','option')`;
  const mappings=await sql`select m.target_type as kind,m.target_id::text as "targetId",m.external_id as "externalId",m.external_parent_id as "externalParentId"
    from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id
    where p.brand_id::text=${scope.brandId} and p.store_id is null and p.platform_key=${input.platform}
      and (m.store_id is null or m.store_id::text=${input.storeId})`;
  const receipts=await sql`select source_key as "sourceKey",external_id as "externalId",external_parent_id as "externalParentId",
    to_jsonb(a)->>'updated_at' as "identifiedAt" from menu_uber_creation_attempts a
    where source_id::text=${scope.sourceId} and platform=${input.platform} and status='identified'`;
  const proofScope:HoldScope={sourceId:scope.sourceId,storeId:input.storeId,platform:input.platform as HoldScope['platform'],merchantId:String(scope.merchantId),
    nodes:nodes as HoldTarget[],mappings:mappings as UberPublicationMapping[]};
  const freshAudit={...audit,result:input.result,completedAt:new Date().toISOString()};
  for(const target of input.payload.targets) {
    const owners=nodes.filter(row=>row.kind===target.kind&&row.targetId===target.targetId);
    const native=(mappings as UberPublicationMapping[]).filter(row=>row.kind===target.kind&&row.targetId===target.targetId)
      .flatMap(mapping=>String(mapping.externalId).split(',').map(externalId=>({...mapping,externalId:externalId.trim()})).filter(mapping=>mapping.externalId));
    if(owners.length!==1||!native.length)return fail();
    for(const mapping of native) {
      const proof={...proofScope,sourceKey:owners[0].sourceKey,kind:target.kind,targetId:target.targetId,
        externalId:mapping.externalId,externalParentId:String(mapping.externalParentId??''),
        inventoryCommandId:inventoryId,auditCommandId:input.commandId,completedAt:inventory.completedAt,
        capturedAt:input.result.capturedAt,verified:true,isAvailable:true};
      const receipt=receipts.filter(row=>row.sourceKey===proof.sourceKey&&row.externalId===proof.externalId&&String(row.externalParentId??'')===proof.externalParentId);
      if(receipt.length!==1||!commandProofValid(proofScope,proof,receipt[0],inventory as Row,freshAudit,true))return fail();
    }
  }
}
