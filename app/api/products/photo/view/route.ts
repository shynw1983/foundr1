import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { canAccessStore, requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";

const comparisonPhotoRoles = new Set(["owner", "manager"]);
const fieldNotePhotoRoles = new Set(["owner", "manager", "store_owner", "store_manager", "staff"]);

export async function GET(request: NextRequest) {
  const session = await requireOsSession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const pathname = request.nextUrl.searchParams.get("pathname");
  if (!pathname) {
    return NextResponse.json({ error: "pathname is required" }, { status: 400 });
  }

  if (!await canReadBlobPath(session, pathname)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const result = await get(pathname, {
    access: "private",
    ifNoneMatch: request.headers.get("if-none-match") ?? undefined
  });

  if (!result) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (result.statusCode === 304) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: result.blob.etag,
        "Cache-Control": "private, no-cache"
      }
    });
  }

  const filename = sanitizeFilename(request.nextUrl.searchParams.get("filename") ?? "");
  const isDownload = request.nextUrl.searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": result.blob.contentType,
    "X-Content-Type-Options": "nosniff",
    ETag: result.blob.etag,
    "Cache-Control": "private, no-cache"
  };
  if (filename) {
    headers["Content-Disposition"] = `${isDownload ? "attachment" : "inline"}; filename="${filename}"`;
  }

  return new NextResponse(result.stream, {
    headers
  });
}

function sanitizeFilename(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function canReadBlobPath(session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>, pathname: string) {
  if (pathname.startsWith("products/")) return true;
  if (pathname.startsWith("field-notes/")) return fieldNotePhotoRoles.has(session.role);
  if (pathname.startsWith("product-comparisons/")) return comparisonPhotoRoles.has(session.role);

  if (pathname.startsWith("purchase-receipts/")) {
    const encodedPathname = encodeURIComponent(pathname);
    const rawPathname = pathname;
    const rows = await sql`
      select purchase_orders.store_id::text as "storeId"
      from purchase_order_supplier_fulfillments
      join purchase_orders on purchase_orders.id = purchase_order_supplier_fulfillments.purchase_order_id
      where purchase_order_supplier_fulfillments.receipt_photo_url like ${`%${encodedPathname}%`}
         or purchase_order_supplier_fulfillments.receipt_photo_url like ${`%${rawPathname}%`}
      limit 1
    `;
    return canAccessStore(session, rows[0]?.storeId);
  }

  if (pathname.startsWith("expense-receipts/")) {
    const encodedPathname = encodeURIComponent(pathname);
    const rawPathname = pathname;
    const rows = await sql`
      select store_id::text as "storeId"
      from expense_receipts
      where receipt_photo_url like ${`%${encodedPathname}%`}
         or receipt_photo_url like ${`%${rawPathname}%`}
      limit 1
    `;
    return canAccessStore(session, rows[0]?.storeId);
  }

  if (pathname.startsWith("voucher-documents/")) {
    const encodedPathname = encodeURIComponent(pathname);
    const rawPathname = pathname;
    const rows = await sql`
      select
        store_id::text as "storeId",
        created_by::text as "createdBy"
      from receipt_ocr_results
      where receipt_photo_url like ${`%${encodedPathname}%`}
         or receipt_photo_url like ${`%${rawPathname}%`}
      limit 1
    `;
    if (String(rows[0]?.createdBy ?? "") === session.id) return true;
    if (!rows.length && (session.role === "owner" || session.role === "manager")) return true;
    return canAccessStore(session, rows[0]?.storeId);
  }

  return false;
}
