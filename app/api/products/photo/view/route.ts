import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { assertProductViewable } from "../../../../../lib/product-catalog-access";
import { isHeadquarterCatalogRole } from "../../../../../lib/product-catalog-policy";

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
  if (pathname.startsWith("products/")) {
    if (isHeadquarterCatalogRole(session.role)) return true;
    const products = await sql`
      select id::text as id, photo_url as "photoUrl" from products
      where position(${pathname} in photo_url) > 0
        or position(${encodeURIComponent(pathname)} in photo_url) > 0
    `;
    for (const product of products) {
      let storedPath = "";
      try {
        const url = new URL(String(product.photoUrl), "https://foundr1.invalid");
        storedPath = url.searchParams.get("pathname") ?? url.pathname.replace(/^\//, "");
      } catch { continue; }
      if (storedPath !== pathname) continue;
      if ((await assertProductViewable(session, String(product.id))).ok) return true;
      // Existing stock and completed store transactions remain identifiable after unpublishing.
      const scope = await getSessionStoreScope(session);
      const held = await sql`
        select 1 where exists (
          select 1 from inventory_items
          where product_id::text = ${String(product.id)} and store_id::text = any(${scope.storeIds})
        ) or exists (
          select 1 from purchase_order_items items join purchase_orders orders on orders.id = items.purchase_order_id
          where items.product_id::text = ${String(product.id)} and orders.store_id::text = any(${scope.storeIds})
        )
      `;
      if (held.length) return true;
    }
    return false;
  }
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
