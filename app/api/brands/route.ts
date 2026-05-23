import { sql } from "../../../lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();

  if (!name) {
    return Response.json({ error: "ブランド名を入力してください。" }, { status: 400 });
  }

  await sql`
    insert into brands (name, brand_type, updated_at)
    values (${name}, ${type || "未設定"}, now())
    on conflict (name)
    do update set
      brand_type = excluded.brand_type,
      updated_at = now()
  `;

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json() as { name?: string };

  if (!body.name) {
    return Response.json({ error: "ブランド名が必要です。" }, { status: 400 });
  }

  const linkedRows = await sql`
    select
      (
        select count(*) from purchase_orders
        join brands on brands.id = purchase_orders.brand_id
        where brands.name = ${body.name}
      )::int +
      (
        select count(*) from purchase_order_items
        join brands on brands.id = purchase_order_items.brand_id
        where brands.name = ${body.name}
      )::int +
      (
        select count(*) from product_brand_usages
        join brands on brands.id = product_brand_usages.brand_id
        where brands.name = ${body.name}
      )::int as count
  `;

  if (Number(linkedRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "このブランドは商品または仕入れ履歴で使用されているため削除できません。" },
      { status: 409 }
    );
  }

  await sql`
    delete from brands
    where name = ${body.name}
  `;

  return Response.json({ ok: true });
}
