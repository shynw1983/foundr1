import { requireOsSession } from "../../../lib/api-auth";
import type { EmployeeSession } from "../../../lib/auth";
import { sql } from "../../../lib/db";
import { roleHasPermission } from "../../../lib/role-permissions";

const defaultExternalPlatforms = [
  { key: "uber_eats", name: "Uber Eats" },
  { key: "wolt", name: "Wolt" },
  { key: "demae_can", name: "出前館" }
];
const customerDisplayLanguages = ["en", "zh", "zh-Hant", "ko", "vi", "ne"];

async function canEditMenus(session: EmployeeSession) {
  return roleHasPermission(session.role, "menus.edit");
}

function cleanOptionalId(value: unknown) {
  const id = String(value ?? "").trim();
  return id || null;
}

function parseOptionalNumber(value: unknown) {
  const normalized = String(value ?? "").replace(/[,\s]/g, "");
  if (!normalized) return null;
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function parseJsonObject(value: unknown) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean)));
}

function normalizeDisplayNames(value: unknown) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    customerDisplayLanguages
      .map((language) => [language, String(source[language] ?? "").trim().slice(0, 160)])
      .filter(([, displayName]) => displayName)
  );
}

function makeInternalKey(value: unknown, fallbackPrefix: string) {
  const base = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `${fallbackPrefix}-${crypto.randomUUID().slice(0, 8)}`;
}

async function makeUniqueGroupKey(input: {
  id: string | null;
  brandId: string;
  menuCatalogItemId: string | null;
  preferredKey: string;
  name: string;
}) {
  const baseKey = makeInternalKey(input.preferredKey || input.name, "group");
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? baseKey : `${baseKey}-${index + 1}`;
    const rows = await sql`
      select id::text
      from menu_option_groups
      where brand_id::text = ${input.brandId}
        and coalesce(menu_catalog_item_id::text, '') = ${input.menuCatalogItemId ?? ""}
        and group_key = ${candidate}
        and (${input.id === null} or id::text <> ${input.id ?? ""})
      limit 1
    `;
    if (!rows.length) return candidate;
  }
  return `${baseKey}-${crypto.randomUUID().slice(0, 8)}`;
}

async function makeUniqueOptionKey(input: {
  id: string | null;
  optionGroupId: string;
  preferredKey: string;
  name: string;
}) {
  const baseKey = makeInternalKey(input.preferredKey || input.name, "option");
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? baseKey : `${baseKey}-${index + 1}`;
    const rows = await sql`
      select id::text
      from menu_options
      where option_group_id::text = ${input.optionGroupId}
        and option_key = ${candidate}
        and (${input.id === null} or id::text <> ${input.id ?? ""})
      limit 1
    `;
    if (!rows.length) return candidate;
  }
  return `${baseKey}-${crypto.randomUUID().slice(0, 8)}`;
}

async function readMenuAdminData() {
  const [brands, stores, sources, categories, items, groups, options, storeSettings] = await Promise.all([
    sql`
      select id::text, name
      from brands
      where status = 'active'
      order by name
    `,
    sql`
      select
        stores.id::text,
        stores.name,
        coalesce((
          select array_agg(store_brands.brand_id::text order by store_brands.brand_id::text)
          from store_brands
          where store_brands.store_id = stores.id
        ), '{}') as "brandIds"
      from stores
      where status = 'active'
      order by name
    `,
    sql`
      select
        menu_sources.id::text,
        menu_sources.brand_id::text as "brandId",
        coalesce(menu_sources.store_id::text, '') as "storeId",
        menu_sources.name,
        menu_sources.source_type as "sourceType",
        coalesce(menu_sources.source_url, '') as "sourceUrl",
        menu_sources.status,
        menu_sources.last_synced_at as "lastSyncedAt"
      from menu_sources
      order by menu_sources.updated_at desc, menu_sources.name
    `,
    sql`
      select
        id::text,
        brand_id::text as "brandId",
        coalesce(store_id::text, '') as "storeId",
        coalesce(external_id, '') as "externalId",
        name,
        coalesce(note, '') as note,
        is_tapioca_free as "isTapiocaFree",
        has_whip_by_default as "hasWhipByDefault",
        sort_order as "sortOrder"
      from menu_categories
      order by sort_order, name
    `,
    sql`
      select
        menu_catalog_items.id::text,
        menu_catalog_items.brand_id::text as "brandId",
        coalesce(menu_catalog_items.store_id::text, '') as "storeId",
        coalesce(menu_catalog_items.menu_source_id::text, '') as "menuSourceId",
        coalesce(menu_catalog_items.external_id, '') as "externalId",
        menu_catalog_items.item_kind as "itemKind",
        menu_catalog_items.name,
        coalesce(menu_catalog_items.display_names, '{}'::jsonb) as "displayNames",
        coalesce(menu_catalog_items.category, '') as category,
        coalesce(menu_catalog_items.description, '') as description,
        coalesce(menu_catalog_items.description_display_names, '{}'::jsonb) as "descriptionDisplayNames",
        coalesce(menu_catalog_items.image_url, '') as "imageUrl",
        menu_catalog_items.base_price::float as "basePrice",
        menu_catalog_items.variable_schema as "variableSchema",
        menu_catalog_items.sort_order as "sortOrder",
        menu_catalog_items.is_active as "isActive",
        menu_catalog_items.updated_at as "updatedAt"
      from menu_catalog_items
      left join menu_categories
        on menu_categories.brand_id = menu_catalog_items.brand_id
        and coalesce(menu_categories.store_id::text, '') = coalesce(menu_catalog_items.store_id::text, '')
        and menu_categories.name = coalesce(nullif(menu_catalog_items.category, ''), '未分類')
      order by coalesce(menu_categories.sort_order, 9999), menu_catalog_items.sort_order, menu_catalog_items.name
    `,
    sql`
      select
        id::text,
        brand_id::text as "brandId",
        coalesce(menu_catalog_item_id::text, '') as "menuCatalogItemId",
        coalesce(applicable_categories, '{}') as "applicableCategories",
        coalesce(external_id, '') as "externalId",
        group_key as "groupKey",
        name,
        coalesce(display_names, '{}'::jsonb) as "displayNames",
        selection_type as "selectionType",
        affects_procedure as "affectsProcedure",
        rule_json as "ruleJson",
        sort_order as "sortOrder",
        is_active as "isActive"
      from menu_option_groups
      order by sort_order, name
    `,
    sql`
      select
        id::text,
        option_group_id::text as "optionGroupId",
        coalesce(applicable_categories, '{}') as "applicableCategories",
        coalesce(external_id, '') as "externalId",
        option_key as "optionKey",
        name,
        coalesce(display_names, '{}'::jsonb) as "displayNames",
        price_delta::float as "priceDelta",
        affects_procedure as "affectsProcedure",
        sort_order as "sortOrder",
        is_active as "isActive"
      from menu_options
      order by sort_order, name
    `,
    sql`
      select
        id::text,
        brand_id::text as "brandId",
        store_id::text as "storeId",
        menu_catalog_item_id::text as "menuCatalogItemId",
        website_enabled as "websiteEnabled",
        pos_enabled as "posEnabled",
        delivery_enabled as "deliveryEnabled",
        is_available as "isAvailable",
        price_override::float as "priceOverride",
        status_note as "statusNote",
        updated_at as "updatedAt"
      from menu_store_settings
      order by updated_at desc
    `
  ]);

  await ensureDefaultExternalPlatforms(brands.map((brand) => String(brand.id)));

  const [externalPlatforms, syncTasks] = await Promise.all([
    sql`
      select
        id::text,
        brand_id::text as "brandId",
        coalesce(store_id::text, '') as "storeId",
        platform_key as "platformKey",
        name,
        management_url as "managementUrl",
        is_active as "isActive",
        updated_at as "updatedAt"
      from menu_external_platforms
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
      where menu_change_sync_tasks.status = 'pending'
         or menu_change_sync_tasks.created_at > now() - interval '30 days'
      order by
        case when menu_change_sync_tasks.status = 'pending' then 0 else 1 end,
        menu_change_sync_tasks.created_at desc
      limit 200
    `
  ]);

  return { brands, stores, sources, categories, items, groups, options, storeSettings, externalPlatforms, syncTasks };
}

export async function GET() {
  const session = await requireOsSession();
  if (!session || !(await canEditMenus(session))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  return Response.json(await readMenuAdminData());
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await canEditMenus(session))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const kind = String(body.kind ?? "");

  try {
    if (kind === "source") return Response.json(await upsertSource(body));
    if (kind === "category") return Response.json(await upsertCategory(body, session.id));
    if (kind === "item") return Response.json(await upsertItem(body, session.id));
    if (kind === "group") return Response.json(await upsertGroup(body, session.id));
    if (kind === "option") return Response.json(await upsertOption(body, session.id));
    if (kind === "storeSetting") return Response.json(await upsertStoreSetting(body, session.id));
    if (kind === "sortOrder") return Response.json(await updateSortOrder(body, session.id));
    if (kind === "externalPlatform") return Response.json(await upsertExternalPlatform(body));
    if (kind === "completeSyncTask") return Response.json(await completeSyncTask(body, session.id));
    return Response.json({ error: "保存対象が不正です。" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存できませんでした。" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireOsSession();
  if (!session || !(await canEditMenus(session))) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { kind?: string; id?: string };
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "IDが必要です。" }, { status: 400 });

  if (body.kind === "source") await sql`delete from menu_sources where id = ${id}`;
  else if (body.kind === "category") await deleteCategory(id, session.id);
  else if (body.kind === "item") await deleteItem(id, session.id);
  else if (body.kind === "group") await deleteGroup(id, session.id);
  else if (body.kind === "option") await deleteOption(id, session.id);
  else if (body.kind === "storeSetting") await sql`delete from menu_store_settings where id = ${id}`;
  else return Response.json({ error: "削除対象が不正です。" }, { status: 400 });

  return Response.json({ ok: true });
}

async function ensureDefaultExternalPlatforms(brandIds: string[]) {
  for (const brandId of brandIds) {
    for (const platform of defaultExternalPlatforms) {
      await sql`
        insert into menu_external_platforms (brand_id, platform_key, name, is_active, updated_at)
        values (${brandId}, ${platform.key}, ${platform.name}, true, now())
        on conflict (
          brand_id,
          (coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid)),
          platform_key
        )
        do nothing
      `;
    }
  }
}

async function recordMenuChangeSyncTasks(input: {
  brandId: string;
  storeId?: string | null;
  targetType: string;
  targetId?: string | null;
  targetLabel: string;
  changeKind: string;
  changeSummary: string;
  employeeId: string;
}) {
  const platforms = await sql`
    select id::text
    from menu_external_platforms
    where brand_id = ${input.brandId}
      and is_active = true
      and (${input.storeId || null}::uuid is null or store_id = ${input.storeId || null})
      and (${input.storeId || null}::uuid is not null or store_id is null)
  `;

  for (const platform of platforms) {
    await sql`
      insert into menu_change_sync_tasks (
        brand_id,
        store_id,
        external_platform_id,
        target_type,
        target_id,
        target_label,
        change_kind,
        change_summary,
        created_by,
        updated_at
      )
      values (
        ${input.brandId},
        ${input.storeId || null},
        ${platform.id},
        ${input.targetType},
        ${input.targetId || null},
        ${input.targetLabel},
        ${input.changeKind},
        ${input.changeSummary},
        ${input.employeeId},
        now()
      )
      on conflict (
        external_platform_id,
        target_type,
        (coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid)),
        change_kind
      )
      where status = 'pending'
      do update set
        target_label = excluded.target_label,
        change_summary = excluded.change_summary,
        created_by = excluded.created_by,
        created_at = now(),
        updated_at = now()
    `;
  }
}

async function upsertExternalPlatform(body: Record<string, unknown>) {
  const id = cleanOptionalId(body.id);
  const brandId = cleanOptionalId(body.brandId);
  const platformKey = String(body.platformKey ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!brandId || !platformKey || !name) throw new Error("ブランド、プラットフォームキー、名称を入力してください。");

  const rows = id
    ? await sql`
        update menu_external_platforms
        set
          brand_id = ${brandId},
          store_id = ${cleanOptionalId(body.storeId)},
          platform_key = ${platformKey},
          name = ${name},
          management_url = ${String(body.managementUrl ?? "").trim()},
          is_active = ${body.isActive !== false},
          updated_at = now()
        where id = ${id}
        returning id::text
      `
    : await sql`
        insert into menu_external_platforms (
          brand_id,
          store_id,
          platform_key,
          name,
          management_url,
          is_active,
          updated_at
        )
        values (
          ${brandId},
          ${cleanOptionalId(body.storeId)},
          ${platformKey},
          ${name},
          ${String(body.managementUrl ?? "").trim()},
          ${body.isActive !== false},
          now()
        )
        on conflict (
          brand_id,
          (coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid)),
          platform_key
        )
        do update set
          name = excluded.name,
          management_url = excluded.management_url,
          is_active = excluded.is_active,
          updated_at = now()
        returning id::text
      `;

  return { ok: true, id: rows[0]?.id };
}

async function completeSyncTask(body: Record<string, unknown>, employeeId: string) {
  const id = cleanOptionalId(body.id);
  if (!id) throw new Error("同期履歴を選択してください。");

  await sql`
    update menu_change_sync_tasks
    set
      status = 'completed',
      completed_by = ${employeeId},
      completed_at = now(),
      completion_note = ${String(body.completionNote ?? "").trim()},
      updated_at = now()
    where id = ${id}
      and status = 'pending'
  `;

  return { ok: true, id };
}

async function upsertStoreSetting(body: Record<string, unknown>, employeeId: string) {
  const brandId = cleanOptionalId(body.brandId);
  const storeId = cleanOptionalId(body.storeId);
  const menuCatalogItemId = cleanOptionalId(body.menuCatalogItemId);
  if (!brandId || !storeId || !menuCatalogItemId) {
    throw new Error("ブランド、店舗、商品を選択してください。");
  }

  const priceOverride = parseOptionalNumber(body.priceOverride);
  const statusNote = String(body.statusNote ?? "").trim();
  const rows = await sql`
    insert into menu_store_settings (
      brand_id,
      store_id,
      menu_catalog_item_id,
      website_enabled,
      pos_enabled,
      delivery_enabled,
      is_available,
      price_override,
      status_note,
      updated_by,
      updated_at
    )
    values (
      ${brandId},
      ${storeId},
      ${menuCatalogItemId},
      ${body.websiteEnabled !== false},
      ${body.posEnabled !== false},
      ${body.deliveryEnabled === true},
      ${body.isAvailable !== false},
      ${priceOverride},
      ${statusNote},
      ${employeeId},
      now()
    )
    on conflict (store_id, menu_catalog_item_id)
    do update set
      brand_id = excluded.brand_id,
      website_enabled = excluded.website_enabled,
      pos_enabled = excluded.pos_enabled,
      delivery_enabled = excluded.delivery_enabled,
      is_available = excluded.is_available,
      price_override = excluded.price_override,
      status_note = excluded.status_note,
      updated_by = excluded.updated_by,
      updated_at = now()
    returning id::text
  `;

  return { ok: true, id: rows[0]?.id };
}

async function updateSortOrder(body: Record<string, unknown>, employeeId: string) {
  const brandId = cleanOptionalId(body.brandId);
  const storeId = cleanOptionalId(body.storeId);
  const categoryNames = Array.isArray(body.categoryNames) ? body.categoryNames.map((value) => String(value).trim()).filter(Boolean) : [];
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map((value) => String(value).trim()).filter(Boolean) : [];
  const categoryName = String(body.categoryName ?? "").trim();
  if (!brandId) throw new Error("ブランドを選択してください。");

  if (categoryNames.length) {
    for (const [index, name] of categoryNames.entries()) {
      const existing = await sql`
        select id::text
        from menu_categories
        where brand_id = ${brandId}
          and (${storeId}::uuid is null or store_id = ${storeId})
          and (${storeId}::uuid is not null or store_id is null)
          and name = ${name}
        limit 1
      `;
      if (existing[0]) {
        await sql`
          update menu_categories
          set sort_order = ${(index + 1) * 10},
              updated_at = now()
          where id = ${existing[0].id}
        `;
      } else {
        await sql`
          insert into menu_categories (brand_id, store_id, name, sort_order, updated_at)
          values (${brandId}, ${storeId}, ${name}, ${(index + 1) * 10}, now())
        `;
      }
    }
    await recordMenuChangeSyncTasks({
      brandId,
      storeId,
      targetType: "sort_order",
      targetLabel: "分類順",
      changeKind: "sort",
      changeSummary: "分類の表示順を変更しました。外部プラットフォーム側の分類順も確認してください。",
      employeeId
    });
    return { ok: true };
  }

  if (itemIds.length) {
    for (const [index, id] of itemIds.entries()) {
      await sql`
        update menu_catalog_items
        set sort_order = ${(index + 1) * 10}, updated_at = now()
        where id = ${id}
          and brand_id = ${brandId}
          and (${storeId}::uuid is null or store_id = ${storeId})
          and (${storeId}::uuid is not null or store_id is null)
          and (${categoryName} = '' or coalesce(nullif(category, ''), '未分類') = ${categoryName})
      `;
    }
    await recordMenuChangeSyncTasks({
      brandId,
      storeId,
      targetType: "sort_order",
      targetLabel: categoryName || "商品順",
      changeKind: "sort",
      changeSummary: `${categoryName || "商品"}の表示順を変更しました。外部プラットフォーム側の商品順も確認してください。`,
      employeeId
    });
    return { ok: true };
  }

  throw new Error("並び替え対象がありません。");
}

async function upsertCategory(body: Record<string, unknown>, employeeId: string) {
  const id = cleanOptionalId(body.id);
  const brandId = cleanOptionalId(body.brandId);
  const storeId = cleanOptionalId(body.storeId);
  const name = String(body.name ?? "").trim();
  if (!brandId || !name) throw new Error("ブランドと分類名を入力してください。");

  const sortOrder = Math.round(parseOptionalNumber(body.sortOrder) ?? 100);
  const currentRows = id
    ? await sql`
        select id::text, name
        from menu_categories
        where id = ${id}
        limit 1
      `
    : await sql`
        select id::text, name
        from menu_categories
        where brand_id = ${brandId}
          and (${storeId}::uuid is null or store_id = ${storeId})
          and (${storeId}::uuid is not null or store_id is null)
          and name = ${name}
        limit 1
      `;
  const targetId = id || currentRows[0]?.id;
  const previousName = String(currentRows[0]?.name ?? "");

  const rows = targetId
    ? await sql`
        update menu_categories
        set
          brand_id = ${brandId},
          store_id = ${storeId},
          external_id = ${String(body.externalId ?? "").trim()},
          name = ${name},
          note = ${String(body.note ?? "").trim()},
          is_tapioca_free = ${body.isTapiocaFree === true},
          has_whip_by_default = ${body.hasWhipByDefault === true},
          sort_order = ${sortOrder},
          updated_at = now()
        where id = ${targetId}
        returning id::text
      `
    : await sql`
        insert into menu_categories (
          brand_id,
          store_id,
          external_id,
          name,
          note,
          is_tapioca_free,
          has_whip_by_default,
          sort_order,
          updated_at
        )
        values (
          ${brandId},
          ${storeId},
          ${String(body.externalId ?? "").trim()},
          ${name},
          ${String(body.note ?? "").trim()},
          ${body.isTapiocaFree === true},
          ${body.hasWhipByDefault === true},
          ${sortOrder},
          now()
        )
        returning id::text
      `;

  if (targetId && previousName && previousName !== name) {
    await sql`
      update menu_catalog_items
      set category = ${name},
          updated_at = now()
      where brand_id = ${brandId}
        and (${storeId}::uuid is null or store_id = ${storeId})
        and (${storeId}::uuid is not null or store_id is null)
        and coalesce(nullif(category, ''), '未分類') = ${previousName}
    `;
    await sql`
      update menu_option_groups
      set applicable_categories = array_replace(applicable_categories, ${previousName}, ${name}),
          updated_at = now()
      where brand_id = ${brandId}
        and ${previousName} = any(applicable_categories)
    `;
    await sql`
      update menu_options
      set applicable_categories = array_replace(applicable_categories, ${previousName}, ${name}),
          updated_at = now()
      where ${previousName} = any(applicable_categories)
        and option_group_id in (select id from menu_option_groups where brand_id = ${brandId})
    `;
  }

  await recordMenuChangeSyncTasks({
    brandId,
    storeId,
    targetType: "category",
    targetId: rows[0]?.id,
    targetLabel: name,
    changeKind: targetId ? "update" : "create",
    changeSummary: targetId
      ? `分類「${previousName || name}」を「${name}」へ更新しました。`
      : `分類「${name}」を追加しました。`,
    employeeId
  });

  return { ok: true, id: rows[0]?.id };
}

async function deleteCategory(id: string, employeeId: string) {
  const rows = await sql`
    select brand_id::text as "brandId", coalesce(store_id::text, '') as "storeId", name
    from menu_categories
    where id = ${id}
    limit 1
  `;
  const category = rows[0];
  if (!category) return;

  await sql`
    update menu_catalog_items
    set category = '',
        updated_at = now()
    where brand_id = ${category.brandId}
      and (${category.storeId || null}::uuid is null or store_id = ${category.storeId || null})
      and (${category.storeId || null}::uuid is not null or store_id is null)
      and coalesce(nullif(category, ''), '未分類') = ${category.name}
  `;
  await sql`
    update menu_option_groups
    set applicable_categories = array_remove(applicable_categories, ${category.name}),
        is_active = case when cardinality(applicable_categories) = 1 then false else is_active end,
        updated_at = now()
    where brand_id = ${category.brandId}
      and ${category.name} = any(applicable_categories)
  `;
  await sql`
    update menu_options
    set applicable_categories = array_remove(applicable_categories, ${category.name}),
        is_active = case when cardinality(applicable_categories) = 1 then false else is_active end,
        updated_at = now()
    where ${category.name} = any(applicable_categories)
      and option_group_id in (select id from menu_option_groups where brand_id = ${category.brandId})
  `;
  await sql`delete from menu_categories where id = ${id}`;
  await recordMenuChangeSyncTasks({
    brandId: category.brandId,
    storeId: category.storeId,
    targetType: "category",
    targetId: id,
    targetLabel: category.name,
    changeKind: "delete",
    changeSummary: `分類「${category.name}」を削除しました。外部プラットフォーム側でも削除または非表示にしてください。`,
    employeeId
  });
}

async function deleteItem(id: string, employeeId: string) {
  const rows = await sql`
    select brand_id::text as "brandId", coalesce(store_id::text, '') as "storeId", name
    from menu_catalog_items
    where id = ${id}
    limit 1
  `;
  const item = rows[0];
  if (!item) return;

  await sql`delete from menu_catalog_items where id = ${id}`;
  await recordMenuChangeSyncTasks({
    brandId: item.brandId,
    storeId: item.storeId,
    targetType: "item",
    targetId: id,
    targetLabel: item.name,
    changeKind: "delete",
    changeSummary: `商品「${item.name}」を削除しました。外部プラットフォーム側でも削除または非表示にしてください。`,
    employeeId
  });
}

async function deleteGroup(id: string, employeeId: string) {
  const rows = await sql`
    select brand_id::text as "brandId", name
    from menu_option_groups
    where id = ${id}
    limit 1
  `;
  const group = rows[0];
  if (!group) return;

  await sql`delete from menu_option_groups where id = ${id}`;
  await recordMenuChangeSyncTasks({
    brandId: group.brandId,
    targetType: "option_group",
    targetId: id,
    targetLabel: group.name,
    changeKind: "delete",
    changeSummary: `選択グループ「${group.name}」を削除しました。外部プラットフォーム側のオプション設定を確認してください。`,
    employeeId
  });
}

async function deleteOption(id: string, employeeId: string) {
  const rows = await sql`
    select
      menu_option_groups.brand_id::text as "brandId",
      menu_options.name
    from menu_options
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    where menu_options.id = ${id}
    limit 1
  `;
  const option = rows[0];
  if (!option) return;

  await sql`delete from menu_options where id = ${id}`;
  await recordMenuChangeSyncTasks({
    brandId: option.brandId,
    targetType: "option",
    targetId: id,
    targetLabel: option.name,
    changeKind: "delete",
    changeSummary: `選択肢「${option.name}」を削除しました。外部プラットフォーム側でも削除または非表示にしてください。`,
    employeeId
  });
}

async function upsertSource(body: Record<string, unknown>) {
  const id = cleanOptionalId(body.id);
  const brandId = cleanOptionalId(body.brandId);
  const name = String(body.name ?? "").trim();
  if (!brandId || !name) throw new Error("ブランドと名称を入力してください。");

  const rows = id
    ? await sql`
        update menu_sources
        set
          brand_id = ${brandId},
          store_id = ${cleanOptionalId(body.storeId)},
          name = ${name},
          source_type = ${String(body.sourceType ?? "manual").trim() || "manual"},
          source_url = ${String(body.sourceUrl ?? "").trim()},
          status = ${String(body.status ?? "active").trim() || "active"},
          updated_at = now()
        where id = ${id}
        returning id::text
      `
    : await sql`
        insert into menu_sources (brand_id, store_id, name, source_type, source_url, status, updated_at)
        values (
          ${brandId},
          ${cleanOptionalId(body.storeId)},
          ${name},
          ${String(body.sourceType ?? "manual").trim() || "manual"},
          ${String(body.sourceUrl ?? "").trim()},
          ${String(body.status ?? "active").trim() || "active"},
          now()
        )
        returning id::text
      `;

  return { ok: true, id: rows[0]?.id };
}

async function upsertItem(body: Record<string, unknown>, employeeId: string) {
  const id = cleanOptionalId(body.id);
  const brandId = cleanOptionalId(body.brandId);
  const name = String(body.name ?? "").trim();
  if (!brandId || !name) throw new Error("ブランドとメニュー名を入力してください。");
  const variableSchema = JSON.stringify(parseJsonObject(body.variableSchema));
  const displayNames = JSON.stringify(normalizeDisplayNames(body.displayNames));
  const descriptionDisplayNames = JSON.stringify(normalizeDisplayNames(body.descriptionDisplayNames));
  const previousRows = id
    ? await sql`
        select name, base_price::float as "basePrice", is_active as "isActive"
        from menu_catalog_items
        where id = ${id}
        limit 1
      `
    : [];
  const previous = previousRows[0];

  const rows = id
    ? await sql`
        update menu_catalog_items
        set
          brand_id = ${brandId},
          store_id = ${cleanOptionalId(body.storeId)},
          menu_source_id = ${cleanOptionalId(body.menuSourceId)},
          external_id = ${String(body.externalId ?? "").trim()},
          item_kind = ${String(body.itemKind ?? "fixed_product").trim() || "fixed_product"},
          name = ${name},
          display_names = ${displayNames}::jsonb,
          category = ${String(body.category ?? "").trim()},
          description = ${String(body.description ?? "").trim()},
          description_display_names = ${descriptionDisplayNames}::jsonb,
          image_url = ${String(body.imageUrl ?? "").trim()},
          base_price = ${parseOptionalNumber(body.basePrice)},
          variable_schema = ${variableSchema}::jsonb,
          sort_order = ${Math.round(parseOptionalNumber(body.sortOrder) ?? 100)},
          is_active = ${body.isActive !== false},
          updated_at = now()
        where id = ${id}
        returning id::text
      `
    : await sql`
        insert into menu_catalog_items (
          brand_id,
          store_id,
          menu_source_id,
          external_id,
          item_kind,
          name,
          display_names,
          category,
          description,
          description_display_names,
          image_url,
          base_price,
          variable_schema,
          sort_order,
          is_active,
          updated_at
        )
        values (
          ${brandId},
          ${cleanOptionalId(body.storeId)},
          ${cleanOptionalId(body.menuSourceId)},
          ${String(body.externalId ?? "").trim()},
          ${String(body.itemKind ?? "fixed_product").trim() || "fixed_product"},
          ${name},
          ${displayNames}::jsonb,
          ${String(body.category ?? "").trim()},
          ${String(body.description ?? "").trim()},
          ${descriptionDisplayNames}::jsonb,
          ${String(body.imageUrl ?? "").trim()},
          ${parseOptionalNumber(body.basePrice)},
          ${variableSchema}::jsonb,
          ${Math.round(parseOptionalNumber(body.sortOrder) ?? 100)},
          ${body.isActive !== false},
          now()
        )
        returning id::text
      `;

  await recordMenuChangeSyncTasks({
    brandId,
    storeId: cleanOptionalId(body.storeId),
    targetType: "item",
    targetId: rows[0]?.id,
    targetLabel: name,
    changeKind: id ? "update" : "create",
    changeSummary: id
      ? `商品「${String(previous?.name ?? name)}」を更新しました。価格、説明、画像、公開状態、選択可否を確認してください。`
      : `商品「${name}」を追加しました。外部プラットフォーム側にも追加してください。`,
    employeeId
  });

  return { ok: true, id: rows[0]?.id };
}

async function upsertGroup(body: Record<string, unknown>, employeeId: string) {
  const id = cleanOptionalId(body.id);
  const brandId = cleanOptionalId(body.brandId);
  const rawGroupKey = String(body.groupKey ?? "").trim();
  const menuCatalogItemId = cleanOptionalId(body.menuCatalogItemId);
  const applicableCategories = menuCatalogItemId ? [] : normalizeStringArray(body.applicableCategories);
  const name = String(body.name ?? "").trim();
  if (!brandId || !name) throw new Error("ブランド、名称を入力してください。");
  const groupKey = await makeUniqueGroupKey({ id, brandId, menuCatalogItemId, preferredKey: rawGroupKey, name });
  const displayNames = JSON.stringify(normalizeDisplayNames(body.displayNames));

  const rows = id
    ? await sql`
        update menu_option_groups
        set
          brand_id = ${brandId},
          menu_catalog_item_id = ${menuCatalogItemId},
          applicable_categories = ${applicableCategories},
          external_id = ${String(body.externalId ?? "").trim()},
          group_key = ${groupKey},
          name = ${name},
          display_names = ${displayNames}::jsonb,
          selection_type = ${String(body.selectionType ?? "single").trim() || "single"},
          affects_procedure = ${body.affectsProcedure !== false},
          rule_json = ${JSON.stringify(parseJsonObject(body.ruleJson))}::jsonb,
          sort_order = ${Math.round(parseOptionalNumber(body.sortOrder) ?? 0)},
          is_active = ${body.isActive !== false},
          updated_at = now()
        where id = ${id}
        returning id::text
      `
    : await sql`
        insert into menu_option_groups (
          brand_id,
          menu_catalog_item_id,
          applicable_categories,
          external_id,
          group_key,
          name,
          display_names,
          selection_type,
          affects_procedure,
          rule_json,
          sort_order,
          is_active,
          updated_at
        )
        values (
          ${brandId},
          ${menuCatalogItemId},
          ${applicableCategories},
          ${String(body.externalId ?? "").trim()},
          ${groupKey},
          ${name},
          ${displayNames}::jsonb,
          ${String(body.selectionType ?? "single").trim() || "single"},
          ${body.affectsProcedure !== false},
          ${JSON.stringify(parseJsonObject(body.ruleJson))}::jsonb,
          ${Math.round(parseOptionalNumber(body.sortOrder) ?? 0)},
          ${body.isActive !== false},
          now()
        )
        returning id::text
      `;

  await recordMenuChangeSyncTasks({
    brandId,
    targetType: "option_group",
    targetId: rows[0]?.id,
    targetLabel: name,
    changeKind: id ? "update" : "create",
    changeSummary: `選択グループ「${name}」を${id ? "更新" : "追加"}しました。外部プラットフォーム側のオプション設定を確認してください。`,
    employeeId
  });

  return { ok: true, id: rows[0]?.id };
}

async function upsertOption(body: Record<string, unknown>, employeeId: string) {
  const id = cleanOptionalId(body.id);
  const optionGroupId = cleanOptionalId(body.optionGroupId);
  const rawOptionKey = String(body.optionKey ?? "").trim();
  const name = String(body.name ?? "").trim();
  const applicableCategories = normalizeStringArray(body.applicableCategories);
  if (!optionGroupId || !name) throw new Error("グループ、名称を入力してください。");
  const optionKey = await makeUniqueOptionKey({ id, optionGroupId, preferredKey: rawOptionKey, name });
  const displayNames = JSON.stringify(normalizeDisplayNames(body.displayNames));
  const groupRows = await sql`
    select brand_id::text as "brandId", name
    from menu_option_groups
    where id = ${optionGroupId}
    limit 1
  `;
  const group = groupRows[0];
  if (!group) throw new Error("選択グループが見つかりません。");

  const rows = id
    ? await sql`
        update menu_options
        set
          option_group_id = ${optionGroupId},
          applicable_categories = ${applicableCategories},
          external_id = ${String(body.externalId ?? "").trim()},
          option_key = ${optionKey},
          name = ${name},
          display_names = ${displayNames}::jsonb,
          price_delta = ${parseOptionalNumber(body.priceDelta)},
          affects_procedure = ${body.affectsProcedure !== false},
          sort_order = ${Math.round(parseOptionalNumber(body.sortOrder) ?? 0)},
          is_active = ${body.isActive !== false},
          updated_at = now()
        where id = ${id}
        returning id::text
      `
    : await sql`
        insert into menu_options (
          option_group_id,
          applicable_categories,
          external_id,
          option_key,
          name,
          display_names,
          price_delta,
          affects_procedure,
          sort_order,
          is_active,
          updated_at
        )
        values (
          ${optionGroupId},
          ${applicableCategories},
          ${String(body.externalId ?? "").trim()},
          ${optionKey},
          ${name},
          ${displayNames}::jsonb,
          ${parseOptionalNumber(body.priceDelta)},
          ${body.affectsProcedure !== false},
          ${Math.round(parseOptionalNumber(body.sortOrder) ?? 0)},
          ${body.isActive !== false},
          now()
        )
        returning id::text
      `;

  await recordMenuChangeSyncTasks({
    brandId: group.brandId,
    targetType: "option",
    targetId: rows[0]?.id,
    targetLabel: name,
    changeKind: id ? "update" : "create",
    changeSummary: `選択肢「${name}」を${id ? "更新" : "追加"}しました。外部プラットフォーム側の価格差額と公開状態を確認してください。`,
    employeeId
  });

  return { ok: true, id: rows[0]?.id };
}
