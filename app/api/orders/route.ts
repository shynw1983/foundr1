import { redirect } from "next/navigation";
import { sql } from "../../../lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const storeName = String(formData.get("store") ?? "");
  const brandName = String(formData.get("brand") ?? "");
  const deadline = String(formData.get("deadline") ?? "");
  const priority = String(formData.get("priority") ?? "中");
  const note = String(formData.get("note") ?? "");
  const productNames = formData.getAll("productName").map((value) => String(value)).filter(Boolean);
  const quantities = formData.getAll("requestedQuantity").map((value) => Number(value));
  const units = formData.getAll("requestedUnit").map((value) => String(value));
  const itemCount = productNames.length;
  const orderNo = `PO-${new Date().toISOString().slice(5, 10).replace("-", "")}-${Date.now().toString().slice(-3)}`;

  const insertedOrders = await sql`
    insert into purchase_orders (
      order_no,
      store_id,
      brand_id,
      deadline_label,
      requested_item_count,
      priority,
      status,
      note
    )
    select
      ${orderNo},
      stores.id,
      brands.id,
      ${deadline},
      ${itemCount},
      ${priority},
      ${"仕入れ待ち"},
      ${note}
    from stores, brands
    where stores.name = ${storeName}
      and brands.name = ${brandName}
    returning id
  `;

  const purchaseOrderId = insertedOrders[0]?.id;

  if (purchaseOrderId) {
    for (const [index, productName] of productNames.entries()) {
      const quantity = Number.isFinite(quantities[index]) && quantities[index] > 0 ? quantities[index] : 1;
      const unit = units[index] || "個";

      await sql`
        insert into purchase_order_items (
          purchase_order_id,
          product_id,
          requested_quantity,
          requested_unit,
          status
        )
        select
          ${purchaseOrderId},
          products.id,
          ${quantity},
          ${unit},
          ${"requested"}
        from products
        where products.name = ${productName}
      `;
    }
  }

  redirect("/ops/orders");
}
