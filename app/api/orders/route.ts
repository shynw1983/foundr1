import { requireWritableOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

function toTokyoDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "",
    month: parts.find((part) => part.type === "month")?.value ?? "",
    day: parts.find((part) => part.type === "day")?.value ?? ""
  };
}

function formatDeadlineLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (!match) {
    return value;
  }

  const [, year, month, day, hour, minute] = match;
  const today = toTokyoDateParts(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = toTokyoDateParts(tomorrowDate);

  if (today.year === year && today.month === month && today.day === day) {
    return `本日 ${hour}:${minute}`;
  }

  if (tomorrow.year === year && tomorrow.month === month && tomorrow.day === day) {
    return `明日 ${hour}:${minute}`;
  }

  return `${month}/${day} ${hour}:${minute}`;
}

function deadlineAtFromInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:00+09:00`;
}

function normalizeRequestedQuantity(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(999, Math.max(1, Math.round(value)));
}

async function validateOrderInput(storeName: string, productNames: string[], productIds: string[]) {
  if (!storeName) {
    return { error: Response.json({ error: "配達先店舗を選択してください。" }, { status: 400 }) };
  }

  if (productNames.length === 0) {
    return { error: Response.json({ error: "商品を1件以上選択してください。" }, { status: 400 }) };
  }

  const stores = await sql`
    select id
    from stores
    where name = ${storeName}
    limit 1
  `;
  const storeId = stores[0]?.id as string | undefined;

  if (!storeId) {
    return { error: Response.json({ error: "配達先店舗が見つかりません。" }, { status: 400 }) };
  }

  const uniqueProductIds = Array.from(new Set(productIds.filter(Boolean)));
  const productRows = uniqueProductIds.length > 0
    ? await sql`
    select id, name
    from products
    where id::text = any(${uniqueProductIds})
  `
    : await sql`
    select id, name
    from products
    where name = any(${Array.from(new Set(productNames))})
  `;
  const productIdsByName = new Map(productRows.map((row) => [String(row.name), String(row.id)]));
  const validProductIds = new Set(productRows.map((row) => String(row.id)));
  const missingProducts = uniqueProductIds.length > 0
    ? productIds.filter((id) => id && !validProductIds.has(id))
    : productNames.filter((name) => !productIdsByName.has(name));

  if (missingProducts.length > 0) {
    return {
      error: Response.json(
        { error: `商品マスタに存在しない商品があります: ${Array.from(new Set(missingProducts)).join("、")}` },
        { status: 400 }
      )
    };
  }

  return { storeId, productIdsByName, validProductIds };
}

export async function POST(request: Request) {
  const session = await requireWritableOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const storeName = String(formData.get("store") ?? "");
  const deadlineInput = String(formData.get("deadline") ?? "");
  const deadline = formatDeadlineLabel(deadlineInput);
  const deadlineAt = deadlineAtFromInput(deadlineInput);
  const priority = String(formData.get("priority") ?? "中");
  const note = String(formData.get("note") ?? "");
  const productNames = formData.getAll("productName").map((value) => String(value)).filter(Boolean);
  const productIds = formData.getAll("productId").map((value) => String(value));
  const quantities = formData.getAll("requestedQuantity").map((value) => Number(value));
  const units = formData.getAll("requestedUnit").map((value) => String(value));
  const itemCount = productNames.length;
  const orderNo = `PO-${new Date().toISOString().slice(5, 10).replace("-", "")}-${Date.now().toString().slice(-3)}`;
  const validation = await validateOrderInput(storeName, productNames, productIds);
  if (validation.error) return validation.error;

  const insertedOrders = await sql`
    insert into purchase_orders (
      order_no,
      store_id,
      deadline_label,
      deadline_at,
      requested_item_count,
      priority,
      status,
      note
    )
    values (
      ${orderNo},
      ${validation.storeId},
      ${deadline},
      ${deadlineAt},
      ${itemCount},
      ${priority},
      ${"仕入れ待ち"},
      ${note}
    )
    returning id
  `;

  const purchaseOrderId = insertedOrders[0]?.id;

  if (purchaseOrderId) {
    for (const [index, productName] of productNames.entries()) {
      const quantity = normalizeRequestedQuantity(quantities[index]);
      const unit = units[index] || "個";
      const productId = productIds[index] || validation.productIdsByName?.get(productName);

      await sql`
        insert into purchase_order_items (
          purchase_order_id,
          product_id,
          requested_quantity,
          requested_unit,
          status
        )
        values (
          ${purchaseOrderId},
          ${productId},
          ${quantity},
          ${unit},
          ${"requested"}
        )
      `;
    }
  }

  return Response.json({ ok: true, orderId: orderNo });
}

export async function PUT(request: Request) {
  const session = await requireWritableOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const orderId = String(formData.get("orderId") ?? "");
  const storeName = String(formData.get("store") ?? "");
  const deadlineInput = String(formData.get("deadline") ?? "");
  const deadline = formatDeadlineLabel(deadlineInput);
  const deadlineAt = deadlineAtFromInput(deadlineInput);
  const priority = String(formData.get("priority") ?? "中");
  const note = String(formData.get("note") ?? "");
  const productNames = formData.getAll("productName").map((value) => String(value)).filter(Boolean);
  const productIds = formData.getAll("productId").map((value) => String(value));
  const quantities = formData.getAll("requestedQuantity").map((value) => Number(value));
  const units = formData.getAll("requestedUnit").map((value) => String(value));

  if (!orderId) {
    return Response.json({ error: "依頼番号が必要です。" }, { status: 400 });
  }

  if (productNames.length === 0) {
    return Response.json({ error: "商品を1件以上選択してください。" }, { status: 400 });
  }

  const validation = await validateOrderInput(storeName, productNames, productIds);
  if (validation.error) return validation.error;

  const existingOrder = await sql`
    select id
    from purchase_orders
    where order_no = ${orderId}
    limit 1
  `;
  const purchaseOrderId = existingOrder[0]?.id;

  if (!purchaseOrderId) {
    return Response.json({ error: "仕入れ依頼が見つかりません。" }, { status: 404 });
  }

  const lockedItems = await sql`
    select count(*)::int as count
    from purchase_order_items
    where purchase_order_id = ${purchaseOrderId}
      and (
        status in ('purchased', 'in_delivery', 'delivered')
        or exists (
          select 1
          from purchase_actuals
          where purchase_actuals.purchase_order_item_id = purchase_order_items.id
        )
      )
  `;

  if (Number(lockedItems[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "仕入れ処理が始まっている依頼は編集できません。必要な変更は備考または追加依頼で対応してください。" },
      { status: 409 }
    );
  }

  const updatedOrders = await sql`
    update purchase_orders
    set
      store_id = ${validation.storeId},
      deadline_label = ${deadline},
      deadline_at = ${deadlineAt},
      requested_item_count = ${productNames.length},
      priority = ${priority},
      note = ${note},
      updated_at = now()
    where purchase_orders.id = ${purchaseOrderId}
    returning purchase_orders.id
  `;

  if (!updatedOrders[0]?.id) {
    return Response.json({ error: "配達先店舗が見つかりません。" }, { status: 400 });
  }

  await sql`
    delete from purchase_order_items
    where purchase_order_id = ${purchaseOrderId}
  `;

  for (const [index, productName] of productNames.entries()) {
    const quantity = normalizeRequestedQuantity(quantities[index]);
    const unit = units[index] || "個";
    const productId = productIds[index] || validation.productIdsByName?.get(productName);

    await sql`
      insert into purchase_order_items (
        purchase_order_id,
        product_id,
        requested_quantity,
        requested_unit,
        status
      )
      values (
        ${purchaseOrderId},
        ${productId},
        ${quantity},
        ${unit},
        ${"requested"}
      )
    `;
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireWritableOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as { orderId?: string };

  if (!body.orderId) {
    return Response.json({ error: "orderId is required" }, { status: 400 });
  }

  await sql`
    delete from purchase_orders
    where order_no = ${body.orderId}
  `;

  return Response.json({ ok: true });
}
