import { redirect } from "next/navigation";
import { sql } from "../../../lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const storeName = String(formData.get("store") ?? "");
  const brandName = String(formData.get("brand") ?? "");
  const deadline = String(formData.get("deadline") ?? "");
  const priority = String(formData.get("priority") ?? "中");
  const items = Number(formData.get("items") ?? 1);
  const note = String(formData.get("note") ?? "");
  const orderNo = `PO-${new Date().toISOString().slice(5, 10).replace("-", "")}-${Date.now().toString().slice(-3)}`;

  await sql`
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
      ${Number.isFinite(items) ? items : 1},
      ${priority},
      ${"仕入れ待ち"},
      ${note}
    from stores, brands
    where stores.name = ${storeName}
      and brands.name = ${brandName}
  `;

  redirect("/");
}
