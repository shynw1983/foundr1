import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";
import {
  parseRocketNowSalesXlsx,
  parseSmaregiSalesCsv,
  parseUberSalesCsv,
  SalesCsvParserUpdateRequiredError
} from "../../../../lib/sales-imports";
import { getSalesSourceDefinition } from "../../../../lib/sales-sources";

const salesImportRoles = new Set(["owner", "manager"]);

function decodeSalesCsv(bytes: Uint8Array, sourcePlatform: string) {
  if (sourcePlatform === "smaregi") {
    const utf8Text = new TextDecoder("utf-8").decode(bytes);
    if (utf8Text.includes("取引ID") && utf8Text.includes("取引日時") && utf8Text.includes("合計")) {
      return utf8Text;
    }
    return new TextDecoder("shift-jis").decode(bytes);
  }

  return new TextDecoder("utf-8").decode(bytes);
}

async function getVisibleStores(allStores: boolean, storeIds: string[]) {
  if (allStores) {
    return sql`
      select id::text, name
      from stores
      where status = 'active'
      order by name
    `;
  }
  if (storeIds.length === 0) return [];
  return sql`
    select id::text, name
    from stores
    where status = 'active'
      and id::text = any(${storeIds})
    order by name
  `;
}

async function getStoreBrandId(storeId: string, brandName = "") {
  if (brandName) {
    const namedRows = await sql`
      select brands.id::text as "brandId"
      from brands
      join store_brands on store_brands.brand_id = brands.id
      where store_brands.store_id::text = ${storeId}
        and brands.name = ${brandName}
      limit 1
    `;
    if (namedRows[0]?.brandId) return String(namedRows[0].brandId);
  }

  const rows = await sql`
    select brand_id::text as "brandId"
    from store_brands
    where store_id::text = ${storeId}
    order by brand_id::text
    limit 1
  `;
  return rows[0]?.brandId ? String(rows[0].brandId) : null;
}

async function getStoreSalesSources(storeId: string) {
  const rows = storeId ? await sql`
    select
      id::text,
      source_platform as "sourcePlatform",
      source_label as "sourceLabel",
      source_type as "sourceType",
      brand_name as "brandName",
      is_enabled as "isEnabled",
      metadata
    from store_sales_sources
    where store_id::text = ${storeId}
      and is_enabled = true
    order by sort_order, source_label, brand_name
  ` : [];

  return rows.map((row) => {
    const definition = getSalesSourceDefinition(String(row.sourcePlatform));
    const brandName = row.brandName ? String(row.brandName) : "";
    return {
      id: String(row.id),
      sourcePlatform: String(row.sourcePlatform),
      sourceLabel: brandName ? `${String(row.sourceLabel)} / ${brandName}` : String(row.sourceLabel),
      baseLabel: String(row.sourceLabel),
      sourceType: String(row.sourceType),
      brandName,
      importSupported: Boolean(definition?.importSupported)
    };
  });
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  const scope = await getSessionStoreScope(session);
  const stores = await getVisibleStores(scope.allStores, scope.storeIds);
  const visibleStoreIds = stores.map((store) => String(store.id));
  const requestedStoreId = url.searchParams.get("storeId");
  const requestedMonth = url.searchParams.get("month");
  const selectedStoreId = requestedStoreId && visibleStoreIds.includes(requestedStoreId)
    ? requestedStoreId
    : visibleStoreIds[0] ?? "";
  const salesSources = await getStoreSalesSources(selectedStoreId);
  const imports = visibleStoreIds.length ? await sql`
    select
      sales_import_batches.id::text,
      sales_import_batches.store_id::text as "storeId",
      sales_import_batches.sales_source_id::text as "salesSourceId",
      stores.name as "storeName",
      sales_import_batches.source_platform as "sourcePlatform",
      sales_import_batches.import_month as "importMonth",
      sales_import_batches.file_name as "fileName",
      sales_import_batches.raw_row_count as "rawRowCount",
      sales_import_batches.imported_order_count as "importedOrderCount",
      sales_import_batches.skipped_row_count as "skippedRowCount",
      sales_import_batches.created_at as "createdAt",
      sales_import_batches.metadata,
      employees.name as "importedByName"
    from sales_import_batches
    left join stores on stores.id = sales_import_batches.store_id
    left join employees on employees.id = sales_import_batches.imported_by
    where (
      ${scope.allStores}
      or sales_import_batches.store_id::text = any(${visibleStoreIds})
    )
      and (${!selectedStoreId} or sales_import_batches.store_id::text = ${selectedStoreId})
      and (${!requestedMonth} or sales_import_batches.import_month = ${requestedMonth ?? ""})
    order by sales_import_batches.created_at desc
    limit 20
  ` : [];

  return Response.json({
    canImport: salesImportRoles.has(session.role),
    stores,
    selectedStoreId,
    salesSources,
    imports: imports.map((row) => ({
      id: String(row.id),
      storeId: row.storeId ? String(row.storeId) : null,
      salesSourceId: row.salesSourceId ? String(row.salesSourceId) : String(row.metadata?.salesSourceId ?? ""),
      storeName: row.storeName ? String(row.storeName) : "",
      sourcePlatform: String(row.sourcePlatform),
      importMonth: String(row.importMonth),
      fileName: String(row.fileName),
      rawRowCount: Number(row.rawRowCount ?? 0),
      importedOrderCount: Number(row.importedOrderCount ?? 0),
      skippedRowCount: Number(row.skippedRowCount ?? 0),
      createdAt: new Date(String(row.createdAt)).toISOString(),
      brandName: String(row.metadata?.brandName ?? ""),
      importedByName: row.importedByName ? String(row.importedByName) : ""
    }))
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!salesImportRoles.has(session.role)) {
    return Response.json({ error: "売上データを取り込む権限がありません。" }, { status: 403 });
  }

  const formData = await request.formData();
  const storeId = String(formData.get("storeId") ?? "");
  const salesSourceId = String(formData.get("salesSourceId") ?? "");
  const file = formData.get("file");
  if (!storeId) return Response.json({ error: "店舗を選択してください。" }, { status: 400 });
  if (!salesSourceId) return Response.json({ error: "売上源を選択してください。" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "売上ファイルを選択してください。" }, { status: 400 });

  const scope = await getSessionStoreScope(session);
  if (!scope.allStores && !scope.storeIds.includes(storeId)) {
    return Response.json({ error: "この店舗に取り込む権限がありません。" }, { status: 403 });
  }

  const sourceRows = await sql`
    select
      id::text,
      source_platform as "sourcePlatform",
      source_label as "sourceLabel",
      source_type as "sourceType",
      brand_name as "brandName"
    from store_sales_sources
    where id::text = ${salesSourceId}
      and store_id::text = ${storeId}
      and is_enabled = true
    limit 1
  `;
  const source = sourceRows[0];
  if (!source) return Response.json({ error: "この店舗の売上源が見つかりません。" }, { status: 404 });
  const sourcePlatform = String(source.sourcePlatform);
  const sourceDefinition = getSalesSourceDefinition(sourcePlatform);
  if (!sourceDefinition?.importSupported) {
    return Response.json({ error: "この売上源の売上ファイル取込はまだ対応していません。" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = (() => {
    try {
      if (sourcePlatform === "rocket_now") return parseRocketNowSalesXlsx(bytes);
      const text = decodeSalesCsv(bytes, sourcePlatform);
      if (sourcePlatform === "smaregi") return parseSmaregiSalesCsv(text);
      return parseUberSalesCsv(text);
    } catch (error) {
      if (error instanceof SalesCsvParserUpdateRequiredError) {
        return { error };
      }
      throw error;
    }
  })();
  if ("error" in parsed) {
    return Response.json({
      error: parsed.error.message,
      parserUpdateRequired: true
    }, { status: 422 });
  }
  if (parsed.orders.length === 0) {
    return Response.json({
      error: "取り込める注文がありませんでした。ファイル形式が変わっている可能性があるため、解析器の更新が必要です。",
      parserUpdateRequired: true
    }, { status: 422 });
  }

  const importMonth = String(formData.get("month") || parsed.detectedMonth || "");
  if (!/^\d{4}-\d{2}$/.test(importMonth)) {
    return Response.json({ error: "対象月を判定できませんでした。" }, { status: 400 });
  }

  const brandName = source.brandName ? String(source.brandName) : "";
  const brandId = await getStoreBrandId(storeId, brandName);
  const batchRows = await sql`
    insert into sales_import_batches (
      store_id,
      sales_source_id,
      source_platform,
      import_month,
      file_name,
      raw_row_count,
      imported_order_count,
      skipped_row_count,
      imported_by,
      metadata,
      updated_at
    )
    values (
      ${storeId},
      ${salesSourceId},
      ${sourcePlatform},
      ${importMonth},
      ${file.name},
      ${parsed.rawRows.length},
      ${parsed.orders.length},
      ${parsed.skippedRowCount},
      ${session.id},
      ${JSON.stringify({ detectedMonth: parsed.detectedMonth, salesSourceId, brandName })}::jsonb,
      now()
    )
    returning id::text
  `;
  const batchId = String(batchRows[0]?.id ?? "");

  const rawPayload = parsed.rawRows.map((row) => ({
    row_index: row.rowIndex,
    source_external_id: row.sourceExternalId ?? "",
    order_no: row.orderNo ?? "",
    ordered_at: row.orderedAt ? row.orderedAt.toISOString() : "",
    raw_json: row.raw
  }));
  if (rawPayload.length > 0) {
    await sql`
      insert into sales_import_rows (
        batch_id,
        source_platform,
        source_external_id,
        order_no,
        ordered_at,
        row_index,
        raw_json
      )
      select
        ${batchId},
        ${sourcePlatform},
        nullif(payload.source_external_id, ''),
        nullif(payload.order_no, ''),
        nullif(payload.ordered_at, '')::timestamptz,
        payload.row_index,
        payload.raw_json
      from jsonb_to_recordset(${JSON.stringify(rawPayload)}::jsonb) as payload(
        row_index integer,
        source_external_id text,
        order_no text,
        ordered_at text,
        raw_json jsonb
      )
    `;
  }

  for (const order of parsed.orders) {
    await sql`
      insert into sales_orders (
        source_external_id,
        brand_id,
        store_id,
        channel,
        source_platform,
        order_no,
        status,
        payment_status,
        ordered_at,
        paid_at,
        completed_at,
        subtotal,
        discount,
        tax,
        total,
        currency,
        metadata,
        updated_at
      )
      values (
        ${order.sourceExternalId},
        ${brandId},
        ${storeId},
        ${String(source.sourceType || sourceDefinition?.sourceType || "delivery")},
        ${sourcePlatform},
        ${order.orderNo},
        'completed',
        'paid',
        ${order.orderedAt.toISOString()},
        ${order.orderedAt.toISOString()},
        ${order.orderedAt.toISOString()},
        ${order.subtotal},
        ${order.discount},
        ${order.tax},
        ${order.total},
        'JPY',
        ${JSON.stringify({
          importBatchId: batchId,
          salesSourceId,
          salesSourceLabel: source.sourceLabel,
          sourceBrandName: brandName,
          sourceStoreName: order.storeName,
          adjustment: order.adjustment,
          rowCount: order.rowCount,
          rawRows: order.rawRows
        })}::jsonb,
        now()
      )
      on conflict (source_platform, source_external_id) where source_external_id is not null
      do update set
        brand_id = excluded.brand_id,
        store_id = excluded.store_id,
        order_no = excluded.order_no,
        status = excluded.status,
        payment_status = excluded.payment_status,
        ordered_at = excluded.ordered_at,
        paid_at = excluded.paid_at,
        completed_at = excluded.completed_at,
        subtotal = excluded.subtotal,
        discount = excluded.discount,
        tax = excluded.tax,
        total = excluded.total,
        currency = excluded.currency,
        metadata = excluded.metadata,
        updated_at = now()
    `;
  }

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: `sales.import.${sourcePlatform}`,
    targetType: "sales_import_batch",
    targetId: batchId,
    metadata: { storeId, salesSourceId, sourcePlatform, importMonth, fileName: file.name, importedOrderCount: parsed.orders.length },
    request
  });

  return Response.json({
    ok: true,
    batchId,
    importMonth,
    rawRowCount: parsed.rawRows.length,
    importedOrderCount: parsed.orders.length,
    skippedRowCount: parsed.skippedRowCount
  });
}
