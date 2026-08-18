import { requireOsSession } from "../../../../lib/api-auth";
import type { EmployeeSession } from "../../../../lib/auth";
import {
  buildDeliveryMenuPublishPreview,
  deliveryPlatformRules,
  type DeliveryMenuPlatformKey,
  type DeliveryPlatformRule,
  type MenuPlatformBaseline,
  type MenuPlatformBaselineEntry,
  type MenuPlatformTargetSetting
} from "../../../../lib/delivery-menu-publishing";
import { sql } from "../../../../lib/db";
import { publishBridgeCommandAvailable } from "../../../../lib/local-bridge-realtime";
import { roleHasPermission } from "../../../../lib/role-permissions";
import uberCatalog from "../../../../data/uber/maamaa-catalog.json";
import uberMapping from "../../../../data/uber/maamaa-menu-mapping.json";

async function canEditMenus(session: EmployeeSession) {
  return roleHasPermission(session.role, "menus.edit");
}

function cleanBrandId(request: Request) {
  const value = new URL(request.url).searchParams.get("brandId")?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

async function loadPreview(brandId: string) {
  const [brands, items, groups, options, tasks, platforms, targetSettings, snapshots, mappings] = await Promise.all([
    sql`select id::text, name from brands where id = ${brandId} limit 1`,
    sql`
      select
        id::text,
        coalesce(external_id, '') as "externalId",
        name,
        coalesce(display_names, '{}'::jsonb) as "displayNames",
        base_price::float as "basePrice",
        is_active as "isActive"
      from menu_catalog_items
      where brand_id = ${brandId}
        and store_id is null
      order by sort_order, name
    `,
    sql`
      select id::text, group_key as "groupKey"
      from menu_option_groups
      where brand_id = ${brandId}
    `,
    sql`
      select
        menu_options.id::text,
        menu_options.option_group_id::text as "optionGroupId",
        menu_options.option_key as "optionKey",
        menu_options.name,
        coalesce(menu_options.display_names, '{}'::jsonb) as "displayNames",
        menu_options.price_delta::float as "priceDelta",
        menu_options.is_active as "isActive"
      from menu_options
      join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
      where menu_option_groups.brand_id = ${brandId}
      order by menu_option_groups.sort_order, menu_options.sort_order, menu_options.name
    `,
    sql`
      select
        menu_change_sync_tasks.id::text,
        menu_external_platforms.platform_key as "platformKey",
        menu_change_sync_tasks.target_type as "targetType",
        menu_change_sync_tasks.target_label as "targetLabel",
        menu_change_sync_tasks.change_kind as "changeKind",
        menu_change_sync_tasks.change_summary as "changeSummary"
      from menu_change_sync_tasks
      join menu_external_platforms on menu_external_platforms.id = menu_change_sync_tasks.external_platform_id
      where menu_change_sync_tasks.brand_id = ${brandId}
        and menu_change_sync_tasks.store_id is null
        and menu_change_sync_tasks.status = 'pending'
      order by menu_change_sync_tasks.created_at desc
    `,
    sql`
      select id::text, platform_key as "platformKey", rule_version as "ruleVersion",
        coalesce(rule_config, '{}'::jsonb) as "ruleConfig"
      from menu_external_platforms
      where brand_id = ${brandId} and store_id is null and is_active = true
        and platform_key in ('uber_eats', 'rocket_now', 'demae_can')
    `,
    sql`
      select settings.target_type as "targetType", settings.target_id::text as "targetId",
        platforms.platform_key as "platformKey", settings.is_enabled as "isEnabled",
        settings.name_override as "nameOverride", settings.description_override as "descriptionOverride",
        settings.price_override::float as "priceOverride", settings.emoji_mode as "emojiMode",
        coalesce(settings.placement_config, '{}'::jsonb) as "placementConfig"
      from menu_platform_target_settings settings
      join menu_external_platforms platforms on platforms.id = settings.external_platform_id
      where settings.brand_id = ${brandId} and settings.store_id is null
    `,
    sql`
      select distinct on (snapshots.external_platform_id)
        platforms.platform_key as "platformKey", snapshots.captured_at::text as "capturedAt", snapshots.payload
      from menu_platform_snapshots snapshots
      join menu_external_platforms platforms on platforms.id = snapshots.external_platform_id
      where snapshots.brand_id = ${brandId} and snapshots.store_id is null
        and snapshots.snapshot_type = 'baseline'
      order by snapshots.external_platform_id, snapshots.captured_at desc
    `,
    sql`
      select platforms.platform_key as "platformKey", mappings.target_type as "targetType",
        mappings.target_id::text as "targetId", mappings.external_id as "externalId",
        mappings.external_parent_id as "externalParentId", mappings.external_name as "externalName",
        coalesce(mappings.last_observed_state, '{}'::jsonb) as "lastObservedState",
        mappings.last_verified_at::text as "lastVerifiedAt"
      from menu_platform_object_mappings mappings
      join menu_external_platforms platforms on platforms.id = mappings.external_platform_id
      where mappings.brand_id = ${brandId} and mappings.store_id is null
    `
  ]);

  if (!brands.length) throw new Error("ブランドが見つかりません。");

  const groupKeyById = new Map(groups.map((group) => [String(group.id), String(group.groupKey)]));
  const platformSettingsByTarget = new Map<string, Partial<Record<DeliveryMenuPlatformKey, MenuPlatformTargetSetting>>>();
  for (const setting of targetSettings) {
    const platformKey = String(setting.platformKey) as DeliveryMenuPlatformKey;
    if (!(platformKey in deliveryPlatformRules)) continue;
    const key = `${String(setting.targetType)}:${String(setting.targetId)}`;
    const current = platformSettingsByTarget.get(key) ?? {};
    current[platformKey] = {
      isEnabled: setting.isEnabled === true,
      nameOverride: String(setting.nameOverride ?? ""),
      descriptionOverride: String(setting.descriptionOverride ?? ""),
      priceOverride: setting.priceOverride === null ? null : Number(setting.priceOverride),
      emojiMode: String(setting.emojiMode ?? "follow") as MenuPlatformTargetSetting["emojiMode"],
      placementConfig: setting.placementConfig as Record<string, unknown>
    };
    platformSettingsByTarget.set(key, current);
  }
  const pendingTasksByPlatform: Partial<Record<DeliveryMenuPlatformKey, Array<{
    id: string;
    targetType: string;
    targetLabel: string;
    changeKind: string;
    changeSummary: string;
  }>>> = {};
  for (const task of tasks) {
    const platformKey = String(task.platformKey) as DeliveryMenuPlatformKey;
    if (!(["uber_eats", "rocket_now", "demae_can"] as string[]).includes(platformKey)) continue;
    (pendingTasksByPlatform[platformKey] ??= []).push({
      id: String(task.id),
      targetType: String(task.targetType),
      targetLabel: String(task.targetLabel),
      changeKind: String(task.changeKind),
      changeSummary: String(task.changeSummary)
    });
  }

  const uberBaselineOptions = uberMapping.groups.flatMap((group) => group.options.map((option) => ({
    groupKey: group.groupKey,
    optionKey: option.optionKey,
    name: option.name,
    uberName: option.uberName,
    websitePrice: option.websitePrice,
    uberPrice: option.uberPrice
  })));

  const platformBaselines: Partial<Record<DeliveryMenuPlatformKey, MenuPlatformBaseline>> = {};
  for (const snapshot of snapshots) {
    const platformKey = String(snapshot.platformKey) as DeliveryMenuPlatformKey;
    if (!(platformKey in deliveryPlatformRules)) continue;
    const payload = snapshot.payload && typeof snapshot.payload === "object" ? snapshot.payload as Record<string, unknown> : {};
    platformBaselines[platformKey] = {
      capturedAt: String(snapshot.capturedAt ?? ""),
      items: Array.isArray(payload.items) ? payload.items as MenuPlatformBaselineEntry[] : [],
      options: Array.isArray(payload.options) ? payload.options as MenuPlatformBaselineEntry[] : [],
      complete: payload.complete !== false,
      missingTargets: Array.isArray(payload.missingTargets) ? payload.missingTargets.map(String) : []
    };
  }
  for (const platform of platforms) {
    const platformKey = String(platform.platformKey) as DeliveryMenuPlatformKey;
    if (!(platformKey in deliveryPlatformRules) || platformBaselines[platformKey]) continue;
    const platformMappings = mappings.filter((mapping) => String(mapping.platformKey) === platformKey);
    if (!platformMappings.length) continue;
    const toEntry = (mapping: typeof platformMappings[number]): MenuPlatformBaselineEntry => {
      const observed = mapping.lastObservedState && typeof mapping.lastObservedState === "object"
        ? mapping.lastObservedState as Record<string, unknown>
        : {};
      return {
        targetId: String(mapping.targetId),
        externalId: String(mapping.externalId),
        externalParentId: String(mapping.externalParentId ?? ""),
        groupKey: String(observed.groupKey ?? ""),
        optionKey: String(observed.optionKey ?? ""),
        name: String(observed.name ?? mapping.externalName ?? ""),
        price: observed.price === null || observed.price === undefined ? null : Number(observed.price),
        sourceBasePrice: observed.sourceBasePrice === null || observed.sourceBasePrice === undefined ? undefined : Number(observed.sourceBasePrice),
        isActive: observed.isActive !== false,
        metadata: observed
      };
    };
    platformBaselines[platformKey] = {
      capturedAt: platformMappings.map((mapping) => String(mapping.lastVerifiedAt ?? "")).filter(Boolean).sort().at(-1) ?? null,
      items: platformMappings.filter((mapping) => String(mapping.targetType) === "item").map(toEntry),
      options: platformMappings.filter((mapping) => String(mapping.targetType) === "option").map(toEntry),
      complete: false,
      missingTargets: ["完全な基準取込が必要です"]
    };
  }

  const platformRules: Partial<Record<DeliveryMenuPlatformKey, DeliveryPlatformRule>> = {};
  for (const platform of platforms) {
    const platformKey = String(platform.platformKey) as DeliveryMenuPlatformKey;
    const defaultRule = deliveryPlatformRules[platformKey];
    if (!defaultRule) continue;
    const config = platform.ruleConfig && typeof platform.ruleConfig === "object"
      ? platform.ruleConfig as Partial<DeliveryPlatformRule>
      : {};
    platformRules[platformKey] = {
      ...defaultRule,
      ...config,
      ruleVersion: String(platform.ruleVersion || config.ruleVersion || defaultRule.ruleVersion),
      requiredLanguages: Array.isArray(config.requiredLanguages) ? config.requiredLanguages.map(String) : defaultRule.requiredLanguages,
      groupLimits: { ...defaultRule.groupLimits, ...(config.groupLimits ?? {}) }
    };
  }

  const preview = buildDeliveryMenuPublishPreview({
    items: items.map((item) => ({
      id: String(item.id),
      externalId: String(item.externalId),
      name: String(item.name),
      displayNames: item.displayNames as Record<string, string>,
      basePrice: item.basePrice === null ? null : Number(item.basePrice),
      isActive: item.isActive === true,
      platformSettings: platformSettingsByTarget.get(`item:${String(item.id)}`)
    })),
    options: options.map((option) => ({
      id: String(option.id),
      groupKey: groupKeyById.get(String(option.optionGroupId)) ?? "",
      optionKey: String(option.optionKey),
      name: String(option.name),
      displayNames: option.displayNames as Record<string, string>,
      priceDelta: option.priceDelta === null ? null : Number(option.priceDelta),
      isActive: option.isActive === true,
      platformSettings: platformSettingsByTarget.get(`option:${String(option.id)}`)
    })),
    platformBaselines,
    platformRules,
    uberBaselineItems: uberCatalog.products.map((item) => ({
      websiteId: item.websiteId,
      name: item.name,
      uberPrice: item.uberPrice,
      websitePrice: "websitePrice" in item && typeof item.websitePrice === "number" ? item.websitePrice : null
    })),
    uberBaselineOptions,
    uberBaselineCapturedAt: uberCatalog.source.capturedAt,
    pendingTasksByPlatform
  });

  return {
    ...preview,
    brandId,
    brandName: String(brands[0].name),
    externalPlatforms: platforms.map((platform) => ({
      id: String(platform.id),
      platformKey: String(platform.platformKey),
      ruleVersion: String(platform.ruleVersion ?? "")
    }))
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await canEditMenus(session))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }
  const brandId = cleanBrandId(request);
  if (!brandId) return Response.json({ error: "ブランドを選択してください。" }, { status: 400 });
  try {
    return Response.json(await loadPreview(brandId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "差分を作成できませんでした。" }, { status: 400 });
  }
}

function cleanUuid(value: unknown) {
  const text = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await canEditMenus(session))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "publish");
  if (action === "retry") {
    const taskId = cleanUuid(body.taskId);
    if (!taskId) return Response.json({ error: "再試行するタスクを選択してください。" }, { status: 400 });
    const rows = await sql`
      select tasks.command_id::text as "commandId", tasks.store_id::text as "storeId"
      from menu_change_sync_tasks tasks
      where tasks.id = ${taskId} and tasks.status = 'failed' and tasks.is_retryable = true
      limit 1
    `;
    if (!rows[0]?.commandId || !rows[0]?.storeId) return Response.json({ error: "このタスクは再試行できません。" }, { status: 409 });
    const commandId = String(rows[0].commandId);
    const storeId = String(rows[0].storeId);
    await sql.transaction([
      sql`update local_bridge_commands set status = 'pending', attempts = 0, available_at = now(), claimed_by_device_id = null, claimed_at = null, claim_expires_at = null, completed_at = null, result = '{}'::jsonb, last_error = '', updated_at = now() where id = ${commandId} and status = 'failed'`,
      sql`update menu_change_sync_tasks set status = 'queued', phase = 'queued', attempts = 0, error_code = '', error_detail = '', completed_at = null, updated_at = now() where command_id = ${commandId} and status = 'failed'`
    ]);
    await publishBridgeCommandAvailable(storeId).catch(() => undefined);
    return Response.json({ ok: true, commandId });
  }

  const brandId = cleanUuid(body.brandId);
  const storeId = cleanUuid(body.storeId);
  const requestedPlatforms = Array.isArray(body.platformKeys)
    ? Array.from(new Set(body.platformKeys.map(String).filter((key): key is DeliveryMenuPlatformKey => key in deliveryPlatformRules)))
    : [];
  const confirmDestructive = body.confirmDestructive === true;
  if (!brandId || !storeId || !requestedPlatforms.length) {
    return Response.json({ error: "ブランド、店舗、配信先を選択してください。" }, { status: 400 });
  }
  const storeRows = await sql`
    select stores.id::text from stores
    join store_brands on store_brands.store_id = stores.id
    where stores.id = ${storeId} and store_brands.brand_id = ${brandId} and stores.status = 'active'
    limit 1
  `;
  if (!storeRows.length) return Response.json({ error: "この店舗にはブランドの配信権限がありません。" }, { status: 403 });

  if (action === "capture") {
    const [itemRows, optionRows, platformRows, disabledTargetRows] = await Promise.all([
      sql`
        select id::text as "targetId", 'item' as kind, name as label,
          coalesce(display_names, '{}'::jsonb) as "displayNames", external_id as "externalId",
          base_price::float as "sourceBasePrice"
        from menu_catalog_items
        where brand_id = ${brandId} and store_id is null and is_active = true
        order by sort_order, name
      `,
      sql`
        select options.id::text as "targetId", 'option' as kind, options.name as label,
          coalesce(options.display_names, '{}'::jsonb) as "displayNames", options.external_id as "externalId",
          groups.group_key as "groupKey", options.option_key as "optionKey",
          options.price_delta::float as "sourceBasePrice"
        from menu_options options
        join menu_option_groups groups on groups.id = options.option_group_id
        where groups.brand_id = ${brandId} and groups.is_active = true and options.is_active = true
        order by groups.sort_order, options.sort_order, options.name
      `,
      sql`
        select id::text, platform_key as "platformKey", rule_version as "ruleVersion"
        from menu_external_platforms
        where brand_id = ${brandId} and store_id is null and platform_key = any(${requestedPlatforms}) and is_active = true
      `,
      sql`
        select platforms.platform_key as "platformKey", settings.target_type as "targetType", settings.target_id::text as "targetId"
        from menu_platform_target_settings settings
        join menu_external_platforms platforms on platforms.id = settings.external_platform_id
        where settings.brand_id = ${brandId} and settings.store_id is null and settings.is_enabled = false
      `
    ]);
    if (platformRows.length !== requestedPlatforms.length) {
      return Response.json({ error: "有効な外部プラットフォーム設定が不足しています。" }, { status: 409 });
    }
    const targets = [...itemRows, ...optionRows].map((row) => ({
      ...row,
      aliases: Object.values((row.displayNames && typeof row.displayNames === "object" ? row.displayNames : {}) as Record<string, unknown>)
        .map(String).filter(Boolean)
    }));
    const queries = [];
    for (const platform of platformRows) {
      const commandId = crypto.randomUUID();
      const taskId = crypto.randomUUID();
      const platformTargets = targets.filter((target) => !disabledTargetRows.some((setting) => (
        String(setting.platformKey) === String(platform.platformKey)
        && String(setting.targetType) === String(target.kind)
        && String(setting.targetId) === String(target.targetId)
      )));
      queries.push(sql`
        insert into local_bridge_commands (
          id, store_id, platform, command_type, idempotency_key, payload, status, available_at, updated_at
        ) values (
          ${commandId}, ${storeId}, ${String(platform.platformKey)}, 'capture_menu_snapshot',
          ${`menu-snapshot:${brandId}:${String(platform.platformKey)}:${Date.now()}`},
          ${JSON.stringify({ brandId, platformKey: platform.platformKey, ruleVersion: platform.ruleVersion, targets: platformTargets })}::jsonb,
          'pending', now(), now()
        )
      `);
      queries.push(sql`
        insert into menu_change_sync_tasks (
          id, brand_id, store_id, external_platform_id, target_type, target_label,
          change_kind, change_summary, status, phase, rule_version, command_id,
          created_by, max_attempts, updated_at
        ) values (
          ${taskId}, ${brandId}, ${storeId}, ${String(platform.id)}, 'other', 'プラットフォーム基準取込',
          'update', '現在のプラットフォームメニューを回読します。', 'queued', 'queued',
          ${String(platform.ruleVersion ?? "")}, ${commandId}, ${session.id}, 3, now()
        )
      `);
    }
    await sql.transaction(queries);
    await publishBridgeCommandAvailable(storeId).catch(() => undefined);
    return Response.json({ ok: true, commandCount: platformRows.length, targetCount: targets.length });
  }

  try {
    const preview = await loadPreview(brandId);
    const selected = preview.platforms.filter((platform) => requestedPlatforms.includes(platform.platformKey));
    const blocked = selected.filter((platform) => platform.blockers.length);
    if (blocked.length) {
      return Response.json({
        error: "基準データまたは翻訳が不足しているため配信できません。",
        blockers: blocked.map((platform) => ({ platformKey: platform.platformKey, blockers: platform.blockers }))
      }, { status: 409 });
    }
    const changesByPlatform = Object.fromEntries(selected.map((platform) => [
      platform.platformKey,
      platform.changes.filter((change) => !change.id.startsWith("task:") && (confirmDestructive || !change.requiresExplicitConfirmation))
    ])) as Partial<Record<DeliveryMenuPlatformKey, typeof selected[number]["changes"]>>;
    const destructiveCount = selected.reduce((total, platform) => total + platform.changes.filter((change) => change.requiresExplicitConfirmation).length, 0);
    if (destructiveCount && !confirmDestructive) {
      return Response.json({ error: `停止・削除を含む変更が ${destructiveCount}件あります。内容を確認してから再実行してください。`, requiresDestructiveConfirmation: true }, { status: 409 });
    }
    const totalChanges = Object.values(changesByPlatform).reduce((total, changes) => total + (changes?.length ?? 0), 0);
    if (!totalChanges) return Response.json({ error: "配信する差分がありません。" }, { status: 409 });

    const batchId = crypto.randomUUID();
    const ruleVersions = Object.fromEntries(selected.map((platform) => [platform.platformKey, platform.ruleVersion]));
    const queries = [sql`
      insert into menu_publish_batches (
        id, brand_id, store_id, status, requested_platforms, rule_versions,
        preview_payload, target_payload, created_by, confirmed_by, confirmed_at, updated_at
      ) values (
        ${batchId}, ${brandId}, ${storeId}, 'queued', ${requestedPlatforms}, ${JSON.stringify(ruleVersions)}::jsonb,
        ${JSON.stringify(preview)}::jsonb, ${JSON.stringify(changesByPlatform)}::jsonb,
        ${session.id}, ${session.id}, now(), now()
      )
    `];
    for (const platform of selected) {
      const platformChanges = changesByPlatform[platform.platformKey] ?? [];
      if (!platformChanges.length) continue;
      const platformRecord = preview.externalPlatforms.find((entry) => entry.platformKey === platform.platformKey);
      if (!platformRecord) throw new Error(`${platform.platformName} の設定が見つかりません。`);
      const commandId = crypto.randomUUID();
      const taskPayload = [];
      for (const change of platformChanges) {
        const taskId = crypto.randomUUID();
        taskPayload.push({ taskId, ...change });
        queries.push(sql`
          insert into menu_change_sync_tasks (
            id, brand_id, store_id, external_platform_id, publish_batch_id,
            target_type, target_id, target_label, change_kind, change_summary,
            status, phase, rule_version, current_value, projected_value,
            command_id, created_by, max_attempts, updated_at
          ) values (
            ${taskId}, ${brandId}, ${storeId}, ${platformRecord.id}, ${batchId},
            ${change.targetType}, ${change.targetId || null}, ${change.targetLabel}, ${change.kind}, ${change.summary},
            'queued', 'queued', ${platform.ruleVersion}, ${JSON.stringify(change.currentState ?? {})}::jsonb,
            ${JSON.stringify(change.projectedState ?? {})}::jsonb, ${commandId}, ${session.id}, 3, now()
          )
        `);
      }
      queries.push(sql`
        insert into local_bridge_commands (
          id, store_id, platform, command_type, idempotency_key, payload, status, available_at, updated_at
        ) values (
          ${commandId}, ${storeId}, ${platform.platformKey}, 'publish_menu_changes',
          ${`menu-publish:${batchId}:${platform.platformKey}`},
          ${JSON.stringify({ batchId, brandId, platformKey: platform.platformKey, ruleVersion: platform.ruleVersion, changes: taskPayload })}::jsonb,
          'pending', now(), now()
        )
      `);
    }
    await sql.transaction(queries);
    await publishBridgeCommandAvailable(storeId).catch(() => undefined);
    return Response.json({ ok: true, batchId, totalChanges });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "配信を開始できませんでした。" }, { status: 400 });
  }
}
