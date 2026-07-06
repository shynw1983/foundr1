import { get } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "../../../../../../lib/db";
import { verifyVoucherPublicPreviewToken } from "../../../../../../lib/voucher-public-preview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!id || !verifyVoucherPublicPreviewToken(id, token)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const rows = await sql`
    select
      receipt_photo_url as "receiptPhotoUrl",
      uploaded_file_name as "uploadedFileName"
    from receipt_ocr_results
    where id::text = ${id}
      and status = 'confirmed'
    limit 1
  `;
  const voucher = rows[0];
  if (!voucher) return new NextResponse("Not found", { status: 404 });

  const pathname = extractBlobPathname(String(voucher.receiptPhotoUrl ?? ""));
  if (!pathname) return new NextResponse("File path not found", { status: 404 });

  const result = await get(pathname, { access: "private" });
  if (!result) return new NextResponse("Not found", { status: 404 });

  const filename = sanitizeFilename(String(voucher.uploadedFileName ?? "")) || "voucher";
  return new NextResponse(result.stream, {
    headers: {
      "Content-Type": result.blob.contentType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      ETag: result.blob.etag,
      "Cache-Control": "private, no-store"
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
