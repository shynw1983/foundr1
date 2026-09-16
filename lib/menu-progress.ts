import { sql } from "./db";

// Read-only progress data: no catalog, option collections, or platform initialization.
export async function readMenuProgress(brandId = "", storeId = "", includeLinks = false) {
  const [externalPlatforms, syncTasks, availabilityLinks, platformTargetSettings, publishBatches, platformImportCandidates] = await Promise.all([
    sql`
      select
        id::text,
        brand_id::text as "brandId",
        coalesce(store_id::text, '') as "storeId",
        platform_key as "platformKey",
        name,
        management_url as "managementUrl",
        rule_version as "ruleVersion",
        coalesce(rule_config, '{}'::jsonb) as "ruleConfig",
        is_active as "isActive",
        updated_at as "updatedAt"
      from menu_external_platforms
      where (${brandId} = '' or brand_id::text = ${brandId})
        and (${storeId} = '' or store_id is null or store_id::text = ${storeId})
      order by name
    `,
    sql`
      select
        menu_change_sync_tasks.id::text,
        menu_change_sync_tasks.brand_id::text as "brandId",
        coalesce(menu_change_sync_tasks.store_id::text, '') as "storeId",
        menu_change_sync_tasks.external_platform_id::text as "externalPlatformId",
        menu_external_platforms.name as "platformName",
        menu_change_sync_tasks.target_type as "targetType",
        coalesce(menu_change_sync_tasks.target_id::text, '') as "targetId",
        menu_change_sync_tasks.target_label as "targetLabel",
        menu_change_sync_tasks.change_kind as "changeKind",
        menu_change_sync_tasks.change_summary as "changeSummary",
        menu_change_sync_tasks.status,
        menu_change_sync_tasks.phase,
        menu_change_sync_tasks.attempts,
        menu_change_sync_tasks.max_attempts as "maxAttempts",
        menu_change_sync_tasks.error_code as "errorCode",
        menu_change_sync_tasks.error_detail as "errorDetail",
        menu_change_sync_tasks.is_retryable as "isRetryable",
        coalesce(menu_change_sync_tasks.command_id::text, '') as "commandId",
        coalesce(menu_change_sync_tasks.publish_batch_id::text, '') as "publishBatchId",
        menu_change_sync_tasks.verified_at as "verifiedAt",
        coalesce(created_employee.name, '') as "createdByName",
        coalesce(completed_employee.name, '') as "completedByName",
        menu_change_sync_tasks.completion_note as "completionNote",
        menu_change_sync_tasks.created_at as "createdAt",
        menu_change_sync_tasks.completed_at as "completedAt",
        menu_change_sync_tasks.updated_at as "updatedAt"
      from menu_change_sync_tasks
      join menu_external_platforms on menu_external_platforms.id = menu_change_sync_tasks.external_platform_id
      left join employees created_employee on created_employee.id = menu_change_sync_tasks.created_by
      left join employees completed_employee on completed_employee.id = menu_change_sync_tasks.completed_by
      where (menu_change_sync_tasks.status in ('pending', 'queued', 'processing', 'retrying', 'failed')
         or menu_change_sync_tasks.created_at > now() - interval '30 days')
        and (${brandId} = '' or menu_change_sync_tasks.brand_id::text = ${brandId})
        and (${storeId} = '' or menu_change_sync_tasks.store_id is null or menu_change_sync_tasks.store_id::text = ${storeId})
      order by
        case when menu_change_sync_tasks.status in ('pending', 'queued', 'processing', 'retrying', 'failed') then 0 else 1 end,
        menu_change_sync_tasks.created_at desc
      limit 200
    `,
    sql`
      select
        id::text,
        brand_id::text as "brandId",
        source_kind as "sourceKind",
        source_id::text as "sourceId",
        dependent_kind as "dependentKind",
        dependent_id::text as "dependentId",
        is_bidirectional as "isBidirectional"
      from menu_availability_links
      where ${includeLinks}
      order by created_at, id
    `,
    sql`
      select settings.id::text, settings.brand_id::text as "brandId",
        coalesce(settings.store_id::text, '') as "storeId",
        settings.external_platform_id::text as "externalPlatformId",
        settings.target_type as "targetType", settings.target_id::text as "targetId",
        settings.is_enabled as "isEnabled", settings.name_override as "nameOverride",
        settings.description_override as "descriptionOverride",
        settings.price_override::float as "priceOverride", settings.emoji_mode as "emojiMode",
        coalesce(settings.placement_config, '{}'::jsonb) as "placementConfig",
        settings.updated_at as "updatedAt"
      from menu_platform_target_settings settings
      where (${brandId} = '' or settings.brand_id::text = ${brandId})
        and (${storeId} = '' or settings.store_id is null or settings.store_id::text = ${storeId})
      order by settings.updated_at desc
    `,
    sql`
      select batches.id::text, batches.brand_id::text as "brandId",
        coalesce(batches.store_id::text, '') as "storeId", batches.status,
        batches.requested_platforms as "requestedPlatforms", batches.rule_versions as "ruleVersions",
        batches.created_at as "createdAt", batches.confirmed_at as "confirmedAt",
        batches.completed_at as "completedAt", batches.updated_at as "updatedAt",
        coalesce(created_employee.name, '') as "createdByName"
      from menu_publish_batches batches
      left join employees created_employee on created_employee.id = batches.created_by
      where batches.created_at > now() - interval '30 days'
        and (${brandId} = '' or batches.brand_id::text = ${brandId})
        and (${storeId} = '' or batches.store_id is null or batches.store_id::text = ${storeId})
      order by batches.created_at desc
      limit 100
    `,
    sql`
      select candidates.id::text, candidates.brand_id::text as "brandId",
        coalesce(candidates.store_id::text, '') as "storeId",
        candidates.external_platform_id::text as "externalPlatformId",
        platforms.platform_key as "platformKey", platforms.name as "platformName",
        candidates.target_type as "targetType", candidates.external_id as "externalId",
        candidates.external_parent_id as "externalParentId", candidates.observed_name as "observedName",
        jsonb_build_object('metadata', jsonb_build_object('kindConfidence', candidates.observed_payload->'metadata'->'kindConfidence')) as "observedPayload", candidates.status,
        coalesce(candidates.adopted_target_id::text, '') as "adoptedTargetId",
        candidates.first_seen_at as "firstSeenAt", candidates.last_seen_at as "lastSeenAt",
        candidates.resolved_at as "resolvedAt"
      from menu_platform_import_candidates candidates
      join menu_external_platforms platforms on platforms.id = candidates.external_platform_id
      where candidates.status in ('pending', 'ignored')
        and candidates.last_seen_at > now() - interval '90 days'
        and (${brandId} = '' or candidates.brand_id::text = ${brandId})
        and (${storeId} = '' or candidates.store_id is null or candidates.store_id::text = ${storeId})
      order by case when candidates.status = 'pending' then 0 else 1 end, candidates.last_seen_at desc
      limit 300
    `
  ]);
  return { externalPlatforms, syncTasks, availabilityLinks, platformTargetSettings, publishBatches, platformImportCandidates };
}
