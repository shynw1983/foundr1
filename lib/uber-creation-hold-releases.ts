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
    ||inventory.commandType!=='set_inventory_availability'||!['audit_inventory','repair_menu_sync'].includes(audit.commandType))return false;
  if(inventory.payload?.syncSource!=='store'||inventory.payload.isAvailable!==true
    ||!Array.isArray(inventory.payload.targets)
    ||!['applied','already_applied'].includes(inventory.result?.outcome)
    ||inventory.result.matchedTargetCount!==inventory.payload.targets?.length||inventory.result.missingTargetCount!==0
    ||!Array.isArray(inventory.result.missingTargets)||inventory.result.missingTargets.length
    ||(input.platform==='rocket_now'&&inventory.result.desiredHidden!==false))return false;
  if(audit.commandType==='repair_menu_sync') {
    // Only this dedicated, immutable verify_release command can replace the
    // missing legacy Rocket flag with its own later native verification.
    // Never treat the original successful Store write as readback evidence.
    if(inventory.payload.verifyAvailability!==true
      &&!(input.platform==='rocket_now'&&inventory.payload.verifyAvailability===undefined))return false;
    return recoveryCommandProofValid(input,proof,receipt,inventory,audit,pending);
  }
  if(inventory.payload.verifyAvailability!==true)return false;
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

const stable=(value:any):any=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,stable(value[key])])):value;
const equal=(a:unknown,b:unknown)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));

/** A repair read can prove one exact release only. It never converts the full
 * authority graph into inventory targets or borrows another target's restore. */
function recoveryCommandProofValid(input:HoldScope,proof:Row,receipt:Row,inventory:Row,audit:Row,pending:boolean) {
  try {
    const payload=object(audit.payload),recovery=object(payload.recovery),guard=object(recovery.guard),result=object(audit.result);
    if(inventory.storeId!==input.storeId||audit.storeId!==input.storeId||inventory.platform!==input.platform||audit.platform!==input.platform
      ||payload.authoritativePublication!==true||payload.sourceId!==input.sourceId||payload.storeId!==input.storeId
      ||payload.platformKey!==input.platform||String(payload.merchantId)!==input.merchantId
      ||payload.newItemsHidden!==true||payload.imagePolicy!=='read_only'||!Number.isSafeInteger(payload.revision)||payload.revision<1
      ||recovery.version!==1||recovery.mode!=='verify_release'||!uuid(recovery.failedJobId)
      ||(recovery.failedJobError!==`uber_authority_draft_exposed:${proof.sourceKey}`&&recovery.failedJobError!==`uber_publication_draft_exposed:${proof.sourceKey}`)
      ||recovery.sourceKey!==proof.sourceKey||recovery.externalId!==proof.externalId||String(recovery.externalParentId??'')!==proof.externalParentId
      ||guard.revision!==payload.revision||guard.expectedAvailable!==true||guard.holdActive===true||guard.releaseCommandId!==inventory.id
      ||!Array.isArray(recovery.inventoryTargets)||recovery.inventoryTargets.length!==1)return false;
    const original=commandTarget(inventory,proof,input.mappings);
    const selected=commandTarget({payload:{...inventory.payload,targets:recovery.inventoryTargets}},proof,input.mappings);
    if(!original||!selected||!equal(original,selected))return false;
    const targets=Array.isArray(payload.targets)?payload.targets.map(object):[];
    if(!targets.length||new Set(targets.map(row=>row.sourceKey)).size!==targets.length)return false;
    const targetRows=targets.filter(row=>row.sourceKey===proof.sourceKey&&row.kind===proof.kind&&row.targetId===proof.targetId);
    const logicalOwners=input.nodes.filter(row=>row.sourceKey===proof.sourceKey&&row.kind===proof.kind&&row.targetId===proof.targetId&&!row.archived);
    if(targetRows.length!==1||logicalOwners.length!==1)return false;
    const target=targetRows[0],mapped=Array.isArray(target.mappings)?target.mappings.map(object):[];
    const currentMappings=input.mappings.filter(row=>row.kind===proof.kind&&row.targetId===proof.targetId)
      .flatMap(row=>row.externalId.split(',').map(externalId=>({...row,externalId:externalId.trim()})).filter(row=>row.externalId));
    if(target.archived||target.quarantined||mapped.length!==1||mapped[0].created!==true||mapped[0].externalId!==proof.externalId
      ||String(mapped[0].externalParentId??'')!==proof.externalParentId||currentMappings.length!==1
      ||currentMappings[0].externalId!==proof.externalId||String(currentMappings[0].externalParentId??'')!==proof.externalParentId
      ||!Number.isSafeInteger(target.price)||target.price<0||typeof target.name!=='string'||!target.name.trim())return false;
    const physicalId=creationHoldPhysicalId(input.platform,proof.kind,proof.externalId,input.merchantId);
    const owners=input.mappings.filter(row=>row.kind===proof.kind).flatMap(row=>row.externalId.split(',').map(externalId=>({...row,externalId:externalId.trim()})).filter(row=>row.externalId))
      .filter(row=>creationHoldPhysicalId(input.platform,row.kind,row.externalId,input.merchantId)===physicalId);
    if(owners.length!==1||owners[0].targetId!==proof.targetId)return false;
    const graphOwners=targets.filter(row=>row.kind===proof.kind).flatMap(row=>(Array.isArray(row.mappings)?row.mappings:[]).map((mapping:Row)=>({row,mapping})))
      .filter(({mapping})=>creationHoldPhysicalId(input.platform,proof.kind,mapping.externalId,input.merchantId)===physicalId);
    if(graphOwners.length!==1||graphOwners[0].row!==target)return false;
    const parents=targets.filter(row=>row.targetId===target.parentId&&row.kind===(proof.kind==='option'?'option_group':'category'));
    if(parents.length!==1||parents[0].archived||parents[0].quarantined)return false;
    const parent=parents[0],parentMappings=Array.isArray(parent.mappings)?parent.mappings.map(object):[];
    const storedParents=input.nodes.filter(row=>row.targetId===parent.targetId&&row.kind===parent.kind&&row.sourceKey===parent.sourceKey&&!row.archived);
    const currentParents=input.mappings.filter(row=>row.targetId===parent.targetId&&row.kind===parent.kind);
    if(storedParents.length!==1||parentMappings.length!==1||currentParents.length!==1
      ||parentMappings[0].externalId!==currentParents[0].externalId
      ||String(parentMappings[0].externalParentId??'')!==String(currentParents[0].externalParentId??''))return false;
    const parentId=String(parentMappings[0].externalId);
    if(!/^[A-Za-z0-9_-]+$/.test(parentId))return false;
    if(input.platform==='rocket_now'&&((proof.kind==='option'&&proof.externalId.match(/^sub_checkbox_([0-9]+)_[0-9]+$/)?.[1]!==proof.externalParentId)||parentId!==proof.externalParentId))return false;
    if(payload.migrationState?.[target.sourceKey]||Object.values(object(payload.migrationState)).some((row:any)=>row?.targetId===target.targetId))return false;
    const observed=object(result.inspection),inspected=Number(result.inspectedAt),created=Date.parse(audit.createdAt),completed=Date.parse(audit.completedAt);
    const inventoryCreated=Date.parse(inventory.createdAt),inventoryCompleted=Date.parse(inventory.completedAt),identified=Date.parse(receipt.identifiedAt);
    if(typeof result.inspectedAt!=='number'||!Number.isFinite(inspected)||!Number.isFinite(created)||!Number.isFinite(completed)
      ||!Number.isFinite(inventoryCreated)||!Number.isFinite(inventoryCompleted)||!Number.isFinite(identified)
      ||!Number.isFinite(guard.checkedAt)||inventoryCreated<identified||created<inventoryCompleted
      ||guard.checkedAt<inventoryCompleted||guard.checkedAt>created+5000||inspected<created||inspected<guard.checkedAt-5000
      ||inspected-guard.checkedAt>120000||completed<inspected||!sameTime(proof.completedAt,inventory.completedAt)
      ||!sameTime(proof.capturedAt,result.capturedAt)||!sameTime(result.capturedAt,new Date(inspected).toISOString())
      ||pending&&(Date.now()-inspected>120000||inspected>Date.now()+5000))return false;
    if(result.recoveryVersion!==1||result.outcome!=='verified_release'||result.mode!=='verify_release'||result.changed!==0
      ||!Array.isArray(result.blockers)||result.blockers.length||!Array.isArray(result.observations)||result.observations.length!==1
      ||!equal(result.observations[0],observed))return false;
    for(const [key,expected] of Object.entries({sourceId:input.sourceId,storeId:input.storeId,platformKey:input.platform,merchantId:input.merchantId,
      brandId:payload.brandId,revision:payload.revision,failedJobId:recovery.failedJobId,sourceKey:proof.sourceKey,targetId:proof.targetId,
      kind:proof.kind,externalId:proof.externalId,externalParentId:proof.externalParentId}))if(result[key]!==expected)return false;
    for(const key of ['sourceKey','targetId','kind','externalId','externalParentId'])if(observed[key]!==proof[key])return false;
    if(observed.found!==true||observed.identityVerified!==true||observed.hidden!==false||observed.isAvailable!==true
      ||observed.name!==target.name||observed.price!==target.price||!Array.isArray(observed.parentIds)||!sameSet(observed.parentIds,[parentId])
      ||input.platform==='rocket_now'&&(observed.nativeStatus!=='ON_SALE'||observed.forceNotExpose===true)
      ||input.platform==='demae_can'&&(observed.nativeStatus!=='AVAILABLE'||observed.staged===true))return false;
    return isCreationHoldReleased({sourceId:input.sourceId,storeId:input.storeId,platformKey:input.platform,merchantId:input.merchantId},
      {kind:proof.kind,targetId:proof.targetId,sourceKey:proof.sourceKey},{externalId:proof.externalId,externalParentId:proof.externalParentId,
        creationHoldRelease:{...proof,validation:'persisted-native-audit-v1'}});
  } catch {return false;}
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
    jsonb_build_object('targets',payload->'targets','isAvailable',payload->'isAvailable',
      'syncSource',payload->'syncSource','demaeStaging',payload->'demaeStaging','sourceId',payload->'sourceId','merchantId',payload->'merchantId',
      'creationHoldAuditForCommandId',payload->'creationHoldAuditForCommandId','authoritativePublication',payload->'authoritativePublication',
      'brandId',payload->'brandId','storeId',payload->'storeId','platformKey',payload->'platformKey','revision',payload->'revision',
      'newItemsHidden',payload->'newItemsHidden','imagePolicy',payload->'imagePolicy','migrationState',payload->'migrationState','recovery',payload->'recovery')
      ||case when payload ? 'verifyAvailability' then jsonb_build_object('verifyAvailability',payload->'verifyAvailability') else '{}'::jsonb end as payload,
    jsonb_build_object('outcome',result->'outcome','matchedTargetCount',result->'matchedTargetCount','missingTargetCount',result->'missingTargetCount',
      'missingTargets',result->'missingTargets','desiredHidden',result->'desiredHidden','items',result->'items','capturedAt',result->'capturedAt',
      'recoveryVersion',result->'recoveryVersion','sourceId',result->'sourceId','storeId',result->'storeId','brandId',result->'brandId',
      'revision',result->'revision','platformKey',result->'platformKey','merchantId',result->'merchantId','failedJobId',result->'failedJobId',
      'mode',result->'mode','sourceKey',result->'sourceKey','targetId',result->'targetId','kind',result->'kind','externalId',result->'externalId',
      'externalParentId',result->'externalParentId','inspection',result->'inspection','observations',result->'observations',
      'changed',result->'changed','blockers',result->'blockers','inspectedAt',result->'inspectedAt') as result
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

/** A normal repair command may supply a fresh read for one previously released
 * creation. Its original Store inventory command remains immutable evidence. */
export async function validateMenuRecoveryHoldReleaseAcknowledgement(input:{commandId:string;storeId:string;platform:string;payload:Row;result:Row}) {
  const fail=():never=>{throw Error('menu_recovery_hold_release_unverified');};
  const recovery=object(input.payload.recovery),inventoryId=object(recovery.guard).releaseCommandId;
  if(!uuid(inventoryId)||!uuid(input.commandId)||!uuid(input.payload.sourceId)||!uuid(input.payload.brandId)
    ||!['rocket_now','demae_can'].includes(input.platform)||recovery.mode!=='verify_release')return fail();
  const scopeRows=await sql`select id::text as "sourceId",store_id::text as "storeId",brand_id::text as "brandId",revision,
    publish_config->${input.platform}->>'merchantId' as "merchantId" from menu_uber_sources
    where id::text=${input.payload.sourceId} and store_id::text=${input.storeId} and enabled=true and auto_publish=true`;
  const scope=scopeRows[0];
  if(!scope||scope.brandId!==input.payload.brandId||scope.revision!==input.payload.revision
    ||String(scope.merchantId)!==String(input.payload.merchantId))return fail();
  const commands=await sql`select id::text as id,store_id::text as "storeId",platform,command_type as "commandType",status,
    created_at::text as "createdAt",completed_at::text as "completedAt",payload,result
    from local_bridge_commands where store_id::text=${input.storeId} and platform=${input.platform}
      and id::text=any(${[inventoryId,input.commandId]}::text[])`;
  const inventory=commands.find(row=>row.id===inventoryId),repair=commands.find(row=>row.id===input.commandId);
  if(!inventory||!repair||repair.status!=='processing'||repair.commandType!=='repair_menu_sync'||!equal(repair.payload,input.payload))return fail();
  const nodes=await sql`select source_key as "sourceKey",kind,target_id::text as "targetId",archived from menu_uber_objects
    where source_id::text=${scope.sourceId} and not archived`;
  const mappings=await sql`select m.target_type as kind,m.target_id::text as "targetId",m.external_id as "externalId",m.external_parent_id as "externalParentId"
    from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id
    where p.brand_id::text=${scope.brandId} and p.store_id is null and p.platform_key=${input.platform}
      and (m.store_id is null or m.store_id::text=${input.storeId})`;
  const targetRows=nodes.filter(row=>row.sourceKey===recovery.sourceKey&&['item','option'].includes(row.kind));
  if(targetRows.length!==1)return fail();
  const target=targetRows[0],proofScope:HoldScope={sourceId:scope.sourceId,storeId:input.storeId,platform:input.platform as HoldScope['platform'],
    merchantId:String(scope.merchantId),nodes:nodes as HoldTarget[],mappings:mappings as UberPublicationMapping[]};
  const receipts=await sql`select source_key as "sourceKey",external_id as "externalId",external_parent_id as "externalParentId",
    to_jsonb(a)->>'updated_at' as "identifiedAt" from menu_uber_creation_attempts a
    where source_id::text=${scope.sourceId} and platform=${input.platform} and status='identified' and source_key=${recovery.sourceKey}`;
  const receipt=receipts.filter(row=>row.externalId===recovery.externalId&&String(row.externalParentId??'')===String(recovery.externalParentId??''));
  const proof={sourceId:scope.sourceId,storeId:input.storeId,platform:input.platform,merchantId:String(scope.merchantId),sourceKey:target.sourceKey,
    kind:target.kind,targetId:target.targetId,externalId:recovery.externalId,externalParentId:String(recovery.externalParentId??''),
    inventoryCommandId:inventoryId,auditCommandId:input.commandId,completedAt:inventory.completedAt,capturedAt:input.result.capturedAt,
    verified:true,isAvailable:true,validation:'persisted-native-audit-v1'} as UberCreationHoldRelease;
  const freshRepair={...repair,result:input.result,completedAt:new Date().toISOString()};
  if(receipt.length!==1||!commandProofValid(proofScope,proof,receipt[0],inventory as Row,freshRepair,true))return fail();
  return proof;
}
