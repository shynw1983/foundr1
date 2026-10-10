import { randomUUID } from "node:crypto";
import type { EmployeeSession } from "./auth";
import { canAccessStore, getSessionStoreScope } from "./api-auth";
import { getProductCatalogAccessSnapshot, getVisibleProductIdsForStore } from "./product-catalog-access";
import { sql } from "./db";
import { InventoryRecipeError, inventoryRecipeCreateRequestPayload, inventoryRecipeIsVisible, normalizeInventoryRecipePayload, type InventoryRecipe, type InventoryRecipesResponse } from "./inventory-recipe-policy";

function mapRecipe(row: Record<string, unknown>): InventoryRecipe {
  return { id: String(row.id), name: String(row.name), brandId: String(row.brandId), kind: row.kind as InventoryRecipe["kind"],
    targetType: (row.targetType ?? null) as InventoryRecipe["targetType"], targetId: row.targetId ? String(row.targetId) : null,
    outputProductId: row.outputProductId ? String(row.outputProductId) : null, currentVersionId: String(row.currentVersionId),
    version: Number(row.version), snapshot: row.snapshot as InventoryRecipe["snapshot"], status: row.status as InventoryRecipe["status"] };
}
export async function readInventoryRecipe(id: string) {
  const rows = await sql`select recipes.id::text,recipes.name,recipes.brand_id::text as "brandId",recipes.kind,
    recipes.target_type as "targetType",recipes.target_id::text as "targetId",recipes.output_product_id::text as "outputProductId",
    recipes.current_version_id::text as "currentVersionId",recipes.status,versions.version,versions.snapshot
    from inventory_recipes recipes join inventory_recipe_versions versions on versions.id=recipes.current_version_id where recipes.id::text=${id}`;
  return rows[0] ? mapRecipe(rows[0]) : null;
}
export async function readInventoryRecipes(session: EmployeeSession, canManage: boolean, storeId?: string, brandId?: string): Promise<InventoryRecipesResponse> {
  if (storeId && !await canAccessStore(session, storeId)) throw new InventoryRecipeError("この店舗の配合を確認する権限がありません。", 403, "store_scope");
  const scope = await getSessionStoreScope(session);
  const headquarters = session.role === "owner" || session.role === "manager";
  const storeIds = storeId ? [storeId] : scope.storeIds;
  const allBrands = !storeId && scope.allStores;
  const [brandRows, visibleIds] = await Promise.all([
    sql`select brands.id::text,brands.name from brands where (${brandId === undefined} or brands.id::text=${brandId ?? ""})
      and (${allBrands} or exists(select 1 from store_brands where store_brands.brand_id=brands.id and store_brands.store_id::text=any(${storeIds}))) order by brands.name`,
    storeId ? getVisibleProductIdsForStore(session, storeId) : getProductCatalogAccessSnapshot(session).then(access => access.visibleProductIds)
  ]);
  const brandIds = brandRows.map(row => String(row.id));
  const [recipeRows, productRows, targetRows] = await Promise.all([
    sql`select recipes.id::text,recipes.name,recipes.brand_id::text as "brandId",recipes.kind,
      recipes.target_type as "targetType",recipes.target_id::text as "targetId",recipes.output_product_id::text as "outputProductId",
      recipes.current_version_id::text as "currentVersionId",recipes.status,versions.version,versions.snapshot
      from inventory_recipes recipes join inventory_recipe_versions versions on versions.id=recipes.current_version_id
      where recipes.brand_id::text=any(${brandIds}) and (${headquarters} or recipes.status='active') order by recipes.name,recipes.id`,
    sql`select products.id::text,products.name,products.unit,products.package_quantity::float as "packageQuantity",
      coalesce(products.package_quantity_unit,'') as "packageQuantityUnit",products.inventory_unit_conversions as "inventoryUnitConversions"
      from products where products.id::text=any(${visibleIds}) and (products.brand_scope='common' or exists(
       select 1 from product_brand_usages usage where usage.product_id=products.id and usage.brand_id::text=any(${brandIds}))) order by products.name,products.id`,
    sql`select id::text,'item'::text as type,name,brand_id::text as "brandId" from menu_catalog_items
      where store_id is null and is_active and brand_id::text=any(${brandIds})
      union all select options.id::text,'option',options.name,groups.brand_id::text from menu_options options
      join menu_option_groups groups on groups.id=options.option_group_id left join menu_catalog_items parent on parent.id=groups.menu_catalog_item_id
      where options.is_active and groups.is_active and coalesce(parent.is_active,true)
       and (groups.menu_catalog_item_id is null or parent.store_id is null) and groups.brand_id::text=any(${brandIds})`
  ]);
  const allowed = new Set(productRows.map(row => String(row.id)));
  const activeTargets = new Set(targetRows.map(row => `${row.type}:${row.id}`));
  return { recipes: recipeRows.map(mapRecipe).filter(recipe => headquarters || (inventoryRecipeIsVisible(recipe, allowed) &&
      (recipe.kind === "production" || activeTargets.has(`${recipe.targetType}:${recipe.targetId}`)))),
    products: productRows.map(row => ({ id: String(row.id), name: String(row.name), unit: String(row.unit), packageQuantity: row.packageQuantity === null ? null : Number(row.packageQuantity),
      packageQuantityUnit: String(row.packageQuantityUnit), inventoryUnitConversions: Array.isArray(row.inventoryUnitConversions) ? row.inventoryUnitConversions : [] })),
    menuTargets: targetRows.map(row => ({ id: String(row.id), type: row.type as "item" | "option", name: String(row.name), brandId: String(row.brandId) })),
    brands: brandRows.map(row => ({ id: String(row.id), name: String(row.name) })), canManage };
}
export async function saveInventoryRecipe(session: EmployeeSession, value: unknown) {
  const payload = normalizeInventoryRecipePayload(value);
  const createPayload = payload.id ? null : JSON.stringify(inventoryRecipeCreateRequestPayload(payload));
  // A lost creation response can be retried even after a later revision or target change.
  if (!payload.id) {
    const replay = await sql`select create_request_payload=${createPayload}::jsonb as "createRequestMatches" from inventory_recipes where id::text=${payload.requestId!}`;
    if (replay[0]) {
      if (replay[0].createRequestMatches !== true) throw new InventoryRecipeError("同じ送信IDで別の配合は保存できません。", 409, "request_conflict");
      const recipe = await readInventoryRecipe(payload.requestId!);
      if (!recipe) throw new InventoryRecipeError("保存した配合を再取得できません。", 503, "read_failed");
      return recipe;
    }
  }
  const existing = payload.id ? await readInventoryRecipe(payload.id) : null;
  if (payload.id && !existing) throw new InventoryRecipeError("配合が見つかりません。", 404, "recipe_missing");
  if (existing && payload.expectedVersionId !== existing.currentVersionId) throw new InventoryRecipeError("配合版が更新されています。再取得して確認してください。", 409, "version_changed");
  if (payload.action === "save" && existing && (existing.brandId !== payload.brandId || existing.kind !== payload.kind || existing.targetType !== payload.targetType || existing.targetId !== payload.targetId || existing.outputProductId !== payload.outputProductId)) {
    throw new InventoryRecipeError("対象ブランド・メニュー・産出商品を変更する場合は、元の配合を停止して新規作成してください。", 409, "recipe_identity_changed");
  }
  const id = existing?.id ?? payload.requestId!, versionId = randomUUID();
  const savedSnapshot=payload.action==="save" ? payload.snapshot:existing!.snapshot;
  const productIds = [...new Set([...savedSnapshot.inputs.map(input=>input.productId),...((payload.outputProductId ?? existing?.outputProductId) ? [String(payload.outputProductId ?? existing?.outputProductId)]:[])])].sort();
  const queries = [sql`select pg_advisory_xact_lock(hashtextextended(${`inventory-recipe:${id}`},0))`];
  if (!existing) queries.push(sql`select 1/count(*)::int from (select 1 where not exists(select 1 from inventory_recipes where id::text=${id})
    or exists(select 1 from inventory_recipes where id::text=${id} and create_request_payload=${createPayload}::jsonb)) valid`);
  if (productIds.length) queries.push(sql`select id from products where id::text=any(${productIds}) order by id for share`);
  if (payload.action === "save") {
    queries.push(sql`select id from brands where id::text=${payload.brandId} for share`);
    if (payload.targetType === "item") queries.push(sql`select id from menu_catalog_items where id::text=${payload.targetId} for share`);
    if (payload.targetType === "option") queries.push(sql`select options.id from menu_options options join menu_option_groups groups on groups.id=options.option_group_id
      left join menu_catalog_items parent on parent.id=groups.menu_catalog_item_id where options.id::text=${payload.targetId} for share of options,groups`);
    if(payload.targetType==="option") queries.push(sql`select parent.id from menu_catalog_items parent join menu_option_groups groups on groups.menu_catalog_item_id=parent.id
      join menu_options options on options.option_group_id=groups.id where options.id::text=${payload.targetId} for share of parent`);
    queries.push(sql`select 1/count(*)::int from (select 1 where (${!existing} and exists(select 1 from inventory_recipes where id::text=${id} and create_request_payload=${createPayload}::jsonb))
      or (exists(select 1 from brands where id::text=${payload.brandId})
      and (select count(*) from products where id::text=any(${productIds}) and (brand_scope='common' or (brand_scope='specific' and exists(
       select 1 from product_brand_usages usage where usage.product_id=products.id and usage.brand_id::text=${payload.brandId}))))=${productIds.length}::int
      and (${payload.kind === "production"} or exists(select 1 from menu_catalog_items where ${payload.targetType === "item"} and id::text=${payload.targetId} and brand_id::text=${payload.brandId} and store_id is null and is_active)
       or exists(select 1 from menu_options options join menu_option_groups groups on groups.id=options.option_group_id left join menu_catalog_items parent on parent.id=groups.menu_catalog_item_id
        where ${payload.targetType === "option"} and options.id::text=${payload.targetId} and groups.brand_id::text=${payload.brandId} and options.is_active and groups.is_active and coalesce(parent.is_active,true)
         and (groups.menu_catalog_item_id is null or parent.store_id is null))))) valid`);
  }
  if (existing) {
    queries.push(sql`select id from inventory_recipes where id::text=${id} for update`);
    queries.push(sql`select 1/count(*)::int from inventory_recipes where id::text=${id} and current_version_id::text=${payload.expectedVersionId}
      and brand_id::text=${existing.brandId} and kind=${existing.kind} and target_type is not distinct from ${existing.targetType} and target_id::text is not distinct from ${existing.targetId}
      and output_product_id::text is not distinct from ${existing.outputProductId}`);
  } else {
    queries.push(sql`insert into inventory_recipes(id,brand_id,name,kind,target_type,target_id,output_product_id,created_by,updated_by,create_request_payload)
      values(${id}::uuid,${payload.brandId}::uuid,${payload.name},${payload.kind},${payload.targetType},${payload.targetId}::uuid,${payload.outputProductId}::uuid,${session.id}::uuid,${session.id}::uuid,${createPayload}::jsonb)
      on conflict(id) do nothing`);
  }
  // Stopping publishes a new immutable revision too, invalidating editors opened before the stop.
  queries.push(sql`insert into inventory_recipe_versions(id,recipe_id,version,snapshot,created_by)
    select ${versionId}::uuid,${id}::uuid,${(existing?.version ?? 0)+1},${JSON.stringify(savedSnapshot)}::jsonb,${session.id}::uuid
    where ${!!existing} or exists(select 1 from inventory_recipes where id::text=${id} and current_version_id is null)`);
  queries.push(sql`insert into inventory_recipe_version_products(recipe_version_id,product_id) select ${versionId}::uuid,product_id::uuid from unnest(${productIds}::text[]) as ids(product_id)
    where exists(select 1 from inventory_recipe_versions where id::text=${versionId})`);
  queries.push(sql`update inventory_recipes set name=${payload.action==="save" ? payload.name:existing!.name},status=${payload.action==="inactivate" ? "inactive":"active"},current_version_id=${versionId}::uuid,updated_at=now(),updated_by=${session.id}::uuid
    where id::text=${id} and exists(select 1 from inventory_recipe_versions where id::text=${versionId})`);
  try { await sql.transaction(queries); }
  catch(error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "22012") {
      if (!existing) {
        const replay = await sql`select create_request_payload=${createPayload}::jsonb as "createRequestMatches" from inventory_recipes where id::text=${id}`;
        if (replay[0] && replay[0].createRequestMatches !== true) throw new InventoryRecipeError("同じ送信IDで別の配合は保存できません。",409,"request_conflict");
      }
      throw new InventoryRecipeError("配合版・商品・メニューの適用範囲が変わりました。再取得して確認してください。",409,"version_changed");
    }
    if (code === "23505") throw new InventoryRecipeError("このメニューには有効な配合が既にあります。",409,"recipe_exists");
    throw error;
  }
  const recipe = await readInventoryRecipe(id);
  if (!recipe) throw new InventoryRecipeError("保存した配合を再取得できません。",503,"read_failed");
  return recipe;
}
