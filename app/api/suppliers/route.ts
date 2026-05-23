import { sql } from "../../../lib/db";

export async function POST(request: Request) {
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const channelType = String(formData.get("channelType") ?? "").trim();
  const reliability = String(formData.get("reliability") ?? "").trim();

  if (!name) {
    return Response.json({ error: "仕入れ先名を入力してください。" }, { status: 400 });
  }

  await sql`
    insert into suppliers (name, category, channel_type, reliability, updated_at)
    values (${name}, ${category || null}, ${channelType || "実店舗"}, ${reliability || null}, now())
    on conflict (name)
    do update set
      category = excluded.category,
      channel_type = excluded.channel_type,
      reliability = excluded.reliability,
      updated_at = now()
  `;

  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const formData = await request.formData();
  const currentName = String(formData.get("currentName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const channelType = String(formData.get("channelType") ?? "").trim();
  const reliability = String(formData.get("reliability") ?? "").trim();

  if (!currentName || !name) {
    return Response.json({ error: "仕入れ先名を入力してください。" }, { status: 400 });
  }

  const duplicateRows = await sql`
    select count(*)::int as count
    from suppliers
    where name = ${name}
      and name <> ${currentName}
  `;

  if (Number(duplicateRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "同じ名前の仕入れ先がすでにあります。" },
      { status: 409 }
    );
  }

  const rows = await sql`
    update suppliers
    set
      name = ${name},
      category = ${category || null},
      channel_type = ${channelType || "実店舗"},
      reliability = ${reliability || null},
      updated_at = now()
    where name = ${currentName}
    returning id
  `;

  if (!rows[0]?.id) {
    return Response.json({ error: "仕入れ先が見つかりません。" }, { status: 404 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json() as { name?: string };
  const name = String(body.name ?? "").trim();

  if (!name) {
    return Response.json({ error: "仕入れ先名が必要です。" }, { status: 400 });
  }

  const linkedRows = await sql`
    select count(*)::int as count
    from purchase_order_items
    join suppliers on suppliers.id = purchase_order_items.supplier_id
    where suppliers.name = ${name}
  `;

  if (Number(linkedRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "この仕入れ先は仕入れ記録で使用されているため削除できません。" },
      { status: 409 }
    );
  }

  await sql`
    delete from suppliers
    where name = ${name}
  `;

  return Response.json({ ok: true });
}
