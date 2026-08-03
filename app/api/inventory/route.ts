import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { roleHasPermission } from "../../../lib/role-permissions";

const exceptionCodes = new Set(["", "low", "out", "too_much", "damaged", "quality"]);

async function requireInventorySession() {
  const session = await requireOsSession();
  if (!session || !(await roleHasPermission(session.role, "module.inventory"))) return null;
  return session;
}

export async function GET(request: Request) {
  const session = await requireInventorySession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

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
    return Response.json({ stores: [], locations: [], items: [], products: [], recentChecks: [] });
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
        inventory_items.safety_stock::float as "safetyStock",
        inventory_items.current_quantity::float as "currentQuantity",
        inventory_items.exception_code as "exceptionCode",
        inventory_items.exception_note as "exceptionNote",
        inventory_items.last_counted_at as "lastCountedAt",
        coalesce(employees.name, '') as "lastCountedBy",
        case
          when inventory_items.last_counted_at is null then '未確認'
          when inventory_items.last_counted_at < now() - interval '7 days' then '要確認'
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
      order by inventory_locations.sort_order, inventory_locations.name, products.category, products.name
    `,
    sql`
      select
        products.id::text as id,
        products.name,
        products.category,
        products.unit,
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
        inventory_items.count_unit as "countUnit",
        inventory_checks.record_type as "recordType",
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

  return Response.json({ stores, selectedStoreId: storeId, locations, items, products, recentChecks });
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
    exceptionCode?: string;
    note?: string;
  };
  const action = String(body.action ?? "");
  const storeId = String(body.storeId ?? "").trim();

  if (!storeId || !(await canAccessStore(session, storeId))) {
    return Response.json({ error: "この店舗を操作する権限がありません。" }, { status: 403 });
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

    const [productRows, locationRows] = await Promise.all([
      sql`select id, unit from products where id = ${productId}::uuid limit 1`,
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
      insert into inventory_items (
        store_id, product_id, location_id, count_unit, safety_stock, updated_at
      ) values (
        ${storeId}::uuid, ${productId}::uuid, ${locationId}::uuid,
        ${countUnit}, ${safetyStock}, now()
      )
      on conflict (store_id, product_id, location_id)
      do update set
        count_unit = excluded.count_unit,
        safety_stock = excluded.safety_stock,
        status = 'active',
        updated_at = now()
    `;
    return Response.json({ ok: true });
  }

  const itemId = String(body.itemId ?? "").trim();
  if (!itemId) return Response.json({ error: "在庫商品が見つかりません。" }, { status: 404 });

  const itemRows = await sql`
    select id, store_id::text as "storeId", product_id::text as "productId", safety_stock::float as "safetyStock"
    from inventory_items
    where id = ${itemId}::uuid and store_id = ${storeId}::uuid and status = 'active'
    limit 1
  `;
  const item = itemRows[0];
  if (!item) return Response.json({ error: "在庫商品が見つかりません。" }, { status: 404 });

  if (action === "count") {
    const quantity = normalizeNonNegativeNumber(body.quantity, Number.NaN);
    if (!Number.isFinite(quantity)) {
      return Response.json({ error: "在庫量を選択してください。" }, { status: 400 });
    }
    const derivedException = quantity === 0 ? "out" : quantity <= Number(item.safetyStock) ? "low" : "";

    await sql`
      update inventory_items
      set
        current_quantity = ${quantity},
        exception_code = ${derivedException},
        exception_note = '',
        last_counted_at = now(),
        last_counted_by = ${session.id}::uuid,
        updated_at = now()
      where id = ${itemId}::uuid
    `;
    await sql`
      insert into inventory_checks (
        inventory_item_id, store_id, product_id, quantity, record_type,
        exception_code, note, recorded_by
      ) values (
        ${itemId}::uuid, ${storeId}::uuid, ${String(item.productId)}::uuid,
        ${quantity}, 'count', ${derivedException}, '', ${session.id}::uuid
      )
    `;
    return Response.json({ ok: true });
  }

  if (action === "exception") {
    const exceptionCode = String(body.exceptionCode ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!exceptionCodes.has(exceptionCode)) {
      return Response.json({ error: "異常の種類を確認してください。" }, { status: 400 });
    }

    await sql`
      update inventory_items
      set
        current_quantity = case when ${exceptionCode} = 'out' then 0 else current_quantity end,
        exception_code = ${exceptionCode},
        exception_note = ${note},
        last_counted_at = now(),
        last_counted_by = ${session.id}::uuid,
        updated_at = now()
      where id = ${itemId}::uuid
    `;
    await sql`
      insert into inventory_checks (
        inventory_item_id, store_id, product_id, quantity, record_type,
        exception_code, note, recorded_by
      )
      select
        id, store_id, product_id,
        case when ${exceptionCode} = 'out' then 0 else current_quantity end,
        'exception', ${exceptionCode}, ${note}, ${session.id}::uuid
      from inventory_items
      where id = ${itemId}::uuid
    `;
    return Response.json({ ok: true });
  }

  return Response.json({ error: "操作を確認できませんでした。" }, { status: 400 });
}

function normalizeNonNegativeNumber(value: unknown, fallback: number) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) return fallback;
  return Math.round(normalized * 100) / 100;
}

function normalizeLocationType(value: unknown) {
  const normalized = String(value ?? "");
  return ["freezer", "refrigerator", "ambient", "other"].includes(normalized) ? normalized : "other";
}
