import { put } from "@vercel/blob";
import { requireOsSession } from "../../../../../lib/api-auth";
import { recordExternalServiceUsage } from "../../../../../lib/external-service-usage";
import { validateImageUpload } from "../../../../../lib/upload-security";

export const dynamic = "force-dynamic";

const writableRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const maxImageSizeBytes = 8 * 1024 * 1024;

function safeFilename(value: string) {
  return value.replace(/[^\w.-]+/g, "-").toLowerCase() || "receipt-template";
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !writableRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const slot = String(formData.get("slot") ?? "logo").trim() === "promotion" ? "promotion" : "logo";
    const fileName = String(formData.get("name") ?? `receipt-${slot}`).trim();

    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }

    const extension = validateImageUpload(file, maxImageSizeBytes, "レシート画像");
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json(
        { error: "Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。" },
        { status: 503 }
      );
    }

    const blob = await put(`pos-receipts/${slot}/${safeFilename(fileName)}-${Date.now()}.${extension}`, file, {
      access: "private"
    });
    await recordExternalServiceUsage({
      serviceKey: "vercel_blob",
      metricKey: "storage_bytes",
      quantity: file.size,
      unit: "bytes",
      source: "pos_receipt_template_image",
      metadata: { pathname: blob.pathname, slot }
    });

    const url = `/api/public/pos-receipt-image?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;
    return Response.json({ url, pathname: blob.pathname, slot, name: fileName || file.name });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("形式を選択") || message.includes("MB以下")) {
      return Response.json({ error: message }, { status: message.includes("MB以下") ? 413 : 400 });
    }
    if (message.toLowerCase().includes("blob") || message.toLowerCase().includes("token")) {
      return Response.json({ error: "Vercel Blob の保存に失敗しました。Blob の接続設定を確認してください。" }, { status: 502 });
    }
    return Response.json({ error: "レシート画像をアップロードできませんでした。" }, { status: 500 });
  }
}
