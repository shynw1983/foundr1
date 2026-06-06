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

  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType,
      "X-Content-Type-Options": "nosniff",
      ETag: result.blob.etag,
      "Cache-Control": "private, no-cache"
    }
  });
}

async function canReadBlobPath(session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>, pathname: string) {
  if (pathname.startsWith("products/")) return true;
  if (pathname.startsWith("field-notes/")) return fieldNotePhotoRoles.has(session.role);
  if (pathname.startsWith("product-comparisons/")) return comparisonPhotoRoles.has(session.role);

  if (pathname.startsWith("purchase-receipts/")) {
    const encodedPathname = encodeURIComponent(pathname);
    const rows = await sql`
      select purchase_orders.store_id::text as "storeId"
      from purchase_order_supplier_fulfillments
      join purchase_orders on purchase_orders.id = purchase_order_supplier_fulfillments.purchase_order_id
      where purchase_order_supplier_fulfillments.receipt_photo_url like ${`%${encodedPathname}%`}
      limit 1
    `;
    return canAccessStore(session, rows[0]?.storeId);
  }

  return false;
}
