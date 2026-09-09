import { randomUUID } from "node:crypto";
import { sql } from "./db";
import { inventoryPlatformExternalIds, loadInventoryPlatformExternalIdMap,loadDemaeStagingHints } from "./inventory-platform-object-mappings";
import { assertNoWholeStoreSync, withInventoryOperationLock } from "./inventory-operation-lock";
import { validateUberAvailability, type AuditTarget } from "./inventory-authority-policy";
import { publishBridgeCommandAvailable } from "./local-bridge-realtime";
import {buildInventoryComparison, type ComparisonCommand} from './inventory-comparison';

async function comparisonExclusions(storeId:string) {
 return sql`select p.platform_key as platform,s.target_type as kind,s.target_id::text as "targetId"
 from menu_platform_target_settings s join menu_external_platforms p on p.id=s.external_platform_id
 join store_brands b on b.brand_id=s.brand_id and b.store_id=${storeId}
 where s.is_enabled=false and (s.store_id is null or s.store_id=${storeId})
 union select config.key,o.kind,o.target_id::text from menu_uber_sources s join menu_uber_objects o on o.source_id=s.id
 cross join lateral jsonb_each(s.publish_config) config where s.enabled=true and s.store_id=${storeId} and o.archived=false
 and (coalesce(config.value->'quarantinedSourceKeys','[]'::jsonb) ? o.source_key or coalesce(config.value->'excludedSourceKeys','[]'::jsonb) ? o.source_key)`;
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
          ${JSON.stringify({authority:'uber_eats',phase:'reading_uber',targetCount:auditTargets.length,excluded,comparisonVersion:1,comparisonPlatforms,comparisonExclusions:comparisonExcluded})}::jsonb)`,
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

export async function confirmUberAvailabilitySync(storeId: string, runId: string) {
  const rows = await sql`select details from menu_inventory_sync_runs where id=${runId} and store_id=${storeId}
    and details->>'authority'='uber_eats'`;
  const snapshot = rows[0]?.details?.snapshot;
  if (!snapshot) throw new Error('先に Uber を読み取り、変更内容を確認してください。');
  return applyUberAvailabilitySync(storeId, {fullSyncRunId:runId,targets:snapshot.targets}, snapshot.result, true);
}

export async function applyUberAvailabilitySync(storeId: string, payload: Record<string, unknown>, result: Record<string, unknown>, confirmed = false) {
  return withInventoryOperationLock(storeId, async () => {
    const runId = String(payload.fullSyncRunId);
    const runs = await sql`select details from menu_inventory_sync_runs where id=${runId} and store_id=${storeId}
      and run_type='full_sync' and details->>'authority'='uber_eats'`;
    if (!runs.length) throw new Error("全店同期の実行記録がありません。");
    // A repeated acknowledgement must never overwrite a newer Store action.
    if (runs[0].details?.osApplied === true) return {updatedCount:Number(runs[0].details.targetCount),missingCount:0};
    const audited = validateUberAvailability(payload.targets as AuditTarget[], result);
    if (!confirmed) {
      if (runs[0].details?.phase === 'awaiting_confirmation') return {updatedCount:0,missingCount:0};
      const current = await sql`select 'item' as kind,i.id::text as "targetId",coalesce(s.is_available,true) as available
        from menu_catalog_items i join store_brands b on b.brand_id=i.brand_id and b.store_id=${storeId}
        left join menu_store_settings s on s.menu_catalog_item_id=i.id and s.store_id=${storeId}
        union all select 'option',o.id::text,coalesce(s.is_available,true)
        from menu_options o join menu_option_groups g on g.id=o.option_group_id join store_brands b on b.brand_id=g.brand_id and b.store_id=${storeId}
        left join menu_option_store_settings s on s.menu_option_id=o.id and s.store_id=${storeId}`;
      const preview=audited.map(t=>({kind:t.kind,targetId:t.targetId,label:t.label,isAvailable:t.isAvailable,
        wasAvailable:current.find(row=>row.kind===t.kind&&row.targetId===t.targetId)?.available??null}));
      await sql`update menu_inventory_sync_runs set details=details || ${JSON.stringify({phase:'awaiting_confirmation',
        preview,previewAt:new Date().toISOString(),snapshot:{targets:payload.targets,result}})}::jsonb where id=${runId} and store_id=${storeId}`;
      return {updatedCount:0,missingCount:0};
    }
    const previewAt=String(runs[0].details?.previewAt??'');
    const comparisonCommands=await sql`select platform,status,payload,result,updated_at::text as "updatedAt" from local_bridge_commands where store_id=${storeId} and payload->>'fullSyncRunId'=${runId} and payload->>'comparisonAudit'='true'`;
    const comparison=buildInventoryComparison(runs[0].details,comparisonCommands as ComparisonCommand[]);
    if(!comparison.ready)throw new Error('各プラットフォームの状態が未確認です。全プラットフォームを再読み取りしてください。');
    if(runs[0].details?.phase!=='awaiting_confirmation'||!previewAt||Date.now()-Date.parse(previewAt)>10*60*1000)
      throw new Error('プレビューの有効期限（10分）が切れました。Uber を再読み取りしてください。');
    const changed=await sql`select 1 where exists (
      select 1 from menu_store_settings where store_id=${storeId} and updated_at>${previewAt}::timestamptz
      union all select 1 from menu_option_store_settings where store_id=${storeId} and updated_at>${previewAt}::timestamptz
      union all select 1 from menu_inventory_availability_blocks where store_id=${storeId} and updated_at>${previewAt}::timestamptz
      union all select 1 from menu_platform_availability_settings where store_id=${storeId} and updated_at>${previewAt}::timestamptz
      union all select 1 from menu_inventory_sync_runs where store_id=${storeId} and id<>${runId} and created_at>${previewAt}::timestamptz
      union all select 1 from local_bridge_commands where store_id=${storeId} and status in ('pending','processing')
        and command_type in ('set_inventory_availability','audit_inventory','publish_menu_changes','capture_menu_snapshot')
    )`;
    if(changed.length) throw new Error('読取後に販売状態が変更されたか、別の同期が実行中です。完了後に Uber を再読み取りしてください。');
    const mappings = await loadInventoryPlatformExternalIdMap(storeId, audited);
    const disabledRows = await sql`select p.platform_key as platform,s.target_type as kind,s.target_id::text as "targetId"
      from menu_platform_target_settings s join menu_external_platforms p on p.id=s.external_platform_id
      join store_brands b on b.brand_id=s.brand_id and b.store_id=${storeId}
      where s.is_enabled=false and (s.store_id is null or s.store_id=${storeId})`;
    const authorityExclusions = await sql`select config.key as platform, o.kind, o.target_id::text as "targetId"
      from menu_uber_sources s join menu_uber_objects o on o.source_id=s.id
      cross join lateral jsonb_each(s.publish_config) config
      where s.enabled=true and s.store_id=${storeId} and o.archived=false
        and (coalesce(config.value->'quarantinedSourceKeys','[]'::jsonb) ? o.source_key
          or coalesce(config.value->'excludedSourceKeys','[]'::jsonb) ? o.source_key)`;
    const enabled = await sql`select distinct source_platform as platform from store_sales_sources
      where store_id=${storeId} and is_enabled=true and source_platform in ('rocket_now','demae_can')`;
    const commands: Array<{id:string;platform:string;payload:Record<string,unknown>;error?:string}> = [];
    const excluded: Array<{platform:string;label:string;reason:string}> = [];
    for (const {platform} of enabled) {
      if(!comparison.platforms.includes(String(platform)))throw new Error('連携設定が読取後に変更されました。再読み取りしてください。');
      const platformTargets=audited.filter(t=>{
        if(comparison.rows.some(r=>r.kind===t.kind&&r.targetId===t.targetId&&r.cells[String(platform)]?.state==='staged')) {
          excluded.push({platform:String(platform),label:t.label,reason:'verified_unpublished_draft'});return false;
        }
        if(t.label.includes('こちら商品ではありません') || [...disabledRows, ...authorityExclusions].some(d=>d.platform===platform&&d.kind===t.kind&&d.targetId===t.targetId)) {
          excluded.push({platform:String(platform),label:t.label,reason:'excluded_from_platform'});return false;
        }
        return true;
      });
      const missing=platformTargets.filter(t=>!inventoryPlatformExternalIds(mappings,String(platform),t).length);
      const observedTargets=(comparisonCommands.find(c=>c.platform===platform)?.payload?.targets??[]) as AuditTarget[];
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
          return [{...t,knownExternalIds:ids}];
        });
        for (let offset=0;offset<targets.length;offset+=20) {
          commands.push({id:randomUUID(),platform:String(platform),payload:{
            availabilityAuthority:'uber_eats',fullSyncRunId:runId,syncSource:'store',
            inventoryKey:`full-sync:${runId}:${platform}:${isAvailable}:${offset}`,
            ingredientLabel:'Uber 基準の全店手動同期',feedbackLabel:'Uber 基準の全店手動同期',
            isAvailable,soldOutMode:'indefinite',
            verifyAvailability:true,
            operation:platform==='rocket_now'?(isAvailable?'unhide':'hide'):(isAvailable?'available':'stockout'),
            targets:targets.slice(offset,offset+20)
          }});
        }
      }
    }
    // Missing destination mappings must be made visible; never guess a name and unhide a staging object.
    const osChanges=audited.filter(t=>comparison.rows.some(r=>r.kind===t.kind&&r.targetId===t.targetId&&r.changes.includes('foundr1')));
    const data = JSON.stringify(osChanges);
    await sql.transaction([
      sql`delete from menu_inventory_availability_blocks b using jsonb_to_recordset(${data}::jsonb) as t(kind text,"targetId" uuid)
        where b.store_id=${storeId} and b.target_kind=t.kind and b.target_id=t."targetId"`,
      sql`delete from menu_platform_availability_settings s using jsonb_to_recordset(${data}::jsonb) as t(kind text,"targetId" uuid)
        where s.store_id=${storeId} and s.target_kind=t.kind and s.target_id=t."targetId"`,
      sql`insert into menu_store_settings (brand_id,store_id,menu_catalog_item_id,is_available,stock_status,status_note,updated_at)
        select i.brand_id,${storeId},i.id,t."isAvailable",case when t."isAvailable" then 'available' else 'unavailable' end,'Uber 基準の全店手動同期',now()
        from jsonb_to_recordset(${data}::jsonb) as t(kind text,"targetId" uuid,"isAvailable" boolean)
        join menu_catalog_items i on i.id=t."targetId" join store_brands b on b.brand_id=i.brand_id and b.store_id=${storeId}
        where t.kind='item' and i.is_active=true
        on conflict (store_id,menu_catalog_item_id) do update set is_available=excluded.is_available,stock_status=excluded.stock_status,status_note=excluded.status_note,updated_at=now()`,
      sql`insert into menu_option_store_settings (brand_id,store_id,menu_option_id,is_available,stock_status,status_note,updated_at)
        select g.brand_id,${storeId},o.id,t."isAvailable",case when t."isAvailable" then 'available' else 'unavailable' end,'Uber 基準の全店手動同期',now()
        from jsonb_to_recordset(${data}::jsonb) as t(kind text,"targetId" uuid,"isAvailable" boolean)
        join menu_options o on o.id=t."targetId" join menu_option_groups g on g.id=o.option_group_id
        join store_brands b on b.brand_id=g.brand_id and b.store_id=${storeId} where t.kind='option' and o.is_active=true and g.is_active=true
        on conflict (store_id,menu_option_id) do update set is_available=excluded.is_available,stock_status=excluded.stock_status,status_note=excluded.status_note,updated_at=now()`,
      ...commands.map(c => sql`insert into local_bridge_commands (id,store_id,platform,command_type,idempotency_key,payload,status,last_error)
        values (${c.id},${storeId},${c.platform},'set_inventory_availability',${String(c.payload.inventoryKey)},${JSON.stringify(c.payload)}::jsonb,${c.error?'failed':'pending'},${c.error??''})
        on conflict (idempotency_key) do nothing`),
      sql`update menu_inventory_sync_runs set details=details || ${JSON.stringify({osApplied:true,phase:'publishing',targetCount:audited.length,commandCount:commands.length,platformExclusions:excluded})}::jsonb
        where id=${runId} and store_id=${storeId}`
    ]);
    await publishBridgeCommandAvailable(storeId).catch(() => undefined);
    return {updatedCount:osChanges.length,missingCount:0};
  });
}
