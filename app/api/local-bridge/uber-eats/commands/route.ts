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
        (${authorization.isDesktop} and command_type = 'set_inventory_availability')
        or (${authorization.isDesktop} = false and command_type <> 'set_inventory_availability')
      )
      and status in ('pending', 'processing')
      and created_at < now() - interval '2 hours'
  `;

  await sql`
    update local_bridge_commands
    set
      status = case when attempts >= 5 then 'failed' else 'pending' end,
      available_at = case when attempts >= 5 then available_at else now() end,
      claimed_by_device_id = null,
      claimed_at = null,
      claim_expires_at = null,
      last_error = case
        when attempts >= 5 then coalesce(nullif(last_error, ''), 'Bridge command timed out.')
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
        (${authorization.isDesktop} and command_type = 'set_inventory_availability')
        or (${authorization.isDesktop} = false and command_type <> 'set_inventory_availability')
      )
      and status = 'processing'
      and claim_expires_at < now()
  `;

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
        (${authorization.isDesktop} and command_type = 'set_inventory_availability')
        or (${authorization.isDesktop} = false and command_type <> 'set_inventory_availability')
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
        when command_type = 'audit_inventory' then interval '30 minutes'
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
          (${authorization.isDesktop} and command_type = 'set_inventory_availability')
          or (${authorization.isDesktop} = false and command_type <> 'set_inventory_availability')
        )
        and status = 'pending'
        and available_at <= now()
        and attempts < 5
      order by created_at
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
    select command_type as "commandType", platform
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
        when command_type in ('mark_order_ready', 'set_inventory_availability') or attempts >= 5 then 'failed'
        else 'pending'
      end,
      available_at = now() + interval '15 seconds',
      result = ${JSON.stringify(result)}::jsonb,
      last_error = ${error || "Bridge command failed."},
      claimed_by_device_id = null,
      claimed_at = null,
      claim_expires_at = null,
      completed_at = case
        when command_type in ('mark_order_ready', 'set_inventory_availability') or attempts >= 5 then now()
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
  await publishBridgeCommandUpdated(authorization.storeId, {
    id: commandId,
    platform: String(rows[0].platform ?? commandRows[0].platform ?? "uber_eats"),
    status: String(rows[0].status ?? status),
    error,
    result: auditSummary ? { ...result, ...auditSummary } : result
  }).catch(() => undefined);
  return Response.json({ ok: true });
}
