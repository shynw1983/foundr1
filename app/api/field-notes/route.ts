import { put } from "@vercel/blob";
import { requireOsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { recordExternalServiceUsage } from "../../../lib/external-service-usage";
import { validateImageUpload } from "../../../lib/upload-security";

const allowedRoles = new Set(["owner", "manager", "store_owner", "store_manager", "staff"]);
const adminRoles = new Set(["owner", "manager"]);
const statusRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const maxPhotoSizeBytes = 4 * 1024 * 1024;
const noteStatuses = new Set(["open", "reviewing", "comparison", "adopted", "rejected"]);

export async function GET() {
  const session = await requireOsSession();
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
      field_notes.recorded_by::text as "recordedById",
      coalesce(employees.name, '') as "recordedBy",
      to_char(field_notes.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') as "createdLabel",
      coalesce((
        select json_agg(
          json_build_object(
            'id', field_note_comments.id::text,
            'comment', field_note_comments.comment,
            'createdBy', coalesce(comment_employees.name, ''),
            'createdLabel', to_char(field_note_comments.created_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI')
          )
          order by field_note_comments.created_at asc
        )
        from field_note_comments
        left join employees comment_employees on comment_employees.id = field_note_comments.created_by
        where field_note_comments.field_note_id = field_notes.id
      ), '[]'::json) as comments
    from field_notes
    left join suppliers on suppliers.id = field_notes.supplier_id
    left join employees on employees.id = field_notes.recorded_by
    order by field_notes.created_at desc
  `;

  return Response.json({
    notes: rows.map((row) => ({
      ...row,
      canEdit: canModifyNote(session.role, session.id, row.recordedById),
      canDelete: canModifyNote(session.role, session.id, row.recordedById),
      canChangeStatus: statusRoles.has(session.role)
    }))
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
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

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session || !allowedRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as {
    id?: string;
    action?: string;
    status?: string;
    comment?: string;
    title?: string;
    supplierName?: string;
    supplierLocation?: string;
    productName?: string;
    observedPrice?: number | string;
    note?: string;
  };
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "現場記録が見つかりません。" }, { status: 404 });

  const noteRows = await sql`
    select id, recorded_by::text as "recordedById"
    from field_notes
    where id = ${id}
    limit 1
  `;
  const target = noteRows[0];
  if (!target) return Response.json({ error: "現場記録が見つかりません。" }, { status: 404 });

  if (body.action === "comment") {
    const comment = String(body.comment ?? "").trim();
    if (!comment) return Response.json({ error: "コメントを入力してください。" }, { status: 400 });

    await sql`
      insert into field_note_comments (field_note_id, comment, created_by)
      values (${id}, ${comment}, ${session.id})
    `;
    await sql`update field_notes set updated_at = now() where id = ${id}`;
    return Response.json({ ok: true });
  }

  if (body.action === "status") {
    if (!statusRoles.has(session.role)) {
      return Response.json({ error: "状態を変更する権限がありません。" }, { status: 403 });
    }

    const status = normalizeStatus(body.status);
    await sql`
      update field_notes
      set status = ${status}, updated_at = now()
      where id = ${id}
    `;
    return Response.json({ ok: true });
  }

  if (body.action === "edit") {
    if (!canModifyNote(session.role, session.id, target.recordedById)) {
      return Response.json({ error: "この現場記録を編集する権限がありません。" }, { status: 403 });
    }

    const title = String(body.title ?? "").trim();
    if (!title) return Response.json({ error: "記録タイトルを入力してください。" }, { status: 400 });

    await sql`
      update field_notes
      set
        title = ${title},
        supplier_name = ${String(body.supplierName ?? "").trim()},
        supplier_location = ${String(body.supplierLocation ?? "").trim()},
        product_name = ${String(body.productName ?? "").trim()},
        observed_price = ${normalizeNumber(body.observedPrice ?? null) || null},
        note = ${String(body.note ?? "").trim()},
        updated_at = now()
      where id = ${id}
    `;
    return Response.json({ ok: true });
  }

  return Response.json({ error: "操作内容が不正です。" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const session = await requireOsSession();
  if (!session || !allowedRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { id?: string };
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "現場記録が見つかりません。" }, { status: 404 });

  const noteRows = await sql`
    select id, recorded_by::text as "recordedById"
    from field_notes
    where id = ${id}
    limit 1
  `;
  const target = noteRows[0];
  if (!target) return Response.json({ error: "現場記録が見つかりません。" }, { status: 404 });

  if (!canModifyNote(session.role, session.id, target.recordedById)) {
    return Response.json({ error: "この現場記録を削除する権限がありません。" }, { status: 403 });
  }

  await sql`delete from field_notes where id = ${id}`;
  return Response.json({ ok: true });
}

function normalizeNoteType(value: FormDataEntryValue | null) {
  const type = String(value ?? "");
  return ["idea", "new_product", "supplier_visit", "price_hint"].includes(type) ? type : "idea";
}

function normalizeStatus(value: unknown) {
  const status = String(value ?? "");
  return noteStatuses.has(status) ? status : "open";
}

function canModifyNote(role: string, employeeId: string, recordedById?: string) {
  return adminRoles.has(role) || Boolean(recordedById && recordedById === employeeId);
}

function normalizeNumber(value: FormDataEntryValue | string | number | null) {
  const normalized = String(value ?? "").replace(/[¥￥,\s]/g, "");
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

async function uploadPhotoIfNeeded(file: FormDataEntryValue | null, name: string, folder: string) {
  if (!(file instanceof File) || file.size === 0) return "";

  const extension = validateImageUpload(file, maxPhotoSizeBytes, "写真");

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。");
  }

  const safeName = name.replace(/[^\w.-]+/g, "-").toLowerCase() || "note";
  const blob = await put(`${folder}/${safeName}-${Date.now()}.${extension}`, file, {
    access: "private"
  });
  await recordExternalServiceUsage({
    serviceKey: "vercel_blob",
    metricKey: "storage_bytes",
    quantity: file.size,
    unit: "bytes",
    source: "field_note_photo",
    metadata: { pathname: blob.pathname }
  });

  return `/api/products/photo/view?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;
}
