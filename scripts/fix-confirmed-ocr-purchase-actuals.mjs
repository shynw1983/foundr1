import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const sql = neon(process.env.DATABASE_URL);

function toNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDateKey(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function validateReceiptPurchaseDate(value) {
  const date = normalizeDateKey(value);
  if (!date) return { date: "", reason: "missing_or_invalid_format" };

  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  const parsed = new Date(`${date}T00:00:00+09:00`);
  if (
    !Number.isFinite(parsed.getTime())
    || parsed.getFullYear() !== year
    || parsed.getMonth() + 1 !== month
    || parsed.getDate() !== day
  ) {
    return { date: "", reason: "nonexistent_date" };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const ageDays = (Date.now() - parsed.getTime()) / dayMs;
  if (ageDays > 730) return { date: "", reason: "too_old" };
  if (ageDays < -7) return { date: "", reason: "future_date" };
  return { date, reason: "" };
}

async function findExistingActual(item) {
  const rows = await sql`
    select
      purchase_actuals.id::text
    from purchase_actuals
    join purchase_order_items on purchase_order_items.id = purchase_actuals.purchase_order_item_id
    join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
    where purchase_orders.store_id::text = ${item.storeId}
      and purchase_order_items.product_id::text = ${item.productId}
      and date_trunc('month', purchase_actuals.recorded_at at time zone 'Asia/Tokyo') = date_trunc('month', ${item.purchaseDate}::date)
      and not exists (
        select 1
        from receipt_ocr_items existing_items
        where existing_items.purchase_actual_id = purchase_actuals.id
          and existing_items.id::text <> ${item.itemId}
          and existing_items.reconciliation_status in ('auto_matched', 'manual_matched')
      )
    order by
      case when purchase_actuals.supplier_id::text = ${item.supplierId} then 0 else 1 end asc,
      abs((purchase_actuals.recorded_at at time zone 'Asia/Tokyo')::date - ${item.purchaseDate}::date) asc,
      abs(coalesce(purchase_actuals.actual_quantity::float, 0) - ${item.quantity}) asc,
      purchase_actuals.recorded_at desc
    limit 1
  `;
  return rows[0]?.id ? String(rows[0].id) : "";
}

async function updateExistingActual(item, purchaseActualId) {
  await sql`
    update purchase_actuals
    set
      actual_quantity = coalesce(actual_quantity, ${item.quantity > 0 ? item.quantity : null}),
      actual_price = coalesce(actual_price, ${item.unitPrice > 0 ? item.unitPrice : null})
    where id::text = ${purchaseActualId}
  `;

  await sql`
    update receipt_ocr_items
    set
      purchase_actual_id = ${purchaseActualId},
      reconciliation_status = 'auto_matched',
      reconciliation_note = '確認済みレシート明細を購入実績に自動照合しました。',
      updated_at = now()
    where id::text = ${item.itemId}
  `;
}

async function createReceiptBackfilledActual(item) {
  const productRows = await sql`
    select
      products.name,
      products.unit,
      (
        select product_supplier_options.supplier_id
        from product_supplier_options
        where product_supplier_options.product_id = products.id
          and product_supplier_options.role = 'メイン'
          and product_supplier_options.is_active = true
        limit 1
      ) as "mainSupplierId"
    from products
    where products.id::text = ${item.productId}
    limit 1
  `;
  const product = productRows[0];
  if (!product) return "";

  const purchaseDate = item.purchaseDate;
  const purchaseTime = String(item.purchaseTime || "00:00").slice(0, 5) || "00:00";
  const recordedAt = new Date(`${purchaseDate}T${purchaseTime}:00+09:00`);
  const orderNo = `RCPT-${purchaseDate.replaceAll("-", "")}-${item.itemId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const supplierId = item.supplierId || product.mainSupplierId || null;
  const employeeId = item.employeeId || null;
  const quantity = item.quantity > 0 ? item.quantity : 1;
  const unit = item.unit || product.unit || "個";

  const orderRows = await sql`
    insert into purchase_orders (
      order_no,
      store_id,
      deadline_label,
      deadline_at,
      requested_item_count,
      priority,
      status,
      note,
      requested_by,
      assigned_to,
      updated_at
    )
    values (
      ${orderNo},
      ${item.storeId},
      ${purchaseDate},
      ${recordedAt},
      1,
      '中',
      '購入済み',
      ${`確認済みレシートから購入実績を補録: ${item.supplierName}`},
      ${employeeId},
      ${employeeId},
      now()
    )
    on conflict (order_no)
    do update set updated_at = now()
    returning id
  `;
  const purchaseOrderId = orderRows[0]?.id;
  if (!purchaseOrderId) return "";

  const orderItemRows = await sql`
    insert into purchase_order_items (
      purchase_order_id,
      product_id,
      requested_quantity,
      requested_unit,
      actual_quantity,
      actual_price,
      selected_supplier_id,
      status,
      note,
      procurement_note
    )
    values (
      ${purchaseOrderId},
      ${item.productId},
      ${quantity},
      ${unit},
      ${quantity},
      ${item.unitPrice > 0 ? item.unitPrice : null},
      ${supplierId},
      'purchased',
      'レシート補録',
      ${`確認済みレシート補録: ${item.rawName}`}
    )
    returning id
  `;
  const purchaseOrderItemId = orderItemRows[0]?.id;
  if (!purchaseOrderItemId) return "";

  const actualRows = await sql`
    insert into purchase_actuals (
      purchase_order_item_id,
      supplier_id,
      supplier_location_id,
      actual_quantity,
      actual_unit,
      actual_price,
      price_is_exception,
      note,
      recorded_by,
      recorded_at
    )
    values (
      ${purchaseOrderItemId},
      ${supplierId},
      ${item.supplierLocationId || null},
      ${quantity},
      ${unit},
      ${item.unitPrice > 0 ? item.unitPrice : null},
      false,
      ${`確認済みレシート補録: ${item.rawName}`},
      ${employeeId},
      ${recordedAt}
    )
    returning id::text
  `;
  const purchaseActualId = actualRows[0]?.id ? String(actualRows[0].id) : "";
  if (!purchaseActualId) return "";

  await sql`
    update receipt_ocr_items
    set
      purchase_actual_id = ${purchaseActualId},
      reconciliation_status = 'manual_matched',
      reconciliation_note = '確認済みレシート明細から購入実績を作成しました。',
      updated_at = now()
    where id::text = ${item.itemId}
  `;

  return purchaseActualId;
}

async function recordPrice(item) {
  if (!item.productId || item.unitPrice <= 0) return;
  await sql`
    delete from price_records
    where source = 'receipt_ocr'
      and receipt_note = ${item.itemId}
  `;

  await sql`
    insert into price_records (
      product_id,
      supplier_id,
      price,
      unit,
      source,
      receipt_note,
      recorded_by
    )
    values (
      ${item.productId},
      ${item.supplierId || null},
      ${item.unitPrice},
      ${item.unit || "個"},
      'receipt_ocr',
      ${item.itemId},
      ${item.employeeId || null}
    )
  `;
}

const rows = await sql`
  select
    receipt_ocr_items.id::text as "itemId",
    receipt_ocr_items.raw_name as "rawName",
    receipt_ocr_items.matched_product_id::text as "productId",
    receipt_ocr_items.quantity::float,
    coalesce(receipt_ocr_items.unit, '') as unit,
    receipt_ocr_items.unit_price::float as "unitPrice",
    receipt_ocr_items.amount::float,
    receipt_ocr_results.store_id::text as "storeId",
    receipt_ocr_results.supplier_id::text as "supplierId",
    receipt_ocr_results.supplier_location_id::text as "supplierLocationId",
    coalesce(receipt_ocr_results.supplier_name, receipt_ocr_results.vendor_name, '') as "supplierName",
    coalesce(to_char(receipt_ocr_results.purchase_date, 'YYYY-MM-DD'), '') as "purchaseDate",
    coalesce(to_char(receipt_ocr_results.purchase_time, 'HH24:MI'), '') as "purchaseTime",
    coalesce(receipt_ocr_results.confirmed_by, receipt_ocr_results.created_by)::text as "employeeId"
  from receipt_ocr_items
  join receipt_ocr_results on receipt_ocr_results.id = receipt_ocr_items.receipt_ocr_result_id
  where receipt_ocr_results.status = 'confirmed'
    and receipt_ocr_results.usage_type = 'shiire'
    and receipt_ocr_items.matched_product_id is not null
    and receipt_ocr_items.purchase_actual_id is null
    and coalesce(receipt_ocr_items.reconciliation_status, 'unmatched') not in ('auto_matched', 'manual_matched', 'ignored')
  order by receipt_ocr_results.purchase_date desc nulls last, receipt_ocr_items.line_index asc
`;

let autoMatched = 0;
let created = 0;
let skipped = 0;
let skippedSuspiciousDate = 0;

for (const row of rows) {
  const processed = autoMatched + created + skipped;
  if (processed > 0 && processed % 10 === 0) {
    console.log(JSON.stringify({ progress: processed, total: rows.length, autoMatched, created, skipped, skippedSuspiciousDate }));
  }

  const quantity = toNumber(row.quantity, 0);
  const amount = toNumber(row.amount, 0);
  const unitPrice = toNumber(row.unitPrice, 0) || (quantity > 0 && amount > 0 ? Math.round((amount / quantity) * 100) / 100 : 0);
  const purchaseDateCheck = validateReceiptPurchaseDate(row.purchaseDate);
  if (!purchaseDateCheck.date) {
    skipped += 1;
    skippedSuspiciousDate += 1;
    console.log(JSON.stringify({
      skippedSuspiciousDate: String(row.itemId),
      rawPurchaseDate: String(row.purchaseDate ?? ""),
      reason: purchaseDateCheck.reason
    }));
    continue;
  }
  const item = {
    itemId: String(row.itemId),
    rawName: String(row.rawName ?? ""),
    productId: String(row.productId ?? ""),
    quantity,
    unit: String(row.unit || "個").trim() || "個",
    unitPrice,
    amount,
    storeId: String(row.storeId ?? ""),
    supplierId: String(row.supplierId ?? ""),
    supplierLocationId: String(row.supplierLocationId ?? ""),
    supplierName: String(row.supplierName ?? ""),
    purchaseDate: purchaseDateCheck.date,
    purchaseTime: String(row.purchaseTime ?? ""),
    employeeId: String(row.employeeId ?? "")
  };

  if (!item.itemId || !item.productId || !item.storeId || item.unitPrice <= 0) {
    skipped += 1;
    continue;
  }

  const existingActualId = await findExistingActual(item);
  if (existingActualId) {
    await updateExistingActual(item, existingActualId);
    await recordPrice(item);
    autoMatched += 1;
    continue;
  }

  const createdActualId = await createReceiptBackfilledActual(item);
  if (createdActualId) {
    await recordPrice(item);
    created += 1;
  } else {
    skipped += 1;
  }
}

console.log(JSON.stringify({ scanned: rows.length, autoMatched, created, skipped, skippedSuspiciousDate }, null, 2));
