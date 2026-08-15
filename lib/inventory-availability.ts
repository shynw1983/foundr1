import { randomUUID } from "node:crypto";
import { sql } from "./db";
import {
  publishBridgeCommandAvailable,
  publishBridgeInventorySyncStarted
} from "./local-bridge-realtime";
import { publishPublicMenuUpdatedEvent } from "./order-realtime";
import {
  resolveUberInventoryItemTarget,
  resolveUberInventoryTargets,
  type UberInventoryItemRow,
  type UberInventoryItemTarget,
  type UberInventoryOptionRow,
  type UberInventoryTarget
} from "./uber-inventory-targets";
import { projectInventoryTargetsForPlatform } from "./inventory-platform-targets";

export type InventoryAvailabilityResolution = {
  inventoryKey: string;
  ingredientLabel: string;
  targets: Array<UberInventoryItemTarget | UberInventoryTarget>;
};

type InventoryPlatform = "uber_eats" | "rocket_now" | "demae_can";
type InventoryStockStatus = "available" | "low_stock" | "unavailable";

export async function loadInventoryAvailabilityTargets(
  storeId: string,
  brandId: string,
  ingredientLabel: string,
  targetKind: "item" | "option"
): Promise<InventoryAvailabilityResolution> {
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

export async function applyInventoryAvailability(input: {
  storeId: string;
  resolution: InventoryAvailabilityResolution;
  isAvailable: boolean;
  stockStatus?: InventoryStockStatus;
  persistOverall?: boolean;
  platforms?: InventoryPlatform[];
  platformStates?: Partial<Record<InventoryPlatform, boolean>>;
  platformOverride?: {
    platform: "foundr1" | InventoryPlatform;
    availability: "follow" | "available" | "unavailable";
  };
  statusSource: string;
  syncSource?: "siri" | "store";
  feedbackLabel?: string;
  updatedBy: string | null;
}) {
  const { storeId, resolution, isAvailable } = input;
  const syncRunId = randomUUID();
  const syncSource = input.syncSource ?? (input.statusSource === "Siri" ? "siri" : "store");
  const feedbackLabel = input.feedbackLabel?.trim() || resolution.ingredientLabel;
  const stockStatus = input.stockStatus ?? (isAvailable ? "available" : "unavailable");
  const note = `${input.statusSource}: ${resolution.ingredientLabel}${isAvailable ? " 販売再開" : " 在庫切れ"}`;
  for (const target of resolution.targets) {
    if (input.persistOverall !== false && target.kind === "item") {
      await sql`
        insert into menu_store_settings (
          brand_id, store_id, menu_catalog_item_id, is_available, stock_status, status_note, updated_by, updated_at
        )
        values (
          ${target.brandId}, ${storeId}, ${target.menuCatalogItemId}, ${isAvailable}, ${stockStatus}, ${note}, ${input.updatedBy}, now()
        )
        on conflict (store_id, menu_catalog_item_id)
        do update set
          is_available = excluded.is_available,
          stock_status = excluded.stock_status,
          status_note = excluded.status_note,
          updated_by = excluded.updated_by,
          updated_at = now()
      `;
    } else if (input.persistOverall !== false && target.kind === "option") {
      await sql`
        insert into menu_option_store_settings (
          brand_id, store_id, menu_option_id, is_available, stock_status, status_note, updated_by, updated_at
        )
        values (
          ${target.brandId}, ${storeId}, ${target.menuOptionId}, ${isAvailable}, ${stockStatus}, ${note}, ${input.updatedBy}, now()
        )
        on conflict (store_id, menu_option_id)
        do update set
          is_available = excluded.is_available,
          stock_status = excluded.stock_status,
          status_note = excluded.status_note,
          updated_by = excluded.updated_by,
          updated_at = now()
      `;
    }
    if (input.platformOverride) {
      const targetId = target.kind === "item" ? target.menuCatalogItemId : target.menuOptionId;
      if (input.platformOverride.platform === "foundr1") {
        if (target.kind === "item") {
          await sql`
            insert into menu_store_settings (brand_id, store_id, menu_catalog_item_id, updated_by, updated_at)
            values (${target.brandId}, ${storeId}, ${target.menuCatalogItemId}, ${input.updatedBy}, now())
            on conflict (store_id, menu_catalog_item_id) do nothing
          `;
        } else {
          await sql`
            insert into menu_option_store_settings (brand_id, store_id, menu_option_id, updated_by, updated_at)
            values (${target.brandId}, ${storeId}, ${target.menuOptionId}, ${input.updatedBy}, now())
            on conflict (store_id, menu_option_id) do nothing
          `;
        }
      }
      if (input.platformOverride.availability === "follow") {
        await sql`
          delete from menu_platform_availability_settings
          where store_id::text = ${storeId}
            and target_kind = ${target.kind}
            and target_id::text = ${targetId}
            and platform = ${input.platformOverride.platform}
        `;
      } else {
        await sql`
          insert into menu_platform_availability_settings (
            brand_id, store_id, target_kind, target_id, platform, availability, updated_by, updated_at
          ) values (
            ${target.brandId}, ${storeId}, ${target.kind}, ${targetId},
            ${input.platformOverride.platform}, ${input.platformOverride.availability}, ${input.updatedBy}, now()
          )
          on conflict (store_id, target_kind, target_id, platform)
          do update set
            availability = excluded.availability,
            updated_by = excluded.updated_by,
            updated_at = now()
        `;
      }
    }
  }

  const sourceRows = await sql`
    select distinct source_platform as platform
    from store_sales_sources
    where store_id::text = ${storeId}
      and source_platform in ('uber_eats', 'rocket_now', 'demae_can')
      and is_enabled = true
  `;
  let configuredPlatforms = sourceRows
    .map((row) => String(row.platform))
    .filter((platform) => ["uber_eats", "rocket_now", "demae_can"].includes(platform));
  const platforms = configuredPlatforms.length ? configuredPlatforms : ["uber_eats"];
  if (input.platforms) {
    configuredPlatforms = platforms.filter((platform) => input.platforms?.includes(platform as InventoryPlatform));
  } else {
    configuredPlatforms = platforms;
  }
  const commandRows: Array<{ id: string; platform: string; status: "pending" | "succeeded"; error: string }> = [];
  for (const platform of configuredPlatforms) {
    const platformIsAvailable = input.platformStates?.[platform as InventoryPlatform] ?? isAvailable;
    const platformCommandId = randomUUID();
    const operation = platform === "rocket_now"
      ? (platformIsAvailable ? "unhide" : "hide")
      : platform === "demae_can"
        ? (platformIsAvailable ? "available" : "stockout")
        : (platformIsAvailable ? "available" : "sold_out");
    const projectedTargets = projectInventoryTargetsForPlatform(
      platform as "uber_eats" | "rocket_now" | "demae_can",
      resolution.targets
    );
    const serializedTargets = projectedTargets.map((target) => ({
      kind: target.kind,
      targetId: target.targetId,
      groupKey: target.kind === "option" ? target.groupKey : "",
      label: target.label,
      aliases: target.aliases
    }));
    const commandTargets = platform === "rocket_now" || platform === "demae_can"
      ? Array.from(new Map(serializedTargets.map((target) => [target.label.trim(), target])).values())
      : serializedTargets;
    await sql`
      update local_bridge_commands
      set
        status = 'failed',
        claimed_by_device_id = null,
        claimed_at = null,
        claim_expires_at = null,
        completed_at = coalesce(completed_at, now()),
        result = jsonb_build_object('outcome', 'superseded'),
        last_error = 'Superseded by a newer inventory command.',
        updated_at = now()
      where store_id::text = ${storeId}
        and platform = ${platform}
        and command_type = 'set_inventory_availability'
        and status = 'pending'
        and payload->>'inventoryKey' = ${resolution.inventoryKey}
    `;
    const idempotencyKey = `${platform}:set_inventory:${storeId}:${resolution.inventoryKey}:${operation}:${platformCommandId}`;
    const payload = JSON.stringify({
      inventoryKey: resolution.inventoryKey,
      ingredientLabel: resolution.ingredientLabel,
      syncRunId,
      syncSource,
      feedbackLabel,
      isAvailable: platformIsAvailable,
      operation,
      soldOutMode: "indefinite",
      targets: commandTargets
    });
    if (!commandTargets.length) {
      await sql`
        insert into local_bridge_commands (
          id, store_id, platform, command_type, idempotency_key, payload,
          status, completed_at, result, updated_at
        )
        values (
          ${platformCommandId}, ${storeId}, ${platform}, 'set_inventory_availability',
          ${idempotencyKey}, ${payload}::jsonb, 'succeeded', now(),
          ${JSON.stringify({ outcome: "not_applicable", changed: 0 })}::jsonb, now()
        )
      `;
      commandRows.push({
        id: platformCommandId,
        platform,
        status: "succeeded",
        error: "该平台未上架（不适用）"
      });
      continue;
    }
    const rows = await sql`
      insert into local_bridge_commands (
        id, store_id, platform, command_type, idempotency_key, payload
      )
      values (
        ${platformCommandId}, ${storeId}, ${platform}, 'set_inventory_availability',
        ${idempotencyKey}, ${payload}::jsonb
      )
      returning id::text
    `;
    commandRows.push({
      id: String(rows[0]?.id ?? platformCommandId),
      platform,
      status: "pending",
      error: ""
    });
  }
  const syncRun = {
    id: syncRunId,
    itemLabel: feedbackLabel,
    isAvailable,
    source: syncSource,
    createdAt: new Date().toISOString(),
    platforms: [
      { commandId: `${syncRunId}-foundr1`, platform: "foundr1", status: "succeeded", error: "" },
      ...commandRows.map((command) => ({
        commandId: command.id,
        platform: command.platform,
        status: command.status,
        error: command.error
      }))
    ]
  };
  await publishBridgeCommandAvailable(storeId).catch(() => undefined);
  await publishBridgeInventorySyncStarted(storeId, syncRun).catch(() => undefined);
  await publishPublicMenuUpdatedEvent(storeId).catch(() => undefined);
  return { commands: commandRows, note, syncRun };
}
