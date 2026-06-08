import { put } from "@vercel/blob";
import { requireOsSession } from "../../../../lib/api-auth";
import { canEditBrandSiteContent } from "../../../../lib/brand-site-content";
import { recordExternalServiceUsage } from "../../../../lib/external-service-usage";
import { validateImageUpload } from "../../../../lib/upload-security";

export const dynamic = "force-dynamic";

const maxPhotoSizeBytes = 6 * 1024 * 1024;

function safeFilename(value: string) {
  return value.replace(/[^\w.-]+/g, "-").toLowerCase() || "brand-site";
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !canEditBrandSiteContent(session)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const brandName = String(formData.get("brandName") ?? "brand-site").trim();
    const sectionKey = String(formData.get("sectionKey") ?? "section").trim();

    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }

    const extension = validateImageUpload(file, maxPhotoSizeBytes, "画像");

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json(
        { error: "Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。" },
        { status: 503 }
      );
    }

    const blob = await put(`brand-sites/${safeFilename(brandName)}/${safeFilename(sectionKey)}-${Date.now()}.${extension}`, file, {
      access: "private"
    });
    await recordExternalServiceUsage({
      serviceKey: "vercel_blob",
      metricKey: "storage_bytes",
      quantity: file.size,
      unit: "bytes",
      source: "brand_site_photo",
      metadata: { pathname: blob.pathname }
    });

    const url = `/api/public/brand-site-image?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;
    return Response.json({ url, pathname: blob.pathname });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("形式を選択")) {
      return Response.json({ error: message }, { status: 400 });
    }
    if (message.includes("MB以下") || message.toLowerCase().includes("body") || message.toLowerCase().includes("size")) {
      return Response.json({ error: "画像ファイルが大きすぎます。6MB以下に圧縮してからアップロードしてください。" }, { status: 413 });
    }
    if (message.toLowerCase().includes("blob") || message.toLowerCase().includes("token")) {
      return Response.json({ error: "Vercel Blob の保存に失敗しました。Blob の接続設定を確認してください。" }, { status: 502 });
    }
    return Response.json({ error: "画像をアップロードできませんでした。" }, { status: 500 });
  }
}
