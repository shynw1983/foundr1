import { getSessionStoreScope, requireOsSession } from "../../../lib/api-auth";
import type { EmployeeSession } from "../../../lib/auth";
import { sql } from "../../../lib/db";

type ProcedureProductPayload = {
  productId?: string;
  quantity?: string | number | null;
  unit?: string;
  note?: string;
};

type ProcedureStepPayload = {
  title?: string;
  instruction?: string;
  caution?: string;
  estimatedMinutes?: string | number | null;
  mediaUrl?: string;
  products?: ProcedureProductPayload[];
  actions?: ProcedureActionPayload[];
};

type ProcedureActionPayload = {
  variantType?: string;
  conditionJson?: unknown;
  actionTypeId?: string;
  productId?: string;
  materialId?: string;
  locationId?: string;
  equipmentId?: string;
  equipmentProductId?: string;
  containerId?: string;
  containerProductId?: string;
  quantity?: string | number | null;
  unit?: string;
  targetText?: string;
  standardText?: string;
  note?: string;
};

type ProcedureVariantPayload = {
  variantType?: string;
  name?: string;
  conditionJson?: unknown;
};

type ProcedureBookPayload = {
  id?: string;
  title?: string;
  category?: string;
  procedureType?: string;
  menuCatalogItemId?: string;
  summary?: string;
  status?: string;
  brandId?: string;
  storeIds?: string[];
  variants?: ProcedureVariantPayload[];
  steps?: ProcedureStepPayload[];
};

const procedureEditorRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);

function canEditProcedures(session: EmployeeSession) {
  return procedureEditorRoles.has(session.role);
}

function cleanStatus(value: unknown) {
  return String(value ?? "") === "published" ? "published" : "draft";
}

function parseOptionalNumber(value: unknown) {
  const normalized = String(value ?? "").replace(/[,\s]/g, "");
  if (!normalized) return null;
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function parseOptionalInteger(value: unknown) {
  const numberValue = parseOptionalNumber(value);
  return numberValue === null ? null : Math.round(numberValue);
}

function normalizeVariantType(value: unknown) {
  const variantType = String(value ?? "").trim();
  return variantType || "base";
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

async function readProcedures(session: EmployeeSession, mode: string) {
  const scope = await getSessionStoreScope(session);
  const includeDraft = mode === "admin" && canEditProcedures(session);

  const books = await sql`
    select
      procedure_books.id::text,
      procedure_books.title,
      procedure_books.category,
      coalesce(procedure_books.procedure_type, 'product') as "procedureType",
      coalesce(procedure_books.summary, '') as summary,
      procedure_books.status,
      procedure_books.version_number as "versionNumber",
      procedure_books.published_at as "publishedAt",
      procedure_books.updated_at as "updatedAt",
      brands.id::text as "brandId",
      coalesce(brands.name, '') as brand,
      menu_catalog_items.id::text as "menuCatalogItemId",
      coalesce(menu_catalog_items.name, '') as "menuCatalogItemName",
      coalesce(menu_catalog_items.item_kind, '') as "menuItemKind",
      coalesce((
        select json_agg(json_build_object('id', stores.id::text, 'name', stores.name) order by stores.name)
        from procedure_book_stores
        join stores on stores.id = procedure_book_stores.store_id
        where procedure_book_stores.procedure_book_id = procedure_books.id
      ), '[]'::json) as stores
    from procedure_books
    left join brands on brands.id = procedure_books.brand_id
    left join menu_catalog_items on menu_catalog_items.id = procedure_books.menu_catalog_item_id
    where (${includeDraft} or procedure_books.status = 'published')
      and (
        ${scope.allStores}
        or not exists (
          select 1
          from procedure_book_stores scoped_assignments
          where scoped_assignments.procedure_book_id = procedure_books.id
        )
        or exists (
          select 1
          from procedure_book_stores scoped_assignments
          where scoped_assignments.procedure_book_id = procedure_books.id
            and scoped_assignments.store_id::text = any(${scope.storeIds})
        )
      )
    order by procedure_books.updated_at desc, procedure_books.title
  `;

  const bookIds = books.map((book) => String(book.id));
  const steps = bookIds.length
    ? await sql`
        select
          procedure_steps.id::text,
          procedure_steps.procedure_book_id::text as "bookId",
          procedure_steps.sort_order as "sortOrder",
          procedure_steps.title,
          procedure_steps.instruction,
          coalesce(procedure_steps.caution, '') as caution,
          procedure_steps.estimated_minutes as "estimatedMinutes",
          coalesce(procedure_steps.media_url, '') as "mediaUrl"
        from procedure_steps
        where procedure_steps.procedure_book_id::text = any(${bookIds})
        order by procedure_steps.procedure_book_id, procedure_steps.sort_order, procedure_steps.created_at
      `
    : [];

  const stepIds = steps.map((step) => String(step.id));
  const variants = bookIds.length
    ? await sql`
        select
          id::text,
          procedure_book_id::text as "bookId",
          variant_type as "variantType",
          name,
          condition_json as "conditionJson",
          sort_order as "sortOrder"
        from procedure_variants
        where procedure_book_id::text = any(${bookIds})
        order by procedure_book_id, sort_order, name
      `
    : [];
  const stepProducts = stepIds.length
    ? await sql`
        select
          procedure_step_products.id::text,
          procedure_step_products.procedure_step_id::text as "stepId",
          products.id::text as "productId",
          products.name as "productName",
          coalesce(products.japanese_note, '') as "japaneseNote",
          products.category,
          coalesce(products.subcategory, '未分類') as subcategory,
          coalesce(products.photo_url, '') as "photoUrl",
          procedure_step_products.quantity::float as quantity,
          coalesce(procedure_step_products.unit, products.unit) as unit,
          coalesce(procedure_step_products.note, '') as note,
          procedure_step_products.sort_order as "sortOrder"
        from procedure_step_products
        join products on products.id = procedure_step_products.product_id
        where procedure_step_products.procedure_step_id::text = any(${stepIds})
        order by procedure_step_products.procedure_step_id, procedure_step_products.sort_order, products.name
      `
    : [];
  const stepActions = stepIds.length
    ? await sql`
        select
          procedure_step_actions.id::text,
          procedure_step_actions.procedure_step_id::text as "stepId",
          coalesce(procedure_variants.variant_type, 'base') as "variantType",
          procedure_action_types.id::text as "actionTypeId",
          coalesce(procedure_action_types.label, '') as "actionLabel",
          products.id::text as "productId",
          procedure_materials.id::text as "materialId",
          coalesce(products.name, '') as "productName",
          coalesce(procedure_materials.name, '') as "materialName",
          coalesce(procedure_materials.material_type, '') as "materialType",
          coalesce(products.category, procedure_materials.category, '') as category,
          coalesce(products.subcategory, procedure_materials.subcategory, '未分類') as subcategory,
          procedure_locations.id::text as "locationId",
          coalesce(procedure_locations.name, '') as location,
          procedure_equipment.id::text as "equipmentId",
          equipment_products.id::text as "equipmentProductId",
          coalesce(procedure_equipment.name, '') as equipment,
          coalesce(equipment_products.name, '') as "equipmentProductName",
          procedure_containers.id::text as "containerId",
          container_products.id::text as "containerProductId",
          coalesce(procedure_containers.name, '') as container,
          coalesce(container_products.name, '') as "containerProductName",
          procedure_step_actions.quantity::float as quantity,
          coalesce(procedure_step_actions.unit, products.unit, procedure_materials.unit, '') as unit,
          coalesce(procedure_step_actions.target_text, '') as "targetText",
          coalesce(procedure_step_actions.standard_text, '') as "standardText",
          procedure_step_actions.condition_json as "conditionJson",
          coalesce(procedure_step_actions.note, '') as note,
          procedure_step_actions.sort_order as "sortOrder"
        from procedure_step_actions
        left join procedure_variants on procedure_variants.id = procedure_step_actions.procedure_variant_id
        left join procedure_action_types on procedure_action_types.id = procedure_step_actions.action_type_id
        left join products on products.id = procedure_step_actions.product_id
        left join procedure_materials on procedure_materials.id = procedure_step_actions.material_id
        left join procedure_locations on procedure_locations.id = procedure_step_actions.location_id
        left join procedure_equipment on procedure_equipment.id = procedure_step_actions.equipment_id
        left join products equipment_products on equipment_products.id = procedure_step_actions.equipment_product_id
        left join procedure_containers on procedure_containers.id = procedure_step_actions.container_id
        left join products container_products on container_products.id = procedure_step_actions.container_product_id
        where procedure_step_actions.procedure_step_id::text = any(${stepIds})
        order by procedure_step_actions.procedure_step_id, procedure_step_actions.sort_order
      `
    : [];

  const productsByStep = new Map<string, unknown[]>();
  for (const item of stepProducts) {
    const stepId = String(item.stepId);
    productsByStep.set(stepId, [...(productsByStep.get(stepId) ?? []), item]);
  }

  const actionsByStep = new Map<string, unknown[]>();
  for (const item of stepActions) {
    const stepId = String(item.stepId);
    actionsByStep.set(stepId, [...(actionsByStep.get(stepId) ?? []), item]);
  }

  const stepsByBook = new Map<string, unknown[]>();
  for (const step of steps) {
    const bookId = String(step.bookId);
    const stepRelatedProducts = productsByStep.get(String(step.id)) ?? [];
    const stepStructuredActions = actionsByStep.get(String(step.id)) ?? [];
    const relatedProductIds = new Set(stepRelatedProducts.map((item) => String((item as { productId?: string }).productId ?? "")));
    const structuredProducts = stepStructuredActions
      .filter((item) => {
        const productId = String((item as { productId?: string }).productId ?? "");
        return productId && !relatedProductIds.has(productId);
      })
      .map((item) => {
        const action = item as {
          id?: string;
          productId?: string;
          materialId?: string;
          productName?: string;
          materialName?: string;
          materialType?: string;
          category?: string;
          subcategory?: string;
          quantity?: number | null;
          unit?: string;
          note?: string;
        };

        return {
          id: `action-${action.id ?? action.productId ?? action.materialId}`,
          productId: action.productId,
          materialId: action.materialId,
          productName: action.productName || action.materialName,
          materialType: action.materialType,
          japaneseNote: "",
          category: action.category,
          subcategory: action.subcategory,
          photoUrl: "",
          quantity: action.quantity,
          unit: action.unit,
          note: action.note
        };
      });

    stepsByBook.set(bookId, [
      ...(stepsByBook.get(bookId) ?? []),
      {
        ...step,
        products: [...stepRelatedProducts, ...structuredProducts],
        actions: stepStructuredActions
      }
    ]);
  }

  const variantsByBook = new Map<string, unknown[]>();
  for (const variant of variants) {
    const bookId = String(variant.bookId);
    variantsByBook.set(bookId, [...(variantsByBook.get(bookId) ?? []), variant]);
  }

  return books.map((book) => ({
    ...book,
    variants: variantsByBook.get(String(book.id)) ?? [],
    steps: stepsByBook.get(String(book.id)) ?? []
  }));
}

async function readAdminOptions() {
  const [stores, brands, menuCatalogItems, menuOptionGroups, menuOptions, products, materials, actionTypes, locations, equipment, containers] = await Promise.all([
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
      select id::text, name
      from brands
      where status = 'active'
      order by name
    `,
    sql`
      select
        menu_catalog_items.id::text,
        menu_catalog_items.name,
        coalesce(menu_catalog_items.item_kind, 'fixed_product') as "itemKind",
        coalesce(menu_catalog_items.category, '') as category,
        coalesce(menu_catalog_items.description, '') as description,
        coalesce(menu_catalog_items.image_url, '') as "imageUrl",
        menu_catalog_items.base_price::float as "basePrice",
        menu_catalog_items.variable_schema as "variableSchema",
        menu_catalog_items.brand_id::text as "brandId",
        coalesce(menu_catalog_items.store_id::text, '') as "storeId",
        coalesce(menu_sources.name, '') as "sourceName",
        coalesce(menu_sources.source_url, '') as "sourceUrl"
      from menu_catalog_items
      left join menu_sources on menu_sources.id = menu_catalog_items.menu_source_id
      where menu_catalog_items.is_active = true
      order by menu_catalog_items.category, menu_catalog_items.name
    `,
    sql`
      select
        id::text,
        brand_id::text as "brandId",
        menu_catalog_item_id::text as "menuCatalogItemId",
        group_key as "groupKey",
        name,
        selection_type as "selectionType",
        affects_procedure as "affectsProcedure",
        sort_order as "sortOrder"
      from menu_option_groups
      where is_active = true
      order by sort_order, name
    `,
    sql`
      select
        id::text,
        option_group_id::text as "optionGroupId",
        option_key as "optionKey",
        name,
        price_delta::float as "priceDelta",
        affects_procedure as "affectsProcedure",
        sort_order as "sortOrder"
      from menu_options
      where is_active = true
      order by sort_order, name
    `,
    sql`
      select
        id::text,
        name,
        category,
        coalesce(subcategory, '未分類') as subcategory,
        unit,
        coalesce(brand_scope, 'unset') as "brandScope",
        coalesce(usage_type, 'ingredient') as "usageType",
        coalesce((
          select array_agg(product_brand_usages.brand_id::text order by product_brand_usages.brand_id::text)
          from product_brand_usages
          where product_brand_usages.product_id = products.id
        ), '{}') as "brandIds",
        coalesce(japanese_note, '') as "japaneseNote",
        coalesce(photo_url, '') as "photoUrl"
      from products
      order by category, subcategory, name
    `,
    sql`
      select
        id::text,
        name,
        coalesce(material_type, 'utility') as "materialType",
        coalesce(category, '手順書素材') as category,
        coalesce(subcategory, '未分類') as subcategory,
        coalesce(unit, '') as unit,
        coalesce(note, '') as note,
        is_active as "isActive",
        sort_order as "sortOrder"
      from procedure_materials
      order by sort_order, category, subcategory, name
    `,
    sql`
      select
        id::text,
        action_key as "actionKey",
        label,
        sentence_template as "sentenceTemplate",
        is_active as "isActive",
        sort_order as "sortOrder"
      from procedure_action_types
      order by sort_order, label
    `,
    sql`
      select id::text, name, coalesce(category, '') as category, coalesce(note, '') as note, is_active as "isActive", sort_order as "sortOrder"
      from procedure_locations
      order by sort_order, name
    `,
    sql`
      select id::text, name, coalesce(category, '') as category, coalesce(note, '') as note, is_active as "isActive", sort_order as "sortOrder"
      from procedure_equipment
      order by sort_order, name
    `,
    sql`
      select id::text, name, coalesce(category, '') as category, coalesce(note, '') as note, is_active as "isActive", sort_order as "sortOrder"
      from procedure_containers
      order by sort_order, name
    `
  ]);

  return { stores, brands, menuCatalogItems, menuOptionGroups, menuOptions, products, materials, actionTypes, locations, equipment, containers };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const mode = new URL(request.url).searchParams.get("mode") ?? "";
  const procedures = await readProcedures(session, mode);
  const options = mode === "admin" && canEditProcedures(session)
    ? await readAdminOptions()
    : { stores: [], brands: [], products: [], materials: [] };

  return Response.json({
    procedures,
    canEdit: canEditProcedures(session),
    ...options
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditProcedures(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  try {
    const body = await request.json() as ProcedureBookPayload;
    const saved = await saveProcedureBook(body, session);
    return Response.json({ ok: true, id: saved.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存できませんでした。" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditProcedures(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json() as ProcedureBookPayload;
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "手順書IDが必要です。" }, { status: 400 });

  try {
    const saved = await saveProcedureBook(body, session);
    return Response.json({ ok: true, id: saved.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存できませんでした。" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditProcedures(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json() as { id?: string };
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "手順書IDが必要です。" }, { status: 400 });

  const scope = await getSessionStoreScope(session);
  if (!scope.allStores) {
    const accessRows = await sql`
      select exists (
        select 1
        from procedure_book_stores
        where procedure_book_id = ${id}
          and store_id::text = any(${scope.storeIds})
      ) as "canDelete"
    `;
    if (accessRows[0]?.canDelete !== true) {
      return Response.json({ error: "この手順書を削除する権限がありません。" }, { status: 403 });
    }
  }

  await sql`delete from procedure_books where id = ${id}`;
  return Response.json({ ok: true });
}

async function saveProcedureBook(body: ProcedureBookPayload, session: EmployeeSession) {
  const id = String(body.id ?? "").trim();
  const title = String(body.title ?? "").trim();
  const category = String(body.category ?? "").trim() || "未分類";
  const procedureType = String(body.procedureType ?? "").trim() || "product";
  const menuCatalogItemId = String(body.menuCatalogItemId ?? "").trim() || null;
  const summary = String(body.summary ?? "").trim();
  const status = cleanStatus(body.status);
  const brandId = String(body.brandId ?? "").trim() || null;
  const requestedStoreIds = Array.isArray(body.storeIds)
    ? Array.from(new Set(body.storeIds.map((item) => String(item).trim()).filter(Boolean)))
    : [];
  const scope = await getSessionStoreScope(session);
  const storeIds = scope.allStores
    ? requestedStoreIds
    : requestedStoreIds.filter((storeId) => scope.storeIds.includes(storeId));
  const variants = Array.isArray(body.variants) && body.variants.length
    ? body.variants
    : [
      { variantType: "base", name: "共通" },
      { variantType: "dine_in", name: "店内" },
      { variantType: "takeout", name: "テイクアウト" }
    ];
  const steps = Array.isArray(body.steps) ? body.steps : [];

  if (!title) {
    throw new Error("手順書名を入力してください。");
  }

  if (!scope.allStores && !storeIds.length) {
    throw new Error("店舗権限の手順書は担当店舗を選択してください。");
  }

  if (id && !scope.allStores) {
    const accessRows = await sql`
      select exists (
        select 1
        from procedure_book_stores
        where procedure_book_id = ${id}
          and store_id::text = any(${scope.storeIds})
      ) as "canEdit"
    `;
    if (accessRows[0]?.canEdit !== true) {
      throw new Error("この手順書を編集する権限がありません。");
    }
  }

  const rows = id
    ? await sql`
        update procedure_books
        set
          title = ${title},
          category = ${category},
          procedure_type = ${procedureType},
          menu_catalog_item_id = ${menuCatalogItemId},
          summary = ${summary},
          status = ${status},
          brand_id = ${brandId},
          version_number = version_number + 1,
          published_at = case when ${status} = 'published' then coalesce(published_at, now()) else null end,
          updated_at = now()
        where id = ${id}
        returning id::text
      `
    : await sql`
        insert into procedure_books (
          title,
          category,
          procedure_type,
          menu_catalog_item_id,
          summary,
          status,
          brand_id,
          published_at,
          created_by,
          updated_at
        )
        values (
          ${title},
          ${category},
          ${procedureType},
          ${menuCatalogItemId},
          ${summary},
          ${status},
          ${brandId},
          case when ${status} = 'published' then now() else null end,
          ${session.id},
          now()
        )
        returning id::text
      `;

  const procedureId = rows[0]?.id;
  if (!procedureId) {
    throw new Error("手順書が見つかりません。");
  }

  await sql`delete from procedure_book_stores where procedure_book_id = ${procedureId}`;
  await sql`delete from procedure_variants where procedure_book_id = ${procedureId}`;
  for (const storeId of storeIds) {
    await sql`
      insert into procedure_book_stores (procedure_book_id, store_id)
      values (${procedureId}, ${storeId})
      on conflict do nothing
    `;
  }

  const variantIdByType = new Map<string, string>();
  for (const [variantIndex, variant] of variants.entries()) {
    const variantType = normalizeVariantType(variant.variantType);
    const name = String(variant.name ?? "").trim() || variantType;
    const conditionJson = JSON.stringify(parseJsonObject(variant.conditionJson));
    const rows = await sql`
      insert into procedure_variants (procedure_book_id, variant_type, name, condition_json, sort_order)
      values (${procedureId}, ${variantType}, ${name}, ${conditionJson}::jsonb, ${variantIndex})
      on conflict (procedure_book_id, variant_type)
      do update set
        name = excluded.name,
        condition_json = excluded.condition_json,
        sort_order = excluded.sort_order
      returning id::text
    `;
    if (rows[0]?.id) variantIdByType.set(variantType, String(rows[0].id));
  }

  await sql`delete from procedure_steps where procedure_book_id = ${procedureId}`;

  for (const [stepIndex, step] of steps.entries()) {
    const stepTitle = String(step.title ?? "").trim();
    const instruction = String(step.instruction ?? "").trim();
    const products = Array.isArray(step.products) ? step.products : [];
    const actions = Array.isArray(step.actions) ? step.actions : [];
    if (!stepTitle && !instruction && !products.length && !actions.length) continue;

    const stepRows = await sql`
      insert into procedure_steps (
        procedure_book_id,
        sort_order,
        title,
        instruction,
        caution,
        estimated_minutes,
        media_url,
        updated_at
      )
      values (
        ${procedureId},
        ${stepIndex},
        ${stepTitle || `Step ${stepIndex + 1}`},
        ${instruction},
        ${String(step.caution ?? "").trim()},
        ${parseOptionalInteger(step.estimatedMinutes)},
        ${String(step.mediaUrl ?? "").trim()},
        now()
      )
      returning id::text
    `;

    const stepId = stepRows[0]?.id;
    if (!stepId) continue;

    for (const [productIndex, product] of products.entries()) {
      const productId = String(product.productId ?? "").trim();
      if (!productId) continue;

      await sql`
        insert into procedure_step_products (
          procedure_step_id,
          product_id,
          quantity,
          unit,
          note,
          sort_order
        )
        values (
          ${stepId},
          ${productId},
          ${parseOptionalNumber(product.quantity)},
          ${String(product.unit ?? "").trim()},
          ${String(product.note ?? "").trim()},
          ${productIndex}
        )
      `;
    }

    for (const [actionIndex, action] of actions.entries()) {
      const variantType = normalizeVariantType(action.variantType);
      const variantId = variantIdByType.get(variantType) ?? variantIdByType.get("base") ?? null;
      const actionTypeId = String(action.actionTypeId ?? "").trim() || null;
      const conditionJson = JSON.stringify(parseJsonObject(action.conditionJson));
      const productId = String(action.productId ?? "").trim() || null;
      const materialId = String(action.materialId ?? "").trim() || null;
      const locationId = String(action.locationId ?? "").trim() || null;
      const equipmentId = String(action.equipmentId ?? "").trim() || null;
      const equipmentProductId = String(action.equipmentProductId ?? "").trim() || null;
      const containerId = String(action.containerId ?? "").trim() || null;
      const containerProductId = String(action.containerProductId ?? "").trim() || null;
      const hasContent = actionTypeId || productId || materialId || locationId || equipmentId || equipmentProductId || containerId || containerProductId || action.quantity || action.targetText || action.standardText || action.note;
      if (!hasContent) continue;

      await sql`
        insert into procedure_step_actions (
          procedure_step_id,
          procedure_variant_id,
          action_type_id,
          product_id,
          material_id,
          location_id,
          equipment_id,
          equipment_product_id,
          container_id,
          container_product_id,
          quantity,
          unit,
          target_text,
          standard_text,
          condition_json,
          note,
          sort_order
        )
        values (
          ${stepId},
          ${variantId},
          ${actionTypeId},
          ${productId},
          ${materialId},
          ${locationId},
          ${equipmentId},
          ${equipmentProductId},
          ${containerId},
          ${containerProductId},
          ${parseOptionalNumber(action.quantity)},
          ${String(action.unit ?? "").trim()},
          ${String(action.targetText ?? "").trim()},
          ${String(action.standardText ?? "").trim()},
          ${conditionJson}::jsonb,
          ${String(action.note ?? "").trim()},
          ${actionIndex}
        )
      `;
    }
  }

  return { id: procedureId };
}
