import { randomUUID } from "node:crypto";
import { sql } from "./db";
import { projectInventoryTargetsForPlatform } from "./inventory-platform-targets";
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

async function loadFullSyncTargets(storeId: string) {
  const itemRows = await sql`
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
          const desiredAvailable = override === "available"
            ? true
            : override === "unavailable" ? false : target.isAvailable !== false;
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
            aliases: target.aliases
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

    await sql`
      update menu_inventory_sync_runs
      set details = details || ${JSON.stringify({
        phase: commands.length ? "queued" : "complete",
        platforms,
        commandCount: commands.length,
        targetCount: totalTargets
      })}::jsonb
      where id = ${runId}
    `;
    if (commands.length) await publishBridgeCommandAvailable(input.storeId).catch(() => undefined);
    return { runId, existing: false, commandCount: commands.length, targetCount: totalTargets };
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
