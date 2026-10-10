import { normalizeInventoryCountInput } from "../../../lib/inventory-count-input-policy";
import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { roleHasPermission } from "../../../lib/role-permissions";
import { assertProductViewableAtStore, getVisibleProductIdsForStore } from "../../../lib/product-catalog-access";
import {
  canQuickCheckInventoryRole,
  createInventoryQuickCheckBasis,
  effectiveQuickInventoryStockStatus,
  normalizeInventoryQuickCheckEstimate,
  readInventoryQuickCheck,
  validInventoryQuickCheckBasis,
  type InventoryQuickCheckSubmission
} from "../../../lib/inventory-quick-policy";
import {
  convertCountToPurchaseQuantity,
  listProductUnitConversions,
  parseInventoryCountQuantity,
  resolveProductUnitConversion,
  unitConversionSnapshotsEqual,
  type ProductUnitConversionSnapshot
} from "../../../lib/product-unit-conversions";

const exceptionCodes = new Set(["", "low", "out", "too_much", "damaged", "quality"]);

async function requireInventorySession() {
  const session = await requireOsSession();
  if (!session || !(await roleHasPermission(session.role, "module.inventory"))) return null;
  return session;
}

export async function GET(request: Request) {
  const session = await requireInventorySession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const canQuickCheck = canQuickCheckInventoryRole(session.role);

  const requestedStoreId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  if (requestedStoreId && !(await canAccessStore(session, requestedStoreId))) {
    return Response.json({ error: "この店舗の在庫を確認する権限がありません。" }, { status: 403 });
  }

  const scope = await getSessionStoreScope(session);

  const stores = await sql`
    select stores.id::text as id, stores.name
    from stores
    where stores.status = 'active'
      and (
        ${scope.allStores}
        or stores.id::text = any(${scope.storeIds})
      )
    order by stores.name
  `;

  const storeId = requestedStoreId || String(stores[0]?.id ?? "");
  if (!storeId) {
    return Response.json({ stores: [], locations: [], items: [], products: [], recentChecks: [], canQuickCheck });
  }

  const [locations, items, products, recentChecks] = await Promise.all([
    sql`
      select
        id::text as id,
        name,
        coalesce(equipment_brand, '') as "equipmentBrand",
        coalesce(nullif(equipment_name, ''), name) as "equipmentName",
        coalesce(position_name, '') as "positionName",
        location_type as "locationType"
      from inventory_locations
      where store_id = ${storeId}::uuid and status = 'active'
      order by sort_order, name
    `,
    sql`
      select
        inventory_items.id::text as id,
        inventory_items.store_id::text as "storeId",
        inventory_items.product_id::text as "productId",
        products.name as "productName",
        products.category,
        inventory_items.location_id::text as "locationId",
        inventory_locations.name as "locationName",
        inventory_items.count_unit as "countUnit",
        inventory_items.count_conversion_snapshot as "countConversionSnapshot",
        products.unit as "purchaseUnit",
        products.package_quantity::float as "packageQuantity",
        coalesce(products.package_quantity_unit, '') as "packageQuantityUnit",
        products.package_quantity_unit as "rawPackageQuantityUnit",
        products.inventory_unit_conversions as "inventoryUnitConversions",
        inventory_items.safety_stock::float as "safetyStock",
        inventory_items.stock_quantity::float as "currentQuantity",
        inventory_items.current_quantity::float as "lastCountedQuantity",
        inventory_items.stock_conversion_snapshot as "stockConversionSnapshot",
        inventory_items.stock_revision as "stockRevision",
        inventory_items.last_received_at::text as "lastReceivedAt",
        inventory_items.quick_status as "quickStatus",
        inventory_items.quick_checked_at::text as "quickCheckedAt",
        inventory_items.quick_checked_by_name as "quickCheckedBy",
        inventory_items.quick_estimate as "quickEstimate",
        inventory_items.quick_basis as "quickBasis",
        inventory_items.quick_revision as "quickRevision",
        inventory_items.quick_superseded_at::text as "quickSupersededAt",
        inventory_items.exception_code as "exceptionCode",
        inventory_items.exception_note as "exceptionNote",
        inventory_items.last_counted_at as "lastCountedAt",
        coalesce(employees.name, '') as "lastCountedBy",
        case
          when inventory_items.current_quantity is null or inventory_items.last_counted_at is null then '未確認'
          when inventory_items.stock_revision = 0 or inventory_items.last_counted_at < now() - interval '7 days' then '要確認'
          when inventory_items.last_counted_at < now() - interval '3 days' then '確認推奨'
          else '確認済み'
        end as "confidenceLabel",
        case
          when inventory_items.last_counted_at is null then ''
          else to_char(inventory_items.last_counted_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI')
        end as "lastCountedLabel"
      from inventory_items
      join products on products.id = inventory_items.product_id
      join inventory_locations on inventory_locations.id = inventory_items.location_id
      left join employees on employees.id = inventory_items.last_counted_by
      where inventory_items.store_id = ${storeId}::uuid
        and inventory_items.status = 'active'
        and inventory_locations.status = 'active'
      order by inventory_locations.sort_order, inventory_locations.name, products.category, products.name
    `,
    sql`
      select
        products.id::text as id,
        products.name,
        products.category,
        products.unit,
        products.package_quantity::float as "packageQuantity",
        coalesce(products.package_quantity_unit, '') as "packageQuantityUnit",
        products.inventory_unit_conversions as "inventoryUnitConversions",
        coalesce(products.storage_type, '') as "storageType"
      from products
      order by products.category, products.name
    `,
    sql`
      select
        inventory_checks.id::text as id,
        products.name as "productName",
        inventory_locations.name as "locationName",
        inventory_checks.quantity::float as quantity,
        inventory_checks.count_unit as "countUnit",
        inventory_checks.unit_conversion_snapshot as "unitConversionSnapshot",
        inventory_checks.record_type as "recordType",
        inventory_checks.quick_check_snapshot as "quickCheckSnapshot",
        inventory_checks.reconciliation_snapshot as reconciliation,
        inventory_checks.quick_check_snapshot->>'status' as "quickStatus",
        inventory_checks.quick_check_snapshot->'estimate' as "quickEstimate",
        inventory_checks.exception_code as "exceptionCode",
        inventory_checks.note,
        coalesce(employees.name, '') as "recordedBy",
        to_char(inventory_checks.created_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "createdLabel"
      from inventory_checks
      join inventory_items on inventory_items.id = inventory_checks.inventory_item_id
      join products on products.id = inventory_checks.product_id
      join inventory_locations on inventory_locations.id = inventory_items.location_id
      left join employees on employees.id = inventory_checks.recorded_by
      where inventory_checks.store_id = ${storeId}::uuid
      order by inventory_checks.created_at desc
      limit 20
    `
  ]);
  const visibleProductIds = new Set(await getVisibleProductIdsForStore(session, storeId));
  return Response.json({
    stores, selectedStoreId: storeId, locations, canQuickCheck,
    items: items.map((item) => {
      const product = inventoryProductConfiguration(item);
      const currentConversion = resolveProductUnitConversion(product, String(item.countUnit));
      const countConversionSnapshot = item.countConversionSnapshot as ProductUnitConversionSnapshot | null;
      const stockConversionSnapshot = item.stockConversionSnapshot as ProductUnitConversionSnapshot | null;
      const quickCheckBasis = createInventoryQuickCheckBasis(item);
      const quickCheck = readInventoryQuickCheck(item, quickCheckBasis);
      const { purchaseUnit, packageQuantity, packageQuantityUnit, rawPackageQuantityUnit, inventoryUnitConversions,
        quickStatus, quickCheckedAt, quickCheckedBy, quickEstimate, quickBasis, quickSupersededAt, ...facts } = item;
      return {
        ...facts, currentConversion, countConversionSnapshot, stockConversionSnapshot,
        quickCheckBasis, quickCheck, canQuickCheck,
        effectiveStockStatus: effectiveQuickInventoryStockStatus({
          quantity: item.currentQuantity as number | null, safetyStock: item.safetyStock as number | null,
          exceptionCode: String(item.exceptionCode ?? ""), lastCountedAt: item.lastCountedAt ? String(item.lastCountedAt) : null,
          countUnit: String(item.countUnit ?? ""), quickCheck
        }),
        conversionChanged: Boolean(stockConversionSnapshot && !unitConversionSnapshotsEqual(stockConversionSnapshot, currentConversion)),
        purchaseEquivalent: inventoryPurchaseEquivalent(item.currentQuantity, stockConversionSnapshot),
        unitChoices: listProductUnitConversions(product)
      };
    }),
    products: products.filter((product) => visibleProductIds.has(String(product.id))).map((product) => ({
      ...product, inventoryUnitChoices: listProductUnitConversions(inventoryProductConfiguration(product))
    })),
    recentChecks: recentChecks.map((check) => ({
      ...check,
      purchaseEquivalent: inventoryPurchaseEquivalent(check.quantity, check.unitConversionSnapshot as ProductUnitConversionSnapshot | null)
    }))
  });
}

export async function POST(request: Request) {
  const session = await requireInventorySession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    storeId?: string;
    itemId?: string;
    productId?: string;
    locationId?: string;
    equipmentBrand?: string;
    equipmentName?: string;
    positionName?: string;
    locationType?: string;
    countUnit?: string;
    safetyStock?: number | string;
    quantity?: number | string;
    inputUnit?: string;
    expectedConversion?: ProductUnitConversionSnapshot | null;
    expectedStockRevision?: number;
    exceptionCode?: string;
    lowItemIds?: string[];
    clearLowItemIds?: string[];
    checks?: InventoryQuickCheckSubmission[];
    note?: string;
  };
  const action = String(body.action ?? "");
  const storeId = String(body.storeId ?? "").trim();

  if (!storeId || !(await canAccessStore(session, storeId))) {
    return Response.json({ error: "この店舗を操作する権限がありません。" }, { status: 403 });
  }

  if (action === "batch_quick_check") {
    if (!canQuickCheckInventoryRole(session.role)) return Response.json({ error: "権限がありません。" }, { status: 403 });
    const rawChecks = body.checks;
    if (!Array.isArray(rawChecks) || rawChecks.length < 1 || rawChecks.length > 500) {
      return Response.json({ error: "確認する商品を1〜500件選択してください。" }, { status: 400 });
    }
    const checks: InventoryQuickCheckSubmission[] = [];
    const seen = new Set<string>();
    for (const check of rawChecks) {
      const itemId = String(check?.itemId ?? "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId)
        || seen.has(itemId) || !["enough", "low", "out"].includes(check?.status)
        || !validInventoryQuickCheckBasis(check?.expectedBasis)) {
        return Response.json({ error: "商品・確認状態・更新情報を再確認してください。" }, { status: 400 });
      }
      const estimate = normalizeInventoryQuickCheckEstimate(check.estimate, check.expectedBasis.unitConfiguration.unit);
      if (estimate === false) return Response.json({ error: "概算数量と購入単位を再確認してください。" }, { status: 400 });
      checks.push({ itemId, status: check.status, expectedBasis: check.expectedBasis, estimate });
      seen.add(itemId);
    }
    // Lock the product before the inventory row, consistently with physical
    // counts and receipts. Every explicit row must match before any row writes.
    const recorded = await sql`
      with requested as materialized (
        select * from jsonb_to_recordset(${JSON.stringify(checks)}::jsonb)
          as checks("itemId" text, status text, "expectedBasis" jsonb, estimate jsonb)
      ), locked_products as materialized (
        select products.id, products.unit, products.package_quantity, products.package_quantity_unit, products.inventory_unit_conversions
        from products
        where products.id in (
          select items.product_id from inventory_items items join requested on items.id::text = requested."itemId"
          where items.store_id = ${storeId}::uuid and items.status = 'active'
        )
        order by products.id for share of products
      ), locked_items as materialized (
        select items.*, requested.status as requested_status, requested.estimate, requested."expectedBasis",
          jsonb_build_object(
            'storeId', items.store_id::text, 'productId', items.product_id::text, 'locationId', items.location_id::text,
            'stockRevision', items.stock_revision, 'quickRevision', items.quick_revision,
            'countUnit', items.count_unit, 'safetyStock', items.safety_stock,
            'unitConfiguration', jsonb_build_object('unit', locked_products.unit, 'packageQuantity', locked_products.package_quantity,
              'packageQuantityUnit', locked_products.package_quantity_unit, 'inventoryUnitConversions', coalesce(locked_products.inventory_unit_conversions, '[]'::jsonb))
          ) as current_basis
        from locked_products join inventory_items items on items.product_id = locked_products.id
        join requested on items.id::text = requested."itemId"
        join inventory_locations locations on locations.id = items.location_id and locations.store_id = items.store_id
        join stores on stores.id = items.store_id
        where items.store_id = ${storeId}::uuid and items.status = 'active' and locations.status = 'active' and stores.status = 'active'
        order by items.id for update of items
      ), eligible as materialized (
        select * from locked_items
        where current_basis = "expectedBasis"
      ), observed as (
        update inventory_items items
        set quick_status = eligible.requested_status,
          quick_checked_at = clock_timestamp(), quick_checked_by = ${session.id}::uuid, quick_checked_by_name = ${session.name ?? ""},
          quick_estimate = eligible.estimate,
          quick_basis = jsonb_set(eligible.current_basis, '{quickRevision}', to_jsonb(items.quick_revision + 1)),
          quick_revision = items.quick_revision + 1, quick_superseded_at = null,
          exception_code = case when eligible.requested_status = 'enough' and items.exception_code in ('low', 'out') then '' else items.exception_code end,
          updated_at = now()
        from eligible
        where items.id = eligible.id and (select count(*) from eligible) = ${checks.length}::integer
        returning items.id, items.store_id, items.product_id, items.count_unit,
          jsonb_build_object('status', items.quick_status, 'checkedAt', items.quick_checked_at, 'checkedBy', items.quick_checked_by_name,
            'basis', items.quick_basis, 'estimate', items.quick_estimate) as snapshot
      )
      insert into inventory_checks (inventory_item_id, store_id, product_id, quantity, count_unit, record_type,
        exception_code, note, recorded_by, unit_conversion_snapshot, quick_check_snapshot)
      select id, store_id, product_id, null, count_unit, 'quick_check', '', '', ${session.id}::uuid, null, snapshot
      from observed returning inventory_item_id::text as "itemId"
    `;
    if (recorded.length !== checks.length) return Response.json({
      error: "在庫・確認状態・単位設定が更新されています。画面を更新して確認し直してください。", code: "quick_check_basis_changed"
    }, { status: 409 });
    return Response.json({ ok: true, updatedCount: recorded.length });
  }

  if (action === "save_location") {
    const locationId = String(body.locationId ?? "").trim();
    const equipmentBrand = String(body.equipmentBrand ?? "").trim();
    const equipmentName = String(body.equipmentName ?? "").trim();
    const positionName = String(body.positionName ?? "").trim();
    const locationType = normalizeLocationType(body.locationType);
    const equipmentLabel = [equipmentBrand, equipmentName].filter(Boolean).join(" ");
    const name = `${equipmentLabel} / ${positionName}`;

    if (!equipmentName || !positionName) {
      return Response.json({ error: "設備・収納名と区画・位置を入力してください。" }, { status: 400 });
    }

    const duplicateRows = await sql`
      select id
      from inventory_locations
      where store_id = ${storeId}::uuid
        and name = ${name}
        and ${locationId} <> ''
        and id::text <> ${locationId}
      limit 1
    `;
    if (duplicateRows[0]) {
      return Response.json({ error: "同じ保管場所がすでに登録されています。" }, { status: 409 });
    }

    if (locationId) {
      const rows = await sql`
        update inventory_locations
        set
          name = ${name},
          equipment_brand = ${equipmentBrand},
          equipment_name = ${equipmentName},
          position_name = ${positionName},
          location_type = ${locationType},
          status = 'active',
          updated_at = now()
        where id = ${locationId}::uuid and store_id = ${storeId}::uuid
        returning id::text as id
      `;
      if (!rows[0]) return Response.json({ error: "保管場所が見つかりません。" }, { status: 404 });
    } else {
      await sql`
        insert into inventory_locations (
          store_id, name, equipment_brand, equipment_name, position_name, location_type, updated_at
        ) values (
          ${storeId}::uuid, ${name}, ${equipmentBrand}, ${equipmentName}, ${positionName}, ${locationType}, now()
        )
        on conflict (store_id, name)
        do update set
          equipment_brand = excluded.equipment_brand,
          equipment_name = excluded.equipment_name,
          position_name = excluded.position_name,
          location_type = excluded.location_type,
          status = 'active',
          updated_at = now()
      `;
    }
    return Response.json({ ok: true });
  }

  if (action === "archive_location") {
    const locationId = String(body.locationId ?? "").trim();
    if (!locationId) return Response.json({ error: "保管場所が見つかりません。" }, { status: 404 });

    const rows = await sql`
      update inventory_locations
      set status = 'inactive', updated_at = now()
      where id = ${locationId}::uuid
        and store_id = ${storeId}::uuid
        and not exists (
          select 1
          from inventory_items
          where inventory_items.location_id = inventory_locations.id
            and inventory_items.status = 'active'
        )
      returning id::text as id
    `;
    if (!rows[0]) {
      return Response.json({ error: "使用中の商品がある保管場所は停止できません。" }, { status: 409 });
    }
    return Response.json({ ok: true });
  }

  if (action === "configure") {
    const productId = String(body.productId ?? "").trim();
    const locationId = String(body.locationId ?? "").trim();
    const safetyStock = normalizeNonNegativeNumber(body.safetyStock, 1);

    if (!productId) return Response.json({ error: "商品を選択してください。" }, { status: 400 });
    if (!locationId) return Response.json({ error: "保存済みの保管場所を選択してください。" }, { status: 400 });
    const access = await assertProductViewableAtStore(session, storeId, productId);
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status });

    const [productRows, locationRows] = await Promise.all([
      sql`select id, unit, package_quantity::float as "packageQuantity", coalesce(package_quantity_unit, '') as "packageQuantityUnit",
        inventory_unit_conversions as "inventoryUnitConversions" from products where id = ${productId}::uuid limit 1`,
      sql`
        select id
        from inventory_locations
        where id = ${locationId}::uuid and store_id = ${storeId}::uuid and status = 'active'
        limit 1
      `
    ]);
    if (!productRows[0] || !locationRows[0]) {
      return Response.json({ error: "商品または保管場所を確認できませんでした。" }, { status: 400 });
    }

    const countUnit = String(body.countUnit ?? "").trim() || String(productRows[0].unit ?? "袋");
    await sql`
      with locked_product as materialized (
        select id from products where id = ${productId}::uuid for share
      )
      insert into inventory_items (
        store_id, product_id, location_id, count_unit, safety_stock, updated_at
      ) select
        ${storeId}::uuid, locked_product.id, ${locationId}::uuid,
        ${countUnit}, ${safetyStock}, now()
      from locked_product
      on conflict (store_id, product_id, location_id)
      do update set
        current_quantity = case
          when inventory_items.count_unit = excluded.count_unit then inventory_items.current_quantity
          else null
        end,
        last_counted_at = case
          when inventory_items.count_unit = excluded.count_unit then inventory_items.last_counted_at
          else null
        end,
        last_counted_by = case
          when inventory_items.count_unit = excluded.count_unit then inventory_items.last_counted_by
          else null
        end,
        usage_anchor_check_id = case when inventory_items.count_unit = excluded.count_unit then inventory_items.usage_anchor_check_id else null end,
        count_conversion_snapshot = case
          when inventory_items.count_unit = excluded.count_unit then inventory_items.count_conversion_snapshot
          else null
        end,
        stock_quantity = case
          when inventory_items.count_unit = excluded.count_unit then inventory_items.stock_quantity
          else null
        end,
        stock_conversion_snapshot = case
          when inventory_items.count_unit = excluded.count_unit then inventory_items.stock_conversion_snapshot
          else null
        end,
        stock_revision = inventory_items.stock_revision + case when inventory_items.count_unit = excluded.count_unit then 0 else 1 end,
        count_unit = excluded.count_unit,
        safety_stock = excluded.safety_stock,
        status = 'active',
        updated_at = now()
    `;
    return Response.json({ ok: true });
  }

  if (action === "batch_low_stock") {
    const lowItemIds = Array.from(new Set(
      (Array.isArray(body.lowItemIds) ? body.lowItemIds : [])
        .map((value) => String(value).trim())
        .filter(Boolean)
    ));
    const clearLowItemIds = Array.from(new Set(
      (Array.isArray(body.clearLowItemIds) ? body.clearLowItemIds : [])
        .map((value) => String(value).trim())
        .filter(Boolean)
    ));
    const requestedItemIds = Array.from(new Set([...lowItemIds, ...clearLowItemIds]));
    if (requestedItemIds.length > 500) {
      return Response.json({ error: "一度に更新できる商品は500件までです。" }, { status: 400 });
    }
    if (lowItemIds.some((id) => clearLowItemIds.includes(id))) {
      return Response.json({ error: "同じ商品に複数の状態が指定されています。" }, { status: 400 });
    }

    const editableRows = await sql`
      select id::text as id, exception_code as "exceptionCode"
      from inventory_items
      where store_id = ${storeId}::uuid
        and status = 'active'
        and exception_code in ('', 'low')
    `;
    const editableIds = new Set(editableRows.map((row) => String(row.id)));
    if (requestedItemIds.some((id) => !editableIds.has(id))) {
      return Response.json({ error: "更新できない在庫商品が含まれています。画面を更新してください。" }, { status: 409 });
    }

    const selectedIds = new Set(lowItemIds);
    const clearedIds = new Set(clearLowItemIds);
    const toLowIds = editableRows
      .filter((row) => selectedIds.has(String(row.id)) && String(row.exceptionCode) !== "low")
      .map((row) => String(row.id));
    const toClearIds = editableRows
      .filter((row) => clearedIds.has(String(row.id)) && String(row.exceptionCode) === "low")
      .map((row) => String(row.id));

    const queries = [
      ...(toLowIds.length ? [
        sql`
          update inventory_items
          set exception_code = 'low', exception_note = '', quick_superseded_at = clock_timestamp(), quick_revision = quick_revision + 1, updated_at = now()
          where store_id = ${storeId}::uuid and id::text = any(${toLowIds})
        `,
        sql`
          insert into inventory_checks (
            inventory_item_id, store_id, product_id, quantity, count_unit, record_type,
            exception_code, note, recorded_by, unit_conversion_snapshot
          )
          select id, store_id, product_id, current_quantity, count_unit, 'exception', 'low', 'クイック操作', ${session.id}::uuid, count_conversion_snapshot
          from inventory_items
          where store_id = ${storeId}::uuid and id::text = any(${toLowIds})
        `
      ] : []),
      ...(toClearIds.length ? [
        sql`
          update inventory_items
          set exception_code = '', exception_note = '', updated_at = now()
          where store_id = ${storeId}::uuid and id::text = any(${toClearIds})
        `,
        sql`
          insert into inventory_checks (
            inventory_item_id, store_id, product_id, quantity, count_unit, record_type,
            exception_code, note, recorded_by, unit_conversion_snapshot
          )
          select id, store_id, product_id, current_quantity, count_unit, 'exception', '', 'クイック操作', ${session.id}::uuid, count_conversion_snapshot
          from inventory_items
          where store_id = ${storeId}::uuid and id::text = any(${toClearIds})
        `
      ] : [])
    ];

    if (queries.length) await sql.transaction(queries);
    return Response.json({ ok: true, updatedCount: toLowIds.length + toClearIds.length });
  }

  const itemId = String(body.itemId ?? "").trim();
  if (!itemId) return Response.json({ error: "在庫商品が見つかりません。" }, { status: 404 });

  const itemRows = await sql`
    select items.id, items.store_id::text as "storeId", items.product_id::text as "productId",
      items.count_unit as "countUnit", items.safety_stock::float as "safetyStock",
      items.stock_revision as "stockRevision", items.stock_quantity::float as "stockQuantity", items.current_quantity::float as "lastCountedQuantity",
      items.last_received_at as "lastReceivedAt",
      products.unit as "purchaseUnit", products.package_quantity::float as "packageQuantity",
      products.package_quantity_unit as "packageQuantityUnit", products.inventory_unit_conversions as "inventoryUnitConversions"
    from inventory_items items join products on products.id = items.product_id
    where items.id = ${itemId}::uuid and items.store_id = ${storeId}::uuid and items.status = 'active'
    limit 1
  `;
  const item = itemRows[0];
  if (!item) return Response.json({ error: "在庫商品が見つかりません。" }, { status: 404 });

  if (action === "count") {
    let quantity = parseInventoryCountQuantity(body.quantity);
    if (quantity === null) {
      return Response.json({ error: "在庫量を0以上の数値で入力してください。分数は小数点以下6桁まで正確に表せる値を使い、1/3などは専用の棚卸単位で記録してください。" }, { status: 400 });
    }
    const expectedCountUnit = String(body.countUnit ?? "").trim();
    if (!expectedCountUnit) {
      return Response.json({ error: "画面を更新して、在庫の単位を再確認してください。" }, { status: 409 });
    }
    const currentConversion = resolveProductUnitConversion(inventoryProductConfiguration(item), expectedCountUnit);
    const inputUnit = String(body.inputUnit ?? expectedCountUnit).trim();
    try { quantity = normalizeInventoryCountInput(body.quantity,inputUnit,expectedCountUnit,inventoryProductConfiguration(item)).quantity; }
    catch(error) { return Response.json({error:error instanceof Error?error.message:"数量を確認してください。"},{status:400}); }
    if (inputUnit !== expectedCountUnit) {
      const mixed = await sql`select exists(select 1 from inventory_stock_receipts receipts where inventory_item_id=${itemId}::uuid
        and mode<>'unverified' and ((batch_packaging_snapshot is not null and (
          batch_packaging_snapshot->>'purchaseUnit' is distinct from ${currentConversion?.purchaseUnit ?? null}::text or
          batch_packaging_snapshot->>'countUnit'<>${expectedCountUnit} or
          (batch_packaging_snapshot->>'stockQuantityPerPurchase')::numeric is distinct from ${currentConversion?.unitsPerPurchase ?? null}::numeric))
          or (batch_packaging_snapshot is null and conversion_snapshot is not null and conversion_snapshot is distinct from ${currentConversion?JSON.stringify(currentConversion):null}::jsonb))) as mixed`;
      if(mixed[0]?.mixed) return Response.json({error:"包装が異なる在庫は個数・重量で棚卸してください。袋数を同じ換算で合算できません。",code:"batch_unit_identity_required"},{status:409});
    }
    const hasStockRevision = Object.prototype.hasOwnProperty.call(body, "expectedStockRevision");
    if (hasStockRevision && (!Number.isInteger(body.expectedStockRevision) || Number(body.expectedStockRevision) < 0)) {
      return Response.json({ error: "在庫の更新情報を再取得してください。", code: "stock_revision_changed" }, { status: 409 });
    }
    const expectedStockRevision = hasStockRevision ? body.expectedStockRevision : Number(item.stockRevision);
    if ((hasStockRevision && expectedStockRevision !== Number(item.stockRevision))
      || (!hasStockRevision && (item.lastReceivedAt !== null || item.stockQuantity !== item.lastCountedQuantity))) {
      return Response.json({ error: "入庫または別の棚卸で在庫が更新されています。画面を更新して数量を再確認してください。", code: "stock_revision_changed" }, { status: 409 });
    }
    if (Object.prototype.hasOwnProperty.call(body, "expectedConversion")
      && !(body.expectedConversion === null && currentConversion === null)
      && !unitConversionSnapshotsEqual(body.expectedConversion, currentConversion)) {
      return Response.json({ error: "購入・棚卸単位の換算設定が変わりました。画面を更新して再確認してください。" }, { status: 409 });
    }
    const recordedCounts = await sql`
      with locked_product as materialized (
        select products.id, products.unit as purchase_unit, products.package_quantity,
          products.package_quantity_unit, products.inventory_unit_conversions
        from products
        where products.id = ${item.productId}::uuid
        for share of products
      ), locked_count as materialized (
        select items.id, locked_product.purchase_unit, locked_product.package_quantity,
          locked_product.package_quantity_unit, locked_product.inventory_unit_conversions,
          items.current_quantity as previous_count_quantity, items.stock_quantity as previous_stock_quantity, items.count_unit as previous_count_unit,
          items.usage_anchor_check_id as previous_anchor_id, items.last_counted_at as previous_counted_at
        from locked_product join inventory_items items on items.product_id = locked_product.id
        where items.id = ${itemId}::uuid and items.store_id = ${storeId}::uuid
          and items.status = 'active' and items.count_unit = ${expectedCountUnit}
        for update of items
      ), count_clock as materialized (
        select clock_timestamp() as counted_at from locked_count limit 1
      ), reconciled as materialized (
        select locked_count.*, gen_random_uuid() as check_id, count_clock.counted_at,
          jsonb_build_object(
            'anchorCheckId', anchor.id, 'anchorQuantity', anchor.quantity,
             'expectedQuantity', case when anchor.id is null or locked_count.previous_stock_quantity is null or flows.broken or (flows.unknown_exposure > 0 and model.factor is null) then null
              else round(locked_count.previous_stock_quantity-flows.estimated-flows.unknown_exposure*coalesce(model.factor,0),6) end,
            'observedQuantity', ${quantity}::numeric, 'enteredQuantity', ${parseInventoryCountQuantity(body.quantity)}::numeric, 'enteredUnit', ${inputUnit}::text,
            'difference', case when anchor.id is null or locked_count.previous_stock_quantity is null or flows.broken or (flows.unknown_exposure > 0 and model.factor is null) then null
              else ${quantity}::numeric-round(locked_count.previous_stock_quantity-flows.estimated-flows.unknown_exposure*coalesce(model.factor,0),6) end,
            'countUnit', ${expectedCountUnit}::text,
            'receivedQuantity', case when anchor.id is null or flows.broken then null else flows.incoming end,
            'orderDeductedQuantity', case when anchor.id is null or flows.broken then null else flows.order_usage end,
            'estimatedUsageQuantity', case when flows.estimated > 0 then flows.estimated else null end,
            'unknownExposure', flows.unknown_exposure, 'unknownRecipeVersionIds', flows.unknown_versions,
            'confidence', case when anchor.id is null or locked_count.previous_stock_quantity is null or flows.broken or issues.unmapped > 0 then 'unknown'
              when flows.estimated > 0 or flows.unknown_exposure > 0 then 'estimated' else 'confirmed' end,
            'issueReasons', to_jsonb(array_remove(array[
              case when anchor.id is null then 'anchor_missing' end,
              case when locked_count.previous_stock_quantity is null then 'book_unknown' end,
              case when flows.broken then 'movement_unknown' end,
              case when flows.estimated > 0 then 'estimated_inputs' end,
              case when flows.unknown_exposure > 0 then 'unmeasured_usage' end,
              case when flows.unknown_exposure > 0 and model.factor is null then 'prediction_basis_missing' end,
              case when issues.unmapped > 0 then 'unmapped_orders' end
            ]::text[],null)),
            'countedAt', count_clock.counted_at, 'periodStartedAt', anchor.created_at,
            'movementCutoffId', flows.cutoff::text,
            'otherDelta', flows.other_delta,
            'incomingQuantity', flows.incoming,
            'unmappedOrders', issues.unmapped
          ) as reconciliation
        from locked_count cross join count_clock
        left join inventory_checks anchor on anchor.id = locked_count.previous_anchor_id
          and anchor.inventory_item_id=locked_count.id and anchor.quantity=locked_count.previous_count_quantity and anchor.created_at=locked_count.previous_counted_at
          and anchor.record_type = 'count' and anchor.count_unit = ${expectedCountUnit}
        left join lateral (
          select coalesce(sum(quantity) filter (where changes_stock and quantity > 0 and kind <> 'count'),0) as incoming,
            coalesce(sum(-quantity) filter(where kind='order_use' and confidence='exact' and quantity < 0),0) as order_usage,
            coalesce(sum(-quantity) filter(where confidence='estimate' and quantity < 0),0) as estimated,
            coalesce(sum(exposure) filter(where kind='order_use' and confidence='unmeasured'),0) as unknown_exposure,
            coalesce(jsonb_agg(distinct recipe_version_id::text order by recipe_version_id::text) filter(where kind='order_use' and confidence='unmeasured' and recipe_version_id is not null),'[]'::jsonb) as unknown_versions,
            coalesce(sum(quantity) filter(where changes_stock and kind not in ('count','receipt','order_use') and quantity < 0),0) as other_delta,
            coalesce(bool_or(count_unit <> ${expectedCountUnit} or metadata->>'quantityUnknown'='true' or metadata->>'balanceUnknown'='true' or (kind='production_input' and confidence='unmeasured')),false) as broken,
            max(id) as cutoff
          from inventory_movements
          where inventory_item_id = locked_count.id and anchor.id is not null and kind <> 'count'
            and occurred_at > anchor.created_at and occurred_at <= count_clock.counted_at
        ) flows on true
        left join lateral (
          select case when sum((snapshot->>'unknownExposure')::numeric)>0 then
            round(sum((snapshot->>'anchorQuantity')::numeric+(snapshot->>'incomingQuantity')::numeric+(snapshot->>'otherDelta')::numeric
              -(snapshot->>'observedQuantity')::numeric-(snapshot->>'orderDeductedQuantity')::numeric) / sum((snapshot->>'unknownExposure')::numeric),6) else null end as factor
          from (select reconciliation_snapshot as snapshot from inventory_checks
            where inventory_item_id=locked_count.id and record_type='count' and reconciliation_snapshot is not null
            order by created_at desc limit 8) prior
          where snapshot->>'countUnit'=${expectedCountUnit}
            and coalesce(snapshot->'issueReasons','["unknown"]'::jsonb) <@ '["unmeasured_usage","prediction_basis_missing"]'::jsonb
            and snapshot->'unknownRecipeVersionIds'=flows.unknown_versions
            and (snapshot->>'unknownExposure')::numeric>0
            and (snapshot->>'anchorQuantity')::numeric+(snapshot->>'incomingQuantity')::numeric+(snapshot->>'otherDelta')::numeric
              -(snapshot->>'observedQuantity')::numeric-(snapshot->>'orderDeductedQuantity')::numeric>=0
        ) model on true
        left join lateral (
          select count(distinct order_id) as unmapped from inventory_order_usage_issues
          where store_id = ${storeId}::uuid and resolved_at is null
            and created_at > coalesce(anchor.created_at,count_clock.counted_at)
        ) issues on true
      ), counted as (
        update inventory_items
        set
          current_quantity = ${quantity}::numeric,
          usage_anchor_check_id = reconciled.check_id,
          count_conversion_snapshot = ${currentConversion ? JSON.stringify(currentConversion) : null}::jsonb,
          stock_quantity = ${quantity}::numeric,
          stock_conversion_snapshot = ${currentConversion ? JSON.stringify(currentConversion) : null}::jsonb,
          stock_revision = inventory_items.stock_revision + 1,
          quick_superseded_at = clock_timestamp(),
          exception_code = case
            when inventory_items.exception_code in ('quality', 'damaged', 'too_much') then inventory_items.exception_code
            when ${quantity}::numeric = 0 then 'out'
            when ${quantity}::numeric <= inventory_items.safety_stock then 'low'
            else ''
          end,
          exception_note = case when inventory_items.exception_code in ('quality', 'damaged', 'too_much') then inventory_items.exception_note else '' end,
          last_counted_at = reconciled.counted_at,
          last_counted_by = ${session.id}::uuid,
          updated_at = now()
        from reconciled
        where inventory_items.id = reconciled.id
          and reconciled.purchase_unit is not distinct from ${item.purchaseUnit}
          and reconciled.package_quantity is not distinct from ${item.packageQuantity}::numeric
          and reconciled.package_quantity_unit is not distinct from ${item.packageQuantityUnit}
          and reconciled.inventory_unit_conversions is not distinct from ${JSON.stringify(item.inventoryUnitConversions ?? [])}::jsonb
          and inventory_items.id = ${itemId}::uuid
          and store_id = ${storeId}::uuid
          and status = 'active'
          and count_unit = ${expectedCountUnit}
          and stock_revision = ${expectedStockRevision}::integer
          and (${hasStockRevision} or (last_received_at is null and stock_quantity is not distinct from current_quantity))
        returning inventory_items.id, store_id, product_id, current_quantity, count_unit, exception_code, count_conversion_snapshot, stock_revision,
          reconciled.check_id, reconciled.counted_at, reconciled.previous_stock_quantity, reconciled.reconciliation
      ), checked as (
        insert into inventory_checks (
          id,inventory_item_id,store_id,product_id,quantity,count_unit,record_type,
          exception_code,note,recorded_by,unit_conversion_snapshot,reconciliation_snapshot,created_at
        ) select check_id,id,store_id,product_id,current_quantity,count_unit,'count',exception_code,'',${session.id}::uuid,
          count_conversion_snapshot,reconciliation,counted_at from counted
        returning id,inventory_item_id,store_id,product_id,quantity,count_unit,exception_code,unit_conversion_snapshot,reconciliation_snapshot,created_at
      ), movement as (
        insert into inventory_movements(operation_key,store_id,product_id,inventory_item_id,kind,quantity,count_unit,confidence,
          occurred_at,before_quantity,after_quantity,changes_stock,metadata)
        select 'count:'||checked.id::text,checked.store_id,checked.product_id,checked.inventory_item_id,'count',
          case when counted.previous_stock_quantity is null then null else checked.quantity-counted.previous_stock_quantity end,
          checked.count_unit,'exact',checked.created_at,counted.previous_stock_quantity,checked.quantity,
          counted.previous_stock_quantity is not null,jsonb_build_object('checkId',checked.id,'countQuantity',checked.quantity)
        from checked join counted on counted.id=checked.inventory_item_id returning id
      )
      select checked.inventory_item_id::text as "itemId",checked.quantity::float as quantity,
        checked.count_unit as "countUnit",checked.exception_code as "exceptionCode",checked.unit_conversion_snapshot as "countConversionSnapshot",
        checked.reconciliation_snapshot as reconciliation,checked.id::text as "checkId"
      from checked cross join movement
    `;
    if (!recordedCounts[0]) {
      return Response.json({ error: "在庫または購入・棚卸単位が更新されています。画面を更新して数量を再確認してください。", code: "stock_revision_changed" }, { status: 409 });
    }
    return Response.json({ ok: true, count: recordedCounts[0] });
  }

  if (action === "exception") {
    const exceptionCode = String(body.exceptionCode ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!exceptionCodes.has(exceptionCode)) {
      return Response.json({ error: "異常の種類を確認してください。" }, { status: 400 });
    }

    await sql.transaction([sql`
      update inventory_items
      set
        exception_code = ${exceptionCode},
        exception_note = ${note},
        quick_superseded_at = case when ${exceptionCode} in ('low', 'out') then clock_timestamp() else quick_superseded_at end,
        quick_revision = quick_revision + case when ${exceptionCode} in ('low', 'out') then 1 else 0 end,
        updated_at = now()
      where id = ${itemId}::uuid
    `, sql`
      insert into inventory_checks (
        inventory_item_id, store_id, product_id, quantity, count_unit, record_type,
        exception_code, note, recorded_by, unit_conversion_snapshot
      )
      select
        id, store_id, product_id,
        current_quantity, count_unit,
        'exception', ${exceptionCode}, ${note}, ${session.id}::uuid, count_conversion_snapshot
      from inventory_items
      where id = ${itemId}::uuid
    `]);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "操作を確認できませんでした。" }, { status: 400 });
}

function inventoryProductConfiguration(row: Record<string, unknown>) {
  return {
    unit: String(row.purchaseUnit ?? row.unit ?? ""),
    packageQuantity: row.packageQuantity as number | null,
    packageQuantityUnit: String(row.packageQuantityUnit ?? ""),
    inventoryUnitConversions: row.inventoryUnitConversions
  };
}

function inventoryPurchaseEquivalent(quantity: unknown, snapshot: ProductUnitConversionSnapshot | null) {
  const amount = convertCountToPurchaseQuantity(typeof quantity === "number" ? quantity : NaN, snapshot);
  return amount === null || !snapshot ? null : { quantity: amount, unit: snapshot.purchaseUnit };
}

function normalizeNonNegativeNumber(value: unknown, fallback: number) {
  return parseInventoryCountQuantity(value) ?? fallback;
}

function normalizeLocationType(value: unknown) {
  const normalized = String(value ?? "");
  return ["freezer", "refrigerator", "ambient", "other"].includes(normalized) ? normalized : "other";
}
