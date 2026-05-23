import { sql } from "../../../lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return Response.json({ error: "大分類名を入力してください。" }, { status: 400 });
  }

  await sql`
    insert into product_categories (name, updated_at)
    values (${name}, now())
    on conflict (name)
    do update set updated_at = now()
  `;

  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const formData = await request.formData();
  const currentName = String(formData.get("currentName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!currentName || !name) {
    return Response.json({ error: "大分類名を入力してください。" }, { status: 400 });
  }

  const duplicateRows = await sql`
    select count(*)::int as count
    from product_categories
    where name = ${name}
      and name <> ${currentName}
  `;

  if (Number(duplicateRows[0]?.count ?? 0) > 0) {
    return Response.json({ error: "同じ大分類がすでにあります。" }, { status: 409 });
  }

  const rows = await sql`
    update product_categories
    set name = ${name}, updated_at = now()
    where name = ${currentName}
    returning id
  `;

  if (!rows[0]?.id) {
    return Response.json({ error: "大分類が見つかりません。" }, { status: 404 });
  }

  await sql`
    update products
    set category = ${name}, updated_at = now()
    where category = ${currentName}
  `;

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json() as { name?: string };

  if (!body.name) {
    return Response.json({ error: "大分類名が必要です。" }, { status: 400 });
  }

  const linkedRows = await sql`
    select count(*)::int as count
    from products
    where category = ${body.name}
  `;

  if (Number(linkedRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "この大分類は商品で使用されているため削除できません。" },
      { status: 409 }
    );
  }

  await sql`
    delete from product_categories
    where name = ${body.name}
  `;

  return Response.json({ ok: true });
}
