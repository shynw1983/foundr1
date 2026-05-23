import { sql } from "../../../lib/db";

export async function DELETE(request: Request) {
  const body = await request.json() as { productName?: string };

  if (!body.productName) {
    return Response.json({ error: "productName is required" }, { status: 400 });
  }

  const linkedItems = await sql`
    select count(*)::int as count
    from purchase_order_items
    join products on products.id = purchase_order_items.product_id
    where products.name = ${body.productName}
  `;

  if (Number(linkedItems[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "この商品は仕入れ履歴で使用されているため削除できません。" },
      { status: 409 }
    );
  }

  await sql`
    delete from products
    where name = ${body.productName}
  `;

  return Response.json({ ok: true });
}
