import { requireMasterOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

export async function POST(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const channelType = String(formData.get("channelType") ?? "").trim();
  const reliability = String(formData.get("reliability") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim();
  const businessHours = String(formData.get("businessHours") ?? "").trim();
  const orderUrl = String(formData.get("orderUrl") ?? "").trim();

  if (!name) {
    return Response.json({ error: "発注先名を入力してください。" }, { status: 400 });
  }

  await sql`
    insert into suppliers (
      name,
      category,
      channel_type,
      reliability,
      address,
      phone,
      contact_person,
      business_hours,
      order_url,
      updated_at
    )
    values (
      ${name},
      ${category || null},
      ${channelType || "実店舗"},
      ${reliability || null},
      ${address || null},
      ${phone || null},
      ${contactPerson || null},
      ${businessHours || null},
      ${orderUrl || null},
      now()
    )
    on conflict (name)
    do update set
      category = excluded.category,
      channel_type = excluded.channel_type,
      reliability = excluded.reliability,
      address = excluded.address,
      phone = excluded.phone,
      contact_person = excluded.contact_person,
      business_hours = excluded.business_hours,
      order_url = excluded.order_url,
      updated_at = now()
  `;

  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const currentName = String(formData.get("currentName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const channelType = String(formData.get("channelType") ?? "").trim();
  const reliability = String(formData.get("reliability") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim();
  const businessHours = String(formData.get("businessHours") ?? "").trim();
  const orderUrl = String(formData.get("orderUrl") ?? "").trim();

  if (!currentName || !name) {
    return Response.json({ error: "発注先名を入力してください。" }, { status: 400 });
  }

  const duplicateRows = await sql`
    select count(*)::int as count
    from suppliers
    where name = ${name}
      and name <> ${currentName}
  `;

  if (Number(duplicateRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "同じ名前の発注先がすでにあります。" },
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
      address = ${address || null},
      phone = ${phone || null},
      contact_person = ${contactPerson || null},
      business_hours = ${businessHours || null},
      order_url = ${orderUrl || null},
      updated_at = now()
    where name = ${currentName}
    returning id
  `;

  if (!rows[0]?.id) {
    return Response.json({ error: "発注先が見つかりません。" }, { status: 404 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as { name?: string };
  const name = String(body.name ?? "").trim();

  if (!name) {
    return Response.json({ error: "発注先名が必要です。" }, { status: 400 });
  }

  const rows = await sql`
    select id
    from suppliers
    where name = ${name}
  `;
  const supplierId = rows[0]?.id;

  if (!supplierId) {
    return Response.json({ error: "発注先が見つかりません。" }, { status: 404 });
  }

  await sql`
    update purchase_actuals
    set supplier_location_id = null
    where supplier_location_id in (
      select id from supplier_locations where supplier_id = ${supplierId}
    )
  `;
  await sql`
    update purchase_actuals
    set supplier_id = null
    where supplier_id = ${supplierId}
  `;
  await sql`
    update price_records
    set supplier_location_id = null
    where supplier_location_id in (
      select id from supplier_locations where supplier_id = ${supplierId}
    )
  `;
  await sql`
    update price_records
    set supplier_id = null
    where supplier_id = ${supplierId}
  `;
  await sql`
    update employee_scopes
    set supplier_id = null
    where supplier_id = ${supplierId}
  `;
  await sql`
    delete from product_supplier_options
    where supplier_id = ${supplierId}
  `;
  await sql`
    delete from supplier_locations
    where supplier_id = ${supplierId}
  `;
  await sql`
    delete from suppliers
    where id = ${supplierId}
  `;

  return Response.json({ ok: true });
}
