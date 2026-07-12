import { createPickupCode, findCustomerOrderById } from "../../../../../lib/customer-orders";
import { sql } from "../../../../../lib/db";
import { publishCustomerOrderEvent } from "../../../../../lib/order-realtime";

export const dynamic = "force-dynamic";

type TableOrderItemInput = {
  menuCatalogItemId?: string;
  quantity?: number;
  selectedOptions?: Array<{
    groupId?: string;
    optionIds?: string[];
  }>;
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

function getEffectiveSelectionType(group: { groupKey: string; selectionType: string }) {
  if (["size", "temperature", "sweetness", "ice", "option"].includes(group.groupKey)) return "single";
  if (group.groupKey === "topping") return "multiple";
  return group.selectionType || "single";
}

function getOptionGroupLimit(ruleJson: Record<string, unknown>, fallback: number) {
  const limit = Number(ruleJson?.limit);
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(0, Math.floor(limit));
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { token?: string; visitKey?: string; items?: TableOrderItemInput[]; note?: string };
  const token = normalizeText(body.token);
  const visitKey = normalizeText(body.visitKey);
  const cartItems = Array.isArray(body.items) ? body.items : [];
  if (!token || !/^[a-zA-Z0-9-]{16,80}$/.test(visitKey) || cartItems.length === 0) {
    return Response.json({ error: "注文する商品を選択してください。" }, { status: 400 });
  }

  const tableRows = await sql`
    select
      store_tables.id::text as "tableId",
      coalesce(nullif(store_tables.display_name, ''), store_tables.label) as "tableDisplayName",
      store_tables.label as "tableLabel",
      store_tables.table_ordering_enabled as "tableOrderingEnabled",
      stores.id::text as "storeId",
      stores.name as "storeName",
      coalesce(brands.id::text, fallback_brands.id::text, '') as "brandId",
      coalesce(brands.name, fallback_brands.name, '') as "brandName",
      coalesce(pos_store_settings.dine_in_enabled, true) as "dineInEnabled"
    from store_tables
    join stores on stores.id = store_tables.store_id
    left join brands on brands.id = store_tables.brand_id
    left join lateral (
      select brand_candidates.id, brand_candidates.name
      from (
        select brands.id, brands.name, count(*) over() as brand_count
        from store_brands
        join brands on brands.id = store_brands.brand_id
        where store_brands.store_id = stores.id
          and brands.status = 'active'
      ) brand_candidates
      where brand_candidates.brand_count = 1
      limit 1
    ) fallback_brands on true
    left join pos_store_settings on pos_store_settings.store_id = stores.id
    where store_tables.qr_token = ${token}
      and store_tables.status = 'active'
      and stores.status = 'active'
      and (brands.id is null or brands.status = 'active')
    limit 1
  `;
  const table = tableRows[0] as {
    tableId: string;
    tableDisplayName: string;
    tableLabel: string;
    tableOrderingEnabled: boolean;
    storeId: string;
    storeName: string;
    brandId: string;
    brandName: string;
    dineInEnabled: boolean;
  } | undefined;
  if (!table) return Response.json({ error: "このテーブルでは現在注文できません。" }, { status: 404 });
  if (!table.tableOrderingEnabled || !table.dineInEnabled) {
    return Response.json({ error: "このテーブルでは現在注文できません。" }, { status: 400 });
  }
  const allowedBrandRows = table.brandId
    ? [{ brandId: table.brandId }]
    : await sql`
        select brands.id::text as "brandId"
        from store_brands
        join brands on brands.id = store_brands.brand_id
        where store_brands.store_id::text = ${table.storeId}
          and brands.status = 'active'
        order by brands.name
      `;
  const allowedBrandIds = allowedBrandRows.map((row) => String(row.brandId)).filter(Boolean);
  if (!allowedBrandIds.length) return Response.json({ error: "このテーブルでは現在注文できません。" }, { status: 404 });

  const requestedIds = Array.from(new Set(cartItems.map((item) => normalizeText(item.menuCatalogItemId)).filter(Boolean)));
  if (!requestedIds.length) return Response.json({ error: "商品を選択してください。" }, { status: 400 });

  const menuRows = await sql`
    select
      menu_catalog_items.id::text,
      menu_catalog_items.brand_id::text as "brandId",
      menu_catalog_items.name,
      coalesce(menu_catalog_items.item_kind, '') as "itemKind",
      coalesce(menu_catalog_items.category, '') as category,
      menu_catalog_items.variable_schema as "variableSchema",
      coalesce(menu_store_settings.price_override, menu_catalog_items.base_price, 0)::int as price
    from menu_catalog_items
    join store_brands
      on store_brands.brand_id = menu_catalog_items.brand_id
      and store_brands.store_id = ${table.storeId}
    left join menu_store_settings
      on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
      and menu_store_settings.store_id = ${table.storeId}
    where menu_catalog_items.id::text = any(${requestedIds})
      and menu_catalog_items.brand_id::text = any(${allowedBrandIds})
      and menu_catalog_items.is_active = true
      and menu_catalog_items.store_id is null
      and menu_catalog_items.item_kind = 'fixed_product'
      and coalesce(menu_store_settings.pos_enabled, true) = true
      and coalesce(menu_store_settings.table_order_enabled, true) = true
      and coalesce(menu_store_settings.is_available, true) = true
  `;
  const menuById = new Map((menuRows as Array<{
    id: string;
    brandId: string;
    name: string;
    itemKind: string;
    category: string;
    variableSchema: Record<string, unknown>;
    price: number;
  }>).map((item) => [item.id, item]));

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
      menu_option_groups.selection_type as "selectionType",
      menu_option_groups.rule_json as "ruleJson"
    from menu_options
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    join store_brands
      on store_brands.brand_id = menu_option_groups.brand_id
      and store_brands.store_id = ${table.storeId}
    left join menu_option_store_settings
      on menu_option_store_settings.menu_option_id = menu_options.id
      and menu_option_store_settings.store_id = ${table.storeId}
    where menu_options.is_active = true
      and menu_option_groups.is_active = true
      and menu_option_groups.brand_id::text = any(${allowedBrandIds})
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
    ruleJson: Record<string, unknown>;
  }>).map((option) => [option.id, option]));

  let normalizedItems: Array<{
    id: string;
    brandId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    selectedOptions: Array<NonNullable<ReturnType<typeof optionsById.get>>>;
  }> = [];
  try {
    normalizedItems = cartItems.map((item) => {
      const menuItem = menuById.get(normalizeText(item.menuCatalogItemId));
      if (!menuItem) throw new Error("売り切れ、または注文できない商品が含まれています。");
      const quantity = toPositiveInt(item.quantity);
      const selectedOptions = Array.isArray(item.selectedOptions) ? item.selectedOptions : [];
      const selected = selectedOptions.flatMap((group) => asStringArray(group.optionIds).map((optionId) => optionsById.get(optionId)).filter(Boolean)) as Array<NonNullable<ReturnType<typeof optionsById.get>>>;
      const validSelected = selected.filter((option) => {
        if (option.brandId !== menuItem.brandId) return false;
        if (option.menuCatalogItemId && option.menuCatalogItemId !== menuItem.id) return false;
        const allowedKeys = asStringArray(menuItem.variableSchema?.[getAllowedRuleKey(option.groupKey)]);
        if (!allowedKeys.length) return true;
        return allowedKeys.includes(option.optionKey) || allowedKeys.includes(option.name);
      });
      if (validSelected.length !== selected.length) {
        throw new Error("売り切れ、または注文できないオプションが含まれています。");
      }
      const groupedCounts = new Map<string, { count: number; optionIds: Set<string>; selectionType: string; limit: number; groupName: string }>();
      for (const option of validSelected) {
        const selectionType = getEffectiveSelectionType(option);
        const current = groupedCounts.get(option.groupId) ?? {
          count: 0,
          optionIds: new Set<string>(),
          selectionType,
          limit: getOptionGroupLimit(option.ruleJson, selectionType === "single" ? 1 : 99),
          groupName: option.groupName
        };
        current.count += 1;
        current.optionIds.add(option.id);
        groupedCounts.set(option.groupId, current);
      }
      for (const group of groupedCounts.values()) {
        if (group.selectionType === "single" && group.count > 1) throw new Error(`${group.groupName} は1つだけ選択できます。`);
        if (group.selectionType === "multiple" && group.optionIds.size !== group.count) throw new Error(`${group.groupName} は同じ選択肢を重複して選べません。`);
        if (group.count > group.limit) throw new Error(`${group.groupName} は最大${group.limit}点までです。`);
      }
      const optionTotal = validSelected.reduce((sum, option) => sum + Number(option.priceDelta ?? 0), 0);
      return {
        id: menuItem.id,
        brandId: menuItem.brandId,
        name: menuItem.name,
        quantity,
        unitPrice: Number(menuItem.price ?? 0),
        selectedOptions: validSelected,
        amount: (Number(menuItem.price ?? 0) + optionTotal) * quantity
      };
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "選択内容を確認してください。" }, { status: 400 });
  }

  const amount = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
  const { pickupDate, pickupTime } = getJstParts();
  const pickupCode = createPickupCode("M");
  const tableSessionKey = `${table.tableId}:${visitKey}`;
  const firstItemName = normalizedItems[0]?.name ?? "";
  const primaryBrandId = table.brandId || normalizedItems[0]?.brandId || "";
  const note = normalizeText(body.note).slice(0, 300);

  const orderRows = await sql`
    insert into store_customer_orders (
      brand_id,
      store_id,
      store_table_id,
      table_session_key,
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
      updated_at
    )
    values (
      ${primaryBrandId || null},
      ${table.storeId},
      ${table.tableId},
      ${tableSessionKey},
      'table_qr',
      ${pickupCode},
      'new',
      'unpaid',
      'table_qr',
      ${pickupDate},
      ${pickupTime},
      ${amount},
      'JPY',
      ${JSON.stringify({
        serviceType: "dine_in",
        orderSource: "table_qr",
        tableId: table.tableId,
        tableLabel: table.tableDisplayName || table.tableLabel,
        tableSessionKey,
        checkoutStatus: "requested",
        checkoutRequestType: "pay_at_counter",
        checkoutRequestedAt: new Date().toISOString(),
        paymentIntent: "pay_at_counter",
        note,
        subtotalAmount: amount,
        itemCount: normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
        items: normalizedItems.map((item) => ({
          menuCatalogItemId: item.id,
          name: item.name,
          quantity: item.quantity,
          options: item.selectedOptions.map((option) => ({
            id: option.id,
            groupKey: option.groupKey,
            groupName: option.groupName,
            optionKey: option.optionKey,
            name: option.name,
            priceDelta: option.priceDelta
          }))
        }))
      })},
      ${firstItemName},
      now()
    )
    returning id::text
  `;
  const orderId = orderRows[0]?.id as string | undefined;
  if (!orderId) return Response.json({ error: "注文を保存できませんでした。" }, { status: 500 });
  for (let index = 0; index < normalizedItems.length; index += 1) {
    const item = normalizedItems[index];
    const groupLabels = new Map<string, string[]>();
    for (const option of item.selectedOptions) {
      const labels = groupLabels.get(option.groupKey) ?? [];
      labels.push(option.name);
      groupLabels.set(option.groupKey, labels);
    }
    const sizeOptions = item.selectedOptions.filter((option) => option.groupKey === "size");
    const optionLabels = item.selectedOptions.filter((option) => option.groupKey === "option").map((option) => option.name);
    const toppingOptions = item.selectedOptions.filter((option) => option.groupKey === "topping" || !["size", "temperature", "sweetness", "ice", "option"].includes(option.groupKey));
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
        gross_amount,
        paid_amount,
        sort_order
      )
      values (
        ${orderId},
        ${item.id},
        ${item.name},
        ${sizeOptions.map((option) => option.optionKey).join(",")},
        ${groupLabels.get("size")?.join(", ") ?? ""},
        ${groupLabels.get("temperature")?.join(", ") ?? ""},
        ${groupLabels.get("sweetness")?.join(", ") ?? ""},
        ${groupLabels.get("ice")?.join(", ") ?? ""},
        ${optionLabels.join(",")},
        ${optionLabels.join(", ")},
        ${toppingOptions.map((option) => option.optionKey)},
        ${toppingOptions.map((option) => option.name)},
        ${item.quantity},
        ${item.amount},
        ${item.amount},
        0,
        ${index}
      )
    `;
  }

  await publishCustomerOrderEvent("order.created", await findCustomerOrderById(orderId));

  return Response.json({
    ok: true,
    orderId,
    pickupCode,
    amount,
    table: {
      id: table.tableId,
      label: table.tableDisplayName || table.tableLabel,
      storeName: table.storeName,
      brandName: table.brandName
    }
  }, { status: 201 });
}
