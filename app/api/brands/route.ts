import { requireMasterOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

export async function POST(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

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

export async function PUT(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const currentName = String(formData.get("currentName") ?? "").trim();
  const nextName = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();

  if (!currentName || !nextName) {
    return Response.json({ error: "ブランド名を入力してください。" }, { status: 400 });
  }

  const duplicateRows = await sql`
    select count(*)::int as count
    from brands
    where name = ${nextName}
      and name <> ${currentName}
  `;

  if (Number(duplicateRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "同じ名前のブランドがすでにあります。" },
      { status: 409 }
    );
  }

  const updatedRows = await sql`
    update brands
    set
      name = ${nextName},
      brand_type = ${type || "未設定"},
      updated_at = now()
    where name = ${currentName}
    returning id
  `;

  if (!updatedRows[0]?.id) {
    return Response.json({ error: "ブランドが見つかりません。" }, { status: 404 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

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
      { error: "このブランドは商品または発注履歴で使用されているため削除できません。" },
      { status: 409 }
    );
  }

  await sql`
    delete from brands
    where name = ${body.name}
  `;

  return Response.json({ ok: true });
}
