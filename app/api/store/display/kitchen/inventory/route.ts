import { randomUUID } from "node:crypto";
import { requireOsSession } from "../../../../../../lib/api-auth";
import { sql } from "../../../../../../lib/db";
import {
  applyInventoryAvailability,
  loadInventoryAvailabilityTargets
} from "../../../../../../lib/inventory-availability";
import { publishBridgeCommandAvailable } from "../../../../../../lib/local-bridge-realtime";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../../lib/store-order-access";
import {
  resolveUberInventoryTargets,
  type UberInventoryItemRow,
  type UberInventoryOptionRow
} from "../../../../../../lib/uber-inventory-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function inventoryDisplayLabel(
  name: string,
  statusNote: string,
  displayNames: Record<string, unknown> | null
) {
  const note = text(statusNote);
  const kitchenMatch = note.match(/^(?:厨房画面|販売状態):\s*(.+?)\s+(?:在庫切れ|販売再開)$/u);
  if (kitchenMatch?.[1]) return kitchenMatch[1].trim();
  const bridgeMatch = note.match(/^Uber Eats Bridge:\s*(.+?)\s+(?:売り切れ|在庫あり)(?:\s|$)/u);
  const bridgeLabels = bridgeMatch?.[1]?.split(/[｜|]/u).map((value) => value.trim()).filter(Boolean) ?? [];
  const localizedName = text(displayNames?.zh, 500);
  return bridgeLabels[1] || localizedName || bridgeLabels[0] || name;
}

function inventoryAliases(name: string, displayNames: Record<string, unknown> | null) {
  return Array.from(new Set([
    name,
    ...Object.values(displayNames && typeof displayNames === "object" ? displayNames : {}).map(String)
  ].map((value) => value.trim()).filter(Boolean)));
}

async function authorizeStore(session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>, storeId: string) {
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId) ?? access.stores[0]?.id ?? "";
  return storeFilter === "__forbidden__" ? "" : storeFilter;
}

async function loadInventoryAuditTargets(storeId: string) {
  const optionRows = await sql`
    select
      menu_options.id::text,
      menu_option_groups.brand_id::text as "brandId",
      menu_option_groups.group_key as "groupKey",
      menu_options.name,
      menu_options.display_names as "displayNames"
    from menu_options
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    join store_brands
      on store_brands.brand_id = menu_option_groups.brand_id
      and store_brands.store_id::text = ${storeId}
    where menu_options.is_active = true
      and menu_option_groups.is_active = true
    order by menu_option_groups.sort_order, menu_options.sort_order
  `;
  const itemRows = await sql`
    select
      menu_catalog_items.id::text,
      menu_catalog_items.brand_id::text as "brandId",
      menu_catalog_items.name,
      menu_catalog_items.display_names as "displayNames"
    from menu_catalog_items
    join store_brands
      on store_brands.brand_id = menu_catalog_items.brand_id
      and store_brands.store_id::text = ${storeId}
    where menu_catalog_items.is_active = true
      and (menu_catalog_items.store_id is null or menu_catalog_items.store_id::text = ${storeId})
    order by menu_catalog_items.sort_order
  `;
  return [
    ...itemRows.map((row) => ({
      kind: "item",
      targetId: String(row.id),
      brandId: String(row.brandId),
      groupKey: "",
      label: String(row.name),
      aliases: inventoryAliases(String(row.name), row.displayNames as Record<string, unknown> | null)
    })),
    ...optionRows.map((row) => ({
      kind: "option",
      targetId: String(row.id),
      brandId: String(row.brandId),
      groupKey: String(row.groupKey),
      label: String(row.name),
      aliases: inventoryAliases(String(row.name), row.displayNames as Record<string, unknown> | null)
    }))
  ];
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const storeId = await authorizeStore(session, text(params.get("storeId"), 80));
  const commandId = text(params.get("commandId"), 80);
  if (!storeId) return Response.json({ error: "状態を確認できません。" }, { status: 400 });
  if (!commandId) {
    const optionRows = await sql`
      select
        menu_options.id::text,
        menu_option_groups.brand_id::text as "brandId",
        menu_option_groups.group_key as "groupKey",
        menu_options.option_key as "optionKey",
        coalesce(menu_options.external_id, '') as "externalId",
        menu_options.name,
        menu_options.display_names as "displayNames",
        coalesce(menu_option_store_settings.is_available, true) as "isAvailable",
        coalesce(menu_option_store_settings.status_note, '') as "statusNote"
      from menu_options
      join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
      join store_brands
        on store_brands.brand_id = menu_option_groups.brand_id
        and store_brands.store_id::text = ${storeId}
      left join menu_option_store_settings
        on menu_option_store_settings.menu_option_id = menu_options.id
        and menu_option_store_settings.store_id::text = ${storeId}
      where menu_options.is_active = true
        and menu_option_groups.is_active = true
      order by menu_option_groups.sort_order, menu_options.sort_order
    `;
    const optionGroups = new Map<string, Record<string, unknown>>();
    for (const row of optionRows as Array<UberInventoryOptionRow & { statusNote: string }>) {
      if (row.isAvailable) continue;
      const brandRows = (optionRows as Array<UberInventoryOptionRow & { statusNote: string }>)
        .filter((candidate) => candidate.brandId === row.brandId);
      const label = inventoryDisplayLabel(row.name, row.statusNote, row.displayNames);
      const resolved = resolveUberInventoryTargets(label, brandRows);
      if (!resolved.targets.length) continue;
      const key = `${row.brandId}:option:${resolved.inventoryKey}`;
      if (optionGroups.has(key)) continue;
      const preferredTarget = resolved.targets.find((target) => (
        /noodle/i.test(target.groupKey) && !/replacement/i.test(target.groupKey)
      )) ?? resolved.targets[0];
      const preferredRow = brandRows.find((candidate) => candidate.id === preferredTarget?.targetId);
      const displayLabel = /^厨房画面:/u.test(row.statusNote)
        ? label
        : preferredRow
          ? inventoryDisplayLabel(preferredRow.name, preferredRow.statusNote, preferredRow.displayNames)
          : label;
      optionGroups.set(key, {
        inventoryKey: resolved.inventoryKey,
        ingredientLabel: displayLabel,
        targetKind: "option",
        brandId: row.brandId,
        targets: resolved.targets.map((target) => ({
          kind: target.kind,
          targetId: target.targetId,
          groupKey: target.groupKey,
          label: target.label,
          isAvailable: target.isAvailable
        }))
      });
    }

    const itemRows = await sql`
      select
        menu_catalog_items.id::text,
        menu_catalog_items.brand_id::text as "brandId",
        coalesce(menu_catalog_items.external_id, '') as "externalId",
        menu_catalog_items.name,
        menu_catalog_items.display_names as "displayNames",
        coalesce(menu_store_settings.is_available, true) as "isAvailable",
        coalesce(menu_store_settings.status_note, '') as "statusNote"
      from menu_catalog_items
      join store_brands
        on store_brands.brand_id = menu_catalog_items.brand_id
        and store_brands.store_id::text = ${storeId}
      left join menu_store_settings
        on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
        and menu_store_settings.store_id::text = ${storeId}
      where menu_catalog_items.is_active = true
        and (menu_catalog_items.store_id is null or menu_catalog_items.store_id::text = ${storeId})
      order by menu_catalog_items.sort_order
    `;
    const itemGroups = (itemRows as Array<UberInventoryItemRow & { statusNote: string }>)
      .filter((row) => !row.isAvailable)
      .map((row) => ({
        inventoryKey: `item:${row.externalId || row.id}`,
        ingredientLabel: inventoryDisplayLabel(row.name, row.statusNote, row.displayNames),
        targetKind: "item" as const,
        brandId: row.brandId,
        targets: [{
          kind: "item" as const,
          targetId: row.id,
          groupKey: "",
          label: row.name,
          aliases: inventoryAliases(row.name, row.displayNames),
          isAvailable: false
        }]
      }));

    return Response.json({
      items: [...optionGroups.values(), ...itemGroups]
    }, { headers: { "Cache-Control": "no-store" } });
  }
  const rows = await sql`
    select status, result, last_error as "lastError", completed_at::text as "completedAt"
    from local_bridge_commands
    where id::text = ${commandId}
      and store_id::text = ${storeId}
      and command_type in ('set_inventory_availability', 'audit_inventory')
    limit 1
  `;
  if (!rows[0]) return Response.json({ error: "同期指示が見つかりません。" }, { status: 404 });
  return Response.json(rows[0], { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const storeId = await authorizeStore(session, text(body.storeId, 80));
  const ingredientLabel = text(body.ingredientLabel);
  const brandId = text(body.brandId, 80);
  const action = text(body.action, 40) || "preview";
  const targetKind = body.targetKind === "item" ? "item" : "option";
  const isAvailable = body.isAvailable === true;
  const statusSource = body.source === "sales_status" ? "販売状態" : "厨房画面";
  if (!storeId || !["preview", "apply", "audit"].includes(action)) {
    return Response.json({ error: "食材と操作内容を確認してください。" }, { status: 400 });
  }

  if (action === "audit") {
    const activeRows = await sql`
      select id::text, payload
      from local_bridge_commands
      where store_id::text = ${storeId}
        and platform = 'uber_eats'
        and command_type = 'audit_inventory'
        and status = 'pending'
      order by created_at desc
      limit 1
    `;
    if (activeRows[0]) {
      const activePayload = activeRows[0].payload as { targets?: unknown[] } | null;
      return Response.json({
        ok: true,
        commandId: String(activeRows[0].id),
        targetCount: Array.isArray(activePayload?.targets) ? activePayload.targets.length : 0,
        existing: true
      });
    }
    const targets = await loadInventoryAuditTargets(storeId);
    if (!targets.length) {
      return Response.json({ error: "チェック対象の Uber メニューがありません。" }, { status: 409 });
    }
    const commandId = randomUUID();
    await sql`
      insert into local_bridge_commands (
        id, store_id, platform, command_type, idempotency_key, payload
      )
      values (
        ${commandId},
        ${storeId},
        'uber_eats',
        'audit_inventory',
        ${`uber_eats:audit_inventory:${storeId}:${commandId}`},
        ${JSON.stringify({ targets })}::jsonb
      )
    `;
    await publishBridgeCommandAvailable(storeId).catch(() => undefined);
    return Response.json({ ok: true, commandId, targetCount: targets.length, existing: false });
  }

  if (!ingredientLabel) {
    return Response.json({ error: "食材を確認してください。" }, { status: 400 });
  }

  const resolved = await loadInventoryAvailabilityTargets(storeId, brandId, ingredientLabel, targetKind);
  if (!resolved.targets.length) {
    return Response.json({
      error: targetKind === "item"
        ? "この商品に対応する Uber Eats の商品が一意に見つかりません。メニュー連携設定を確認してください。"
        : "この食材に対応する Uber Eats の商品・選択肢が見つかりません。メニュー連携設定を確認してください。",
      ...resolved
    }, { status: 409 });
  }
  if (action === "preview") return Response.json(resolved);

  const applied = await applyInventoryAvailability({
    storeId,
    resolution: resolved,
    isAvailable,
    statusSource,
    updatedBy: session.id
  });
  return Response.json({
    ok: true,
    commandId: applied.commands[0]?.id ?? "",
    commands: applied.commands,
    isAvailable,
    ...resolved
  });
}
