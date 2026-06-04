import { requireOsSession } from "../../../../lib/api-auth";
import { createPickupCode } from "../../../../lib/customer-orders";
import { sql } from "../../../../lib/db";
import { syncWebReservationToSalesOrder } from "../../../../lib/sales-orders";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type PosCheckoutItemInput = {
  menuCatalogItemId?: string;
  quantity?: number;
};

type PosCheckoutBody = {
  storeId?: string;
  orderType?: string;
  paymentMethod?: string;
  note?: string;
  items?: PosCheckoutItemInput[];
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function toPositiveInt(value: unknown, fallback = 1) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return fallback;
  return Math.max(1, Math.min(99, Math.floor(nextValue)));
}

function getJstParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const [pickupDate, pickupTime] = formatter.format(date).replace(" ", "T").split("T");
  return { pickupDate, pickupTime };
}

async function getSelectedStoreId(request: Request, session: Awaited<ReturnType<typeof requireOsSession>>) {
  if (!session) return { access: null, selectedStoreId: "", forbidden: false };
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { access, selectedStoreId: "", forbidden: true };
  return { access, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
}

async function getPosMenu(selectedStoreId: string) {
  if (!selectedStoreId) return { brands: [], categories: [], items: [] };

  const [brands, categories, items] = await Promise.all([
    sql`
      select brands.id::text, brands.name
      from brands
      join store_brands on store_brands.brand_id = brands.id
      where store_brands.store_id = ${selectedStoreId}
        and brands.status = 'active'
      order by brands.name
    `,
    sql`
      select
        menu_categories.id::text,
        menu_categories.brand_id::text as "brandId",
        menu_categories.name,
        menu_categories.sort_order as "sortOrder"
      from menu_categories
      join store_brands
        on store_brands.brand_id = menu_categories.brand_id
        and store_brands.store_id = ${selectedStoreId}
      join brands on brands.id = menu_categories.brand_id
      where menu_categories.store_id is null
        and brands.status = 'active'
      order by brands.name, menu_categories.sort_order, menu_categories.name
    `,
    sql`
      select
        menu_catalog_items.id::text,
        menu_catalog_items.brand_id::text as "brandId",
        brands.name as "brandName",
        menu_catalog_items.name,
        coalesce(menu_catalog_items.category, '未分類') as category,
        coalesce(menu_catalog_items.image_url, '') as "imageUrl",
        menu_catalog_items.base_price::float as "basePrice",
        menu_store_settings.price_override::float as "priceOverride",
        coalesce(menu_store_settings.is_available, true) as "isAvailable"
      from menu_catalog_items
      join brands on brands.id = menu_catalog_items.brand_id
      join store_brands
        on store_brands.brand_id = menu_catalog_items.brand_id
        and store_brands.store_id = ${selectedStoreId}
      left join menu_store_settings
        on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
        and menu_store_settings.store_id = ${selectedStoreId}
      left join menu_categories
        on menu_categories.brand_id = menu_catalog_items.brand_id
        and menu_categories.store_id is null
        and menu_categories.name = coalesce(nullif(menu_catalog_items.category, ''), '未分類')
      where menu_catalog_items.is_active = true
        and menu_catalog_items.store_id is null
        and coalesce(menu_store_settings.pos_enabled, true) = true
        and coalesce(menu_store_settings.is_available, true) = true
      order by brands.name, coalesce(menu_categories.sort_order, 9999), menu_catalog_items.sort_order, menu_catalog_items.name
    `
  ]);

  return { brands, categories, items };
}

async function getTodaySummary(selectedStoreId: string) {
  if (!selectedStoreId) return { orderCount: 0, total: 0, average: 0, latestOrders: [] };

  const rows = await sql`
    select
      count(*)::int as "orderCount",
      coalesce(sum(amount), 0)::int as total
    from store_customer_orders
    where store_id::text = ${selectedStoreId}
      and order_source = 'store_pos'
      and created_at >= (date_trunc('day', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo')
      and created_at < ((date_trunc('day', now() at time zone 'Asia/Tokyo') + interval '1 day') at time zone 'Asia/Tokyo')
      and status <> 'cancelled'
  `;
  const latestOrders = await sql`
    select
      id::text,
      pickup_code as "pickupCode",
      amount,
      payment_provider as "paymentMethod",
      to_char(created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime"
    from store_customer_orders
    where store_id::text = ${selectedStoreId}
      and order_source = 'store_pos'
    order by created_at desc
    limit 8
  `;
  const summary = rows[0] as { orderCount: number; total: number } | undefined;
  const orderCount = Number(summary?.orderCount ?? 0);
  const total = Number(summary?.total ?? 0);
  return {
    orderCount,
    total,
    average: orderCount ? Math.round(total / orderCount) : 0,
    latestOrders
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await getSelectedStoreId(request, session);
  if (forbidden) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const [menu, todaySummary] = await Promise.all([
    getPosMenu(selectedStoreId),
    getTodaySummary(selectedStoreId)
  ]);

  return Response.json({
    access,
    selectedStoreId,
    ...menu,
    todaySummary
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as PosCheckoutBody;
  const storeId = normalizeText(body.storeId);
  const orderType = normalizeText(body.orderType) || "eat_in";
  const paymentMethod = normalizeText(body.paymentMethod) || "cash";
  const note = normalizeText(body.note);
  const cartItems = Array.isArray(body.items) ? body.items : [];

  if (!storeId || cartItems.length === 0) {
    return Response.json({ error: "店舗と商品を選択してください。" }, { status: 400 });
  }

  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId);
  if (storeFilter === "__forbidden__" || !storeFilter) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const requestedIds = Array.from(new Set(cartItems.map((item) => normalizeText(item.menuCatalogItemId)).filter(Boolean)));
  if (requestedIds.length === 0) {
    return Response.json({ error: "商品を選択してください。" }, { status: 400 });
  }

  const menuRows = await sql`
    select
      menu_catalog_items.id::text,
      menu_catalog_items.brand_id::text as "brandId",
      menu_catalog_items.name,
      coalesce(menu_catalog_items.category, '') as category,
      coalesce(menu_store_settings.price_override, menu_catalog_items.base_price, 0)::int as price
    from menu_catalog_items
    join store_brands
      on store_brands.brand_id = menu_catalog_items.brand_id
      and store_brands.store_id = ${storeId}
    left join menu_store_settings
      on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
      and menu_store_settings.store_id = ${storeId}
    where menu_catalog_items.id::text = any(${requestedIds})
      and menu_catalog_items.is_active = true
      and menu_catalog_items.store_id is null
      and coalesce(menu_store_settings.pos_enabled, true) = true
      and coalesce(menu_store_settings.is_available, true) = true
  `;
  const menuById = new Map((menuRows as Array<{ id: string; brandId: string; name: string; price: number }>).map((item) => [item.id, item]));

  const normalizedItems = cartItems.map((item) => {
    const menuItem = menuById.get(normalizeText(item.menuCatalogItemId));
    if (!menuItem) return null;
    const quantity = toPositiveInt(item.quantity);
    const unitPrice = Number(menuItem.price ?? 0);
    return { ...menuItem, quantity, unitPrice, amount: unitPrice * quantity };
  }).filter(Boolean) as Array<{ id: string; brandId: string; name: string; quantity: number; unitPrice: number; amount: number }>;

  if (normalizedItems.length === 0) {
    return Response.json({ error: "POS で販売できる商品がありません。" }, { status: 400 });
  }

  const amount = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const { pickupDate, pickupTime } = getJstParts();
  const pickupCode = createPickupCode("P");
  const brandId = normalizedItems[0]?.brandId ?? null;
  const firstItemName = normalizedItems[0]?.name ?? "";

  const orderRows = await sql`
    insert into store_customer_orders (
      brand_id,
      store_id,
      order_source,
      pickup_code,
      status,
      payment_status,
      payment_provider,
      pickup_date,
      pickup_time,
      amount,
      currency,
      customer_summary,
      drink,
      paid_at,
      completed_at,
      payment_updated_at,
      updated_at
    )
    values (
      ${brandId},
      ${storeId},
      'store_pos',
      ${pickupCode},
      'completed',
      'paid',
      ${paymentMethod},
      ${pickupDate},
      ${pickupTime},
      ${amount},
      'JPY',
      ${JSON.stringify({ orderType, note, cashierId: session.id, cashierName: session.name, itemCount: normalizedItems.reduce((sum, item) => sum + item.quantity, 0) })},
      ${firstItemName},
      now(),
      now(),
      now(),
      now()
    )
    returning id::text
  `;
  const orderId = orderRows[0]?.id as string | undefined;
  if (!orderId) return Response.json({ error: "会計を保存できませんでした。" }, { status: 500 });

  for (let index = 0; index < normalizedItems.length; index += 1) {
    const item = normalizedItems[index];
    await sql`
      insert into store_customer_order_items (
        order_id,
        menu_catalog_item_id,
        item_name,
        quantity,
        amount,
        sort_order
      )
      values (
        ${orderId},
        ${item.id},
        ${item.name},
        ${item.quantity},
        ${item.amount},
        ${index}
      )
    `;
  }

  await syncWebReservationToSalesOrder(orderId);
  const todaySummary = await getTodaySummary(storeId);
  return Response.json({ ok: true, orderId, pickupCode, amount, todaySummary });
}
