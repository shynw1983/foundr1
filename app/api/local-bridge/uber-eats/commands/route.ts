import { sql } from "../../../../../lib/db";
import { authorizeLocalBridge } from "../../../../../lib/local-bridge-auth";
import {
  publishBridgeCommandUpdated,
  publishBridgeInventoryUpdated
} from "../../../../../lib/local-bridge-realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const platformMode = cleanText(params.get("platformMode"), 20);
  const isDesktop = authorization.devicePlatform === "desktop";
  return {
    storeId,
    isDesktop,
    supportsUber: isDesktop || ["", "uber_eats", "dual", "all"].includes(platformMode),
    supportsRocket: isDesktop || ["rocket_now", "dual", "all"].includes(platformMode),
    supportsDemae: isDesktop,
    ...authorization
  };
}

async function applyInventoryAuditResult(storeId: string, result: Record<string, unknown>) {
  const items = Array.isArray(result.items)
    ? result.items.filter((item) => (
      item && typeof item === "object"
      && (item as Record<string, unknown>).found === true
      && ["available", "sold_out"].includes(String((item as Record<string, unknown>).status ?? ""))
    ))
    : [];
  if (!items.length) return { updatedCount: 0, missingCount: Number(result.targetCount ?? 0) };
  const payload = JSON.stringify(items);
  const optionRows = await sql`
    with audited as (
      select *
      from jsonb_to_recordset(${payload}::jsonb) as value(
        kind text,
        "targetId" text,
        "isAvailable" boolean,
        found boolean,
        status text
      )
      where kind = 'option' and found = true
    )
    insert into menu_option_store_settings (
      brand_id, store_id, menu_option_id, is_available, stock_status, status_note, updated_at
    )
    select
      menu_option_groups.brand_id,
      ${storeId}::uuid,
      menu_options.id,
      audited."isAvailable",
      case when audited."isAvailable" then 'available' else 'unavailable' end,
      'Uber Eats 手動完全チェック',
      now()
    from audited
    join menu_options on menu_options.id::text = audited."targetId"
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    join store_brands
      on store_brands.brand_id = menu_option_groups.brand_id
      and store_brands.store_id::text = ${storeId}
    on conflict (store_id, menu_option_id)
    do update set
      is_available = excluded.is_available,
      stock_status = case
        when excluded.is_available = false then 'unavailable'
        when menu_option_store_settings.stock_status = 'low_stock' then 'low_stock'
        else 'available'
      end,
      status_note = excluded.status_note,
      updated_at = now()
    returning id::text
  `;
  const itemRows = await sql`
    with audited as (
      select *
      from jsonb_to_recordset(${payload}::jsonb) as value(
        kind text,
        "targetId" text,
        "isAvailable" boolean,
        found boolean,
        status text
      )
      where kind = 'item' and found = true
    )
    insert into menu_store_settings (
      brand_id, store_id, menu_catalog_item_id, is_available, stock_status, status_note, updated_at
    )
    select
      menu_catalog_items.brand_id,
      ${storeId}::uuid,
      menu_catalog_items.id,
      audited."isAvailable",
      case when audited."isAvailable" then 'available' else 'unavailable' end,
      'Uber Eats 手動完全チェック',
      now()
    from audited
    join menu_catalog_items on menu_catalog_items.id::text = audited."targetId"
    join store_brands
      on store_brands.brand_id = menu_catalog_items.brand_id
      and store_brands.store_id::text = ${storeId}
    on conflict (store_id, menu_catalog_item_id)
    do update set
      is_available = excluded.is_available,
      stock_status = case
        when excluded.is_available = false then 'unavailable'
        when menu_store_settings.stock_status = 'low_stock' then 'low_stock'
        else 'available'
      end,
      status_note = excluded.status_note,
      updated_at = now()
    returning id::text
  `;
  return {
    updatedCount: optionRows.length + itemRows.length,
    missingCount: Math.max(0, Number(result.targetCount ?? items.length) - items.length)
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
    const mergeEntries = (oldEntries: unknown, changedEntries: unknown) => {
      const merged = new Map<string, Record<string, unknown>>();
      for (const value of Array.isArray(oldEntries) ? oldEntries : []) {
        if (!value || typeof value !== "object") continue;
        const entry = value as Record<string, unknown>;
        merged.set(cleanText(entry.targetId || entry.externalId, 240), entry);
      }
      for (const value of Array.isArray(changedEntries) ? changedEntries : []) {
        if (!value || typeof value !== "object") continue;
        const entry = value as Record<string, unknown>;
        merged.set(cleanText(entry.targetId || entry.externalId, 240), entry);
      }
      return [...merged.values()];
    };
    const mergedSnapshot = {
      ...previous,
      items: mergeEntries(previous.items, snapshot.items),
      options: mergeEntries(previous.options, snapshot.options),
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
        on conflict (external_platform_id, target_type, target_id) do update set
          external_id = excluded.external_id,
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
      on conflict (external_platform_id, target_type, target_id) do update set
        external_id = excluded.external_id,
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

  // Inventory synchronization belongs exclusively to the desktop bridge. The
  // tablet bridges remain dedicated to order operations so inventory changes
  // can never navigate an order-taking tablet away from its operational page.

  await sql`
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
        (${authorization.isDesktop} and command_type in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot'))
        or (${authorization.isDesktop} = false and command_type not in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot'))
      )
      and status in ('pending', 'processing')
      and created_at < now() - interval '2 hours'
  `;

  await sql`
    update local_bridge_commands
    set
      status = case when (command_type in ('publish_menu_changes', 'capture_menu_snapshot') and attempts >= 3) or attempts >= 5 then 'failed' else 'pending' end,
      available_at = case when (command_type in ('publish_menu_changes', 'capture_menu_snapshot') and attempts >= 3) or attempts >= 5 then available_at else now() end,
      claimed_by_device_id = null,
      claimed_at = null,
      claim_expires_at = null,
      last_error = case
        when (command_type in ('publish_menu_changes', 'capture_menu_snapshot') and attempts >= 3) or attempts >= 5 then coalesce(nullif(last_error, ''), 'Bridge command timed out.')
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
        (${authorization.isDesktop} and command_type in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot'))
        or (${authorization.isDesktop} = false and command_type not in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot'))
      )
      and status = 'processing'
      and claim_expires_at < now()
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

  // Inventory availability is a desired state, not a sequence of actions. Keep
  // only the newest command that has not started. Never supersede a processing
  // command because Rocket may already have selected rows that must be saved or
  // explicitly finished before another page or command can safely take over.
  await sql`
    update local_bridge_commands as stale
    set
      status = 'failed',
      claimed_by_device_id = null,
      claimed_at = null,
      claim_expires_at = null,
      completed_at = coalesce(stale.completed_at, now()),
      result = jsonb_build_object('outcome', 'superseded'),
      last_error = 'Superseded by a newer inventory command.',
      updated_at = now()
    where stale.store_id::text = ${authorization.storeId}
      and stale.command_type = 'set_inventory_availability'
      and stale.status = 'pending'
      and (
        (stale.platform = 'uber_eats' and ${authorization.supportsUber})
        or (stale.platform = 'rocket_now' and ${authorization.supportsRocket})
        or (stale.platform = 'demae_can' and ${authorization.supportsDemae})
      )
      and ${authorization.isDesktop}
      and coalesce(stale.payload->>'inventoryKey', '') <> ''
      and exists (
        select 1
        from local_bridge_commands as newer
        where newer.store_id = stale.store_id
          and newer.platform = stale.platform
          and newer.command_type = stale.command_type
          and newer.payload->>'inventoryKey' = stale.payload->>'inventoryKey'
          and newer.created_at > stale.created_at
      )
  `;
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
        (${authorization.isDesktop} and command_type in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot'))
        or (${authorization.isDesktop} = false and command_type not in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot'))
      )
      and status = 'processing'
      and (
        claimed_by_device_id::text = ${authorization.deviceId}
        or (${authorization.deviceId} = '' and claimed_by_device_id is null)
      )
      and claim_expires_at >= now()
    order by claimed_at
    limit 1
  `;
  if (existing[0]) return Response.json({ command: existing[0] });

  const rows = await sql`
    update local_bridge_commands
    set
      status = 'processing',
      attempts = attempts + 1,
      claimed_by_device_id = ${authorization.deviceId || null}::uuid,
      claimed_at = now(),
      claim_expires_at = now() + case
        when command_type in ('audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot') then interval '30 minutes'
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
          (${authorization.isDesktop} and command_type in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot'))
          or (${authorization.isDesktop} = false and command_type not in ('set_inventory_availability', 'audit_inventory', 'publish_menu_changes', 'capture_menu_snapshot'))
        )
        and status = 'pending'
        and available_at <= now()
        and attempts < 5
      order by
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
  `;
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
  const status = cleanText(body.status, 40);
  const error = cleanText(body.error, 1000);
  const result = body.result && typeof body.result === "object"
    ? body.result as Record<string, unknown>
    : {};
  if (!commandId || !["processing", "succeeded", "failed"].includes(status)) {
    return Response.json({ error: "Invalid command acknowledgement." }, { status: 400 });
  }

  const commandRows = await sql`
    select command_type as "commandType", platform, payload, attempts
    from local_bridge_commands
    where id::text = ${commandId}
      and store_id::text = ${authorization.storeId}
      and status = 'processing'
      and (
        ${authorization.deviceId} = ''
        or claimed_by_device_id::text = ${authorization.deviceId}
      )
    limit 1
  `;
  if (!commandRows[0]) return Response.json({ error: "Command is no longer claimable." }, { status: 409 });

  if (status === "processing") {
    const progressRows = await sql`
      update local_bridge_commands
      set
        result = result || ${JSON.stringify(result)}::jsonb,
        last_error = ${error},
        updated_at = now()
      where id::text = ${commandId}
        and store_id::text = ${authorization.storeId}
        and status = 'processing'
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
    auditSummary = await applyInventoryAuditResult(authorization.storeId, result);
  }

  const rows = status === "succeeded" ? await sql`
    update local_bridge_commands
    set
      status = 'succeeded',
      completed_at = now(),
      result = ${JSON.stringify(result)}::jsonb,
      last_error = '',
      claim_expires_at = null,
      updated_at = now()
    where id::text = ${commandId}
      and store_id::text = ${authorization.storeId}
      and status = 'processing'
      and (
        ${authorization.deviceId} = ''
        or claimed_by_device_id::text = ${authorization.deviceId}
      )
    returning id::text, status, platform, command_type as "commandType"
  ` : await sql`
    update local_bridge_commands
    set
      status = case
        when command_type in ('mark_order_ready', 'set_inventory_availability')
          or (command_type in ('publish_menu_changes', 'capture_menu_snapshot') and attempts >= 3)
          or attempts >= 5 then 'failed'
        else 'pending'
      end,
      available_at = now() + interval '15 seconds',
      result = ${JSON.stringify(result)}::jsonb,
      last_error = ${error || "Bridge command failed."},
      claimed_by_device_id = null,
      claimed_at = null,
      claim_expires_at = null,
      completed_at = case
        when command_type in ('mark_order_ready', 'set_inventory_availability')
          or (command_type in ('publish_menu_changes', 'capture_menu_snapshot') and attempts >= 3)
          or attempts >= 5 then now()
        else null
      end,
      updated_at = now()
    where id::text = ${commandId}
      and store_id::text = ${authorization.storeId}
      and status = 'processing'
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
  if (status === "succeeded" && String(rows[0].commandType) === "capture_menu_snapshot") {
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
  return Response.json({ ok: true });
}
