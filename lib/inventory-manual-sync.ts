import { createHash, randomUUID } from "node:crypto";
import { sql } from "./db";
import { inventoryPlatformExternalIds, loadInventoryPlatformExternalIdMap,loadDemaeStagingHints } from "./inventory-platform-object-mappings";
import { assertNoWholeStoreSync, withInventoryOperationLock } from "./inventory-operation-lock";
import { inventoryReferencePlatform, validateUberAvailability, type AuditTarget, type InventoryReferencePlatform } from "./inventory-authority-policy";
import { publishBridgeCommandAvailable } from "./local-bridge-realtime";
import {buildInventoryComparison, type ComparisonCommand} from './inventory-comparison';
import {loadUberOptionPlacements} from './uber-option-placement-store';
import {authorityPhysicalId} from '../desktop-bridge/src/uber-authority-parents.mjs';

export type InventorySyncConfirmationOptions = {referencePlatform?:string;previewRevision?:string;acknowledgeInventoryConflicts?:boolean};
type ReferenceConflict = {kind:string;targetId:string;label:string;reason:string;platform?:string};
type SyncDetails = Record<string,any>;
const platformLabel = (platform:string) => ({uber_eats:'Uber',rocket_now:'Rocket Now',demae_can:'出前館'}[platform]??platform);
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const comparisonFingerprint=(commands:ComparisonCommand[])=>fingerprint([...commands].sort((a,b)=>a.platform.localeCompare(b.platform)));

async function comparisonCommandsForRun(storeId:string,runId:string) {
  return await sql`select platform,status,payload,result,updated_at::text as "updatedAt" from local_bridge_commands
    where store_id=${storeId} and payload->>'fullSyncRunId'=${runId} and payload->>'comparisonAudit'='true'` as ComparisonCommand[];
}

async function assertUberSnapshotUnchanged(storeId:string,runId:string,details:SyncDetails) {
  const reads=await sql`select status,payload,result from local_bridge_commands where store_id=${storeId}
    and platform='uber_eats' and command_type='audit_inventory' and payload->>'fullSyncRunId'=${runId}
    and coalesce(payload->>'comparisonAudit','false')<>'true'`;
  if(reads.length!==1||reads[0].status!=='succeeded'
    ||fingerprint({targets:reads[0].payload?.targets,result:reads[0].result})!==fingerprint(details.snapshot)) {
    throw new Error('読取結果が変更されました。最新の内容を確認してください。');
  }
}

function assertPreview(details:SyncDetails) {
  const previewAt=String(details.previewAt??'');
  if(details.osApplied===true||details.phase!=='awaiting_confirmation'||!previewAt
    ||!Number.isFinite(Date.parse(previewAt))||Date.now()-Date.parse(previewAt)>=10*60*1000||Date.parse(previewAt)>Date.now()) {
    throw new Error('プレビューの有効期限（10分）が切れたか、適用済みです。再読み取りしてください。');
  }
  return previewAt;
}

async function assertUnchangedPreview(storeId:string,runId:string,previewAt:string) {
  const changed=await sql`select 1 where exists (
    select 1 from menu_store_settings where store_id=${storeId} and updated_at>${previewAt}::timestamptz
    union all select 1 from menu_option_store_settings where store_id=${storeId} and updated_at>${previewAt}::timestamptz
    union all select 1 from menu_inventory_availability_blocks where store_id=${storeId} and updated_at>${previewAt}::timestamptz
    union all select 1 from menu_platform_availability_settings where store_id=${storeId} and updated_at>${previewAt}::timestamptz
    union all select 1 from menu_inventory_sync_runs where store_id=${storeId} and id<>${runId} and created_at>${previewAt}::timestamptz
    union all select 1 from local_bridge_commands where store_id=${storeId} and status in ('pending','processing')
      and command_type in ('set_inventory_availability','audit_inventory','publish_menu_changes','capture_menu_snapshot')
    union all select 1 from local_bridge_commands where store_id=${storeId} and created_at>${previewAt}::timestamptz
      and command_type in ('publish_menu_changes','capture_menu_snapshot')
  )`;
  if(changed.length)throw new Error('読取後に販売状態が変更されたか、別の同期が実行中です。完了後に再読み取りしてください。');
}

function sameIds(left:string[],right:string[]) {
  return left.length>0&&left.length===right.length&&new Set(left).size===left.length&&new Set(right).size===right.length
    &&left.every(id=>typeof id==='string'&&right.includes(id));
}

async function assertReferenceAudit(storeId:string,referencePlatform:InventoryReferencePlatform,details:SyncDetails,commands:ComparisonCommand[]) {
  if(referencePlatform==='uber_eats')return;
  const matches=commands.filter(c=>c.platform===referencePlatform&&c.payload?.comparisonAudit===true);
  const command=matches.length===1?matches[0]:undefined;
  const targets=command?.payload?.targets as AuditTarget[]|undefined;
  const items=command?.result?.items as Array<Record<string,any>>|undefined;
  if(command?.status!=='succeeded'||!Array.isArray(targets)||!Array.isArray(items)||command.result?.targetCount!==targets.length
    ||items.length!==targets.length||new Set(targets.map(t=>`${t.kind}:${t.targetId}`)).size!==targets.length) {
    throw new Error('基準プラットフォームの読取結果が未確認です。再読み取りしてください。');
  }
  for(const value of [command.updatedAt,command.result?.capturedAt]) {
    const time=typeof value==='string'?Date.parse(value):NaN;
    if(!Number.isFinite(time)||time>Date.now()||Date.now()-time>=10*60*1000) {
      throw new Error('基準プラットフォームの読取結果が古いか不明です。全プラットフォームを再読み取りしてください。');
    }
  }
  const merchantScopes=referencePlatform==='demae_can'?await sql`select brand_id::text as "brandId",
    publish_config->'demae_can'->>'merchantId' as "merchantId" from menu_uber_sources where store_id=${storeId} and enabled=true`:[];
  for(const target of targets) {
    const source=(details.snapshot?.targets as AuditTarget[]??[]).filter(t=>t.kind===target.kind&&t.targetId===target.targetId);
    const actual=items.filter(t=>t.kind===target.kind&&t.targetId===target.targetId);
    if(source.length!==1||source[0].brandId!==target.brandId||actual.length!==1)throw new Error('基準プラットフォームの商品対応が不明です。');
    const row=actual[0];
    if(referencePlatform==='demae_can'&&row.found===true&&row.status==='staged'&&row.isAvailable===null&&row.stagingVerified===true)continue;
    const basis=row.nativeMatchBasis;
    const observations=row.nativeObservations as Array<Record<string,unknown>>;
    let nativeProof=false;
    try {
      const expected=target.knownExternalIds.flatMap(id=>id.split(',').map(value=>value.trim()).filter(Boolean));
      const scopes=(command.payload?.demaeStaging??[]) as Array<Record<string,any>>;
      const relevantScopes=scopes.filter(scope=>Array.isArray(scope.graph)&&scope.graph.some((node:Record<string,unknown>)=>node.kind===target.kind&&node.targetId===target.targetId));
      if(referencePlatform==='demae_can'&&relevantScopes.some(scope=>scope.storeId!==storeId))throw new Error('merchant_scope_unproven');
      const merchants=referencePlatform==='demae_can'?[...new Set(merchantScopes.filter(scope=>scope.brandId===target.brandId).map(scope=>String(scope.merchantId??'')))]:[''];
      if(referencePlatform==='demae_can'&&(merchants.length!==1||!merchants[0]))throw new Error('merchant_scope_unproven');
      const merchant=merchants[0];
      if(referencePlatform==='demae_can'&&relevantScopes.some(scope=>String(scope.merchantId)!==merchant))throw new Error('merchant_scope_unproven');
      const physical=(id:string)=>String(authorityPhysicalId(referencePlatform,target.kind,id,merchant));
      const expectedPhysical=[...new Set(expected.map(physical))];
      const actual=Array.isArray(row.externalIds)?row.externalIds as string[]:[];
      const observedIds=Array.isArray(observations)?observations.map(o=>String(o.externalId??'')):[];
      nativeProof=expected.length>0&&actual.length===observedIds.length&&sameIds(actual,observedIds)
        &&sameIds(expectedPhysical,[...new Set(actual.map(physical))])
        &&(referencePlatform!=='demae_can'||sameIds(expected,actual))
        &&(referencePlatform==='rocket_now'||basis==='native_stock'
          ?observations.every(o=>o.physicalId===physical(String(o.externalId)))
          :sameIds(expected,actual)&&observations.every(o=>o.physicalId===undefined||o.physicalId===physical(String(o.externalId))));
    } catch { /* Invalid/foreign IDs cannot authorize any availability writes. */ }
    if(row.found!==true||typeof row.isAvailable!=='boolean'||row.status!==(row.isAvailable?'available':'sold_out')
      ||!['external_id',...(referencePlatform==='demae_can'?['native_stock']:[])].includes(basis)
      ||!nativeProof||!Array.isArray(observations)||!Array.isArray(row.externalIds)
      ||observations.some(o=>o.found!==true||o.isAvailable!==row.isAvailable||o.matchBasis!==basis)) {
      throw new Error('基準プラットフォームの全商品対応・販売状態を確認できません。再読み取りしてください。');
    }
  }
}

async function assertReferenceMappings(storeId:string,details:SyncDetails,commands:ComparisonCommand[],referencePlatform:InventoryReferencePlatform) {
  const enabled=await sql`select 1 from store_sales_sources where store_id=${storeId} and source_platform=${referencePlatform} and is_enabled=true`;
  if(!enabled.length)throw new Error('基準プラットフォームの連携設定が変更されました。再読み取りしてください。');
  const source=details.snapshot?.targets as AuditTarget[];
  if(referencePlatform!=='uber_eats') {
    const exclusions=await comparisonExclusions(storeId);
    const previous=(details.comparisonExclusions??[]) as Array<{platform:string;kind:string;targetId:string}>;
    for(const target of source) {
      const excluded=(entries:typeof previous)=>target.label.includes('こちら商品ではありません')
        ||entries.some(entry=>entry.platform===referencePlatform&&entry.kind===target.kind&&entry.targetId===target.targetId);
      if(excluded(exclusions)!==excluded(previous))throw new Error('基準プラットフォームの連携設定が変更されました。再読み取りしてください。');
    }
  }
  const mappings=await loadInventoryPlatformExternalIdMap(storeId,source);
  const readTargets=referencePlatform==='uber_eats'?source:commands.find(c=>c.platform===referencePlatform)?.payload?.targets as AuditTarget[];
  for(const target of readTargets??[])if(!sameIds(target.knownExternalIds,inventoryPlatformExternalIds(mappings,referencePlatform,target))) {
    throw new Error('商品対応が読取後に変更されました。再読み取りしてください。');
  }
  return mappings;
}

async function referenceConflicts(storeId:string,comparison:ReturnType<typeof buildInventoryComparison>):Promise<ReferenceConflict[]> {
  const targets=comparison.rows.filter(r=>r.referenceAvailable!==null&&r.changes.length);
  if(!targets.length)return [];
  const rows=await sql`with requested as (select * from jsonb_to_recordset(${JSON.stringify(targets.map(t=>({kind:t.kind,targetId:t.targetId,platforms:t.changes.filter(p=>p!=='foundr1')})))}::jsonb) as t(kind text,"targetId" uuid,platforms jsonb))
    select b.target_kind as kind,b.target_id::text as "targetId",'inventory_block' as reason,null::text as platform
    from menu_inventory_availability_blocks b join requested t on t.kind=b.target_kind and t."targetId"=b.target_id where b.store_id=${storeId}
    union select s.target_kind,s.target_id::text,'platform_override',s.platform from menu_platform_availability_settings s
    join requested t on t.kind=s.target_kind and t."targetId"=s.target_id where s.store_id=${storeId} and t.platforms ? s.platform`;
  return rows.map(row=>({kind:String(row.kind),targetId:String(row.targetId),label:targets.find(t=>t.kind===row.kind&&t.targetId===row.targetId)?.label??'',reason:String(row.reason),...(row.platform?{platform:String(row.platform)}:{})}));
}

export async function setInventorySyncReference(storeId:string,runId:string,referencePlatform:string,expectedPreviewRevision:string) {
  const reference=inventoryReferencePlatform(referencePlatform);
  return withInventoryOperationLock(storeId,async()=>{
    const runs=await sql`select details from menu_inventory_sync_runs where id=${runId} and store_id=${storeId}
      and run_type='full_sync' and details->>'authority'='uber_eats'`;
    const details=runs[0]?.details as SyncDetails|undefined;
    if(!details?.snapshot)throw new Error('先に Uber を読み取り、変更内容を確認してください。');
    const previewAt=assertPreview(details);
    if(!expectedPreviewRevision||details.previewRevision!==expectedPreviewRevision)throw new Error('プレビューが変更されました。最新の内容を確認してください。');
    validateUberAvailability(details.snapshot.targets,details.snapshot.result);
    const commands=await comparisonCommandsForRun(storeId,runId);
    const comparison=buildInventoryComparison({...details,referencePlatform:reference},commands);
    if(!comparison.ready)throw new Error('各プラットフォームの状態が未確認、または基準にできる商品がありません。再読み取りしてください。');
    await assertUnchangedPreview(storeId,runId,previewAt);
    await assertUberSnapshotUnchanged(storeId,runId,details);
    await assertReferenceAudit(storeId,reference,details,commands);
    await assertReferenceMappings(storeId,details,commands,reference);
    const conflicts=await referenceConflicts(storeId,comparison);
    const previewRevision=randomUUID();
    const patch={referencePlatform:reference,previewRevision,referenceConflicts:conflicts,
      referenceSelectionChanged:details.referenceSelectionChanged===true||reference!=='uber_eats',
      comparisonSnapshotFingerprint:comparisonFingerprint(commands),
      referenceReadAt:reference==='uber_eats'?details.previewAt:commands.find(c=>c.platform===reference)?.updatedAt,
      referencePreview:comparison.rows.map(r=>({kind:r.kind,targetId:r.targetId,label:r.label,referenceAvailable:r.referenceAvailable,changes:r.changes})),referenceSkippedCount:comparison.referenceSkippedCount};
    const updated=await sql`update menu_inventory_sync_runs set details=details || ${JSON.stringify(patch)}::jsonb
      where id=${runId} and store_id=${storeId} and details=${JSON.stringify(details)}::jsonb returning id`;
    if(!updated.length)throw new Error('プレビューが変更されました。最新の内容を確認してください。');
    return {referencePlatform:reference,previewRevision,referenceConflicts:conflicts,referenceSkippedCount:comparison.referenceSkippedCount};
  });
}

async function comparisonExclusions(storeId:string) {
 const rows=await sql`select p.platform_key as platform,s.target_type as kind,s.target_id::text as "targetId"
 from menu_platform_target_settings s join menu_external_platforms p on p.id=s.external_platform_id
 join store_brands b on b.brand_id=s.brand_id and b.store_id=${storeId}
 where s.is_enabled=false and (s.store_id is null or s.store_id=${storeId})
 union select config.key,o.kind,o.target_id::text from menu_uber_sources s join menu_uber_objects o on o.source_id=s.id
 cross join lateral jsonb_each(s.publish_config) config where s.enabled=true and s.store_id=${storeId} and o.archived=false
 and (coalesce(config.value->'quarantinedSourceKeys','[]'::jsonb) ? o.source_key or coalesce(config.value->'excludedSourceKeys','[]'::jsonb) ? o.source_key)`;
 return [...rows.map(row=>({platform:String(row.platform),kind:String(row.kind),targetId:String(row.targetId)})),
   ...(await loadUberOptionPlacements(storeId)).map(a=>({platform:a.platform,kind:'option',targetId:a.targetId}))];
}

export async function startUberAvailabilitySync(storeId: string, targets: Omit<AuditTarget, "knownExternalIds">[], requestedBy: string) {
  return withInventoryOperationLock(storeId, async () => {
    await assertNoWholeStoreSync(storeId);
    const busy = await sql`select id from local_bridge_commands where store_id=${storeId}
      and command_type in ('set_inventory_availability','audit_inventory','publish_menu_changes','capture_menu_snapshot')
      and status in ('pending','processing') limit 1`;
    if (busy.length) throw new Error("別のメニュー・販売状態同期が実行中です。同期履歴で完了を確認してください。");
    const enabled = await sql`select 1 from store_sales_sources where store_id=${storeId}
      and source_platform='uber_eats' and is_enabled=true`;
    if (!enabled.length) throw new Error("この店舗の Uber 連携が有効ではありません。");
    const mappings = await loadInventoryPlatformExternalIdMap(storeId, targets);
    const mapped = targets.map(t => ({ ...t, knownExternalIds: inventoryPlatformExternalIds(mappings, 'uber_eats', t) }));
    const auditTargets = mapped.filter(t => t.knownExternalIds.length);
    const excluded = mapped.filter(t => !t.knownExternalIds.length).map(t => ({ kind:t.kind, targetId:t.targetId, label:t.label }));
    if (!auditTargets.length) throw new Error("Uber と対応する商品がありません。OS で先にメニューを読み取ってください。");
    const runId = randomUUID();
    const commandId = randomUUID();
    const destinations=await sql`select distinct source_platform as platform from store_sales_sources where store_id=${storeId} and is_enabled=true and source_platform in ('rocket_now','demae_can')`;
    const policy=await comparisonExclusions(storeId);
    const comparisonPlatforms=destinations.map(p=>String(p.platform));
    const comparisonExcluded=comparisonPlatforms.flatMap(platform=>auditTargets.filter(t=>t.label.includes('こちら商品ではありません')||policy.some(p=>p.platform===platform&&p.kind===t.kind&&p.targetId===t.targetId)).map(t=>({platform,kind:t.kind,targetId:t.targetId})));
    const destinationCommands=comparisonPlatforms.map(platform=>({platform,targets:auditTargets.filter(t=>!comparisonExcluded.some(e=>e.platform===platform&&e.kind===t.kind&&e.targetId===t.targetId)).map(t=>({...t,knownExternalIds:inventoryPlatformExternalIds(mappings,platform,t)})).filter(t=>t.knownExternalIds.length)}));
    const demaeStaging=comparisonPlatforms.includes('demae_can')?await loadDemaeStagingHints(storeId):[];
    await sql.transaction([
      sql`insert into menu_inventory_sync_runs (id,store_id,run_type,action,item_label,inventory_key,source,requested_by,details)
        values (${runId},${storeId},'full_sync','full_sync','Uber 基準の全店手動同期',${`full-sync:${runId}`},'store',${requestedBy},
          ${JSON.stringify({authority:'uber_eats',referencePlatform:'uber_eats',phase:'reading_uber',targetCount:auditTargets.length,excluded,comparisonVersion:1,comparisonPlatforms,comparisonExclusions:comparisonExcluded})}::jsonb)`,
      sql`insert into local_bridge_commands (id,store_id,platform,command_type,idempotency_key,payload)
        values (${commandId},${storeId},'uber_eats','audit_inventory',${`uber-full-sync:${runId}`},
          ${JSON.stringify({availabilityAuthority:'uber_eats',fullSyncRunId:runId,targets:auditTargets})}::jsonb)`,
      ...destinationCommands.map(c=>sql`insert into local_bridge_commands (id,store_id,platform,command_type,idempotency_key,payload)
        values (${randomUUID()},${storeId},${c.platform},'audit_inventory',${`comparison:${runId}:${c.platform}`},${JSON.stringify({availabilityAuthority:'uber_eats',comparisonAudit:true,fullSyncRunId:runId,targets:c.targets,...(c.platform==='demae_can'?{demaeStaging}:{})})}::jsonb)`)
    ]);
    await publishBridgeCommandAvailable(storeId).catch(() => undefined);
    return {runId,commandId,targetCount:auditTargets.length,excluded};
  });
}

export async function confirmUberAvailabilitySync(storeId: string, runId: string, options?:InventorySyncConfirmationOptions) {
  const rows = await sql`select details from menu_inventory_sync_runs where id=${runId} and store_id=${storeId}
    and details->>'authority'='uber_eats'`;
  const snapshot = rows[0]?.details?.snapshot;
  if (!snapshot) throw new Error('先に Uber を読み取り、変更内容を確認してください。');
  return applyUberAvailabilitySync(storeId, {fullSyncRunId:runId,targets:snapshot.targets}, snapshot.result, true, options);
}

export async function applyUberAvailabilitySync(storeId: string, payload: Record<string, unknown>, result: Record<string, unknown>, confirmed = false, options?:InventorySyncConfirmationOptions) {
  return withInventoryOperationLock(storeId, async () => {
    const runId = String(payload.fullSyncRunId);
    const runs = await sql`select details from menu_inventory_sync_runs where id=${runId} and store_id=${storeId}
      and run_type='full_sync' and details->>'authority'='uber_eats'`;
    if (!runs.length) throw new Error("全店同期の実行記録がありません。");
    const details=runs[0].details as SyncDetails;
    const reference=inventoryReferencePlatform(details.referencePlatform??'uber_eats');
    if(confirmed) {
      if(!options&&(reference!=='uber_eats'||details.referenceSelectionChanged===true)||options&&(options.referencePlatform!==reference||!options.previewRevision||options.previewRevision!==details.previewRevision)) {
        throw new Error('基準またはプレビューが変更されました。最新の内容を確認してください。');
      }
      if(details.snapshot&&(JSON.stringify(details.snapshot.targets)!==JSON.stringify(payload.targets)||JSON.stringify(details.snapshot.result)!==JSON.stringify(result))) {
        throw new Error('読取結果が変更されました。最新の内容を確認してください。');
      }
    }
    // A repeated acknowledgement must never overwrite a newer Store action.
    if (details.osApplied === true) return {updatedCount:Number(details.targetCount),missingCount:0};
    const uberAudited = validateUberAvailability(payload.targets as AuditTarget[], result);
    if (!confirmed) {
      if (runs[0].details?.phase === 'awaiting_confirmation') return {updatedCount:0,missingCount:0};
      const current = await sql`select 'item' as kind,i.id::text as "targetId",coalesce(s.is_available,true) as available
        from menu_catalog_items i join store_brands b on b.brand_id=i.brand_id and b.store_id=${storeId}
        left join menu_store_settings s on s.menu_catalog_item_id=i.id and s.store_id=${storeId}
        union all select 'option',o.id::text,coalesce(s.is_available,true)
        from menu_options o join menu_option_groups g on g.id=o.option_group_id join store_brands b on b.brand_id=g.brand_id and b.store_id=${storeId}
        left join menu_option_store_settings s on s.menu_option_id=o.id and s.store_id=${storeId}`;
      const preview=uberAudited.map(t=>({kind:t.kind,targetId:t.targetId,label:t.label,isAvailable:t.isAvailable,
        wasAvailable:current.find(row=>row.kind===t.kind&&row.targetId===t.targetId)?.available??null}));
      await sql`update menu_inventory_sync_runs set details=details || ${JSON.stringify({phase:'awaiting_confirmation',
        referencePlatform:'uber_eats',previewRevision:randomUUID(),referenceConflicts:[],preview,previewAt:new Date().toISOString(),snapshot:{targets:payload.targets,result}})}::jsonb where id=${runId} and store_id=${storeId}`;
      return {updatedCount:0,missingCount:0};
    }
    const previewAt=assertPreview(details);
    const comparisonCommands=await comparisonCommandsForRun(storeId,runId);
    const comparison=buildInventoryComparison(details,comparisonCommands);
    if(!comparison.ready)throw new Error('各プラットフォームの状態が未確認です。全プラットフォームを再読み取りしてください。');
    await assertUnchangedPreview(storeId,runId,previewAt);
    if(details.snapshot)await assertUberSnapshotUnchanged(storeId,runId,details);
    if(details.comparisonSnapshotFingerprint&&details.comparisonSnapshotFingerprint!==comparisonFingerprint(comparisonCommands)) {
      throw new Error('基準またはプレビューが変更されました。最新の内容を確認してください。');
    }
    await assertReferenceAudit(storeId,reference,details,comparisonCommands);
    const mappings=await assertReferenceMappings(storeId,{...details,snapshot:details.snapshot??{targets:payload.targets,result}},comparisonCommands,reference);
    const audited=uberAudited.flatMap(t=>{
      const row=comparison.rows.find(r=>r.kind===t.kind&&r.targetId===t.targetId);
      return typeof row?.referenceAvailable==='boolean'?[{...t,isAvailable:row.referenceAvailable}]:[];
    });
    const conflicts=await referenceConflicts(storeId,comparison);
    if(reference!=='uber_eats'&&conflicts.length&&options?.acknowledgeInventoryConflicts!==true) {
      throw new Error('在庫保護・プラットフォーム別設定と競合しています。解除する対象を確認してください。');
    }
    const disabledRows = await sql`select p.platform_key as platform,s.target_type as kind,s.target_id::text as "targetId"
      from menu_platform_target_settings s join menu_external_platforms p on p.id=s.external_platform_id
      join store_brands b on b.brand_id=s.brand_id and b.store_id=${storeId}
      where s.is_enabled=false and (s.store_id is null or s.store_id=${storeId})`;
    const authorityExclusions = await comparisonExclusions(storeId);
    const enabled = await sql`select distinct source_platform as platform from store_sales_sources
      where store_id=${storeId} and is_enabled=true and source_platform in ('uber_eats','rocket_now','demae_can')`;
    const commands: Array<{id:string;platform:string;payload:Record<string,unknown>;error?:string}> = [];
    const excluded: Array<{platform:string;label:string;reason:string}> = [];
    for (const {platform} of enabled) {
      if(platform===reference)continue;
      if(platform!=='uber_eats'&&!comparison.platforms.includes(String(platform)))throw new Error('連携設定が読取後に変更されました。再読み取りしてください。');
      const platformTargets=audited.filter(t=>{
        if(comparison.rows.some(r=>r.kind===t.kind&&r.targetId===t.targetId&&r.cells[String(platform)]?.state==='staged'&&(!t.isAvailable||!r.cells[String(platform)].releaseReady))) {
          excluded.push({platform:String(platform),label:t.label,reason:'verified_unpublished_draft'});return false;
        }
        if(t.label.includes('こちら商品ではありません') || [...disabledRows, ...authorityExclusions].some(d=>d.platform===platform&&d.kind===t.kind&&d.targetId===t.targetId)) {
          excluded.push({platform:String(platform),label:t.label,reason:'excluded_from_platform'});return false;
        }
        return true;
      });
      const missing=platformTargets.filter(t=>!inventoryPlatformExternalIds(mappings,String(platform),t).length);
      const observedTargets=(platform==='uber_eats'?payload.targets:comparisonCommands.find(c=>c.platform===platform)?.payload?.targets??[]) as AuditTarget[];
      for(const target of platformTargets) {
        const observed=observedTargets.find(t=>t.kind===target.kind&&t.targetId===target.targetId);
        const ids=inventoryPlatformExternalIds(mappings,String(platform),target);
        if(!observed||JSON.stringify([...observed.knownExternalIds].sort())!==JSON.stringify([...ids].sort()))
          throw new Error('商品対応が読取後に変更されました。再読み取りしてください。');
      }
      if(missing.length) {
        commands.push({id:randomUUID(),platform:String(platform),error:`商品対応が未登録です。メニュー連携を修正して全店同期を再実行してください: ${missing.map(t=>t.label).join('、')}`,
          payload:{availabilityAuthority:'uber_eats',fullSyncRunId:runId,syncSource:'store',mappingBlocked:true,
            inventoryKey:`full-sync:${runId}:${platform}:mapping-blocked`,targets:missing}});
        continue;
      }
      for (const isAvailable of [false,true]) {
        const targets = platformTargets.filter(t => t.isAvailable === isAvailable && comparison.rows.some(r=>r.kind===t.kind&&r.targetId===t.targetId&&r.changes.includes(String(platform)))).flatMap(t => {
          const ids = inventoryPlatformExternalIds(mappings,String(platform),t);
          const read=(platform==='uber_eats'?result.items:comparisonCommands.find(c=>c.platform===platform)?.result?.items??[]) as Array<Record<string,unknown>>;
          const observed=read.find(r=>r.kind===t.kind&&r.targetId===t.targetId);
          return [{...t,knownExternalIds:ids,...(observed?.status==='staged'&&isAvailable?{releasePlan:observed.releasePlan}:{})}];
        });
        for (let offset=0;offset<targets.length;offset+=20) {
          commands.push({id:randomUUID(),platform:String(platform),payload:{
            availabilityAuthority:'uber_eats',referencePlatform:reference,previewRevision:details.previewRevision,fullSyncRunId:runId,syncSource:'store',
            inventoryKey:`full-sync:${runId}:${platform}:${isAvailable}:${offset}`,
            ingredientLabel:`${platformLabel(reference)} 基準の全店手動同期`,feedbackLabel:`${platformLabel(reference)} 基準の全店手動同期`,
            isAvailable,soldOutMode:'indefinite',
            verifyAvailability:true,
            operation:platform==='rocket_now'?(isAvailable?'unhide':'hide'):platform==='uber_eats'?(isAvailable?'available':'sold_out'):(isAvailable?'available':'stockout'),
            targets:targets.slice(offset,offset+20),
            ...(platform==='demae_can'?{demaeStaging:comparisonCommands.find(c=>c.platform===platform)?.payload?.demaeStaging??[]}:{})
          }});
        }
      }
    }
    // Missing destination mappings must be made visible; never guess a name and unhide a staging object.
    const osChanges=audited.filter(t=>comparison.rows.some(r=>r.kind===t.kind&&r.targetId===t.targetId&&r.changes.includes('foundr1')));
    const data = JSON.stringify(osChanges);
    const blockConflicts=JSON.stringify(conflicts.filter(c=>c.reason==='inventory_block'));
    const overrideConflicts=JSON.stringify(conflicts.filter(c=>c.reason==='platform_override'));
    const note=`${platformLabel(reference)} 基準の全店手動同期`;
    await sql.transaction([
      // The operation lock serializes Store writers; this CAS also makes a
      // changed run receipt roll back every stock/queue write in this transaction.
      sql`select 1 / case when exists(select 1 from menu_inventory_sync_runs where id=${runId} and store_id=${storeId}
        and details=${JSON.stringify(details)}::jsonb) then 1 else 0 end as preview_guard`,
      sql`delete from menu_inventory_availability_blocks b using jsonb_to_recordset(${reference==='uber_eats'?data:blockConflicts}::jsonb) as t(kind text,"targetId" uuid)
        where b.store_id=${storeId} and b.target_kind=t.kind and b.target_id=t."targetId"`,
      sql`delete from menu_platform_availability_settings s using jsonb_to_recordset(${data}::jsonb) as t(kind text,"targetId" uuid)
        where ${reference==='uber_eats'} and s.store_id=${storeId} and s.target_kind=t.kind and s.target_id=t."targetId"`,
      sql`delete from menu_platform_availability_settings s using jsonb_to_recordset(${overrideConflicts}::jsonb) as t(kind text,"targetId" uuid,platform text)
        where ${reference!=='uber_eats'} and s.store_id=${storeId} and s.target_kind=t.kind and s.target_id=t."targetId" and s.platform=t.platform`,
      sql`insert into menu_store_settings (brand_id,store_id,menu_catalog_item_id,is_available,stock_status,status_note,updated_at)
        select i.brand_id,${storeId},i.id,t."isAvailable",case when t."isAvailable" then 'available' else 'unavailable' end,${note},now()
        from jsonb_to_recordset(${data}::jsonb) as t(kind text,"targetId" uuid,"isAvailable" boolean)
        join menu_catalog_items i on i.id=t."targetId" join store_brands b on b.brand_id=i.brand_id and b.store_id=${storeId}
        where t.kind='item' and i.is_active=true
        on conflict (store_id,menu_catalog_item_id) do update set is_available=excluded.is_available,stock_status=excluded.stock_status,status_note=excluded.status_note,updated_at=now()`,
      sql`insert into menu_option_store_settings (brand_id,store_id,menu_option_id,is_available,stock_status,status_note,updated_at)
        select g.brand_id,${storeId},o.id,t."isAvailable",case when t."isAvailable" then 'available' else 'unavailable' end,${note},now()
        from jsonb_to_recordset(${data}::jsonb) as t(kind text,"targetId" uuid,"isAvailable" boolean)
        join menu_options o on o.id=t."targetId" join menu_option_groups g on g.id=o.option_group_id
        join store_brands b on b.brand_id=g.brand_id and b.store_id=${storeId} where t.kind='option' and o.is_active=true and g.is_active=true
        on conflict (store_id,menu_option_id) do update set is_available=excluded.is_available,stock_status=excluded.stock_status,status_note=excluded.status_note,updated_at=now()`,
      ...commands.map(c => sql`insert into local_bridge_commands (id,store_id,platform,command_type,idempotency_key,payload,status,last_error)
        values (${c.id},${storeId},${c.platform},'set_inventory_availability',${String(c.payload.inventoryKey)},${JSON.stringify(c.payload)}::jsonb,${c.error?'failed':'pending'},${c.error??''})
        on conflict (idempotency_key) do nothing`),
      sql`update menu_inventory_sync_runs set details=details || ${JSON.stringify({osApplied:true,phase:'publishing',targetCount:audited.length,commandCount:commands.length,platformExclusions:excluded,referenceConflicts:conflicts,
        inventoryConflictsAcknowledged:reference!=='uber_eats'&&conflicts.length?options?.acknowledgeInventoryConflicts===true:false,referenceSkippedCount:comparison.referenceSkippedCount})}::jsonb
        where id=${runId} and store_id=${storeId}`
    ]);
    await publishBridgeCommandAvailable(storeId).catch(() => undefined);
    return {updatedCount:osChanges.length,missingCount:0};
  });
}
