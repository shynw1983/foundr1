import { redirect } from "next/navigation";
import { sql } from "../../../lib/db";

function formatDeadlineLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (!match) {
    return value;
  }

  const [, year, month, day, hour, minute] = match;
  const deadlineDate = new Date(Number(year), Number(month) - 1, Number(day));
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const sameDate = (target: Date) =>
    target.getFullYear() === deadlineDate.getFullYear() &&
    target.getMonth() === deadlineDate.getMonth() &&
    target.getDate() === deadlineDate.getDate();

  if (sameDate(today)) {
    return `本日 ${hour}:${minute}`;
  }

  if (sameDate(tomorrow)) {
    return `明日 ${hour}:${minute}`;
  }

  return `${month}/${day} ${hour}:${minute}`;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const storeName = String(formData.get("store") ?? "");
  const deadline = formatDeadlineLabel(String(formData.get("deadline") ?? ""));
  const priority = String(formData.get("priority") ?? "中");
  const note = String(formData.get("note") ?? "");
  const productNames = formData.getAll("productName").map((value) => String(value)).filter(Boolean);
  const brandNames = formData.getAll("itemBrand").map((value) => String(value));
  const quantities = formData.getAll("requestedQuantity").map((value) => Number(value));
  const units = formData.getAll("requestedUnit").map((value) => String(value));
  const itemCount = productNames.length;
  const orderNo = `PO-${new Date().toISOString().slice(5, 10).replace("-", "")}-${Date.now().toString().slice(-3)}`;

  const insertedOrders = await sql`
    insert into purchase_orders (
      order_no,
      store_id,
      deadline_label,
      requested_item_count,
      priority,
      status,
      note
    )
    select
      ${orderNo},
      stores.id,
      ${deadline},
      ${itemCount},
      ${priority},
      ${"仕入れ待ち"},
      ${note}
    from stores
    where stores.name = ${storeName}
    returning id
  `;

  const purchaseOrderId = insertedOrders[0]?.id;

  if (purchaseOrderId) {
    for (const [index, productName] of productNames.entries()) {
      const quantity = Number.isFinite(quantities[index]) && quantities[index] > 0 ? quantities[index] : 1;
      const unit = units[index] || "個";
      const brandName = brandNames[index] || "共通";

      await sql`
        insert into purchase_order_items (
          purchase_order_id,
          product_id,
          brand_id,
          requested_quantity,
          requested_unit,
          status
        )
        select
          ${purchaseOrderId},
          products.id,
          brands.id,
          ${quantity},
          ${unit},
          ${"requested"}
        from products, brands
        where products.name = ${productName}
          and brands.name = ${brandName}
      `;
    }
  }

  redirect("/ops/orders");
}

export async function PUT(request: Request) {
  const formData = await request.formData();
  const orderId = String(formData.get("orderId") ?? "");
  const storeName = String(formData.get("store") ?? "");
  const deadline = formatDeadlineLabel(String(formData.get("deadline") ?? ""));
  const priority = String(formData.get("priority") ?? "中");
  const note = String(formData.get("note") ?? "");
  const productNames = formData.getAll("productName").map((value) => String(value)).filter(Boolean);
  const brandNames = formData.getAll("itemBrand").map((value) => String(value));
  const quantities = formData.getAll("requestedQuantity").map((value) => Number(value));
  const units = formData.getAll("requestedUnit").map((value) => String(value));

  if (!orderId) {
    return Response.json({ error: "依頼番号が必要です。" }, { status: 400 });
  }

  if (productNames.length === 0) {
    return Response.json({ error: "商品を1件以上選択してください。" }, { status: 400 });
  }

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
      store_id = stores.id,
      deadline_label = ${deadline},
      requested_item_count = ${productNames.length},
      priority = ${priority},
      note = ${note},
      updated_at = now()
    from stores
    where purchase_orders.id = ${purchaseOrderId}
      and stores.name = ${storeName}
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
    const quantity = Number.isFinite(quantities[index]) && quantities[index] > 0 ? quantities[index] : 1;
    const unit = units[index] || "個";
    const brandName = brandNames[index] || "共通";

    await sql`
      insert into purchase_order_items (
        purchase_order_id,
        product_id,
        brand_id,
        requested_quantity,
        requested_unit,
        status
      )
      select
        ${purchaseOrderId},
        products.id,
        brands.id,
        ${quantity},
        ${unit},
        ${"requested"}
      from products, brands
      where products.name = ${productName}
        and brands.name = ${brandName}
    `;
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
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
