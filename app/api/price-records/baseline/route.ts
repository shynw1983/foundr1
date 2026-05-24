import { requireMasterOpsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

export async function PATCH(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    productId?: string;
    supplierId?: string | null;
    price?: number;
  };
  const productId = String(body.productId ?? "").trim();
  const supplierId = body.supplierId ? String(body.supplierId).trim() : "";
  const price = Number(body.price);

  if (!productId || !Number.isFinite(price) || price <= 0) {
    return Response.json({ error: "商品と基準価格を指定してください。" }, { status: 400 });
  }

  const productRows = await sql`
    update products
    set reference_price = ${price}, updated_at = now()
    where id = ${productId}
    returning id
  `;

  if (!productRows[0]?.id) {
    return Response.json({ error: "商品が見つかりません。" }, { status: 404 });
  }

  if (supplierId) {
    const updatedOptions = await sql`
      update product_supplier_options
      set reference_price = ${price}, is_active = true
      where product_id = ${productId}
        and supplier_id = ${supplierId}
      returning id
    `;

    if (updatedOptions.length === 0) {
      await sql`
        insert into product_supplier_options (
          product_id,
          supplier_id,
          role,
          reference_price,
          is_active
        )
        values (
          ${productId},
          ${supplierId},
          'メイン',
          ${price},
          true
        )
        on conflict (product_id, supplier_id, role)
        do update set
          reference_price = excluded.reference_price,
          is_active = true
      `;
    }
  }

  return Response.json({ ok: true });
}
