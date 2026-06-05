import { sql } from "./db";
import { syncWebReservationToSalesOrder } from "./sales-orders";

type ProductionTaskStatus = "new" | "preparing" | "ready";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function getProductionArea(brandName: string) {
  const normalized = brandName.toLowerCase();
  if (normalized.includes("nanacha") || normalized.includes("奶茶")) {
    return { key: "drink", label: "奶茶" };
  }
  if (normalized.includes("maamaa") || normalized.includes("麻辣")) {
    return { key: "malatang", label: "麻辣烫" };
  }
  return { key: normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "general", label: brandName || "制作" };
}

function uniqueTextParts(parts: string[]) {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const normalized = part.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function countLabels(labels: string[]) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const label of labels) {
    const normalized = normalizeText(label);
    if (!normalized) continue;
    const current = counts.get(normalized) ?? { label: normalized, count: 0 };
    current.count += 1;
    counts.set(normalized, current);
  }
  return Array.from(counts.values()).map(({ label, count }) => `${label}${count > 1 ? ` x${count}` : ""}`);
}

function buildProductionItemLines(row: {
  itemName: string;
  quantity: number;
  sizeLabel: string;
  temperature: string;
  sweetness: string;
  ice: string;
  optionLabel: string;
  toppingLabels: string[] | null;
}) {
  const optionParts = row.optionLabel.split(",").map((part) => part.trim()).filter(Boolean);
  const toppingLabels = Array.isArray(row.toppingLabels) ? row.toppingLabels : [];
  const details = uniqueTextParts([
    row.sizeLabel,
    row.temperature,
    row.sweetness,
    row.ice,
    ...optionParts,
    ...countLabels(toppingLabels)
  ]);
  return [
    `${row.itemName} x${row.quantity}`,
    ...details.map((detail) => `・${detail}`)
  ];
}

export async function ensureProductionTasksForOrder(orderId: string) {
  const normalizedOrderId = normalizeText(orderId);
  if (!normalizedOrderId) return [];

  const orderRows = await sql`
    select
      id::text,
      store_id::text as "storeId",
      status,
      payment_status as "paymentStatus"
    from store_customer_orders
    where id::text = ${normalizedOrderId}
    limit 1
  `;
  const order = orderRows[0] as { id: string; storeId: string; status: string; paymentStatus: string } | undefined;
  if (!order || order.paymentStatus !== "paid" || ["cancelled", "refund_pending", "pending_payment", "checkout_failed", "payment_failed"].includes(order.status)) {
    return [];
  }

  const itemRows = await sql`
    select
      coalesce(menu_catalog_items.brand_id::text, store_customer_orders.brand_id::text, '') as "brandId",
      coalesce(brands.name, '制作') as "brandName",
      store_customer_order_items.item_name as "itemName",
      coalesce(store_customer_order_items.quantity, 1)::int as quantity,
      coalesce(store_customer_order_items.size_label, '') as "sizeLabel",
      coalesce(store_customer_order_items.temperature, '') as temperature,
      coalesce(store_customer_order_items.sweetness, '') as sweetness,
      coalesce(store_customer_order_items.ice, '') as ice,
      coalesce(store_customer_order_items.option_label, '') as "optionLabel",
      store_customer_order_items.topping_labels as "toppingLabels"
    from store_customer_order_items
    join store_customer_orders on store_customer_orders.id = store_customer_order_items.order_id
    left join menu_catalog_items on menu_catalog_items.id = store_customer_order_items.menu_catalog_item_id
    left join brands on brands.id = coalesce(menu_catalog_items.brand_id, store_customer_orders.brand_id)
    where store_customer_order_items.order_id::text = ${normalizedOrderId}
    order by store_customer_order_items.sort_order, store_customer_order_items.created_at
  `;

  const grouped = new Map<string, { brandId: string; areaKey: string; areaLabel: string; lines: string[] }>();
  for (const row of itemRows as Array<{
    brandId: string;
    brandName: string;
    itemName: string;
    quantity: number;
    sizeLabel: string;
    temperature: string;
    sweetness: string;
    ice: string;
    optionLabel: string;
    toppingLabels: string[] | null;
  }>) {
    const area = getProductionArea(row.brandName);
    const key = `${row.brandId || ""}:${area.key}`;
    const current = grouped.get(key) ?? { brandId: row.brandId || "", areaKey: area.key, areaLabel: area.label, lines: [] };
    current.lines.push(...buildProductionItemLines(row));
    grouped.set(key, current);
  }

  if (!grouped.size) return [];

  for (const task of grouped.values()) {
    await sql`
      insert into order_production_tasks (
        order_id,
        store_id,
        brand_id,
        production_area,
        production_area_label,
        item_summary
      )
      values (
        ${normalizedOrderId},
        ${order.storeId || null},
        ${task.brandId || null},
        ${task.areaKey},
        ${task.areaLabel},
        ${task.lines.join('\n')}
      )
      on conflict (order_id, production_area, production_area_label)
      do update set
        item_summary = excluded.item_summary,
        updated_at = now()
      where order_production_tasks.status <> 'ready'
    `;
  }

  return getProductionTasksForOrder(normalizedOrderId);
}

export async function getProductionTasksForOrder(orderId: string) {
  return sql`
    select
      id::text,
      order_id::text as "orderId",
      coalesce(store_id::text, '') as "storeId",
      coalesce(brand_id::text, '') as "brandId",
      production_area as "productionArea",
      production_area_label as "productionAreaLabel",
      status,
      print_status as "printStatus",
      item_summary as "itemSummary",
      coalesce(started_at::text, '') as "startedAt",
      coalesce(ready_at::text, '') as "readyAt",
      created_at::text as "createdAt",
      updated_at::text as "updatedAt"
    from order_production_tasks
    where order_id::text = ${orderId}
    order by production_area_label, created_at
  `;
}

export async function syncOrderStatusFromProductionTasks(orderId: string) {
  const tasks = await getProductionTasksForOrder(orderId) as Array<{ status: ProductionTaskStatus }>;
  if (!tasks.length) return null;
  const nextStatus = tasks.every((task) => task.status === "ready")
    ? "ready"
    : tasks.some((task) => task.status === "preparing" || task.status === "ready")
      ? "preparing"
      : "new";
  const rows = await sql`
    update store_customer_orders
    set
      status = case when status in ('cancelled', 'completed', 'refund_pending') then status else ${nextStatus} end,
      preparing_at = case when ${nextStatus} in ('preparing', 'ready') and preparing_at is null then now() else preparing_at end,
      ready_at = case when ${nextStatus} = 'ready' and ready_at is null then now() else ready_at end,
      updated_at = now()
    where id::text = ${orderId}
    returning id::text
  `;
  if (rows[0]?.id) await syncWebReservationToSalesOrder(rows[0].id as string);
  return rows[0]?.id as string | undefined;
}

export async function setProductionTaskStatus(taskId: string, status: ProductionTaskStatus, employeeId?: string) {
  const nextStatus = ["new", "preparing", "ready"].includes(status) ? status : "new";
  const rows = await sql`
    update order_production_tasks
    set
      status = ${nextStatus},
      started_at = case when ${nextStatus} in ('preparing', 'ready') and started_at is null then now() else started_at end,
      ready_at = case when ${nextStatus} = 'ready' and ready_at is null then now() else ready_at end,
      completed_by = case when ${nextStatus} = 'ready' then ${employeeId || null} else completed_by end,
      updated_at = now()
    where id::text = ${taskId}
    returning order_id::text as "orderId"
  `;
  const orderId = rows[0]?.orderId as string | undefined;
  if (orderId) await syncOrderStatusFromProductionTasks(orderId);
  return orderId;
}
