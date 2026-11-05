import { sql } from "../../../../../lib/db";
import { after } from "next/server";
import { notifyBridgeMenuSync } from "../../../../../lib/bridge-menu-sync-notifications";
import { notifyInventorySyncAttention } from "../../../../../lib/inventory-sync-notifications";
import { reconcileInventoryCommandsSql } from "../../../../../lib/inventory-command-supersession";
import { applyUberAvailabilitySync } from "../../../../../lib/inventory-manual-sync";
import { menuSyncIssue } from "../../../../../lib/menu-sync-status";
import { findRejectedMenuNameTargets } from "../../../../../lib/menu-name-adaptation";
import { mergePlatformSnapshotEntries } from "../../../../../lib/menu-platform-snapshot-merge";
import { ingestUberMenuSource } from "../../../../../lib/uber-menu-source-sync";
import { publishPublicMenuUpdatedEvent } from "../../../../../lib/order-realtime";
import { lockBridgeExecutionRoute } from "../../../../../lib/bridge-execution-route";
import { authorizeLocalBridge } from "../../../../../lib/local-bridge-auth";
import { applyCompetitorBridgeSnapshot } from "../../../../../lib/competitor-bridge-snapshot";
import {
  publishBridgeCommandUpdated,
  publishBridgeInventoryUpdated
} from "../../../../../lib/local-bridge-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function authorize(request: Request) {
  const params = new URL(request.url).searchParams;
  const storeId = cleanText(params.get("storeId"), 80);
  let authorization = await authorizeLocalBridge(request, storeId, "uber_eats");
  if (!authorization.authorized) {
    authorization = await authorizeLocalBridge(request, storeId, "rocket_now");
  }
  if (!authorization.authorized) {
    authorization = await authorizeLocalBridge(request, storeId, "demae_can");
  }
  if (!authorization.authorized) {
    authorization = await authorizeLocalBridge(request, storeId, "desktop");
  }
  if (!authorization.authorized) {
    authorization = await authorizeLocalBridge(request, storeId, "desktop_vps");
  }
  const isVps = authorization.devicePlatform === "desktop_vps";
  const platformMode = cleanText(params.get("platformMode"), 20);
  const isDesktop = authorization.devicePlatform === "desktop" || isVps;
  return {
    storeId,
    isDesktop,
    isVps,
    supportsUber: !isVps && (isDesktop || ["", "uber_eats", "dual", "all"].includes(platformMode)),
    supportsRocket: isDesktop || ["rocket_now", "dual", "all"].includes(platformMode),
    supportsDemae: isDesktop && !isVps,
    ...authorization
  };
}


async function updateMenuPublishBatch(batchId: string) {
  if (!batchId) return;
  await sql`
    update menu_publish_batches batches
    set
      status = case
        when exists (select 1 from menu_change_sync_tasks tasks where tasks.publish_batch_id = batches.id and tasks.status in ('queued', 'pending', 'processing', 'retrying')) then 'processing'
        when exists (select 1 from menu_change_sync_tasks tasks where tasks.publish_batch_id = batches.id and tasks.status = 'failed')
          and exists (select 1 from menu_change_sync_tasks tasks where tasks.publish_batch_id = batches.id and tasks.status = 'succeeded') then 'partially_succeeded'
        when exists (select 1 from menu_change_sync_tasks tasks where tasks.publish_batch_id = batches.id and tasks.status = 'failed') then 'failed'
        else 'succeeded'
      end,
      completed_at = case
        when exists (select 1 from menu_change_sync_tasks tasks where tasks.publish_batch_id = batches.id and tasks.status in ('queued', 'pending', 'processing', 'retrying')) then null
        else now()
      end,
      updated_at = now()
    where batches.id = ${batchId}
  `;
}

async function reconcileMenuPublishBatches(storeId: string) {
  await sql`
    update menu_publish_batches batches
    set status = case
      when exists (select 1 from menu_change_sync_tasks tasks where tasks.publish_batch_id = batches.id and tasks.status in ('queued', 'pending', 'processing', 'retrying')) then 'processing'
      when exists (select 1 from menu_change_sync_tasks tasks where tasks.publish_batch_id = batches.id and tasks.status = 'failed')
        and exists (select 1 from menu_change_sync_tasks tasks where tasks.publish_batch_id = batches.id and tasks.status = 'succeeded') then 'partially_succeeded'
      when exists (select 1 from menu_change_sync_tasks tasks where tasks.publish_batch_id = batches.id and tasks.status = 'failed') then 'failed'
      else 'succeeded'
    end,
    completed_at = case
      when exists (select 1 from menu_change_sync_tasks tasks where tasks.publish_batch_id = batches.id and tasks.status in ('queued', 'pending', 'processing', 'retrying')) then null
      else now()
    end,
    updated_at = now()
    where batches.store_id::text = ${storeId}
      and batches.status in ('queued', 'processing')
  `;
}

async function applyMenuPublishResult(input: {
  commandId: string;
  storeId: string;
  platform: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  const batchId = cleanText(input.payload.batchId, 80);
  const brandId = cleanText(input.payload.brandId, 80);
  const ruleVersion = cleanText(input.payload.ruleVersion, 80);
  const platformRows = await sql`
    select id::text
    from menu_external_platforms
    where brand_id::text = ${brandId} and store_id is null and platform_key = ${input.platform}
    limit 1
  `;
  const externalPlatformId = String(platformRows[0]?.id ?? "");
  const snapshot = input.result.snapshot && typeof input.result.snapshot === "object"
    ? input.result.snapshot as Record<string, unknown>
    : {};
  if (externalPlatformId && (Array.isArray(snapshot.items) || Array.isArray(snapshot.options))) {
    await sql`
      insert into menu_platform_snapshots (
        brand_id, store_id, external_platform_id, snapshot_type, rule_version, payload, captured_at
      ) values (
        ${brandId}, null, ${externalPlatformId}, 'verification', ${ruleVersion}, ${JSON.stringify(snapshot)}::jsonb, now()
      )
    `;
    const baselineRows = await sql`
      select payload
      from menu_platform_snapshots
      where brand_id = ${brandId} and store_id is null and external_platform_id = ${externalPlatformId}
        and snapshot_type = 'baseline'
      order by captured_at desc
      limit 1
    `;
    const previous = baselineRows[0]?.payload && typeof baselineRows[0].payload === "object"
      ? baselineRows[0].payload as Record<string, unknown>
      : {};
    const mergedSnapshot = {
      ...previous,
      items: mergePlatformSnapshotEntries(previous.items, snapshot.items),
      options: mergePlatformSnapshotEntries(previous.options, snapshot.options),
      complete: previous.complete !== false,
      missingTargets: Array.isArray(previous.missingTargets) ? previous.missingTargets : []
    };
    await sql`
      insert into menu_platform_snapshots (
        brand_id, store_id, external_platform_id, snapshot_type, rule_version, payload, captured_at
      ) values (
        ${brandId}, null, ${externalPlatformId}, 'baseline', ${ruleVersion}, ${JSON.stringify(mergedSnapshot)}::jsonb, now()
      )
    `;
    const observed = [
      ...(Array.isArray(snapshot.items) ? snapshot.items.map((entry) => ({ targetType: "item", entry })) : []),
      ...(Array.isArray(snapshot.options) ? snapshot.options.map((entry) => ({ targetType: "option", entry })) : [])
    ];
    for (const value of observed) {
      const entry = value.entry && typeof value.entry === "object" ? value.entry as Record<string, unknown> : {};
      const targetId = cleanText(entry.targetId, 80);
      const externalId = cleanText(entry.externalId, 240);
      if (!targetId || !externalId) continue;
      await sql`
        insert into menu_platform_object_mappings (
          brand_id, store_id, external_platform_id, target_type, target_id,
          external_id, external_parent_id, external_name, last_observed_state, last_verified_at, updated_at
        ) values (
          ${brandId}, null, ${externalPlatformId}, ${value.targetType}, ${targetId},
          ${externalId}, ${cleanText(entry.externalParentId, 240)}, ${cleanText(entry.name, 500)},
          ${JSON.stringify(entry)}::jsonb, now(), now()
        )
        on conflict (external_platform_id, target_type, external_id) do update set
          target_id = case when menu_platform_object_mappings.target_id = excluded.target_id
            then excluded.target_id else null end,
          external_parent_id = excluded.external_parent_id,
          external_name = excluded.external_name,
          last_observed_state = excluded.last_observed_state,
          last_verified_at = now(),
          updated_at = now()
      `;
    }
  }
  await sql`
    update menu_change_sync_tasks
    set status = 'succeeded', phase = 'verified', verified_at = now(), completed_at = now(),
      completion_note = 'Bridge で反映・回読検証済み', error_code = '', error_detail = '', updated_at = now()
    where command_id = ${input.commandId}
  `;
  const publishedChanges = Array.isArray(input.payload.changes) ? input.payload.changes : [];
  for (const value of publishedChanges) {
    const change = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const targetId = cleanText(change.targetId, 80);
    if (!targetId || !externalPlatformId) continue;
    await sql`
      update menu_change_sync_tasks
      set status = 'completed', completed_at = now(), verified_at = now(),
        completion_note = 'Bridge 配信で解消済み', updated_at = now()
      where brand_id = ${brandId} and store_id is null and external_platform_id = ${externalPlatformId}
        and target_id::text = ${targetId} and status = 'pending'
    `;
  }
  await updateMenuPublishBatch(batchId);
}

async function applyMenuSnapshotResult(input: {
  storeId: string;
  platform: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  const brandId = cleanText(input.payload.brandId, 80);
  const ruleVersion = cleanText(input.payload.ruleVersion, 80);
  const snapshot = input.result.snapshot && typeof input.result.snapshot === "object"
    ? input.result.snapshot as Record<string, unknown>
    : {};
  if (!brandId || (!Array.isArray(snapshot.items) && !Array.isArray(snapshot.options))) {
    throw new Error("menu_snapshot_result_invalid");
  }
  const platformRows = await sql`
    select id::text
    from menu_external_platforms
    where brand_id::text = ${brandId} and store_id is null and platform_key = ${input.platform}
    limit 1
  `;
  const externalPlatformId = String(platformRows[0]?.id ?? "");
  if (!externalPlatformId) throw new Error("menu_snapshot_platform_missing");
  await sql`
    insert into menu_platform_snapshots (
      brand_id, store_id, external_platform_id, snapshot_type, rule_version, payload, captured_at
    ) values (
      ${brandId}, null, ${externalPlatformId}, 'baseline', ${ruleVersion}, ${JSON.stringify(snapshot)}::jsonb, now()
    )
  `;
  const observed = [
    ...(Array.isArray(snapshot.items) ? snapshot.items.map((entry) => ({ targetType: "item", entry })) : []),
    ...(Array.isArray(snapshot.options) ? snapshot.options.map((entry) => ({ targetType: "option", entry })) : [])
  ];
  await sql`
    update menu_platform_import_candidates
    set status = 'not_seen', updated_at = now()
    where external_platform_id = ${externalPlatformId} and status = 'pending'
  `;
  for (const value of observed) {
    const entry = value.entry && typeof value.entry === "object" ? value.entry as Record<string, unknown> : {};
    const targetId = cleanText(entry.targetId, 80);
    const externalId = cleanText(entry.externalId, 240);
    if (!externalId) continue;
    if (!targetId) {
      await sql`
        insert into menu_platform_import_candidates (
          brand_id, store_id, external_platform_id, target_type, external_id,
          external_parent_id, observed_name, observed_payload, status, last_seen_at, updated_at
        ) values (
          ${brandId}, null, ${externalPlatformId}, ${value.targetType}, ${externalId},
          ${cleanText(entry.externalParentId, 240)}, ${cleanText(entry.name, 500)},
          ${JSON.stringify(entry)}::jsonb, 'pending', now(), now()
        )
        on conflict (external_platform_id, target_type, external_id) do update set
          external_parent_id = excluded.external_parent_id,
          observed_name = excluded.observed_name,
          observed_payload = excluded.observed_payload,
          status = case when menu_platform_import_candidates.status = 'not_seen' then 'pending' else menu_platform_import_candidates.status end,
          last_seen_at = now(),
          updated_at = now()
      `;
      continue;
    }
    await sql`
      insert into menu_platform_object_mappings (
        brand_id, store_id, external_platform_id, target_type, target_id,
        external_id, external_parent_id, external_name, last_observed_state, last_verified_at, updated_at
      ) values (
        ${brandId}, null, ${externalPlatformId}, ${value.targetType}, ${targetId},
        ${externalId}, ${cleanText(entry.externalParentId, 240)}, ${cleanText(entry.name, 500)},
        ${JSON.stringify(entry)}::jsonb, now(), now()
      )
      on conflict (external_platform_id, target_type, external_id) do update set
        target_id = case when menu_platform_object_mappings.target_id = excluded.target_id
          then excluded.target_id else null end,
        external_parent_id = excluded.external_parent_id,
        external_name = excluded.external_name,
        last_observed_state = excluded.last_observed_state,
        last_verified_at = now(),
        updated_at = now()
    `;
  }
}

export async function GET(request: Request) {
  const authorization = await authorize(request);
  if (!authorization.authorized || !authorization.storeId) {
    return Response.json({ error: "Unauthorized bridge token." }, { status: 401 });
  }

  if (authorization.deviceId) {
    await sql`
      update local_bridge_devices
      set last_seen_at = now(), updated_at = now()
      where id::text = ${authorization.deviceId}
        and (
          last_seen_at is null
          or last_seen_at < now() - interval '5 minutes'
        )
    `;
  }

  if (!authorization.isVps) {
    await sql`update local_bridge_commands
      set status='failed', last_error='bridge_probe_expired', completed_at=now(), updated_at=now()
      where store_id::text=${authorization.storeId} and command_type='bridge_read_probe'
        and ((status='pending' and created_at<now()-interval '5 minutes')
          or (status='processing' and claim_expires_at<now()))`;

    await sql`update local_bridge_commands set status='failed',last_error=case when command_type='reset_platform_connection' then 'connection_recovery_expired' else 'menu_sync_recovery_expired' end,completed_at=now(),updated_at=now()
      where store_id::text=${authorization.storeId} and command_type in ('inspect_menu_sync','repair_menu_sync','reset_platform_connection')
        and ((status='pending' and created_at<now()-interval '5 minutes') or (status='processing' and claim_expires_at<now()))`;

    // Inventory synchronization belongs exclusively to the desktop bridge. The
    // tablet bridges remain dedicated to order operations so inventory changes
    // can never navigate an order-taking tablet away from its operational page.

    const expiredMenuCommands = await sql`
      update local_bridge_commands
      set
        status = 'failed',
        claimed_by_device_id = null,
        claimed_at = null,
        claim_expires_at = null,
        completed_at = coalesce(completed_at, now()),
        last_error = 'Bridge command expired before execution.',
        updated_at = now()
      where store_id::text = ${authorization.storeId}
        and (
          (platform = 'uber_eats' and ${authorization.supportsUber})
          or (platform = 'rocket_now' and ${authorization.supportsRocket})
          or (platform = 'demae_can' and ${authorization.supportsDemae})
        )
        and (
          (${authorization.isDesktop} and command_type in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot', 'inspect_menu_sync', 'repair_menu_sync', 'reset_platform_connection', 'bridge_read_probe'))
          or (${authorization.isDesktop} = false and command_type not in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot', 'inspect_menu_sync', 'repair_menu_sync', 'reset_platform_connection', 'bridge_read_probe'))
        )
        and status in ('pending', 'processing')
        -- Only server-validated manual retries renew the bounded execution
        -- window. Inventory's locked retry writes manualRetryAt; available_at,
        -- updated_at and heartbeats never renew it. Keep original created_at
        -- for exact-target intent ordering and business-day/history membership.
        -- The same epoch guards ACK selection and progress lease renewal below.
        and greatest(created_at,case when payload->>'authoritativePublication'='true'
          then (payload->'manualRetryHistory'->-1->>'at')::timestamptz
          else null end,case when command_type='set_inventory_availability'
            and jsonb_typeof(payload->'manualRetryAt')='string'
            and payload->>'manualRetryAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
            and pg_input_is_valid(payload->>'manualRetryAt','timestamp with time zone')
          then case when (payload->>'manualRetryAt')::timestamptz between created_at and now()
            then (payload->>'manualRetryAt')::timestamptz else null end
          else null end) < now() - interval '2 hours'
      returning id::text, command_type, status
    `;

    const timedOutMenuCommands = await sql`
      update local_bridge_commands
      set
        status = case when (command_type in ('publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot') and attempts >= 3) or attempts >= 5 then 'failed' else 'pending' end,
        available_at = case when (command_type in ('publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot') and attempts >= 3) or attempts >= 5 then available_at else now() end,
        claimed_by_device_id = null,
        claimed_at = null,
        claim_expires_at = null,
        last_error = case
          when (command_type in ('publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot') and attempts >= 3) or attempts >= 5 then coalesce(nullif(last_error, ''), 'Bridge command timed out.')
          else last_error
        end,
        updated_at = now()
      where store_id::text = ${authorization.storeId}
        and (
          (platform = 'uber_eats' and ${authorization.supportsUber})
          or (platform = 'rocket_now' and ${authorization.supportsRocket})
          or (platform = 'demae_can' and ${authorization.supportsDemae})
        )
        and (
          (${authorization.isDesktop} and command_type in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot', 'inspect_menu_sync', 'repair_menu_sync', 'reset_platform_connection', 'bridge_read_probe'))
          or (${authorization.isDesktop} = false and command_type not in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot', 'inspect_menu_sync', 'repair_menu_sync', 'reset_platform_connection', 'bridge_read_probe'))
        )
        and status = 'processing'
        and command_type <> 'reset_platform_connection'
        and claim_expires_at < now()
      returning id::text, command_type, status
    `;

    await sql`
      update menu_change_sync_tasks tasks
      set
        status = case commands.status when 'pending' then case when commands.attempts > 0 then 'retrying' else 'queued' end when 'processing' then 'processing' when 'failed' then 'failed' else tasks.status end,
        phase = case commands.status when 'pending' then case when commands.attempts > 0 then 'retrying' else 'queued' end when 'processing' then 'processing' when 'failed' then 'failed' else tasks.phase end,
        attempts = commands.attempts,
        error_detail = commands.last_error,
        completed_at = case when commands.status = 'failed' then coalesce(tasks.completed_at, now()) else tasks.completed_at end,
        updated_at = now()
      from local_bridge_commands commands
      where tasks.command_id = commands.id
        and commands.store_id::text = ${authorization.storeId}
        and commands.command_type in ('publish_menu_changes', 'capture_menu_snapshot')
        and tasks.status in ('queued', 'pending', 'processing', 'retrying')
        and commands.status in ('pending', 'processing', 'failed')
    `;
    await reconcileMenuPublishBatches(authorization.storeId);
    const failedMenuCommands = [...expiredMenuCommands, ...timedOutMenuCommands]
      .filter(command => command.command_type === "publish_menu_changes" && command.status === "failed");
    if (failedMenuCommands.length) {
      const storeId = authorization.storeId;
      after(async () => {
        for (const command of failedMenuCommands) {
          await notifyBridgeMenuSync(storeId, String(command.id))
            .catch(() => console.error("bridge_menu_sync_timeout_notification_failed", command.id));
        }
      });
    }
    // A source-owned menu must never be overwritten by an old OS-led batch,
    // including a retry queued before authority mode was enabled.
    await sql`update local_bridge_commands c set status='failed',last_error='uber_authority_superseded_publication',completed_at=now(),updated_at=now() from menu_uber_sources s where c.store_id=s.store_id and c.store_id::text=${authorization.storeId} and s.enabled=true and c.payload->>'brandId'=s.brand_id::text and c.command_type='publish_menu_changes' and c.status='pending' and (c.payload->>'authoritativePublication' is distinct from 'true' or c.payload->>'revision' is distinct from s.revision::text)`;

    if (authorization.isDesktop) {
      await sql.query(reconcileInventoryCommandsSql, [authorization.storeId, [
        ...(authorization.supportsUber ? ["uber_eats"] : []),
        ...(authorization.supportsRocket ? ["rocket_now"] : []),
        ...(authorization.supportsDemae ? ["demae_can"] : [])
      ]]);
    }
    await sql`
      update menu_change_sync_tasks tasks
      set status = 'failed', phase = 'timeout', error_code = 'bridge_timeout',
        error_detail = 'Bridge command expired before execution.', is_retryable = true,
        completed_at = now(), updated_at = now()
      from local_bridge_commands commands
      where tasks.command_id = commands.id
        and commands.store_id::text = ${authorization.storeId}
        and commands.status = 'failed'
        and commands.last_error = 'Bridge command expired before execution.'
        and tasks.status in ('queued', 'processing', 'retrying')
    `;
  }

  const existing = await sql`
    select
      id::text,
      platform,
      command_type as type,
      payload,
      attempts
    from local_bridge_commands
    where store_id::text = ${authorization.storeId}
      and (
        (platform = 'uber_eats' and ${authorization.supportsUber})
        or (platform = 'rocket_now' and ${authorization.supportsRocket})
        or (platform = 'demae_can' and ${authorization.supportsDemae})
      )
      and (
        (${authorization.isDesktop} and command_type in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot', 'inspect_menu_sync', 'repair_menu_sync', 'reset_platform_connection', 'bridge_read_probe'))
        or (${authorization.isDesktop} = false and command_type not in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot', 'inspect_menu_sync', 'repair_menu_sync', 'reset_platform_connection', 'bridge_read_probe'))
      )
      and status = 'processing'
      and (
        claimed_by_device_id::text = ${authorization.deviceId}
        or (${authorization.deviceId} = '' and claimed_by_device_id is null)
      )
      and claim_expires_at >= now()
      and (command_type <> 'reset_platform_connection' or (
        ${authorization.isDesktop} and ${authorization.deviceId || ''} <> ''
        and payload->>'deviceId'=${authorization.deviceId || ''}
        and exists(select 1 from local_bridge_devices recovery_device
          where recovery_device.id::text=${authorization.deviceId || ''}
            and recovery_device.store_id=local_bridge_commands.store_id
            and recovery_device.platform='desktop' and recovery_device.is_enabled=true
            and recovery_device.health_status->>'connectionRecoveryVersion'='1')
        and (select count(*) from local_bridge_devices sole_device where sole_device.store_id=local_bridge_commands.store_id
          and sole_device.platform='desktop' and sole_device.is_enabled=true)=1
        and not exists(select 1 from local_bridge_commands busy where busy.store_id=local_bridge_commands.store_id
          and busy.id<>local_bridge_commands.id and busy.status='processing')
      ))
    order by claimed_at
    limit 1
  `;
  if (existing[0]) return Response.json({ command: existing[0] });

  const [, rows] = await sql.transaction([lockBridgeExecutionRoute(authorization.storeId), sql`
    update local_bridge_commands
    set
      status = 'processing',
      attempts = attempts + 1,
      claimed_by_device_id = ${authorization.deviceId || null}::uuid,
      claimed_at = now(),
      claim_expires_at = now() + case
        when command_type in ('inspect_menu_sync','repair_menu_sync','reset_platform_connection','bridge_read_probe') then interval '5 minutes'
        when command_type in ('audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot') then interval '30 minutes'
        when command_type = 'set_inventory_availability'
          and (${authorization.isDesktop} or platform = 'rocket_now') then interval '15 minutes'
        else interval '2 minutes'
      end,
      updated_at = now()
    where id = (
      select id
      from local_bridge_commands
      where store_id::text = ${authorization.storeId}
        and (
          (platform = 'uber_eats' and ${authorization.supportsUber})
          or (platform = 'rocket_now' and ${authorization.supportsRocket})
          or (platform = 'demae_can' and ${authorization.supportsDemae})
        )
        and (
          (${authorization.isDesktop} and command_type in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot', 'inspect_menu_sync', 'repair_menu_sync', 'reset_platform_connection', 'bridge_read_probe'))
          or (${authorization.isDesktop} = false and command_type not in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot', 'inspect_menu_sync', 'repair_menu_sync', 'reset_platform_connection', 'bridge_read_probe'))
        )
        and (not ${authorization.isVps} or command_type = 'bridge_read_probe')
        and (command_type <> 'bridge_read_probe' or (
          payload->>'deviceId' = ${authorization.deviceId} and created_at >= now() - interval '5 minutes'
        ))
        and (not ${authorization.isDesktop} or coalesce((
          select route.device_id::text = ${authorization.deviceId}
          from local_bridge_execution_routes route
          where route.store_id = local_bridge_commands.store_id and route.platform = local_bridge_commands.platform
        ), not ${authorization.isVps}))
        and status = 'pending'
        and (command_type <> 'reset_platform_connection' or (
        ${authorization.isDesktop} and ${authorization.deviceId || ''} <> ''
        and payload->>'deviceId'=${authorization.deviceId || ''}
        and exists(select 1 from local_bridge_devices recovery_device
          where recovery_device.id::text=${authorization.deviceId || ''}
            and recovery_device.store_id=local_bridge_commands.store_id
            and recovery_device.platform='desktop' and recovery_device.is_enabled=true
            and recovery_device.health_status->>'connectionRecoveryVersion'='1')
        and (select count(*) from local_bridge_devices sole_device where sole_device.store_id=local_bridge_commands.store_id
          and sole_device.platform='desktop' and sole_device.is_enabled=true)=1
        and not exists(select 1 from local_bridge_commands busy where busy.store_id=local_bridge_commands.store_id
          and busy.id<>local_bridge_commands.id and busy.status='processing')
      ))
        and (command_type not in ('inspect_menu_sync','repair_menu_sync') or (
          payload->'recovery'->>'deviceId'=${authorization.deviceId}
          and exists(select 1 from local_bridge_devices recovery_device where recovery_device.id::text=${authorization.deviceId}
            and recovery_device.is_enabled=true and recovery_device.health_status->>'menuSyncRecoveryVersion'='1')
          and not exists(select 1 from local_bridge_commands busy where busy.store_id=local_bridge_commands.store_id
            and busy.id<>local_bridge_commands.id and busy.status='processing')
        ))
        and available_at <= now()
        and attempts < 5
        and (platform <> 'rocket_now' or command_type not in ('publish_menu_changes','set_inventory_availability','reset_platform_connection')
          or not exists (
            select 1 from menu_uber_option_migrations migration
            join menu_uber_sources source on source.id=migration.source_id
            where source.store_id=local_bridge_commands.store_id and migration.platform='rocket_now'
              and migration.state->>'phase'<>'complete' and coalesce(migration.state->>'androidDeviceId','')<>''
          ))
      order by
        case when command_type='bridge_read_probe' then 0 else 1 end,
        case when command_type='reset_platform_connection' then -1 else 0 end,
        case when payload->>'syncSource' = 'scheduled' then 1 else 0 end,
        case platform
          when 'uber_eats' then 0
          when 'rocket_now' then 1
          when 'demae_can' then 2
          else 3
        end,
        created_at
      for update skip locked
      limit 1
    )
    returning
      id::text,
      platform,
      command_type as type,
      payload,
      attempts
  `]);
  if (rows[0]?.type === "publish_menu_changes") {
    const commandId = String(rows[0].id);
    const storeId = authorization.storeId;
    after(() => notifyBridgeMenuSync(storeId, commandId, authorization.isVps ? "VPS" : "Mac")
      .catch(() => console.error("bridge_menu_sync_start_notification_failed", commandId)));
  }
  return Response.json({ command: rows[0] ?? null }, {
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  const authorization = await authorize(request);
  if (!authorization.authorized || !authorization.storeId) {
    return Response.json({ error: "Unauthorized bridge token." }, { status: 401 });
  }
  if (authorization.deviceId) {
    await sql`
      update local_bridge_devices
      set last_seen_at = now(), updated_at = now()
      where id::text = ${authorization.deviceId}
        and (
          last_seen_at is null
          or last_seen_at < now() - interval '5 minutes'
        )
    `;
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const commandId = cleanText(body.commandId, 80);
  let status = cleanText(body.status, 40);
  let error = cleanText(body.error, 1000);
  const result = body.result && typeof body.result === "object"
    ? { ...body.result as Record<string, unknown> }
    : {};
  // Name recovery records belong to the server. A Bridge response must never
  // replace the native rejection/identity proof used by a later manual retry.
  delete result.nameAdaptationDiagnostic;
  delete result.nameAdaptation;
  if (!commandId || !["processing", "succeeded", "failed"].includes(status)) {
    return Response.json({ error: "Invalid command acknowledgement." }, { status: 400 });
  }

  const commandRows = await sql`
    select command_type as "commandType", platform, payload, attempts,claimed_at::text as "claimedAt"
    from local_bridge_commands
    where id::text = ${commandId}
      and store_id::text = ${authorization.storeId}
      and status = 'processing'
      and claimed_at is not null
      and (command_type <> 'reset_platform_connection' or (
        ${authorization.isDesktop} and ${authorization.deviceId || ''} <> ''
        and payload->>'deviceId'=${authorization.deviceId || ''}
        and exists(select 1 from local_bridge_devices recovery_device
          where recovery_device.id::text=${authorization.deviceId || ''}
            and recovery_device.store_id=local_bridge_commands.store_id
            and recovery_device.platform='desktop' and recovery_device.is_enabled=true
            and recovery_device.health_status->>'connectionRecoveryVersion'='1')
        and (select count(*) from local_bridge_devices sole_device where sole_device.store_id=local_bridge_commands.store_id
          and sole_device.platform='desktop' and sole_device.is_enabled=true)=1
        and not exists(select 1 from local_bridge_commands busy where busy.store_id=local_bridge_commands.store_id
          and busy.id<>local_bridge_commands.id and busy.status='processing')
      ))
      and (command_type<>'reset_platform_connection' or (claim_expires_at>=now() and claimed_at>now()-interval '5 minutes'))
      and greatest(created_at,case when payload->>'authoritativePublication'='true'
        then (payload->'manualRetryHistory'->-1->>'at')::timestamptz
        else null end,case when command_type='set_inventory_availability'
          and jsonb_typeof(payload->'manualRetryAt')='string'
          and payload->>'manualRetryAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
          and pg_input_is_valid(payload->>'manualRetryAt','timestamp with time zone')
        then case when (payload->>'manualRetryAt')::timestamptz between created_at and now()
          then (payload->>'manualRetryAt')::timestamptz else null end
        else null end) + interval '2 hours' > now()
      and (
        ${authorization.deviceId} = ''
        or claimed_by_device_id::text = ${authorization.deviceId}
      )
      and (command_type <> 'bridge_read_probe' or (
        claimed_by_device_id::text = ${authorization.deviceId} and claim_expires_at >= now()
      ))
      and (not ${authorization.isVps} or command_type = 'bridge_read_probe')
    limit 1
  `;
  if (!commandRows[0]) return Response.json({ error: "Command is no longer claimable." }, { status: 409 });
  if (commandRows[0].commandType === 'bridge_read_probe' && status === 'succeeded'
    && (!Number.isSafeInteger(result.itemCount) || Number(result.itemCount) < 1
      || !Number.isSafeInteger(result.optionCount) || Number(result.optionCount) < 0)) {
    return Response.json({ error: "Invalid bridge probe result." }, { status: 400 });
  }

  if (String(commandRows[0].commandType)==='reset_platform_connection') {
    if(!authorization.isDesktop||!authorization.deviceId)return Response.json({error:'Desktop recovery required.'},{status:403});
    const recovered=result.connectionRecovered===true&&result.inventoryChanged===false;
    const verifiedAt=typeof result.verifiedAt==='string'?result.verifiedAt:'';
    const verifiedTime=Date.parse(verifiedAt),claimedTime=Date.parse(String(commandRows[0].claimedAt??'')),now=Date.now();
    if(status==='succeeded'&&(!recovered||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{3}Z$/.test(verifiedAt)
      ||!Number.isFinite(verifiedTime)||new Date(verifiedTime).toISOString()!==verifiedAt
      ||!Number.isFinite(claimedTime)||verifiedTime<claimedTime||verifiedTime>now+30000||verifiedTime<now-300000)) {
      return Response.json({error:'connection_recovery_verification_missing'},{status:409});
    }
    // A connection check cannot persist arbitrary native payloads or imply an
    // inventory write. Only independently reported connection proof is saved.
    for(const key of Object.keys(result))delete result[key];
    if(status==='succeeded')Object.assign(result,{connectionRecovered:true,inventoryChanged:false,verifiedAt});
    else if(status==='processing')result.progress={phase:'recovering_connection'};
  }

  if (['inspect_menu_sync','repair_menu_sync'].includes(String(commandRows[0].commandType))) {
    if(!authorization.isDesktop)return Response.json({error:'Desktop recovery required.'},{status:403});
    const {guardMenuRecoveryCommand,acknowledgeMenuRecovery}=await import('../../../../../lib/menu-sync-recovery-store');
    try {
      if(status==='processing') {
        await guardMenuRecoveryCommand({commandId,storeId:authorization.storeId,deviceId:authorization.deviceId},
          (result.progress as Record<string,unknown>|undefined)?.recoveryGuard===true);
        await sql`update local_bridge_commands set result=result||${JSON.stringify(result)}::jsonb,updated_at=now()
          where id::text=${commandId} and status='processing' and claimed_by_device_id::text=${authorization.deviceId}`;
        return Response.json({ok:true});
      }
      return Response.json(await acknowledgeMenuRecovery({commandId,storeId:authorization.storeId,deviceId:authorization.deviceId,status,result,error}));
    }catch(failure){return Response.json({error:failure instanceof Error?failure.message:'menu_sync_recovery_failed'},{status:409});}
  }

  if (status === "processing") {
    if ((commandRows[0].payload as Record<string,unknown>)?.authoritativePublication===true) {
      if(!authorization.isDesktop)return Response.json({error:'Desktop publication required.'},{status:403});
      const {recordUberPublicationProgress}=await import('../../../../../lib/uber-menu-publication-store');
      try {await recordUberPublicationProgress({commandId,storeId:authorization.storeId,platform:String(commandRows[0].platform),progress:(result.progress??{}) as Record<string,unknown>});}
      catch(failure){return Response.json({error:failure instanceof Error?failure.message:'uber_publication_progress_failed'},{status:409});}
    }
    const progressRows = await sql`
      update local_bridge_commands
      set
        result = result || ${JSON.stringify(result)}::jsonb,
        last_error = ${error},
        -- Progress renews only this captured claim, never a requeued/reclaimed
        -- one. An expired lease can still be renewed while its ownership has
        -- not changed; this keeps already-running legacy workers compatible.
        -- Heartbeats cannot move the absolute execution-window deadline.
        claim_expires_at = case when command_type='reset_platform_connection' then claim_expires_at else least(
          now() + case
            when command_type in ('audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot') then interval '30 minutes'
            when command_type = 'set_inventory_availability'
              and (${authorization.isDesktop} or platform = 'rocket_now') then interval '15 minutes'
            else interval '2 minutes'
          end,
          greatest(created_at,case when payload->>'authoritativePublication'='true'
        then (payload->'manualRetryHistory'->-1->>'at')::timestamptz
        else null end,case when command_type='set_inventory_availability'
          and jsonb_typeof(payload->'manualRetryAt')='string'
          and payload->>'manualRetryAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
          and pg_input_is_valid(payload->>'manualRetryAt','timestamp with time zone')
        then case when (payload->>'manualRetryAt')::timestamptz between created_at and now()
          then (payload->>'manualRetryAt')::timestamptz else null end
        else null end) + interval '2 hours'
        ) end,
        updated_at = now()
      where id::text = ${commandId}
        and store_id::text = ${authorization.storeId}
        and status = 'processing'
        and claimed_at = ${String(commandRows[0].claimedAt ?? '')}::timestamptz
        and attempts = ${Number(commandRows[0].attempts)}
        and greatest(created_at,case when payload->>'authoritativePublication'='true'
        then (payload->'manualRetryHistory'->-1->>'at')::timestamptz
        else null end,case when command_type='set_inventory_availability'
          and jsonb_typeof(payload->'manualRetryAt')='string'
          and payload->>'manualRetryAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
          and pg_input_is_valid(payload->>'manualRetryAt','timestamp with time zone')
        then case when (payload->>'manualRetryAt')::timestamptz between created_at and now()
          then (payload->>'manualRetryAt')::timestamptz else null end
        else null end) + interval '2 hours' > now()
        and (
          ${authorization.deviceId} = ''
          or claimed_by_device_id::text = ${authorization.deviceId}
        )
      returning id::text, platform
    `;
    if (!progressRows[0]) return Response.json({ error: "Command is no longer claimable." }, { status: 409 });
    if (["publish_menu_changes", "capture_menu_snapshot"].includes(String(commandRows[0].commandType))) {
      const progress = result.progress && typeof result.progress === "object" ? result.progress as Record<string, unknown> : {};
      await sql`
        update menu_change_sync_tasks
        set status = 'processing', phase = ${cleanText(progress.phase || "processing", 60)},
          attempts = ${Number(commandRows[0].attempts ?? 1)}, error_detail = ${error}, updated_at = now()
        where command_id = ${commandId}
      `;
      await updateMenuPublishBatch(cleanText((commandRows[0].payload as Record<string, unknown>)?.batchId, 80));
    }
    await publishBridgeCommandUpdated(authorization.storeId, {
      id: commandId,
      platform: String(progressRows[0].platform ?? commandRows[0].platform ?? "uber_eats"),
      status: "processing",
      error,
      result
    }).catch(() => undefined);
    return Response.json({ ok: true });
  }

  let auditSummary: { updatedCount: number; missingCount: number } | null = null;
  if (status === "succeeded" && String(commandRows[0].commandType) === "audit_inventory") {
    const payload = commandRows[0].payload as Record<string,unknown>;
    try {
      if(authorization.isDesktop&&payload.creationHoldAuditForCommandId!==undefined) {
        const {validateCreationHoldAuditAcknowledgement}=await import('../../../../../lib/uber-creation-hold-releases');
        await validateCreationHoldAuditAcknowledgement({commandId,storeId:authorization.storeId,platform:String(commandRows[0].platform),payload,result});
      }else {
        if (!authorization.isDesktop || payload.availabilityAuthority !== 'uber_eats' || (commandRows[0].platform !== 'uber_eats' && payload.comparisonAudit !== true)) {
        throw new Error('旧形式の読取は無効です。Store から全店同期を実行してください。');
        }
        if (commandRows[0].platform === 'uber_eats') auditSummary = await applyUberAvailabilitySync(authorization.storeId, payload, result);
        await publishPublicMenuUpdatedEvent(authorization.storeId).catch(()=>undefined);
      }
    } catch (failure) {
      status = 'failed';
      error = failure instanceof Error ? failure.message : 'uber_availability_sync_failed';
    }
  }
  if (status === "succeeded" && String(commandRows[0].commandType) === "capture_competitor_menu_snapshot") {
    await applyCompetitorBridgeSnapshot(result);
  }
  const commandPayload = commandRows[0].payload as Record<string, unknown>;
  const authoritativeCapture = commandRows[0].commandType === 'capture_menu_snapshot' && commandPayload?.authoritativeSource === true;
  if(status==='succeeded' && commandPayload?.authoritativePublication===true) {
    const {recordUberPublicationProgress}=await import('../../../../../lib/uber-menu-publication-store');
    try {await recordUberPublicationProgress({commandId,storeId:authorization.storeId,platform:String(commandRows[0].platform),progress:{},result});}
    catch(failure){return Response.json({error:failure instanceof Error?failure.message:'uber_publication_verification_failed'},{status:409});}
  }
  if (status === 'succeeded' && authoritativeCapture) {
    if (!authorization.isDesktop || commandRows[0].platform !== 'uber_eats') return Response.json({error:'Desktop Uber source required.'},{status:403});
    try {
      const snapshot = result.snapshot as Record<string, unknown>;
      result.sourceImport = await ingestUberMenuSource({sourceId:String(commandPayload.sourceId),commandId,storeId:authorization.storeId,catalog:snapshot?.sourceCatalog});
      await publishPublicMenuUpdatedEvent(authorization.storeId).catch(()=>undefined);
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : 'uber_source_import_failed';
      await sql`update menu_uber_sources set last_error=${detail},updated_at=now() where id::text=${String(commandPayload.sourceId)} and store_id::text=${authorization.storeId}`;
      return Response.json({error:detail},{status:409});
    }
  }

  let nameAdapted=false;
  if(status==='failed'&&commandPayload.authoritativePublication===true&&authorization.isDesktop
    &&Number(commandRows[0].attempts)<3&&findRejectedMenuNameTargets(commandPayload,error).length) {
    const {adaptRejectedUberMenuName,MenuNameAdaptationConflict,MenuNameAdaptationFailure}=await import('../../../../../lib/uber-menu-name-adaptation-store');
    try {
      const adaptation=await adaptRejectedUberMenuName({commandId,storeId:authorization.storeId,
        platform:String(commandRows[0].platform),error,status:'processing',result,
        claim:{deviceId:authorization.deviceId,claimedAt:String(commandRows[0].claimedAt??'')}});
      nameAdapted=Boolean(adaptation);
      if(adaptation) {
        result.nameAdaptation=adaptation;
        error=`menu_name_ai_retry_prepared:${JSON.stringify(adaptation)}`;
      }
    }
    catch(failure) {
      if(failure instanceof MenuNameAdaptationConflict)return Response.json({error:'Command changed while preparing its name.'},{status:409});
      if(failure instanceof MenuNameAdaptationFailure)result.nameAdaptationDiagnostic=failure.diagnostic;
      error=failure instanceof Error?failure.message:'menu_name_ai_invalid';
    }
  }
  const stopAuthorityRetry = !nameAdapted&&(commandPayload.authoritativePublication===true||commandPayload.authoritativeSource===true)
    && menuSyncIssue(error)?.kind!=='network';
  // Name repairs were persisted and requeued atomically with their claim guard.
  const rows = nameAdapted ? [{id:commandId,status:'pending',platform:commandRows[0].platform,commandType:commandRows[0].commandType}] : status === "succeeded" ? await sql`
    update local_bridge_commands
    set
      status = 'succeeded',
      completed_at = now(),
      result = ${JSON.stringify(result)}::jsonb || case when result ? 'nameAdaptationDiagnostic'
        then jsonb_build_object('nameAdaptationDiagnostic',result->'nameAdaptationDiagnostic') else '{}'::jsonb end,
      last_error = '',
      claim_expires_at = null,
      updated_at = now()
    where id::text = ${commandId}
      and store_id::text = ${authorization.storeId}
      and status = 'processing'
      and claimed_at = ${String(commandRows[0].claimedAt ?? '')}::timestamptz
      and attempts = ${Number(commandRows[0].attempts)}
      and (
        ${authorization.deviceId} = ''
        or claimed_by_device_id::text = ${authorization.deviceId}
      )
    returning id::text, status, platform, command_type as "commandType"
  ` : await sql`
    update local_bridge_commands
    set
      status = case
        when ${stopAuthorityRetry} or command_type in ('mark_order_ready', 'set_inventory_availability', 'reset_platform_connection', 'bridge_read_probe')
          or (command_type in ('publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot') and attempts >= 3)
          or attempts >= 5 then 'failed'
        else 'pending'
      end,
      available_at = now() + (case when ${commandPayload.authoritativePublication===true||commandPayload.authoritativeSource===true} then least(120,15*power(2,greatest(0,attempts-1))) else 15 end) * interval '1 second',
      result = ${JSON.stringify(result)}::jsonb || case when result ? 'nameAdaptationDiagnostic'
        then jsonb_build_object('nameAdaptationDiagnostic',result->'nameAdaptationDiagnostic') else '{}'::jsonb end,
      last_error = ${error || "Bridge command failed."},
      claimed_by_device_id = null,
      claimed_at = null,
      claim_expires_at = null,
      completed_at = case
        when ${stopAuthorityRetry} or command_type in ('mark_order_ready', 'set_inventory_availability', 'reset_platform_connection', 'bridge_read_probe')
          or (command_type in ('publish_menu_changes', 'capture_menu_snapshot', 'capture_competitor_menu_snapshot') and attempts >= 3)
          or attempts >= 5 then now()
        else null
      end,
      updated_at = now()
    where id::text = ${commandId}
      and store_id::text = ${authorization.storeId}
      and status = 'processing'
      and claimed_at = ${String(commandRows[0].claimedAt ?? '')}::timestamptz
      and attempts = ${Number(commandRows[0].attempts)}
      and (
        ${authorization.deviceId} = ''
        or claimed_by_device_id::text = ${authorization.deviceId}
      )
    returning id::text, status, platform, command_type as "commandType"
  `;
  if (!rows[0]) return Response.json({ error: "Command is no longer claimable." }, { status: 409 });
  if (auditSummary) {
    await publishBridgeInventoryUpdated(authorization.storeId, {
      audit: true,
      ...auditSummary
    }).catch(() => undefined);
  }
  if (status === "succeeded" && String(rows[0].commandType) === "capture_menu_snapshot" && !authoritativeCapture) {
    const payload = commandRows[0].payload && typeof commandRows[0].payload === "object"
      ? commandRows[0].payload as Record<string, unknown>
      : {};
    try {
      await applyMenuSnapshotResult({
        storeId: authorization.storeId,
        platform: String(rows[0].platform ?? commandRows[0].platform ?? ""),
        payload,
        result
      });
      await sql`
        update menu_change_sync_tasks
        set status = 'succeeded', phase = 'verified', verified_at = now(), completed_at = now(),
          completion_note = 'Bridge で基準取込済み', error_code = '', error_detail = '', updated_at = now()
        where command_id = ${commandId}
      `;
    } catch (snapshotError) {
      const detail = snapshotError instanceof Error ? snapshotError.message : String(snapshotError);
      await sql`
        update menu_change_sync_tasks
        set status = 'failed', phase = 'failed', completed_at = now(),
          completion_note = 'Bridge の読取は完了しましたが、基準データの保存に失敗しました',
          error_code = 'snapshot_persistence_failed', error_detail = ${detail}, updated_at = now()
        where command_id = ${commandId}
      `;
    }
  }
  if (String(rows[0].commandType) === "publish_menu_changes") {
    const payload = commandRows[0].payload && typeof commandRows[0].payload === "object"
      ? commandRows[0].payload as Record<string, unknown>
      : {};
    if (String(rows[0].status) === "succeeded") {
      await applyMenuPublishResult({
        commandId,
        storeId: authorization.storeId,
        platform: String(rows[0].platform ?? commandRows[0].platform ?? ""),
        payload,
        result
      });
    } else {
      const retrying = String(rows[0].status) === "pending";
      await sql`
        update menu_change_sync_tasks
        set status = ${retrying ? "retrying" : "failed"}, phase = ${retrying ? "retrying" : "failed"},
          attempts = ${Number(commandRows[0].attempts ?? 1)}, error_code = ${retrying ? "bridge_retry" : "bridge_failed"},
          error_detail = ${error || "Bridge command failed."}, updated_at = now(),
          completed_at = case when ${retrying} then null else now() end
        where command_id = ${commandId}
      `;
      await updateMenuPublishBatch(cleanText(payload.batchId, 80));
    }
  }
  if (String(rows[0].commandType) === "capture_menu_snapshot" && status !== "succeeded") {
    const retrying = String(rows[0].status) === "pending";
    await sql`
      update menu_change_sync_tasks
      set status = ${retrying ? "retrying" : "failed"}, phase = ${retrying ? "retrying" : "failed"},
        attempts = ${Number(commandRows[0].attempts ?? 1)}, error_code = ${retrying ? "bridge_retry" : "bridge_failed"},
        error_detail = ${error || "Bridge command failed."}, updated_at = now(),
        completed_at = case when ${retrying} then null else now() end
      where command_id = ${commandId}
    `;
  }
  await publishBridgeCommandUpdated(authorization.storeId, {
    id: commandId,
    platform: String(rows[0].platform ?? commandRows[0].platform ?? "uber_eats"),
    status: String(rows[0].status ?? status),
    error,
    result: auditSummary ? { ...result, ...auditSummary } : result
  }).catch(() => undefined);
  if (String(rows[0].commandType) === "publish_menu_changes" && rows[0].status !== "pending") {
    const storeId = authorization.storeId;
    after(() => notifyBridgeMenuSync(storeId, commandId)
      .catch(() => console.error("bridge_menu_sync_result_notification_failed", commandId)));
  }
  if (String(rows[0].commandType) === "set_inventory_availability" && String(rows[0].status) === "failed") {
    // The command result is already durable. Notification outages cannot turn
    // its ACK into a failed request; the independent monitor also retries them.
    after(async () => {
      await notifyInventorySyncAttention(authorization.storeId).catch(() => undefined);
    });
  }
  return Response.json({ ok: true });
}
