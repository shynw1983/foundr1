import { randomUUID } from "node:crypto";
import { requireOsSession } from "../../../../../../lib/api-auth";
import { sql } from "../../../../../../lib/db";
import { publishBridgeCommandAvailable } from "../../../../../../lib/local-bridge-realtime";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../../lib/store-order-access";
import {
  resolveUberInventoryItemTarget,
  resolveUberInventoryTargets,
  type UberInventoryItemRow,
  type UberInventoryOptionRow
} from "../../../../../../lib/uber-inventory-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

async function authorizeStore(session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>, storeId: string) {
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId) ?? access.stores[0]?.id ?? "";
  return storeFilter === "__forbidden__" ? "" : storeFilter;
}

async function loadTargets(storeId: string, brandId: string, ingredientLabel: string, targetKind: "item" | "option") {
  if (targetKind === "item") {
    const rows = await sql`
      select
        menu_catalog_items.id::text,
        menu_catalog_items.brand_id::text as "brandId",
        coalesce(menu_catalog_items.external_id, '') as "externalId",
        menu_catalog_items.name,
        menu_catalog_items.display_names as "displayNames",
        coalesce(menu_store_settings.is_available, true) as "isAvailable"
      from menu_catalog_items
      join store_brands
        on store_brands.brand_id = menu_catalog_items.brand_id
        and store_brands.store_id::text = ${storeId}
      left join menu_store_settings
        on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
        and menu_store_settings.store_id::text = ${storeId}
      where menu_catalog_items.is_active = true
        and (menu_catalog_items.store_id is null or menu_catalog_items.store_id::text = ${storeId})
        and (${brandId} = '' or menu_catalog_items.brand_id::text = ${brandId})
      order by menu_catalog_items.sort_order
    `;
    return resolveUberInventoryItemTarget(ingredientLabel, rows as UberInventoryItemRow[]);
  }
  const rows = await sql`
    select
      menu_options.id::text,
      menu_option_groups.brand_id::text as "brandId",
      menu_option_groups.group_key as "groupKey",
      menu_options.option_key as "optionKey",
      coalesce(menu_options.external_id, '') as "externalId",
      menu_options.name,
      menu_options.display_names as "displayNames",
      coalesce(menu_option_store_settings.is_available, true) as "isAvailable"
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
      and (${brandId} = '' or menu_option_groups.brand_id::text = ${brandId})
    order by menu_option_groups.sort_order, menu_options.sort_order
  `;
  return resolveUberInventoryTargets(ingredientLabel, rows as UberInventoryOptionRow[]);
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const storeId = await authorizeStore(session, text(params.get("storeId"), 80));
  const commandId = text(params.get("commandId"), 80);
  if (!storeId || !commandId) return Response.json({ error: "状態を確認できません。" }, { status: 400 });
  const rows = await sql`
    select status, result, last_error as "lastError", completed_at::text as "completedAt"
    from local_bridge_commands
    where id::text = ${commandId}
      and store_id::text = ${storeId}
      and command_type = 'set_inventory_availability'
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
  if (!storeId || !ingredientLabel || !["preview", "apply"].includes(action)) {
    return Response.json({ error: "食材と操作内容を確認してください。" }, { status: 400 });
  }

  const resolved = await loadTargets(storeId, brandId, ingredientLabel, targetKind);
  if (!resolved.targets.length) {
    return Response.json({
      error: targetKind === "item"
        ? "この商品に対応する Uber Eats の商品が一意に見つかりません。メニュー連携設定を確認してください。"
        : "この食材に対応する Uber Eats の商品・選択肢が見つかりません。メニュー連携設定を確認してください。",
      ...resolved
    }, { status: 409 });
  }
  if (action === "preview") return Response.json(resolved);

  const note = `厨房画面: ${resolved.ingredientLabel}${isAvailable ? " 販売再開" : " 在庫切れ"}`;
  for (const target of resolved.targets) {
    if (target.kind === "item") {
      await sql`
        insert into menu_store_settings (
          brand_id, store_id, menu_catalog_item_id, is_available, status_note, updated_by, updated_at
        )
        values (
          ${target.brandId}, ${storeId}, ${target.menuCatalogItemId}, ${isAvailable}, ${note}, ${session.id}, now()
        )
        on conflict (store_id, menu_catalog_item_id)
        do update set
          is_available = excluded.is_available,
          status_note = excluded.status_note,
          updated_by = excluded.updated_by,
          updated_at = now()
      `;
    } else {
      await sql`
        insert into menu_option_store_settings (
          brand_id, store_id, menu_option_id, is_available, status_note, updated_by, updated_at
        )
        values (
          ${target.brandId}, ${storeId}, ${target.menuOptionId}, ${isAvailable}, ${note}, ${session.id}, now()
        )
        on conflict (store_id, menu_option_id)
        do update set
          is_available = excluded.is_available,
          status_note = excluded.status_note,
          updated_by = excluded.updated_by,
          updated_at = now()
      `;
    }
  }

  const commandId = randomUUID();
  const idempotencyKey = `uber_eats:set_inventory:${storeId}:${resolved.inventoryKey}:${isAvailable ? "available" : "sold_out"}:${commandId}`;
  const commandRows = await sql`
    insert into local_bridge_commands (
      id, store_id, platform, command_type, idempotency_key, payload
    )
    values (
      ${commandId},
      ${storeId},
      'uber_eats',
      'set_inventory_availability',
      ${idempotencyKey},
      ${JSON.stringify({
        inventoryKey: resolved.inventoryKey,
        ingredientLabel: resolved.ingredientLabel,
        isAvailable,
        soldOutMode: "indefinite",
        targets: resolved.targets.map((target) => ({
          kind: target.kind,
          targetId: target.targetId,
          label: target.label,
          aliases: target.aliases
        }))
      })}::jsonb
    )
    returning id::text
  `;
  await publishBridgeCommandAvailable(storeId).catch(() => undefined);
  return Response.json({
    ok: true,
    commandId: String(commandRows[0]?.id ?? commandId),
    isAvailable,
    ...resolved
  });
}
