import { requireOsSession } from "../../../../lib/api-auth";
import type { EmployeeSession } from "../../../../lib/auth";
import { buildDeliveryMenuPublishPreview, type DeliveryMenuPlatformKey } from "../../../../lib/delivery-menu-publishing";
import { sql } from "../../../../lib/db";
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

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await canEditMenus(session))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const brandId = cleanBrandId(request);
  if (!brandId) return Response.json({ error: "ブランドを選択してください。" }, { status: 400 });

  const [brands, items, groups, options, tasks] = await Promise.all([
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
    `
  ]);

  if (!brands.length) return Response.json({ error: "ブランドが見つかりません。" }, { status: 404 });

  const groupKeyById = new Map(groups.map((group) => [String(group.id), String(group.groupKey)]));
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

  const preview = buildDeliveryMenuPublishPreview({
    items: items.map((item) => ({
      id: String(item.id),
      externalId: String(item.externalId),
      name: String(item.name),
      displayNames: item.displayNames as Record<string, string>,
      basePrice: item.basePrice === null ? null : Number(item.basePrice),
      isActive: item.isActive === true
    })),
    options: options.map((option) => ({
      id: String(option.id),
      groupKey: groupKeyById.get(String(option.optionGroupId)) ?? "",
      optionKey: String(option.optionKey),
      name: String(option.name),
      displayNames: option.displayNames as Record<string, string>,
      priceDelta: option.priceDelta === null ? null : Number(option.priceDelta),
      isActive: option.isActive === true
    })),
    uberBaselineItems: uberCatalog.products.map((item) => ({
      websiteId: item.websiteId,
      name: item.name,
      uberPrice: item.uberPrice
    })),
    uberBaselineOptions,
    uberBaselineCapturedAt: uberCatalog.source.capturedAt,
    pendingTasksByPlatform
  });

  return Response.json({ ...preview, brandId, brandName: String(brands[0].name) });
}
