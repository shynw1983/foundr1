import { requireMasterOsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { normalizeReceiptProductName, recordReceiptItemPrice } from "../../../lib/receipt-ocr";

type CandidateAction = "create_product" | "link_product" | "ignore";

export async function GET() {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const [candidateRows, productRows] = await Promise.all([
    sql`
      select
        product_candidates.id::text,
        product_candidates.raw_name as "rawName",
        product_candidates.normalized_name as "normalizedName",
        product_candidates.suggested_name as "suggestedName",
        product_candidates.category,
        product_candidates.subcategory,
        product_candidates.unit,
        product_candidates.reference_price::float as "referencePrice",
        product_candidates.supplier_name as "supplierName",
        product_candidates.status,
        coalesce(to_char(product_candidates.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI'), '') as "createdLabel",
        receipt_ocr_results.receipt_photo_url as "receiptPhotoUrl",
        receipt_ocr_results.vendor_name as "vendorName",
        coalesce(to_char(receipt_ocr_results.purchase_date, 'YYYY-MM-DD'), '') as "purchaseDate"
      from product_candidates
      left join receipt_ocr_items on receipt_ocr_items.id = product_candidates.receipt_ocr_item_id
      left join receipt_ocr_results on receipt_ocr_results.id = receipt_ocr_items.receipt_ocr_result_id
      where product_candidates.status = 'pending'
        and (
          receipt_ocr_results.source_type = 'procurement'
          or receipt_ocr_results.usage_type = 'shiire'
        )
      order by product_candidates.created_at desc
      limit 100
    `,
    sql`
      select
        id::text,
        name,
        category,
        unit,
        coalesce(subcategory, '未分類') as subcategory,
        coalesce(product_family_name, '') as "productFamilyName",
        coalesce(variant_name, '') as "variantName",
        coalesce(package_spec, '') as "packageSpec",
        package_quantity::float as "packageQuantity",
        coalesce(package_quantity_unit, '') as "packageQuantityUnit",
        coalesce((
          select suppliers.name
          from product_supplier_options
          join suppliers on suppliers.id = product_supplier_options.supplier_id
          where product_supplier_options.product_id = products.id
            and product_supplier_options.role = 'メイン'
            and product_supplier_options.is_active = true
          order by suppliers.name
          limit 1
        ), '') as "mainSupplier"
      from products
      order by category asc, coalesce(subcategory, '未分類') asc, coalesce(product_family_name, name) asc, variant_sort_order asc, name asc
      limit 500
    `
  ]);

  return Response.json({
    candidates: candidateRows.map((row) => ({
      id: String(row.id),
      rawName: String(row.rawName ?? ""),
      normalizedName: String(row.normalizedName ?? ""),
      suggestedName: String(row.suggestedName ?? ""),
      category: String(row.category ?? "未分類"),
      subcategory: String(row.subcategory ?? "未分類"),
      unit: String(row.unit ?? "個"),
      referencePrice: Number(row.referencePrice ?? 0),
      supplierName: String(row.supplierName ?? ""),
      status: String(row.status ?? "pending"),
      createdLabel: String(row.createdLabel ?? ""),
      receiptPhotoUrl: String(row.receiptPhotoUrl ?? ""),
      vendorName: String(row.vendorName ?? ""),
      purchaseDate: String(row.purchaseDate ?? "")
    })),
    products: productRows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      category: String(row.category ?? ""),
      subcategory: String(row.subcategory ?? "未分類"),
      unit: String(row.unit ?? ""),
      productFamilyName: String(row.productFamilyName ?? ""),
      variantName: String(row.variantName ?? ""),
      packageSpec: String(row.packageSpec ?? ""),
      packageQuantity: row.packageQuantity === null || row.packageQuantity === undefined ? "" : String(Number(row.packageQuantity)),
      packageQuantityUnit: String(row.packageQuantityUnit ?? ""),
      mainSupplier: String(row.mainSupplier ?? "")
    }))
  });
}

export async function PATCH(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    id?: string;
    action?: CandidateAction;
    productId?: string;
    name?: string;
    category?: string;
    subcategory?: string;
    unit?: string;
    referencePrice?: number;
  };
  const id = String(body.id ?? "").trim();
  const action = String(body.action ?? "") as CandidateAction;
  if (!id) return Response.json({ error: "候補 ID がありません。" }, { status: 400 });

  const rows = await sql`
    select
      product_candidates.id::text,
      product_candidates.receipt_ocr_item_id::text as "itemId",
      product_candidates.raw_name as "rawName",
      product_candidates.normalized_name as "normalizedName",
      product_candidates.suggested_name as "suggestedName",
      product_candidates.category,
      product_candidates.subcategory,
      product_candidates.unit,
      product_candidates.reference_price::float as "referencePrice",
      product_candidates.supplier_name as "supplierName"
    from product_candidates
    left join receipt_ocr_items on receipt_ocr_items.id = product_candidates.receipt_ocr_item_id
    left join receipt_ocr_results on receipt_ocr_results.id = receipt_ocr_items.receipt_ocr_result_id
    where product_candidates.id::text = ${id}
      and product_candidates.status = 'pending'
      and (
        receipt_ocr_results.source_type = 'procurement'
        or receipt_ocr_results.usage_type = 'shiire'
      )
    limit 1
  `;
  const candidate = rows[0];
  if (!candidate) return Response.json({ error: "候補が見つかりません。" }, { status: 404 });

  if (action === "ignore") {
    await sql`
      update product_candidates
      set status = 'ignored', reviewed_by = ${session.id}, reviewed_at = now(), updated_at = now()
      where id::text = ${id}
    `;
    if (candidate.itemId) {
      await sql`update receipt_ocr_items set match_status = 'ignored', updated_at = now() where id::text = ${String(candidate.itemId)}`;
    }
    return Response.json({ ok: true });
  }

  const productId = action === "create_product"
    ? await createProductFromCandidate(candidate, body, session.id)
    : String(body.productId ?? "").trim();
  if (!productId) return Response.json({ error: "紐付ける商品を選択してください。" }, { status: 400 });

  await sql`
    insert into product_match_dictionary (
      supplier_name,
      raw_name,
      normalized_name,
      product_id,
      category,
      unit,
      created_by,
      updated_at
    )
    values (
      ${String(candidate.supplierName ?? "")},
      ${String(candidate.rawName ?? "")},
      ${normalizeReceiptProductName(String(candidate.rawName ?? ""))},
      ${productId},
      ${String(body.category ?? candidate.category ?? "")},
      ${String(body.unit ?? candidate.unit ?? "")},
      ${session.id},
      now()
    )
    on conflict (supplier_name, normalized_name)
    do update set
      product_id = excluded.product_id,
      category = excluded.category,
      unit = excluded.unit,
      updated_at = now()
  `;

  await sql`
    update product_candidates
    set
      status = ${action === "create_product" ? "created" : "linked"},
      product_id = ${productId},
      reviewed_by = ${session.id},
      reviewed_at = now(),
      updated_at = now()
    where id::text = ${id}
  `;

  const itemRows = await sql`
    select receipt_ocr_items.id::text as id
    from receipt_ocr_items
    join receipt_ocr_results on receipt_ocr_results.id = receipt_ocr_items.receipt_ocr_result_id
    where receipt_ocr_items.normalized_name = ${String(candidate.normalizedName ?? "")}
      and receipt_ocr_items.match_status in ('unmatched', 'not_applicable')
      and (
        ${String(candidate.supplierName ?? "")} = ''
        or coalesce(receipt_ocr_results.supplier_name, '') = ${String(candidate.supplierName ?? "")}
        or coalesce(receipt_ocr_results.vendor_name, '') = ${String(candidate.supplierName ?? "")}
      )
      and (
        receipt_ocr_results.source_type = 'procurement'
        or receipt_ocr_results.usage_type = 'shiire'
      )
  `;
  const itemIds = new Set(itemRows.map((row) => String(row.id ?? "")).filter(Boolean));
  if (candidate.itemId) itemIds.add(String(candidate.itemId));
  for (const itemId of itemIds) {
    await sql`
      update receipt_ocr_items
      set matched_product_id = ${productId}, match_status = 'matched', updated_at = now()
      where id::text = ${itemId}
    `;
    await recordReceiptItemPrice(itemId, productId, session.id);
  }

  return Response.json({ ok: true, productId });
}

async function createProductFromCandidate(candidate: Record<string, unknown>, body: Record<string, unknown>, employeeId: string) {
  const name = String(body.name ?? candidate.suggestedName ?? candidate.rawName ?? "").trim();
  if (!name) throw new Error("商品名を入力してください。");
  const category = String(body.category ?? candidate.category ?? "未分類").trim() || "未分類";
  const subcategory = String(body.subcategory ?? candidate.subcategory ?? "未分類").trim() || "未分類";
  const unit = String(body.unit ?? candidate.unit ?? "個").trim() || "個";
  const referencePrice = Number(body.referencePrice ?? candidate.referencePrice ?? 0);

  const productRows = await sql`
    insert into products (
      name,
      category,
      subcategory,
      unit,
      reference_price,
      brand_scope,
      usage_type,
      japanese_note,
      updated_at
    )
    values (
      ${name},
      ${category},
      ${subcategory},
      ${unit},
      ${Number.isFinite(referencePrice) ? referencePrice : 0},
      ${"unset"},
      ${category === "包材" ? "packaging" : category === "消耗品" || category === "清掃用品" ? "consumable" : "ingredient"},
      ${`[情報未補完] レシート OCR から追加: ${String(candidate.rawName ?? "")}`},
      now()
    )
    returning id::text
  `;
  const productId = String(productRows[0]?.id ?? "");
  const supplierName = String(candidate.supplierName ?? "").trim();
  if (productId && supplierName) {
    await sql`
      insert into product_supplier_options (product_id, supplier_id, role, reference_price, is_active)
      select ${productId}, suppliers.id, ${"メイン"}, ${Number.isFinite(referencePrice) ? referencePrice : 0}, true
      from suppliers
      where suppliers.name = ${supplierName}
      on conflict (product_id, supplier_id, role)
      do update set reference_price = excluded.reference_price, is_active = true
    `;
  }
  return productId;
}
