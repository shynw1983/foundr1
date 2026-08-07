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
  const storeId = cleanText(new URL(request.url).searchParams.get("storeId"), 80);
  const authorization = await authorizeLocalBridge(request, storeId);
  return { storeId, ...authorization };
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
      brand_id, store_id, menu_option_id, is_available, status_note, updated_at
    )
    select
      menu_option_groups.brand_id,
      ${storeId}::uuid,
      menu_options.id,
      audited."isAvailable",
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
      brand_id, store_id, menu_catalog_item_id, is_available, status_note, updated_at
    )
    select
      menu_catalog_items.brand_id,
      ${storeId}::uuid,
      menu_catalog_items.id,
      audited."isAvailable",
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
      and platform = 'uber_eats'
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
      and platform = 'uber_eats'
      and status = 'processing'
      and claim_expires_at < now()
  `;

  const existing = await sql`
    select
      id::text,
      command_type as type,
      payload,
      attempts
    from local_bridge_commands
    where store_id::text = ${authorization.storeId}
      and platform = 'uber_eats'
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
        else interval '2 minutes'
      end,
      updated_at = now()
    where id = (
      select id
      from local_bridge_commands
      where store_id::text = ${authorization.storeId}
        and platform = 'uber_eats'
        and status = 'pending'
        and available_at <= now()
        and attempts < 5
      order by created_at
      for update skip locked
      limit 1
    )
    returning
      id::text,
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
  if (!commandId || !["succeeded", "failed"].includes(status)) {
    return Response.json({ error: "Invalid command acknowledgement." }, { status: 400 });
  }

  const commandRows = await sql`
    select command_type as "commandType"
    from local_bridge_commands
    where id::text = ${commandId}
      and store_id::text = ${authorization.storeId}
      and platform = 'uber_eats'
      and status = 'processing'
      and (
        ${authorization.deviceId} = ''
        or claimed_by_device_id::text = ${authorization.deviceId}
      )
    limit 1
  `;
  if (!commandRows[0]) return Response.json({ error: "Command is no longer claimable." }, { status: 409 });
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
      and platform = 'uber_eats'
      and status = 'processing'
      and (
        ${authorization.deviceId} = ''
        or claimed_by_device_id::text = ${authorization.deviceId}
      )
    returning id::text, status, command_type as "commandType"
  ` : await sql`
    update local_bridge_commands
    set
      status = case
        when command_type = 'mark_order_ready' or attempts >= 5 then 'failed'
        else 'pending'
      end,
      available_at = now() + interval '15 seconds',
      result = ${JSON.stringify(result)}::jsonb,
      last_error = ${error || "Bridge command failed."},
      claimed_by_device_id = null,
      claimed_at = null,
      claim_expires_at = null,
      completed_at = case
        when command_type = 'mark_order_ready' or attempts >= 5 then now()
        else null
      end,
      updated_at = now()
    where id::text = ${commandId}
      and store_id::text = ${authorization.storeId}
      and platform = 'uber_eats'
      and status = 'processing'
      and (
        ${authorization.deviceId} = ''
        or claimed_by_device_id::text = ${authorization.deviceId}
      )
    returning id::text, status, command_type as "commandType"
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
    status: String(rows[0].status ?? status),
    error,
    result: auditSummary ? { ...result, ...auditSummary } : result
  }).catch(() => undefined);
  return Response.json({ ok: true });
}
