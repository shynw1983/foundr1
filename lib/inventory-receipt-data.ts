import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { createReplenishmentOrderLocks } from "./replenishment-order-locks";
import { resolveProductUnitConversion, type ProductUnitConversionSnapshot } from "./product-unit-conversions";
import { normalizeProductBatchPackaging } from "./product-packaging-policy";
import { readProductPackagingTemplates } from "./product-packaging-data";
import {
  InventoryReceiptError, inventoryReceiptSourceBlockedReason, inventoryReceiptTargetBlockedReason, validateInventoryReceipt,
  type InventoryReceiptInventoryItem, type InventoryReceiptPayload, type InventoryReceiptRecord,
  type InventoryReceiptResponse, type InventoryReceiptSource, type InventoryReceiptSourceSnapshot
} from "./inventory-receipt-policy";

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
function textOrNull(value: unknown) { return value === null || value === undefined || value === "" ? null : String(value); }
function signedNumber(value:unknown) { if(value===null || value===undefined || value==="") return null;const result=Number(value);return Number.isFinite(result) ? result:null; }
function mapSource(row: Record<string, unknown>): InventoryReceiptSource {
  const expectedSource = row.expectedSource as InventoryReceiptSourceSnapshot;
  const source = {
    purchaseOrderItemId: String(row.purchaseOrderItemId), purchaseOrderId: String(row.purchaseOrderId), orderNo: String(row.orderNo),
    storeId: String(row.storeId), productId: String(row.productId), productName: String(row.productName), status: String(row.status),
    purchaseUnit: String(row.purchaseUnit), actualQuantity: number(expectedSource.actualQuantity), actualUnit: textOrNull(expectedSource.actualUnit),
    receivedPurchaseQuantity: Number(row.receivedPurchaseQuantity ?? 0),
    receivedPurchaseUnits: (Array.isArray(row.receivedPurchaseUnits) ? row.receivedPurchaseUnits : []).map(group => ({
      quantity: Number(group.quantity), purchaseUnit: String(group.purchaseUnit)
    })), remainingPurchaseQuantity: null as number | null,
    blockedReason: null as string | null, unverifiedBlockedReason: null as string | null, unverifiedRemainingPurchaseQuantity: null as number | null,
    correctionHref: `/os/orders?order=${encodeURIComponent(String(row.orderNo))}`, expectedSource,
    actualPackaging: expectedSource.actualPackaging ? normalizeProductBatchPackaging(expectedSource.actualPackaging):null
  };
  const matchingUnits = Boolean(source.actualUnit && (source.actualPackaging || source.actualUnit === source.purchaseUnit) &&
    source.receivedPurchaseUnits.every(group => group.quantity <= 0 || group.purchaseUnit === source.actualUnit));
  source.remainingPurchaseQuantity = source.actualQuantity === null || !matchingUnits ? null
    : Math.max(0, Number((source.actualQuantity - source.receivedPurchaseQuantity).toFixed(6)));
  source.blockedReason = inventoryReceiptSourceBlockedReason(source,source.actualPackaging ? "unverified":"add");
  source.unverifiedBlockedReason = inventoryReceiptSourceBlockedReason(source, "unverified");
  const matchingRecordedUnits = Boolean(source.actualUnit && source.receivedPurchaseUnits.every(group => group.quantity <= 0 || group.purchaseUnit === source.actualUnit));
  source.unverifiedRemainingPurchaseQuantity = source.actualQuantity === null || !matchingRecordedUnits ? null
    : Math.max(0, Number((source.actualQuantity - source.receivedPurchaseQuantity).toFixed(6)));
  return source;
}

async function sourceRows(storeId?: string, orderNo?: string, itemId?: string) {
  return sql`
    select items.id::text as "purchaseOrderItemId", orders.id::text as "purchaseOrderId", orders.order_no as "orderNo",
      orders.store_id::text as "storeId", items.product_id::text as "productId", products.name as "productName",
      items.status, products.unit as "purchaseUnit",
      coalesce((select sum(receipts.purchase_quantity) from inventory_stock_receipts receipts
        where receipts.purchase_order_item_id = items.id), 0)::float as "receivedPurchaseQuantity",
      coalesce((select jsonb_agg(jsonb_build_object('quantity', grouped.quantity::float, 'purchaseUnit', grouped.purchase_unit) order by grouped.purchase_unit)
        from (select receipts.purchase_unit, sum(receipts.purchase_quantity) as quantity
          from inventory_stock_receipts receipts where receipts.purchase_order_item_id = items.id
          group by receipts.purchase_unit having sum(receipts.purchase_quantity) > 0) grouped), '[]'::jsonb) as "receivedPurchaseUnits",
      jsonb_build_object(
        'purchaseOrderItemId', items.id::text, 'purchaseOrderId', orders.id::text, 'storeId', orders.store_id::text,
        'productId', items.product_id::text, 'status', items.status,
        'actualQuantity', coalesce(items.actual_quantity, actuals.actual_quantity),
        'actualUnit', case when actuals.actual_quantity is not null and actuals.actual_quantity is not distinct from coalesce(items.actual_quantity, actuals.actual_quantity)
          then nullif(btrim(actuals.actual_unit), '') else null end,
        'latestActualId', actuals.id::text, 'latestActualQuantity', actuals.actual_quantity,
        'latestActualUnit', nullif(btrim(actuals.actual_unit), ''), 'latestActualRecordedAt', actuals.recorded_at::text,
        'deliveryBatchId', batches.id::text, 'deliveryBatchStatus', batches.status,
        'actualPackaging',coalesce(items.actual_packaging_snapshot,actuals.packaging_snapshot)
      ) as "expectedSource"
    from purchase_order_items items join purchase_orders orders on orders.id = items.purchase_order_id
    join stores on stores.id = orders.store_id and stores.status = 'active'
    join products on products.id = items.product_id
    left join lateral (select * from purchase_actuals where purchase_order_item_id = items.id
      order by recorded_at desc, id desc limit 1) actuals on true
    left join delivery_batch_items links on links.purchase_order_item_id = items.id
    left join delivery_batches batches on batches.id = links.delivery_batch_id
    where (${storeId === undefined} or orders.store_id::text = ${storeId ?? ""})
      and (${orderNo === undefined} or orders.order_no = ${orderNo ?? ""})
      and (${itemId === undefined} or items.id::text = ${itemId ?? ""})
      and (${itemId !== undefined} or (items.status in ('delivered', 'received') and orders.order_no not like 'RCPT-%'))
    order by orders.created_at desc, items.id limit 200
  `;
}
export async function readInventoryReceiptSource(itemId: string) {
  const rows = await sourceRows(undefined, undefined, itemId);
  return rows[0] ? mapSource(rows[0]) : null;
}

async function targetRows(storeId: string, productIds?: string[], itemId?: string) {
  return sql`
    select items.id::text, items.store_id::text as "storeId", items.product_id::text as "productId", products.name as "productName",
      items.location_id::text as "locationId", locations.name as "locationName", items.count_unit as "countUnit",
      items.current_quantity::float as "currentQuantity", items.stock_quantity::float as "stockQuantity", items.stock_revision as "stockRevision",
      items.count_conversion_snapshot as "countConversionSnapshot", items.stock_conversion_snapshot as "stockConversionSnapshot",
      items.last_counted_at::text as "lastCountedAt", items.last_received_at::text as "lastReceivedAt",
      products.unit as "purchaseUnit", products.package_quantity::float as "packageQuantity", products.package_quantity_unit as "packageQuantityUnit",
      products.inventory_unit_conversions as "inventoryUnitConversions"
    from inventory_items items join inventory_locations locations on locations.id = items.location_id and locations.store_id = items.store_id
    join products on products.id = items.product_id
    where items.store_id::text = ${storeId} and items.status = 'active' and locations.status = 'active'
      and (${productIds === undefined} or items.product_id::text = any(${productIds ?? []}))
      and (${itemId === undefined} or items.id::text = ${itemId ?? ""})
    order by products.name, locations.name, items.id
  `;
}
function mapTarget(row: Record<string, unknown>): InventoryReceiptInventoryItem {
  const target: InventoryReceiptInventoryItem = {
    id: String(row.id), storeId: String(row.storeId), productId: String(row.productId), productName: String(row.productName),
    locationId: String(row.locationId), locationName: String(row.locationName), countUnit: String(row.countUnit),
    currentQuantity: number(row.currentQuantity), stockQuantity: signedNumber(row.stockQuantity), stockRevision: Number(row.stockRevision),
    currentConversion: resolveProductUnitConversion({ unit: String(row.purchaseUnit), packageQuantity: row.packageQuantity as number | null,
      packageQuantityUnit: String(row.packageQuantityUnit ?? ""), inventoryUnitConversions: row.inventoryUnitConversions }, String(row.countUnit)),
    countConversionSnapshot: (row.countConversionSnapshot ?? null) as ProductUnitConversionSnapshot | null,
    stockConversionSnapshot: (row.stockConversionSnapshot ?? null) as ProductUnitConversionSnapshot | null,
    lastCountedAt: textOrNull(row.lastCountedAt), lastReceivedAt: textOrNull(row.lastReceivedAt), addBlockedReason: null, includedBlockedReason: null, unverifiedBlockedReason: null,
    batchAddBlockedReason:signedNumber(row.stockQuantity)===null ? "stock_unknown":null,
    batchIncludedBlockedReason:signedNumber(row.stockQuantity)===null ? "stock_unknown":number(row.currentQuantity)===null || !row.lastCountedAt ? "count_unknown":null
  };
  target.addBlockedReason = inventoryReceiptTargetBlockedReason(target, "add");
  target.includedBlockedReason = inventoryReceiptTargetBlockedReason(target, "included");
  return target;
}
function mapReceipt(row: Record<string, unknown>): InventoryReceiptRecord {
  return {
    id: String(row.id), requestId: String(row.requestId), purchaseOrderItemId: String(row.purchaseOrderItemId), inventoryItemId: String(row.inventoryItemId),
    storeId: String(row.storeId), orderNo: String(row.orderNo), productName: String(row.productName), locationName: String(row.locationName),
    purchaseQuantity: Number(row.purchaseQuantity), purchaseUnit: String(row.purchaseUnit), countQuantity: number(row.countQuantity), countUnit: String(row.countUnit),
    mode: row.mode === "unverified" ? "unverified" : row.mode === "included" ? "included" : "add",
    conversionSnapshot: (row.conversionSnapshot ?? null) as ProductUnitConversionSnapshot | null,
    beforeStockQuantity: signedNumber(row.beforeStockQuantity), afterStockQuantity: signedNumber(row.afterStockQuantity),
    batchPackaging:row.batchPackaging ? normalizeProductBatchPackaging(row.batchPackaging):null,
    recordedBy: String(row.recordedBy ?? ""), createdAt: String(row.createdAt)
  };
}
async function receiptRows(storeId?: string, orderNo?: string, requestId?: string) {
  return sql`
    select receipts.id::text, receipts.request_id::text as "requestId", receipts.purchase_order_item_id::text as "purchaseOrderItemId",
      receipts.inventory_item_id::text as "inventoryItemId", receipts.store_id::text as "storeId", orders.order_no as "orderNo",
      products.name as "productName", locations.name as "locationName", receipts.purchase_quantity::float as "purchaseQuantity",
      receipts.purchase_unit as "purchaseUnit", receipts.count_quantity::float as "countQuantity", receipts.count_unit as "countUnit", receipts.mode,
      receipts.conversion_snapshot as "conversionSnapshot",receipts.batch_packaging_snapshot as "batchPackaging",
      receipts.before_stock_quantity::float as "beforeStockQuantity", receipts.after_stock_quantity::float as "afterStockQuantity",
      receipts.recorded_by_name as "recordedBy", receipts.created_at::text as "createdAt", receipts.request_payload as "requestPayload"
    from inventory_stock_receipts receipts join purchase_orders orders on orders.id = receipts.purchase_order_id
    join products on products.id = receipts.product_id
    join inventory_items items on items.id = receipts.inventory_item_id join inventory_locations locations on locations.id = items.location_id
    where (${storeId === undefined} or receipts.store_id::text = ${storeId ?? ""})
      and (${orderNo === undefined} or orders.order_no = ${orderNo ?? ""})
      and (${requestId === undefined} or receipts.request_id::text = ${requestId ?? ""})
    order by receipts.created_at desc, receipts.id desc limit 100
  `;
}
export async function readInventoryReceiptByRequest(requestId: string) {
  const rows = await receiptRows(undefined, undefined, requestId);
  return rows[0] ? { receipt: mapReceipt(rows[0]), requestPayload: rows[0].requestPayload as InventoryReceiptPayload } : null;
}
export async function readInventoryReceiptResponse(storeId: string, canReceive: boolean, orderNo?: string): Promise<InventoryReceiptResponse | null> {
  const stores = await sql`select id::text, name from stores where id::text = ${storeId} and status = 'active'`;
  if (!stores[0]) return null;
  const [sourcesRaw, receiptsRaw] = await Promise.all([sourceRows(storeId, orderNo), receiptRows(storeId, orderNo)]);
  const sources = sourcesRaw.map(mapSource);
  const targetsRaw = await targetRows(storeId, [...new Set(sources.map(source => source.productId))]);
  return { store: { id: storeId, name: String(stores[0].name) }, sources, inventoryItems: targetsRaw.map(mapTarget), recentReceipts: receiptsRaw.map(mapReceipt), canReceive,
    packagingTemplates:await readProductPackagingTemplates([...new Set(sources.map(source=>source.productId))],false) };
}

/** Stable source identity, deterministic shared procurement locks, then product/source/stock row locks. */
export async function recordInventoryReceipt(session: EmployeeSession, payload: InventoryReceiptPayload, source: InventoryReceiptSource) {
  const targetRaw = (await targetRows(source.storeId, undefined, payload.inventoryItemId))[0];
  if (!targetRaw) throw new InventoryReceiptError("入庫先の保管場所が見つかりません。", 404, "target_missing");
  const target = mapTarget(targetRaw);
  if (source.orderNo.startsWith("RCPT-")) throw new InventoryReceiptError("レシート補録は入庫元に指定できません。", 409, "source_not_eligible");
  const quantities = validateInventoryReceipt(payload, source, target);
  const batchPackaging=source.actualPackaging ?? payload.batchPackaging ?? null;
  const requestPayload = JSON.stringify(payload);
  const results = await sql.transaction([
    sql`select pg_advisory_xact_lock(hashtextextended(${`inventory-receipt-request:${payload.requestId}`}, 0))`,
    ...createReplenishmentOrderLocks(sql, [{ storeId: source.storeId, productIds: [source.productId] }], source.purchaseOrderId),
    sql`select id from products where id::text = ${source.productId} for share`,
    sql`select id from purchase_order_items where id::text = ${source.purchaseOrderItemId} for update`,
    sql`select id from inventory_items where id::text = ${target.id} for update`,
    sql`
      select 1 / count(*)::int from (
        select 1 where exists(select 1 from inventory_stock_receipts where request_id::text = ${payload.requestId} and request_payload = ${requestPayload}::jsonb)
        or (not exists(select 1 from inventory_stock_receipts where request_id::text = ${payload.requestId}) and exists(
          select 1 from purchase_order_items items join purchase_orders orders on orders.id = items.purchase_order_id
          join products p on p.id = items.product_id
          left join lateral (select * from purchase_actuals where purchase_order_item_id = items.id order by recorded_at desc, id desc limit 1) actuals on true
          left join delivery_batch_items links on links.purchase_order_item_id = items.id left join delivery_batches batches on batches.id = links.delivery_batch_id
          where items.id::text = ${source.purchaseOrderItemId} and orders.id::text = ${source.purchaseOrderId}
            and orders.store_id::text = ${source.storeId} and items.product_id::text = ${source.productId}
            and items.status in ('delivered', 'received') and orders.order_no not like 'RCPT-%'
            and jsonb_build_object(
              'purchaseOrderItemId', items.id::text, 'purchaseOrderId', orders.id::text, 'storeId', orders.store_id::text,
              'productId', items.product_id::text, 'status', items.status,
              'actualQuantity', coalesce(items.actual_quantity, actuals.actual_quantity),
              'actualUnit', case when actuals.actual_quantity is not null and actuals.actual_quantity is not distinct from coalesce(items.actual_quantity, actuals.actual_quantity)
                then nullif(btrim(actuals.actual_unit), '') else null end,
              'latestActualId', actuals.id::text, 'latestActualQuantity', actuals.actual_quantity,
              'latestActualUnit', nullif(btrim(actuals.actual_unit), ''), 'latestActualRecordedAt', actuals.recorded_at::text,
              'deliveryBatchId', batches.id::text, 'deliveryBatchStatus', batches.status,
              'actualPackaging',coalesce(items.actual_packaging_snapshot,actuals.packaging_snapshot)
            ) = ${JSON.stringify(payload.expectedSource)}::jsonb
            and coalesce((select sum(receipts.purchase_quantity) from inventory_stock_receipts receipts where receipts.purchase_order_item_id = items.id), 0)
              + ${payload.purchaseQuantity}::numeric <= coalesce(items.actual_quantity, actuals.actual_quantity)
            and not exists(select 1 from inventory_stock_receipts receipts where receipts.purchase_order_item_id = items.id
              and receipts.purchase_unit is distinct from ${source.actualUnit})
            and (${batchPackaging===null} or not exists(select 1 from inventory_stock_receipts receipts where receipts.purchase_order_item_id=items.id
              and receipts.batch_packaging_snapshot is distinct from ${batchPackaging===null ? null:JSON.stringify(batchPackaging)}::jsonb))
            and (${payload.mode === "unverified" || batchPackaging!==null} or (p.unit = ${source.actualUnit} and p.unit = ${targetRaw.purchaseUnit}
              and p.package_quantity is not distinct from ${targetRaw.packageQuantity}::numeric
              and p.package_quantity_unit is not distinct from ${targetRaw.packageQuantityUnit}
              and p.inventory_unit_conversions = ${JSON.stringify(targetRaw.inventoryUnitConversions ?? [])}::jsonb))
        ) and exists(
          select 1 from inventory_items stock join inventory_locations locations on locations.id = stock.location_id and locations.store_id = stock.store_id
          where stock.id::text = ${target.id} and stock.store_id::text = ${source.storeId} and stock.product_id::text = ${source.productId}
            and stock.status = 'active' and locations.status = 'active' and stock.count_unit = ${target.countUnit}
            and stock.stock_revision = ${payload.expectedStockRevision} and stock.stock_quantity is not distinct from ${target.stockQuantity}::numeric
            and stock.stock_conversion_snapshot is not distinct from ${target.stockConversionSnapshot === null ? null : JSON.stringify(target.stockConversionSnapshot)}::jsonb
            and stock.current_quantity is not distinct from ${target.currentQuantity}::numeric
            and stock.count_conversion_snapshot is not distinct from ${target.countConversionSnapshot === null ? null : JSON.stringify(target.countConversionSnapshot)}::jsonb
            and stock.last_counted_at::text is not distinct from ${target.lastCountedAt}
        ))
      ) valid
    `,
    sql`update purchase_order_items set actual_packaging_snapshot=${batchPackaging===null ? null:JSON.stringify(batchPackaging)}::jsonb
      where id::text=${source.purchaseOrderItemId} and ${batchPackaging!==null}
        and not exists(select 1 from inventory_stock_receipts where request_id::text=${payload.requestId})`,
    sql`
      update inventory_items set
        stock_quantity = case when ${payload.mode === "unverified"} then null when ${payload.mode === "add"} then ${quantities.afterStockQuantity}::numeric else stock_quantity end,
        stock_conversion_snapshot = case when ${payload.mode === "unverified"} then null when ${payload.mode === "add" && batchPackaging===null} then ${JSON.stringify(target.currentConversion)}::jsonb else stock_conversion_snapshot end,
        stock_revision = stock_revision + 1, last_received_at = now(), updated_at = now(),
        exception_code = case when ${payload.mode === "add"} and exception_code in ('', 'low', 'out') then
          case when ${quantities.afterStockQuantity}::numeric <= 0 then 'out'
            when ${quantities.afterStockQuantity}::numeric <= safety_stock then 'low' else '' end else exception_code end,
        exception_note = case when ${payload.mode === "add"} and exception_code in ('', 'low', 'out') then '' else exception_note end
      where id::text = ${target.id} and not exists(select 1 from inventory_stock_receipts where request_id::text = ${payload.requestId})
    `,
    sql`
      insert into inventory_stock_receipts(request_id,purchase_order_item_id,purchase_order_id,store_id,product_id,inventory_item_id,
        purchase_quantity,purchase_unit,count_quantity,count_unit,mode,before_stock_quantity,after_stock_quantity,
        conversion_snapshot,source_snapshot,request_payload,recorded_by,recorded_by_name,batch_packaging_snapshot)
      select ${payload.requestId}::uuid,${source.purchaseOrderItemId}::uuid,${source.purchaseOrderId}::uuid,${source.storeId}::uuid,
        ${source.productId}::uuid,${target.id}::uuid,${payload.purchaseQuantity},${source.actualUnit},${quantities.countQuantity},${target.countUnit},${payload.mode},
        ${target.stockQuantity},${quantities.afterStockQuantity},${quantities.conversionSnapshot === null ? null : JSON.stringify(quantities.conversionSnapshot)}::jsonb,
        ${JSON.stringify(source.expectedSource)}::jsonb,${requestPayload}::jsonb,${session.id}::uuid,${session.name ?? ""},${batchPackaging===null ? null:JSON.stringify(batchPackaging)}::jsonb
      where not exists(select 1 from inventory_stock_receipts where request_id::text = ${payload.requestId})
      returning id::text
    `,
    sql`insert into inventory_movements(operation_key,store_id,product_id,inventory_item_id,kind,quantity,count_unit,confidence,
      occurred_at,before_quantity,after_quantity,changes_stock,metadata)
      select 'receipt:'||receipts.id::text,receipts.store_id,receipts.product_id,receipts.inventory_item_id,'receipt',
        case when receipts.mode='included' then 0 else receipts.count_quantity end,receipts.count_unit,
        case when receipts.mode='unverified' then 'unmeasured' else 'exact' end,receipts.created_at,
        receipts.before_stock_quantity,receipts.after_stock_quantity,receipts.mode='add',
        jsonb_build_object('receiptId',receipts.id::text,'requestId',receipts.request_id::text,'mode',receipts.mode,
          'balanceUnknown',receipts.mode='unverified','quantityUnknown',receipts.mode='unverified','batchPackaging',receipts.batch_packaging_snapshot,'conversion',receipts.conversion_snapshot)
      from inventory_stock_receipts receipts where receipts.request_id::text=${payload.requestId}
      on conflict(operation_key) do nothing`
  ]);
  const recorded = await readInventoryReceiptByRequest(payload.requestId);
  if (!recorded) throw new InventoryReceiptError("入庫を保存できませんでした。", 500, "receipt_missing");
  return { receipt: recorded.receipt, replayed: !results[results.length - 2]?.[0]?.id };
}
