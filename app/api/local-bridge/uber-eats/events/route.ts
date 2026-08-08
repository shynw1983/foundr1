import { findCustomerOrderById } from "../../../../../lib/customer-orders";
import { sql } from "../../../../../lib/db";
import { authorizeLocalBridge } from "../../../../../lib/local-bridge-auth";
import { ensureProductionTasksForOrder } from "../../../../../lib/order-production";
import { publishCustomerOrderEvent, publishPublicMenuUpdatedEvent } from "../../../../../lib/order-realtime";
import { syncWebReservationToSalesOrder } from "../../../../../lib/sales-orders";
import { publishBridgeInventoryUpdated } from "../../../../../lib/local-bridge-realtime";
import { translateOrderNoteToChinese } from "../../../../../lib/order-note-translation";
import {
  findMenuDisplayNameCandidate,
  type MenuDisplayNameCandidate
} from "../../../../../lib/menu-display-name-matcher";
import {
  parseUberBridgeSnapshot,
  toUberBridgeOperationalItem,
  type UberBridgeNode
} from "../../../../../lib/uber-bridge";
import {
  parseRocketNowBridgeSnapshot,
  toRocketNowBridgeOperationalItem
} from "../../../../../lib/rocket-now-bridge";

export const runtime = "nodejs";

function cleanText(value: unknown, maxLength = 4000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function dateParts(date: Date) {
  const pickupDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
  const pickupTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
  return { pickupDate, pickupTime };
}

function hasExactDuplicateBridgeItems(value: unknown) {
  if (!Array.isArray(value)) return false;
  const signatures = new Set<string>();
  for (const item of value) {
    const signature = JSON.stringify(item);
    if (signatures.has(signature)) return true;
    signatures.add(signature);
  }
  return false;
}

async function resolveStoreBrand(
  storeId: string,
  parsedItemNames: string[],
  platform: "uber_eats" | "rocket_now"
) {
  const sourceRows = await sql`
    select brands.id::text as "brandId", brands.name as "brandName"
    from store_sales_sources
    join brands on brands.name = store_sales_sources.brand_name
    where store_sales_sources.store_id::text = ${storeId}
      and store_sales_sources.source_platform = ${platform}
      and store_sales_sources.is_enabled = true
    order by store_sales_sources.sort_order
  `;
  if (sourceRows.length === 1) return sourceRows[0];
  const brandRows = sourceRows.length ? sourceRows : await sql`
    select brands.id::text as "brandId", brands.name as "brandName"
    from store_brands
    join brands on brands.id = store_brands.brand_id
    where store_brands.store_id::text = ${storeId}
    order by brands.name
  `;
  const itemText = parsedItemNames.join("\n").toLowerCase();
  return brandRows.find((row) => {
    const name = String(row.brandName).toLowerCase();
    return (/(maamaa|麻辣)/.test(name) && /マーラータン|麻辣/.test(itemText))
      || (/(nanacha|奶茶)/.test(name) && /ミルクティー|ティー|奶茶/.test(itemText));
  }) ?? brandRows[0] ?? null;
}

type RocketMenuReferences = {
  items: MenuDisplayNameCandidate[];
  options: Array<MenuDisplayNameCandidate & { optionKey: string }>;
};

async function loadRocketMenuReferences(brandId: string): Promise<RocketMenuReferences> {
  if (!brandId) return { items: [], options: [] };
  const [itemRows, optionRows] = await Promise.all([sql`
    select
      id::text,
      name,
      display_names as "displayNames",
      coalesce(external_id, '') as "externalId"
    from menu_catalog_items
    where brand_id::text = ${brandId}
      and is_active = true
  `, sql`
    select
      menu_options.id::text,
      menu_options.name,
      menu_options.display_names as "displayNames",
      coalesce(menu_options.external_id, '') as "externalId",
      menu_options.option_key as "optionKey"
    from menu_options
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    where menu_option_groups.brand_id::text = ${brandId}
      and menu_option_groups.is_active = true
      and menu_options.is_active = true
  `]);
  return {
    items: itemRows as MenuDisplayNameCandidate[],
    options: optionRows as Array<MenuDisplayNameCandidate & { optionKey: string }>
  };
}

async function upsertOperationalOrder(input: {
  storeId: string;
  eventId: string;
  capturedAt: Date;
  nodes: UberBridgeNode[];
  platform: "uber_eats" | "rocket_now";
}) {
  const parsed = input.platform === "rocket_now"
    ? parseRocketNowBridgeSnapshot(input.nodes, input.capturedAt)
    : parseUberBridgeSnapshot(input.nodes, input.capturedAt);
  if (!parsed || parsed.items.length === 0) {
    return { status: "incomplete", orderId: "", orderNo: parsed?.orderNo ?? "" };
  }
  const orderAgeMs = input.capturedAt.getTime() - parsed.orderedAt.getTime();
  if (orderAgeMs > 30 * 60 * 1000) {
    return { status: "stale_snapshot", orderId: "", orderNo: parsed.orderNo };
  }

  const storeRows = await sql`
    select id::text
    from stores
    where id::text = ${input.storeId}
      and status = 'active'
    limit 1
  `;
  if (!storeRows[0]) return { status: "invalid_store", orderId: "", orderNo: parsed.orderNo };

  const { pickupDate, pickupTime } = dateParts(parsed.orderedAt);
  const sourceExternalId = `bridge:${input.storeId}:${pickupDate}:${parsed.orderNo}`;
  const brand = await resolveStoreBrand(
    input.storeId,
    parsed.items.map((item) => item.name),
    input.platform
  );
  const rocketMenuReferences = input.platform === "rocket_now"
    ? await loadRocketMenuReferences(String(brand?.brandId ?? ""))
    : { items: [], options: [] };
  const existingRows = await sql`
    select
      id::text,
      status,
      coalesce(customer_summary ->> 'orderType', '') as "orderType",
      coalesce((customer_summary #>> '{bridge,completeness}')::int, 0) as completeness,
      coalesce((customer_summary #>> '{bridge,parserVersion}')::int, 0) as "parserVersion",
      coalesce(customer_summary #> '{bridge,items}', '[]'::jsonb) as "bridgeItems",
      coalesce(customer_summary ->> 'note', '') as note,
      coalesce(customer_summary #>> '{noteTranslations,zh}', '') as "noteZh"
    from store_customer_orders
    where order_source = ${input.platform}
      and source_external_id = ${sourceExternalId}
    limit 1
  `;
  const existing = existingRows[0];
  const existingNote = cleanText(existing?.note, 1200);
  const existingNoteZh = cleanText(existing?.noteZh, 1200);
  const customerNote = cleanText("customerNote" in parsed ? parsed.customerNote : "", 1200);
  const noteChanged = Boolean(customerNote && customerNote !== existingNote);
  const noteZh = customerNote
    ? (customerNote === existingNote && existingNoteZh
        ? existingNoteZh
        : await translateOrderNoteToChinese(customerNote))
    : "";
  const shouldReplaceItems = !existing
    || parsed.completeness > Number(existing.completeness ?? 0)
    || (input.platform === "rocket_now" && Number(existing.parserVersion ?? 0) < 5)
    || hasExactDuplicateBridgeItems(existing.bridgeItems);
  const nextStatus = existing
    && parsed.status === "new"
    && ["preparing", "ready"].includes(String(existing.status))
      ? String(existing.status)
      : parsed.status;
  const nextOrderType = parsed.orderType !== "unknown"
    ? parsed.orderType
    : String(existing?.orderType ?? "") || "unknown";
  const shouldPublishOrderEvent = !existing
    || shouldReplaceItems
    || noteChanged
    || Boolean(noteZh && !existingNoteZh)
    || nextStatus !== String(existing.status ?? "")
    || nextOrderType !== String(existing.orderType ?? "");
  const summary = {
    customer: { name: parsed.customerName },
    ...(customerNote ? { note: customerNote } : {}),
    ...(noteZh ? { noteTranslations: { zh: noteZh } } : {}),
    orderType: nextOrderType,
    sourcePlatform: input.platform,
    sourceOrderNo: parsed.orderNo,
    bridge: {
      eventId: input.eventId,
      capturedAt: input.capturedAt.toISOString(),
      completeness: parsed.completeness,
      parserVersion: input.platform === "rocket_now" ? 5 : 1,
      sourceExternalId,
      items: parsed.items
    }
  };

  const orderRows = await sql`
    insert into store_customer_orders (
      brand_id,
      store_id,
      order_source,
      source_external_id,
      pickup_code,
      status,
      payment_status,
      payment_provider,
      pickup_date,
      pickup_time,
      amount,
      currency,
      customer_summary,
      paid_at,
      completed_at,
      cancelled_at,
      created_at,
      updated_at
    )
    values (
      ${brand?.brandId || null},
      ${input.storeId},
      ${input.platform},
      ${sourceExternalId},
      ${parsed.orderNo},
      ${nextStatus},
      'paid',
      ${input.platform},
      ${pickupDate},
      ${pickupTime},
      ${parsed.total},
      'JPY',
      ${JSON.stringify(summary)}::jsonb,
      ${parsed.orderedAt.toISOString()},
      ${parsed.status === "completed" ? input.capturedAt.toISOString() : null},
      ${parsed.status === "cancelled" ? input.capturedAt.toISOString() : null},
      ${parsed.orderedAt.toISOString()},
      now()
    )
    on conflict (order_source, source_external_id) where source_external_id is not null
    do update set
      brand_id = coalesce(store_customer_orders.brand_id, excluded.brand_id),
      store_id = excluded.store_id,
      status = ${nextStatus},
      payment_status = 'paid',
      amount = case when ${shouldReplaceItems} then excluded.amount else store_customer_orders.amount end,
      customer_summary = case
        when ${shouldReplaceItems || noteChanged || Boolean(noteZh && !existingNoteZh)} then store_customer_orders.customer_summary || excluded.customer_summary
        else jsonb_set(
          store_customer_orders.customer_summary,
          '{orderType}',
          to_jsonb(${nextOrderType}::text),
          true
        )
      end,
      completed_at = coalesce(excluded.completed_at, store_customer_orders.completed_at),
      cancelled_at = coalesce(excluded.cancelled_at, store_customer_orders.cancelled_at),
      updated_at = now()
    returning id::text
  `;
  const orderId = String(orderRows[0]?.id ?? "");
  if (!orderId) return { status: "write_failed", orderId: "", orderNo: parsed.orderNo };

  if (shouldReplaceItems) {
    const existingItems = await sql`
      select id::text
      from store_customer_order_items
      where order_id::text = ${orderId}
      order by sort_order, created_at
    `;
    for (let index = 0; index < parsed.items.length; index += 1) {
      const item = input.platform === "rocket_now"
        ? toRocketNowBridgeOperationalItem(parsed.items[index] as Parameters<typeof toRocketNowBridgeOperationalItem>[0])
        : toUberBridgeOperationalItem(parsed.items[index] as Parameters<typeof toUberBridgeOperationalItem>[0]);
      const matchedMenuItem = input.platform === "rocket_now"
        ? findMenuDisplayNameCandidate(item.itemName, rocketMenuReferences.items)
        : null;
      const matchedOptions = input.platform === "rocket_now"
        ? item.toppingLabels.map((label) => (
            findMenuDisplayNameCandidate(label, rocketMenuReferences.options)
          ))
        : [];
      const toppingKeys = matchedOptions.map((option) => option?.optionKey ?? "");
      const existingItemId = existingItems[index]?.id ? String(existingItems[index].id) : "";
      if (existingItemId) {
        await sql`
          update store_customer_order_items
          set
            menu_catalog_item_id = ${matchedMenuItem?.id || null},
            item_name = ${item.itemName},
            size_key = ${item.sizeKey},
            option_label = ${item.optionLabel},
            topping_keys = ${toppingKeys},
            topping_labels = ${item.toppingLabels},
            quantity = ${item.quantity},
            amount = ${item.amount},
            sort_order = ${index}
          where id::text = ${existingItemId}
        `;
      } else {
        await sql`
          insert into store_customer_order_items (
            order_id,
            menu_catalog_item_id,
            item_name,
            size_key,
            option_label,
            topping_keys,
            topping_labels,
            quantity,
            amount,
            sort_order
          )
          values (
            ${orderId},
            ${matchedMenuItem?.id || null},
            ${item.itemName},
            ${item.sizeKey},
            ${item.optionLabel},
            ${toppingKeys},
            ${item.toppingLabels},
            ${item.quantity},
            ${item.amount},
            ${index}
          )
        `;
      }
    }
    for (const staleItem of existingItems.slice(parsed.items.length)) {
      await sql`
        delete from store_customer_order_items
        where id::text = ${String(staleItem.id)}
      `;
    }
  }

  await syncWebReservationToSalesOrder(orderId);
  await ensureProductionTasksForOrder(orderId);
  if (shouldPublishOrderEvent) {
    await publishCustomerOrderEvent(
      existing ? "order.updated" : "order.created",
      await findCustomerOrderById(orderId)
    ).catch(() => undefined);
  }
  return {
    status: shouldReplaceItems ? "imported" : "duplicate",
    orderId,
    orderNo: parsed.orderNo
  };
}

function normalizeMenuMatch(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000・·|｜()[\]（）「」『』【】"'’“”.,。、:：;；!！?？\-_/\\]/g, "");
}

async function syncInventoryUnavailable(storeId: string, payload: Record<string, unknown>) {
  const signalText = cleanText(payload.signalText, 500);
  const itemName = cleanText(payload.itemName, 500);
  const normalizedSignal = normalizeMenuMatch(itemName || signalText);
  const isAvailable = payload.isAvailable === true;
  if (!normalizedSignal) return { status: "inventory_missing_signal", target: null };

  const rows = await sql`
    select
      'item' as kind,
      menu_catalog_items.id::text,
      menu_catalog_items.brand_id::text as "brandId",
      menu_catalog_items.name,
      menu_catalog_items.display_names as "displayNames"
    from menu_catalog_items
    join store_brands
      on store_brands.brand_id = menu_catalog_items.brand_id
      and store_brands.store_id::text = ${storeId}
    where menu_catalog_items.is_active = true
      and menu_catalog_items.store_id is null
    union all
    select
      'option' as kind,
      menu_options.id::text,
      menu_option_groups.brand_id::text as "brandId",
      menu_options.name,
      menu_options.display_names as "displayNames"
    from menu_options
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    join store_brands
      on store_brands.brand_id = menu_option_groups.brand_id
      and store_brands.store_id::text = ${storeId}
    where menu_options.is_active = true
      and menu_option_groups.is_active = true
  `;
  const menuRows = rows as Array<{
    kind: string;
    id: string;
    brandId: string;
    name: string;
    displayNames: Record<string, unknown> | null;
  }>;
  const matches = menuRows.flatMap((row) => {
    const displayNames = row.displayNames && typeof row.displayNames === "object"
      ? Object.values(row.displayNames as Record<string, unknown>)
      : [];
    const aliases = [row.name, ...displayNames]
      .map(normalizeMenuMatch)
      .filter((alias) => alias.length >= 2);
    const longestMatch = aliases
      .filter((alias) => normalizedSignal.includes(alias))
      .sort((left, right) => right.length - left.length)[0];
    return longestMatch ? [{ ...row, matchLength: longestMatch.length }] : [];
  });
  if (!matches.length) return { status: "inventory_unmatched", target: null };
  const longest = Math.max(...matches.map((match) => match.matchLength));
  const strongest = matches.filter((match) => match.matchLength === longest);
  if (strongest.length !== 1) return { status: "inventory_ambiguous", target: null };

  const target = strongest[0];
  const statusNote = `Uber Eats Bridge: ${signalText || itemName}`.slice(0, 500);
  let changed = false;
  if (target.kind === "option") {
    const settingRows = await sql`
      insert into menu_option_store_settings (
        brand_id, store_id, menu_option_id, is_available, status_note, updated_at
      )
      values (${target.brandId}, ${storeId}, ${target.id}, ${isAvailable}, ${statusNote}, now())
      on conflict (store_id, menu_option_id)
      do update set is_available = excluded.is_available, status_note = excluded.status_note, updated_at = now()
      where menu_option_store_settings.is_available is distinct from excluded.is_available
        or menu_option_store_settings.status_note is distinct from excluded.status_note
      returning id::text
    `;
    changed = settingRows.length > 0;
  } else {
    const settingRows = await sql`
      insert into menu_store_settings (
        brand_id, store_id, menu_catalog_item_id, is_available, status_note, updated_at
      )
      values (${target.brandId}, ${storeId}, ${target.id}, ${isAvailable}, ${statusNote}, now())
      on conflict (store_id, menu_catalog_item_id)
      do update set is_available = excluded.is_available, status_note = excluded.status_note, updated_at = now()
      where menu_store_settings.is_available is distinct from excluded.is_available
        or menu_store_settings.status_note is distinct from excluded.status_note
      returning id::text
    `;
    changed = settingRows.length > 0;
  }
  return {
    status: "inventory_synced",
    changed,
    target: { kind: target.kind, id: target.id, name: target.name, isAvailable }
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const source = body as Record<string, unknown>;
  const kind = cleanText(source.kind, 80) || "unknown";
  const platform = cleanText(source.platform, 80) || "uber_eats";
  const packageName = cleanText(source.packageName, 160);
  const deviceName = cleanText(source.deviceName, 240);
  const storeId = cleanText(source.storeId, 80);
  const clientEventId = cleanText(source.clientEventId, 120) || null;
  const payload = source.payload && typeof source.payload === "object" ? source.payload : {};
  const capturedAtValue = Number(source.capturedAt);
  const capturedAt = Number.isFinite(capturedAtValue) ? new Date(capturedAtValue) : new Date();
  let authorization = await authorizeLocalBridge(request, storeId, platform);
  // The same physical tablet can run both channels. Existing Uber-enrolled devices
  // remain valid for Rocket Now events from the same signed Bridge installation.
  if (!authorization.authorized && platform === "rocket_now") {
    authorization = await authorizeLocalBridge(request, storeId, "uber_eats");
  }
  if (!authorization.authorized) {
    return Response.json({ error: "Unauthorized bridge token." }, { status: 401 });
  }

  const rows = await sql`
    insert into local_bridge_events (
      client_event_id,
      platform,
      kind,
      package_name,
      device_name,
      store_external_id,
      payload
    )
    values (
      ${clientEventId},
      ${platform},
      ${kind},
      ${packageName},
      ${deviceName},
      ${storeId},
      ${JSON.stringify(payload)}::jsonb
    )
    on conflict (client_event_id) do update set
      client_event_id = excluded.client_event_id
    returning id::text, created_at
  `;

  const eventId = String(rows[0]?.id ?? "");
  if (authorization.deviceId) {
    await sql`
      update local_bridge_devices
      set
        device_name = coalesce(nullif(${deviceName}, ''), device_name),
        last_seen_at = now(),
        updated_at = now()
      where id::text = ${authorization.deviceId}
    `;
  }
  if (kind === "accessibility_inventory") {
    const result = await syncInventoryUnavailable(storeId, payload as Record<string, unknown>)
      .catch((error) => ({
        status: "error",
        target: null,
        error: error instanceof Error ? error.message : "Unknown inventory sync error"
      }));
    const parseError = "error" in result ? cleanText(result.error, 1000) : "";
    await sql`
      update local_bridge_events
      set parse_status = ${result.status}, parse_error = ${parseError}
      where id::text = ${eventId}
    `;
    if (result.status === "inventory_synced" && "changed" in result && result.changed && result.target) {
      await publishBridgeInventoryUpdated(storeId, result.target).catch(() => undefined);
      await publishPublicMenuUpdatedEvent(storeId).catch(() => undefined);
    }
    return Response.json({
      ok: result.status !== "error",
      event: rows[0],
      parseStatus: result.status,
      target: result.target,
      error: parseError || undefined
    }, { status: result.status === "error" ? 500 : 200 });
  }
  if (kind !== "accessibility_order") {
    return Response.json({ ok: true, event: rows[0], parseStatus: "raw" });
  }

  const payloadRecord = payload as Record<string, unknown>;
  const nodes = Array.isArray(payloadRecord.nodes)
    ? payloadRecord.nodes.slice(0, 1200) as UberBridgeNode[]
    : [];
  const result = await upsertOperationalOrder({
    storeId,
    eventId,
    capturedAt,
    nodes,
    platform: platform === "rocket_now" ? "rocket_now" : "uber_eats"
  }).catch((error) => ({
    status: "error",
    orderId: "",
    orderNo: "",
    error: error instanceof Error ? error.message : "Unknown bridge parse error"
  }));
  const parseError = "error" in result ? cleanText(result.error, 1000) : "";

  await sql`
    update local_bridge_events
    set
      parse_status = ${result.status},
      parse_error = ${parseError}
    where id::text = ${eventId}
  `;

  return Response.json({
    ok: result.status !== "error",
    event: rows[0],
    parseStatus: result.status,
    orderId: result.orderId,
    orderNo: result.orderNo,
    error: parseError || undefined
  }, { status: result.status === "error" ? 500 : 200 });
}
