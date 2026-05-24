import { requireMasterOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

export async function POST(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const category = String(formData.get("category") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!category || !name) {
    return Response.json({ error: "大分類と小分類名を入力してください。" }, { status: 400 });
  }

  await sql`
    insert into product_subcategories (category_id, name, updated_at)
    select product_categories.id, ${name}, now()
    from product_categories
    where product_categories.name = ${category}
    on conflict (category_id, name)
    do update set updated_at = now()
  `;

  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const currentCategory = String(formData.get("currentCategory") ?? "").trim();
  const currentName = String(formData.get("currentName") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!currentCategory || !currentName || !category || !name) {
    return Response.json({ error: "大分類と小分類名を入力してください。" }, { status: 400 });
  }

  const duplicateRows = await sql`
    select count(*)::int as count
    from product_subcategories
    join product_categories on product_categories.id = product_subcategories.category_id
    where product_categories.name = ${category}
      and product_subcategories.name = ${name}
      and not (product_categories.name = ${currentCategory} and product_subcategories.name = ${currentName})
  `;

  if (Number(duplicateRows[0]?.count ?? 0) > 0) {
    return Response.json({ error: "同じ小分類がすでにあります。" }, { status: 409 });
  }

  const rows = await sql`
    update product_subcategories
    set
      category_id = next_categories.id,
      name = ${name},
      updated_at = now()
    from product_categories current_categories, product_categories next_categories
    where product_subcategories.category_id = current_categories.id
      and current_categories.name = ${currentCategory}
      and product_subcategories.name = ${currentName}
      and next_categories.name = ${category}
    returning product_subcategories.id
  `;

  if (!rows[0]?.id) {
    return Response.json({ error: "小分類が見つかりません。" }, { status: 404 });
  }

  await sql`
    update products
    set category = ${category}, subcategory = ${name}, updated_at = now()
    where category = ${currentCategory}
      and coalesce(subcategory, '未分類') = ${currentName}
  `;

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as { category?: string; name?: string };

  if (!body.category || !body.name) {
    return Response.json({ error: "大分類と小分類名が必要です。" }, { status: 400 });
  }

  const linkedRows = await sql`
    select count(*)::int as count
    from products
    where category = ${body.category}
      and coalesce(subcategory, '未分類') = ${body.name}
  `;

  if (Number(linkedRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "この小分類は商品で使用されているため削除できません。" },
      { status: 409 }
    );
  }

  await sql`
    delete from product_subcategories
    using product_categories
    where product_subcategories.category_id = product_categories.id
      and product_categories.name = ${body.category}
      and product_subcategories.name = ${body.name}
  `;

  return Response.json({ ok: true });
}
