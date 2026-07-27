import { createHash, timingSafeEqual } from "node:crypto";

import { sql } from "../../../../../lib/db";
import { ensureProductionTasksForOrder } from "../../../../../lib/order-production";
import { syncWebReservationToSalesOrder } from "../../../../../lib/sales-orders";
import {
  parseUberBridgeSnapshot,
  type UberBridgeItem,
  type UberBridgeNode
} from "../../../../../lib/uber-bridge";

export const runtime = "nodejs";

function cleanText(value: unknown, maxLength = 4000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function authorizeBridge(request: Request, storeId: string) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const expectedToken = process.env.LOCAL_BRIDGE_TOKEN;
  if (expectedToken && token && secureEqual(token, expectedToken)) {
    return { authorized: true, deviceId: "" };
  }
  if (!token && process.env.NODE_ENV !== "production") {
    return { authorized: true, deviceId: "" };
  }
  if (!token || !storeId) return { authorized: false, deviceId: "" };

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await sql`
    select id::text
    from local_bridge_devices
    where token_hash = ${tokenHash}
      and store_id::text = ${storeId}
      and platform = 'uber_eats'
      and is_enabled = true
    limit 1
  `;
  return {
    authorized: Boolean(rows[0]?.id),
    deviceId: rows[0]?.id ? String(rows[0].id) : ""
  };
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

function sourceLabel(value: string) {
  return value.split(/[｜|]/)[0]?.trim() || value.trim();
}

function modifierLabel(group: string, name: string) {
  const normalizedGroup = sourceLabel(group);
  const normalizedName = sourceLabel(name);
  if (/辛さ/.test(normalizedGroup)) return `辛さ：${normalizedName}`;
  if (/痺れ|しびれ/.test(normalizedGroup)) return `痺れ：${normalizedName}`;
  if (/味変/.test(normalizedGroup)) return `味変：${normalizedName}`;
  return normalizedName;
}

function itemPayload(item: UberBridgeItem) {
  const labels = item.modifiers.map((modifier) => modifierLabel(modifier.group, modifier.name));
  const isMaamaa = /マーラータン|麻辣[烫湯燙]/.test(item.name)
    || item.modifiers.some((modifier) => /辛さ|痺れ|薬膳|麺/.test(modifier.group));
  return {
    itemName: sourceLabel(item.name),
    quantity: Math.max(1, Math.round(item.quantity)),
    amount: Math.max(0, Math.round(item.lineTotal)),
    sizeKey: isMaamaa ? "maamaa_buildable" : "",
    optionLabel: labels.join(", "),
    toppingLabels: labels
  };
}

async function resolveStoreBrand(storeId: string, parsedItemNames: string[]) {
  const sourceRows = await sql`
    select brands.id::text as "brandId", brands.name as "brandName"
    from store_sales_sources
    join brands on brands.name = store_sales_sources.brand_name
    where store_sales_sources.store_id::text = ${storeId}
      and store_sales_sources.source_platform = 'uber_eats'
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

async function upsertOperationalOrder(input: {
  storeId: string;
  eventId: string;
  capturedAt: Date;
  nodes: UberBridgeNode[];
}) {
  const parsed = parseUberBridgeSnapshot(input.nodes, input.capturedAt);
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
  const brand = await resolveStoreBrand(input.storeId, parsed.items.map((item) => item.name));
  const existingRows = await sql`
    select
      id::text,
      status,
      coalesce((customer_summary #>> '{bridge,completeness}')::int, 0) as completeness
    from store_customer_orders
    where order_source = 'uber_eats'
      and source_external_id = ${sourceExternalId}
    limit 1
  `;
  const existing = existingRows[0];
  const shouldReplaceItems = !existing || parsed.completeness > Number(existing.completeness ?? 0);
  const nextStatus = existing
    && parsed.status === "new"
    && ["preparing", "ready"].includes(String(existing.status))
      ? String(existing.status)
      : parsed.status;
  const summary = {
    customer: { name: parsed.customerName },
    orderType: "delivery",
    sourcePlatform: "uber_eats",
    sourceOrderNo: parsed.orderNo,
    bridge: {
      eventId: input.eventId,
      capturedAt: input.capturedAt.toISOString(),
      completeness: parsed.completeness,
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
      'uber_eats',
      ${sourceExternalId},
      ${parsed.orderNo},
      ${nextStatus},
      'paid',
      'uber_eats',
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
        when ${shouldReplaceItems} then store_customer_orders.customer_summary || excluded.customer_summary
        else store_customer_orders.customer_summary
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
      const item = itemPayload(parsed.items[index]);
      const existingItemId = existingItems[index]?.id ? String(existingItems[index].id) : "";
      if (existingItemId) {
        await sql`
          update store_customer_order_items
          set
            item_name = ${item.itemName},
            size_key = ${item.sizeKey},
            option_label = ${item.optionLabel},
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
            item_name,
            size_key,
            option_label,
            topping_labels,
            quantity,
            amount,
            sort_order
          )
          values (
            ${orderId},
            ${item.itemName},
            ${item.sizeKey},
            ${item.optionLabel},
            ${item.toppingLabels},
            ${item.quantity},
            ${item.amount},
            ${index}
          )
        `;
      }
    }
  }

  await syncWebReservationToSalesOrder(orderId);
  await ensureProductionTasksForOrder(orderId);
  return {
    status: shouldReplaceItems ? "imported" : "duplicate",
    orderId,
    orderNo: parsed.orderNo
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
  const payload = source.payload && typeof source.payload === "object" ? source.payload : {};
  const capturedAtValue = Number(source.capturedAt);
  const capturedAt = Number.isFinite(capturedAtValue) ? new Date(capturedAtValue) : new Date();
  const authorization = await authorizeBridge(request, storeId);
  if (!authorization.authorized) {
    return Response.json({ error: "Unauthorized bridge token." }, { status: 401 });
  }

  const rows = await sql`
    insert into local_bridge_events (
      platform,
      kind,
      package_name,
      device_name,
      store_external_id,
      payload
    )
    values (
      ${platform},
      ${kind},
      ${packageName},
      ${deviceName},
      ${storeId},
      ${JSON.stringify(payload)}::jsonb
    )
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
    nodes
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
