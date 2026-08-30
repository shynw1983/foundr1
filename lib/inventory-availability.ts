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
import {
  inventoryPlatformExternalIds,
  loadInventoryPlatformExternalIdMap
} from "./inventory-platform-object-mappings";
import { loadLinkedMenuTargets } from "./menu-availability-links";
import { shouldResetPlatformAvailabilityOverrides } from "./inventory-availability-policy";

type InventoryAvailabilityTarget = (UberInventoryItemTarget | UberInventoryTarget) & {
  linkedByDependency?: boolean;
};

export type InventoryAvailabilityResolution = {
  inventoryKey: string;
  ingredientLabel: string;
  targets: InventoryAvailabilityTarget[];
};

type InventoryPlatform = "uber_eats" | "rocket_now" | "demae_can";
type InventoryStockStatus = "available" | "low_stock" | "unavailable";

export async function loadInventoryAvailabilityTargets(
  storeId: string,
  brandId: string,
  ingredientLabel: string,
  targetKind: "item" | "option"
): Promise<InventoryAvailabilityResolution> {
  let resolution: InventoryAvailabilityResolution;
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
    resolution = resolveUberInventoryItemTarget(ingredientLabel, rows as UberInventoryItemRow[]);
  } else {
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
    resolution = resolveUberInventoryTargets(ingredientLabel, rows as UberInventoryOptionRow[]);
  }

  if (!resolution.targets.length) return resolution;
  const dependentItems = (await loadLinkedMenuTargets({ storeId, brandId, sourceTargets: resolution.targets }))
    .map((target) => ({ ...target, linkedByDependency: true }));
  const targets = Array.from(new Map([
    ...dependentItems,
    ...resolution.targets
  ].map((target) => [`${target.kind}:${target.targetId}`, target])).values());
  return { ...resolution, targets };
}

export async function applyInventoryAvailability(input: {
  storeId: string;
  resolution: InventoryAvailabilityResolution;
  isAvailable: boolean;
  stockStatus?: InventoryStockStatus;
  persistOverall?: boolean;
  resetPlatformOverrides?: boolean;
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
  const effectiveAvailability = new Map<string, boolean>();
  const targetRows = resolution.targets.map((target) => ({
    target,
    brandId: target.brandId,
    targetKind: target.kind,
    targetId: target.kind === "item" ? target.menuCatalogItemId : target.menuOptionId,
    linked: target.linkedByDependency === true
  }));
  const persistRows = input.persistOverall === false
    ? []
    : targetRows.filter((row) => !(stockStatus === "low_stock" && row.linked));
  const persistJson = JSON.stringify(persistRows.map(({ brandId, targetKind, targetId, linked }) => ({
    brandId, targetKind, targetId, linked
  })));

  const resetPlatformOverrides = shouldResetPlatformAvailabilityOverrides({
    requestedReset: input.resetPlatformOverrides,
    persistOverall: input.persistOverall,
    stockStatus,
    hasPlatformOverride: Boolean(input.platformOverride)
  });
  if (resetPlatformOverrides && targetRows.length) {
    const resetJson = JSON.stringify(targetRows.map(({ targetKind, targetId }) => ({ targetKind, targetId })));
    await sql`
      with targets as (
        select * from jsonb_to_recordset(${resetJson}::jsonb) as value("targetKind" text, "targetId" uuid)
      )
      delete from menu_platform_availability_settings settings
      using targets
      where settings.store_id::text = ${storeId}
        and settings.target_kind = targets."targetKind"
        and settings.target_id = targets."targetId"
        and settings.platform in ('uber_eats', 'rocket_now', 'demae_can')
    `;
  }

  if (persistRows.length) {
    if (!isAvailable && stockStatus === "unavailable") {
      await sql`
        with targets as (
          select * from jsonb_to_recordset(${persistJson}::jsonb)
            as x("brandId" text, "targetKind" text, "targetId" text, linked boolean)
        )
        insert into menu_inventory_availability_blocks (
          store_id, brand_id, target_kind, target_id, inventory_key, source_label, updated_at
        )
        select
          ${storeId}::uuid, targets."brandId"::uuid, targets."targetKind", targets."targetId"::uuid,
          ${"manual-existing:"} || targets."targetId", '既存の手動欠品', now()
        from targets
        where targets.linked = true
          and not exists (
            select 1 from menu_inventory_availability_blocks blocks
            where blocks.store_id::text = ${storeId}
              and blocks.target_kind = targets."targetKind"
              and blocks.target_id::text = targets."targetId"
          )
          and (
            (targets."targetKind" = 'item' and exists (
              select 1 from menu_store_settings settings
              where settings.store_id::text = ${storeId}
                and settings.menu_catalog_item_id::text = targets."targetId"
                and settings.is_available = false
            ))
            or (targets."targetKind" = 'option' and exists (
              select 1 from menu_option_store_settings settings
              where settings.store_id::text = ${storeId}
                and settings.menu_option_id::text = targets."targetId"
                and settings.is_available = false
            ))
          )
        on conflict do nothing
      `;
      await sql`
        with targets as (
          select * from jsonb_to_recordset(${persistJson}::jsonb)
            as x("brandId" text, "targetKind" text, "targetId" text, linked boolean)
        )
        insert into menu_inventory_availability_blocks (
          store_id, brand_id, target_kind, target_id, inventory_key, source_label, updated_at
        )
        select
          ${storeId}::uuid, targets."brandId"::uuid, targets."targetKind", targets."targetId"::uuid,
          ${resolution.inventoryKey}, ${resolution.ingredientLabel}, now()
        from targets
        on conflict (store_id, target_kind, target_id, inventory_key)
        do update set source_label = excluded.source_label, updated_at = now()
      `;
    } else {
      await sql`
        with targets as (
          select * from jsonb_to_recordset(${persistJson}::jsonb)
            as x("brandId" text, "targetKind" text, "targetId" text, linked boolean)
        )
        delete from menu_inventory_availability_blocks blocks
        using targets
        where blocks.store_id::text = ${storeId}
          and blocks.target_kind = targets."targetKind"
          and blocks.target_id::text = targets."targetId"
          and (
            -- An explicit restore of the directly selected item/option clears
            -- every historical blocker for that target. Inventory identities
            -- can change after a platform catalog import, and retaining an old
            -- key would immediately turn the restored target unavailable again.
            targets.linked = false
            -- Dependent products can be blocked by several ingredients. Only
            -- remove the blocker belonging to the ingredient being restored.
            or blocks.inventory_key = ${resolution.inventoryKey}
          )
      `;
    }
    const blockedRows = await sql`
      with targets as (
        select * from jsonb_to_recordset(${persistJson}::jsonb)
          as x("brandId" text, "targetKind" text, "targetId" text, linked boolean)
      )
      select targets."targetKind" as "targetKind", targets."targetId" as "targetId"
      from targets
      where exists (
        select 1 from menu_inventory_availability_blocks blocks
        where blocks.store_id::text = ${storeId}
          and blocks.target_kind = targets."targetKind"
          and blocks.target_id::text = targets."targetId"
      )
    `;
    const blocked = new Set(blockedRows.map((row) => `${row.targetKind}:${row.targetId}`));
    for (const row of targetRows) {
      effectiveAvailability.set(`${row.targetKind}:${row.targetId}`, persistRows.includes(row)
        ? !blocked.has(`${row.targetKind}:${row.targetId}`)
        : isAvailable);
    }
    const settingsRows = persistRows.map((row) => {
      const available = effectiveAvailability.get(`${row.targetKind}:${row.targetId}`) !== false;
      return {
        brandId: row.brandId,
        targetId: row.targetId,
        isAvailable: available,
        stockStatus: available
          ? (stockStatus === "low_stock" && !row.linked ? "low_stock" : "available")
          : "unavailable"
      };
    });
    const itemSettings = JSON.stringify(settingsRows.filter((_, index) => persistRows[index]?.targetKind === "item"));
    const optionSettings = JSON.stringify(settingsRows.filter((_, index) => persistRows[index]?.targetKind === "option"));
    if (itemSettings !== "[]") await sql`
      with settings as (
        select * from jsonb_to_recordset(${itemSettings}::jsonb)
          as x("brandId" text, "targetId" text, "isAvailable" boolean, "stockStatus" text)
      )
      insert into menu_store_settings (
        brand_id, store_id, menu_catalog_item_id, is_available, stock_status, status_note, updated_by, updated_at
      )
      select settings."brandId"::uuid, ${storeId}::uuid, settings."targetId"::uuid,
        settings."isAvailable", settings."stockStatus", ${note}, ${input.updatedBy}::uuid, now()
      from settings
      on conflict (store_id, menu_catalog_item_id)
      do update set is_available = excluded.is_available, stock_status = excluded.stock_status,
        status_note = excluded.status_note, updated_by = excluded.updated_by, updated_at = now()
    `;
    if (optionSettings !== "[]") await sql`
      with settings as (
        select * from jsonb_to_recordset(${optionSettings}::jsonb)
          as x("brandId" text, "targetId" text, "isAvailable" boolean, "stockStatus" text)
      )
      insert into menu_option_store_settings (
        brand_id, store_id, menu_option_id, is_available, stock_status, status_note, updated_by, updated_at
      )
      select settings."brandId"::uuid, ${storeId}::uuid, settings."targetId"::uuid,
        settings."isAvailable", settings."stockStatus", ${note}, ${input.updatedBy}::uuid, now()
      from settings
      on conflict (store_id, menu_option_id)
      do update set is_available = excluded.is_available, stock_status = excluded.stock_status,
        status_note = excluded.status_note, updated_by = excluded.updated_by, updated_at = now()
    `;
  } else {
    for (const row of targetRows) effectiveAvailability.set(`${row.targetKind}:${row.targetId}`, isAvailable);
  }

  for (const { target, targetId } of targetRows) {
    if (input.platformOverride) {
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
  const externalIdMappings = await loadInventoryPlatformExternalIdMap(storeId, resolution.targets);
  for (const platform of configuredPlatforms) {
    const projectedTargets = projectInventoryTargetsForPlatform(
      platform as "uber_eats" | "rocket_now" | "demae_can",
      resolution.targets
    );
    const projectedTargetIds = JSON.stringify(projectedTargets.map((target) => ({ targetId: target.targetId })));
    // A manual change made while the 08:00 reconciliation is still queued must
    // win. Remove the affected targets from pending scheduled batches; the new
    // manual command below then becomes the final desired state.
    await sql`
      update local_bridge_commands scheduled
      set
        payload = jsonb_set(
          scheduled.payload,
          '{targets}',
          coalesce((
            select jsonb_agg(target)
            from jsonb_array_elements(coalesce(scheduled.payload->'targets', '[]'::jsonb)) target
            where not exists (
              select 1
              from jsonb_array_elements(${projectedTargetIds}::jsonb) changed
              where changed->>'targetId' = target->>'targetId'
            )
          ), '[]'::jsonb),
          true
        ),
        updated_at = now()
      where scheduled.store_id::text = ${storeId}
        and scheduled.platform = ${platform}
        and scheduled.command_type = 'set_inventory_availability'
        and scheduled.status = 'pending'
        and scheduled.payload->>'syncSource' = 'scheduled'
    `;
    await sql`
      update local_bridge_commands
      set
        status = 'succeeded',
        completed_at = now(),
        result = jsonb_build_object('outcome', 'superseded_by_manual_change', 'changed', 0),
        last_error = '',
        updated_at = now()
      where store_id::text = ${storeId}
        and platform = ${platform}
        and command_type = 'set_inventory_availability'
        and status = 'pending'
        and payload->>'syncSource' = 'scheduled'
        and jsonb_array_length(coalesce(payload->'targets', '[]'::jsonb)) = 0
    `;
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
    const requestedAvailable = input.platformStates?.[platform as InventoryPlatform] ?? isAvailable;
    const groups = new Map<string, typeof projectedTargets>();
    for (const target of projectedTargets) {
      const effective = effectiveAvailability.get(`${target.kind}:${target.targetId}`) ?? isAvailable;
      const desiredAvailable = input.persistOverall === false
        ? requestedAvailable
        : requestedAvailable && effective;
      const kindGroup = platform === "rocket_now" ? target.kind : "all";
      const key = `${desiredAvailable ? "available" : "unavailable"}:${kindGroup}`;
      groups.set(key, [...(groups.get(key) ?? []), target]);
    }
    if (!groups.size) groups.set(`${requestedAvailable ? "available" : "unavailable"}:all`, []);

    for (const [groupKey, groupedTargets] of groups) {
      const desiredAvailable = groupKey.startsWith("available:");
      const platformCommandId = randomUUID();
      const operation = platform === "rocket_now"
        ? (desiredAvailable ? "unhide" : "hide")
        : platform === "demae_can"
          ? (desiredAvailable ? "available" : "stockout")
          : (desiredAvailable ? "available" : "sold_out");
      const serializedTargets = groupedTargets.map((target) => ({
        kind: target.kind,
        targetId: target.targetId,
        groupKey: target.kind === "option" ? target.groupKey : "",
        label: target.label,
        aliases: target.aliases,
        knownExternalIds: inventoryPlatformExternalIds(externalIdMappings, platform, target)
      }));
      const commandTargets = platform === "rocket_now" || platform === "demae_can"
        ? Array.from(new Map(serializedTargets.map((target) => [target.label.trim(), target])).values())
        : serializedTargets;
      const idempotencyKey = `${platform}:set_inventory:${storeId}:${resolution.inventoryKey}:${operation}:${groupKey}:${platformCommandId}`;
      const payload = JSON.stringify({
        inventoryKey: resolution.inventoryKey,
        ingredientLabel: resolution.ingredientLabel,
        syncRunId,
        syncSource,
        requestedBy: input.updatedBy,
        statusSource: input.statusSource,
        feedbackLabel,
        isAvailable: desiredAvailable,
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
        commandRows.push({ id: platformCommandId, platform, status: "succeeded", error: "该平台未上架（不适用）" });
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
      commandRows.push({ id: String(rows[0]?.id ?? platformCommandId), platform, status: "pending", error: "" });
    }
  }
  const historyAction = input.platformOverride
    ? "platform_override"
    : stockStatus === "low_stock"
      ? "low_stock"
      : isAvailable ? "available" : "unavailable";
  await sql`
    insert into menu_inventory_sync_runs (
      id, store_id, run_type, action, item_label, inventory_key,
      source, requested_by, details
    ) values (
      ${syncRunId}, ${storeId}, 'availability_change', ${historyAction},
      ${feedbackLabel}, ${resolution.inventoryKey}, ${syncSource}, ${input.updatedBy},
      ${JSON.stringify({
        statusSource: input.statusSource,
        stockStatus,
        isAvailable,
        persistOverall: input.persistOverall !== false,
        platforms: configuredPlatforms,
        platformStates: input.platformStates ?? {},
        platformOverride: input.platformOverride ?? null,
        targetCount: resolution.targets.length
      })}::jsonb
    )
    on conflict (id) do nothing
  `;
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
  return {
    commands: commandRows,
    note,
    syncRun,
    targetStates: resolution.targets
      .filter((target) => !(stockStatus === "low_stock" && target.linkedByDependency === true))
      .map((target) => ({
        targetId: target.targetId,
        kind: target.kind,
        isAvailable: effectiveAvailability.get(`${target.kind}:${target.targetId}`) ?? isAvailable
      }))
  };
}
