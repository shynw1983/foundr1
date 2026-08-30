import { randomUUID } from "node:crypto";
import { sql } from "./db";
import { projectInventoryTargetsForPlatform } from "./inventory-platform-targets";
import {
  inventoryPlatformExternalIds,
  loadInventoryPlatformExternalIdMap
} from "./inventory-platform-object-mappings";
import { resolveFullSyncAvailability } from "./inventory-availability-policy";
import { publishBridgeCommandAvailable } from "./local-bridge-realtime";
import {
  resolveUberInventoryTargets,
  type UberInventoryItemTarget,
  type UberInventoryOptionRow,
  type UberInventoryTarget
} from "./uber-inventory-targets";

type InventoryPlatform = "uber_eats" | "rocket_now" | "demae_can";
type FullSyncTarget = UberInventoryItemTarget | UberInventoryTarget;

const PLATFORM_KEYS: InventoryPlatform[] = ["uber_eats", "rocket_now", "demae_can"];
const COMMAND_BATCH_SIZE = 20;

function aliases(name: string, displayNames: Record<string, unknown> | null) {
  return Array.from(new Set([
    name,
    ...Object.values(displayNames && typeof displayNames === "object" ? displayNames : {}).map(String)
  ].map((value) => value.trim()).filter(Boolean)));
}

function scheduledDateInTokyo(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function operationFor(platform: InventoryPlatform, isAvailable: boolean) {
  if (platform === "rocket_now") return isAvailable ? "unhide" : "hide";
  if (platform === "demae_can") return isAvailable ? "available" : "stockout";
  return isAvailable ? "available" : "sold_out";
}

async function scheduleMenuPlatformScansForStore(input: {
  storeId: string;
  scheduledFor: string;
  source: "scheduled" | "system";
}) {
  const [platformRows, itemRows, optionRows, disabledRows, mappingRows] = await Promise.all([
    sql`
      select platforms.id::text as "externalPlatformId", platforms.brand_id::text as "brandId",
        platforms.platform_key as "platformKey", platforms.rule_version as "ruleVersion"
      from menu_external_platforms platforms
      join store_brands on store_brands.brand_id = platforms.brand_id and store_brands.store_id::text = ${input.storeId}
      join store_sales_sources sources on sources.store_id = store_brands.store_id
        and sources.source_platform = platforms.platform_key and sources.is_enabled = true
      where platforms.store_id is null and platforms.is_active = true
        and platforms.platform_key in ('uber_eats', 'rocket_now', 'demae_can')
      group by platforms.id, platforms.brand_id, platforms.platform_key, platforms.rule_version
    `,
    sql`
      select id::text as "targetId", brand_id::text as "brandId", 'item' as kind, name as label,
        coalesce(display_names, '{}'::jsonb) as "displayNames", coalesce(external_id, '') as "externalId",
        base_price::float as "sourceBasePrice"
      from menu_catalog_items
      where store_id is null and is_active = true
    `,
    sql`
      select options.id::text as "targetId", groups.brand_id::text as "brandId", 'option' as kind,
        options.name as label, coalesce(options.display_names, '{}'::jsonb) as "displayNames",
        coalesce(options.external_id, '') as "externalId", groups.group_key as "groupKey",
        options.option_key as "optionKey", options.price_delta::float as "sourceBasePrice"
      from menu_options options
      join menu_option_groups groups on groups.id = options.option_group_id
      where groups.is_active = true and options.is_active = true
    `,
    sql`
      select platforms.platform_key as "platformKey", settings.target_type as "targetType", settings.target_id::text as "targetId"
      from menu_platform_target_settings settings
      join menu_external_platforms platforms on platforms.id = settings.external_platform_id
      where settings.store_id is null and settings.is_enabled = false
    `,
    sql`
      select mappings.brand_id::text as "brandId", platforms.platform_key as "platformKey",
        mappings.target_type as "targetType", mappings.target_id::text as "targetId", mappings.external_id as "externalId"
      from menu_platform_object_mappings mappings
      join menu_external_platforms platforms on platforms.id = mappings.external_platform_id
      where mappings.store_id is null
    `
  ]);
  let commandCount = 0;
  for (const platform of platformRows) {
    const brandId = String(platform.brandId);
    const platformKey = String(platform.platformKey) as InventoryPlatform;
    const targets = [...itemRows, ...optionRows]
      .filter((row) => String(row.brandId) === brandId)
      .filter((row) => !disabledRows.some((setting) => (
        String(setting.platformKey) === platformKey
        && String(setting.targetType) === String(row.kind)
        && String(setting.targetId) === String(row.targetId)
      )))
      .map((row) => ({
        ...row,
        aliases: Array.from(new Set([
          String(row.label),
          ...Object.values(row.displayNames && typeof row.displayNames === "object" ? row.displayNames as Record<string, unknown> : {}).map(String)
        ].map((value) => value.trim()).filter(Boolean))),
        knownExternalIds: mappingRows.filter((mapping) => (
          String(mapping.brandId) === brandId
          && String(mapping.platformKey) === platformKey
          && String(mapping.targetType) === String(row.kind)
          && String(mapping.targetId) === String(row.targetId)
        )).map((mapping) => String(mapping.externalId))
      }));
    const commandId = randomUUID();
    const inserted = await sql`
      insert into local_bridge_commands (
        id, store_id, platform, command_type, idempotency_key, payload, status, available_at, updated_at
      ) values (
        ${commandId}, ${input.storeId}, ${platformKey}, 'capture_menu_snapshot',
        ${`${platformKey}:daily_menu_snapshot:${input.storeId}:${brandId}:${input.scheduledFor}`},
        ${JSON.stringify({
          brandId,
          platformKey,
          ruleVersion: String(platform.ruleVersion ?? ""),
          scanSource: input.source,
          scheduledFor: input.scheduledFor,
          targets
        })}::jsonb,
        'pending', now(), now()
      )
      on conflict (idempotency_key) do nothing
      returning id::text
    `;
    if (!inserted[0]) continue;
    await sql`
      insert into menu_change_sync_tasks (
        brand_id, store_id, external_platform_id, target_type, target_label,
        change_kind, change_summary, status, phase, rule_version, command_id,
        max_attempts, updated_at
      ) values (
        ${brandId}, ${input.storeId}, ${String(platform.externalPlatformId)}, 'other', '毎日プラットフォーム全量回読',
        'update', '08:00 の在庫同期後に全メニューを回読し、プラットフォーム側の直接変更を確認します。',
        'queued', 'queued', ${String(platform.ruleVersion ?? "")}, ${commandId}, 3, now()
      )
    `;
    commandCount += 1;
  }
  return commandCount;
}

async function loadFullSyncTargets(storeId: string) {
  const itemRows = await sql`
    select
      menu_catalog_items.id::text,
      menu_catalog_items.brand_id::text as "brandId",
      coalesce(menu_catalog_items.external_id, '') as "externalId",
      menu_catalog_items.name,
      menu_catalog_items.display_names as "displayNames",
      case
        when exists (
          select 1 from menu_inventory_availability_blocks blocks
          where blocks.store_id::text = ${storeId}
            and blocks.target_kind = 'item'
            and blocks.target_id = menu_catalog_items.id
        ) then false
        else coalesce(menu_store_settings.is_available, true)
      end as "isAvailable"
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
  const optionRows = await sql`
    select
      menu_options.id::text,
      menu_option_groups.brand_id::text as "brandId",
      menu_option_groups.group_key as "groupKey",
      menu_options.option_key as "optionKey",
      coalesce(menu_options.external_id, '') as "externalId",
      menu_options.name,
      menu_options.display_names as "displayNames",
      case
        when exists (
          select 1 from menu_inventory_availability_blocks blocks
          where blocks.store_id::text = ${storeId}
            and blocks.target_kind = 'option'
            and blocks.target_id = menu_options.id
        ) then false
        else coalesce(menu_option_store_settings.is_available, true)
      end as "isAvailable"
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
  ` as UberInventoryOptionRow[];

  const groups = new Map<string, FullSyncTarget[]>();
  for (const row of itemRows) {
    const inventoryKey = `item:${String(row.externalId || row.id)}`;
    groups.set(inventoryKey, [{
      kind: "item",
      targetId: String(row.id),
      menuCatalogItemId: String(row.id),
      brandId: String(row.brandId),
      inventoryKey,
      label: String(row.name),
      aliases: aliases(String(row.name), row.displayNames as Record<string, unknown> | null),
      isAvailable: row.isAvailable !== false
    }]);
  }
  for (const row of optionRows) {
    const resolution = resolveUberInventoryTargets(row.name, optionRows);
    if (resolution.targets.length && !groups.has(`option:${resolution.inventoryKey}`)) {
      groups.set(`option:${resolution.inventoryKey}`, resolution.targets);
    }
  }
  return [...groups.values()];
}

export async function scheduleFullInventorySyncForStore(input: {
  storeId: string;
  source?: "scheduled" | "system";
  scheduledFor?: string;
}) {
  const source = input.source ?? "scheduled";
  const scheduledFor = input.scheduledFor ?? scheduledDateInTokyo();
  const runId = randomUUID();
  const inserted = await sql`
    insert into menu_inventory_sync_runs (
      id, store_id, run_type, action, item_label, inventory_key,
      source, scheduled_for, details
    ) values (
      ${runId}, ${input.storeId}, 'full_sync', 'full_sync',
      '全平台・全商品库存同步', ${`full-sync:${runId}`}, ${source}, ${scheduledFor}::date,
      ${JSON.stringify({ timezone: "Asia/Tokyo", scheduledHour: "08:00", phase: "queued" })}::jsonb
    )
    on conflict (store_id, scheduled_for)
      where source = 'scheduled' and scheduled_for is not null
    do nothing
    returning id::text
  `;
  if (!inserted[0]) {
    const existing = await sql`
      select id::text
      from menu_inventory_sync_runs
      where store_id::text = ${input.storeId}
        and source = 'scheduled'
        and scheduled_for = ${scheduledFor}::date
      limit 1
    `;
    return { runId: String(existing[0]?.id ?? ""), existing: true, commandCount: 0, targetCount: 0 };
  }

  try {
    const [targetGroups, sourceRows, overrideRows] = await Promise.all([
      loadFullSyncTargets(input.storeId),
      sql`
        select distinct source_platform as platform
        from store_sales_sources
        where store_id::text = ${input.storeId}
          and source_platform in ('uber_eats', 'rocket_now', 'demae_can')
          and is_enabled = true
      `,
      sql`
        select target_kind as "targetKind", target_id::text as "targetId", platform, availability
        from menu_platform_availability_settings
        where store_id::text = ${input.storeId}
          and platform in ('uber_eats', 'rocket_now', 'demae_can')
      `
    ]);
    const enabled = new Set(sourceRows.map((row) => String(row.platform)));
    const platforms = PLATFORM_KEYS.filter((platform) => enabled.has(platform));
    const externalIdMappings = await loadInventoryPlatformExternalIdMap(
      input.storeId,
      targetGroups.flatMap((group) => group)
    );
    const overrides = new Map(overrideRows.map((row) => [
      `${row.targetKind}:${row.targetId}:${row.platform}`,
      String(row.availability)
    ]));
    const commands: Array<{ id: string; platform: InventoryPlatform }> = [];
    let totalTargets = 0;

    for (const platform of platforms) {
      const buckets = new Map<string, FullSyncTarget[]>();
      for (const group of targetGroups) {
        for (const target of projectInventoryTargetsForPlatform(platform, group)) {
          const override = overrides.get(`${target.kind}:${target.targetId}:${platform}`);
          const desiredAvailable = resolveFullSyncAvailability(
            target.isAvailable !== false,
            override === "available" || override === "unavailable" ? override : undefined
          );
          const key = `${target.kind}:${desiredAvailable ? "available" : "unavailable"}`;
          buckets.set(key, [...(buckets.get(key) ?? []), target]);
        }
      }

      for (const [bucketKey, bucketTargets] of buckets) {
        const desiredAvailable = bucketKey.endsWith(":available");
        const operation = operationFor(platform, desiredAvailable);
        for (let offset = 0; offset < bucketTargets.length; offset += COMMAND_BATCH_SIZE) {
          const batch = bucketTargets.slice(offset, offset + COMMAND_BATCH_SIZE);
          const commandId = randomUUID();
          const batchNumber = Math.floor(offset / COMMAND_BATCH_SIZE) + 1;
          const batchCount = Math.ceil(bucketTargets.length / COMMAND_BATCH_SIZE);
          const serializedTargets = batch.map((target) => ({
            kind: target.kind,
            targetId: target.targetId,
            groupKey: target.kind === "option" ? target.groupKey : "",
            label: target.label,
            aliases: target.aliases,
            knownExternalIds: inventoryPlatformExternalIds(externalIdMappings, platform, target)
          }));
          const payload = {
            inventoryKey: `full-sync:${runId}:${platform}:${bucketKey}:${batchNumber}`,
            ingredientLabel: `每日库存同步 ${batchNumber}/${batchCount}`,
            feedbackLabel: `每日库存同步 ${batchNumber}/${batchCount}`,
            fullSyncRunId: runId,
            syncSource: source,
            isAvailable: desiredAvailable,
            operation,
            soldOutMode: "indefinite",
            batchNumber,
            batchCount,
            targets: serializedTargets
          };
          await sql`
            insert into local_bridge_commands (
              id, store_id, platform, command_type, idempotency_key, payload
            ) values (
              ${commandId}, ${input.storeId}, ${platform}, 'set_inventory_availability',
              ${`${platform}:full_inventory_sync:${input.storeId}:${runId}:${bucketKey}:${batchNumber}`},
              ${JSON.stringify(payload)}::jsonb
            )
          `;
          commands.push({ id: commandId, platform });
          totalTargets += serializedTargets.length;
        }
      }
    }

    const menuScanCommandCount = await scheduleMenuPlatformScansForStore({
      storeId: input.storeId,
      scheduledFor,
      source
    });
    await sql`
      update menu_inventory_sync_runs
      set details = details || ${JSON.stringify({
        phase: commands.length ? "queued" : "complete",
        platforms,
        commandCount: commands.length,
        menuScanCommandCount,
        targetCount: totalTargets
      })}::jsonb
      where id = ${runId}
    `;
    if (commands.length || menuScanCommandCount) await publishBridgeCommandAvailable(input.storeId).catch(() => undefined);
    return { runId, existing: false, commandCount: commands.length, menuScanCommandCount, targetCount: totalTargets };
  } catch (error) {
    await sql`
      update menu_inventory_sync_runs
      set details = details || ${JSON.stringify({
        phase: "failed_to_queue",
        schedulingError: error instanceof Error ? error.message : "Unknown error"
      })}::jsonb
      where id = ${runId}
    `;
    throw error;
  }
}

export async function scheduleDailyFullInventorySync() {
  const stores = await sql`
    select distinct stores.id::text, stores.name
    from stores
    join store_sales_sources
      on store_sales_sources.store_id = stores.id
      and store_sales_sources.source_platform in ('uber_eats', 'rocket_now', 'demae_can')
      and store_sales_sources.is_enabled = true
    where stores.status = 'active'
    order by stores.name
  `;
  const scheduledFor = scheduledDateInTokyo();
  const results = [];
  for (const store of stores) {
    try {
      results.push({
        storeId: String(store.id),
        storeName: String(store.name),
        ok: true,
        ...await scheduleFullInventorySyncForStore({
          storeId: String(store.id),
          source: "scheduled",
          scheduledFor
        })
      });
    } catch (error) {
      results.push({
        storeId: String(store.id),
        storeName: String(store.name),
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  return { scheduledFor, stores: results };
}
