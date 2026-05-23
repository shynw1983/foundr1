import { sql } from "../../../lib/db";

type ProductPayload = {
  currentName?: string;
  name?: string;
  category?: string;
  subcategory?: string;
  unit?: string;
  referencePrice?: number;
  originCountries?: string[];
  packageSpec?: string;
  brand?: string;
  mainSupplier?: string;
  backupSupplier?: string;
  specNote?: string;
  photoUrl?: string;
  storageType?: string;
};

export async function PUT(request: Request) {
  const body = await request.json() as ProductPayload;
  const currentName = String(body.currentName ?? "").trim();
  const name = String(body.name ?? "").trim();
  const category = String(body.category ?? "").trim() || "未分類";
  const subcategory = String(body.subcategory ?? "").trim() || "未分類";
  const unit = String(body.unit ?? "").trim() || "個";
  const referencePrice = Number(body.referencePrice ?? 0);
  const originCountries = Array.isArray(body.originCountries)
    ? body.originCountries.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const packageSpec = String(body.packageSpec ?? "");
  const specNote = String(body.specNote ?? "");
  const photoUrl = String(body.photoUrl ?? "");
  const storageType = String(body.storageType ?? "");

  if (!name) {
    return Response.json({ error: "商品名を入力してください。" }, { status: 400 });
  }

  const duplicateRows = await sql`
    select count(*)::int as count
    from products
    where name = ${name}
      and (${currentName || null}::text is null or name <> ${currentName})
  `;

  if (Number(duplicateRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "同じ名前の商品がすでにあります。" },
      { status: 409 }
    );
  }

  const rows = currentName
    ? await sql`
        update products
        set
          name = ${name},
          category = ${category},
          subcategory = ${subcategory},
          unit = ${unit},
          reference_price = ${Number.isFinite(referencePrice) ? referencePrice : 0},
          origin_countries = ${originCountries},
          package_spec = ${packageSpec},
          spec_note = ${specNote},
          photo_url = ${photoUrl},
          storage_type = ${storageType},
          updated_at = now()
        where name = ${currentName}
        returning id
      `
    : await sql`
        insert into products (
          name,
          category,
          subcategory,
          unit,
          reference_price,
          origin_countries,
          package_spec,
          spec_note,
          photo_url,
          storage_type,
          updated_at
        )
        values (
          ${name},
          ${category},
          ${subcategory},
          ${unit},
          ${Number.isFinite(referencePrice) ? referencePrice : 0},
          ${originCountries},
          ${packageSpec},
          ${specNote},
          ${photoUrl},
          ${storageType},
          now()
        )
        returning id
      `;

  const productId = rows[0]?.id;

  if (!productId) {
    return Response.json({ error: "商品が見つかりません。" }, { status: 404 });
  }

  await sql`delete from product_brand_usages where product_id = ${productId}`;
  if (body.brand && body.brand !== "共通") {
    for (const brandName of String(body.brand).split("/").map((item) => item.trim()).filter(Boolean)) {
      await sql`
        insert into product_brand_usages (product_id, brand_id)
        select ${productId}, brands.id
        from brands
        where brands.name = ${brandName}
        on conflict do nothing
      `;
    }
  }

  await sql`
    delete from product_supplier_options
    where product_id = ${productId}
      and role in ('メイン', '予備')
  `;

  for (const option of [
    { role: "メイン", supplier: body.mainSupplier, price: Number.isFinite(referencePrice) ? referencePrice : 0 },
    { role: "予備", supplier: body.backupSupplier, price: null }
  ]) {
    const supplierName = String(option.supplier ?? "").trim();
    if (!supplierName) continue;

    await sql`
      insert into product_supplier_options (product_id, supplier_id, role, reference_price, is_active)
      select ${productId}, suppliers.id, ${option.role}, ${option.price}, true
      from suppliers
      where suppliers.name = ${supplierName}
      on conflict (product_id, supplier_id, role)
      do update set
        reference_price = excluded.reference_price,
        is_active = true
    `;
  }

  return Response.json({ ok: true });
}

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
