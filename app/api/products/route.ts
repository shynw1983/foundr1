import { requireMasterOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

type ProductPayload = {
  id?: string;
  currentName?: string;
  name?: string;
  productBrandName?: string;
  manufacturer?: string;
  category?: string;
  subcategory?: string;
  unit?: string;
  referencePrice?: number;
  originCountries?: string[];
  packageQuantity?: number | string;
  packageQuantityUnit?: string;
  packageSpec?: string;
  brand?: string;
  mainSupplier?: string;
  backupSupplier?: string;
  mainPurchaseUrl?: string;
  backupPurchaseUrl?: string;
  specNote?: string;
  japaneseNote?: string;
  photoUrl?: string;
  storageType?: string;
};

export async function PUT(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as ProductPayload;
  const id = String(body.id ?? "").trim();
  const currentName = String(body.currentName ?? "").trim();
  const name = String(body.name ?? "").trim();
  const productBrandName = String(body.productBrandName ?? "").trim();
  const manufacturer = String(body.manufacturer ?? "").trim();
  const category = String(body.category ?? "").trim() || "未分類";
  const subcategory = String(body.subcategory ?? "").trim() || "未分類";
  const unit = String(body.unit ?? "").trim() || "個";
  const referencePrice = Number(body.referencePrice ?? 0);
  const packageQuantity = parseOptionalNumber(body.packageQuantity);
  const packageQuantityUnit = String(body.packageQuantityUnit ?? "").trim();
  const originCountries = Array.isArray(body.originCountries)
    ? body.originCountries.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const packageSpec = String(body.packageSpec ?? "");
  const specNote = String(body.specNote ?? "");
  const japaneseNote = String(body.japaneseNote ?? "");
  const photoUrl = String(body.photoUrl ?? "");
  const storageType = String(body.storageType ?? "");
  const selectedBrands = String(body.brand ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  const brandScope = selectedBrands.includes("共通")
    ? "common"
    : selectedBrands.filter((brandName) => brandName !== "未設定").length > 0
      ? "specific"
      : "unset";

  if (!name) {
    return Response.json({ error: "商品名を入力してください。" }, { status: 400 });
  }

  const rows = id
    ? await sql`
        update products
        set
          name = ${name},
          product_brand_name = ${productBrandName},
          manufacturer = ${manufacturer},
          category = ${category},
          subcategory = ${subcategory},
          unit = ${unit},
          reference_price = ${Number.isFinite(referencePrice) ? referencePrice : 0},
          origin_countries = ${originCountries},
          package_quantity = ${packageQuantity},
          package_quantity_unit = ${packageQuantity ? packageQuantityUnit || unit : ""},
          package_spec = ${packageSpec},
          spec_note = ${specNote},
          japanese_note = ${japaneseNote},
          photo_url = ${photoUrl},
          brand_scope = ${brandScope},
          storage_type = ${storageType},
          updated_at = now()
        where id = ${id}
        returning id
      `
    : currentName
      ? await sql`
        update products
        set
          name = ${name},
          product_brand_name = ${productBrandName},
          manufacturer = ${manufacturer},
          category = ${category},
          subcategory = ${subcategory},
          unit = ${unit},
          reference_price = ${Number.isFinite(referencePrice) ? referencePrice : 0},
          origin_countries = ${originCountries},
          package_quantity = ${packageQuantity},
          package_quantity_unit = ${packageQuantity ? packageQuantityUnit || unit : ""},
          package_spec = ${packageSpec},
          spec_note = ${specNote},
          japanese_note = ${japaneseNote},
          photo_url = ${photoUrl},
          brand_scope = ${brandScope},
          storage_type = ${storageType},
          updated_at = now()
        where name = ${currentName}
        returning id
      `
      : await sql`
        insert into products (
          name,
          product_brand_name,
          manufacturer,
          category,
          subcategory,
          unit,
          reference_price,
          origin_countries,
          package_quantity,
          package_quantity_unit,
          package_spec,
          spec_note,
          japanese_note,
          photo_url,
          brand_scope,
          storage_type,
          updated_at
        )
        values (
          ${name},
          ${productBrandName},
          ${manufacturer},
          ${category},
          ${subcategory},
          ${unit},
          ${Number.isFinite(referencePrice) ? referencePrice : 0},
          ${originCountries},
          ${packageQuantity},
          ${packageQuantity ? packageQuantityUnit || unit : ""},
          ${packageSpec},
          ${specNote},
          ${japaneseNote},
          ${photoUrl},
          ${brandScope},
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
  if (brandScope === "specific") {
    for (const brandName of selectedBrands.filter((item) => item !== "未設定" && item !== "共通")) {
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
    { role: "メイン", supplier: body.mainSupplier, purchaseUrl: body.mainPurchaseUrl, price: Number.isFinite(referencePrice) ? referencePrice : 0 },
    { role: "予備", supplier: body.backupSupplier, purchaseUrl: body.backupPurchaseUrl, price: null }
  ]) {
    const supplierName = String(option.supplier ?? "").trim();
    if (!supplierName) continue;

    await sql`
      insert into product_supplier_options (product_id, supplier_id, role, reference_price, purchase_url, is_active)
      select ${productId}, suppliers.id, ${option.role}, ${option.price}, ${String(option.purchaseUrl ?? "").trim() || null}, true
      from suppliers
      where suppliers.name = ${supplierName}
      on conflict (product_id, supplier_id, role)
      do update set
        reference_price = excluded.reference_price,
        purchase_url = excluded.purchase_url,
        is_active = true
    `;
  }

  return Response.json({ ok: true });
}

function parseOptionalNumber(value: unknown) {
  const normalized = String(value ?? "").replace(/[¥￥,\s]/g, "");
  if (!normalized) return null;
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

export async function DELETE(request: Request) {
  const session = await requireMasterOpsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as { id?: string; productName?: string };
  const id = String(body.id ?? "").trim();

  if (!id && !body.productName) {
    return Response.json({ error: "product id is required" }, { status: 400 });
  }

  const linkedItems = await sql`
    select count(*)::int as count
    from purchase_order_items
    join products on products.id = purchase_order_items.product_id
    where (${id || null}::uuid is not null and products.id = ${id || null})
       or (${id || null}::uuid is null and products.name = ${body.productName ?? ""})
  `;

  if (Number(linkedItems[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "この商品は発注履歴で使用されているため削除できません。" },
      { status: 409 }
    );
  }

  await sql`
    delete from products
    where (${id || null}::uuid is not null and id = ${id || null})
       or (${id || null}::uuid is null and name = ${body.productName ?? ""})
  `;

  return Response.json({ ok: true });
}
