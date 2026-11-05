import {randomUUID} from 'node:crypto';
import {sql} from './db';
import {withInventoryOperationLock} from './inventory-operation-lock';
import {publishBridgeCommandAvailable} from './local-bridge-realtime';
import {authorityPhysicalId} from '../desktop-bridge/src/uber-authority-parents.mjs';
import {reconcileUberPublications} from './uber-menu-publication-reconcile';
import {recoveryRecord as record, recoveryFingerprint as fingerprint, recoveryNative, selectRecoveryTarget, validRecoveryInspection, validRecoveryEnvelope,
  type RecoveryRecord as Row, type MenuRecoveryAction, type MenuRecoveryView} from './menu-sync-recovery';

const commandTypes = ['inspect_menu_sync','repair_menu_sync'];
const fail = (code: string): never => {throw new Error(code);};
const time = (value: unknown) => Date.parse(String(value ?? ''));
const iso = (value: unknown) => new Date(String(value)).toISOString();
const status = (row: Row) => ['pending','processing'].includes(row.status) &&
  (row.status === 'pending' ? Date.now()-time(row.createdAt)>300000 : time(row.claimExpiresAt)<Date.now()) ? 'expired' : String(row.status);

export async function loadMenuRecoveryScope(brandId: string, jobId: string) {
  const rows = await sql`select c.id::text, c.platform,c.status,c.last_error as error,c.payload,
    c.created_at::text as "createdAt",c.updated_at::text as "updatedAt",c.completed_at::text as "completedAt",
    s.id::text as "sourceId",s.store_id::text as "storeId",s.brand_id::text as "brandId",s.revision,s.enabled,s.auto_publish as "autoPublish",s.publish_config as config
    from local_bridge_commands c join menu_uber_sources s on s.id::text=c.payload->>'sourceId' and s.store_id=c.store_id
    where c.id::text=${jobId} and s.brand_id::text=${brandId} and c.command_type='publish_menu_changes'
      and c.platform in ('rocket_now','demae_can') and c.payload->>'authoritativePublication'='true'`;
  if (rows.length !== 1) return fail('stale_job');
  const scope = rows[0] as Row;
  const recoveryRows = await sql`select id::text,status,payload,result,last_error as error,created_at::text as "createdAt",
    completed_at::text as "completedAt",claim_expires_at::text as "claimExpiresAt"
    from local_bridge_commands where store_id::text=${scope.storeId} and platform=${scope.platform}
      and command_type in ('inspect_menu_sync','repair_menu_sync') and payload->'recovery'->>'failedJobId'=${jobId}
    order by created_at desc,id desc limit 8`;
  scope.recoveries = recoveryRows as Row[];
  const originalError = scope.error || scope.recoveries[0]?.payload?.recovery?.failedJobError || '';
  const selection = selectRecoveryTarget(record(scope.payload), originalError);
  if (!selection) {scope.unsupported = 'unsupported_error'; return scope;}
  Object.assign(scope, selection, {originalError});
  const heads = await sql`select id::text from local_bridge_commands where store_id::text=${scope.storeId}
    and platform=${scope.platform} and command_type='publish_menu_changes' and payload->>'sourceId'=${scope.sourceId}
    order by created_at desc,id desc limit 1`;
  scope.latestId = heads[0]?.id;
  const target = scope.target as Row;
  const [mappings, receipts, holds, inventory, os] = await Promise.all([
    sql`select m.id::text,m.target_type as kind,m.target_id::text as "targetId",m.external_id as "externalId",m.external_parent_id as "externalParentId"
      from menu_platform_object_mappings m join menu_external_platforms p on p.id=m.external_platform_id
      where p.brand_id::text=${scope.brandId} and p.store_id is null and p.platform_key=${scope.platform}
        and p.is_active=true and (m.store_id is null or m.store_id::text=${scope.storeId}) order by m.id`,
    sql`select source_key as "sourceKey",status,external_id as "externalId",external_parent_id as "externalParentId",updated_at::text as "updatedAt"
      from menu_uber_creation_attempts where source_id::text=${scope.sourceId} and platform=${scope.platform} and source_key=${target.sourceKey}`,
    sql`select availability,updated_at::text as "updatedAt" from menu_platform_availability_settings
      where store_id::text=${scope.storeId} and brand_id::text=${scope.brandId} and target_kind=${target.kind}
        and target_id::text=${target.targetId} and platform=${scope.platform}`,
    sql`select c.id::text,c.status,c.payload,c.result,c.created_at::text as "createdAt",c.completed_at::text as "completedAt"
      from local_bridge_commands c where c.store_id::text=${scope.storeId} and c.platform=${scope.platform}
        and c.command_type='set_inventory_availability' and c.status in ('pending','processing','succeeded','failed')
        and exists(select 1 from jsonb_array_elements(coalesce(c.payload->'targets','[]'::jsonb)) item
          where item->>'kind'=${target.kind} and item->>'targetId'=${target.targetId})
      order by c.created_at desc,c.id desc limit 1`,
    sql`select exists(select 1 from menu_inventory_availability_blocks b where b.store_id::text=${scope.storeId}
        and b.target_kind=${target.kind} and b.target_id::text=${target.targetId}) as blocked,
      case when ${target.kind}='item' then (select is_available from menu_store_settings where store_id::text=${scope.storeId} and menu_catalog_item_id::text=${target.targetId})
        else (select is_available from menu_option_store_settings where store_id::text=${scope.storeId} and menu_option_id::text=${target.targetId}) end as available`
  ]);
  scope.mappings = mappings; scope.receipts = receipts; scope.hold = holds[0] ?? null;
  scope.inventory = inventory[0] ?? null; scope.os = os[0] ?? {};
  const physical = (kind: string, id: unknown) => authorityPhysicalId(scope.platform, kind, String(id), String(scope.payload.merchantId));
  let owners: Row[] = [];
  try {owners = mappings.filter(row => row.kind === target.kind && String(row.externalId).split(',').some(id => physical(row.kind,id.trim()) === physical(target.kind,scope.mapping.externalId)));} catch {}
  scope.identityValid = owners.length === 1 && owners[0].targetId === target.targetId && owners[0].externalId === scope.mapping.externalId
    && String(owners[0].externalParentId ?? '') === String(scope.mapping.externalParentId ?? '');
  scope.receiptValid = receipts.length === 1 && receipts[0].status === 'identified' && receipts[0].externalId === scope.mapping.externalId
    && String(receipts[0].externalParentId ?? '') === String(scope.mapping.externalParentId ?? '');
  scope.snapshot = fingerprint({sourceId:scope.sourceId,revision:scope.revision,config:scope.config,jobId:scope.id,status:scope.status,
    updatedAt:scope.updatedAt,error:scope.error,target:scope.target,mapping:scope.mapping,mappings,receipts,hold:scope.hold,
    inventory:scope.inventory,os:scope.os,latestId:scope.latestId});
  return scope;
}

function scopeBlock(scope: Row) {
  if (scope.unsupported) return String(scope.unsupported);
  if (!scope.enabled || !scope.autoPublish || Number(scope.payload.revision) !== Number(scope.revision)) return 'source_changed';
  if (scope.status !== 'failed' || scope.latestId !== scope.id) return 'stale_job';
  if (Array.isArray(scope.payload.pendingRemovals) && scope.payload.pendingRemovals.length) return 'source_changed';
  if (!scope.identityValid) return 'mapping_changed';
  if (!scope.receiptValid) return 'receipt_missing';
  const config = record(record(scope.config)[scope.platform]);
  for (const key of ['merchantId','menuPatternCode','draftPatternCode','draftCarrierItemCode']) {
    if (String(config[key] ?? '') !== String(scope.payload[key] ?? '')) return 'source_changed';
  }
  return '';
}
function inspectionValid(row: Row, scope: Row) {
  return status(row) === 'succeeded' && validRecoveryEnvelope(row.result,row.payload)
    && row.payload.recovery.snapshot === scope.snapshot && row.payload.recovery.failedJobId === scope.id
    && Number.isSafeInteger(row.result.inspectedAt) && row.result.inspectedAt <= Date.now()+5000
    && row.result.inspectedAt >= time(row.createdAt) && Date.now()-row.result.inspectedAt < 600000
    && Number.isFinite(time(row.completedAt)) && time(row.completedAt) >= row.result.inspectedAt-5000;
}
function inventoryBlock(scope: Row) {
  const latest = scope.inventory;
  return latest && ['pending','processing'].includes(latest.status) ? 'inventory_pending'
    : latest?.status === 'failed' ? 'inventory_failed' : '';
}
function releaseCandidate(scope: Row) {
  const command = scope.inventory, target = scope.target, receipt = scope.receipts?.[0];
  if (!command || command.status !== 'succeeded' || command.payload?.syncSource !== 'store' || command.payload?.isAvailable !== true
    // Older normal Rocket Store operations omitted this flag. They establish
    // intent only; verify_release must supply a new exact native read before
    // a release proof can be persisted. An explicit false is never accepted.
    || (command.payload.verifyAvailability !== true && !(scope.platform === 'rocket_now' && command.payload.verifyAvailability === undefined))
    || !Array.isArray(command.payload.targets) || !['applied','already_applied'].includes(command.result?.outcome)
    || command.result.missingTargetCount !== 0 || command.result.matchedTargetCount !== command.payload.targets?.length
    || !Array.isArray(command.result.missingTargets) || command.result.missingTargets.length
    || (scope.platform === 'rocket_now' && command.result.desiredHidden !== false)
    || !Number.isFinite(time(command.createdAt)) || !Number.isFinite(time(receipt?.updatedAt))
    || !Number.isFinite(time(command.completedAt)) || time(command.completedAt) < time(command.createdAt)
    || time(command.createdAt) < time(receipt?.updatedAt)
    || scope.hold?.availability === 'unavailable' || scope.os?.blocked === true || scope.os?.available === false) return null;
  const targets = command.payload.targets.filter((row: Row) => row.kind === target.kind && row.targetId === target.targetId);
  if (targets.length !== 1 || !Array.isArray(targets[0].knownExternalIds) || targets[0].knownExternalIds.length !== 1
    || targets[0].knownExternalIds[0] !== scope.mapping.externalId) return null;
  return {command,target:targets[0]};
}
function planFor(scope: Row, inspected: Row) {
  if (!inspectionValid(inspected,scope)) return {code:'inspection_expired'};
  const row = record(inspected.result.inspection);
  if (!validRecoveryInspection(inspected.result,inspected.payload)) return {code:'native_identity_unverified'};
  if (record(inspected.result).outcome === 'blocked' || Array.isArray(inspected.result.blockers) && inspected.result.blockers.length) return {code:'native_identity_unverified'};
  const busy = inventoryBlock(scope); if (busy) return {code:busy};
  const expiresAt = new Date(inspected.result.inspectedAt+600000).toISOString();
  let mode: 'retry'|'restore_hidden'|'verify_release';
  if (row.hidden === true) mode = 'retry';
  else if (scope.hold?.availability === 'unavailable') {
    if (scope.inventory && time(scope.inventory.createdAt)>time(scope.receipts[0]?.updatedAt)) return {code:'newer_inventory_intent'};
    if (inspected.result.canRestoreHidden !== true || scope.platform !== 'rocket_now') return {code:'restore_unsupported'};
    mode = 'restore_hidden';
  } else if (row.isAvailable === true && releaseCandidate(scope)) mode = 'verify_release';
  else return {code:'hold_conflict'};
  return {mode,expiresAt,token:fingerprint({snapshot:scope.snapshot,inspectionId:inspected.id,result:inspected.result,mode,expiresAt})};
}

export async function menuRecoveryView(brandId: string, jobId: string): Promise<MenuRecoveryView> {
  const scope = await loadMenuRecoveryScope(brandId,jobId);
  const view: MenuRecoveryView = {jobId,platform:String(scope.platform),supported:!scope.unsupported,status:'idle'};
  if (scope.target) view.target = {name:scope.target.name,kind:scope.target.kind,...(scope.parentName?{parentName:scope.parentName}:{})};
  const last = scope.recoveries[0];
  if (last) {
    view.command = {id:last.id,status:status(last),mode:last.payload.recovery.requestedAction ?? last.payload.recovery.mode,
      ...(last.error?{error:String(last.error).slice(0,300)}:{})};
    if (last.status==='succeeded' && validRecoveryEnvelope(last.result,last.payload)) {
      view.inspection = {id:last.id,at:iso(last.completedAt),expiresAt:new Date(Number(last.result.inspectedAt??0)+600000).toISOString(),
        native:recoveryNative(last.result),hold:scope.hold?.availability ?? null,
        ...(scope.inventory?{latestOperation:{at:iso(scope.inventory.createdAt),isAvailable:scope.inventory.payload.isAvailable===true,status:String(scope.inventory.status)}}:{}),
        blockers:Array.isArray(last.result.blockers)?last.result.blockers.filter((code:unknown):code is string=>typeof code==='string').slice(0,10):[]};
    }
    if (last.result?.continuationId) {
      const commands = await sql`select id::text,status from local_bridge_commands where store_id::text=${scope.storeId} and id::text=${last.result.continuationId} and command_type='publish_menu_changes'`;
      if (commands[0]) view.continuation = {id:String(commands[0].id),status:String(commands[0].status)};
    }
    if (status(last)==='pending'||status(last)==='processing') return {...view,status:last.payload.recovery.requestedAction==='inspect'?'checking':'repairing'};
    if (status(last)==='expired') return {...view,status:'unknown',code:'result_unknown'};
    if (last.status==='failed') return {...view,status:'unknown',code:String(last.error||'recovery_failed').replace(/^menu_sync_recovery_/,'')};
    if (last.status==='succeeded' && last.payload.recovery.requestedAction!=='inspect') {
      if (Array.isArray(last.result?.continuationBlocked) && last.result.continuationBlocked.length) {
        const code = String(last.result.continuationBlocked[0]).slice(0,120);
        return {...view,status:'blocked',code:'continuation_blocked',
          continuation:{id:scope.id,status:'blocked',code}};
      }
      return {...view,status:'verified',code:last.result?.continuationId?'continuation_queued':'check_ready'};
    }
  }
  const block = scopeBlock(scope); if (block) return {...view,status:'blocked',code:block};
  const inspected = scope.recoveries.find((row:Row) => row.payload.recovery.requestedAction==='inspect' && status(row)==='succeeded');
  if (!inspected) return view;
  view.inspection = {id:inspected.id,at:iso(inspected.completedAt),expiresAt:new Date(Number(inspected.result.inspectedAt??0)+600000).toISOString(),
    native:recoveryNative(inspected.result),hold:scope.hold?.availability ?? null,
    ...(scope.inventory?{latestOperation:{at:iso(scope.inventory.createdAt),isAvailable:scope.inventory.payload.isAvailable===true,status:String(scope.inventory.status)}}:{}),
    blockers:Array.isArray(inspected.result.blockers)?inspected.result.blockers.filter((code:unknown):code is string=>typeof code==='string').slice(0,10):[]};
  const plan = planFor(scope,inspected);
  if ('mode' in plan && plan.mode) return {...view,status:'ready',code:'check_ready',plan:plan as MenuRecoveryView['plan']};
  return {...view,status:'blocked',code:plan.code};
}

async function requireDevice(scope: Row) {
  const devices = await sql`select id::text,last_seen_at,health_status from local_bridge_devices where store_id::text=${scope.storeId} and platform='desktop' and is_enabled=true`;
  if (devices.length!==1) fail('device_selection_required');
  if (!devices[0].last_seen_at || Date.now()-time(devices[0].last_seen_at)>120000) fail('bridge_offline');
  if (record(devices[0].health_status).menuSyncRecoveryVersion!==1) fail('bridge_update_required');
  return String(devices[0].id);
}

export async function startMenuRecovery(input:{brandId:string;jobId:string;action:MenuRecoveryAction;inspectionId?:string;token?:string;actorId:string}) {
  const initial = await loadMenuRecoveryScope(input.brandId,input.jobId);
  await withInventoryOperationLock(initial.storeId,async()=>{
    const scope = await loadMenuRecoveryScope(input.brandId,input.jobId), block = scopeBlock(scope); if (block) fail(block);
    const deviceId = await requireDevice(scope);
    const previous = scope.recoveries.find((row:Row)=>['pending','processing'].includes(status(row)));
    if (previous) return;
    let inspected: Row|undefined, plan: ReturnType<typeof planFor>|undefined;
    if (input.action!=='inspect') {
      inspected = scope.recoveries.find((row:Row)=>row.id===input.inspectionId && row.payload.recovery.requestedAction==='inspect');
      if (!inspected) return fail('inspection_expired');
      plan = planFor(scope,inspected);
      if (!('mode' in plan) || plan.mode!==input.action || plan.token!==input.token) fail('state_changed');
      const active = await sql`select id from local_bridge_commands where store_id::text=${scope.storeId} and status in ('pending','processing') limit 1`;
      if (active.length) fail('busy');
    }
    const mode = input.action==='retry'?'inspect':input.action;
    const release = mode==='verify_release'?releaseCandidate(scope):null;
    if (mode==='verify_release'&&!release) fail('state_changed');
    const payload = {...scope.payload,recovery:{version:1,mode,requestedAction:input.action,deviceId,failedJobId:scope.id,failedJobError:scope.originalError,
      sourceKey:scope.target.sourceKey,externalId:scope.mapping.externalId,externalParentId:String(scope.mapping.externalParentId??''),
      snapshot:scope.snapshot,requestedBy:input.actorId,
      ...(inspected?{inspectionId:inspected.id,inspectionResult:recoveryNative(inspected.result)}:{}),
      ...(release?{inventoryTargets:[release.target]}:{}),
      ...(input.action!=='inspect'?{guard:{revision:Number(scope.revision),checkedAt:Date.now(),
        ...(mode==='restore_hidden'?{holdActive:true}:{}),...(release?{expectedAvailable:true,releaseCommandId:release.command.id}:{})}}:{})}};
    const id = randomUUID();
    await sql.transaction([
      sql`select lock_menu_uber_revision(${scope.sourceId},${Number(scope.revision)})`,
      sql`select 1/count(*)::int from local_bridge_commands where id::text=${scope.id} and status='failed' and updated_at=${scope.updatedAt}::timestamptz and payload=${JSON.stringify(scope.payload)}::jsonb`,
      sql`insert into local_bridge_commands(id,store_id,platform,command_type,idempotency_key,payload)
        values(${id},${scope.storeId},${scope.platform},${input.action==='inspect'?'inspect_menu_sync':'repair_menu_sync'},${`menu-recovery:${scope.id}:${id}`},${JSON.stringify(payload)}::jsonb)`
    ]);
  });
  await publishBridgeCommandAvailable(initial.storeId).catch(()=>undefined);
  return menuRecoveryView(input.brandId,input.jobId);
}

export async function guardMenuRecoveryCommand(input:{commandId:string;storeId:string;deviceId:string}, writeGuard=false) {
  const rows = await sql`select id::text,payload,status,created_at::text as "createdAt",claim_expires_at::text as "claimExpiresAt" from local_bridge_commands
    where id::text=${input.commandId} and store_id::text=${input.storeId} and command_type in ('inspect_menu_sync','repair_menu_sync')
      and status='processing' and claimed_by_device_id::text=${input.deviceId} and claim_expires_at>now()`;
  if (rows.length!==1) return fail('state_changed');
  const command = rows[0] as Row, recovery = record(command.payload.recovery);
  if (recovery.deviceId!==input.deviceId) fail('device_selection_required');
  const scope = await loadMenuRecoveryScope(String(command.payload.brandId),String(recovery.failedJobId));
  const block = scopeBlock(scope); if (block) fail(block);
  if (scope.snapshot!==recovery.snapshot || command.payload.sourceId!==scope.sourceId || command.payload.platformKey!==scope.platform) fail('state_changed');
  if (recovery.requestedAction!=='inspect') {
    const original = scope.recoveries.find((row:Row)=>row.id===recovery.inspectionId);
    if (!original || !inspectionValid(original,scope)) fail('inspection_expired');
    const plan = planFor(scope,original);
    if (!('mode' in plan) || plan.mode!==recovery.requestedAction) fail('state_changed');
    if (Date.now()-Number(recovery.guard?.checkedAt)>120000) fail('inspection_expired');
  }
  if (writeGuard && (recovery.mode!=='restore_hidden' || scope.hold?.availability!=='unavailable' || inventoryBlock(scope))) fail('hold_conflict');
  return {command,scope};
}

export async function acknowledgeMenuRecovery(input:{commandId:string;storeId:string;deviceId:string;status:string;result:Row;error:string}) {
  const inputStatus = input.status;
  if (inputStatus==='failed') {
    const failed = await sql`update local_bridge_commands set status='failed',last_error=${input.error.slice(0,1000)},completed_at=now(),updated_at=now()
      where id::text=${input.commandId} and store_id::text=${input.storeId} and command_type in ('inspect_menu_sync','repair_menu_sync')
        and status='processing' and claimed_by_device_id::text=${input.deviceId} returning id`;
    if (!failed.length) fail('state_changed');
    return {ok:true,queued:false};
  }
  let queued=false,brandId='',jobId='';
  await withInventoryOperationLock(input.storeId,async()=>{
    const {command,scope} = await guardMenuRecoveryCommand(input);
    brandId=scope.brandId;jobId=scope.id;
    if (inputStatus!=='succeeded') fail('state_changed');
    if (!validRecoveryEnvelope(input.result,command.payload) || (command.payload.recovery.requestedAction!=='inspect'&&!validRecoveryInspection(input.result,command.payload))) fail('native_identity_unverified');
    const native = record(input.result.inspection), recovery = record(command.payload.recovery), blockers = input.result.blockers;
    const inspectedAt = Number(input.result.inspectedAt);
    if (!Number.isSafeInteger(inspectedAt) || inspectedAt>Date.now()+5000 || Date.now()-inspectedAt>120000 || inspectedAt<time(command.payload.recovery.guard?.checkedAt??command.createdAt)-5000) fail('inspection_expired');
    const result: Row = {...input.result,capturedAt:new Date(inspectedAt).toISOString()};
    if (recovery.requestedAction==='inspect') {
      if(result.changed!==0||!['inspected','blocked'].includes(String(result.outcome)))fail('recovery_blocked');
      await sql`update local_bridge_commands set status='succeeded',result=${JSON.stringify(result)}::jsonb,last_error='',completed_at=now(),updated_at=now()
        where id::text=${input.commandId} and status='processing' and claimed_by_device_id::text=${input.deviceId}`;
      return;
    }
    if (!Array.isArray(blockers) || blockers.length) fail('recovery_blocked');
    if (recovery.requestedAction==='retry'&&(result.outcome!=='inspected'||result.changed!==0))fail('recovery_blocked');
    if (recovery.mode==='restore_hidden'&&!(result.outcome==='restored_hidden'&&result.changed===1||result.outcome==='already_hidden'&&result.changed===0))fail('recovery_blocked');
    if (recovery.mode==='verify_release' ? native.isAvailable!==true || native.hidden!==false || result.outcome!=='verified_release' || result.changed!==0
      : native.hidden!==true || native.isAvailable!==false || ![0,1].includes(result.changed)) fail('recovery_blocked');
    let config = scope.config;
    if (recovery.mode==='verify_release') {
      const {validateMenuRecoveryHoldReleaseAcknowledgement} = await import('./uber-creation-hold-releases');
      const proof = await validateMenuRecoveryHoldReleaseAcknowledgement({commandId:input.commandId,storeId:scope.storeId,platform:scope.platform,payload:command.payload,result});
      config = structuredClone(scope.config);
      const platform = record(config[scope.platform]);
      const releases = Array.isArray(platform.creationHoldReleases)?platform.creationHoldReleases:[];
      platform.creationHoldReleases=[...releases.filter((entry:Row)=>entry.sourceKey!==scope.target.sourceKey||entry.externalId!==scope.mapping.externalId),proof];
      if (platform.creationHoldReleases.length>50) fail('recovery_blocked');
      config[scope.platform]=platform;
    }
    await sql.transaction([
      sql`select lock_menu_uber_revision(${scope.sourceId},${Number(scope.revision)})`,
      sql`select 1/count(*)::int from menu_uber_sources where id::text=${scope.sourceId} and publish_config=${JSON.stringify(scope.config)}::jsonb`,
      ...(config!==scope.config?[sql`update menu_uber_sources set publish_config=${JSON.stringify(config)}::jsonb,updated_at=now() where id::text=${scope.sourceId}`]:[]),
      sql`update local_bridge_commands set status='succeeded',result=${JSON.stringify(result)}::jsonb,last_error='',completed_at=now(),updated_at=now()
        where id::text=${input.commandId} and status='processing' and claimed_by_device_id::text=${input.deviceId}`
    ]);
    // Native verification is already durable. A continuation failure must stay
    // visible without turning a completed native action into an uncertain retry.
    let continuation: Awaited<ReturnType<typeof reconcileUberPublications>>;
    try {
      continuation = await reconcileUberPublications({sourceId:scope.sourceId,storeId:scope.storeId,revision:Number(scope.revision),mode:'manual',jobId:scope.id});
    } catch {
      continuation = {queued:0,blocked:[{code:'continuation_unavailable'}]} as Awaited<ReturnType<typeof reconcileUberPublications>>;
    }
    queued = continuation.queued===1;
    await sql`update local_bridge_commands set result=result||${JSON.stringify(queued?{continuationId:scope.id}:{continuationBlocked:continuation.blocked.map(row=>row.code).slice(0,2)})}::jsonb,updated_at=now() where id::text=${input.commandId} and status='succeeded'`;
  });
  if (queued) await publishBridgeCommandAvailable(input.storeId).catch(()=>undefined);
  return {ok:true,brandId,jobId,queued};
}
