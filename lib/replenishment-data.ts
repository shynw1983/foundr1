import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { normalizeCatalogVisibility } from "./product-catalog-policy";
import { openReplenishmentOrderStatuses } from "./replenishment-order-intent";
import { createInventoryQuickCheckBasis, readInventoryQuickCheck } from "./inventory-quick-policy";
import { convertCountToPurchaseQuantity, resolveProductUnitConversion, unitConversionSnapshotsEqual, type ProductUnitConversionSnapshot } from "./product-unit-conversions";
import {
  deriveReplenishmentSnapshot,
  nullableReplenishmentNumber,
  type ReplenishmentInventoryRow,
  type ReplenishmentMenuRow,
  type ReplenishmentOrderRow,
  type ReplenishmentProductRow
} from "./replenishment-policy";

/** All queries are confined to the already-authorized store; no cache or writes. */
export async function readReplenishmentSnapshot(session: EmployeeSession, storeId: string, canCreateOrder: boolean, canManageMenuLinks = false) {
  const storeRows = await sql`
    select stores.id::text as id, stores.name,
      coalesce(array_agg(store_brands.brand_id::text) filter (where store_brands.brand_id is not null), '{}'::text[]) as "brandIds"
    from stores left join store_brands on store_brands.store_id = stores.id
    where stores.id::text = ${storeId} and stores.status = 'active'
    group by stores.id
  `;
  if (!storeRows[0]) return null;
  const store = { id: String(storeRows[0].id), name: String(storeRows[0].name), brandIds: (storeRows[0].brandIds as string[]) ?? [] };
  const [menuRows, inventoryRows] = await Promise.all([
    sql`
      with menu_signals as (
        select 'item'::text as kind, items.id, items.brand_id, items.name, items.display_names,
          case when settings.is_available = false then 'unavailable' else settings.stock_status end as stock_status,
          coalesce(settings.status_note, '') as note
        from menu_store_settings settings
        join menu_catalog_items items on items.id = settings.menu_catalog_item_id
        join store_brands on store_brands.brand_id = items.brand_id and store_brands.store_id::text = ${storeId}
        where settings.store_id::text = ${storeId} and items.is_active = true
          and items.store_id is null
          and (settings.stock_status in ('low_stock', 'unavailable') or settings.is_available = false)
        union all
        select 'option'::text, options.id, groups.brand_id, options.name, options.display_names,
          case when settings.is_available = false then 'unavailable' else settings.stock_status end,
          coalesce(settings.status_note, '')
        from menu_option_store_settings settings
        join menu_options options on options.id = settings.menu_option_id
        join menu_option_groups groups on groups.id = options.option_group_id
        left join menu_catalog_items parents on parents.id = groups.menu_catalog_item_id
        join store_brands on store_brands.brand_id = groups.brand_id and store_brands.store_id::text = ${storeId}
        where settings.store_id::text = ${storeId} and options.is_active = true and groups.is_active = true
          and (groups.menu_catalog_item_id is null or (parents.is_active = true and parents.store_id is null))
          and (settings.stock_status in ('low_stock', 'unavailable') or settings.is_available = false)
      )
      select signals.kind, signals.id::text, signals.brand_id::text as "brandId", signals.name, signals.display_names as "displayNames",
        signals.stock_status as "stockStatus", signals.note,
        coalesce((select array_agg(distinct links.product_id::text) from menu_product_links links
          where (signals.kind = 'item' and links.menu_catalog_item_id = signals.id)
            or (signals.kind = 'option' and links.menu_option_id = signals.id)), '{}'::text[]) as "productIds",
        coalesce((select array_agg(blocks.inventory_key) from menu_inventory_availability_blocks blocks
          where blocks.store_id::text = ${storeId} and blocks.target_kind = signals.kind and blocks.target_id = signals.id), '{}'::text[]) as "availabilityBlockKeys"
      from menu_signals signals order by signals.kind, signals.name, signals.id
    `,
    sql`
      select items.id::text, items.store_id::text as "storeId", items.product_id::text as "productId", items.location_id::text as "locationId", locations.name as "locationName",
        items.count_unit as "countUnit", items.stock_quantity::float as quantity,
        items.current_quantity::float as "lastCountedQuantity", items.stock_revision as "stockRevision", items.last_received_at::text as "lastReceivedAt",
        items.safety_stock::float as "safetyStock", items.exception_code as "exceptionCode",
        items.quick_status as "quickStatus", items.quick_checked_at::text as "quickCheckedAt",
        items.quick_checked_by_name as "quickCheckedBy", items.quick_estimate as "quickEstimate", items.quick_basis as "quickBasis",
        items.quick_revision as "quickRevision", items.quick_superseded_at::text as "quickSupersededAt",
        coalesce(items.exception_note, '') as note, items.last_counted_at::text as "lastCountedAt",
        items.count_conversion_snapshot as "countConversionSnapshot", items.stock_conversion_snapshot as "stockConversionSnapshot", products.unit as "purchaseUnit",
        products.package_quantity::float as "packageQuantity", coalesce(products.package_quantity_unit, '') as "packageQuantityUnit",
        products.package_quantity_unit as "rawPackageQuantityUnit",
        products.inventory_unit_conversions as "inventoryUnitConversions"
      from inventory_items items join inventory_locations locations on locations.id = items.location_id and locations.store_id = items.store_id
      join products on products.id = items.product_id
      where items.store_id::text = ${storeId} and items.status = 'active' and locations.status = 'active'
        and (items.exception_code in ('low', 'out') or items.stock_quantity <= items.safety_stock
          or (items.quick_status in ('low', 'out') and items.quick_superseded_at is null))
      order by locations.name, items.id
    `
  ]);
  const menu: ReplenishmentMenuRow[] = menuRows.map((row) => ({
    kind: row.kind === "item" ? "item" : "option", id: String(row.id), brandId: String(row.brandId),
    name: String(row.name), displayNames: row.displayNames && typeof row.displayNames === "object" && !Array.isArray(row.displayNames)
      ? row.displayNames as Record<string, string> : undefined,
    stockStatus: String(row.stockStatus), note: String(row.note ?? ""),
    productIds: Array.isArray(row.productIds) ? row.productIds.map(String) : [],
    availabilityBlockKeys: Array.isArray(row.availabilityBlockKeys) ? row.availabilityBlockKeys.map(String) : []
  }));
  const inventory: ReplenishmentInventoryRow[] = inventoryRows.map((row) => ({
    id: String(row.id), productId: String(row.productId), locationName: String(row.locationName), countUnit: String(row.countUnit ?? ""),
    quantity: nullableReplenishmentNumber(row.quantity), safetyStock: nullableReplenishmentNumber(row.safetyStock),
    exceptionCode: String(row.exceptionCode ?? ""), note: String(row.note ?? ""), lastCountedAt: row.lastCountedAt ? String(row.lastCountedAt) : null,
    quickCheck: readInventoryQuickCheck(row, createInventoryQuickCheckBasis(row))
  }));
  const productIds = Array.from(new Set([...menu.flatMap((row) => row.productIds), ...inventory.map((row) => row.productId)]));
  const [productRows, orderRows] = productIds.length ? await Promise.all([sql`
    select products.id::text, products.name, products.unit, coalesce(products.brand_scope, 'unset') as "brandScope",
      products.catalog_visibility as "catalogVisibility", products.is_orderable as "isOrderable",
      coalesce((select json_agg(json_build_object('brandId', usages.brand_id::text, 'isOrderable', usages.is_orderable))
        from product_brand_usages usages where usages.product_id = products.id), '[]'::json) as "brandUsages",
      coalesce((select array_agg(grants.store_id::text) from product_catalog_store_grants grants where grants.product_id = products.id), '{}'::text[]) as "catalogStoreIds"
    from products where products.id::text = any(${productIds})
  `, sql`
    select orders.id::text, orders.order_no as "orderNo", items.id::text as "itemId", items.product_id::text as "productId",
      items.status, items.requested_quantity::float as "requestedQuantity", items.actual_quantity::float as "actualQuantity",
      items.requested_unit as unit,
      (select case when actuals.actual_quantity = items.actual_quantity then nullif(actuals.actual_unit, '') else null end
        from purchase_actuals actuals where actuals.purchase_order_item_id = items.id
        order by actuals.recorded_at desc, actuals.id desc limit 1) as "actualUnit"
    from purchase_order_items items join purchase_orders orders on orders.id = items.purchase_order_id
    where orders.store_id::text = ${storeId} and items.product_id::text = any(${productIds})
      and items.status = any(${[...openReplenishmentOrderStatuses]}::text[])
    order by orders.created_at desc, items.id
  `]) : [[], []];
  const products: ReplenishmentProductRow[] = productRows.map((row) => ({
    id: String(row.id), name: String(row.name), unit: String(row.unit ?? ""), brandScope: String(row.brandScope),
    catalogVisibility: normalizeCatalogVisibility(row.catalogVisibility), isOrderable: row.isOrderable === true,
    brandUsages: Array.isArray(row.brandUsages) ? row.brandUsages : [],
    catalogStoreIds: Array.isArray(row.catalogStoreIds) ? row.catalogStoreIds.map(String) : []
  }));
  const orders: ReplenishmentOrderRow[] = orderRows.map((row) => ({
    id: String(row.id), orderNo: String(row.orderNo), itemId: String(row.itemId), productId: String(row.productId),
    status: String(row.status), requestedQuantity: nullableReplenishmentNumber(row.requestedQuantity),
    actualQuantity: nullableReplenishmentNumber(row.actualQuantity), unit: String(row.unit ?? ""), actualUnit: row.actualUnit ? String(row.actualUnit) : null
  }));
  const snapshot = deriveReplenishmentSnapshot({ store, role: session.role, canCreateOrder, canManageMenuLinks, products, menu, inventory, orders });
  const inventoryConversions = new Map(inventoryRows.map((row) => {
    const currentConversion = resolveProductUnitConversion({
      unit: String(row.purchaseUnit ?? ""), packageQuantity: row.packageQuantity as number | null,
      packageQuantityUnit: String(row.packageQuantityUnit ?? ""), inventoryUnitConversions: row.inventoryUnitConversions
    }, String(row.countUnit ?? ""));
    const countConversionSnapshot = row.countConversionSnapshot as ProductUnitConversionSnapshot | null;
    const stockConversionSnapshot = row.stockConversionSnapshot as ProductUnitConversionSnapshot | null;
    const amount = convertCountToPurchaseQuantity(typeof row.quantity === "number" ? row.quantity : NaN, stockConversionSnapshot);
    return [String(row.id), {
      currentConversion, countConversionSnapshot, stockConversionSnapshot,
      lastCountedQuantity: nullableReplenishmentNumber(row.lastCountedQuantity), stockRevision: Number(row.stockRevision), lastReceivedAt: row.lastReceivedAt ? String(row.lastReceivedAt) : null,
      conversionChanged: Boolean(stockConversionSnapshot && !unitConversionSnapshotsEqual(stockConversionSnapshot, currentConversion)),
      purchaseEquivalent: amount === null || !stockConversionSnapshot ? null : { quantity: amount, unit: stockConversionSnapshot.purchaseUnit }
    }] as const;
  }));
  for (const risk of snapshot.risks) for (const source of risk.sources) {
    if (source.kind === "inventory") Object.assign(source, inventoryConversions.get(source.id));
  }
  const visibleRiskIds = snapshot.risks.map(risk => risk.product.id);
  if (visibleRiskIds.length) {
    const pendingRows = await sql`
      with sources as (
        select items.id, items.product_id, orders.order_no,
          coalesce(items.actual_quantity, latest.actual_quantity) as actual_quantity, products.unit as purchase_unit,
          case when latest.actual_quantity is not null and latest.actual_quantity is not distinct from coalesce(items.actual_quantity, latest.actual_quantity)
            then nullif(btrim(latest.actual_unit), '') else null end as actual_unit
        from purchase_order_items items join purchase_orders orders on orders.id = items.purchase_order_id
        join products on products.id = items.product_id
        left join lateral (
          select actuals.actual_quantity, actuals.actual_unit from purchase_actuals actuals
          where actuals.purchase_order_item_id = items.id order by actuals.recorded_at desc, actuals.id desc limit 1
        ) latest on true
        where orders.store_id::text = ${storeId} and items.product_id::text = any(${visibleRiskIds})
          and items.status in ('delivered', 'received') and orders.order_no not like 'RCPT-%'
      ), pending as (
        select sources.*, coalesce((
          select sum(receipts.purchase_quantity) from inventory_stock_receipts receipts
          where receipts.store_id::text = ${storeId} and receipts.purchase_order_item_id = sources.id
        ), 0) as received_purchase_quantity
        from sources
      )
      select id::text as "itemId", product_id::text as "productId", order_no as "orderNo",
        actual_quantity::float as "actualQuantity", actual_unit as "actualUnit", purchase_unit as "purchaseUnit",
        received_purchase_quantity::float as "receivedPurchaseQuantity"
      from pending where actual_quantity is null or actual_unit is null or actual_unit <> purchase_unit
        or received_purchase_quantity < actual_quantity
      order by order_no, id
    `;
    for (const row of pendingRows) {
      const risk = snapshot.risks.find(candidate => candidate.product.id === String(row.productId));
      if (!risk) continue;
      const actualQuantity = nullableReplenishmentNumber(row.actualQuantity);
      const receivedPurchaseQuantity = nullableReplenishmentNumber(row.receivedPurchaseQuantity) ?? 0;
      const actualUnit = row.actualUnit ? String(row.actualUnit) : null;
      risk.pendingReceipts.push({
        itemId: String(row.itemId), orderNo: String(row.orderNo), actualQuantity, actualUnit, receivedPurchaseQuantity,
        remainingPurchaseQuantity: actualQuantity === null || !actualUnit || actualUnit !== String(row.purchaseUnit)
          ? null : Math.max(0, Number((actualQuantity - receivedPurchaseQuantity).toFixed(6)))
      });
    }
  }
  return snapshot;
}
