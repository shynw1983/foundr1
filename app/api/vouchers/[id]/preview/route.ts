import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { canAccessStore, requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOsSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const rows = await sql`
    select
      store_id::text as "storeId",
      created_by::text as "createdBy",
      receipt_photo_url as "receiptPhotoUrl",
      uploaded_file_name as "uploadedFileName"
    from receipt_ocr_results
    where id::text = ${id}
    limit 1
  `;
  const voucher = rows[0];
  if (!voucher) return new NextResponse("Not found", { status: 404 });

  const canRead = String(voucher.createdBy ?? "") === session.id || await canAccessStore(session, voucher.storeId);
  if (!canRead) return new NextResponse("Forbidden", { status: 403 });

  const pathname = extractBlobPathname(String(voucher.receiptPhotoUrl ?? ""));
  if (!pathname) return new NextResponse("File path not found", { status: 404 });

  const result = await get(pathname, {
    access: "private",
    ifNoneMatch: request.headers.get("if-none-match") ?? undefined
  });
  if (!result) return new NextResponse("Not found", { status: 404 });

  if (result.statusCode === 304) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: result.blob.etag,
        "Cache-Control": "private, no-cache"
      }
    });
  }

  const filename = sanitizeFilename(String(voucher.uploadedFileName ?? "")) || "voucher";
  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType,
      "Content-Disposition": `inline; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      ETag: result.blob.etag,
      "Cache-Control": "private, no-cache"
    }
  });
}

function extractBlobPathname(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("voucher-documents/")) return trimmed;
  try {
    const url = trimmed.startsWith("http") ? new URL(trimmed) : new URL(trimmed, "https://foundr1.local");
    const pathname = url.searchParams.get("pathname");
    if (pathname) return pathname;
    const directPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (directPath.startsWith("voucher-documents/")) return directPath;
  } catch {
    return "";
  }
  return "";
}

function sanitizeFilename(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
