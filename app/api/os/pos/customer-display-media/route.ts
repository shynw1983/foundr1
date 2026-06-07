import { put } from "@vercel/blob";
import { requireOsSession } from "../../../../../lib/api-auth";
import { validateImageUpload } from "../../../../../lib/upload-security";

export const dynamic = "force-dynamic";

const writableRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const maxImageSizeBytes = 8 * 1024 * 1024;
const maxVideoSizeBytes = 80 * 1024 * 1024;
const videoTypes = new Map([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"]
]);

function safeFilename(value: string) {
  return value.replace(/[^\w.-]+/g, "-").toLowerCase() || "customer-display";
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !writableRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const mediaType = String(formData.get("type") ?? "image").trim() === "video" ? "video" : "image";
    const file = formData.get("file");
    const fileName = String(formData.get("name") ?? "customer-display").trim();

    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }

    const extension = mediaType === "video"
      ? videoTypes.get(file.type.toLowerCase())
      : validateImageUpload(file, maxImageSizeBytes, "画像");
    if (!extension) {
      return Response.json({ error: "動画はmp4/webm/mov形式を選択してください。" }, { status: 400 });
    }
    if (mediaType === "video" && file.size > maxVideoSizeBytes) {
      return Response.json({ error: "動画は80MB以下にしてください。" }, { status: 413 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json(
        { error: "Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。" },
        { status: 503 }
      );
    }

    const blob = await put(`customer-display/${safeFilename(fileName)}-${Date.now()}.${extension}`, file, {
      access: "private"
    });
    const url = `/api/public/customer-display-media?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;

    return Response.json({ url, pathname: blob.pathname, type: mediaType, name: fileName || file.name });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("形式を選択") || message.includes("MB以下")) {
      return Response.json({ error: message }, { status: message.includes("MB以下") ? 413 : 400 });
    }
    if (message.toLowerCase().includes("blob") || message.toLowerCase().includes("token")) {
      return Response.json({ error: "Vercel Blob の保存に失敗しました。Blob の接続設定を確認してください。" }, { status: 502 });
    }
    return Response.json({ error: "客席表示メディアをアップロードできませんでした。" }, { status: 500 });
  }
}
