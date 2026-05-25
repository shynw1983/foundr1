import { put } from "@vercel/blob";
import { requireOpsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";

const allowedRoles = new Set(["owner", "manager", "buyer"]);
const maxPhotoSizeBytes = 4 * 1024 * 1024;

export async function GET() {
  const session = await requireOpsSession();
  if (!session || !allowedRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const rows = await sql`
    select
      field_notes.id::text as id,
      field_notes.note_type as "noteType",
      field_notes.title,
      field_notes.supplier_id::text as "supplierId",
      coalesce(field_notes.supplier_name, suppliers.name, '') as "supplierName",
      coalesce(field_notes.supplier_location, '') as "supplierLocation",
      coalesce(field_notes.product_name, '') as "productName",
      field_notes.observed_price::float as "observedPrice",
      coalesce(field_notes.photo_url, '') as "photoUrl",
      coalesce(field_notes.note, '') as note,
      field_notes.status,
      coalesce(employees.name, '') as "recordedBy",
      to_char(field_notes.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel"
    from field_notes
    left join suppliers on suppliers.id = field_notes.supplier_id
    left join employees on employees.id = field_notes.recorded_by
    order by field_notes.created_at desc
  `;

  return Response.json({ notes: rows });
}

export async function POST(request: Request) {
  const session = await requireOpsSession();
  if (!session || !allowedRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const formData = await request.formData();
  const noteType = normalizeNoteType(formData.get("noteType"));
  const title = String(formData.get("title") ?? "").trim();
  const supplierId = String(formData.get("supplierId") ?? "").trim();
  const supplierNameInput = String(formData.get("supplierName") ?? "").trim();
  const supplierLocation = String(formData.get("supplierLocation") ?? "").trim();
  const productName = String(formData.get("productName") ?? "").trim();
  const observedPrice = normalizeNumber(formData.get("observedPrice"));
  const note = String(formData.get("note") ?? "").trim();
  const file = formData.get("photo");

  if (!title) {
    return Response.json({ error: "記録タイトルを入力してください。" }, { status: 400 });
  }

  const supplierRows = supplierId
    ? await sql`
        select id, name
        from suppliers
        where id = ${supplierId}
        limit 1
      `
    : [];
  const supplierIdValue = supplierRows[0]?.id ?? null;
  const supplierName = supplierRows[0]?.name ?? supplierNameInput;
  const photoUrl = await uploadPhotoIfNeeded(file, title, "field-notes");

  await sql`
    insert into field_notes (
      note_type,
      title,
      supplier_id,
      supplier_name,
      supplier_location,
      product_name,
      observed_price,
      photo_url,
      note,
      recorded_by,
      updated_at
    ) values (
      ${noteType},
      ${title},
      ${supplierIdValue},
      ${supplierName},
      ${supplierLocation},
      ${productName},
      ${observedPrice || null},
      ${photoUrl},
      ${note},
      ${session.id},
      now()
    )
  `;

  return Response.json({ ok: true });
}

function normalizeNoteType(value: FormDataEntryValue | null) {
  const type = String(value ?? "");
  return ["idea", "new_product", "supplier_visit", "price_hint"].includes(type) ? type : "idea";
}

function normalizeNumber(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").replace(/[¥￥,\s]/g, "");
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

async function uploadPhotoIfNeeded(file: FormDataEntryValue | null, name: string, folder: string) {
  if (!(file instanceof File) || file.size === 0) return "";

  if (!file.type.startsWith("image/")) {
    throw new Error("画像ファイルを選択してください。");
  }

  if (file.size > maxPhotoSizeBytes) {
    throw new Error("写真は4MB以下にしてください。");
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。");
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeName = name.replace(/[^\w.-]+/g, "-").toLowerCase() || "note";
  const blob = await put(`${folder}/${safeName}-${Date.now()}.${extension}`, file, {
    access: "private"
  });

  return `/api/products/photo/view?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;
}
