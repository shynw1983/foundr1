import { randomUUID } from "node:crypto";
import { sql } from "./db";
import type { EmployeeSession } from "./auth";
import { getVisibleProductIdsForStore } from "./product-catalog-access";
import { isHeadquarterCatalogRole } from "./product-catalog-policy";
import { resolveProductUnitConversion, unitConversionSnapshotsEqual } from "./product-unit-conversions";
import type { InventoryRecipe } from "./inventory-recipe-policy";
import { changeProductionBook, convertProductionQuantity, InventoryProductionError, requireProductionBookSnapshot, validateProductionInputs,
  type InventoryProductionPayload, type InventoryTransferPayload, type InventoryTransferReceivePayload,
  type InventoryProductionRecord, type InventoryProductionResponse, type InventoryProductionTarget, type InventoryTransferRecord } from "./inventory-production-policy";

type Payload = InventoryProductionPayload | InventoryTransferPayload | InventoryTransferReceivePayload;
type RawTarget = Record<string, any>;
type Movement = { target: RawTarget; kind: string; quantity: string | null; confidence: string; changesStock: boolean; after: string | null; metadata: Record<string, unknown> };
const json = (value: unknown) => value === null || value === undefined ? null : JSON.stringify(value);
const productConfiguration = (row: RawTarget) => ({ unit: String(row.purchaseUnit), packageQuantity: row.packageQuantity, packageQuantityUnit: row.packageQuantityUnit, inventoryUnitConversions: row.inventoryUnitConversions });
function target(row: RawTarget): InventoryProductionTarget {
  return { id: String(row.id), storeId: String(row.storeId), storeName: String(row.storeName), productId: String(row.productId), productName: String(row.productName), locationId: String(row.locationId), locationName: String(row.locationName), countUnit: String(row.countUnit), stockQuantity: row.stockQuantityRaw === null ? null : Number(row.stockQuantityRaw), stockRevision: Number(row.stockRevision), currentConversion: resolveProductUnitConversion(productConfiguration(row), String(row.countUnit)), stockConversionSnapshot: row.stockConversionSnapshot ?? null };
}
async function targetRows(storeId?: string, ids?: string[]) {
  return await sql`
    select items.id::text,items.store_id::text as "storeId",stores.name as "storeName",items.product_id::text as "productId",products.name as "productName",
      items.location_id::text as "locationId",locations.name as "locationName",items.count_unit as "countUnit",
      items.stock_quantity::text as "stockQuantityRaw",items.stock_revision as "stockRevision",items.stock_conversion_snapshot as "stockConversionSnapshot",
      products.unit as "purchaseUnit",products.package_quantity::float as "packageQuantity",products.package_quantity_unit as "packageQuantityUnit",products.inventory_unit_conversions as "inventoryUnitConversions",
      products.brand_scope as "brandScope",coalesce((select array_agg(brand_id::text) from product_brand_usages where product_id=products.id),'{}'::text[]) as "brandIds",
      exists(select 1 from inventory_stock_receipts receipts where receipts.inventory_item_id=items.id and receipts.batch_packaging_snapshot is not null) as "hasBatchPackaging",
      to_jsonb(products) as "productRaw",to_jsonb(items) as "itemRaw"
    from inventory_items items join inventory_locations locations on locations.id=items.location_id and locations.store_id=items.store_id and locations.status='active'
    join stores on stores.id=items.store_id and stores.status='active' join products on products.id=items.product_id
    where items.status='active' and (${storeId === undefined} or items.store_id::text=${storeId ?? ""})
      and (${ids === undefined} or items.id::text=any(${ids ?? []})) order by items.id
  ` as RawTarget[];
}
async function recipeRows(storeId: string, versionId?: string) {
  return await sql`
    select recipes.id::text,recipes.name,recipes.brand_id::text as "brandId",recipes.kind,
      recipes.target_type as "targetType",recipes.target_id::text as "targetId",recipes.output_product_id::text as "outputProductId",
      recipes.current_version_id::text as "currentVersionId",versions.id::text as "versionId",versions.version,versions.snapshot,recipes.status,
      to_jsonb(recipes) as "recipeRaw"
    from inventory_recipes recipes join inventory_recipe_versions versions on versions.recipe_id=recipes.id
    join store_brands on store_brands.brand_id=recipes.brand_id and store_brands.store_id::text=${storeId}
    where recipes.kind='production' and recipes.status='active'
      and ((${versionId === undefined} and versions.id=recipes.current_version_id) or versions.id::text=${versionId ?? ""}) order by recipes.name
  ` as Array<InventoryRecipe & { versionId: string; recipeRaw: unknown }>;
}
function recipeProducts(recipe: InventoryRecipe) { return [...recipe.snapshot.inputs.map(line => line.productId), recipe.snapshot.output?.productId ?? ""]; }
function redact(value: any): any {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["costPriceJpy", "cost_price_jpy"].includes(key)).map(([key, entry]) => [key, redact(entry)]));
  return value;
}
function operationRecord(row: any, hq: boolean): InventoryProductionRecord {
  const snapshot = hq ? row.snapshot : redact(row.snapshot);
  return { id: String(row.id), requestId: String(row.request_id), action: row.action, recipeVersionId: row.recipe_version_id ?? null,
    recipeName: String(snapshot.recipeName ?? ""), outputInventoryItemId: row.output_inventory_item_id ?? null, outputQuantity: row.output_quantity === null ? null : Number(row.output_quantity),
    outputUnit: String(snapshot.outputUnit ?? ""), inputs: snapshot.inputs ?? [], createdAt: String(row.created_at), recordedBy: String(row.recorded_by_name), snapshot };
}
function transferRecord(row: any, hq: boolean): InventoryTransferRecord {
  return { id: String(row.id), sourceStoreId: String(row.source_store_id), targetStoreId: String(row.target_store_id), productId: String(row.product_id), productName: String(row.productName), targetInventoryItemId: String(row.target_inventory_item_id), quantity: Number(row.quantity), receivedQuantity: Number(row.received_quantity), remainingQuantity: Number(changeProductionBook(String(row.quantity), `-${row.received_quantity}`)), unit: String(row.unit), status: row.status, supplyPriceJpy: row.supply_price_jpy === null ? null : Number(row.supply_price_jpy), ...(hq ? { costPriceJpy: row.cost_price_jpy === null ? null : Number(row.cost_price_jpy) } : {}) };
}
export async function readProductionTransfer(id: string) {
  const rows = await sql`select transfers.*,to_jsonb(transfers) as "transferRaw",products.name as "productName" from inventory_transfers transfers join products on products.id=transfers.product_id where transfers.id::text=${id}`;
  return rows[0] ?? null;
}
export async function readProductionReplay(session: EmployeeSession, payload: Payload) {
  const rows = await sql`select * from inventory_production_operations where request_id::text=${payload.requestId}`;
  const row = rows[0];
  if (!row) return null;
  if (!isHeadquarterCatalogRole(session.role)) {
    const visible = new Set(await getVisibleProductIdsForStore(session, String(row.store_id)));
    if (!(row.snapshot.productIds as string[]).every(id => visible.has(id))) throw new InventoryProductionError("この製造・配送記録を参照する権限がありません。", 403);
    if (row.action === "produce") {
      const brands = await sql`select recipes.id from inventory_recipes recipes join store_brands on store_brands.brand_id=recipes.brand_id where recipes.id::text=${String(row.snapshot.recipeId)} and store_brands.store_id::text=${String(row.store_id)}`;
      if (!brands[0]) throw new InventoryProductionError("このブランドの製造記録を参照する権限がありません。", 403);
    }
  }
  if (JSON.stringify(row.request_payload) !== JSON.stringify(JSON.parse(JSON.stringify(payload)))) {
    // PostgreSQL jsonb key order is not application insertion order.
    const canonical = (value: any): string => JSON.stringify(value && typeof value === "object" ? Array.isArray(value) ? value.map(entry => JSON.parse(canonical(entry))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
    if (canonical(row.request_payload) !== canonical(payload)) throw new InventoryProductionError("同じ送信IDで内容を変更できません。", 409, "request_conflict");
  }
  return { storeId: String(row.store_id), operation: operationRecord(row, isHeadquarterCatalogRole(session.role)), replayed: true };
}
export async function readInventoryProductionResponse(session: EmployeeSession, storeId: string, canProduce: boolean): Promise<InventoryProductionResponse | null> {
  const stores = await sql`select id::text,name from stores where id::text=${storeId} and status='active'`;
  if (!stores[0]) return null;
  const visibleIds = new Set(await getVisibleProductIdsForStore(session, storeId));
  const recipes = (await recipeRows(storeId)).filter(recipe => recipeProducts(recipe).every(id => visibleIds.has(id)));
  const rows = await targetRows(storeId), hq = isHeadquarterCatalogRole(session.role);
  const operationRows = await sql`select * from inventory_production_operations where store_id::text=${storeId} order by created_at desc,id desc limit 50`;
  const visibleRecipeIds = new Set(recipes.map(recipe => recipe.id));
  const recent = operationRows.filter(row => hq || (row.action === 'produce' && visibleRecipeIds.has(String(row.snapshot.recipeId)) && (row.snapshot.productIds as string[]).every(id => visibleIds.has(id)))).map(row => operationRecord(row, hq));
  const transferRows = await sql`select transfers.*,products.name as "productName" from inventory_transfers transfers join products on products.id=transfers.product_id where transfers.target_store_id::text=${storeId} or (${hq} and transfers.source_store_id::text=${storeId}) order by dispatched_at desc limit 50`;
  const transfers = transferRows.filter(row => hq || visibleIds.has(String(row.product_id))).map(row => transferRecord(row, hq));
  return { store: { id: storeId, name: String(stores[0].name) }, recipes, inventoryItems: rows.filter(row => visibleIds.has(String(row.productId))).map(target), recent, transfers, canProduce, canTransfer: canProduce && hq, canReceive: canProduce,
    ...(hq ? { transferInventoryItems: (await targetRows()).map(target) } : {}) };
}

function exactMovement(row: RawTarget, amount: number, inputUnit: string, kind: string, direction: 1 | -1): Movement {
  const converted = convertProductionQuantity(amount, productConfiguration(row), inputUnit, String(row.countUnit), row);
  requireProductionBookSnapshot(row.stockQuantityRaw, row.stockConversionSnapshot ?? null, converted.conversion);
  const quantity = direction === -1 ? `-${converted.quantity}` : converted.quantity;
  return { target: row, kind, quantity, confidence: "exact", changesStock: true, after: changeProductionBook(row.stockQuantityRaw, quantity), metadata: { inputUnit, actualQuantity: amount, conversionSnapshot: converted.conversion } };
}
function targetCheck(row: RawTarget | undefined, storeId: string, productId: string, expectedRevision: number) {
  if (!row || row.storeId !== storeId || row.productId !== productId) throw new InventoryProductionError("同じ店舗・商品の有効な庫位を指定してください。", 409, "target_mismatch");
  if (Number(row.stockRevision) !== expectedRevision) throw new InventoryProductionError("在庫が更新されました。再取得してください。", 409, "stock_changed");
  return row;
}
async function persist(session: EmployeeSession, payload: Payload, storeId: string, movements: Movement[], snapshot: Record<string, any>, recipe?: InventoryRecipe & { recipeRaw: unknown }, transfer?: any, extraTargets: RawTarget[] = []) {
  const guardedRows = [...new Map([...movements.map(line => line.target), ...extraTargets].map(row => [row.id, row])).values()];
  const operationId = randomUUID(), productIds = [...new Set(guardedRows.map(row => String(row.productId)))].sort(), itemIds = [...new Set(guardedRows.map(row => String(row.id)))].sort();
  const queries: any[] = [
    sql`select pg_advisory_xact_lock(hashtextextended(${`inventory-production:${payload.requestId}`},0))`,
    sql`select id from products where id::text=any(${productIds}) order by id for share`,
    sql`select id from inventory_items where id::text=any(${itemIds}) order by id for update`,
    sql`select 1 / count(*)::int from (select 1 where not exists(select 1 from inventory_production_operations where request_id::text=${payload.requestId})) valid`
  ];
  if (recipe) queries.push(sql`select 1 / count(*)::int from inventory_recipes where id::text=${recipe.id} and to_jsonb(inventory_recipes)=${json(recipe.recipeRaw)}::jsonb and exists(select 1 from store_brands where store_id::text=${storeId} and brand_id::text=${recipe.brandId})`);
  if (payload.action === "transfer_receive") queries.push(sql`select id from inventory_transfers where id::text=${payload.transferId} for update`, sql`select 1 / count(*)::int from inventory_transfers where id::text=${payload.transferId} and status='in_transit' and to_jsonb(inventory_transfers)=${json(transfer.transferRaw)}::jsonb and received_quantity+${payload.quantity}::numeric<=quantity`);
  for (const row of guardedRows) {
    queries.push(sql`select 1 / count(*)::int from inventory_items items join inventory_locations locations on locations.id=items.location_id and locations.store_id=items.store_id and locations.status='active' join stores on stores.id=items.store_id and stores.status='active' join products on products.id=items.product_id where items.id::text=${row.id} and items.status='active' and to_jsonb(items)=${json(row.itemRaw)}::jsonb and to_jsonb(products)=${json(row.productRaw)}::jsonb
      and (products.brand_scope='common' or exists(select 1 from product_brand_usages usages join store_brands scopes on scopes.brand_id=usages.brand_id and scopes.store_id=items.store_id where usages.product_id=products.id and (${recipe === undefined} or usages.brand_id::text=${recipe?.brandId ?? ""})))
      and (${isHeadquarterCatalogRole(session.role)} or products.catalog_visibility='brand_stores' or (products.catalog_visibility='selected_stores' and exists(select 1 from product_catalog_store_grants grants where grants.product_id=products.id and grants.store_id=items.store_id)))`);
  }
  if (payload.action === "transfer_dispatch") queries.push(sql`insert into inventory_transfers(id,source_store_id,target_store_id,product_id,source_inventory_item_id,target_inventory_item_id,quantity,unit,cost_price_jpy,supply_price_jpy,snapshot,dispatched_by) values(${snapshot.transferId}::uuid,${payload.sourceStoreId}::uuid,${payload.targetStoreId}::uuid,${payload.productId}::uuid,${payload.sourceInventoryItemId}::uuid,${payload.targetInventoryItemId}::uuid,${payload.quantity},${payload.unit},${payload.costPriceJpy},${payload.supplyPriceJpy},${json(snapshot)}::jsonb,${session.id}::uuid)`);
  if (payload.action === "transfer_receive") queries.push(sql`update inventory_transfers set received_quantity=received_quantity+${payload.quantity}::numeric,status=case when received_quantity+${payload.quantity}::numeric=quantity then 'received' else 'in_transit' end,received_at=now() where id::text=${payload.transferId}`);
  queries.push(sql`insert into inventory_production_operations(id,request_id,action,store_id,recipe_version_id,transfer_id,output_inventory_item_id,output_quantity,request_payload,snapshot,recorded_by,recorded_by_name) values(${operationId}::uuid,${payload.requestId}::uuid,${payload.action},${storeId}::uuid,${payload.action === "produce" ? payload.recipeVersionId : null}::uuid,${snapshot.transferId ?? null}::uuid,${payload.action === "produce" ? payload.outputInventoryItemId : null}::uuid,${payload.action === "produce" ? payload.outputQuantity : null},${json(payload)}::jsonb,${json(snapshot)}::jsonb,${session.id}::uuid,${session.name ?? ""})`);
  for (const [index, movement] of movements.entries()) {
    const row = movement.target;
    queries.push(sql`update inventory_items set stock_quantity=case when ${movement.changesStock} then ${movement.after}::numeric else stock_quantity end,stock_revision=stock_revision+1,last_received_at=case when ${movement.kind === "transfer_in"} then now() else last_received_at end,updated_at=now() where id::text=${row.id}`);
    queries.push(sql`insert into inventory_movements(operation_key,store_id,product_id,inventory_item_id,kind,quantity,count_unit,confidence,exposure,occurred_at,recipe_version_id,before_quantity,after_quantity,changes_stock,metadata) values(${`production:${operationId}:${index}`},${row.storeId}::uuid,${row.productId}::uuid,${row.id}::uuid,${movement.kind},${movement.quantity}::numeric,${row.countUnit},${movement.confidence},${payload.action === "produce" ? payload.outputQuantity : payload.quantity},now(),${payload.action === "produce" ? payload.recipeVersionId : null}::uuid,${row.stockQuantityRaw}::numeric,${movement.after}::numeric,${movement.changesStock},${json({ operationId, ...movement.metadata })}::jsonb)`);
  }
  await sql.transaction(queries);
  const recorded = await readProductionReplay(session, payload);
  if (!recorded) throw new InventoryProductionError("製造・配送記録を読み出せません。", 500);
  return { ...recorded, replayed: false };
}
export async function recordInventoryProduction(session: EmployeeSession, payload: InventoryProductionPayload) {
  const recipe = (await recipeRows(payload.storeId, payload.recipeVersionId))[0];
  if (!recipe || recipe.currentVersionId !== payload.recipeVersionId) throw new InventoryProductionError("製造配合の版を再取得してください。", 409, "recipe_changed");
  const visible = new Set(await getVisibleProductIdsForStore(session, payload.storeId));
  if (!recipeProducts(recipe).every(id => visible.has(id))) throw new InventoryProductionError("この製造配合を利用する権限がありません。", 403);
  validateProductionInputs(payload, recipe.snapshot);
  const output = recipe.snapshot.output!;
  const rows = await targetRows(payload.storeId, [payload.outputInventoryItemId, ...payload.inputs.map(line => line.inventoryItemId)]);
  const movements: Movement[] = [];
  const outputRow = targetCheck(rows.find(row => row.id === payload.outputInventoryItemId), payload.storeId, output.productId, payload.expectedOutputStockRevision);
  for (const row of rows) if (row.brandScope !== "common" && !row.brandIds.includes(recipe.brandId)) throw new InventoryProductionError("配合と同じブランドの商品を指定してください。", 403, "brand_scope");
  for (const input of payload.inputs) {
    const row = targetCheck(rows.find(row => row.id === input.inventoryItemId), payload.storeId, input.productId, input.expectedStockRevision);
    if (input.mode === "exact") movements.push(exactMovement(row, input.quantity!, input.unit, "production_input", -1));
    else {
      let converted: string | null = null;
      if (input.mode === "estimate") { try { converted = `-${convertProductionQuantity(input.quantity!, productConfiguration(row), input.unit, row.countUnit, row).quantity}`; } catch (error) { if (!(error instanceof InventoryProductionError)) throw error; } }
      movements.push({ target: row, kind: "production_input", quantity: converted, confidence: input.mode, changesStock: false, after: row.stockQuantityRaw, metadata: { quantity: input.quantity, unit: input.unit, standardRecipeVersionId: payload.recipeVersionId } });
    }
  }
  movements.push(exactMovement(outputRow, payload.outputQuantity, output.unit, "production_output", 1));
  return persist(session, payload, payload.storeId, movements, { recipeId: recipe.id, recipeName: recipe.name, recipeSnapshot: recipe.snapshot, productIds: recipeProducts(recipe), inputs: payload.inputs, outputUnit: output.unit, outputQuantity: payload.outputQuantity }, recipe);
}
export async function recordInventoryTransfer(session: EmployeeSession, payload: InventoryTransferPayload | InventoryTransferReceivePayload) {
  if (payload.action === "transfer_dispatch") {
    if (!isHeadquarterCatalogRole(session.role)) throw new InventoryProductionError("配送出庫は本部担当者が登録してください。", 403);
    const rows = await targetRows(undefined, [payload.sourceInventoryItemId, payload.targetInventoryItemId]);
    const source = targetCheck(rows.find(row => row.id === payload.sourceInventoryItemId), payload.sourceStoreId, payload.productId, payload.expectedSourceStockRevision);
    const destination = rows.find(row => row.id === payload.targetInventoryItemId);
    if (!destination || destination.storeId !== payload.targetStoreId || destination.productId !== payload.productId) throw new InventoryProductionError("配送先の店舗・商品・庫位を確認してください。", 409);
    const visible = new Set(await getVisibleProductIdsForStore(session, payload.targetStoreId));
    if (!visible.has(payload.productId)) throw new InventoryProductionError("配送先ブランドの商品ではありません。", 403);
    if ((source.hasBatchPackaging || destination.hasBatchPackaging) && source.countUnit !== destination.countUnit) throw new InventoryProductionError("包装批次のある移動は同じ基準単位で確認してください。", 409, "batch_unit_identity_required");
    const destinationConversion = convertProductionQuantity(payload.quantity, productConfiguration(destination), payload.unit, destination.countUnit, destination);
    const transferId = randomUUID();
    const movement = exactMovement(source, payload.quantity, payload.unit, "transfer_out", -1);
    return persist(session, payload, payload.sourceStoreId, [movement], { transferId, productIds: [payload.productId], unit: payload.unit, targetInventoryItemId: payload.targetInventoryItemId, destinationConversion: destinationConversion.conversion, destinationCountUnit: destination.countUnit, costPriceJpy: payload.costPriceJpy, supplyPriceJpy: payload.supplyPriceJpy }, undefined, undefined, [destination]);
  }
  const transfer = await readProductionTransfer(payload.transferId);
  if (!transfer || transfer.status !== "in_transit") throw new InventoryProductionError("受領できる配送が見つかりません。", 409);
  const rows = await targetRows(String(transfer.target_store_id), [String(transfer.target_inventory_item_id)]);
  if (!(await getVisibleProductIdsForStore(session, String(transfer.target_store_id))).includes(String(transfer.product_id))) throw new InventoryProductionError("この配送商品を操作する権限がありません。", 403);
  const destination = targetCheck(rows[0], String(transfer.target_store_id), String(transfer.product_id), payload.expectedTargetStockRevision);
  const total = changeProductionBook(String(transfer.received_quantity), String(payload.quantity));
  if (total === null || Number(total) > Number(transfer.quantity)) throw new InventoryProductionError("配送数量を超えて受領できません。", 409, "over_receipt");
  const movement = exactMovement(destination, payload.quantity, String(transfer.unit), "transfer_in", 1);
  if (destination.countUnit !== transfer.snapshot.destinationCountUnit || !unitConversionSnapshotsEqual(movement.metadata.conversionSnapshot, transfer.snapshot.destinationConversion)) throw new InventoryProductionError("配送中に庫位の単位対応が変更されています。確認してください。", 409, "conversion_changed");
  return persist(session, payload, String(transfer.target_store_id), [movement], { transferId: payload.transferId, productIds: [String(transfer.product_id)], outputUnit: transfer.unit, receivedQuantity: payload.quantity, supplyPriceJpy: transfer.supply_price_jpy }, undefined, { transferRaw: transfer.transferRaw });
}
