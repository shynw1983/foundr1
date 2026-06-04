import { requireOsSession } from "../../../../lib/api-auth";
import { createPickupCode } from "../../../../lib/customer-orders";
import { sql } from "../../../../lib/db";
import { syncWebReservationToSalesOrder } from "../../../../lib/sales-orders";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type PosCheckoutItemInput = {
  menuCatalogItemId?: string;
  quantity?: number;
  selectedOptions?: Array<{
    groupId?: string;
    optionIds?: string[];
  }>;
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

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function getAllowedRuleKey(groupKey: string) {
  const ruleKeys: Record<string, string> = {
    size: "allowedSizes",
    temperature: "temperatures",
    sweetness: "allowedSweetness",
    ice: "allowedIce",
    option: "allowedOptions",
    topping: "allowedToppings"
  };
  return ruleKeys[groupKey] ?? `allowed_${groupKey}`;
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
  if (!selectedStoreId) return { brands: [], categories: [], items: [], optionGroups: [] };

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
        menu_catalog_items.variable_schema as "variableSchema",
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

  const itemIds = (items as Array<{ id: string }>).map((item) => item.id);
  const optionGroups = itemIds.length
    ? await sql`
      select
        menu_option_groups.id::text,
        menu_option_groups.brand_id::text as "brandId",
        coalesce(menu_option_groups.menu_catalog_item_id::text, '') as "menuCatalogItemId",
        menu_option_groups.group_key as "groupKey",
        menu_option_groups.name,
        menu_option_groups.selection_type as "selectionType",
        menu_option_groups.sort_order as "sortOrder",
        coalesce(
          json_agg(
            json_build_object(
              'id', menu_options.id::text,
              'optionKey', menu_options.option_key,
              'name', menu_options.name,
              'priceDelta', menu_options.price_delta::float,
              'sortOrder', menu_options.sort_order
            )
            order by menu_options.sort_order, menu_options.name
          ) filter (where menu_options.id is not null),
          '[]'::json
        ) as options
      from menu_option_groups
      join store_brands
        on store_brands.brand_id = menu_option_groups.brand_id
        and store_brands.store_id = ${selectedStoreId}
      left join menu_options
        on menu_options.option_group_id = menu_option_groups.id
        and menu_options.is_active = true
      left join menu_option_store_settings
        on menu_option_store_settings.menu_option_id = menu_options.id
        and menu_option_store_settings.store_id = ${selectedStoreId}
      where menu_option_groups.is_active = true
        and (
          menu_option_groups.menu_catalog_item_id is null
          or menu_option_groups.menu_catalog_item_id::text = any(${itemIds})
        )
        and coalesce(menu_option_store_settings.is_available, true) = true
      group by menu_option_groups.id
      order by menu_option_groups.sort_order, menu_option_groups.name
    `
    : [];

  return { brands, categories, items, optionGroups };
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
      menu_catalog_items.variable_schema as "variableSchema",
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
  const menuById = new Map((menuRows as Array<{ id: string; brandId: string; name: string; price: number; variableSchema: Record<string, unknown> }>).map((item) => [item.id, item]));
  const optionRows = await sql`
    select
      menu_options.id::text,
      menu_options.option_key as "optionKey",
      menu_options.name,
      coalesce(menu_options.price_delta, 0)::int as "priceDelta",
      menu_option_groups.id::text as "groupId",
      menu_option_groups.brand_id::text as "brandId",
      coalesce(menu_option_groups.menu_catalog_item_id::text, '') as "menuCatalogItemId",
      menu_option_groups.group_key as "groupKey",
      menu_option_groups.name as "groupName",
      menu_option_groups.selection_type as "selectionType"
    from menu_options
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    join store_brands
      on store_brands.brand_id = menu_option_groups.brand_id
      and store_brands.store_id = ${storeId}
    left join menu_option_store_settings
      on menu_option_store_settings.menu_option_id = menu_options.id
      and menu_option_store_settings.store_id = ${storeId}
    where menu_options.is_active = true
      and menu_option_groups.is_active = true
      and coalesce(menu_option_store_settings.is_available, true) = true
      and (
        menu_option_groups.menu_catalog_item_id is null
        or menu_option_groups.menu_catalog_item_id::text = any(${requestedIds})
      )
  `;
  const optionsById = new Map((optionRows as Array<{
    id: string;
    optionKey: string;
    name: string;
    priceDelta: number;
    groupId: string;
    brandId: string;
    menuCatalogItemId: string;
    groupKey: string;
    groupName: string;
    selectionType: string;
  }>).map((option) => [option.id, option]));

  const normalizedItems = cartItems.map((item) => {
    const menuItem = menuById.get(normalizeText(item.menuCatalogItemId));
    if (!menuItem) return null;
    const quantity = toPositiveInt(item.quantity);
    const unitPrice = Number(menuItem.price ?? 0);
    const selectedOptions = Array.isArray(item.selectedOptions) ? item.selectedOptions : [];
    const selected = selectedOptions.flatMap((group) => asStringArray(group.optionIds).map((optionId) => optionsById.get(optionId)).filter(Boolean)) as Array<NonNullable<ReturnType<typeof optionsById.get>>>;
    const validSelected = selected.filter((option) => {
      if (option.brandId !== menuItem.brandId) return false;
      if (option.menuCatalogItemId && option.menuCatalogItemId !== menuItem.id) return false;
      const allowedKeys = asStringArray(menuItem.variableSchema?.[getAllowedRuleKey(option.groupKey)]);
      if (!allowedKeys.length) return true;
      return allowedKeys.includes(option.optionKey) || allowedKeys.includes(option.name);
    });
    const optionTotal = validSelected.reduce((sum, option) => sum + Number(option.priceDelta ?? 0), 0);
    return { ...menuItem, quantity, unitPrice, selectedOptions: validSelected, amount: (unitPrice + optionTotal) * quantity };
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
      ${JSON.stringify({
        orderType,
        note,
        cashierId: session.id,
        cashierName: session.name,
        itemCount: normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
        items: normalizedItems.map((item) => ({
          menuCatalogItemId: item.id,
          name: item.name,
          quantity: item.quantity,
          options: "selectedOptions" in item ? item.selectedOptions : []
        }))
      })},
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
    const selectedOptions = "selectedOptions" in item ? item.selectedOptions as Array<{
      optionKey: string;
      name: string;
      groupKey: string;
      groupName: string;
    }> : [];
    const groupLabels = new Map<string, string[]>();
    for (const option of selectedOptions) {
      const labels = groupLabels.get(option.groupKey) ?? [];
      labels.push(option.name);
      groupLabels.set(option.groupKey, labels);
    }
    const sizeLabel = groupLabels.get("size")?.join(", ") ?? "";
    const temperature = groupLabels.get("temperature")?.join(", ") ?? "";
    const sweetness = groupLabels.get("sweetness")?.join(", ") ?? "";
    const ice = groupLabels.get("ice")?.join(", ") ?? "";
    const optionLabels = selectedOptions
      .filter((option) => !["size", "temperature", "sweetness", "ice", "topping"].includes(option.groupKey))
      .map((option) => option.name);
    const toppingOptions = selectedOptions.filter((option) => option.groupKey === "topping" || !["size", "temperature", "sweetness", "ice", "option"].includes(option.groupKey));
    await sql`
      insert into store_customer_order_items (
        order_id,
        menu_catalog_item_id,
        item_name,
        size_key,
        size_label,
        temperature,
        sweetness,
        ice,
        option_key,
        option_label,
        topping_keys,
        topping_labels,
        quantity,
        amount,
        sort_order
      )
      values (
        ${orderId},
        ${item.id},
        ${item.name},
        ${selectedOptions.filter((option) => option.groupKey === "size").map((option) => option.optionKey).join(",")},
        ${sizeLabel},
        ${temperature},
        ${sweetness},
        ${ice},
        ${optionLabels.join(",")},
        ${optionLabels.join(", ")},
        ${toppingOptions.map((option) => option.optionKey)},
        ${toppingOptions.map((option) => option.name)},
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
