import { requireMasterOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

async function normalizeStoreBrands(brandNames: string[]) {
  const concreteBrands = await sql`
    select name
    from brands
    where name <> '共通'
    order by name
  `;
  const concreteBrandNames = concreteBrands.map((brand) => String(brand.name));

  if (brandNames.includes("共通")) return concreteBrandNames;

  return Array.from(new Set(brandNames.filter((brandName) => brandName && brandName !== "共通")));
}

export async function POST(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const owner = String(formData.get("owner") ?? "").trim();
  const brandNames = await normalizeStoreBrands(formData.getAll("brand").map((value) => String(value)));

  if (!name) {
    return Response.json({ error: "店舗名を入力してください。" }, { status: 400 });
  }

  const rows = await sql`
    insert into stores (name, owner_name, updated_at)
    values (${name}, ${owner}, now())
    on conflict (name)
    do update set
      owner_name = excluded.owner_name,
      updated_at = now()
    returning id
  `;
  const storeId = rows[0]?.id;

  await sql`delete from store_brands where store_id = ${storeId}`;

  for (const brandName of brandNames) {
    await sql`
      insert into store_brands (store_id, brand_id)
      select ${storeId}, brands.id
      from brands
      where brands.name = ${brandName}
      on conflict do nothing
    `;
  }

  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const currentName = String(formData.get("currentName") ?? "").trim();
  const nextName = String(formData.get("name") ?? "").trim();
  const owner = String(formData.get("owner") ?? "").trim();
  const brandNames = await normalizeStoreBrands(formData.getAll("brand").map((value) => String(value)));

  if (!currentName || !nextName) {
    return Response.json({ error: "店舗名を入力してください。" }, { status: 400 });
  }

  const duplicateRows = await sql`
    select count(*)::int as count
    from stores
    where name = ${nextName}
      and name <> ${currentName}
  `;

  if (Number(duplicateRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "同じ名前の店舗がすでにあります。" },
      { status: 409 }
    );
  }

  const rows = await sql`
    update stores
    set
      name = ${nextName},
      owner_name = ${owner},
      updated_at = now()
    where name = ${currentName}
    returning id
  `;
  const storeId = rows[0]?.id;

  if (!storeId) {
    return Response.json({ error: "店舗が見つかりません。" }, { status: 404 });
  }

  await sql`delete from store_brands where store_id = ${storeId}`;

  for (const brandName of brandNames) {
    await sql`
      insert into store_brands (store_id, brand_id)
      select ${storeId}, brands.id
      from brands
      where brands.name = ${brandName}
      on conflict do nothing
    `;
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as { name?: string };

  if (!body.name) {
    return Response.json({ error: "店舗名が必要です。" }, { status: 400 });
  }

  const linkedOrders = await sql`
    select count(*)::int as count
    from purchase_orders
    join stores on stores.id = purchase_orders.store_id
    where stores.name = ${body.name}
  `;

  if (Number(linkedOrders[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "この店舗は発注依頼で使用されているため削除できません。" },
      { status: 409 }
    );
  }

  await sql`
    delete from stores
    where name = ${body.name}
  `;

  return Response.json({ ok: true });
}
