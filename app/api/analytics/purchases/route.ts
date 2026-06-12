import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

type PurchaseAnalyticsRow = {
  itemId: string;
  orderNo: string;
  storeId: string;
  storeName: string;
  brandName: string;
  productId: string;
  productName: string;
  category: string;
  subcategory: string;
  supplier: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  purchasedAt: string;
  purchasedDate: string;
};

function getCurrentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function isMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function getMonthRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const startUtc = new Date(`${month}-01T00:00:00+09:00`);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const endUtc = new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+09:00`);
  return { startUtc, endUtc };
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

function normalizeNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function groupPurchaseRows(rows: PurchaseAnalyticsRow[]) {
  const productMap = new Map<string, {
    productId: string;
    productName: string;
    category: string;
    subcategory: string;
    supplier: string;
    quantity: number;
    unit: string;
    amount: number;
    orderCount: number;
    storeCount: number;
    averageUnitPrice: number;
  } & { orderIds: Set<string>; storeIds: Set<string> }>();
  const categoryMap = new Map<string, { category: string; quantity: number; amount: number; itemCount: number }>();
  const supplierMap = new Map<string, { supplier: string; quantity: number; amount: number; itemCount: number }>();
  const storeMap = new Map<string, { storeId: string; storeName: string; quantity: number; amount: number; itemCount: number }>();

  rows.forEach((row) => {
    const productKey = `${row.productId || row.productName}::${row.unit}`;
    const product = productMap.get(productKey) ?? {
      productId: row.productId,
      productName: row.productName,
      category: row.category,
      subcategory: row.subcategory,
      supplier: row.supplier,
      quantity: 0,
      unit: row.unit,
      amount: 0,
      orderCount: 0,
      storeCount: 0,
      averageUnitPrice: 0,
      orderIds: new Set<string>(),
      storeIds: new Set<string>()
    };
    product.quantity += row.quantity;
    product.amount += row.amount;
    product.orderIds.add(row.orderNo);
    product.storeIds.add(row.storeId);
    if (!product.supplier && row.supplier) product.supplier = row.supplier;
    productMap.set(productKey, product);

    const category = categoryMap.get(row.category) ?? { category: row.category, quantity: 0, amount: 0, itemCount: 0 };
    category.quantity += row.quantity;
    category.amount += row.amount;
    category.itemCount += 1;
    categoryMap.set(row.category, category);

    const supplier = supplierMap.get(row.supplier) ?? { supplier: row.supplier, quantity: 0, amount: 0, itemCount: 0 };
    supplier.quantity += row.quantity;
    supplier.amount += row.amount;
    supplier.itemCount += 1;
    supplierMap.set(row.supplier, supplier);

    const store = storeMap.get(row.storeId) ?? { storeId: row.storeId, storeName: row.storeName, quantity: 0, amount: 0, itemCount: 0 };
    store.quantity += row.quantity;
    store.amount += row.amount;
    store.itemCount += 1;
    storeMap.set(row.storeId, store);
  });

  const productRows = Array.from(productMap.values())
    .map((row) => ({
      productId: row.productId,
      productName: row.productName,
      category: row.category,
      subcategory: row.subcategory,
      supplier: row.supplier,
      quantity: Math.round(row.quantity * 100) / 100,
      unit: row.unit,
      amount: Math.round(row.amount),
      orderCount: row.orderIds.size,
      storeCount: row.storeIds.size,
      averageUnitPrice: row.quantity > 0 ? Math.round((row.amount / row.quantity) * 100) / 100 : 0
    }))
    .sort((left, right) => right.amount - left.amount || right.quantity - left.quantity || left.productName.localeCompare(right.productName, "ja"));

  return {
    productRows,
    categoryRows: Array.from(categoryMap.values()).map((row) => ({
      ...row,
      quantity: Math.round(row.quantity * 100) / 100,
      amount: Math.round(row.amount)
    })).sort((left, right) => right.amount - left.amount),
    supplierRows: Array.from(supplierMap.values()).map((row) => ({
      ...row,
      quantity: Math.round(row.quantity * 100) / 100,
      amount: Math.round(row.amount)
    })).sort((left, right) => right.amount - left.amount),
    storeRows: Array.from(storeMap.values()).map((row) => ({
      ...row,
      quantity: Math.round(row.quantity * 100) / 100,
      amount: Math.round(row.amount)
    })).sort((left, right) => right.amount - left.amount)
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month") ?? getCurrentMonth();
  const month = isMonth(monthParam) ? monthParam : getCurrentMonth();
  const scope = await getSessionStoreScope(session);
  const stores = await getVisibleStores(scope.allStores, scope.storeIds);
  const visibleStoreIds = stores.map((store) => String(store.id));
  const requestedStoreId = url.searchParams.get("storeId") ?? "all";
  const selectedStoreId = requestedStoreId === "all"
    ? "all"
    : visibleStoreIds.includes(requestedStoreId)
      ? requestedStoreId
      : "all";
  const { startUtc, endUtc } = getMonthRange(month);

  const rawRows = visibleStoreIds.length > 0 ? await sql`
    with purchase_source_rows as (
      select
        purchase_order_items.id::text as "itemId",
        purchase_orders.order_no as "orderNo",
        purchase_orders.store_id::text as "storeId",
        stores.name as "storeName",
        coalesce(brands.name, '') as "brandName",
        coalesce(products.id::text, '') as "productId",
        coalesce(nullif(purchase_order_items.temporary_product_name, ''), products.name, '臨時購入品') as "productName",
        coalesce(nullif(products.category, ''), '未分類') as category,
        coalesce(nullif(products.subcategory, ''), '未分類') as subcategory,
        coalesce(suppliers.name, selected_suppliers.name, '') as supplier,
        coalesce(purchase_actuals.actual_quantity::float, purchase_order_items.actual_quantity::float, purchase_order_items.requested_quantity::float, 0) as quantity,
        coalesce(nullif(purchase_actuals.actual_unit, ''), nullif(purchase_order_items.requested_unit, ''), nullif(purchase_order_items.temporary_product_unit, ''), products.unit, '個') as unit,
        coalesce(purchase_actuals.actual_price::float, purchase_order_items.actual_price::float, 0) as "unitPrice",
        purchase_actuals.recorded_at as "purchasedAt"
      from purchase_actuals
      join purchase_order_items on purchase_order_items.id = purchase_actuals.purchase_order_item_id
      join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
      join stores on stores.id = purchase_orders.store_id
      left join products on products.id = purchase_order_items.product_id
      left join brands on brands.id = purchase_order_items.brand_id
      left join suppliers on suppliers.id = purchase_actuals.supplier_id
      left join suppliers selected_suppliers on selected_suppliers.id = purchase_order_items.selected_supplier_id
      where purchase_actuals.recorded_at >= ${startUtc}
        and purchase_actuals.recorded_at < ${endUtc}
        and purchase_orders.store_id::text = any(${visibleStoreIds})
        and (${selectedStoreId} = 'all' or purchase_orders.store_id::text = ${selectedStoreId})

      union all

      select
        purchase_order_items.id::text as "itemId",
        purchase_orders.order_no as "orderNo",
        purchase_orders.store_id::text as "storeId",
        stores.name as "storeName",
        coalesce(brands.name, '') as "brandName",
        coalesce(products.id::text, '') as "productId",
        coalesce(nullif(purchase_order_items.temporary_product_name, ''), products.name, '臨時購入品') as "productName",
        coalesce(nullif(products.category, ''), '未分類') as category,
        coalesce(nullif(products.subcategory, ''), '未分類') as subcategory,
        coalesce(selected_suppliers.name, '') as supplier,
        coalesce(purchase_order_items.actual_quantity::float, purchase_order_items.requested_quantity::float, 0) as quantity,
        coalesce(nullif(purchase_order_items.requested_unit, ''), nullif(purchase_order_items.temporary_product_unit, ''), products.unit, '個') as unit,
        coalesce(purchase_order_items.actual_price::float, 0) as "unitPrice",
        coalesce(purchase_orders.deadline_at, purchase_orders.updated_at) as "purchasedAt"
      from purchase_order_items
      join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
      join stores on stores.id = purchase_orders.store_id
      left join products on products.id = purchase_order_items.product_id
      left join brands on brands.id = purchase_order_items.brand_id
      left join suppliers selected_suppliers on selected_suppliers.id = purchase_order_items.selected_supplier_id
      where purchase_order_items.status in ('purchased', 'in_delivery', 'delivered', 'received')
        and coalesce(purchase_orders.deadline_at, purchase_orders.updated_at) >= ${startUtc}
        and coalesce(purchase_orders.deadline_at, purchase_orders.updated_at) < ${endUtc}
        and purchase_orders.store_id::text = any(${visibleStoreIds})
        and (${selectedStoreId} = 'all' or purchase_orders.store_id::text = ${selectedStoreId})
        and not exists (
          select 1
          from purchase_actuals
          where purchase_actuals.purchase_order_item_id = purchase_order_items.id
        )
    )
    select
      *,
      ("quantity" * "unitPrice")::float as amount,
      to_char("purchasedAt" at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as "purchasedDate"
    from purchase_source_rows
    where quantity > 0
    order by amount desc, "productName" asc
  ` : [];

  const rows: PurchaseAnalyticsRow[] = rawRows.map((row) => ({
    itemId: String(row.itemId),
    orderNo: String(row.orderNo),
    storeId: String(row.storeId),
    storeName: String(row.storeName),
    brandName: String(row.brandName ?? ""),
    productId: String(row.productId ?? ""),
    productName: normalizeText(row.productName, "臨時購入品"),
    category: normalizeText(row.category, "未分類"),
    subcategory: normalizeText(row.subcategory, "未分類"),
    supplier: normalizeText(row.supplier, "未設定"),
    quantity: Math.round(normalizeNumber(row.quantity) * 100) / 100,
    unit: normalizeText(row.unit, "個"),
    unitPrice: Math.round(normalizeNumber(row.unitPrice) * 100) / 100,
    amount: Math.round(normalizeNumber(row.amount)),
    purchasedAt: row.purchasedAt ? new Date(String(row.purchasedAt)).toISOString() : "",
    purchasedDate: String(row.purchasedDate ?? "")
  }));
  const grouped = groupPurchaseRows(rows);
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const orderCount = new Set(rows.map((row) => row.orderNo)).size;

  return Response.json({
    month,
    stores,
    selectedStoreId,
    summary: {
      totalAmount: Math.round(totalAmount),
      totalQuantity: Math.round(totalQuantity * 100) / 100,
      itemCount: rows.length,
      productCount: grouped.productRows.length,
      orderCount
    },
    ...grouped,
    rows
  });
}
