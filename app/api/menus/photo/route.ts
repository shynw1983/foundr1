import { put } from "@vercel/blob";
import { requireOsSession } from "../../../../lib/api-auth";
import { validateImageUpload } from "../../../../lib/upload-security";

const menuEditorRoles = new Set(["owner", "manager"]);
const maxPhotoSizeBytes = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !menuEditorRoles.has(session.role)) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const itemName = String(formData.get("itemName") ?? "menu-item").trim();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "file is required" }, { status: 400 });
    }

    const extension = validateImageUpload(file, maxPhotoSizeBytes, "写真");

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json(
        { error: "Vercel Blob が未設定です。BLOB_READ_WRITE_TOKEN を接続してください。" },
        { status: 503 }
      );
    }

    const safeName = itemName.replace(/[^\w.-]+/g, "-").toLowerCase() || "menu-item";
    const blob = await put(`menu-items/${safeName}-${Date.now()}.${extension}`, file, {
      access: "private"
    });
    const photoUrl = `/api/public/menu-image?pathname=${encodeURIComponent(blob.pathname)}&v=${Date.now()}`;

    return Response.json({ url: photoUrl, pathname: blob.pathname });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "";

    if (message.includes("形式を選択")) {
      return Response.json({ error: message }, { status: 400 });
    }

    if (message.includes("MB以下") || message.toLowerCase().includes("body") || message.toLowerCase().includes("size")) {
      return Response.json(
        { error: "写真ファイルが大きすぎます。4MB以下に圧縮してからアップロードしてください。" },
        { status: 413 }
      );
    }

    if (message.toLowerCase().includes("blob") || message.toLowerCase().includes("token")) {
      return Response.json(
        { error: "Vercel Blob の保存に失敗しました。Blob の接続設定を確認してください。" },
        { status: 502 }
      );
    }

    return Response.json(
      { error: "写真をアップロードできませんでした。時間をおいて再試行してください。" },
      { status: 500 }
    );
  }
}
