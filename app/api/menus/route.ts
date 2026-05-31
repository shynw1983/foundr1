import { requireOsSession } from "../../../lib/api-auth";
import type { EmployeeSession } from "../../../lib/auth";
import { sql } from "../../../lib/db";

const menuEditorRoles = new Set(["owner", "manager"]);

function canEditMenus(session: EmployeeSession) {
  return menuEditorRoles.has(session.role);
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
        name,
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
        coalesce(menu_catalog_items.category, '') as category,
        coalesce(menu_catalog_items.description, '') as description,
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
        coalesce(external_id, '') as "externalId",
        group_key as "groupKey",
        name,
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
        coalesce(external_id, '') as "externalId",
        option_key as "optionKey",
        name,
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

  return { brands, stores, sources, categories, items, groups, options, storeSettings };
}

export async function GET() {
  const session = await requireOsSession();
  if (!session || !canEditMenus(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  return Response.json(await readMenuAdminData());
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditMenus(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const kind = String(body.kind ?? "");

  try {
    if (kind === "source") return Response.json(await upsertSource(body));
    if (kind === "item") return Response.json(await upsertItem(body));
    if (kind === "group") return Response.json(await upsertGroup(body));
    if (kind === "option") return Response.json(await upsertOption(body));
    if (kind === "storeSetting") return Response.json(await upsertStoreSetting(body, session.id));
    if (kind === "sortOrder") return Response.json(await updateSortOrder(body));
    return Response.json({ error: "保存対象が不正です。" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存できませんでした。" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditMenus(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { kind?: string; id?: string };
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "IDが必要です。" }, { status: 400 });

  if (body.kind === "source") await sql`delete from menu_sources where id = ${id}`;
  else if (body.kind === "item") await sql`delete from menu_catalog_items where id = ${id}`;
  else if (body.kind === "group") await sql`delete from menu_option_groups where id = ${id}`;
  else if (body.kind === "option") await sql`delete from menu_options where id = ${id}`;
  else if (body.kind === "storeSetting") await sql`delete from menu_store_settings where id = ${id}`;
  else return Response.json({ error: "削除対象が不正です。" }, { status: 400 });

  return Response.json({ ok: true });
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

async function updateSortOrder(body: Record<string, unknown>) {
  const brandId = cleanOptionalId(body.brandId);
  const storeId = cleanOptionalId(body.storeId);
  const categoryNames = Array.isArray(body.categoryNames) ? body.categoryNames.map((value) => String(value).trim()).filter(Boolean) : [];
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map((value) => String(value).trim()).filter(Boolean) : [];
  const categoryName = String(body.categoryName ?? "").trim();
  if (!brandId) throw new Error("ブランドを選択してください。");

  if (categoryNames.length) {
    await sql`
      delete from menu_categories
      where brand_id = ${brandId}
        and (${storeId}::uuid is null or store_id = ${storeId})
        and (${storeId}::uuid is not null or store_id is null)
    `;
    for (const [index, name] of categoryNames.entries()) {
      await sql`
        insert into menu_categories (brand_id, store_id, name, sort_order, updated_at)
        values (${brandId}, ${storeId}, ${name}, ${(index + 1) * 10}, now())
      `;
    }
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
    return { ok: true };
  }

  throw new Error("並び替え対象がありません。");
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

async function upsertItem(body: Record<string, unknown>) {
  const id = cleanOptionalId(body.id);
  const brandId = cleanOptionalId(body.brandId);
  const name = String(body.name ?? "").trim();
  if (!brandId || !name) throw new Error("ブランドとメニュー名を入力してください。");
  const variableSchema = JSON.stringify(parseJsonObject(body.variableSchema));

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
          category = ${String(body.category ?? "").trim()},
          description = ${String(body.description ?? "").trim()},
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
          category,
          description,
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
          ${String(body.category ?? "").trim()},
          ${String(body.description ?? "").trim()},
          ${String(body.imageUrl ?? "").trim()},
          ${parseOptionalNumber(body.basePrice)},
          ${variableSchema}::jsonb,
          ${Math.round(parseOptionalNumber(body.sortOrder) ?? 100)},
          ${body.isActive !== false},
          now()
        )
        returning id::text
      `;

  return { ok: true, id: rows[0]?.id };
}

async function upsertGroup(body: Record<string, unknown>) {
  const id = cleanOptionalId(body.id);
  const brandId = cleanOptionalId(body.brandId);
  const groupKey = String(body.groupKey ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!brandId || !groupKey || !name) throw new Error("ブランド、キー、名称を入力してください。");

  const rows = id
    ? await sql`
        update menu_option_groups
        set
          brand_id = ${brandId},
          menu_catalog_item_id = ${cleanOptionalId(body.menuCatalogItemId)},
          external_id = ${String(body.externalId ?? "").trim()},
          group_key = ${groupKey},
          name = ${name},
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
          external_id,
          group_key,
          name,
          selection_type,
          affects_procedure,
          rule_json,
          sort_order,
          is_active,
          updated_at
        )
        values (
          ${brandId},
          ${cleanOptionalId(body.menuCatalogItemId)},
          ${String(body.externalId ?? "").trim()},
          ${groupKey},
          ${name},
          ${String(body.selectionType ?? "single").trim() || "single"},
          ${body.affectsProcedure !== false},
          ${JSON.stringify(parseJsonObject(body.ruleJson))}::jsonb,
          ${Math.round(parseOptionalNumber(body.sortOrder) ?? 0)},
          ${body.isActive !== false},
          now()
        )
        returning id::text
      `;

  return { ok: true, id: rows[0]?.id };
}

async function upsertOption(body: Record<string, unknown>) {
  const id = cleanOptionalId(body.id);
  const optionGroupId = cleanOptionalId(body.optionGroupId);
  const optionKey = String(body.optionKey ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!optionGroupId || !optionKey || !name) throw new Error("グループ、キー、名称を入力してください。");

  const rows = id
    ? await sql`
        update menu_options
        set
          option_group_id = ${optionGroupId},
          external_id = ${String(body.externalId ?? "").trim()},
          option_key = ${optionKey},
          name = ${name},
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
          external_id,
          option_key,
          name,
          price_delta,
          affects_procedure,
          sort_order,
          is_active,
          updated_at
        )
        values (
          ${optionGroupId},
          ${String(body.externalId ?? "").trim()},
          ${optionKey},
          ${name},
          ${parseOptionalNumber(body.priceDelta)},
          ${body.affectsProcedure !== false},
          ${Math.round(parseOptionalNumber(body.sortOrder) ?? 0)},
          ${body.isActive !== false},
          now()
        )
        returning id::text
      `;

  return { ok: true, id: rows[0]?.id };
}
