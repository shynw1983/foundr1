import { requireOsSession } from "../../../../../lib/api-auth";
import { findCustomerOrderById } from "../../../../../lib/customer-orders";
import { sql } from "../../../../../lib/db";
import { getKitchenBusinessDayWindow } from "../../../../../lib/kitchen-business-day";
import { buildKitchenDisplayItemGroups } from "../../../../../lib/kitchen-display-groups";
import { resolveKitchenDisplayAmounts } from "../../../../../lib/kitchen-display-pricing";
import { reconcileUberReadyCommand } from "../../../../../lib/local-bridge-commands";
import {
  existingMenuDisplayName,
  findMenuDisplayNameCandidate,
  type MenuDisplayNameCandidate
} from "../../../../../lib/menu-display-name-matcher";
import { localizeMaamaaCustomerLabel } from "../../../../../lib/maamaa-production-rules";
import { localizeMaamaaProductionSummary, setProductionTaskStatus } from "../../../../../lib/order-production";
import { publishCustomerOrderEvent } from "../../../../../lib/order-realtime";
import { normalizePosPrinterSettings, resolvePosKitchenTicketTemplate } from "../../../../../lib/pos-printer";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

type KitchenMenuCandidate = MenuDisplayNameCandidate & {
  brandId: string;
  kind: "item" | "option";
  optionKey?: string;
  basePrice?: number | null;
  priceDelta?: number | null;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getPreviousBusinessDayReference(businessDate: string) {
  const [year, month, day] = businessDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1, 3));
}

async function getKitchenTasks(storeId: string, area: string, businessHours: unknown, dayOffset: 0 | -1 = 0) {
  const currentBusinessDay = getKitchenBusinessDayWindow(businessHours);
  const businessDay = dayOffset === -1
    ? getKitchenBusinessDayWindow(businessHours, getPreviousBusinessDayReference(currentBusinessDay.businessDate))
    : currentBusinessDay;
  const includeCompleted = dayOffset === -1;
  const [rows, areas, settingsRows] = await Promise.all([sql`
    select
      order_production_tasks.id::text,
      order_production_tasks.order_id::text as "orderId",
      coalesce(order_production_tasks.brand_id::text, '') as "brandId",
      coalesce(brands.name, order_production_tasks.production_area_label, '') as "brandName",
      order_production_tasks.production_area as "productionArea",
      order_production_tasks.production_area_label as "productionAreaLabel",
      order_production_tasks.status,
      order_production_tasks.print_status as "printStatus",
      order_production_tasks.item_summary as "itemSummary",
      coalesce(order_production_tasks.started_at::text, '') as "startedAt",
      coalesce(store_customer_orders.estimated_prep_minutes, 0)::int as "estimatedPrepMinutes",
      coalesce(store_customer_orders.estimated_ready_at::text, '') as "estimatedReadyAt",
      store_customer_orders.pickup_code as "pickupCode",
      concat(
        store_customer_orders.pickup_date::text,
        'T',
        left(store_customer_orders.pickup_time, 5),
        ':00+09:00'
      ) as "scheduledAt",
      store_customer_orders.amount::int as amount,
      store_customer_orders.currency,
      coalesce(
        store_customer_orders.customer_summary #>> '{customer,name}',
        store_customer_orders.customer_summary ->> 'name',
        ''
      ) as "customerName",
      coalesce(store_customer_orders.customer_summary ->> 'diningSeatLabel', nullif(store_tables.display_name, ''), store_tables.label, '') as "tableLabel",
      store_customer_orders.order_source as "orderSource",
      store_customer_orders.payment_status as "paymentStatus",
      coalesce(store_customer_orders.customer_summary ->> 'orderType', '') as "orderType",
      coalesce(store_customer_orders.customer_summary ->> 'note', '') as note,
      store_customer_orders.customer_summary as "customerSummary",
      coalesce((
        select sum(store_customer_order_items.quantity)::int
        from store_customer_order_items
        where store_customer_order_items.order_id = store_customer_orders.id
          and coalesce(store_customer_order_items.refund_status, '') <> 'refunded'
      ), 0)::int as "itemCount",
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'itemName', store_customer_order_items.item_name,
            'menuItemId', store_customer_order_items.menu_catalog_item_id,
            'quantity', store_customer_order_items.quantity,
            'amount', store_customer_order_items.amount,
            'toppingKeys', store_customer_order_items.topping_keys,
            'toppingLabels', store_customer_order_items.topping_labels
          )
          order by store_customer_order_items.sort_order, store_customer_order_items.created_at
        )
        from store_customer_order_items
        left join menu_catalog_items on menu_catalog_items.id = store_customer_order_items.menu_catalog_item_id
        where store_customer_order_items.order_id = store_customer_orders.id
          and coalesce(store_customer_order_items.refund_status, '') <> 'refunded'
          and (
            order_production_tasks.brand_id is null
            or coalesce(menu_catalog_items.brand_id, store_customer_orders.brand_id) = order_production_tasks.brand_id
          )
      ), '[]'::jsonb) as "orderedItems",
      store_customer_orders.created_at::text as "createdAt"
    from order_production_tasks
    join store_customer_orders on store_customer_orders.id = order_production_tasks.order_id
    left join store_tables on store_tables.id = store_customer_orders.store_table_id
    left join brands on brands.id = order_production_tasks.brand_id
    where order_production_tasks.store_id::text = ${storeId}
      and store_customer_orders.payment_status in ('paid', 'partial_refunded')
      and (
        ${includeCompleted} = true
        or store_customer_orders.status not in ('completed', 'cancelled', 'refund_pending')
      )
      and store_customer_orders.status not in ('cancelled', 'refund_pending')
      and order_production_tasks.status in ('new', 'preparing', 'ready')
      and (
        concat(
          store_customer_orders.pickup_date::text,
          'T',
          left(store_customer_orders.pickup_time, 5)
        ) between ${businessDay.startAt} and ${businessDay.endAt}
        or (
          store_customer_orders.created_at at time zone 'Asia/Tokyo'
        ) between ${businessDay.startAt}::timestamp and ${businessDay.endAt}::timestamp
      )
      and (${area} = '' or order_production_tasks.production_area = ${area})
    order by
      store_customer_orders.pickup_date asc,
      left(store_customer_orders.pickup_time, 5) asc,
      store_customer_orders.created_at asc,
      order_production_tasks.created_at asc
    limit 120
  `, sql`
    select distinct production_area as value, production_area_label as label
    from order_production_tasks
    where store_id::text = ${storeId}
      and created_at > now() - interval '14 days'
    order by production_area_label
  `, sql`
    select coalesce(printer_settings, '{}'::jsonb) as "printerSettings"
    from pos_store_settings
    where store_id::text = ${storeId}
    limit 1
  `]);
  const brandIds = Array.from(new Set(rows.map((row) => normalizeText(row.brandId)).filter(Boolean)));
  const menuCandidates = brandIds.length ? await sql`
    select
      'item' as kind,
      menu_catalog_items.id::text,
      menu_catalog_items.brand_id::text as "brandId",
      menu_catalog_items.name,
      menu_catalog_items.display_names as "displayNames",
      coalesce(menu_catalog_items.external_id, '') as "externalId",
      '' as "optionKey",
      menu_catalog_items.base_price::float as "basePrice",
      null::float as "priceDelta"
    from menu_catalog_items
    where menu_catalog_items.brand_id::text in (
      select jsonb_array_elements_text(${JSON.stringify(brandIds)}::jsonb)
    )
      and menu_catalog_items.is_active = true
    union all
    select
      'option' as kind,
      menu_options.id::text,
      menu_option_groups.brand_id::text as "brandId",
      menu_options.name,
      menu_options.display_names as "displayNames",
      coalesce(menu_options.external_id, '') as "externalId",
      menu_options.option_key as "optionKey",
      null::float as "basePrice",
      menu_options.price_delta::float as "priceDelta"
    from menu_options
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    where menu_option_groups.brand_id::text in (
      select jsonb_array_elements_text(${JSON.stringify(brandIds)}::jsonb)
    )
      and menu_option_groups.is_active = true
      and menu_options.is_active = true
  ` as KitchenMenuCandidate[] : [];
  const printerSettings = normalizePosPrinterSettings(settingsRows[0]?.printerSettings);
  const tasks = rows.map((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    const brandId = normalizeText(row.brandId);
    const brandName = normalizeText(row.brandName);
    const kitchenTemplate = resolvePosKitchenTicketTemplate(printerSettings, brandId || null);
    const kitchenLanguage = /maamaa|まぁ麻|麻辣/i.test(brandName)
      ? kitchenTemplate.language
      : "ja";
    const brandMenuItems = menuCandidates.filter((candidate) => candidate.brandId === brandId && candidate.kind === "item");
    const brandMenuOptions = menuCandidates.filter((candidate) => candidate.brandId === brandId && candidate.kind === "option");
    const { customerSummary, orderedItems, ...task } = row;
    const summary = asRecord(customerSummary);
    const noteOriginal = normalizeText(summary.note);
    const noteZh = normalizeText(asRecord(summary.noteTranslations).zh);
    const localizedItemSummary = localizeMaamaaProductionSummary(
      normalizeText(row.itemSummary),
      customerSummary,
      kitchenLanguage
    );
    const bridgeItems = Array.isArray(asRecord(asRecord(customerSummary).bridge).items)
      ? asRecord(asRecord(customerSummary).bridge).items as unknown[]
      : [];
    const localizedOrderedItems = Array.isArray(orderedItems)
      ? orderedItems.map((rawItem, itemIndex) => {
        const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
        const menuItemId = normalizeText(item.menuItemId);
        const quantity = Math.max(1, Math.floor(Number(item.quantity ?? 1) || 1));
        const itemCandidate = brandMenuItems.find((candidate) => candidate.id === menuItemId)
          ?? findMenuDisplayNameCandidate(item.itemName, brandMenuItems);
        const toppingKeys = Array.isArray(item.toppingKeys) ? item.toppingKeys.map(normalizeText) : [];
        const toppingLabels = Array.isArray(item.toppingLabels) ? item.toppingLabels : [];
        const bridgeItem = asRecord(bridgeItems[itemIndex]);
        const matchedOptions = toppingLabels.map((label, index) => {
          const optionKey = toppingKeys[index] ?? "";
          return brandMenuOptions.find((candidate) => optionKey && candidate.optionKey === optionKey)
            ?? findMenuDisplayNameCandidate(label, brandMenuOptions);
        });
        const { itemAmount, toppingAmounts } = resolveKitchenDisplayAmounts({
          storedAmount: item.amount,
          quantity,
          basePrice: itemCandidate?.basePrice,
          optionPriceDeltas: matchedOptions.map((option) => option?.priceDelta),
          bridgeItem,
          toppingCount: toppingLabels.length
        });
        return {
          ...item,
          itemAmount,
          toppingAmounts,
          itemName: kitchenLanguage === "zh"
            ? existingMenuDisplayName(item.itemName, itemCandidate, "zh")
            : normalizeText(item.itemName),
          toppingLabels: toppingLabels.map((label, index) => {
            if (kitchenLanguage !== "zh") return normalizeText(label);
            return localizeMaamaaCustomerLabel(
              existingMenuDisplayName(label, matchedOptions[index], "zh"),
              customerSummary,
              "zh",
              label
            );
          })
        };
      })
      : [];
    return {
      ...task,
      note: kitchenLanguage === "zh" ? (noteZh || noteOriginal) : noteOriginal,
      noteOriginal: kitchenLanguage === "zh" && noteZh && noteZh !== noteOriginal ? noteOriginal : "",
      isHistorical: includeCompleted,
      kitchenLanguage,
      showAmounts: kitchenTemplate.showAmounts,
      itemSummary: localizedItemSummary,
      itemGroups: buildKitchenDisplayItemGroups(localizedOrderedItems, localizedItemSummary)
    };
  });
  const taskLanguages = new Set(tasks.map((task) => task.kitchenLanguage));
  const configuredMaamaaLanguage = printerSettings.kitchenTicketTemplateVariants
    .find((variant) => /maamaa|まぁ麻|麻辣/i.test(variant.brandName))?.template.language;
  return {
    tasks,
    areas,
    businessDay,
    displayLanguage: taskLanguages.size === 1
      ? (taskLanguages.has("zh") ? "zh" : "ja")
      : (tasks.length === 0 && configuredMaamaaLanguage === "zh" ? "zh" : "ja")
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const dayOffset = params.get("dayOffset") === "-1" ? -1 : 0;
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, params.get("storeId")) ?? access.stores[0]?.id ?? "";
  if (storeFilter === "__forbidden__" || !storeFilter) return Response.json({ error: "権限がありません。" }, { status: 403 });


  const selectedStore = access.stores.find((store) => store.id === storeFilter);
  const [{ tasks, areas, businessDay, displayLanguage }, preferenceRows, bridgeRows] = await Promise.all([
    getKitchenTasks(storeFilter, normalizeText(params.get("area")), selectedStore?.businessHours, dayOffset),
    sql`
      select coalesce(ui_preferences ->> 'kitchenDisplayMode', 'detailed') as "kitchenDisplayMode"
      from employees
      where id = ${session.id}
      limit 1
    `,
    sql`
      select
        device_name as "deviceName",
        coalesce(last_seen_at::text, '') as "lastSeenAt",
        coalesce(last_status_at::text, '') as "lastStatusAt",
        coalesce(health_status, '{}'::jsonb) as status,
        (last_seen_at > now() - interval '7 minutes') as "recentlyOnline"
      from local_bridge_devices
      where store_id::text = ${storeFilter}
        and platform = 'desktop'
        and is_enabled = true
      order by last_seen_at desc nulls last, updated_at desc
      limit 1
    `
  ]);
  const bridgeRow = bridgeRows[0] as Record<string, unknown> | undefined;
  return Response.json({
    access,
    selectedStoreId: storeFilter,
    tasks,
    areas,
    businessDay,
    displayLanguage,
    kitchenDisplayMode: ["order_only", "simple"].includes(String(preferenceRows[0]?.kitchenDisplayMode))
      ? preferenceRows[0]?.kitchenDisplayMode
      : "detailed",
    bridgeStatus: bridgeRow ? {
      deviceName: normalizeText(bridgeRow.deviceName),
      lastSeenAt: normalizeText(bridgeRow.lastSeenAt),
      lastStatusAt: normalizeText(bridgeRow.lastStatusAt),
      recentlyOnline: bridgeRow.recentlyOnline === true,
      ...((bridgeRow.status && typeof bridgeRow.status === "object")
        ? bridgeRow.status as Record<string, unknown>
        : {})
    } : null,
    serverNow: new Date().toISOString()
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    storeId?: string;
    taskId?: string;
    orderId?: string;
    status?: string;
    area?: string;
    addMinutes?: number;
  };
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, body.storeId) ?? access.stores[0]?.id ?? "";
  if (storeFilter === "__forbidden__" || !storeFilter) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const selectedStore = access.stores.find((store) => store.id === storeFilter);

  const taskId = normalizeText(body.taskId);
  const requestedOrderId = normalizeText(body.orderId);
  const status = normalizeText(body.status);
  const addMinutes = Number(body.addMinutes ?? 0);
  if (requestedOrderId && [-5, 5, 10, 15].includes(addMinutes)) {
    const extendedRows = await sql`
      update store_customer_orders
      set
        estimated_prep_minutes = greatest(1, coalesce(nullif(estimated_prep_minutes, 0), 10) + ${addMinutes}),
        estimated_ready_at = case
          when ${addMinutes} < 0 then greatest(
            now(),
            coalesce(
              estimated_ready_at,
              now() + make_interval(mins => coalesce(nullif(estimated_prep_minutes, 0), 10))
            ) + make_interval(mins => ${addMinutes})
          )
          else greatest(coalesce(estimated_ready_at, now()), now()) + make_interval(mins => ${addMinutes})
        end,
        updated_at = now()
      where id::text = ${requestedOrderId}
        and store_id::text = ${storeFilter}
        and payment_status in ('paid', 'partial_refunded')
        and status in ('new', 'preparing', 'ready')
      returning id::text
    `;
    if (!extendedRows[0]) return Response.json({ error: "時間を調整できる注文が見つかりません。" }, { status: 409 });
    await publishCustomerOrderEvent("order.updated", await findCustomerOrderById(requestedOrderId));
    const { tasks, areas, displayLanguage } = await getKitchenTasks(
      storeFilter,
      normalizeText(body.area),
      selectedStore?.businessHours
    );
    return Response.json({
      ok: true,
      tasks,
      areas,
      displayLanguage,
      serverNow: new Date().toISOString()
    });
  }
  if (status === "completed" && requestedOrderId) {
    const completedRows = await sql`
      update store_customer_orders
      set status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
      where id::text = ${requestedOrderId}
        and store_id::text = ${storeFilter}
        and status = 'ready'
      returning id::text
    `;
    if (!completedRows[0]) return Response.json({ error: "受け渡し可能な注文が見つかりません。" }, { status: 409 });
    await publishCustomerOrderEvent("order.updated", await findCustomerOrderById(requestedOrderId));
    const { tasks, areas, displayLanguage } = await getKitchenTasks(
      storeFilter,
      normalizeText(body.area),
      selectedStore?.businessHours
    );
    return Response.json({ ok: true, tasks, areas, displayLanguage, serverNow: new Date().toISOString() });
  }
  if (!taskId || !["new", "preparing", "ready"].includes(status)) return Response.json({ error: "更新内容が不正です。" }, { status: 400 });

  const taskRows = await sql`
    select id::text
    from order_production_tasks
    where id::text = ${taskId}
      and store_id::text = ${storeFilter}
    limit 1
  `;
  if (!taskRows[0]) return Response.json({ error: "制作タスクが見つかりません。" }, { status: 404 });
  const orderId = await setProductionTaskStatus(taskId, status as "new" | "preparing" | "ready", session.id);
  if (orderId) {
    await reconcileUberReadyCommand(orderId);
    await publishCustomerOrderEvent("order.updated", await findCustomerOrderById(orderId));
  }
  const { tasks, areas, displayLanguage } = await getKitchenTasks(
    storeFilter,
    normalizeText(body.area),
    selectedStore?.businessHours
  );
  return Response.json({ ok: true, tasks, areas, displayLanguage, serverNow: new Date().toISOString() });
}
